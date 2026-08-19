import { readFileSync } from "node:fs";

const MAX_CANDIDATES = 128;
const MAX_SIGNALS = 128;
const MAX_EXCLUSIONS = 64;
const MAX_PROGRAM_ID = 100;
const MAX_CONCEPT_ID = 64;
const MAX_BREAKDOWN = 64;
const MAX_REASON_CODES = 64;
const SCORE_MIN = -100;
const SCORE_MAX = 100;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const CONCEPT_KINDS = new Set([
  "subject", "activity", "program", "environment", "interaction", "modality", "level",
]);
const DIMENSIONS = new Set(["interest", "ability", "preference", "restriction"]);
const POLARITIES = new Set(["positive", "negative"]);
const PROFILE_SOURCES = new Set([
  "explicit_statement", "explicit_correction", "explicit_comparison",
]);
const EXCLUSION_MODES = new Set(["exact", "requirement"]);
const CANDIDATE_SOURCES = Object.freeze([
  "explicit_user_request",
  "explicit_user_selection",
  "direct_canonical_mention",
  "gemini_response",
  "profile_inference",
  "same_family",
  "documented_nearby",
  "search_continuation",
]);
const CANDIDATE_SOURCE_SET = new Set(CANDIDATE_SOURCES);
const SOURCE_POINTS = Object.freeze({
  explicit_user_request: 40,
  explicit_user_selection: 45,
  direct_canonical_mention: 18,
  gemini_response: 0,
  profile_inference: 0,
  same_family: 0,
  documented_nearby: 0,
  search_continuation: 16,
});
const SOURCE_PRIORITY = Object.freeze([
  "explicit_user_selection",
  "explicit_user_request",
  "direct_canonical_mention",
  "search_continuation",
  "profile_inference",
  "gemini_response",
  "same_family",
  "documented_nearby",
]);
const SOURCE_PRIORITY_INDEX = new Map(SOURCE_PRIORITY.map((source, index) => [source, index]));
const CLASSIFICATION_PRIORITY = Object.freeze({ accepted: 0, confirmation_required: 1, rejected: 2 });
const SIGNAL_WEIGHTS = Object.freeze({
  "interest|positive": 12,
  "interest|negative": -18,
  "ability|positive": 6,
  "ability|negative": -5,
  "preference|positive": 9,
  "preference|negative": -8,
  "restriction|negative": -7,
});
const SIGNAL_REASON_CODES = Object.freeze({
  "interest|positive": "positive_interest_match",
  "interest|negative": "negative_interest_match",
  "ability|positive": "positive_ability_match",
  "ability|negative": "negative_ability_match",
  "preference|positive": "positive_preference_match",
  "preference|negative": "negative_preference_match",
  "restriction|negative": "negative_restriction_match",
});
const INTENSITY_FACTORS = Object.freeze({ 1: 0.6, 2: 0.8, 3: 1, 4: 1.2, 5: 1.4 });
const REASON_CODE_ORDER = Object.freeze([
  "explicit_user_request",
  "explicit_user_selection",
  "direct_canonical_mention",
  "search_continuation",
  "positive_interest_match",
  "positive_ability_match",
  "positive_preference_match",
  "negative_interest_match",
  "negative_ability_match",
  "negative_preference_match",
  "negative_restriction_match",
  "stale_signal_discount",
  "reduced_program_trait_weight",
  "score_clamped",
  "accepted_score_threshold",
  "accepted_explicit_choice",
  "confirmation_score_threshold",
  "moderate_positive_match",
  "invalid_program",
  "exact_exclusion",
  "unclassified_inferred_candidate",
  "gemini_only_candidate",
  "family_inference_disabled",
  "nearby_inference_disabled",
  "insufficient_evidence",
  "rejected_score_threshold",
]);
const REASON_CODE_INDEX = new Map(REASON_CODE_ORDER.map((code, index) => [code, index]));
const ALLOWED_REASON_CODES = new Set(REASON_CODE_ORDER);

class VocationalRankingValidationError extends Error {
  constructor(code, field, details = {}) {
    super(`${code}:${field}`);
    this.name = "VocationalRankingValidationError";
    this.code = code;
    this.field = field;
    if (Number.isInteger(details.index)) this.index = details.index;
    if (Number.isInteger(details.limit)) this.limit = details.limit;
  }
}

function fail(code, field, details) {
  throw new VocationalRankingValidationError(code, field, details);
}

function isPlainDataObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function safeRecord(value, field, allowedKeys, code = "invalid_input") {
  if (!isPlainDataObject(value)) fail(code, field);
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    fail(code, field);
  }
  if (keys.some((key) => typeof key !== "string" || DANGEROUS_KEYS.has(key))) fail(code, field);
  const allowed = new Set(allowedKeys);
  if (keys.some((key) => !allowed.has(key))) fail(code, field);
  const values = Object.create(null);
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      fail(code, field);
    }
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) fail(code, field);
    values[key] = descriptor.value;
  }
  return { keys, values };
}

function safeArray(value, field, maximumLength, code = "invalid_input") {
  if (!Array.isArray(value)) fail(code, field);
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail(code, field);
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isInteger(length) || length < 0 || length > maximumLength) {
      fail(code, field, { limit: maximumLength });
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || !keys.includes("length")) fail(code, field);
    const items = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
        fail(code, field, { index });
      }
      items.push(descriptor.value);
    }
    return items;
  } catch (error) {
    if (error instanceof VocationalRankingValidationError) throw error;
    fail(code, field);
  }
}

function requireExactKeys(record, expected, code, field) {
  const actual = [...record.keys].sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code, field);
  }
}

function validId(value, kind) {
  const limit = kind === "program" ? MAX_PROGRAM_ID : MAX_CONCEPT_ID;
  return typeof value === "string" && value.length > 0 && value.length <= limit &&
    /^[a-z0-9][a-z0-9_-]*$/.test(value) && !DANGEROUS_KEYS.has(value);
}

function validIso(value) {
  if (typeof value !== "string" || value.length > 32 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value;
}

function ordinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseLocalJson(relativeUrl, label) {
  const bytes = readFileSync(new URL(relativeUrl, import.meta.url));
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail("incompatible_catalog", label);
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("incompatible_catalog", label);
  }
}

function normalizeCatalogInputs(catalog, relations, lexicon) {
  const catalogRoot = safeRecord(
    catalog,
    "catalog",
    ["version", "status", "sourceIntegrity", "policies", "categories", "programs"],
    "incompatible_catalog",
  );
  requireExactKeys(
    catalogRoot,
    ["version", "status", "sourceIntegrity", "policies", "categories", "programs"],
    "incompatible_catalog",
    "catalog",
  );
  if (catalogRoot.values.version !== 1 ||
      catalogRoot.values.status !== "approved_minimal_initial_coverage") {
    fail("incompatible_catalog", "catalog");
  }

  const policies = safeRecord(catalogRoot.values.policies, "catalog.policies", [
    "categoryAssignmentMode", "traitAssignmentMode", "familyInferenceEnabled",
    "nearbyInferenceEnabled", "requiredTraitBlockingEnabled", "conflictBlockingEnabled",
    "unclassifiedExplicitRequestAllowed", "unclassifiedProfileInferenceAllowed",
    "unclassifiedGeminiInferenceAllowed", "automaticNameClassificationEnabled",
    "automaticAliasClassificationEnabled",
  ], "incompatible_catalog");
  requireExactKeys(policies, [
    "categoryAssignmentMode", "traitAssignmentMode", "familyInferenceEnabled",
    "nearbyInferenceEnabled", "requiredTraitBlockingEnabled", "conflictBlockingEnabled",
    "unclassifiedExplicitRequestAllowed", "unclassifiedProfileInferenceAllowed",
    "unclassifiedGeminiInferenceAllowed", "automaticNameClassificationEnabled",
    "automaticAliasClassificationEnabled",
  ], "incompatible_catalog", "catalog.policies");
  const expectedPolicies = {
    categoryAssignmentMode: "explicit_allowlist_only",
    traitAssignmentMode: "explicit_program_configuration_only",
    familyInferenceEnabled: false,
    nearbyInferenceEnabled: false,
    requiredTraitBlockingEnabled: false,
    conflictBlockingEnabled: false,
    unclassifiedExplicitRequestAllowed: true,
    unclassifiedProfileInferenceAllowed: false,
    unclassifiedGeminiInferenceAllowed: false,
    automaticNameClassificationEnabled: false,
    automaticAliasClassificationEnabled: false,
  };
  for (const [key, expected] of Object.entries(expectedPolicies)) {
    if (policies.values[key] !== expected) fail("incompatible_catalog", `catalog.policies.${key}`);
  }

  const relationsRoot = safeRecord(relations, "relations", [
    "version", "source", "allowedLevels", "programs", "families", "nearbyRationales",
    "excludedSourceEntries", "normalizationNotes", "ambiguities",
  ], "incompatible_catalog");
  const relationPrograms = safeRecord(
    relationsRoot.values.programs,
    "relations.programs",
    Reflect.ownKeys(relationsRoot.values.programs ?? {}).filter((key) => typeof key === "string"),
    "incompatible_catalog",
  );
  const relationIds = new Set(relationPrograms.keys);
  if (relationsRoot.values.version !== 1 || relationIds.size !== 462 ||
      [...relationIds].some((id) => !validId(id, "program"))) {
    fail("incompatible_catalog", "relations.programs");
  }

  const lexiconRoot = safeRecord(lexicon, "lexicon", ["version", "concepts"], "incompatible_catalog");
  requireExactKeys(lexiconRoot, ["version", "concepts"], "incompatible_catalog", "lexicon");
  if (lexiconRoot.values.version !== 1) fail("incompatible_catalog", "lexicon.version");
  const conceptRows = safeArray(lexiconRoot.values.concepts, "lexicon.concepts", 256, "incompatible_catalog");
  const conceptKinds = new Map();
  for (let index = 0; index < conceptRows.length; index += 1) {
    const concept = safeRecord(conceptRows[index], `lexicon.concepts[${index}]`, ["id", "kind", "aliases"], "incompatible_catalog");
    requireExactKeys(concept, ["id", "kind", "aliases"], "incompatible_catalog", `lexicon.concepts[${index}]`);
    const { id, kind } = concept.values;
    safeArray(concept.values.aliases, `lexicon.concepts[${index}].aliases`, 128, "incompatible_catalog");
    if (!CONCEPT_KINDS.has(kind) || kind === "program" || !validId(id, kind) || conceptKinds.has(id)) {
      fail("incompatible_catalog", `lexicon.concepts[${index}]`);
    }
    conceptKinds.set(id, kind);
  }

  const categoryRows = safeArray(
    catalogRoot.values.categories,
    "catalog.categories",
    6,
    "incompatible_catalog",
  );
  if (categoryRows.length !== 6) fail("incompatible_catalog", "catalog.categories");
  const categoryIds = new Set();
  const categoryMemberships = new Map();
  for (let index = 0; index < categoryRows.length; index += 1) {
    const category = safeRecord(categoryRows[index], `catalog.categories[${index}]`, [
      "id", "status", "inferenceEnabled", "programIds",
    ], "incompatible_catalog");
    requireExactKeys(category, [
      "id", "status", "inferenceEnabled", "programIds",
    ], "incompatible_catalog", `catalog.categories[${index}]`);
    const categoryId = category.values.id;
    const programIds = safeArray(
      category.values.programIds,
      `catalog.categories[${index}].programIds`,
      100,
      "incompatible_catalog",
    );
    if (!validId(categoryId, "concept") || categoryIds.has(categoryId) ||
        category.values.status !== "active_explicit_only" || category.values.inferenceEnabled !== false ||
        new Set(programIds).size !== programIds.length || programIds.some((id) => !relationIds.has(id))) {
      fail("incompatible_catalog", `catalog.categories[${index}]`);
    }
    categoryIds.add(categoryId);
    for (const programId of programIds) {
      if (categoryMemberships.has(programId)) fail("incompatible_catalog", `catalog.categories[${index}]`);
      categoryMemberships.set(programId, categoryId);
    }
  }
  const programsRecord = safeRecord(
    catalogRoot.values.programs,
    "catalog.programs",
    Reflect.ownKeys(catalogRoot.values.programs ?? {}).filter((key) => typeof key === "string"),
    "incompatible_catalog",
  );
  if (programsRecord.keys.length !== 25) fail("incompatible_catalog", "catalog.programs");
  const programTraits = new Map();
  for (const programId of programsRecord.keys) {
    if (!validId(programId, "program") || !relationIds.has(programId)) {
      fail("incompatible_catalog", "catalog.programs");
    }
    const program = safeRecord(programsRecord.values[programId], `catalog.programs.${programId}`, [
      "categoryIds", "traitWeights", "requiredTraits", "conflictingTraits", "evidenceType", "reviewStatus",
    ], "incompatible_catalog");
    requireExactKeys(program, [
      "categoryIds", "traitWeights", "requiredTraits", "conflictingTraits", "evidenceType", "reviewStatus",
    ], "incompatible_catalog", `catalog.programs.${programId}`);
    const programCategoryIds = safeArray(
      program.values.categoryIds,
      `catalog.programs.${programId}.categoryIds`,
      6,
      "incompatible_catalog",
    );
    const expectedCategoryId = categoryMemberships.get(programId);
    if (programCategoryIds.some((id) => !categoryIds.has(id)) ||
        (expectedCategoryId === undefined ? programCategoryIds.length !== 0 :
          programCategoryIds.length !== 1 || programCategoryIds[0] !== expectedCategoryId)) {
      fail("incompatible_catalog", `catalog.programs.${programId}.categoryIds`);
    }
    const required = safeArray(program.values.requiredTraits, `catalog.programs.${programId}.requiredTraits`, 8, "incompatible_catalog");
    const conflicts = safeArray(program.values.conflictingTraits, `catalog.programs.${programId}.conflictingTraits`, 8, "incompatible_catalog");
    if (required.length !== 0 || conflicts.length !== 0 ||
        program.values.evidenceType !== "canonical_name_exact" ||
        program.values.reviewStatus !== "approved_minimal_coverage") {
      fail("incompatible_catalog", `catalog.programs.${programId}`);
    }
    const rawWeights = program.values.traitWeights;
    const weightKeys = isPlainDataObject(rawWeights)
      ? Reflect.ownKeys(rawWeights).filter((key) => typeof key === "string")
      : [];
    const weights = safeRecord(rawWeights, `catalog.programs.${programId}.traitWeights`, weightKeys, "incompatible_catalog");
    if (weights.keys.length !== 1) fail("incompatible_catalog", `catalog.programs.${programId}.traitWeights`);
    const normalizedWeights = new Map();
    for (const traitId of weights.keys) {
      const weight = weights.values[traitId];
      if (!conceptKinds.has(traitId) || (weight !== 3 && weight !== 5)) {
        fail("incompatible_catalog", `catalog.programs.${programId}.traitWeights`);
      }
      normalizedWeights.set(traitId, weight);
    }
    programTraits.set(programId, normalizedWeights);
  }
  const relationSnapshot = Object.freeze(Object.fromEntries(
    [...relationIds].map((id) => [id, true]),
  ));
  const conceptSnapshot = Object.freeze(Object.fromEntries(conceptKinds));
  const traitSnapshot = Object.freeze(Object.fromEntries(
    [...programTraits].map(([programId, weights]) => [
      programId,
      Object.freeze(Object.fromEntries(weights)),
    ]),
  ));
  return Object.freeze({
    relationIds: relationSnapshot,
    conceptKinds: conceptSnapshot,
    programTraits: traitSnapshot,
  });
}

const DEFAULT_CONFIG = normalizeCatalogInputs(
  parseLocalJson("../config/vocationalCareerTraits.json", "catalog"),
  parseLocalJson("../config/educativeProgramRelations.json", "relations"),
  parseLocalJson("../config/vocationalConceptLexicon.json", "lexicon"),
);


function normalizeSignal(value, index, currentRevision, config) {
  const field = `vocationalProfile.signals[${index}]`;
  const record = safeRecord(value, field, [
    "conceptKind", "conceptId", "dimension", "polarity", "intensity", "source",
    "updatedRevision", "updatedAt",
  ], "invalid_profile");
  requireExactKeys(record, [
    "conceptKind", "conceptId", "dimension", "polarity", "intensity", "source",
    "updatedRevision", "updatedAt",
  ], "invalid_profile", field);
  const item = record.values;
  const conceptIsValid = item.conceptKind === "program"
    ? Object.hasOwn(config.relationIds, item.conceptId)
    : config.conceptKinds[item.conceptId] === item.conceptKind;
  if (!CONCEPT_KINDS.has(item.conceptKind) || !validId(item.conceptId, item.conceptKind) ||
      !conceptIsValid || !DIMENSIONS.has(item.dimension) || !POLARITIES.has(item.polarity) ||
      (item.dimension === "restriction" && item.polarity !== "negative") ||
      !Number.isSafeInteger(item.intensity) || item.intensity < 1 || item.intensity > 5 ||
      !PROFILE_SOURCES.has(item.source) || !Number.isSafeInteger(item.updatedRevision) ||
      item.updatedRevision < 1 || item.updatedRevision > currentRevision || !validIso(item.updatedAt)) {
    fail("invalid_profile", field, { index });
  }
  return {
    conceptKind: item.conceptKind,
    conceptId: item.conceptId,
    dimension: item.dimension,
    polarity: item.polarity,
    intensity: item.intensity,
    source: item.source,
    updatedRevision: item.updatedRevision,
    updatedAt: item.updatedAt,
  };
}

function normalizeExclusion(value, index, currentRevision, config) {
  const field = `vocationalProfile.exclusions[${index}]`;
  const record = safeRecord(value, field, [
    "targetKind", "targetId", "mode", "source", "updatedRevision", "updatedAt",
  ], "invalid_profile");
  requireExactKeys(record, [
    "targetKind", "targetId", "mode", "source", "updatedRevision", "updatedAt",
  ], "invalid_profile", field);
  const item = record.values;
  const targetIsValid = item.targetKind === "program"
    ? Object.hasOwn(config.relationIds, item.targetId)
    : config.conceptKinds[item.targetId] === item.targetKind;
  if (!CONCEPT_KINDS.has(item.targetKind) || !validId(item.targetId, item.targetKind) ||
      !targetIsValid || !EXCLUSION_MODES.has(item.mode) || !PROFILE_SOURCES.has(item.source) ||
      !Number.isSafeInteger(item.updatedRevision) || item.updatedRevision < 1 ||
      item.updatedRevision > currentRevision || !validIso(item.updatedAt)) {
    fail("invalid_profile", field, { index });
  }
  return {
    targetKind: item.targetKind,
    targetId: item.targetId,
    mode: item.mode,
    source: item.source,
    updatedRevision: item.updatedRevision,
    updatedAt: item.updatedAt,
  };
}

function preferRecent(existing, candidate) {
  if (!existing || candidate.updatedRevision > existing.updatedRevision) return candidate;
  if (candidate.updatedRevision < existing.updatedRevision) return existing;
  if (candidate.updatedAt > existing.updatedAt) return candidate;
  if (candidate.updatedAt < existing.updatedAt) return existing;
  const left = JSON.stringify(existing);
  const right = JSON.stringify(candidate);
  return ordinal(left, right) < 0 ? candidate : existing;
}

function normalizeProfile(value, currentRevisionValue, config) {
  const root = safeRecord(value, "vocationalProfile", ["version", "revision", "signals", "exclusions"], "invalid_profile");
  requireExactKeys(root, ["version", "revision", "signals", "exclusions"], "invalid_profile", "vocationalProfile");
  const profileRevision = root.values.revision;
  if (root.values.version !== 1 || !Number.isSafeInteger(profileRevision) || profileRevision < 0) {
    fail("invalid_profile", "vocationalProfile");
  }
  const currentRevision = currentRevisionValue === undefined ? profileRevision : currentRevisionValue;
  if (!Number.isSafeInteger(currentRevision) || currentRevision < 0 || currentRevision < profileRevision) {
    fail("invalid_current_revision", "currentRevision");
  }
  const rawSignals = safeArray(root.values.signals, "vocationalProfile.signals", MAX_SIGNALS, "invalid_profile");
  const rawExclusions = safeArray(root.values.exclusions, "vocationalProfile.exclusions", MAX_EXCLUSIONS, "invalid_profile");
  const signals = new Map();
  rawSignals.forEach((raw, index) => {
    const signal = normalizeSignal(raw, index, currentRevision, config);
    const key = `${signal.conceptKind}|${signal.conceptId}|${signal.dimension}`;
    signals.set(key, preferRecent(signals.get(key), signal));
  });
  const exclusions = new Map();
  rawExclusions.forEach((raw, index) => {
    const exclusion = normalizeExclusion(raw, index, currentRevision, config);
    const key = `${exclusion.targetKind}|${exclusion.targetId}|${exclusion.mode}`;
    exclusions.set(key, preferRecent(exclusions.get(key), exclusion));
  });
  return {
    version: 1,
    revision: profileRevision,
    signals: [...signals.values()].sort((left, right) => ordinal(
      `${left.conceptKind}|${left.conceptId}|${left.dimension}`,
      `${right.conceptKind}|${right.conceptId}|${right.dimension}`,
    )),
    exclusions: [...exclusions.values()].sort((left, right) => ordinal(
      `${left.targetKind}|${left.targetId}|${left.mode}`,
      `${right.targetKind}|${right.targetId}|${right.mode}`,
    )),
    currentRevision,
  };
}

function normalizeCandidate(value, index) {
  const field = `candidates[${index}]`;
  const record = safeRecord(value, field, [
    "canonicalProgramId", "source", "isExplicitCurrentRequest", "isExplicitCurrentSelection",
  ], "invalid_candidate");
  requireExactKeys(record, [
    "canonicalProgramId", "source", "isExplicitCurrentRequest", "isExplicitCurrentSelection",
  ], "invalid_candidate", field);
  const candidate = record.values;
  if (!validId(candidate.canonicalProgramId, "program")) fail("invalid_candidate", `${field}.canonicalProgramId`, { index });
  if (!CANDIDATE_SOURCE_SET.has(candidate.source)) fail("invalid_candidate_source", `${field}.source`, { index });
  if (typeof candidate.isExplicitCurrentRequest !== "boolean" ||
      typeof candidate.isExplicitCurrentSelection !== "boolean") {
    fail("invalid_candidate", field, { index });
  }
  const requestExpected = candidate.source === "explicit_user_request";
  const selectionExpected = candidate.source === "explicit_user_selection";
  if (candidate.isExplicitCurrentRequest !== requestExpected ||
      candidate.isExplicitCurrentSelection !== selectionExpected) {
    fail("invalid_candidate", field, { index });
  }
  return {
    canonicalProgramId: candidate.canonicalProgramId,
    source: candidate.source,
    isExplicitCurrentRequest: candidate.isExplicitCurrentRequest,
    isExplicitCurrentSelection: candidate.isExplicitCurrentSelection,
  };
}

function normalizeRankingInput(input, mode) {
  const config = DEFAULT_CONFIG;
  const candidateKey = mode === "single" ? "candidate" : "candidates";
  const allowed = ["vocationalProfile", candidateKey, "currentRevision"];
  const root = safeRecord(input, "input", allowed, "invalid_input");
  const required = ["vocationalProfile", candidateKey];
  if (required.some((key) => !root.keys.includes(key))) fail("invalid_input", "input");
  const profile = normalizeProfile(root.values.vocationalProfile, root.values.currentRevision, config);
  const candidates = mode === "single"
    ? [normalizeCandidate(root.values.candidate, 0)]
    : safeArray(root.values.candidates, "candidates", MAX_CANDIDATES, "invalid_input")
      .map((candidate, index) => normalizeCandidate(candidate, index));
  return { vocationalProfile: profile, candidates, currentRevision: profile.currentRevision, config };
}

export function validateRankingInput(input) {
  const normalized = normalizeRankingInput(input, "multiple");
  return {
    vocationalProfile: {
      version: normalized.vocationalProfile.version,
      revision: normalized.vocationalProfile.revision,
      signals: normalized.vocationalProfile.signals.map((signal) => ({ ...signal })),
      exclusions: normalized.vocationalProfile.exclusions.map((exclusion) => ({ ...exclusion })),
    },
    candidates: normalized.candidates.map((candidate) => ({ ...candidate })),
    currentRevision: normalized.currentRevision,
  };
}

function recencyFactor(distance) {
  if (distance <= 8) return 1;
  if (distance <= 20) return 0.85;
  if (distance <= 40) return 0.7;
  return 0.5;
}

function rounded(value) {
  const result = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(result, -0) ? 0 : result;
}

function reasonCodes(codes) {
  const unique = [...new Set(codes)];
  if (unique.some((code) => !ALLOWED_REASON_CODES.has(code)) || unique.length > MAX_REASON_CODES) {
    fail("invalid_input", "reasonCodes", { limit: MAX_REASON_CODES });
  }
  return unique.sort((left, right) => REASON_CODE_INDEX.get(left) - REASON_CODE_INDEX.get(right));
}

function gateResult(candidate, code) {
  return {
    canonicalProgramId: candidate.canonicalProgramId,
    classification: "rejected",
    score: 0,
    positiveEvidenceCount: 0,
    negativeEvidenceCount: 0,
    reasonCodes: [code],
    scoreBreakdown: [{ code, value: 0 }],
  };
}

function evaluateNormalized(profile, candidate, config) {
  const programId = candidate.canonicalProgramId;
  if (!Object.hasOwn(config.relationIds, programId)) return gateResult(candidate, "invalid_program");
  if (profile.exclusions.some((exclusion) =>
    exclusion.targetKind === "program" && exclusion.targetId === programId && exclusion.mode === "exact")) {
    return gateResult(candidate, "exact_exclusion");
  }

  const traits = config.programTraits[programId];
  if (!traits && !new Set([
    "explicit_user_request", "explicit_user_selection", "direct_canonical_mention", "search_continuation",
  ]).has(candidate.source)) {
    return gateResult(candidate, "unclassified_inferred_candidate");
  }

  const matched = traits
    ? profile.signals.filter((signal) => Object.hasOwn(traits, signal.conceptId))
    : [];
  const positiveSignals = matched.filter((signal) => signal.polarity === "positive");
  const negativeSignals = matched.filter((signal) => signal.polarity === "negative");
  if (candidate.source === "gemini_response" && positiveSignals.length === 0) {
    return gateResult(candidate, "gemini_only_candidate");
  }
  if (candidate.source === "same_family" && positiveSignals.length === 0) {
    return gateResult(candidate, "family_inference_disabled");
  }
  if (candidate.source === "documented_nearby" && positiveSignals.length === 0) {
    return gateResult(candidate, "nearby_inference_disabled");
  }

  const breakdown = [];
  const codes = [];
  let score = SOURCE_POINTS[candidate.source];
  if (score !== 0) {
    breakdown.push({ code: candidate.source, value: score });
    codes.push(candidate.source);
  }
  const recencyAdjustments = [];
  const traitAdjustments = [];
  for (const signal of [...positiveSignals, ...negativeSignals]) {
    const signalKey = `${signal.dimension}|${signal.polarity}`;
    const code = SIGNAL_REASON_CODES[signalKey];
    const base = SIGNAL_WEIGHTS[signalKey];
    if (!code || !Number.isFinite(base)) continue;
    const intensityAdjusted = base * INTENSITY_FACTORS[signal.intensity];
    const ageFactor = recencyFactor(profile.currentRevision - signal.updatedRevision);
    const ageAdjusted = intensityAdjusted * ageFactor;
    const traitFactor = traits[signal.conceptId] === 3 ? 0.75 : 1;
    const finalContribution = ageAdjusted * traitFactor;
    score += finalContribution;
    breakdown.push({ code, conceptId: signal.conceptId, value: rounded(intensityAdjusted) });
    codes.push(code);
    if (ageFactor !== 1) {
      recencyAdjustments.push({
        code: "stale_signal_discount",
        conceptId: signal.conceptId,
        value: rounded(ageAdjusted - intensityAdjusted),
      });
      codes.push("stale_signal_discount");
    }
    if (traitFactor !== 1) {
      traitAdjustments.push({
        code: "reduced_program_trait_weight",
        conceptId: signal.conceptId,
        value: rounded(finalContribution - ageAdjusted),
      });
      codes.push("reduced_program_trait_weight");
    }
  }
  breakdown.push(...recencyAdjustments, ...traitAdjustments);

  const unclampedScore = score;
  score = rounded(Math.min(SCORE_MAX, Math.max(SCORE_MIN, score)));
  if (score !== rounded(unclampedScore)) {
    breakdown.push({ code: "score_clamped", value: rounded(score - unclampedScore) });
    codes.push("score_clamped");
  }

  const positiveEvidenceCount = positiveSignals.length;
  const negativeEvidenceCount = negativeSignals.length;
  const explicit = candidate.isExplicitCurrentRequest || candidate.isExplicitCurrentSelection;
  let classification;
  if (explicit) {
    classification = "accepted";
    codes.push("accepted_explicit_choice");
    breakdown.push({ code: "accepted_explicit_choice", value: 0 });
  } else if (score >= 30 && positiveEvidenceCount >= 2) {
    classification = "accepted";
    codes.push("accepted_score_threshold");
    breakdown.push({ code: "accepted_score_threshold", value: 0 });
  } else if (score >= 12 && score < 30 && (positiveEvidenceCount >= 1 ||
      candidate.source === "direct_canonical_mention" || candidate.source === "search_continuation")) {
    classification = "confirmation_required";
    codes.push("confirmation_score_threshold");
    if (positiveEvidenceCount > 0) codes.push("moderate_positive_match");
    breakdown.push({ code: "confirmation_score_threshold", value: 0 });
  } else {
    classification = "rejected";
    if (score >= 30 || positiveEvidenceCount === 0) codes.push("insufficient_evidence");
    if (score >= 30) {
      breakdown.push({ code: "insufficient_evidence", value: 0 });
    } else {
      codes.push("rejected_score_threshold");
      breakdown.push({ code: "rejected_score_threshold", value: 0 });
    }
  }
  if (breakdown.length > MAX_BREAKDOWN) fail("invalid_input", "scoreBreakdown", { limit: MAX_BREAKDOWN });
  return {
    canonicalProgramId: programId,
    classification,
    score,
    positiveEvidenceCount,
    negativeEvidenceCount,
    reasonCodes: reasonCodes(codes),
    scoreBreakdown: breakdown,
  };
}

function dedupeCandidates(candidates) {
  const deduplicated = new Map();
  for (const candidate of candidates) {
    const existing = deduplicated.get(candidate.canonicalProgramId);
    if (!existing) {
      deduplicated.set(candidate.canonicalProgramId, { ...candidate });
      continue;
    }
    const preferred = SOURCE_PRIORITY_INDEX.get(candidate.source) < SOURCE_PRIORITY_INDEX.get(existing.source)
      ? candidate
      : existing;
    deduplicated.set(candidate.canonicalProgramId, {
      canonicalProgramId: candidate.canonicalProgramId,
      source: preferred.source,
      isExplicitCurrentRequest: existing.isExplicitCurrentRequest || candidate.isExplicitCurrentRequest,
      isExplicitCurrentSelection: existing.isExplicitCurrentSelection || candidate.isExplicitCurrentSelection,
    });
  }
  return [...deduplicated.values()];
}

function compareResults(left, right, sourceByProgram) {
  return CLASSIFICATION_PRIORITY[left.classification] - CLASSIFICATION_PRIORITY[right.classification] ||
    right.score - left.score ||
    right.positiveEvidenceCount - left.positiveEvidenceCount ||
    left.negativeEvidenceCount - right.negativeEvidenceCount ||
    SOURCE_PRIORITY_INDEX.get(sourceByProgram.get(left.canonicalProgramId)) -
      SOURCE_PRIORITY_INDEX.get(sourceByProgram.get(right.canonicalProgramId)) ||
    ordinal(left.canonicalProgramId, right.canonicalProgramId);
}

export function evaluateVocationalCandidate(input) {
  const normalized = normalizeRankingInput(input, "single");
  return evaluateNormalized(normalized.vocationalProfile, normalized.candidates[0], normalized.config);
}

function copyResult(result) {
  return {
    canonicalProgramId: result.canonicalProgramId,
    classification: result.classification,
    score: result.score,
    positiveEvidenceCount: result.positiveEvidenceCount,
    negativeEvidenceCount: result.negativeEvidenceCount,
    reasonCodes: [...result.reasonCodes],
    scoreBreakdown: result.scoreBreakdown.map((entry) => ({ ...entry })),
  };
}

export function rankVocationalCandidates(input) {
  const normalized = normalizeRankingInput(input, "multiple");
  const candidates = dedupeCandidates(normalized.candidates);
  const sourceByProgram = new Map(candidates.map((candidate) => [candidate.canonicalProgramId, candidate.source]));
  const ordered = candidates
    .map((candidate) => evaluateNormalized(normalized.vocationalProfile, candidate, normalized.config))
    .sort((left, right) => compareResults(left, right, sourceByProgram));
  return {
    accepted: ordered.filter((result) => result.classification === "accepted").map(copyResult),
    confirmationRequired: ordered
      .filter((result) => result.classification === "confirmation_required")
      .map(copyResult),
    rejected: ordered.filter((result) => result.classification === "rejected").map(copyResult),
    ordered: ordered.map(copyResult),
  };
}

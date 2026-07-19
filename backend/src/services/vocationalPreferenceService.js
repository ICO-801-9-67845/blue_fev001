import { readFileSync } from "node:fs";

const PROFILE_VERSION = 1;
const MAX_SIGNALS = 128;
const MAX_EXCLUSIONS = 64;
const MAX_EXTRACTED_UPDATES = 12;
const MAX_TEXT_CHARACTERS = 2000;
const MAX_CLAUSES = 12;
const MAX_SIMPLE_TOKENS = 256;
const MAX_CONCEPT_ID = 64;
const MAX_PROGRAM_ID = 100;
const MAX_PROFILE_BYTES = 32768;
const MAX_ISO_LENGTH = 32;
const EXPECTED_LEXICON_CONCEPTS = 12;

const CONCEPT_KINDS = new Set([
  "subject", "activity", "program", "environment", "interaction", "modality", "level",
]);
const DIMENSIONS = new Set(["interest", "ability", "preference", "restriction"]);
const POLARITIES = new Set(["positive", "negative"]);
const SOURCES = new Set(["explicit_statement", "explicit_correction", "explicit_comparison"]);
const EXCLUSION_MODES = new Set(["exact", "requirement"]);
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isPlainDataObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function ownData(value, key) {
  if (!isPlainDataObject(value) || DANGEROUS_KEYS.has(key)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function ownKeysAreSafe(value) {
  if (!isPlainDataObject(value)) return false;
  try {
    return Reflect.ownKeys(value).every((key) =>
      typeof key === "string" && !DANGEROUS_KEYS.has(key));
  } catch {
    return false;
  }
}

function dataArrayValues(value, maximumLength) {
  if (!Array.isArray(value)) return null;
  try {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor?.value;
    if (!Number.isInteger(length) || length < 0 || length > maximumLength) return null;
    const keysAreSafe = Reflect.ownKeys(value).every((key) => {
      if (key === "length") return true;
      if (typeof key !== "string" || DANGEROUS_KEYS.has(key)) return false;
      return /^(?:0|[1-9]\d*)$/.test(key) && Number(key) < length;
    });
    if (!keysAreSafe) return null;
    return Array.from({ length }, (_unused, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
    });
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function validId(value, kind) {
  const limit = kind === "program" ? MAX_PROGRAM_ID : MAX_CONCEPT_ID;
  return typeof value === "string" && value.length > 0 && value.length <= limit &&
    /^[a-z0-9][a-z0-9_-]*$/.test(value) && !DANGEROUS_KEYS.has(value);
}

function validIso(value) {
  if (typeof value !== "string" || value.length > MAX_ISO_LENGTH ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value;
}

function normalizeSignal(value) {
  if (!ownKeysAreSafe(value)) return null;
  const conceptKind = ownData(value, "conceptKind");
  const conceptId = ownData(value, "conceptId");
  const dimension = ownData(value, "dimension");
  const polarity = ownData(value, "polarity");
  const intensity = ownData(value, "intensity");
  const source = ownData(value, "source");
  const updatedRevision = ownData(value, "updatedRevision");
  const updatedAt = ownData(value, "updatedAt");
  if (!CONCEPT_KINDS.has(conceptKind) || !validId(conceptId, conceptKind) ||
      !DIMENSIONS.has(dimension) || !POLARITIES.has(polarity) ||
      (dimension === "restriction" && polarity !== "negative") ||
      !Number.isInteger(intensity) || intensity < 1 || intensity > 5 ||
      !SOURCES.has(source) || !Number.isInteger(updatedRevision) || updatedRevision < 1 ||
      !validIso(updatedAt)) return null;
  return { conceptKind, conceptId, dimension, polarity, intensity, source, updatedRevision, updatedAt };
}

function normalizeExclusion(value) {
  if (!ownKeysAreSafe(value)) return null;
  const targetKind = ownData(value, "targetKind");
  const targetId = ownData(value, "targetId");
  const mode = ownData(value, "mode");
  const source = ownData(value, "source");
  const updatedRevision = ownData(value, "updatedRevision");
  const updatedAt = ownData(value, "updatedAt");
  if (!CONCEPT_KINDS.has(targetKind) || !validId(targetId, targetKind) ||
      !EXCLUSION_MODES.has(mode) || !SOURCES.has(source) ||
      !Number.isInteger(updatedRevision) || updatedRevision < 1 || !validIso(updatedAt)) return null;
  return { targetKind, targetId, mode, source, updatedRevision, updatedAt };
}

const signalKey = (item) => `${item.conceptKind}|${item.conceptId}|${item.dimension}`;
const exclusionKey = (item) => `${item.targetKind}|${item.targetId}|${item.mode}`;

function preferRecent(existing, candidate) {
  if (!existing || candidate.updatedRevision > existing.updatedRevision) return candidate;
  if (candidate.updatedRevision < existing.updatedRevision) return existing;
  if (candidate.updatedAt > existing.updatedAt) return candidate;
  if (candidate.updatedAt < existing.updatedAt) return existing;
  return JSON.stringify(candidate) > JSON.stringify(existing) ? candidate : existing;
}

function sortProfile(profile) {
  profile.signals.sort((left, right) => signalKey(left).localeCompare(signalKey(right)));
  profile.exclusions.sort((left, right) => exclusionKey(left).localeCompare(exclusionKey(right)));
  return profile;
}

function profileFits(profile) {
  return profile.signals.length <= MAX_SIGNALS && profile.exclusions.length <= MAX_EXCLUSIONS &&
    Buffer.byteLength(JSON.stringify(profile), "utf8") <= MAX_PROFILE_BYTES;
}

export function getDefaultVocationalProfile() {
  return { version: PROFILE_VERSION, revision: 0, signals: [], exclusions: [] };
}

export function normalizeVocationalProfile(value) {
  if (!ownKeysAreSafe(value)) return getDefaultVocationalProfile();
  const revision = ownData(value, "revision");
  const signalsValue = dataArrayValues(ownData(value, "signals"), MAX_SIGNALS);
  const exclusionsValue = dataArrayValues(ownData(value, "exclusions"), MAX_EXCLUSIONS);
  if (ownData(value, "version") !== PROFILE_VERSION || !Number.isInteger(revision) || revision < 0 ||
      !signalsValue || !exclusionsValue) return getDefaultVocationalProfile();

  const signals = new Map();
  for (const raw of signalsValue) {
    const item = normalizeSignal(raw);
    if (item) signals.set(signalKey(item), preferRecent(signals.get(signalKey(item)), item));
  }
  const exclusions = new Map();
  for (const raw of exclusionsValue) {
    const item = normalizeExclusion(raw);
    if (item) exclusions.set(exclusionKey(item), preferRecent(exclusions.get(exclusionKey(item)), item));
  }
  const normalized = sortProfile({
    version: PROFILE_VERSION,
    revision,
    signals: [...signals.values()],
    exclusions: [...exclusions.values()],
  });
  return profileFits(normalized) ? normalized : getDefaultVocationalProfile();
}

function loadLexicon() {
  const raw = readFileSync(new URL("../config/vocationalConceptLexicon.json", import.meta.url), "utf8")
    .replace(/^\uFEFF/, "");
  const value = JSON.parse(raw);
  const rawConcepts = dataArrayValues(ownData(value, "concepts"), EXPECTED_LEXICON_CONCEPTS);
  if (!ownKeysAreSafe(value) || ownData(value, "version") !== 1 ||
      !rawConcepts || rawConcepts.length !== EXPECTED_LEXICON_CONCEPTS) {
    throw new Error("Invalid vocational concept lexicon");
  }
  const ids = new Set();
  const aliases = new Set();
  const concepts = [];
  for (const rawConcept of rawConcepts) {
    if (!ownKeysAreSafe(rawConcept)) throw new Error("Invalid vocational concept");
    const id = ownData(rawConcept, "id");
    const kind = ownData(rawConcept, "kind");
    const rawAliases = dataArrayValues(ownData(rawConcept, "aliases"), 128);
    if (!CONCEPT_KINDS.has(kind) || kind === "program" || !validId(id, kind) || ids.has(id) ||
        !rawAliases || rawAliases.length === 0) throw new Error("Invalid vocational concept");
    ids.add(id);
    const normalizedAliases = rawAliases.map((alias) => {
      if (typeof alias !== "string" || !alias.trim()) throw new Error("Invalid vocational alias");
      const normalized = normalizeText(alias);
      if (!normalized || aliases.has(normalized)) throw new Error("Duplicate vocational alias");
      aliases.add(normalized);
      return normalized;
    });
    concepts.push({ id, kind, aliases: normalizedAliases.sort((a, b) => b.length - a.length) });
  }
  return concepts;
}

const CONCEPTS = loadLexicon();

function containsAlias(text, alias) {
  return new RegExp(`(?:^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`).test(text);
}

function conceptsIn(text) {
  return CONCEPTS.filter((concept) => concept.aliases.some((alias) => containsAlias(text, alias)));
}

function normalizeCanonicalMentions(value) {
  const candidates = dataArrayValues(value, 3);
  if (!candidates) return [];
  const result = [];
  for (const candidate of candidates) {
    if (!ownKeysAreSafe(candidate)) continue;
    const canonicalProgramId = ownData(candidate, "canonicalProgramId");
    if (!validId(canonicalProgramId, "program")) continue;
    const names = ["name", "normalizedName", "matchedAlias"].map((key) => ownData(candidate, key));
    const exactAliases = dataArrayValues(ownData(candidate, "exactAliases"), 128);
    if (exactAliases) names.push(...exactAliases);
    const aliases = names.filter((name) => typeof name === "string" && name.trim())
      .map(normalizeText).filter(Boolean);
    if (aliases.length) result.push({ id: canonicalProgramId, aliases: [...new Set(aliases)] });
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

function programsIn(text, mentions) {
  return mentions.filter((mention) => mention.aliases.some((alias) => containsAlias(text, alias)));
}

function resultWith(reason, extra = {}) {
  return {
    updates: [], exclusionsToAdd: [], exclusionsToLift: [], neutralMentions: [],
    removeSignals: [], ambiguous: false, reason, ...extra,
  };
}

function addUpdate(result, concept, dimension, polarity, intensity, source = "explicit_statement") {
  result.updates.push({
    conceptKind: concept.kind, conceptId: concept.id, dimension, polarity, intensity, source,
  });
}

function intensityFor(text, normal, { soft = 2, strong = 5 } = {}) {
  if (containsAlias(text, "un poco")) return soft;
  if (containsAlias(text, "mucho")) return strong;
  return normal;
}

function dedupeOperations(result) {
  const unique = (items, key) => [...new Map(items.map((item) => [key(item), item])).values()];
  result.updates = unique(result.updates, (item) => signalKey(item));
  result.exclusionsToAdd = unique(result.exclusionsToAdd, (item) => exclusionKey(item));
  result.exclusionsToLift = unique(result.exclusionsToLift, (item) => exclusionKey(item));
  result.removeSignals = unique(result.removeSignals, (item) => signalKey(item));
  const count = result.updates.length + result.exclusionsToAdd.length +
    result.exclusionsToLift.length + result.removeSignals.length;
  return count <= MAX_EXTRACTED_UPDATES;
}

export function extractExplicitVocationalUpdates(input) {
  if (!ownKeysAreSafe(input) || typeof ownData(input, "text") !== "string") {
    return resultWith("invalid_input");
  }
  const text = ownData(input, "text");
  const characters = [...text];
  if (characters.length > MAX_TEXT_CHARACTERS) return resultWith("input_limit_reached");
  const normalized = normalizeText(text);
  if (!normalized) return resultWith("no_explicit_updates");
  const clauses = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .split(/[.!?;:\n]+|\bpero\b|\baunque\b/).map(normalizeText).filter(Boolean);
  const tokens = normalized.split(" ").filter(Boolean);
  if (clauses.length > MAX_CLAUSES || tokens.length > MAX_SIMPLE_TOKENS) {
    return resultWith("input_limit_reached");
  }

  const result = resultWith("no_explicit_updates");
  const mentions = normalizeCanonicalMentions(ownData(input, "canonicalMentions"));
  const handledConcepts = new Set();

  const contrastedInterest = /\b(?:me gusta(?:n)?|disfruto|me interesa(?:n)?)\s+(.+?)\s+(?:pero|aunque)\s+no\s+(.+)$/.exec(normalized);
  if (contrastedInterest) {
    const positiveConcepts = conceptsIn(contrastedInterest[1]);
    const negativeConcepts = conceptsIn(contrastedInterest[2]);
    if (positiveConcepts.length > 0 && negativeConcepts.length > 0) {
      for (const concept of positiveConcepts) {
        addUpdate(result, concept, "interest", "positive", 4);
        handledConcepts.add(`${concept.kind}|${concept.id}`);
      }
      for (const concept of negativeConcepts) {
        addUpdate(result, concept, "interest", "negative", 4);
        handledConcepts.add(`${concept.kind}|${concept.id}`);
      }
    } else {
      result.ambiguous = true;
    }
  }

  const beforeCorrection = /^antes me gust(?:aba|aban)\s+(.+?)\s+(?:pero\s+)?ya no$/.exec(normalized);
  if (beforeCorrection) {
    for (const concept of conceptsIn(beforeCorrection[1])) {
      addUpdate(result, concept, "interest", "negative", 4, "explicit_correction");
      handledConcepts.add(`${concept.kind}|${concept.id}`);
    }
  }

  if (/^no dije que quisiera\b/.test(normalized)) {
    const matched = programsIn(normalized, mentions);
    if (matched.length === 1) {
      addUpdate(result, { kind: "program", id: matched[0].id }, "interest", "negative", 4, "explicit_correction");
    } else {
      result.ambiguous = true;
    }
  }

  if (/^pensandolo bien\s+si quiero\b/.test(normalized)) {
    const matched = programsIn(normalized, mentions);
    if (matched.length === 1) {
      const program = { kind: "program", id: matched[0].id };
      addUpdate(result, program, "interest", "positive", 4, "explicit_correction");
      result.exclusionsToLift.push({ targetKind: "program", targetId: program.id, mode: "exact" });
    } else {
      result.ambiguous = true;
    }
  }

  const exactExclusionPattern = /\b(?:no quiero estudiar|no me sugieras|ya no quiero)\b/;
  if (exactExclusionPattern.test(normalized)) {
    const matched = programsIn(normalized, mentions);
    if (matched.length === 1) {
      result.exclusionsToAdd.push({
        targetKind: "program", targetId: matched[0].id, mode: "exact",
        source: normalized.includes("ya no quiero") ? "explicit_correction" : "explicit_statement",
      });
      if (normalized.includes("ya no quiero")) {
        for (const dimension of ["interest", "preference"]) {
          result.removeSignals.push({ conceptKind: "program", conceptId: matched[0].id, dimension, polarity: "positive" });
        }
      }
    } else {
      result.ambiguous = true;
    }
  }

  const requirementMatch = /\bno quiero carreras con\s+(.+)$/.exec(normalized);
  if (requirementMatch) {
    const matched = conceptsIn(requirementMatch[1]);
    if (matched.length === 1) {
      result.exclusionsToAdd.push({
        targetKind: matched[0].kind, targetId: matched[0].id, mode: "requirement",
        source: "explicit_statement",
      });
    } else {
      result.ambiguous = true;
    }
  }

  const comparison = /\bprefiero\s+(.+?)\s+no\s+(.+)$/.exec(normalized);
  if (comparison) {
    const preferred = conceptsIn(comparison[1]);
    const rejected = conceptsIn(comparison[2]);
    if (preferred.length === 1 && rejected.length === 1) {
      addUpdate(result, preferred[0], "preference", "positive", 4, "explicit_comparison");
      addUpdate(result, rejected[0], "preference", "negative", 4, "explicit_comparison");
      handledConcepts.add(`${preferred[0].kind}|${preferred[0].id}`);
      handledConcepts.add(`${rejected[0].kind}|${rejected[0].id}`);
    } else {
      result.ambiguous = true;
    }
  }

  let previousClauseConcepts = [];
  for (const clause of clauses) {
    let clauseConcepts = conceptsIn(clause);
    if (!clauseConcepts.length && previousClauseConcepts.length === 1 &&
        /\b(?:si me interesa(?:n)?|no me gusta(?:n)?|no me interesa(?:n)?)\b/.test(clause)) {
      clauseConcepts = previousClauseConcepts;
    }
    if (!clauseConcepts.length) continue;
    const restriction = /\b(?:no me gusta|no me interesa|prefiero no)\s+trabajar\s+(?:con|en)\b/.test(clause);
    const difficulty = /\b(?:no soy (?:nada )?buen[oa] (?:en|para)|se me dificulta(?:n)?|me cuesta(?:n)?)\b/.test(clause);
    const strength = !difficulty && /\b(?:soy buen[oa](?: (?:en|para))?|se me facilita(?:n)?)\b/.test(clause);
    const rejection = !restriction && /\b(?:ya no me gusta(?:n)?|no me gusta(?:n)?|no me interesa(?:n)?)\b/.test(clause);
    const interest = !rejection && /\b(?:me gusta(?:n)?|disfruto|(?:si )?me interesa(?:n)?)\b/.test(clause);
    for (const concept of clauseConcepts) {
      if (handledConcepts.has(`${concept.kind}|${concept.id}`)) continue;
      if (restriction) {
        addUpdate(result, concept, "restriction", "negative", 4);
      } else if (difficulty) {
        const intensity = /\bnada bueno\b/.test(clause) ? 5 : intensityFor(clause, 3, { soft: 2, strong: 4 });
        addUpdate(result, concept, "ability", "negative", intensity);
      } else if (strength) {
        addUpdate(result, concept, "ability", "positive", 4);
      } else if (rejection || /^ya no me gusta(?:n)?\b/.test(clause)) {
        const intensity = /\b(?:nada|en absoluto)\b/.test(clause) ? 5 :
          /\bno me gusta(?:n)? mucho\b/.test(clause) ? 3 : 4;
        addUpdate(result, concept, "interest", "negative", intensity,
          /^ya no\b/.test(clause) ? "explicit_correction" : "explicit_statement");
      } else if (interest) {
        addUpdate(result, concept, "interest", "positive", intensityFor(clause, 4));
      }
    }
    previousClauseConcepts = clauseConcepts;
  }

  const mentionedConcepts = conceptsIn(normalized);
  result.neutralMentions = mentionedConcepts.filter((concept) =>
    !result.updates.some((update) => update.conceptKind === concept.kind && update.conceptId === concept.id))
    .map((concept) => ({ conceptKind: concept.kind, conceptId: concept.id }));

  if (!dedupeOperations(result)) return resultWith("input_limit_reached");
  const operationCount = result.updates.length + result.exclusionsToAdd.length +
    result.exclusionsToLift.length + result.removeSignals.length;
  if (result.ambiguous && operationCount === 0) result.reason = "ambiguous_statement";
  else if (operationCount > 0) result.reason = "explicit_updates_found";
  else if (result.neutralMentions.length > 0 || programsIn(normalized, mentions).length > 0) {
    result.reason = "neutral_mentions_only";
  }
  return result;
}

function validateRawSignal(value) {
  if (!ownKeysAreSafe(value)) return null;
  const conceptKind = ownData(value, "conceptKind");
  const conceptId = ownData(value, "conceptId");
  const dimension = ownData(value, "dimension");
  const polarity = ownData(value, "polarity");
  const intensity = ownData(value, "intensity");
  const source = ownData(value, "source");
  if (!CONCEPT_KINDS.has(conceptKind) || !validId(conceptId, conceptKind) ||
      !DIMENSIONS.has(dimension) || !POLARITIES.has(polarity) ||
      (dimension === "restriction" && polarity !== "negative") ||
      !Number.isInteger(intensity) || intensity < 1 || intensity > 5 || !SOURCES.has(source)) return null;
  return { conceptKind, conceptId, dimension, polarity, intensity, source };
}

function validateRawExclusion(value, requireSource) {
  if (!ownKeysAreSafe(value)) return null;
  const targetKind = ownData(value, "targetKind");
  const targetId = ownData(value, "targetId");
  const mode = ownData(value, "mode");
  const source = ownData(value, "source");
  if (!CONCEPT_KINDS.has(targetKind) || !validId(targetId, targetKind) || !EXCLUSION_MODES.has(mode) ||
      (requireSource && !SOURCES.has(source))) return null;
  return requireSource ? { targetKind, targetId, mode, source } : { targetKind, targetId, mode };
}

export function applyVocationalUpdates(profile, operations, metadata) {
  const previous = normalizeVocationalProfile(profile);
  if (!ownKeysAreSafe(operations)) {
    return { profile: previous, changed: false, reason: "invalid_profile_update", rejected: true };
  }
  const updates = dataArrayValues(ownData(operations, "updates") ?? [], MAX_EXTRACTED_UPDATES);
  const additions = dataArrayValues(ownData(operations, "exclusionsToAdd") ?? [], MAX_EXTRACTED_UPDATES);
  const lifts = dataArrayValues(ownData(operations, "exclusionsToLift") ?? [], MAX_EXTRACTED_UPDATES);
  const removals = dataArrayValues(ownData(operations, "removeSignals") ?? [], MAX_EXTRACTED_UPDATES);
  if ([updates, additions, lifts, removals].some((items) => !items)) {
    return { profile: previous, changed: false, reason: "invalid_profile_update", rejected: true };
  }
  const count = updates.length + additions.length + lifts.length + removals.length;
  if (count === 0) return { profile: previous, changed: false, reason: "no_profile_change", rejected: false };
  if (count > MAX_EXTRACTED_UPDATES || !ownKeysAreSafe(metadata)) {
    return { profile: previous, changed: false, reason: "invalid_profile_update", rejected: true };
  }
  const nextRevision = ownData(metadata, "nextRevision");
  const observedAt = ownData(metadata, "observedAt");
  if (!Number.isInteger(nextRevision) || nextRevision !== previous.revision + 1 || !validIso(observedAt)) {
    return { profile: previous, changed: false, reason: "invalid_profile_update", rejected: true };
  }
  const validUpdates = updates.map(validateRawSignal);
  const validAdditions = additions.map((item) => validateRawExclusion(item, true));
  const validLifts = lifts.map((item) => validateRawExclusion(item, false));
  const validRemovals = removals.map((item) => {
    if (!ownKeysAreSafe(item)) return null;
    const conceptKind = ownData(item, "conceptKind");
    const conceptId = ownData(item, "conceptId");
    const dimension = ownData(item, "dimension");
    const polarity = ownData(item, "polarity");
    return CONCEPT_KINDS.has(conceptKind) && validId(conceptId, conceptKind) &&
      DIMENSIONS.has(dimension) && POLARITIES.has(polarity)
      ? { conceptKind, conceptId, dimension, polarity } : null;
  });
  if ([...validUpdates, ...validAdditions, ...validLifts, ...validRemovals].some((item) => !item)) {
    return { profile: previous, changed: false, reason: "invalid_profile_update", rejected: true };
  }

  const signals = new Map(previous.signals.map((item) => [signalKey(item), item]));
  const exclusions = new Map(previous.exclusions.map((item) => [exclusionKey(item), item]));
  let semanticChanged = false;
  for (const item of validRemovals) {
    const existing = signals.get(signalKey(item));
    if (existing?.polarity === item.polarity) {
      signals.delete(signalKey(item));
      semanticChanged = true;
    }
  }
  for (const item of validUpdates) {
    const existing = signals.get(signalKey(item));
    if (existing && existing.polarity === item.polarity && existing.intensity === item.intensity &&
        existing.source === item.source) continue;
    signals.set(signalKey(item), { ...item, updatedRevision: nextRevision, updatedAt: observedAt });
    semanticChanged = true;
  }
  for (const item of validLifts) {
    if (exclusions.delete(exclusionKey(item))) semanticChanged = true;
  }
  for (const item of validAdditions) {
    const existing = exclusions.get(exclusionKey(item));
    if (existing?.source === item.source) continue;
    exclusions.set(exclusionKey(item), { ...item, updatedRevision: nextRevision, updatedAt: observedAt });
    semanticChanged = true;
  }
  if (!semanticChanged) {
    return { profile: previous, changed: false, reason: "no_profile_change", rejected: false };
  }
  const candidate = sortProfile({
    version: PROFILE_VERSION, revision: nextRevision,
    signals: [...signals.values()], exclusions: [...exclusions.values()],
  });
  const withoutRevision = { ...candidate, revision: previous.revision };
  if (profilesEqual(previous, withoutRevision)) {
    return { profile: previous, changed: false, reason: "no_profile_change", rejected: false };
  }
  if (!profileFits(candidate)) {
    return { profile: previous, changed: false, reason: "profile_capacity_exceeded", rejected: true };
  }
  return { profile: candidate, changed: true, reason: "profile_updated", rejected: false };
}

export function profilesEqual(left, right) {
  return JSON.stringify(normalizeVocationalProfile(left)) === JSON.stringify(normalizeVocationalProfile(right));
}

import { getEducativeProgramRelations } from "./educativeProgramRelationsService.js";

export const VOCATIONAL_CAREER_MATCH_STATUSES = Object.freeze([
  "exact",
  "approved_alias",
  "normalized_exact",
  "fuzzy_confirmation_required",
  "ambiguous",
  "no_match",
  "invalid_input",
]);

export const VOCATIONAL_CAREER_MATCH_LIMITS = Object.freeze({
  maximumInputLength: 120,
  maximumTokens: 12,
  maximumPrograms: 512,
  maximumAliasesPerProgram: 64,
  maximumComparisons: 128,
});

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const ACTION_TEXTS = new Set([
  "mostrar mas carreras", "ver mas carreras", "mas carreras", "otras carreras",
  "mas escuelas", "mostrar mas escuelas", "ver mas escuelas", "mas opciones",
]);
const LEVELS = new Set([
  "bachillerato", "tecnico_bachillerato", "tsu", "licenciatura", "ingenieria",
  "especialidad", "maestria", "doctorado",
]);
const REQUEST_PREFIXES = [
  /^(?:quiero|quisiera|deseo|busco|planeo) (?:estudiar|cursar|explorar|conocer) /,
  /^(?:me interesa|me interesaria) (?:estudiar|cursar) /,
  /^(?:donde|como) (?:puedo )?(?:estudiar|cursar) /,
  /^(?:cuentame|dime|informame) (?:algo )?(?:sobre|de) /,
  /^(?:quiero ver|muestrame|dame|busco) (?:escuelas|universidades|instituciones|opciones) (?:de|para) /,
  /^(?:carrera|licenciatura|ingenieria) (?:de|en) /,
];

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function dataRecord(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(code);
  }
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  const output = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (typeof key !== "string" || DANGEROUS_KEYS.has(key) ||
        !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
      fail(code);
    }
    output[key] = descriptor.value;
  }
  return output;
}

function dataArray(value, maximum, code) {
  if (!Array.isArray(value) || value.length > maximum || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(code);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) =>
    typeof key !== "string" ||
    (key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key))
  )) fail(code);
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) fail(code);
    return descriptor.value;
  });
}

function boundedString(value, maximum, code) {
  if (typeof value !== "string" || !value || value.length > maximum) fail(code);
  return value;
}

function strictText(value) {
  return value.normalize("NFKC").toLowerCase().trim();
}

export function normalizeVocationalCareerInput(value) {
  if (typeof value !== "string") fail("invalid_match_input");
  const nfkc = value.normalize("NFKC");
  if (!nfkc || nfkc.length > VOCATIONAL_CAREER_MATCH_LIMITS.maximumInputLength) {
    fail("invalid_match_input_length");
  }
  if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(nfkc)) fail("invalid_match_input_characters");
  if (/[^\p{Script=Latin}\p{Mark}\p{Number}\s'’\-.,()/&+]/u.test(nfkc)) {
    fail("invalid_match_input_characters");
  }
  const normalized = nfkc
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[.,()/&+’'\-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) fail("invalid_match_input");
  if (normalized.split(" ").length > VOCATIONAL_CAREER_MATCH_LIMITS.maximumTokens) {
    fail("invalid_match_input_tokens");
  }
  return normalized;
}

function normalizeCatalogText(value) {
  const nfkc = boundedString(value, 200, "invalid_match_catalog").normalize("NFKC");
  if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(nfkc) ||
      /[^\p{Script=Latin}\p{Mark}\p{Number}\s'’\-.,()/&+]/u.test(nfkc)) {
    fail("invalid_match_catalog");
  }
  return nfkc
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[.,()/&+’'\-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function addIndexEntry(index, key, entry) {
  const current = index.get(key) || [];
  if (!current.some((item) => item.programId === entry.programId)) current.push(entry);
  current.sort((left, right) => compareCodeUnits(left.programId, right.programId));
  index.set(key, current);
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function copyProgram(programId, value) {
  const program = dataRecord(value, "invalid_match_catalog");
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(programId) || programId.length > 100) {
    fail("invalid_match_catalog");
  }
  const canonicalName = boundedString(program.canonicalName, 200, "invalid_match_catalog");
  const displayName = boundedString(program.displayName || program.canonicalName, 200, "invalid_match_catalog");
  const level = boundedString(program.level, 40, "invalid_match_catalog");
  if (!LEVELS.has(level)) fail("invalid_match_catalog");
  const exactAliases = dataArray(
    program.exactAliases || [],
    VOCATIONAL_CAREER_MATCH_LIMITS.maximumAliasesPerProgram,
    "invalid_match_catalog",
  ).map((alias) => boundedString(alias, 200, "invalid_match_catalog"));
  const inputAliases = dataArray(
    program.inputAliases || [],
    VOCATIONAL_CAREER_MATCH_LIMITS.maximumAliasesPerProgram,
    "invalid_match_catalog",
  ).map((alias) => boundedString(alias, 200, "invalid_match_catalog"));
  return Object.freeze({
    programId,
    canonicalName,
    displayName,
    level,
    exactAliases: Object.freeze([...exactAliases]),
    inputAliases: Object.freeze([...inputAliases]),
  });
}

function filtered(entries, academicLevel, allowedProgramIds) {
  return entries.filter((entry) =>
    (!academicLevel || entry.level === academicLevel) &&
    (!allowedProgramIds || allowedProgramIds.has(entry.programId))
  );
}

function result(status, values = {}) {
  return Object.freeze({
    status,
    programId: null,
    matchMethod: null,
    confidenceBand: null,
    alternativesCount: 0,
    reasonCode: null,
    ...values,
  });
}

function exactResult(entries, status, method) {
  if (entries.length === 1) {
    return result(status, {
      programId: entries[0].programId,
      matchMethod: method,
      confidenceBand: "exact",
      alternativesCount: 1,
    });
  }
  return result("ambiguous", {
    alternativesCount: Math.min(entries.length, 3),
    reasonCode: "multiple_exact_programs",
  });
}

function thresholds(length) {
  if (length <= 4) return null;
  if (length === 5) return { maximumDistance: 1, minimumSimilarity: 0.88, minimumMargin: 0.12 };
  if (length <= 11) return { maximumDistance: 1, minimumSimilarity: 0.84, minimumMargin: 0.12 };
  if (length <= 23) return { maximumDistance: 2, minimumSimilarity: 0.86, minimumMargin: 0.10 };
  return { maximumDistance: 3, minimumSimilarity: 0.90, minimumMargin: 0.08 };
}

function damerauLevenshtein(left, right, maximumDistance) {
  if (Math.abs(left.length - right.length) > maximumDistance) return maximumDistance + 1;
  let previousPrevious = null;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] +
        (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      let distance = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        substitution,
      );
      if (
        previousPrevious && leftIndex > 1 && rightIndex > 1 &&
        left[leftIndex - 1] === right[rightIndex - 2] &&
        left[leftIndex - 2] === right[rightIndex - 1]
      ) {
        distance = Math.min(distance, previousPrevious[rightIndex - 2] + 1);
      }
      current.push(distance);
      rowMinimum = Math.min(rowMinimum, distance);
    }
    if (rowMinimum > maximumDistance) return maximumDistance + 1;
    previousPrevious = previous;
    previous = current;
  }
  return previous[right.length];
}

function bigrams(value) {
  const output = new Set();
  for (let index = 0; index < value.length - 1; index += 1) output.add(value.slice(index, index + 2));
  return output;
}

function sharesBigram(leftBigrams, right) {
  for (let index = 0; index < right.length - 1; index += 1) {
    if (leftBigrams.has(right.slice(index, index + 2))) return true;
  }
  return false;
}

function queryFromUserText(normalized) {
  if (ACTION_TEXTS.has(normalized) || /^\d+$/u.test(normalized)) return null;
  if (/^(?:universidad|instituto|escuela|plantel|colegio)\b/u.test(normalized)) return null;
  let query = normalized;
  for (const prefix of REQUEST_PREFIXES) {
    if (prefix.test(query)) {
      query = query.replace(prefix, "").trim();
      break;
    }
  }
  return query || null;
}

function safeAllowedIds(value, knownIds) {
  if (value === undefined || value === null) return null;
  const ids = dataArray(value, VOCATIONAL_CAREER_MATCH_LIMITS.maximumPrograms, "invalid_match_options")
    .map((id) => boundedString(id, 100, "invalid_match_options"));
  if (ids.some((id) => !knownIds.has(id))) fail("invalid_match_options");
  return new Set(ids);
}

export function createVocationalCareerMatcher(catalog) {
  const root = dataRecord(catalog, "invalid_match_catalog");
  const programRecord = dataRecord(root.programs, "invalid_match_catalog");
  const programEntries = Object.entries(programRecord);
  if (!programEntries.length || programEntries.length > VOCATIONAL_CAREER_MATCH_LIMITS.maximumPrograms) {
    fail("invalid_match_catalog");
  }

  const programs = programEntries.map(([programId, program]) => copyProgram(programId, program));
  const knownIds = new Set(programs.map((program) => program.programId));
  const strictCanonical = new Map();
  const strictAliases = new Map();
  const normalizedAll = new Map();
  const fuzzyEntries = [];

  for (const program of programs) {
    const entry = Object.freeze({ programId: program.programId, level: program.level });
    addIndexEntry(strictCanonical, strictText(program.canonicalName), entry);
    addIndexEntry(normalizedAll, normalizeCatalogText(program.canonicalName), entry);
    const names = [program.canonicalName, ...program.exactAliases, ...program.inputAliases];
    for (const alias of [...program.exactAliases, ...program.inputAliases]) {
      addIndexEntry(strictAliases, strictText(alias), entry);
      addIndexEntry(normalizedAll, normalizeCatalogText(alias), entry);
    }
    for (const name of names) {
      const normalized = normalizeCatalogText(name);
      if (!fuzzyEntries.some((candidate) =>
        candidate.programId === program.programId && candidate.normalized === normalized
      )) {
        fuzzyEntries.push(Object.freeze({ ...entry, normalized }));
      }
    }
  }
  fuzzyEntries.sort((left, right) =>
    compareCodeUnits(left.normalized, right.normalized) || compareCodeUnits(left.programId, right.programId)
  );
  Object.freeze(fuzzyEntries);

  function match(value, options = {}) {
    const optionRecord = dataRecord(options, "invalid_match_options");
    const allowedOptionKeys = new Set(["academicLevel", "allowedProgramIds", "userText"]);
    if (Object.keys(optionRecord).some((key) => !allowedOptionKeys.has(key))) fail("invalid_match_options");
    const academicLevel = optionRecord.academicLevel === undefined || optionRecord.academicLevel === null
      ? null
      : boundedString(optionRecord.academicLevel, 40, "invalid_match_options");
    if (academicLevel && !LEVELS.has(academicLevel)) fail("invalid_match_options");
    const allowedProgramIds = safeAllowedIds(optionRecord.allowedProgramIds, knownIds);

    let normalized;
    try {
      normalized = normalizeVocationalCareerInput(value);
    } catch (error) {
      return result("invalid_input", { reasonCode: error.code || "invalid_match_input" });
    }
    const query = optionRecord.userText === false ? normalized : queryFromUserText(normalized);
    if (!query) return result("no_match", { reasonCode: "context_not_applicable" });

    const strict = strictText(value);
    const canonicalMatches = filtered(strictCanonical.get(strict) || [], academicLevel, allowedProgramIds);
    const aliasMatches = filtered(strictAliases.get(strict) || [], academicLevel, allowedProgramIds);
    if (canonicalMatches.length) {
      const combined = [...canonicalMatches];
      for (const entry of aliasMatches) {
        if (!combined.some((candidate) => candidate.programId === entry.programId)) combined.push(entry);
      }
      return exactResult(combined, "exact", "canonical_name");
    }
    if (aliasMatches.length) return exactResult(aliasMatches, "approved_alias", "approved_alias");

    const normalizedMatches = filtered(normalizedAll.get(query) || [], academicLevel, allowedProgramIds);
    if (normalizedMatches.length) return exactResult(normalizedMatches, "normalized_exact", "safe_normalization");

    const policy = thresholds(query.length);
    if (!policy) return result("no_match", { reasonCode: "input_too_short_for_fuzzy" });
    const queryTokens = query.split(" ").length;
    const queryBigrams = bigrams(query);
    const candidates = fuzzyEntries.filter((entry) =>
      (!academicLevel || entry.level === academicLevel) &&
      (!allowedProgramIds || allowedProgramIds.has(entry.programId)) &&
      Math.abs(entry.normalized.length - query.length) <= policy.maximumDistance &&
      Math.abs(entry.normalized.split(" ").length - queryTokens) <= 1 &&
      sharesBigram(queryBigrams, entry.normalized)
    );
    if (candidates.length > VOCATIONAL_CAREER_MATCH_LIMITS.maximumComparisons) {
      return result("no_match", { reasonCode: "comparison_limit_exceeded" });
    }

    const byProgram = new Map();
    for (const candidate of candidates) {
      const distance = damerauLevenshtein(query, candidate.normalized, policy.maximumDistance);
      if (distance > policy.maximumDistance) continue;
      const similarity = 1 - distance / Math.max(query.length, candidate.normalized.length);
      const current = byProgram.get(candidate.programId);
      if (!current || distance < current.distance ||
          (distance === current.distance && similarity > current.similarity)) {
        byProgram.set(candidate.programId, { ...candidate, distance, similarity });
      }
    }
    const ranked = [...byProgram.values()].sort((left, right) =>
      left.distance - right.distance ||
      right.similarity - left.similarity ||
      compareCodeUnits(left.programId, right.programId)
    );
    if (!ranked.length || ranked[0].similarity < policy.minimumSimilarity) {
      return result("no_match", { reasonCode: "no_safe_candidate" });
    }
    const best = ranked[0];
    const second = ranked[1] || null;
    const tied = second && best.distance === second.distance && best.similarity === second.similarity;
    const margin = second ? best.similarity - second.similarity : 1;
    if (tied || margin < policy.minimumMargin) {
      return result("ambiguous", {
        alternativesCount: Math.min(ranked.length, 3),
        reasonCode: tied ? "tied_candidates" : "insufficient_margin",
      });
    }
    return result("fuzzy_confirmation_required", {
      programId: best.programId,
      matchMethod: "bounded_damerau_levenshtein",
      confidenceBand: best.distance === 1 ? "high" : "controlled",
      alternativesCount: 1,
    });
  }

  return Object.freeze({
    match,
    programCount: programs.length,
  });
}

const defaultMatcher = createVocationalCareerMatcher(getEducativeProgramRelations());

export function matchVocationalCareer(value, options) {
  return defaultMatcher.match(value, options);
}

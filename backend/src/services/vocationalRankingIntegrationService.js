import { rankVocationalCandidates } from "./vocationalRankingService.js";

export const VOCATIONAL_CANDIDATE_SOURCES = Object.freeze([
  "explicit_user_request",
  "explicit_user_selection",
  "direct_canonical_mention",
  "search_continuation",
  "gemini_response",
  "profile_inference",
  "same_family",
  "documented_nearby",
]);

const SOURCE_SET = new Set(VOCATIONAL_CANDIDATE_SOURCES);
const MAX_CANDIDATES = 128;
const SAFE_CAREER_KEYS = Object.freeze([
  "name",
  "normalizedName",
  "level",
  "academicLevel",
  "searchQuery",
  "canonicalProgramId",
  "familyId",
  "exactAliases",
  "matchedAlias",
  "fromRelated",
  "relationType",
  "searchContinuation",
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function copyCareer(value) {
  if (!isPlainObject(value) || typeof value.canonicalProgramId !== "string") {
    throw new Error("invalid_normalized_candidate");
  }
  const career = {};
  for (const key of SAFE_CAREER_KEYS) {
    if (!Object.hasOwn(value, key)) continue;
    if (key === "exactAliases") {
      if (!Array.isArray(value.exactAliases) ||
          value.exactAliases.some((alias) => typeof alias !== "string")) {
        throw new Error("invalid_normalized_candidate");
      }
      career.exactAliases = [...value.exactAliases];
    } else {
      career[key] = value[key];
    }
  }
  return career;
}

function normalizeFlowCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length > MAX_CANDIDATES) {
    throw new Error("invalid_candidate_set");
  }
  return candidates.map((entry) => {
    if (!isPlainObject(entry) || !SOURCE_SET.has(entry.source)) {
      throw new Error("invalid_candidate_source");
    }
    return { career: copyCareer(entry.career), source: entry.source };
  });
}

function selectCareerByProgram(candidates) {
  const grouped = new Map();
  for (const { career } of candidates) {
    const serialized = JSON.stringify(career);
    const current = grouped.get(career.canonicalProgramId);
    if (!current || serialized < current.serialized) {
      grouped.set(career.canonicalProgramId, { career, serialized });
    }
  }
  return new Map([...grouped].map(([programId, value]) => [programId, value.career]));
}

function copyDecision(decision) {
  return {
    canonicalProgramId: decision.canonicalProgramId,
    classification: decision.classification,
    score: decision.score,
    positiveEvidenceCount: decision.positiveEvidenceCount,
    negativeEvidenceCount: decision.negativeEvidenceCount,
    reasonCodes: [...decision.reasonCodes],
    scoreBreakdown: decision.scoreBreakdown.map((entry) => ({ ...entry })),
  };
}

function translate(decisions, careerByProgram) {
  return decisions.map((decision) => ({
    career: copyCareer(careerByProgram.get(decision.canonicalProgramId)),
    decision: copyDecision(decision),
  }));
}

function closedFailure(candidateCount) {
  return {
    status: "ranking_error",
    code: "VOCATIONAL_RANKING_INPUT_REJECTED",
    candidateCount,
    accepted: [],
    confirmation: [],
    rejected: [],
    ordered: [],
  };
}

function createVocationalRankingEvaluator({
  rankCandidates = rankVocationalCandidates,
} = {}) {
  if (typeof rankCandidates !== "function") {
    throw new TypeError("rankCandidates must be a function");
  }

  return function evaluateVocationalFlowCandidates({
    vocationalProfile,
    candidates,
    currentRevision,
  } = {}) {
    let normalized;
    try {
      normalized = normalizeFlowCandidates(candidates);
    } catch {
      return closedFailure(Array.isArray(candidates) ? candidates.length : 0);
    }

    if (normalized.length === 0) {
      return {
        status: "not_evaluated",
        code: "NO_VOCATIONAL_CANDIDATES",
        candidateCount: 0,
        accepted: [],
        confirmation: [],
        rejected: [],
        ordered: [],
      };
    }

    const engineInput = {
      vocationalProfile,
      candidates: normalized.map(({ career, source }) => ({
        canonicalProgramId: career.canonicalProgramId,
        source,
        isExplicitCurrentRequest: source === "explicit_user_request",
        isExplicitCurrentSelection: source === "explicit_user_selection",
      })),
      ...(currentRevision === undefined ? {} : { currentRevision }),
    };

    try {
      const ranked = rankCandidates(engineInput);
      const careerByProgram = selectCareerByProgram(normalized);
      return {
        status: "ok",
        code: "VOCATIONAL_RANKING_COMPLETED",
        candidateCount: normalized.length,
        accepted: translate(ranked.accepted, careerByProgram),
        confirmation: translate(ranked.confirmationRequired, careerByProgram),
        rejected: translate(ranked.rejected, careerByProgram),
        ordered: translate(ranked.ordered, careerByProgram),
      };
    } catch {
      return closedFailure(normalized.length);
    }
  };
}

const defaultEvaluator = createVocationalRankingEvaluator();

export function rankVocationalFlowCandidates(input) {
  return defaultEvaluator(input);
}

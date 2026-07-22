import { randomUUID } from "node:crypto";
import {
  detectCanonicalProgramOptions,
  getFamilyCandidateIds,
  toCanonicalCareerCandidate,
} from "./educativeProgramRelationsService.js";
import {
  getDefaultVocationalProfile,
  normalizeVocationalProfile,
} from "./vocationalPreferenceService.js";

const DIRECT_SEARCH_PATTERN = /\b(quiero estudiar|me interesa estudiar|me interesan|busco estudiar|escuelas?|universidades?|instituciones?|opciones de|donde estudiar|que estudiar|carrera|licenciatura|ingenieria|prepa|bachillerato|tsu|maestria|doctorado|posgrado|especialidad)\b/;
const CONFIRM_PATTERN = /^(?:si|claro|adelante|esta bien|quiero|acepto|por favor|muestrame|muestrame(?: las)? opciones|mostrar opciones|quiero ver escuelas|quiero ver instituciones|ver instituciones|si quiero verlas|quiero conocer las universidades|ensename .+|quiero ver .+)$/;
const DEFER_PATTERN = /\b(sigamos hablando|todavia no|conversar primero|hazme mas preguntas|prefiero seguir|continuemos|no quiero ver escuelas|seguir conversando)\b/;
const MORE_PATTERN = /\b(dame mas opciones|muestrame otras|que otras escuelas hay|mas resultados|otras instituciones|quiero ver mas|mas opciones)\b/;
const RELATED_PATTERN = /\b(explorar carreras relacionadas|quiero ver carreras relacionadas|que otras carreras existen|que otras carreras hay|carreras similares|opciones relacionadas|opciones parecidas|otras carreras|explorar otras carreras|quiero explorar algo relacionado)\b/;
const MORE_RELATED_PATTERN = /\b(mostrar mas carreras relacionadas|muestrame mas carreras relacionadas|mas carreras relacionadas|siguientes carreras relacionadas)\b/;
const MORE_VOCATIONAL_CAREERS = new Set([
  "mostrar mas carreras", "ver mas carreras", "mas carreras", "otras carreras",
]);
const ORDINALS = new Map([
  ["la primera", 0], ["el primero", 0], ["primera", 0], ["primero", 0], ["opcion 1", 0],
  ["la segunda", 1], ["el segundo", 1], ["segunda", 1], ["segundo", 1], ["opcion 2", 1],
  ["la tercera", 2], ["el tercero", 2], ["tercera", 2], ["tercero", 2], ["opcion 3", 2],
]);

export function normalizeEducativeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function containsPhrase(text, phrase) {
  return Boolean(text && phrase && (" " + text + " ").includes(" " + phrase + " "));
}
export function getRelatedCareerCandidates(career, level) {
  if (!career?.canonicalProgramId) return [];
  return getFamilyCandidateIds(career.canonicalProgramId)
    .map(toCanonicalCareerCandidate).filter((candidate) => candidate && candidate.level === level);
}
export function detectCareerOptions(text, { requireDirectIntent = false, limit = 3 } = {}) {
  const normalizedText = normalizeEducativeText(text);
  if (!normalizedText || (requireDirectIntent && !DIRECT_SEARCH_PATTERN.test(normalizedText))) return [];
  return detectCanonicalProgramOptions(text, { limit });
}
export function isDirectEducativeRequest(text) {
  return DIRECT_SEARCH_PATTERN.test(normalizeEducativeText(text));
}
export function isDirectInstitutionRequest(text) {
  return /\b(escuelas?|universidades?|instituciones?|planteles?|donde estudiar)\b/.test(normalizeEducativeText(text));
}
export function isStrongCareerReinforcement(text, careers = []) {
  const normalizedText = normalizeEducativeText(text);
  return (careers || []).some((career) =>
    [career.normalizedName, career.name, career.matchedAlias, ...(career.exactAliases || [])]
      .filter(Boolean)
      .some((name) => containsPhrase(normalizedText, normalizeEducativeText(name))));
}
export function getDefaultEducativeState() {
  return {
    status: "idle", pendingCareers: [], pendingLevel: null,
    pendingConfirmationActionId: null, pendingActionMessageId: null,
    searchConfirmed: false, deferredSearch: false, messagesSinceDeferral: 0,
    lastPromptedCareers: [], lastPromptedAt: null, confirmedSearchSignature: null,
    excludedOfferIds: [], hasMoreResults: false, activeConfirmedCareer: null,
    activeConfirmedLevel: null, activeSearchQuery: null, currentCanonicalProgramId: null,
    currentLevel: null, currentFamilyId: null, exploredProgramIds: [],
    shownFamilyProgramIds: [], shownNearbyProgramIds: [], relatedStage: "family",
    relatedHasMore: false, vocationalProfile: getDefaultVocationalProfile(),
    vocationalCareerPagination: null,
  };
}
function normalizeIdArray(value) {
  return Array.isArray(value) ? [...new Set(value.filter(Boolean).map(String))] : [];
}
export function normalizeEducativeState(value) {
  const defaults = getDefaultEducativeState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const safeValue = Object.fromEntries(
    Object.entries(Object.getOwnPropertyDescriptors(value))
      .filter(([, descriptor]) => Object.hasOwn(descriptor, "value"))
      .map(([key, descriptor]) => [key, descriptor.value]),
  );
  return {
    ...defaults, ...safeValue,
    pendingCareers: Array.isArray(safeValue.pendingCareers) ? safeValue.pendingCareers : [],
    lastPromptedCareers: Array.isArray(safeValue.lastPromptedCareers) ? safeValue.lastPromptedCareers : [],
    excludedOfferIds: normalizeIdArray(safeValue.excludedOfferIds),
    exploredProgramIds: normalizeIdArray(safeValue.exploredProgramIds),
    shownFamilyProgramIds: normalizeIdArray(safeValue.shownFamilyProgramIds),
    shownNearbyProgramIds: normalizeIdArray(safeValue.shownNearbyProgramIds),
    messagesSinceDeferral: Math.max(Number(safeValue.messagesSinceDeferral) || 0, 0),
    relatedStage: ["family", "nearby", "exhausted"].includes(safeValue.relatedStage) ? safeValue.relatedStage : "family",
    relatedHasMore: Boolean(safeValue.relatedHasMore),
    vocationalCareerPagination: safeValue.vocationalCareerPagination &&
      typeof safeValue.vocationalCareerPagination === "object" &&
      !Array.isArray(safeValue.vocationalCareerPagination)
      ? safeValue.vocationalCareerPagination
      : null,
    vocationalProfile: normalizeVocationalProfile(safeValue.vocationalProfile),
  };
}
export function createUiAction(type, payload = {}) {
  return { id: randomUUID(), type, ...payload, status: "pending" };
}
function confirmationForCareer(career) {
  return {
    type: "confirm_educative_search", career: career.normalizedName,
    canonicalProgramId: career.canonicalProgramId, academicLevel: career.academicLevel,
  };
}
export function classifyTypedAction(text, state) {
  const normalizedText = normalizeEducativeText(text);
  if (!normalizedText || !state?.pendingConfirmationActionId) return null;
  if (state.status === "awaiting_confirmation") {
    if (MORE_VOCATIONAL_CAREERS.has(normalizedText) &&
        state.vocationalCareerPagination?.hasMore === true) {
      return { type: "more_vocational_careers" };
    }
    if (MORE_RELATED_PATTERN.test(normalizedText) && state.relatedHasMore) return { type: "more_related_programs" };
    if (DEFER_PATTERN.test(normalizedText)) return { type: "defer_educative_search" };
    for (const [phrase, index] of ORDINALS) {
      if (containsPhrase(normalizedText, phrase) && state.pendingCareers[index]) return confirmationForCareer(state.pendingCareers[index]);
    }
    const numericSelection = /^(\d+)$/.exec(normalizedText);
    if (numericSelection) {
      const selected = state.pendingCareers[Number(numericSelection[1]) - 1];
      if (selected) return confirmationForCareer(selected);
    }
    const namedCareer = (state.pendingCareers || []).find((career) =>
      containsPhrase(normalizedText, normalizeEducativeText(career.normalizedName || career.name)));
    const selectsNamedCareer = namedCareer && (
      normalizedText === normalizeEducativeText(namedCareer.name) ||
      normalizedText === normalizeEducativeText(namedCareer.normalizedName) ||
      /\b(quiero|mostrar|muestrame|opcion|elige|selecciono|explorar)\b/.test(normalizedText) ||
      isDirectInstitutionRequest(text)
    );
    if (selectsNamedCareer) return confirmationForCareer(namedCareer);
    if (CONFIRM_PATTERN.test(normalizedText)) {
      if (state.pendingCareers.length === 1) return confirmationForCareer(state.pendingCareers[0]);
      return { type: "clarify_educative_career" };
    }
  }
  if (state.status === "showing_results") {
    if (MORE_PATTERN.test(normalizedText)) return { type: "more_educative_results" };
    if (DEFER_PATTERN.test(normalizedText)) return { type: "continue_conversation" };
  }
  if (state.status === "exhausted") {
    if (RELATED_PATTERN.test(normalizedText)) return { type: "explore_related_careers" };
    if (DEFER_PATTERN.test(normalizedText)) return { type: "continue_conversation" };
  }
  return null;
}
export function buildConfirmationReply(careers, directRequest = false) {
  if (careers.length === 1) {
    const career = careers[0].name;
    return directRequest
      ? "Entiendo que te interesa " + career + ". ¿Quieres que te muestre instituciones que ofrecen esta opción o prefieres conversar primero?"
      : "Por lo que me has contado, " + career + " podría relacionarse con tus intereses.";
  }
  return "Encontré varias carreras relacionadas con tus intereses. Elige una para consultar instituciones o sigamos conversando.";
}

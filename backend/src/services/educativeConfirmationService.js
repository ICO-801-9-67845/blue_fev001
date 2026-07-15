import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const educativeSearchMap = JSON.parse(
  readFileSync(join(__dirname, "../config/educativeSearchMap.json"), "utf8").replace(
    /^\uFEFF/,
    "",
  ),
);

const MAX_CAREER_OPTIONS = 3;
const ACADEMIC_PREFIX_PATTERN =
  /^(?:tecnico superior universitario|tsu|licenciatura|ingenieria|maestria|doctorado|especialidad)(?: en)? /;

const DIRECT_SEARCH_PATTERN =
  /\b(quiero estudiar|me interesa estudiar|me interesan|busco estudiar|escuelas?|universidades?|instituciones?|opciones de|donde estudiar|que estudiar|carrera|licenciatura|ingenieria|prepa|bachillerato|tsu|maestria|doctorado|posgrado|especialidad)\b/;

const CONFIRM_PATTERN =
  /^(?:si|claro|adelante|esta bien|quiero|acepto|por favor|muestrame|muestrame(?: las)? opciones|mostrar opciones|quiero ver escuelas|quiero ver instituciones|ver instituciones|si quiero verlas|quiero conocer las universidades|ensename .+|quiero ver .+)$/;

const DEFER_PATTERN =
  /\b(sigamos hablando|todavia no|conversar primero|hazme mas preguntas|prefiero seguir|continuemos|no quiero ver escuelas|seguir conversando)\b/;

const MORE_PATTERN =
  /\b(dame mas opciones|muestrame otras|que otras escuelas hay|mas resultados|otras instituciones|quiero ver mas|mas opciones)\b/;

const RELATED_PATTERN =
  /\b(explorar carreras relacionadas|quiero ver carreras relacionadas|que otras carreras existen|que otras carreras hay|carreras similares|opciones relacionadas|opciones parecidas|otras carreras|explorar otras carreras|quiero explorar algo relacionado)\b/;

const ORDINALS = new Map([
  ["la primera", 0],
  ["el primero", 0],
  ["primera", 0],
  ["primero", 0],
  ["opcion 1", 0],
  ["la segunda", 1],
  ["el segundo", 1],
  ["segunda", 1],
  ["segundo", 1],
  ["opcion 2", 1],
  ["la tercera", 2],
  ["el tercero", 2],
  ["tercera", 2],
  ["tercero", 2],
  ["opcion 3", 2],
]);

export function normalizeEducativeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(text, phrase) {
  return Boolean(text && phrase && (" " + text + " ").includes(" " + phrase + " "));
}

function titleCase(value) {
  return String(value || "")
    .toLocaleLowerCase("es-MX")
    .replace(/(^|[\s/(-])([\p{L}])/gu, (_match, prefix, letter) =>
      prefix + letter.toLocaleUpperCase("es-MX"),
    );
}

function getRequestedDetectionLevel(text) {
  const normalizedText = normalizeEducativeText(text);
  if (/\b(prepa|preparatoria|bachillerato|media superior)\b/.test(normalizedText)) {
    return "prepa";
  }
  if (/\b(tsu|t s u|tecnico superior universitario)\b/.test(normalizedText)) {
    return "tsu";
  }
  if (/\b(maestria|doctorado|posgrado|especialidad)\b/.test(normalizedText)) {
    return "posgrado";
  }
  return "undergraduate";
}

function getLevelPreferenceScore(candidateLevel, requestedLevel) {
  if (candidateLevel === requestedLevel) {
    return 30000;
  }
  if (requestedLevel === "undergraduate" && candidateLevel === "tsu") {
    return 5000;
  }
  return 0;
}
function getLevelForBucket(bucket, preferredLevel) {
  if (bucket === "bachillerato") {
    return "prepa";
  }
  if (bucket === "tsu") {
    return "tsu";
  }
  if (bucket === "posgrados") {
    return "posgrado";
  }
  return preferredLevel === "1" ? "prepa" : "undergraduate";
}

function getSpecificProgramName(program) {
  return normalizeEducativeText(program).replace(ACADEMIC_PREFIX_PATTERN, "").trim();
}

function getDisplayName(program) {
  const original = String(program || "").trim();
  const normalized = normalizeEducativeText(original);
  const specific = normalized.replace(ACADEMIC_PREFIX_PATTERN, "").trim();

  if (specific && specific !== normalized) {
    const prefixLength = normalized.indexOf(specific);
    return titleCase(original.slice(prefixLength));
  }

  return titleCase(original);
}

export function getRelatedCareerCandidates(career, level) {
  const category = educativeSearchMap[career?.categoryKey];
  if (!category) {
    return [];
  }

  const bucketsByLevel = {
    prepa: ["bachillerato"],
    tsu: ["tsu"],
    undergraduate: ["licenciatura_ingenieria"],
    posgrado: ["posgrados"],
  };
  const currentName = normalizeEducativeText(
    career.normalizedName || career.name || career.searchQuery,
  );
  const candidates = [];
  const seen = new Set([currentName]);

  for (const bucket of bucketsByLevel[level] || []) {
    for (const program of category.programs?.[bucket] || []) {
      const normalizedName = getSpecificProgramName(program);
      if (!normalizedName || seen.has(normalizedName)) {
        continue;
      }

      seen.add(normalizedName);
      candidates.push({
        name: getDisplayName(program),
        normalizedName: normalizedName.toLocaleUpperCase("es-MX"),
        level: getLevelForBucket(bucket, category.preferredLevel),
        searchQuery: program,
        categoryKey: career.categoryKey,
      });
    }
  }

  return candidates;
}

function buildProgramCandidates(text) {
  const normalizedText = normalizeEducativeText(text);
  const candidates = [];
  const requestedLevel = getRequestedDetectionLevel(text);

  for (const [categoryKey, category] of Object.entries(educativeSearchMap)) {
    for (const [bucket, programs] of Object.entries(category.programs || {})) {
      for (const program of programs || []) {
        const normalizedProgram = normalizeEducativeText(program);
        const specificName = getSpecificProgramName(program);
        const fullMatch = containsPhrase(normalizedText, normalizedProgram);
        const specificMatch =
          specificName.length >= 4 && containsPhrase(normalizedText, specificName);

        if (!fullMatch && !specificMatch) {
          continue;
        }

        const level = getLevelForBucket(bucket, category.preferredLevel);
        candidates.push({
          name: getDisplayName(program),
          normalizedName: specificName.toLocaleUpperCase("es-MX"),
          level,
          searchQuery: program,
          categoryKey,
          score:
            (fullMatch ? 20000 : 10000) +
            getLevelPreferenceScore(level, requestedLevel) +
            specificName.length,
        });
      }
    }
  }

  return candidates;
}

function buildTriggerCandidates(text) {
  const normalizedText = normalizeEducativeText(text);
  const candidates = [];
  const requestedLevel = getRequestedDetectionLevel(text);

  for (const [categoryKey, category] of Object.entries(educativeSearchMap)) {
    for (const trigger of category.triggers || []) {
      const normalizedTrigger = normalizeEducativeText(trigger);
      if (["ingenieria", "licenciatura", "universidad", "carrera"].includes(normalizedTrigger)) {
        continue;
      }
      if (normalizedTrigger.length < 4 || !containsPhrase(normalizedText, normalizedTrigger)) {
        continue;
      }

      const level = category.preferredLevel === "1" ? "prepa" : requestedLevel;
      candidates.push({
        name: titleCase(trigger),
        normalizedName: normalizedTrigger.toLocaleUpperCase("es-MX"),
        level,
        searchQuery: trigger,
        categoryKey,
        score:
          1000 +
          getLevelPreferenceScore(level, requestedLevel) +
          normalizedTrigger.length,
      });
    }
  }

  return candidates;
}

export function detectCareerOptions(text, { requireDirectIntent = false } = {}) {
  const normalizedText = normalizeEducativeText(text);
  if (!normalizedText || (requireDirectIntent && !DIRECT_SEARCH_PATTERN.test(normalizedText))) {
    return [];
  }

  const bestByCareer = new Map();
  for (const candidate of [...buildProgramCandidates(text), ...buildTriggerCandidates(text)]) {
    const existing = bestByCareer.get(candidate.normalizedName);
    if (!existing || existing.score < candidate.score) {
      bestByCareer.set(candidate.normalizedName, candidate);
    }
  }

  const sorted = [...bestByCareer.values()].sort(
    (left, right) =>
      right.score - left.score ||
      right.normalizedName.length - left.normalizedName.length ||
      left.name.localeCompare(right.name, "es"),
  );

  const selected = [];
  for (const candidate of sorted) {
    const overlaps = selected.some(
      (current) =>
        containsPhrase(
          normalizeEducativeText(current.normalizedName),
          normalizeEducativeText(candidate.normalizedName),
        ) ||
        containsPhrase(
          normalizeEducativeText(candidate.normalizedName),
          normalizeEducativeText(current.normalizedName),
        ),
    );

    if (!overlaps) {
      selected.push(candidate);
    }

    if (selected.length === MAX_CAREER_OPTIONS) {
      break;
    }
  }

  return selected.map(({ score, ...candidate }) => candidate);
}

export function isDirectEducativeRequest(text) {
  return DIRECT_SEARCH_PATTERN.test(normalizeEducativeText(text));
}

export function isDirectInstitutionRequest(text) {
  return /\b(escuelas?|universidades?|instituciones?|planteles?|donde estudiar)\b/.test(
    normalizeEducativeText(text),
  );
}

export function isStrongCareerReinforcement(text, careers = []) {
  const normalizedText = normalizeEducativeText(text);
  return (careers || []).some((career) =>
    containsPhrase(normalizedText, normalizeEducativeText(career.normalizedName || career.name)),
  );
}

export function getDefaultEducativeState() {
  return {
    status: "idle",
    pendingCareers: [],
    pendingLevel: null,
    pendingConfirmationActionId: null,
    pendingActionMessageId: null,
    searchConfirmed: false,
    deferredSearch: false,
    messagesSinceDeferral: 0,
    lastPromptedCareers: [],
    lastPromptedAt: null,
    confirmedSearchSignature: null,
    excludedOfferIds: [],
    hasMoreResults: false,
    activeConfirmedCareer: null,
    activeConfirmedLevel: null,
    activeSearchQuery: null,
  };
}

export function normalizeEducativeState(value) {
  const defaults = getDefaultEducativeState();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  return {
    ...defaults,
    ...value,
    pendingCareers: Array.isArray(value.pendingCareers) ? value.pendingCareers : [],
    lastPromptedCareers: Array.isArray(value.lastPromptedCareers)
      ? value.lastPromptedCareers
      : [],
    excludedOfferIds: Array.isArray(value.excludedOfferIds)
      ? [...new Set(value.excludedOfferIds.map(String))]
      : [],
    messagesSinceDeferral: Math.max(Number(value.messagesSinceDeferral) || 0, 0),
  };
}

export function createUiAction(type, payload = {}) {
  return {
    id: randomUUID(),
    type,
    ...payload,
    status: "pending",
  };
}

export function classifyTypedAction(text, state) {
  const normalizedText = normalizeEducativeText(text);
  if (!normalizedText || !state?.pendingConfirmationActionId) {
    return null;
  }

  if (state.status === "awaiting_confirmation") {
    if (DEFER_PATTERN.test(normalizedText)) {
      return { type: "defer_educative_search" };
    }

    for (const [phrase, index] of ORDINALS) {
      if (containsPhrase(normalizedText, phrase) && state.pendingCareers[index]) {
        return {
          type: "confirm_educative_search",
          career: state.pendingCareers[index].normalizedName,
        };
      }
    }

    const namedCareer = (state.pendingCareers || []).find((career) =>
      containsPhrase(normalizedText, normalizeEducativeText(career.normalizedName || career.name)),
    );

    const selectsNamedCareer = namedCareer && (
      normalizedText === normalizeEducativeText(namedCareer.name) ||
      normalizedText === normalizeEducativeText(namedCareer.normalizedName) ||
      /\b(quiero|mostrar|muestrame|opcion|elige|selecciono)\b/.test(normalizedText) ||
      isDirectInstitutionRequest(text)
    );

    if (selectsNamedCareer) {
      return {
        type: "confirm_educative_search",
        career: namedCareer.normalizedName,
      };
    }

    if (CONFIRM_PATTERN.test(normalizedText)) {
      if (state.pendingCareers.length === 1) {
        return {
          type: "confirm_educative_search",
          career: state.pendingCareers[0].normalizedName,
        };
      }
      return { type: "clarify_educative_career" };
    }
  }

  if (state.status === "showing_results") {
    if (MORE_PATTERN.test(normalizedText)) {
      return { type: "more_educative_results" };
    }
    if (DEFER_PATTERN.test(normalizedText)) {
      return { type: "continue_conversation" };
    }
  }

  if (state.status === "exhausted") {
    if (RELATED_PATTERN.test(normalizedText)) {
      return { type: "explore_related_careers" };
    }
    if (DEFER_PATTERN.test(normalizedText)) {
      return { type: "continue_conversation" };
    }
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
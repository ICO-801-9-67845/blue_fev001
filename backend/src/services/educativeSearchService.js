import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const educativeSearchMap = JSON.parse(
  readFileSync(join(__dirname, "../config/educativeSearchMap.json"), "utf8").replace(
    /^\uFEFF/,
    ""
  )
);
const MAX_USER_MESSAGES_FOR_CONTEXT = 20;
const MAX_CANDIDATE_RESULTS = 100;
const MAX_CONTEXT_RESULTS = 3;
const MAX_CAREERS_PER_OFFER = 3;

const STUDY_TYPE_CATEGORY_KEYS = new Set([
  "bachillerato_prepa",
  "bachillerato_general",
  "tsu_tecnico_superior",
  "maestrias_posgrados",
  "doctorados",
]);

const EDUCATIVE_INTENT_PHRASES = [
  "quiero estudiar",
  "quiero una carrera",
  "opciones para estudiar",
  "donde puedo estudiar",
  "escuelas de",
  "universidades de",
  "prepa",
  "preparatoria",
  "bachillerato",
  "licenciatura",
  "ingenieria",
  "carrera",
  "universidad",
  "maestria",
  "doctorado",
  "posgrado",
  "tsu",
  "tecnico superior universitario",
];

const EDUCATIVE_FOLLOW_UP_PHRASES = [
  "dame mas opciones",
  "mas opciones",
  "otras opciones",
  "dame otras",
  "hay mas",
  "quiero mas",
  "siguiente",
  "siguientes",
  "otras",
  "otra",
  "otra opcion",
  "mas",
];

const EDUCATIVE_PURE_FOLLOW_UP_MESSAGES = new Set(EDUCATIVE_FOLLOW_UP_PHRASES);

const EDUCATIVE_SEARCH_RESET_PHRASES = [
  "reinicia la busqueda",
  "reiniciar busqueda",
  "empieza de nuevo",
  "desde el principio",
  "vuelve a empezar",
  "volver a empezar",
  "empezar de nuevo",
];

const EDUCATIVE_REFINEMENT_PHRASES = [
  "universidad",
  "para universidad",
  "nivel universidad",
  "licenciatura",
  "ingenieria",
  "carrera",
  "profesional",
  "prepa",
  "preparatoria",
  "bachillerato",
  "tsu",
  "tecnico superior universitario",
  "maestria",
  "doctorado",
  "posgrado",
  "en leon",
  "en celaya",
  "en guanajuato",
  "solo leon",
  "presencial",
  "virtual",
  "en linea",
];

const LEVEL_1_PHRASES = ["prepa", "preparatoria", "bachillerato", "media superior"];
const LEVEL_2_PHRASES = [
  "universidad",
  "licenciatura",
  "ingenieria",
  "carrera",
  "profesional",
  "maestria",
  "doctorado",
  "posgrado",
  "tsu",
  "tecnico superior universitario",
];

const CAREER_STOP_WORDS = new Set([
  "estoy",
  "buscando",
  "opciones",
  "quiero",
  "para",
  "estudiar",
  "dame",
  "mas",
  "otras",
  "universidad",
  "carrera",
  "carreras",
  "escuela",
  "escuelas",
  "prepa",
  "preparatoria",
  "bachillerato",
]);

const GENERIC_CAREER_TEXTS = [
  "todo lo que deseas",
  "nuestra oferta educativa",
  "oferta educativa",
];

const PROGRAM_SEARCH_ALIASES = {
  "protesis dental": ["ASISTENTE Y PROTESISTA DENTAL"],
  "licenciatura en administracion agropecuaria": ["ADMINISTRACI\u00d3N AGROPECUARIA"],
};

const CATEGORY_MATCH_THRESHOLD = 2;
const OFFER_DETAIL_ID_PATTERN = /oferta-educativa\/detalle\/(\d+)/gi;
const OFFER_ID_TEXT_PATTERN = /\b(?:oferta|offer|id)\s*#?:?\s*(\d{1,12})\b/gi;

function toText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return `${value.content || value.message || value.text || ""}`;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function getCategoryTriggers(categoryKey, category = {}) {
  return uniqueValues(category.triggers || []);
}

function getAllowedProgramBuckets(requestedStudyType) {
  if (requestedStudyType === "prepa") {
    return ["bachillerato"];
  }

  if (requestedStudyType === "tsu") {
    return ["tsu"];
  }

  if (["maestria", "doctorado", "posgrado", "especialidad"].includes(requestedStudyType)) {
    return ["posgrados"];
  }

  return ["licenciatura_ingenieria", "tsu"];
}

function getProgramSearchAliases(programName) {
  const value = String(programName || "").trim();

  if (!value) {
    return [];
  }

  const normalized = normalizeText(value);
  const aliases = [value, ...(PROGRAM_SEARCH_ALIASES[normalized] || [])];
  const isTsuProgram =
    normalized.includes("tecnico superior universitario") || normalized.includes("tsu");

  if (isTsuProgram) {
    const words = value.split(/\s+/).filter(Boolean);
    const firstCandidateIndex = Math.max(7, words.length - 4);
    const weakEndingWords = new Set(["area", "de", "del", "la", "las", "los", "el", "en", "y"]);

    for (let index = words.length - 1; index >= firstCandidateIndex; index -= 1) {
      const prefix = words.slice(0, index).join(" ").trim();
      const lastWord = normalizeText(words[index - 1]);

      if (prefix.length >= 45 && !weakEndingWords.has(lastWord)) {
        aliases.push(prefix);
      }
    }
  }

  return uniqueValues(aliases);
}

function containsNormalizedPhrase(text, phrase) {
  return Boolean(text && phrase && ` ${text} `.includes(` ${phrase} `));
}

function getSpecificProgramPhrase(programName) {
  return normalizeText(programName)
    .replace(
      /^(?:tecnico superior universitario|licenciatura|ingenieria|maestria|doctorado|especialidad|tsu)(?: en)? /,
      ""
    )
    .trim();
}

function getProgramPhraseMatchScore(normalizedPhrase, quality) {
  if (!normalizedPhrase) {
    return 0;
  }

  const tokenCount = normalizedPhrase.split(" ").filter(Boolean).length;
  return tokenCount * 1000 + quality + normalizedPhrase.length;
}

function getProgramMatches(searchText) {
  const normalizedSearchText = normalizeText(searchText);

  if (!normalizedSearchText) {
    return [];
  }

  const candidates = [];

  for (const [categoryKey, category] of Object.entries(educativeSearchMap)) {
    for (const [bucket, programs] of Object.entries(category.programs || {})) {
      for (const program of programs || []) {
        const aliases = getProgramSearchAliases(program);
        let bestScore = 0;
        let matchType = null;

        for (const alias of aliases) {
          const normalizedAlias = normalizeText(alias);

          if (containsNormalizedPhrase(normalizedSearchText, normalizedAlias)) {
            const isCanonicalProgram = normalizeText(program) === normalizedAlias;
            const score = getProgramPhraseMatchScore(
              normalizedAlias,
              isCanonicalProgram ? 500 : 450
            );
            if (score > bestScore) {
              bestScore = score;
              matchType = isCanonicalProgram ? "exact" : "alias";
            }
          }
        }

        const specificPhrase = getSpecificProgramPhrase(program);
        const specificTokenCount = specificPhrase.split(" ").filter(Boolean).length;
        if (specificPhrase.length >= 12 && specificTokenCount >= 2) {
          if (containsNormalizedPhrase(normalizedSearchText, specificPhrase)) {
            const score = getProgramPhraseMatchScore(specificPhrase, 400);
            if (score > bestScore) {
              bestScore = score;
              matchType = "specific_tokens";
            }
          }
        }

        if (bestScore > 0) {
          candidates.push({
            categoryKey,
            categoryLabel: category.label,
            preferredLevel: category.preferredLevel || null,
            bucket,
            program,
            aliases,
            score: bestScore,
            matchType,
          });
        }
      }
    }
  }

  const topScore = Math.max(0, ...candidates.map((candidate) => candidate.score));
  return candidates
    .filter((candidate) => candidate.score === topScore)
    .sort((a, b) => a.categoryKey.localeCompare(b.categoryKey));
}

function getCategoriesForProgramMatches(programMatches) {
  return uniqueValues((programMatches || []).map((match) => match.categoryKey))
    .map((key) => {
      const category = educativeSearchMap[key] || {};
      return {
        key,
        label: category.label,
        score: Math.max(
          0,
          ...(programMatches || [])
            .filter((match) => match.categoryKey === key)
            .map((match) => match.score)
        ),
        preferredLevel: category.preferredLevel || null,
      };
    })
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

function getStudyTypeForProgramMatches(programMatches) {
  const studyTypes = uniqueValues((programMatches || []).map((match) => {
    if (match.bucket === "bachillerato") {
      return "prepa";
    }

    if (match.bucket === "tsu") {
      return "tsu";
    }

    if (match.bucket === "licenciatura_ingenieria") {
      return "undergraduate";
    }

    const normalizedProgram = normalizeText(match.program);
    if (normalizedProgram.includes("doctorado")) {
      return "doctorado";
    }
    if (normalizedProgram.includes("especialidad")) {
      return "especialidad";
    }
    if (normalizedProgram.includes("maestria")) {
      return "maestria";
    }
    return "posgrado";
  }));

  return studyTypes.length === 1 ? studyTypes[0] : null;
}

function getAllowedProgramKeywords(categoryKey, requestedStudyType = null) {
  const category = educativeSearchMap[categoryKey] || {};
  const programs = category.programs || {};
  return uniqueValues(
    getAllowedProgramBuckets(requestedStudyType)
      .flatMap((bucket) => programs[bucket] || [])
      .flatMap(getProgramSearchAliases)
  );
}

function getCategoryCareerKeywords(categoryKey, requestedStudyType = null) {
  return getAllowedProgramKeywords(categoryKey, requestedStudyType);
}
function escapeSqlLike(value) {
  return `${value}`.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function normalizeKeyword(value) {
  return normalizeText(value)
    .replace(/\b(de|del|la|las|los|el|en|y|area|área)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getQueryTokensForCareerRanking(searchContext = {}) {
  const normalizedQuery = normalizeText([searchContext.resolvedQuery, searchContext.searchText]
    .filter(Boolean)
    .join(" "));
  const stopWords = new Set([
    ...CAREER_STOP_WORDS,
    "relacionada",
    "relacionado",
    "nivel",
    "licenciatura",
    "licenciaturas",
    "ingenieria",
    "ingenierias",
    "maestria",
    "maestrias",
    "doctorado",
    "doctorados",
    "especialidad",
    "especialidades",
    "tecnico",
    "superior",
    "universitario",
    "medico",
    "medica",
    "medicos",
    "medicas",
  ]);

  return uniqueValues(
    normalizedQuery
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !stopWords.has(token))
  );
}

function getCareerQueryRelevanceScore(career, searchContext = {}) {
  const normalizedCareer = normalizeKeyword(career);
  const queryTokens = getQueryTokensForCareerRanking(searchContext);
  const queryPhrase = queryTokens.join(" ");
  let score = 0;

  if (queryPhrase && normalizedCareer.includes(queryPhrase)) {
    score += 80;
  }

  for (const token of queryTokens) {
    if (normalizedCareer.includes(token)) {
      score += token.length >= 8 ? 12 : 8;
    }
  }

  return score;
}

function getCareerProgramRelevanceScore(career, matchedPrograms = []) {
  const normalizedCareer = normalizeKeyword(career);
  let score = 0;

  for (const match of matchedPrograms || []) {
    for (const alias of match.aliases || [match.program]) {
      const normalizedAlias = normalizeKeyword(alias);
      if (!normalizedAlias) {
        continue;
      }

      if (normalizedCareer === normalizedAlias) {
        score = Math.max(score, 1200 + normalizedAlias.length);
        continue;
      }

      const shorterLength = Math.min(normalizedCareer.length, normalizedAlias.length);
      if (
        shorterLength >= 12 &&
        (normalizedCareer.includes(normalizedAlias) || normalizedAlias.includes(normalizedCareer))
      ) {
        score = Math.max(score, 1000 + shorterLength);
        continue;
      }
    }
  }

  return score;
}

function getCareerCategoryRelevanceScore(career, matchedCategories, requestedStudyType = null) {
  const normalizedCareer = normalizeKeyword(career);
  let score = 0;

  for (const category of matchedCategories || []) {
    const keywords = getCategoryCareerKeywords(category.key, requestedStudyType);
    for (const keyword of keywords) {
      const normalizedKeywordValue = normalizeKeyword(keyword);
      if (normalizedKeywordValue && normalizedCareer.includes(normalizedKeywordValue)) {
        score += 2;
      }
    }
  }

  return score;
}
function getCareerRelevanceScore(career, matchedCategories, requestedStudyType, searchContext = {}) {
  let score = getCareerQueryRelevanceScore(career, searchContext);

  const careerStudyType = getCareerStudyType(career);
  if (requestedStudyType && careerStudyType === requestedStudyType) {
    score += 20;
  }

  score += getCareerProgramRelevanceScore(career, searchContext.matchedPrograms);
  score += getCareerCategoryRelevanceScore(career, matchedCategories, requestedStudyType);
  return score;
}
function isGarbageKeyword(keyword) {
  const normalized = normalizeText(keyword);
  return !normalized || CAREER_STOP_WORDS.has(normalized);
}

function isGenericCareerName(careerName) {
  const normalized = normalizeText(careerName);
  return GENERIC_CAREER_TEXTS.some((genericText) => normalized.includes(genericText));
}

function getCareerStudyType(careerName) {
  const normalized = normalizeText(careerName);

  if (isGenericCareerName(careerName)) {
    return "generic";
  }

  if (normalized.includes("bachillerato") || normalized.includes("componente basico")) {
    return "prepa";
  }

  if (
    normalized.includes("tecnico superior universitario") ||
    normalized.includes("tsu")
  ) {
    return "tsu";
  }

  if (normalized.includes("maestria")) {
    return "maestria";
  }

  if (normalized.includes("doctorado")) {
    return "doctorado";
  }

  if (normalized.includes("especialidad")) {
    return "especialidad";
  }

  return "undergraduate";
}

function getStudyPriority(careers, requestedStudyType, offerLevel = null) {
  const types = careers.map(getCareerStudyType);

  if (requestedStudyType === "prepa") {
    return `${offerLevel}` === "1" || types.includes("prepa") ? 3 : 0;
  }

  if (requestedStudyType === "tsu") {
    return types.includes("tsu") ? 3 : 0;
  }

  if (requestedStudyType === "maestria") {
    return types.includes("maestria") ? 3 : 0;
  }

  if (requestedStudyType === "doctorado") {
    return types.includes("doctorado") ? 3 : 0;
  }

  if (requestedStudyType === "especialidad") {
    return types.includes("especialidad") ? 3 : 0;
  }

  if (requestedStudyType === "posgrado") {
    return types.some((type) => ["maestria", "doctorado", "especialidad"].includes(type)) ? 3 : 0;
  }

  if (types.includes("undergraduate")) {
    return 3;
  }

  if (types.includes("tsu")) {
    return 2;
  }

  return 1;
}

function levenshteinDistance(a, b) {
  if (a === b) {
    return 0;
  }

  if (!a || !b) {
    return Math.max(a.length, b.length);
  }

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }

    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function hasFuzzyTokenMatch(text, phrase) {
  const textTokens = text.split(" ").filter((token) => token.length >= 5);
  const phraseTokens = phrase.split(" ").filter((token) => token.length >= 5);

  if (!textTokens.length || !phraseTokens.length) {
    return false;
  }

  return phraseTokens.every((phraseToken) =>
    textTokens.some((textToken) => {
      if (textToken === phraseToken) {
        return true;
      }

      const maxDistance = phraseToken.length >= 8 ? 2 : 1;
      return levenshteinDistance(textToken, phraseToken) <= maxDistance;
    })
  );
}

function phraseScore(normalizedMessage, normalizedPhrase) {
  if (!normalizedMessage || !normalizedPhrase) {
    return 0;
  }

  const exactPattern = new RegExp(`(?:^| )${normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`);
  if (exactPattern.test(normalizedMessage)) {
    return normalizedPhrase.includes(" ") ? 3 : 2;
  }

  if (normalizedPhrase.length >= 5 && hasFuzzyTokenMatch(normalizedMessage, normalizedPhrase)) {
    return 1;
  }

  return 0;
}

function getCategoryMatches(searchText) {
  const normalizedSearchText = normalizeText(searchText);
  const scoredCategories = Object.entries(educativeSearchMap)
    .map(([key, category]) => {
      const score = getCategoryTriggers(key, category).reduce(
        (total, trigger) => total + phraseScore(normalizedSearchText, normalizeText(trigger)),
        0
      );

      return {
        key,
        label: category.label,
        score,
        preferredLevel: category.preferredLevel || null,
      };
    })
    .filter((category) => category.score >= CATEGORY_MATCH_THRESHOLD);

  const topScore = Math.max(0, ...scoredCategories.map((category) => category.score));
  const minimumRelevantScore = topScore >= 4 ? Math.max(CATEGORY_MATCH_THRESHOLD, topScore - 2) : CATEGORY_MATCH_THRESHOLD;

  return scoredCategories
    .filter((category) => category.score >= minimumRelevantScore)
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

function getCareerKeywordsForCategories(matchedCategories, requestedStudyType = null) {
  const hasAreaCategory = matchedCategories.some(
    (matchedCategory) => !STUDY_TYPE_CATEGORY_KEYS.has(matchedCategory.key)
  );
  const categoriesForKeywords = hasAreaCategory
    ? matchedCategories.filter((matchedCategory) => !STUDY_TYPE_CATEGORY_KEYS.has(matchedCategory.key))
    : Object.entries(educativeSearchMap).map(([key, category]) => ({
        key,
        label: category.label,
        preferredLevel: category.preferredLevel || null,
      }));

  return uniqueValues(
    categoriesForKeywords.flatMap((matchedCategory) => {
      return getCategoryCareerKeywords(matchedCategory.key, requestedStudyType).filter(
        (keyword) => !isGarbageKeyword(keyword)
      );
    })
  );
}

function getLastExplicitLevel(message) {
  const normalizedMessage = normalizeText(message);
  const levelHits = [];

  for (const phrase of LEVEL_1_PHRASES) {
    const index = normalizedMessage.lastIndexOf(phrase);
    if (index >= 0) {
      levelHits.push({ level: "1", index });
    }
  }

  for (const phrase of LEVEL_2_PHRASES) {
    const index = normalizedMessage.lastIndexOf(phrase);
    if (index >= 0) {
      levelHits.push({ level: "2", index });
    }
  }

  if (!levelHits.length) {
    return null;
  }

  return levelHits.sort((a, b) => b.index - a.index)[0].level;
}

function getLastExplicitStudyType(message) {
  const normalizedMessage = normalizeText(message);
  const studyTypeHits = [
    { type: "prepa", phrases: ["prepa", "preparatoria", "bachillerato", "media superior"] },
    { type: "tsu", phrases: ["tsu", "tecnico superior universitario"] },
    { type: "doctorado", phrases: ["doctorado", "doctorados"] },
    { type: "maestria", phrases: ["maestria", "maestrias"] },
    { type: "especialidad", phrases: ["especialidad", "especialidades"] },
    { type: "posgrado", phrases: ["posgrado", "posgrados"] },
    { type: "undergraduate", phrases: ["universidad", "licenciatura", "ingenieria", "carrera", "profesional"] },
  ].flatMap(({ type, phrases }) =>
    phrases
      .map((phrase) => ({ type, index: normalizedMessage.lastIndexOf(phrase) }))
      .filter((hit) => hit.index >= 0)
  );

  if (!studyTypeHits.length) {
    return null;
  }

  const explicitLevelHits = studyTypeHits.filter((hit) => hit.type !== "undergraduate");
  if (explicitLevelHits.length) {
    return explicitLevelHits.sort((a, b) => b.index - a.index)[0].type;
  }

  return studyTypeHits.sort((a, b) => b.index - a.index)[0].type;
}

function inferRequestedStudyType(message, recentUserTexts = [], matchedCategories = [], allowRecentContext = false) {
  const currentStudyType = getLastExplicitStudyType(message);

  if (currentStudyType) {
    return currentStudyType;
  }

  if (allowRecentContext) {
    for (const previousText of [...recentUserTexts].reverse()) {
      const previousStudyType = getLastExplicitStudyType(previousText);
      if (previousStudyType) {
        return previousStudyType;
      }
    }
  }

  const hasAreaCategory = matchedCategories.some(
    (category) => !STUDY_TYPE_CATEGORY_KEYS.has(category.key)
  );
  const hasLevel2AreaCategory = matchedCategories.some(
    (category) => !STUDY_TYPE_CATEGORY_KEYS.has(category.key) && category.preferredLevel === "2"
  );

  if (!hasAreaCategory && matchedCategories.some((category) =>
    ["bachillerato_prepa", "bachillerato_general"].includes(category.key)
  )) {
    return "prepa";
  }

  if (!hasAreaCategory && matchedCategories.some((category) => category.key === "tsu_tecnico_superior")) {
    return "tsu";
  }

  if (!hasAreaCategory && matchedCategories.some((category) => category.key === "doctorados")) {
    return "doctorado";
  }

  if (!hasAreaCategory && matchedCategories.some((category) => category.key === "maestrias_posgrados")) {
    return "maestria";
  }

  if (hasLevel2AreaCategory) {
    return "undergraduate";
  }

  return null;
}

function formatOfferId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = `${value}`.trim();
  return /^\d+$/.test(text) ? text : null;
}

function uniqueCareersByNormalizedName(careers) {
  const seen = new Set();
  return careers.filter((career) => {
    const normalized = normalizeKeyword(career);
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function mapOfferRow(row, matchedCategories, requestedStudyType, searchContext = {}) {
  const allCareers = uniqueCareersByNormalizedName(
    `${row.careers || ""}`.split("|||").map((career) => career.trim())
  ).filter((career) => !isGenericCareerName(career));
  const careerRelevanceScore = Math.max(
    0,
    ...allCareers.map((career) =>
      getCareerRelevanceScore(career, matchedCategories, requestedStudyType, searchContext)
    )
  );
  const queryRelevanceScore = Math.max(
    0,
    ...allCareers.map((career) => getCareerQueryRelevanceScore(career, searchContext))
  );
  const programRelevanceScore = Math.max(
    0,
    ...allCareers.map((career) =>
      getCareerProgramRelevanceScore(career, searchContext.matchedPrograms)
    )
  );
  const programRelevantCareers = allCareers.filter(
    (career) => getCareerProgramRelevanceScore(career, searchContext.matchedPrograms) > 0
  );
  const queryRelevantCareers = allCareers.filter(
    (career) => getCareerQueryRelevanceScore(career, searchContext) > 0
  );
  const categoryRelevantCareers = allCareers.filter(
    (career) => getCareerCategoryRelevanceScore(career, matchedCategories, requestedStudyType) > 0
  );
  const careersForDisplay = programRelevantCareers.length
    ? programRelevantCareers
    : queryRelevantCareers.length
      ? queryRelevantCareers
      : categoryRelevantCareers.length
        ? categoryRelevantCareers
        : allCareers;
  const careers = careersForDisplay
    .sort((a, b) =>
      getCareerRelevanceScore(b, matchedCategories, requestedStudyType, searchContext) -
        getCareerRelevanceScore(a, matchedCategories, requestedStudyType, searchContext) ||
      a.localeCompare(b)
    )
    .slice(0, MAX_CAREERS_PER_OFFER);
  const normalizedCareers = careers.map(normalizeKeyword).join(" ");
  const offerCategories = matchedCategories
    .filter((category) => {
      const keywords = getCategoryCareerKeywords(category.key, requestedStudyType);
      return keywords.some((keyword) => normalizedCareers.includes(normalizeKeyword(keyword)));
    })
    .map((category) => category.key);

  return {
    id: row.id?.toString?.() || `${row.id}`,
    name: row.name || "",
    short_name: row.short_name || "",
    level: row.level?.toString?.() || `${row.level || ""}`,
    municipality: row.municipality || "",
    redirect_url: row.redirect_url || "",
    careers,
    matchedCategories: offerCategories.length ? offerCategories : matchedCategories.map((category) => category.key),
    matchScore: Number(row.matchScore || 0),
    careerRelevanceScore,
    queryRelevanceScore,
    programRelevanceScore,
    studyPriority: getStudyPriority(careers, requestedStudyType, row.level),
  };
}

function toPublicOffer(offer) {
  return {
    id: offer.id,
    name: offer.name,
    short_name: offer.short_name,
    level: offer.level,
    municipality: offer.municipality,
    redirect_url: offer.redirect_url,
    careers: offer.careers,
    matchedCategories: offer.matchedCategories,
    matchScore: offer.matchScore,
  };
}

function addStudyTypeFilters(whereParts, requestedStudyType) {
  if (requestedStudyType === "tsu") {
    whereParts.push("(UPPER(c.name) LIKE '%TÉCNICO SUPERIOR UNIVERSITARIO%' OR UPPER(c.name) LIKE '%TECNICO SUPERIOR UNIVERSITARIO%' OR UPPER(c.name) LIKE '%TSU%')");
    return;
  }

  if (requestedStudyType === "maestria") {
    whereParts.push("(UPPER(c.name) LIKE '%MAESTRÍA%' OR UPPER(c.name) LIKE '%MAESTRIA%')");
    return;
  }

  if (requestedStudyType === "doctorado") {
    whereParts.push("UPPER(c.name) LIKE '%DOCTORADO%'");
    return;
  }

  if (requestedStudyType === "posgrado") {
    whereParts.push("(UPPER(c.name) LIKE '%MAESTRÍA%' OR UPPER(c.name) LIKE '%MAESTRIA%' OR UPPER(c.name) LIKE '%DOCTORADO%' OR UPPER(c.name) LIKE '%ESPECIALIDAD%')");
    return;
  }

  if (requestedStudyType === "especialidad") {
    whereParts.push("UPPER(c.name) LIKE '%ESPECIALIDAD%'");
    return;
  }

  if (requestedStudyType === "undergraduate") {
    whereParts.push("UPPER(c.name) NOT LIKE '%MAESTRÍA%'");
    whereParts.push("UPPER(c.name) NOT LIKE '%MAESTRIA%'");
    whereParts.push("UPPER(c.name) NOT LIKE '%DOCTORADO%'");
    whereParts.push("UPPER(c.name) NOT LIKE '%ESPECIALIDAD%'");
    whereParts.push("UPPER(c.name) NOT LIKE '%BACHILLERATO%'");
  }
}

export function normalizeText(text) {
  return `${text || ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectEducativeIntent(message) {
  const normalizedMessage = normalizeText(message);

  if (!normalizedMessage) {
    return false;
  }

  return EDUCATIVE_INTENT_PHRASES.some(
    (phrase) => phraseScore(normalizedMessage, normalizeText(phrase)) > 0
  );
}

export function detectEducativeFollowUp(message) {
  const normalizedMessage = normalizeText(message);

  if (!normalizedMessage) {
    return false;
  }

  return EDUCATIVE_FOLLOW_UP_PHRASES.some((phrase) => {
    const normalizedPhrase = normalizeText(phrase);
    return normalizedPhrase === "mas"
      ? normalizedMessage === "mas"
      : normalizedMessage.includes(normalizedPhrase);
  });
}

export function detectEducativePureFollowUp(message) {
  return EDUCATIVE_PURE_FOLLOW_UP_MESSAGES.has(normalizeText(message));
}

export function detectEducativeSearchReset(message) {
  const normalizedMessage = normalizeText(message);
  return EDUCATIVE_SEARCH_RESET_PHRASES.some((phrase) =>
    normalizedMessage.includes(normalizeText(phrase))
  );
}

export function detectEducativeRefinement(message) {
  const normalizedMessage = normalizeText(message);

  if (!normalizedMessage) {
    return false;
  }

  return EDUCATIVE_REFINEMENT_PHRASES.some(
    (phrase) => phraseScore(normalizedMessage, normalizeText(phrase)) > 0
  );
}

export function inferRequestedLevel(message, matchedCategories = [], requestedStudyType = null) {
  if (requestedStudyType === "prepa") {
    return "1";
  }

  if (["tsu", "undergraduate", "maestria", "doctorado", "posgrado", "especialidad"].includes(requestedStudyType)) {
    return "2";
  }

  const explicitLevel = getLastExplicitLevel(message);

  if (explicitLevel) {
    return explicitLevel;
  }

  const preferredLevel = matchedCategories.find((category) => category.preferredLevel)?.preferredLevel;
  return preferredLevel || null;
}

function getLastNonFollowUpUserText(recentUserTexts = []) {
  return [...recentUserTexts]
    .reverse()
    .find((text) => {
      const value = toText(text);
      return value && !detectEducativePureFollowUp(value);
    }) || "";
}

function resolveEducativeQuery(currentText, recentUserTexts, isPureFollowUp) {
  if (!isPureFollowUp) {
    return currentText;
  }

  return getLastNonFollowUpUserText(recentUserTexts) || currentText;
}

function buildSearchSignature(
  matchedCategories,
  requestedStudyType,
  requestedLevel,
  matchedPrograms = []
) {
  const categories = (matchedCategories || [])
    .map((category) => category.key)
    .filter(Boolean)
    .sort();
  const programs = uniqueValues((matchedPrograms || []).map((match) =>
    `${match.categoryKey}:${match.bucket}:${normalizeText(match.program)}`
  )).sort();
  const programGroups = getAllowedProgramBuckets(requestedStudyType).sort();

  return JSON.stringify({
    categories,
    programs,
    requestedStudyType: requestedStudyType || null,
    requestedLevel: requestedLevel || null,
    programGroups,
  });
}
export function extractShownOfferIdsFromMessages(messages = []) {
  const ids = [];

  for (const message of messages || []) {
    const text = toText(message);

    for (const match of text.matchAll(OFFER_DETAIL_ID_PATTERN)) {
      ids.push(formatOfferId(match[1]));
    }

    for (const match of text.matchAll(OFFER_ID_TEXT_PATTERN)) {
      ids.push(formatOfferId(match[1]));
    }
  }

  return uniqueValues(ids);
}

export function buildEducativeSearchContext({
  message,
  userMessages = [],
  assistantMessages = [],
  excludeShownIds = [],
} = {}) {
  const currentText = toText(message);
  const recentUserTexts = (userMessages || [])
    .map(toText)
    .filter(Boolean)
    .slice(-MAX_USER_MESSAGES_FOR_CONTEXT);
  const isEducativeIntent = detectEducativeIntent(currentText);
  const isFollowUp = detectEducativeFollowUp(currentText);
  const isPureFollowUp = detectEducativePureFollowUp(currentText);
  const isExplicitSearchReset = detectEducativeSearchReset(currentText);
  const isRefinement = detectEducativeRefinement(currentText);
  const previousSearchText = getLastNonFollowUpUserText(recentUserTexts);
  const currentMatches = getCategoryMatches(currentText);
  const previousSearchMatches = previousSearchText ? getCategoryMatches(previousSearchText) : [];
  const currentProgramMatches = getProgramMatches(currentText);
  const previousProgramMatches = previousSearchText ? getProgramMatches(previousSearchText) : [];
  const shouldUsePreviousMatches = isPureFollowUp || (isRefinement && currentMatches.length === 0);
  const previousMatches = shouldUsePreviousMatches ? previousSearchMatches : [];
  const triggerMatchedCategories = uniqueValues(
    [...currentMatches, ...previousMatches].map((category) => category.key)
  )
    .map((key) => [...currentMatches, ...previousMatches].find((category) => category.key === key))
    .filter(Boolean);
  const shouldUsePreviousProgramMatches =
    isPureFollowUp ||
    (isRefinement && currentProgramMatches.length === 0 && currentMatches.length === 0);
  const matchedPrograms = currentProgramMatches.length
    ? currentProgramMatches
    : shouldUsePreviousProgramMatches
      ? previousProgramMatches
      : [];
  const matchedCategories = matchedPrograms.length
    ? getCategoriesForProgramMatches(matchedPrograms)
    : triggerMatchedCategories;
  const resolvedQuery = resolveEducativeQuery(currentText, recentUserTexts, isPureFollowUp);
  const studyTypeSourceText = isPureFollowUp ? resolvedQuery : currentText;
  const explicitRequestedStudyType = getLastExplicitStudyType(studyTypeSourceText);
  const requestedStudyType =
    explicitRequestedStudyType ||
    getStudyTypeForProgramMatches(matchedPrograms) ||
    inferRequestedStudyType(studyTypeSourceText, [], matchedCategories, false);
  const requestedLevel = inferRequestedLevel(studyTypeSourceText, matchedCategories, requestedStudyType);
  const searchSignature = buildSearchSignature(
    matchedCategories,
    requestedStudyType,
    requestedLevel,
    matchedPrograms
  );
  const previousMatchedCategories = previousProgramMatches.length
    ? getCategoriesForProgramMatches(previousProgramMatches)
    : previousSearchMatches;
  const previousExplicitStudyType = previousSearchText
    ? getLastExplicitStudyType(previousSearchText)
    : null;
  const previousRequestedStudyType = previousSearchText
    ? previousExplicitStudyType ||
      getStudyTypeForProgramMatches(previousProgramMatches) ||
      inferRequestedStudyType(previousSearchText, [], previousMatchedCategories, false)
    : null;
  const previousRequestedLevel = previousSearchText
    ? inferRequestedLevel(previousSearchText, previousMatchedCategories, previousRequestedStudyType)
    : null;
  const previousSearchSignature = previousSearchText
    ? buildSearchSignature(
        previousMatchedCategories,
        previousRequestedStudyType,
        previousRequestedLevel,
        previousProgramMatches
      )
    : null;
  const sameSearchContinuation = Boolean(
    !isExplicitSearchReset && previousSearchSignature && searchSignature === previousSearchSignature
  );
  const shouldReuseExcludedOfferIds = sameSearchContinuation;
  const careerKeywords = uniqueValues([
    ...matchedPrograms.flatMap((match) => match.aliases || [match.program]),
    ...getCareerKeywordsForCategories(matchedCategories, requestedStudyType),
  ]);
  const excludedOfferIds = uniqueValues([
    ...(shouldReuseExcludedOfferIds
      ? extractShownOfferIdsFromMessages(assistantMessages)
      : []),
    ...(excludeShownIds || []).map(formatOfferId),
  ]);

  return {
    isEducativeIntent,
    isFollowUp,
    isPureFollowUp,
    isExplicitSearchReset,
    isRefinement,
    sameSearchContinuation,
    searchText: normalizeText([resolvedQuery, currentText].filter(Boolean).join(" ")),
    originalQuery: resolvedQuery,
    resolvedQuery,
    matchedCategories,
    matchedPrograms,
    careerKeywords,
    requestedLevel,
    requestedStudyType,
    studyType: requestedStudyType,
    searchSignature,
    previousSearchSignature,
    excludedOfferIds,
    shownOfferIds: excludedOfferIds,
    allMatchedOfferIds: [],
    totalMatches: 0,
    remainingCount: 0,
    noMoreResults: false,
    offerContext: [],
  };
}

function getOfferLevelLabel(offer) {
  const careerTypes = (offer.careers || []).map(getCareerStudyType);

  if (`${offer.level}` === "1") {
    return "Prepa / Bachillerato";
  }

  if (careerTypes.includes("tsu") && careerTypes.includes("undergraduate")) {
    return "Universidad / TSU";
  }

  if (careerTypes.includes("tsu")) {
    return "TSU / Tecnico Superior Universitario";
  }

  if (careerTypes.includes("maestria")) {
    return "Maestria";
  }

  if (careerTypes.includes("doctorado")) {
    return "Doctorado";
  }

  if (careerTypes.includes("especialidad")) {
    return "Especialidad";
  }

  return "Universidad";
}

function getSearchDescription(searchResult) {
  const categoryLabel = searchResult.matchedCategories?.[0]?.label;
  const studyTypeLabels = {
    prepa: "prepa o bachillerato",
    tsu: "TSU o Tecnico Superior Universitario",
    undergraduate: "licenciatura, ingenieria o carrera profesional",
    maestria: "maestria",
    doctorado: "doctorado",
    especialidad: "especialidad",
    posgrado: "posgrado",
  };
  const studyLabel = studyTypeLabels[searchResult.requestedStudyType] || "opciones educativas";

  return categoryLabel ? `${categoryLabel} (${studyLabel})` : studyLabel;
}

function formatOfferCareers(offer) {
  const careers = (offer.careers || []).filter(Boolean).slice(0, MAX_CAREERS_PER_OFFER);
  return careers.length ? careers.join("; ") : "Programa relacionado disponible";
}

export function buildEducativeSearchReply(searchResult) {
  const offers = searchResult.offerContext || [];

  if (!offers.length) {
    return "No encontre mas opciones en la base con esos filtros. Puedes intentar con otra carrera, area o nivel de estudios.";
  }

  const intro = searchResult.isFollowUp
    ? "Claro, aqui tienes mas opciones:"
    : `Encontre estas opciones para estudiar ${getSearchDescription(searchResult)}:`;
  const optionLines = offers.map((offer, index) => [
    `${index + 1}. ${offer.name}${offer.short_name ? ` (${offer.short_name})` : ""}`,
    `Carrera/programa: ${formatOfferCareers(offer)}`,
    `Nivel: ${getOfferLevelLabel(offer)}`,
    `Municipio: ${offer.municipality || "No especificado"}`,
    `Mas informacion: ${offer.redirect_url}`,
  ].join("\n"));
  const footer = searchResult.remainingCount > 0
    ? "Si quieres, puedo darte mas opciones."
    : "Estas son las opciones que encontre con esos filtros.";

  return [intro, "", ...optionLines.flatMap((line) => [line, ""]), footer].join("\n").trim();
}

export async function searchEducativeOffers({
  prisma,
  message,
  userMessages = [],
  assistantMessages = [],
  excludeShownIds = [],
  limit = MAX_CONTEXT_RESULTS,
} = {}) {
  if (!prisma?.$queryRawUnsafe) {
    throw new Error("A Prisma client with $queryRawUnsafe is required");
  }

  const searchContext = buildEducativeSearchContext({
    message,
    userMessages,
    assistantMessages,
    excludeShownIds,
  });
  const shouldSearch =
    searchContext.isEducativeIntent ||
    searchContext.isFollowUp ||
    searchContext.isRefinement ||
    searchContext.matchedCategories.length > 0;

  if (!shouldSearch || !searchContext.careerKeywords.length) {
    console.log("EDUCATIVE INTENT", searchContext.isEducativeIntent);
    console.log("EDUCATIVE FOLLOW UP", searchContext.isFollowUp);
    console.log("EDUCATIVE PURE FOLLOW UP", searchContext.isPureFollowUp);
    console.log("EDUCATIVE REFINEMENT", searchContext.isRefinement);
    console.log("SAME SEARCH CONTINUATION", searchContext.sameSearchContinuation);
    console.log("EDUCATIVE SEARCH RESET", searchContext.isExplicitSearchReset);
    console.log("REQUESTED LEVEL", searchContext.requestedLevel);
    console.log("REQUESTED STUDY TYPE", searchContext.requestedStudyType);
    console.log("MATCHED EDUCATIVE CATEGORIES", searchContext.matchedCategories.map((category) => category.key));
    console.log("SEARCH SIGNATURE", searchContext.searchSignature);
    console.log("CAREER KEYWORDS USED", searchContext.careerKeywords);
    console.log("EXCLUDED OFFER IDS", searchContext.excludedOfferIds);
    console.log("OFFER CONTEXT", []);
    return {
      ...searchContext,
      shownOfferIds: searchContext.excludedOfferIds,
      allMatchedOfferIds: [],
      totalMatches: 0,
      remainingCount: 0,
      noMoreResults: shouldSearch,
    };
  }

  const params = [];
  const whereParts = [
    "o.active = 1",
    "c.active = 1",
    "o.redirect_url IS NOT NULL",
    "TRIM(o.redirect_url) <> ''",
    "c.name IS NOT NULL",
    "TRIM(c.name) <> ''",
    "UPPER(c.name) NOT LIKE '%TODO LO QUE DESEAS%'",
    "UPPER(c.name) NOT LIKE '%NUESTRA OFERTA EDUCATIVA%'",
    "UPPER(c.name) NOT LIKE '%OFERTA EDUCATIVA%'",
  ];

  if (searchContext.requestedLevel) {
    whereParts.push("o.level = ?");
    params.push(searchContext.requestedLevel);
  }

  addStudyTypeFilters(whereParts, searchContext.requestedStudyType);

  whereParts.push(
    `(${searchContext.careerKeywords.map(() => "UPPER(c.name) LIKE ? ESCAPE \'\\\\\'").join(" OR ")})`
  );
  params.push(...searchContext.careerKeywords.map((keyword) => `%${escapeSqlLike(keyword)}%`));

  const sql = `
    SELECT
      o.id,
      o.name,
      o.short_name,
      o.level,
      o.municipality,
      o.redirect_url,
      GROUP_CONCAT(DISTINCT c.name ORDER BY c.name SEPARATOR '|||') AS careers,
      COUNT(DISTINCT c.id) AS matchScore
    FROM tbl_educative_offer_campus_careers c
    JOIN tbl_educative_offer_campuses campus
      ON campus.id = c.ev_educative_offer_campus_id
    JOIN tbl_educative_offer o
      ON o.id = campus.ev_educative_offer_id
    WHERE ${whereParts.join(" AND ")}
    GROUP BY
      o.id,
      o.name,
      o.short_name,
      o.level,
      o.municipality,
      o.redirect_url
    ORDER BY matchScore DESC, o.name ASC
    LIMIT ?
  `;
  params.push(MAX_CANDIDATE_RESULTS);

  const rows = await prisma.$queryRawUnsafe(sql, ...params);
  const excludedOfferIdSet = new Set(searchContext.excludedOfferIds.map((offerId) => `${offerId}`));
  const contextLimit = Math.min(Math.max(Number(limit) || MAX_CONTEXT_RESULTS, 1), MAX_CONTEXT_RESULTS);
  const candidateOffers = rows
    .map((row) => mapOfferRow(row, searchContext.matchedCategories, searchContext.requestedStudyType, searchContext))
    .filter((offer) => offer.studyPriority > 0)
    .sort((a, b) =>
      b.studyPriority - a.studyPriority ||
      b.programRelevanceScore - a.programRelevanceScore ||
      b.queryRelevanceScore - a.queryRelevanceScore ||
      b.careerRelevanceScore - a.careerRelevanceScore ||
      b.matchScore - a.matchScore ||
      a.name.localeCompare(b.name)
    );
  const allMatchedOfferIds = candidateOffers.map((offer) => `${offer.id}`);
  const shownOfferIds = searchContext.excludedOfferIds.filter((offerId) =>
    allMatchedOfferIds.includes(`${offerId}`)
  );
  const availableOffers = candidateOffers.filter((offer) => !excludedOfferIdSet.has(`${offer.id}`));
  const offerContext = availableOffers.slice(0, contextLimit).map(toPublicOffer);

  const result = {
    ...searchContext,
    offerContext,
    allMatchedOfferIds,
    totalMatches: candidateOffers.length,
    shownOfferIds,
    remainingCount: Math.max(availableOffers.length - offerContext.length, 0),
    noMoreResults: offerContext.length === 0,
  };

  console.log("EDUCATIVE INTENT", result.isEducativeIntent);
  console.log("EDUCATIVE FOLLOW UP", result.isFollowUp);
  console.log("EDUCATIVE PURE FOLLOW UP", result.isPureFollowUp);
  console.log("EDUCATIVE REFINEMENT", result.isRefinement);
  console.log("SAME SEARCH CONTINUATION", result.sameSearchContinuation);
  console.log("EDUCATIVE SEARCH RESET", result.isExplicitSearchReset);
  console.log("REQUESTED LEVEL", result.requestedLevel);
  console.log("REQUESTED STUDY TYPE", result.requestedStudyType);
  console.log("MATCHED EDUCATIVE CATEGORIES", result.matchedCategories.map((category) => category.key));
  console.log("SEARCH SIGNATURE", result.searchSignature);
  console.log("CAREER KEYWORDS USED", result.careerKeywords);
  console.log("EXCLUDED OFFER IDS", result.excludedOfferIds);
  console.log("OFFER CONTEXT", result.offerContext);

  return result;
}


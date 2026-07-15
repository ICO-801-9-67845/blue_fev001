import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const relations = JSON.parse(
  readFileSync(join(__dirname, "../config/educativeProgramRelations.json"), "utf8")
    .replace(/^\uFEFF/, ""),
);

const programs = relations.programs || {};
const aliasIndex = new Map();

export function normalizeProgramText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getStateLevelForAcademicLevel(level) {
  if (["bachillerato", "tecnico_bachillerato"].includes(level)) return "prepa";
  if (level === "tsu") return "tsu";
  if (["licenciatura", "ingenieria"].includes(level)) return "undergraduate";
  return "posgrado";
}

export function getStudyTypeForAcademicLevel(level) {
  if (["bachillerato", "tecnico_bachillerato"].includes(level)) return "prepa";
  if (level === "tsu") return "tsu";
  if (["licenciatura", "ingenieria"].includes(level)) return "undergraduate";
  if (level === "especialidad") return "especialidad";
  if (level === "maestria") return "maestria";
  if (level === "doctorado") return "doctorado";
  return null;
}

for (const [programId, program] of Object.entries(programs)) {
  const aliases = [
    ...(program.exactAliases || []).map((alias) => ({ alias, inputOnly: false })),
    ...(program.inputAliases || []).map((alias) => ({ alias, inputOnly: true })),
  ];
  for (const { alias, inputOnly } of aliases) {
    const normalized = normalizeProgramText(alias);
    const entries = aliasIndex.get(normalized) || [];
    if (!entries.some((entry) => entry.programId === programId)) {
      entries.push({ programId, program, alias, normalized, inputOnly });
      aliasIndex.set(normalized, entries);
    }
  }
}

function academicLevelsForText(text) {
  const normalized = normalizeProgramText(text);
  if (/\b(BACHILLERATO|PREPA|PREPARATORIA|MEDIA SUPERIOR)\b/.test(normalized)) {
    return new Set(["bachillerato", "tecnico_bachillerato"]);
  }
  if (/\b(TSU|T S U|TECNICO SUPERIOR UNIVERSITARIO)\b/.test(normalized)) {
    return new Set(["tsu"]);
  }
  if (/\bESPECIALIDAD\b/.test(normalized)) return new Set(["especialidad"]);
  if (/\b(MAESTRIA|MASTER)\b/.test(normalized)) return new Set(["maestria"]);
  if (/\bDOCTORADO\b/.test(normalized)) return new Set(["doctorado"]);
  return new Set(["licenciatura", "ingenieria"]);
}

function containsAt(normalizedText, normalizedAlias, start) {
  const before = start === 0 ? " " : normalizedText[start - 1];
  const end = start + normalizedAlias.length;
  const after = end >= normalizedText.length ? " " : normalizedText[end];
  return before === " " && after === " ";
}

function toCareerCandidate(programId, program, matchedAlias) {
  return {
    name: program.displayName,
    normalizedName: normalizeProgramText(program.displayName),
    level: getStateLevelForAcademicLevel(program.level),
    academicLevel: program.level,
    searchQuery: program.canonicalName,
    canonicalProgramId: programId,
    familyId: program.familyId || null,
    exactAliases: [...program.exactAliases],
    matchedAlias,
  };
}

export function getEducativeProgramRelations() {
  return relations;
}

export function getCanonicalProgram(programId) {
  const program = programs[programId];
  return program ? { id: programId, ...program } : null;
}

export function getProgramFamily(familyId) {
  const family = relations.families?.[familyId];
  return family ? { id: familyId, ...family } : null;
}

export function resolveCanonicalProgram(alias, academicLevel = null) {
  const entries = aliasIndex.get(normalizeProgramText(alias)) || [];
  const filtered = academicLevel
    ? entries.filter((entry) => entry.program.level === academicLevel)
    : entries;
  if (filtered.length !== 1) return null;
  const entry = filtered[0];
  return toCareerCandidate(entry.programId, entry.program, entry.alias);
}

export function detectCanonicalProgramOptions(text, { limit = 3 } = {}) {
  const normalizedText = normalizeProgramText(text);
  if (!normalizedText) return [];

  const allowedLevels = academicLevelsForText(text);
  const queryCore = normalizedText.replace(
    /^(?:QUIERO ESTUDIAR|ME INTERESA ESTUDIAR|BUSCO ESTUDIAR|QUIERO VER OPCIONES DE|OPCIONES DE)\s+/,
    "",
  );
  const allowsPrefixExpansion =
    queryCore.length >= 10 &&
    /\b(BACHILLERATO|PREPA|TSU|TECNICO SUPERIOR UNIVERSITARIO)\b/.test(queryCore);
  const matches = [];
  for (const [normalizedAlias, entries] of aliasIndex) {
    if (normalizedAlias.length < 4) continue;
    if (
      allowsPrefixExpansion &&
      normalizedAlias.startsWith(queryCore + " ")
    ) {
      for (const entry of entries) {
        if (allowedLevels.has(entry.program.level)) {
          matches.push({
            ...entry,
            start: 0,
            end: queryCore.length,
            length: queryCore.length,
            prefixExpanded: true,
          });
        }
      }
    }
    let start = normalizedText.indexOf(normalizedAlias);
    while (start !== -1) {
      if (containsAt(normalizedText, normalizedAlias, start)) {
        for (const entry of entries) {
          if (allowedLevels.has(entry.program.level)) {
            matches.push({
              ...entry,
              start,
              end: start + normalizedAlias.length,
              length: normalizedAlias.length,
            });
          }
        }
      }
      start = normalizedText.indexOf(normalizedAlias, start + 1);
    }
  }
  const directMatches = matches.filter((match) => !match.prefixExpanded);
  if (!directMatches.length && matches.some((match) => match.prefixExpanded)) {
    const byId = new Map();
    for (const match of matches) {
      if (!byId.has(match.programId)) byId.set(match.programId, match);
    }
    return [...byId.values()]
      .sort((left, right) =>
        left.program.canonicalName.localeCompare(right.program.canonicalName, "es")
      )
      .slice(0, limit)
      .map((match) => toCareerCandidate(match.programId, match.program, match.alias));
  }

  matches.sort((left, right) =>
    right.length - left.length ||
    left.start - right.start ||
    left.programId.localeCompare(right.programId),
  );

  const occupied = [];
  const selected = [];
  const selectedIds = new Set();
  for (const match of matches) {
    if (selectedIds.has(match.programId)) continue;
    const overlaps = occupied.some(([start, end]) =>
      match.start < end && match.end > start,
    );
    if (overlaps) continue;
    selected.push(toCareerCandidate(match.programId, match.program, match.alias));
    selectedIds.add(match.programId);
    occupied.push([match.start, match.end]);
    if (selected.length === limit) break;
  }

  return selected;
}

export function getFamilyCandidateIds(programId) {
  const program = programs[programId];
  if (!program?.familyId) return [];
  return (relations.families?.[program.familyId]?.memberProgramIds || [])
    .filter((memberId) => memberId !== programId);
}

export function getNearbyCandidateIds(programId) {
  return [...(programs[programId]?.nearbyProgramIds || [])];
}

export function toCanonicalCareerCandidate(programId) {
  const program = programs[programId];
  return program ? toCareerCandidate(programId, program, program.canonicalName) : null;
}

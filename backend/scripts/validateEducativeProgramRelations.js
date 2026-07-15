import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const configPath = join(root, "src/config/educativeProgramRelations.json");
const inventoryPath = process.env.EDUCATIVE_WORD_INVENTORY ||
  resolve(root, "../tmp/educative-program-relations/word-program-inventory.json");

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const errors = [];
const config = JSON.parse(readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8").replace(/^\uFEFF/, ""));
const programs = config.programs || {};
const families = config.families || {};
const allowedLevels = new Set(config.allowedLevels || []);
const aliasOwners = new Map();
const sourceOwners = new Map();
const familyMemberships = new Map();
const genericPatterns = [
  "TODO LO QUE DESEAS",
  "NUESTRA OFERTA EDUCATIVA",
  "OFERTA EDUCATIVA LO ENCUENTRAS",
  "PAGINA WEB Y REDES",
];

function requireUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) errors.push(label + " contiene duplicado: " + value);
    seen.add(value);
  }
}

for (const [programId, program] of Object.entries(programs)) {
  if (!programId) errors.push("Existe un ID de programa vacio");
  if (!program.canonicalName) errors.push(programId + " no tiene canonicalName");
  if (!program.displayName) errors.push(programId + " no tiene displayName");
  if (!allowedLevels.has(program.level)) errors.push(programId + " tiene nivel invalido: " + program.level);
  if (!Array.isArray(program.exactAliases) || !program.exactAliases.length) {
    errors.push(programId + " no tiene exactAliases");
  }
  requireUnique(program.exactAliases || [], programId + ".exactAliases");
  requireUnique(program.sourceKeys || [], programId + ".sourceKeys");
  requireUnique(program.nearbyProgramIds || [], programId + ".nearbyProgramIds");

  for (const alias of program.exactAliases || []) {
    const normalized = normalize(alias);
    const key = program.level + "|" + normalized;
    const previous = aliasOwners.get(key);
    if (previous && previous !== programId) {
      errors.push("Alias ambiguo en el mismo nivel: " + alias + " -> " + previous + ", " + programId);
    }
    aliasOwners.set(key, programId);
    if (genericPatterns.some((pattern) => normalized.includes(pattern))) {
      errors.push(programId + " trata texto informativo como alias: " + alias);
    }
  }

  for (const sourceKey of program.sourceKeys || []) {
    const previous = sourceOwners.get(sourceKey);
    if (previous && previous !== programId) {
      errors.push("Programa del Word clasificado dos veces: " + sourceKey);
    }
    sourceOwners.set(sourceKey, programId);
  }

  if (program.familyId) {
    if (!families[program.familyId]) errors.push(programId + " referencia familia inexistente: " + program.familyId);
    const memberships = familyMemberships.get(programId) || [];
    memberships.push(program.familyId);
    familyMemberships.set(programId, memberships);
  }

  for (const nearbyId of program.nearbyProgramIds || []) {
    if (nearbyId === programId) errors.push(programId + " se referencia a si mismo");
    const nearby = programs[nearbyId];
    if (!nearby) errors.push(programId + " referencia nearby inexistente: " + nearbyId);
    else if (nearby.level !== program.level) {
      errors.push(programId + " mezcla nivel con nearby " + nearbyId);
    }
    if (!config.nearbyRationales?.[programId + ">" + nearbyId]) {
      errors.push(programId + " no documenta justificacion para nearby " + nearbyId);
    }
  }
}

for (const [familyId, family] of Object.entries(families)) {
  if (!family.displayName) errors.push(familyId + " no tiene displayName");
  if (!allowedLevels.has(family.level)) errors.push(familyId + " tiene nivel invalido");
  if (!Array.isArray(family.memberProgramIds) || family.memberProgramIds.length < 2) {
    errors.push(familyId + " debe tener al menos dos miembros");
  }
  requireUnique(family.memberProgramIds || [], familyId + ".memberProgramIds");
  for (const programId of family.memberProgramIds || []) {
    const program = programs[programId];
    if (!program) errors.push(familyId + " contiene programa inexistente: " + programId);
    else {
      if (program.level !== family.level) errors.push(familyId + " mezcla nivel con " + programId);
      if (program.familyId !== familyId) errors.push(programId + " no referencia reciprocamente a " + familyId);
      const memberships = familyMemberships.get(programId) || [];
      if (!memberships.includes(familyId)) memberships.push(familyId);
      familyMemberships.set(programId, memberships);
    }
  }
}

for (const [programId, memberships] of familyMemberships) {
  if (new Set(memberships).size > 1) errors.push(programId + " aparece en mas de una familia");
}

const wordKeys = new Set((inventory.uniquePrograms || []).map((entry) => entry.key));
for (const key of wordKeys) {
  if (!sourceOwners.has(key)) errors.push("Programa unico del Word sin clasificar: " + key);
}
for (const key of sourceOwners.keys()) {
  if (!wordKeys.has(key)) errors.push("Programa clasificado no aparece en el Word: " + key);
}
if (sourceOwners.size !== wordKeys.size) {
  errors.push("Cobertura del Word incoherente: " + sourceOwners.size + " de " + wordKeys.size);
}

for (const excluded of config.excludedSourceEntries || []) {
  if (!excluded.reason) errors.push("Entrada excluida sin motivo: " + excluded.originalName);
  if (!genericPatterns.some((pattern) => normalize(excluded.originalName).includes(pattern))) {
    errors.push("Entrada excluida sin patron informativo comprobado: " + excluded.originalName);
  }
}
if ((config.excludedSourceEntries || []).length !== (inventory.excludedEntries || []).length) {
  errors.push("No coinciden las entradas excluidas del Word");
}
for (const issue of inventory.spellingIssues || []) {
  const documented = (config.normalizationNotes || []).some((note) =>
    note.original === issue.original &&
    note.normalizedCorrection === issue.normalizedCorrection
  );
  if (!documented) {
    errors.push("Normalizacion ortografica sin documentar: " + issue.original);
  }
}
if (JSON.stringify(config).includes("categoryKey")) {
  errors.push("La clasificacion depende de categoryKey");
}

const result = {
  configPath,
  inventoryPath,
  programs: Object.keys(programs).length,
  aliases: aliasOwners.size,
  families: Object.keys(families).length,
  sourcePrograms: wordKeys.size,
  excludedEntries: (config.excludedSourceEntries || []).length,
  errors,
};

console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;

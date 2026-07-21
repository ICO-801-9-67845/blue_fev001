import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const backendDirectory = resolve(scriptDirectory, "..");
const repositoryDirectory = resolve(backendDirectory, "..");

const paths = Object.freeze({
  catalog: resolve(backendDirectory, "src/config/vocationalCareerTraits.json"),
  relations: resolve(backendDirectory, "src/config/educativeProgramRelations.json"),
  lexicon: resolve(backendDirectory, "src/config/vocationalConceptLexicon.json"),
  reviewMatrix: resolve(
    repositoryDirectory,
    "tmp/vocational-career-ranking-review/program-review-matrix.json",
  ),
});

const EXPECTED_SOURCE_INTEGRITY = Object.freeze({
  relationsSha256: "6d283c681b912283d879d4f8e1c2ee861b54e284e1773a06497b2f1dc3b8dc04",
  lexiconSha256: "885135fa9829d18369ffa749bb96019cdc7123136addee4ba20e4a3a3babf917",
  reviewMatrixSha256: "c650f54e52959cc69c2ce8482d22fa91b4230892536a5bca93c25c8a2dc94ca7",
  catalogProgramCount: 462,
  approvedProgramCount: 25,
  approvedCoveragePercent: 5.41,
});

const EXPECTED_POLICIES = Object.freeze({
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
});

const EXPECTED_CATEGORIES = Object.freeze({
  architecture_design: Object.freeze([
    "licenciatura_diseno_ambiental_y_de_espacios",
    "licenciatura_diseno_de_interiores",
    "tecnico_bachillerato_construccion",
  ]),
  engineering_technology: Object.freeze(["tecnico_bachillerato_programacion"]),
  health_sciences: Object.freeze([
    "doctorado_doctorado_en_ciencias_medicas_salud",
    "licenciatura_ciencias_de_la_actividad_fisica_y_salud",
    "maestria_maestria_en_epidemiologia_y_administracion_en_salud",
  ]),
  arts_communication: Object.freeze([
    "licenciatura_diseno_animacion_y_arte_digital",
    "licenciatura_diseno_de_imagen",
    "licenciatura_diseno_de_imagen_y_relaciones_publicas",
    "licenciatura_diseno_grafico_digital",
    "licenciatura_diseno_grafico_estrategico",
    "maestria_maestria_en_diseno_de_imagen",
  ]),
  exact_sciences: Object.freeze([
    "licenciatura_computacion_matematica",
    "licenciatura_matematicas",
  ]),
  manufacturing_processes: Object.freeze([
    "ingenieria_diseno_industrial",
    "ingenieria_diseno_textil_y_moda",
    "licenciatura_diseno_de_moda",
    "licenciatura_diseno_de_moda_y_calzado",
    "licenciatura_diseno_de_modas_y_calzado",
    "licenciatura_diseno_industrial",
    "tsu_tecnico_superior_universitario_en_diseno_y_moda_industrial_area_calzado",
    "tsu_tecnico_superior_universitario_en_diseno_y_moda_industrial_area_producci",
  ]),
});

const DESIGN_PROGRAMS = [
  "especialidad_especialidad_en_diseno_digital",
  "ingenieria_diseno_industrial",
  "ingenieria_diseno_textil_y_moda",
  "licenciatura_diseno_ambiental_y_de_espacios",
  "licenciatura_diseno_animacion_y_arte_digital",
  "licenciatura_diseno_de_imagen",
  "licenciatura_diseno_de_imagen_y_relaciones_publicas",
  "licenciatura_diseno_de_interiores",
  "licenciatura_diseno_de_moda",
  "licenciatura_diseno_de_moda_y_calzado",
  "licenciatura_diseno_de_modas_y_calzado",
  "licenciatura_diseno_grafico_digital",
  "licenciatura_diseno_grafico_estrategico",
  "licenciatura_diseno_industrial",
  "licenciatura_diseno_y_gestion_de_redes_logisticas",
  "maestria_maestria_en_diseno_de_imagen",
  "tsu_tecnico_superior_universitario_en_diseno_y_moda_industrial_area_calzado",
  "tsu_tecnico_superior_universitario_en_diseno_y_moda_industrial_area_producci",
];

const EXPECTED_TRAITS = Object.freeze(Object.fromEntries([
  ...DESIGN_PROGRAMS.map((id) => [id, { design: id === "licenciatura_diseno_y_gestion_de_redes_logisticas" ? 3 : 5 }]),
  ["doctorado_doctorado_en_ciencias_medicas_salud", { health: 5 }],
  ["licenciatura_ciencias_de_la_actividad_fisica_y_salud", { health: 5 }],
  ["maestria_maestria_en_epidemiologia_y_administracion_en_salud", { health: 5 }],
  ["licenciatura_computacion_matematica", { mathematics: 5 }],
  ["licenciatura_matematicas", { mathematics: 5 }],
  ["tecnico_bachillerato_construccion", { construction: 5 }],
  ["tecnico_bachillerato_programacion", { programming: 5 }],
]));

const AMBIGUOUS_EXCLUSIONS = Object.freeze([
  "licenciatura_diseno_grafico",
  "tecnico_bachillerato_diseno_grafico",
  "tsu_tecnico_superior_universitario_en_terapia_fisica_area_turismo_de_salud_y",
]);

const PROGRAM_KEYS = Object.freeze([
  "categoryIds",
  "traitWeights",
  "requiredTraits",
  "conflictingTraits",
  "evidenceType",
  "reviewStatus",
]);

const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_RECORD_KEYS = 2048;
const MAX_STRING_LENGTH = 512;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const sha256 = (raw) => createHash("sha256").update(raw).digest("hex");
const sameArray = (left, right) => left.length === right.length
  && left.every((value, index) => value === right[index]);

function inspectRecord(value, label, errors, maxKeys = MAX_RECORD_KEYS) {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${label} must be a plain object`);
      return null;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      errors.push(`${label} has an unexpected prototype`);
      return null;
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length > maxKeys) {
      errors.push(`${label} exceeds the key limit`);
      return null;
    }
    const values = new Map();
    for (const key of ownKeys) {
      if (typeof key !== "string" || FORBIDDEN_KEYS.has(key)) {
        errors.push(`${label} contains a forbidden key`);
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        errors.push(`${label}.${key} must be an enumerable data property`);
        continue;
      }
      values.set(key, descriptor.value);
    }
    return values;
  } catch (error) {
    errors.push(`${label} could not be inspected safely: ${error.message}`);
    return null;
  }
}

function inspectArray(value, label, errors, maxLength) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      errors.push(`${label} must be a plain array`);
      return null;
    }
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isInteger(length) || length < 0 || length > maxLength) {
      errors.push(`${label} exceeds the array limit or has invalid length`);
      return null;
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== length + 1 || !ownKeys.includes("length")) {
      errors.push(`${label} contains holes or extra properties`);
      return null;
    }
    const items = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        errors.push(`${label}[${index}] must be an enumerable data property`);
        return null;
      }
      items.push(descriptor.value);
    }
    return items;
  } catch (error) {
    errors.push(`${label} could not be inspected safely: ${error.message}`);
    return null;
  }
}

function requireExactKeys(values, expectedKeys, label, errors) {
  if (!values) return false;
  const actualKeys = [...values.keys()].sort();
  const sortedExpected = [...expectedKeys].sort();
  if (!sameArray(actualKeys, sortedExpected)) {
    errors.push(`${label} keys are not exact`);
    return false;
  }
  return true;
}

function validShortString(value) {
  return typeof value === "string" && value.length <= MAX_STRING_LENGTH;
}

function bufferHashMatches(raw, expected, label, errors) {
  if (!Buffer.isBuffer(raw)) {
    errors.push(`${label} raw input must be a Buffer`);
    return false;
  }
  if (sha256(raw) !== expected) {
    errors.push(`${label} SHA-256 mismatch`);
    return false;
  }
  return true;
}

export function parseJson(raw, label) {
  const buffer = Buffer.isBuffer(raw)
    ? raw
    : typeof raw === "string"
      ? Buffer.from(raw, "utf8")
      : null;
  if (!buffer) throw new Error(`${label}: input must be a Buffer or string`);
  if (buffer.length > MAX_JSON_BYTES) throw new Error(`${label}: file exceeds size limit`);
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    throw new Error(`${label}: UTF-8 BOM is not allowed`);
  }
  if (!isUtf8(buffer)) throw new Error(`${label}: invalid UTF-8`);
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw new Error(`${label}: invalid JSON: ${error.message}`);
  }
}

export function loadValidationInputs() {
  const catalogRaw = readFileSync(paths.catalog);
  const relationsRaw = readFileSync(paths.relations);
  const lexiconRaw = readFileSync(paths.lexicon);
  const reviewMatrixRaw = existsSync(paths.reviewMatrix) ? readFileSync(paths.reviewMatrix) : null;
  return {
    catalogRaw,
    relationsRaw,
    lexiconRaw,
    reviewMatrixRaw,
    catalog: parseJson(catalogRaw, "catalog"),
    relations: parseJson(relationsRaw, "relations"),
    lexicon: parseJson(lexiconRaw, "lexicon"),
    reviewMatrix: reviewMatrixRaw ? parseJson(reviewMatrixRaw, "review matrix") : null,
  };
}

export function validateCatalog(catalog, inputs) {
  const errors = [];
  const summary = {
    catalogPrograms: 0,
    approvedPrograms: 0,
    categorizedPrograms: 0,
    unclassifiedPrograms: 0,
    categories: 0,
    requiredTraits: 0,
    conflicts: 0,
    coveragePercent: null,
  };
  const fail = (condition, message) => {
    if (!condition) errors.push(message);
  };

  try {
    const inputValues = inspectRecord(inputs, "inputs", errors, 16);
    if (!inputValues) return { valid: false, errors, summary };
    const relations = inputValues.get("relations");
    const lexicon = inputValues.get("lexicon");
    const reviewMatrix = inputValues.get("reviewMatrix");
    const relationsRaw = inputValues.get("relationsRaw");
    const lexiconRaw = inputValues.get("lexiconRaw");
    const reviewMatrixRaw = inputValues.get("reviewMatrixRaw");

    const root = inspectRecord(catalog, "catalog", errors, 6);
    if (!root) return { valid: false, errors, summary };
    requireExactKeys(root, ["version", "status", "sourceIntegrity", "policies", "categories", "programs"], "catalog", errors);
    fail(root.get("version") === 1, "version must be 1");
    fail(root.get("status") === "approved_minimal_initial_coverage", "status is invalid");

    const sourceIntegrity = inspectRecord(root.get("sourceIntegrity"), "sourceIntegrity", errors, 6);
    if (requireExactKeys(sourceIntegrity, Object.keys(EXPECTED_SOURCE_INTEGRITY), "sourceIntegrity", errors)) {
      for (const [key, expected] of Object.entries(EXPECTED_SOURCE_INTEGRITY)) {
        fail(sourceIntegrity.get(key) === expected, `sourceIntegrity.${key} is invalid`);
      }
      summary.coveragePercent = sourceIntegrity.get("approvedCoveragePercent");
      bufferHashMatches(relationsRaw, sourceIntegrity.get("relationsSha256"), "relations", errors);
      bufferHashMatches(lexiconRaw, sourceIntegrity.get("lexiconSha256"), "lexicon", errors);
      if (reviewMatrixRaw !== null && reviewMatrixRaw !== undefined) {
        bufferHashMatches(reviewMatrixRaw, sourceIntegrity.get("reviewMatrixSha256"), "review matrix", errors);
      }
    }

    const policies = inspectRecord(root.get("policies"), "policies", errors, 11);
    if (requireExactKeys(policies, Object.keys(EXPECTED_POLICIES), "policies", errors)) {
      for (const [key, expected] of Object.entries(EXPECTED_POLICIES)) {
        fail(policies.get(key) === expected, `policy ${key} is invalid`);
      }
    }

    const relationsRoot = inspectRecord(relations, "relations", errors);
    const relationPrograms = relationsRoot
      ? inspectRecord(relationsRoot.get("programs"), "relations.programs", errors, 1000)
      : null;
    const relationIds = relationPrograms ? [...relationPrograms.keys()] : [];
    summary.catalogPrograms = relationIds.length;
    fail(relationIds.length === 462, "relations must contain 462 programs");

    const lexiconRoot = inspectRecord(lexicon, "lexicon", errors);
    const conceptRows = lexiconRoot
      ? inspectArray(lexiconRoot.get("concepts"), "lexicon.concepts", errors, 256)
      : null;
    const conceptIds = new Set();
    for (const [index, concept] of (conceptRows ?? []).entries()) {
      const values = inspectRecord(concept, `lexicon.concepts[${index}]`, errors, 16);
      const id = values?.get("id");
      if (validShortString(id)) conceptIds.add(id);
    }

    const categoryRows = inspectArray(root.get("categories"), "categories", errors, 32) ?? [];
    const categoryIds = [];
    const categorizedIds = [];
    const categoryMemberships = new Map();
    summary.categories = categoryRows.length;
    fail(categoryRows.length === 6, "catalog must contain six categories");
    for (const [index, category] of categoryRows.entries()) {
      const values = inspectRecord(category, `categories[${index}]`, errors, 4);
      if (!requireExactKeys(values, ["id", "status", "inferenceEnabled", "programIds"], `categories[${index}]`, errors)) continue;
      const id = values.get("id");
      fail(validShortString(id), `category ${index} ID is invalid`);
      categoryIds.push(id);
      fail(values.get("status") === "active_explicit_only", `category ${id} status is invalid`);
      fail(values.get("inferenceEnabled") === false, `category ${id} inference must be disabled`);
      const programIds = inspectArray(values.get("programIds"), `category ${id}.programIds`, errors, 100) ?? [];
      fail(programIds.every(validShortString), `category ${id} contains an invalid program ID`);
      fail(new Set(programIds).size === programIds.length, `category ${id} contains duplicate programs`);
      const expectedIds = EXPECTED_CATEGORIES[id];
      fail(Array.isArray(expectedIds) && sameArray(programIds, expectedIds), `category ${id} allowlist differs from approval`);
      for (const programId of programIds) {
        categorizedIds.push(programId);
        const memberships = categoryMemberships.get(programId) ?? [];
        memberships.push(id);
        categoryMemberships.set(programId, memberships);
      }
    }
    fail(new Set(categoryIds).size === categoryIds.length, "category IDs must be unique");
    fail(sameArray(categoryIds, Object.keys(EXPECTED_CATEGORIES)), "category IDs or order differ from approval");
    fail(categorizedIds.length === 23, "exactly 23 category memberships are required");
    fail(new Set(categorizedIds).size === categorizedIds.length, "a program appears in multiple categories");
    summary.categorizedPrograms = new Set(categorizedIds).size;

    const programs = inspectRecord(root.get("programs"), "programs", errors, 1000);
    const configuredIds = programs ? [...programs.keys()] : [];
    summary.approvedPrograms = configuredIds.length;
    summary.unclassifiedPrograms = relationIds.length - configuredIds.length;
    fail(configuredIds.length === 25, "catalog must configure 25 programs");
    fail(summary.unclassifiedPrograms === 437, "catalog must leave 437 programs unclassified");
    fail(configuredIds.every((id) => relationPrograms?.has(id)), "configured program ID missing from relations");
    fail(sameArray(configuredIds, [...configuredIds].sort()), "program keys must use deterministic lexical order");
    fail(sameArray(configuredIds, Object.keys(EXPECTED_TRAITS).sort()), "approved program allowlist differs from the decision");
    fail(configuredIds.filter((id) => !categoryMemberships.has(id)).length === 2, "exactly two approved programs must have no category");

    let weightThreeCount = 0;
    for (const id of configuredIds) {
      const values = inspectRecord(programs.get(id), `program ${id}`, errors, 6);
      if (!requireExactKeys(values, PROGRAM_KEYS, `program ${id}`, errors)) continue;
      fail(values.get("evidenceType") === "canonical_name_exact", `program ${id} evidenceType is invalid`);
      fail(values.get("reviewStatus") === "approved_minimal_coverage", `program ${id} reviewStatus is invalid`);
      const categoryIdValues = inspectArray(values.get("categoryIds"), `program ${id}.categoryIds`, errors, 6) ?? [];
      const expectedCategoryIds = categoryMemberships.get(id) ?? [];
      fail(categoryIdValues.every(validShortString), `program ${id} has invalid categoryIds`);
      fail(sameArray(categoryIdValues, expectedCategoryIds), `program ${id} category cross-reference mismatch`);

      const traitWeights = inspectRecord(values.get("traitWeights"), `program ${id}.traitWeights`, errors, 8);
      const traitEntries = traitWeights ? [...traitWeights.entries()] : [];
      const expectedTraits = EXPECTED_TRAITS[id] ?? {};
      fail(traitEntries.length === 1, `program ${id} must have exactly one trait`);
      requireExactKeys(traitWeights, Object.keys(expectedTraits), `program ${id}.traitWeights`, errors);
      for (const [traitId, weight] of traitEntries) {
        fail(conceptIds.has(traitId), `program ${id} uses unknown trait ${traitId}`);
        fail(Number.isInteger(weight) && weight >= 1 && weight <= 5, `program ${id} has invalid weight`);
        fail(weight === expectedTraits[traitId], `program ${id} trait weight differs from approval`);
        if (weight === 3) weightThreeCount += 1;
      }

      const requiredTraits = inspectArray(values.get("requiredTraits"), `program ${id}.requiredTraits`, errors, 8) ?? [];
      const conflictingTraits = inspectArray(values.get("conflictingTraits"), `program ${id}.conflictingTraits`, errors, 8) ?? [];
      fail(requiredTraits.length === 0, `program ${id} requiredTraits must be empty`);
      fail(conflictingTraits.length === 0, `program ${id} conflictingTraits must be empty`);
      summary.requiredTraits += requiredTraits.length;
      summary.conflicts += conflictingTraits.length;
    }
    fail(weightThreeCount === 1, "exactly one weight must be 3");
    fail(summary.requiredTraits === 0, "requiredTraits must be empty globally");
    fail(summary.conflicts === 0, "conflictingTraits must be empty globally");
    fail(AMBIGUOUS_EXCLUSIONS.every((id) => !programs?.has(id)), "an ambiguous program was configured");

    if (reviewMatrixRaw !== null && reviewMatrixRaw !== undefined) {
      const reviewRoot = inspectRecord(reviewMatrix, "reviewMatrix", errors);
      const reviewRows = reviewRoot
        ? inspectArray(reviewRoot.get("programs"), "reviewMatrix.programs", errors, 1000)
        : null;
      const batches = new Map();
      for (const [index, row] of (reviewRows ?? []).entries()) {
        const values = inspectRecord(row, `reviewMatrix.programs[${index}]`, errors, 64);
        const id = values?.get("canonicalProgramId");
        const batch = values?.get("reviewBatch");
        if (validShortString(id) && validShortString(batch)) batches.set(id, batch);
      }
      fail(configuredIds.every((id) => batches.get(id) === "A"), "only review batch A may be configured");
    }
  } catch (error) {
    errors.push(`validation failed closed: ${error.message}`);
  }

  return { valid: errors.length === 0, errors, summary };
}

function run() {
  try {
    const inputs = loadValidationInputs();
    const result = validateCatalog(inputs.catalog, inputs);
    console.log(JSON.stringify(result.summary, null, 2));
    if (!result.valid) {
      for (const error of result.errors) console.error(`FAIL ${error}`);
      process.exitCode = 1;
      return;
    }
    console.log("VOCATIONAL_CAREER_TRAITS_VALIDATION_PASS");
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();

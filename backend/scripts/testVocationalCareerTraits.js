import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  loadValidationInputs,
  parseJson,
  validateCatalog,
} from "./validateVocationalCareerTraits.js";

const inputs = loadValidationInputs();
const catalog = inputs.catalog;
const results = [];
const clone = (value) => structuredClone(value);
const configured = (id) => Object.hasOwn(catalog.programs, id);
const validateMutation = (mutate, inputOverrides = {}) => {
  const candidate = clone(catalog);
  mutate(candidate);
  return validateCatalog(candidate, { ...inputs, ...inputOverrides });
};

async function test(name, callback) {
  try {
    await callback();
    results.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

await test("01 catalog loads", () => assert.equal(validateCatalog(catalog, inputs).valid, true));
await test("02 validation does not mutate configuration", () => {
  const candidate = clone(catalog);
  const before = JSON.stringify(candidate);
  validateCatalog(candidate, inputs);
  assert.equal(JSON.stringify(candidate), before);
});
await test("03 exactly 25 approved programs", () => assert.equal(Object.keys(catalog.programs).length, 25));
await test("04 exactly 23 categorized programs", () => {
  assert.equal(new Set(catalog.categories.flatMap(({ programIds }) => programIds)).size, 23);
});
await test("05 exactly two approved programs without category", () => {
  assert.equal(Object.values(catalog.programs).filter(({ categoryIds }) => categoryIds.length === 0).length, 2);
});
await test("06 exactly six active categories", () => assert.equal(catalog.categories.length, 6));
await test("07 approved coverage is 5.41 percent", () => assert.equal(catalog.sourceIntegrity.approvedCoveragePercent, 5.41));
await test("08 exactly 437 programs remain implicitly unclassified", () => {
  assert.equal(Object.keys(inputs.relations.programs).length - Object.keys(catalog.programs).length, 437);
});
await test("09 known approved program is configured", () => assert.equal(configured("licenciatura_matematicas"), true));
await test("10 known non-approved program is not configured", () => assert.equal(configured("licenciatura_administracion"), false));
await test("11 architecture remains unclassified", () => assert.equal(configured("licenciatura_arquitectura"), false));
await test("12 psychology remains unclassified", () => assert.equal(configured("licenciatura_psicologia"), false));
await test("13 dentistry remains unclassified", () => assert.equal(configured("licenciatura_odontologia"), false));
await test("14 ambiguous graphic design remains unclassified", () => assert.equal(configured("licenciatura_diseno_grafico"), false));
await test("15 health tourism remains unclassified", () => {
  assert.equal(configured("tsu_tecnico_superior_universitario_en_terapia_fisica_area_turismo_de_salud_y"), false);
});
await test("16 mathematics program has mathematics weight 5", () => {
  assert.deepEqual(catalog.programs.licenciatura_matematicas.traitWeights, { mathematics: 5 });
});
await test("17 mathematical computing has mathematics weight 5", () => {
  assert.deepEqual(catalog.programs.licenciatura_computacion_matematica.traitWeights, { mathematics: 5 });
});
await test("18 programming program has programming weight 5", () => {
  assert.deepEqual(catalog.programs.tecnico_bachillerato_programacion.traitWeights, { programming: 5 });
});
await test("19 construction program has construction weight 5", () => {
  assert.deepEqual(catalog.programs.tecnico_bachillerato_construccion.traitWeights, { construction: 5 });
});
await test("20 logistics design has design weight 3", () => {
  assert.deepEqual(catalog.programs.licenciatura_diseno_y_gestion_de_redes_logisticas.traitWeights, { design: 3 });
});
await test("21 digital design specialty has design 5 and no category", () => {
  const program = catalog.programs.especialidad_especialidad_en_diseno_digital;
  assert.deepEqual(program.traitWeights, { design: 5 });
  assert.deepEqual(program.categoryIds, []);
});
await test("22 health category contains exactly three programs", () => assert.equal(catalog.categories.find(({ id }) => id === "health_sciences").programIds.length, 3));
await test("23 exact sciences contains exactly two programs", () => assert.equal(catalog.categories.find(({ id }) => id === "exact_sciences").programIds.length, 2));
await test("24 family inference does not exist", () => {
  assert.equal(catalog.policies.familyInferenceEnabled, false);
  assert.ok(Object.values(catalog.programs).every((program) => !("familyId" in program)));
});
await test("25 nearby inference does not exist", () => {
  assert.equal(catalog.policies.nearbyInferenceEnabled, false);
  assert.ok(Object.values(catalog.programs).every((program) => !("nearbyProgramIds" in program)));
});
await test("26 no required traits", () => assert.ok(Object.values(catalog.programs).every(({ requiredTraits }) => requiredTraits.length === 0)));
await test("27 no conflicts", () => assert.ok(Object.values(catalog.programs).every(({ conflictingTraits }) => conflictingTraits.length === 0)));
await test("28 no program belongs to two categories", () => {
  const ids = catalog.categories.flatMap(({ programIds }) => programIds);
  assert.equal(new Set(ids).size, ids.length);
});
await test("29 category cross-references are consistent", () => {
  for (const [id, program] of Object.entries(catalog.programs)) {
    const referenced = catalog.categories.filter(({ programIds }) => programIds.includes(id)).map(({ id: categoryId }) => categoryId);
    assert.deepEqual(program.categoryIds, referenced);
  }
});
await test("30 all traits exist in lexicon", () => {
  const traits = new Set(inputs.lexicon.concepts.map(({ id }) => id));
  assert.ok(Object.values(catalog.programs).every(({ traitWeights }) => Object.keys(traitWeights).every((id) => traits.has(id))));
});
await test("31 all weights are valid", () => {
  const weights = Object.values(catalog.programs).flatMap(({ traitWeights }) => Object.values(traitWeights));
  assert.ok(weights.every((weight) => Number.isInteger(weight) && weight >= 1 && weight <= 5));
});
await test("32 source hashes are correct", () => assert.equal(validateCatalog(catalog, inputs).valid, true));
await test("33 altered source does not validate", () => {
  const result = validateMutation(() => {}, { relationsRaw: Buffer.concat([inputs.relationsRaw, Buffer.from(" ")]) });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("relations SHA-256")));
});
await test("34 nonexistent program ID does not validate", () => {
  const result = validateMutation((candidate) => {
    candidate.programs.nonexistent_program = candidate.programs.licenciatura_matematicas;
    delete candidate.programs.licenciatura_matematicas;
  });
  assert.equal(result.valid, false);
});
await test("35 nonexistent trait does not validate", () => {
  const result = validateMutation((candidate) => {
    candidate.programs.licenciatura_matematicas.traitWeights = { nonexistent_trait: 5 };
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("unknown trait")));
});
await test("36 out-of-range weight does not validate", () => {
  const result = validateMutation((candidate) => {
    candidate.programs.licenciatura_matematicas.traitWeights.mathematics = 6;
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("invalid weight")));
});
await test("37 duplicate category does not validate", () => {
  const result = validateMutation((candidate) => candidate.categories.push(clone(candidate.categories[0])));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("category IDs must be unique")));
});
await test("38 program duplicated across categories does not validate", () => {
  const result = validateMutation((candidate) => candidate.categories[1].programIds.push("licenciatura_matematicas"));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("multiple categories")));
});
await test("39 added required trait does not validate", () => {
  const result = validateMutation((candidate) => candidate.programs.licenciatura_matematicas.requiredTraits.push("mathematics"));
  assert.equal(result.valid, false);
});
await test("40 added conflict does not validate", () => {
  const result = validateMutation((candidate) => candidate.programs.licenciatura_matematicas.conflictingTraits.push("design"));
  assert.equal(result.valid, false);
});
await test("41 enabled category inference does not validate", () => {
  const result = validateMutation((candidate) => { candidate.categories[0].inferenceEnabled = true; });
  assert.equal(result.valid, false);
});
await test("42 enabled family policy does not validate", () => {
  const result = validateMutation((candidate) => { candidate.policies.familyInferenceEnabled = true; });
  assert.equal(result.valid, false);
});
await test("43 enabled nearby policy does not validate", () => {
  const result = validateMutation((candidate) => { candidate.policies.nearbyInferenceEnabled = true; });
  assert.equal(result.valid, false);
});
await test("44 visible name does not validate", () => {
  const result = validateMutation((candidate) => { candidate.programs.licenciatura_matematicas.name = "Matematicas"; });
  assert.equal(result.valid, false);
});
await test("45 alias does not validate", () => {
  const result = validateMutation((candidate) => { candidate.programs.licenciatura_matematicas.aliases = ["math"]; });
  assert.equal(result.valid, false);
});
await test("46 invalid input is not mutated", () => {
  const candidate = clone(catalog);
  candidate.programs.licenciatura_matematicas.traitWeights.mathematics = 9;
  const before = JSON.stringify(candidate);
  validateCatalog(candidate, inputs);
  assert.equal(JSON.stringify(candidate), before);
});
await test("47 validation result and catalog order are deterministic", () => {
  assert.deepEqual(validateCatalog(catalog, inputs), validateCatalog(catalog, inputs));
  assert.deepEqual(Object.keys(catalog.programs), Object.keys(catalog.programs).sort());
});
await test("48 validator has no network dependency", () => {
  const source = readFileSync(new URL("./validateVocationalCareerTraits.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:(?:http|https|net|tls)|\bfetch\s*\(/u);
});
await test("49 validator has no Gemini dependency or call", () => {
  const source = readFileSync(new URL("./validateVocationalCareerTraits.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /@google\/generative-ai|GoogleGenerativeAI|generateContent/u);
});
await test("50 validator has no Prisma access", () => {
  const source = readFileSync(new URL("./validateVocationalCareerTraits.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /@prisma|PrismaClient|prisma\./u);
});

const rejects = (mutate, overrides = {}) => {
  const result = validateMutation(mutate, overrides);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
};

await test("51 incorrect version is rejected", () => rejects((candidate) => { candidate.version = 2; }));
await test("52 incorrect status is rejected", () => rejects((candidate) => { candidate.status = "pending"; }));
await test("53 missing root key is rejected", () => rejects((candidate) => { delete candidate.policies; }));
await test("54 extra root key is rejected", () => rejects((candidate) => { candidate.extra = true; }));
await test("55 missing policy is rejected", () => rejects((candidate) => { delete candidate.policies.categoryAssignmentMode; }));
await test("56 extra policy is rejected", () => rejects((candidate) => { candidate.policies.extra = false; }));
await test("57 automatic name classification is rejected", () => rejects((candidate) => { candidate.policies.automaticNameClassificationEnabled = true; }));
await test("58 automatic alias classification is rejected", () => rejects((candidate) => { candidate.policies.automaticAliasClassificationEnabled = true; }));
await test("59 required-trait blocking is rejected", () => rejects((candidate) => { candidate.policies.requiredTraitBlockingEnabled = true; }));
await test("60 conflict blocking is rejected", () => rejects((candidate) => { candidate.policies.conflictBlockingEnabled = true; }));
await test("61 disabling explicit unclassified requests is rejected", () => rejects((candidate) => { candidate.policies.unclassifiedExplicitRequestAllowed = false; }));
await test("62 missing category is rejected", () => rejects((candidate) => { candidate.categories.pop(); }));
await test("63 extra category is rejected", () => rejects((candidate) => { candidate.categories.push({ id: "extra", status: "active_explicit_only", inferenceEnabled: false, programIds: [] }); }));
await test("64 incorrect category status is rejected", () => rejects((candidate) => { candidate.categories[0].status = "pending"; }));
await test("65 duplicate program within one category is rejected", () => rejects((candidate) => { candidate.categories[0].programIds.push(candidate.categories[0].programIds[0]); }));
await test("66 missing approved program is rejected", () => rejects((candidate) => { delete candidate.programs.licenciatura_matematicas; }));
await test("67 additional approved program is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_arquitectura = clone(candidate.programs.licenciatura_matematicas); }));
await test("68 inconsistent categoryIds is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.categoryIds = []; }));
await test("69 zero weight is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.traitWeights.mathematics = 0; }));
await test("70 negative weight is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.traitWeights.mathematics = -1; }));
await test("71 decimal weight is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.traitWeights.mathematics = 2.5; }));
await test("72 string weight is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.traitWeights.mathematics = "5"; }));
await test("73 two traits are rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.traitWeights.design = 5; }));
await test("74 weight 3 on wrong program is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.traitWeights.mathematics = 3; }));
await test("75 multiple weights 3 are rejected", () => rejects((candidate) => { candidate.programs.especialidad_especialidad_en_diseno_digital.traitWeights.design = 3; }));
await test("76 generic extra program field is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.extra = true; }));
await test("77 familyId field is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.familyId = "family"; }));
await test("78 nearbyProgramIds field is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.nearbyProgramIds = []; }));
await test("79 stored URL is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.url = "https://invalid.example"; }));
await test("80 stored email is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.email = "invalid@example.com"; }));
await test("81 stored credential is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.apiKey = "not-a-key"; }));
await test("82 manipulated relations hash declaration is rejected", () => rejects((candidate) => { candidate.sourceIntegrity.relationsSha256 = "0".repeat(64); }));
await test("83 manipulated lexicon hash declaration is rejected", () => rejects((candidate) => { candidate.sourceIntegrity.lexiconSha256 = "0".repeat(64); }));
await test("84 incorrect canonical count declaration is rejected", () => rejects((candidate) => { candidate.sourceIntegrity.catalogProgramCount = 461; }));
await test("85 incorrect approved count declaration is rejected", () => rejects((candidate) => { candidate.sourceIntegrity.approvedProgramCount = 24; }));
await test("86 incorrect coverage declaration is rejected", () => rejects((candidate) => { candidate.sourceIntegrity.approvedCoveragePercent = 5.4; }));
await test("87 BOM is rejected before parsing", () => {
  assert.throws(() => parseJson(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), inputs.catalogRaw]), "catalog"), /BOM/u);
});
await test("88 invalid JSON is rejected", () => assert.throws(() => parseJson(Buffer.from("{"), "catalog"), /invalid JSON/u));
await test("89 modified review matrix bytes are rejected", () => {
  const modified = Buffer.concat([inputs.reviewMatrixRaw, Buffer.from(" ")]);
  const result = validateCatalog(clone(catalog), { ...inputs, reviewMatrixRaw: modified });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("review matrix SHA-256")));
});
await test("90 absent optional review matrix passes", () => {
  const result = validateCatalog(clone(catalog), { ...inputs, reviewMatrix: null, reviewMatrixRaw: null });
  assert.equal(result.valid, true, result.errors.join("; "));
});
await test("91 equivalent reordered policies pass", () => {
  const candidate = clone(catalog);
  candidate.policies = Object.fromEntries(Object.entries(candidate.policies).reverse());
  assert.equal(validateCatalog(candidate, inputs).valid, true);
});
await test("92 equivalent reordered sourceIntegrity passes", () => {
  const candidate = clone(catalog);
  candidate.sourceIntegrity = Object.fromEntries(Object.entries(candidate.sourceIntegrity).reverse());
  assert.equal(validateCatalog(candidate, inputs).valid, true);
});
await test("93 custom object prototype is rejected", () => {
  const candidate = clone(catalog);
  Object.setPrototypeOf(candidate.programs.licenciatura_matematicas, { polluted: true });
  assert.equal(validateCatalog(candidate, inputs).valid, false);
});
await test("94 getter is rejected without execution", () => {
  const candidate = clone(catalog);
  let calls = 0;
  Object.defineProperty(candidate.programs.licenciatura_matematicas, "evidenceType", { enumerable: true, get() { calls += 1; return "canonical_name_exact"; } });
  assert.equal(validateCatalog(candidate, inputs).valid, false);
  assert.equal(calls, 0);
});
await test("95 throwing getter is rejected without execution", () => {
  const candidate = clone(catalog);
  let calls = 0;
  Object.defineProperty(candidate, "version", { enumerable: true, get() { calls += 1; throw new Error("must not run"); } });
  assert.equal(validateCatalog(candidate, inputs).valid, false);
  assert.equal(calls, 0);
});
await test("96 __proto__ own key is rejected", () => {
  const candidate = clone(catalog);
  Object.defineProperty(candidate.programs.licenciatura_matematicas, "__proto__", { value: {}, enumerable: true });
  assert.equal(validateCatalog(candidate, inputs).valid, false);
});
await test("97 constructor own key is rejected", () => {
  const candidate = clone(catalog);
  Object.defineProperty(candidate.programs.licenciatura_matematicas, "constructor", { value: {}, enumerable: true });
  assert.equal(validateCatalog(candidate, inputs).valid, false);
});
await test("98 prototype own key is rejected", () => {
  const candidate = clone(catalog);
  Object.defineProperty(candidate.programs.licenciatura_matematicas, "prototype", { value: {}, enumerable: true });
  assert.equal(validateCatalog(candidate, inputs).valid, false);
});
await test("99 oversized array is rejected", () => rejects((candidate) => { candidate.categories[0].programIds = Array(101).fill("licenciatura_matematicas"); }));
await test("100 oversized string is rejected", () => rejects((candidate) => { candidate.categories[0].id = "x".repeat(513); }));
await test("101 MAX_SAFE_INTEGER weight is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.traitWeights.mathematics = Number.MAX_SAFE_INTEGER; }));
await test("102 Infinity weight is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.traitWeights.mathematics = Infinity; }));
await test("103 NaN weight is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.traitWeights.mathematics = NaN; }));
await test("104 wrong field type is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.requiredTraits = "mathematics"; }));
await test("105 category programIds non-array is rejected", () => rejects((candidate) => { candidate.categories[0].programIds = {}; }));
await test("106 programs non-object is rejected", () => rejects((candidate) => { candidate.programs = []; }));
await test("107 categories non-array is rejected", () => rejects((candidate) => { candidate.categories = {}; }));
await test("108 traitWeights array is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.traitWeights = [5]; }));
await test("109 categoryIds string is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.categoryIds = "exact_sciences"; }));
await test("110 null structural field is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.traitWeights = null; }));
await test("111 non-enumerable field is rejected", () => {
  const candidate = clone(catalog);
  Object.defineProperty(candidate.programs.licenciatura_matematicas, "hidden", { value: true, enumerable: false });
  assert.equal(validateCatalog(candidate, inputs).valid, false);
});
await test("112 symbol field is rejected", () => {
  const candidate = clone(catalog);
  candidate.programs.licenciatura_matematicas[Symbol("hidden")] = true;
  assert.equal(validateCatalog(candidate, inputs).valid, false);
});
await test("113 array accessor is rejected without execution", () => {
  const candidate = clone(catalog);
  let calls = 0;
  Object.defineProperty(candidate.categories[0].programIds, "0", { enumerable: true, get() { calls += 1; return "licenciatura_diseno_ambiental_y_de_espacios"; } });
  assert.equal(validateCatalog(candidate, inputs).valid, false);
  assert.equal(calls, 0);
});
await test("114 raw hashes require byte buffers", () => {
  const result = validateCatalog(clone(catalog), { ...inputs, relationsRaw: inputs.relationsRaw.toString("utf8") });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("must be a Buffer")));
});
await test("115 invalid UTF-8 is rejected", () => assert.throws(() => parseJson(Buffer.from([0xff]), "catalog"), /invalid UTF-8/u));
await test("116 incorrect evidenceType is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.evidenceType = "derived"; }));
await test("117 incorrect reviewStatus is rejected", () => rejects((candidate) => { candidate.programs.licenciatura_matematicas.reviewStatus = "pending"; }));
await test("118 program objects do not share mutable arrays", () => {
  const candidate = clone(catalog);
  const first = candidate.programs.licenciatura_matematicas;
  const second = candidate.programs.licenciatura_computacion_matematica;
  first.categoryIds.push("changed");
  assert.deepEqual(second.categoryIds, ["exact_sciences"]);
});
await test("119 root property order is non-contractual", () => {
  const candidate = Object.fromEntries(Object.entries(clone(catalog)).reverse());
  assert.equal(validateCatalog(candidate, inputs).valid, true);
});
await test("120 program field order is non-contractual", () => {
  const candidate = clone(catalog);
  const id = "licenciatura_matematicas";
  candidate.programs[id] = Object.fromEntries(Object.entries(candidate.programs[id]).reverse());
  assert.equal(validateCatalog(candidate, inputs).valid, true);
});
await test("121 functional files have UTF-8 without BOM and one final newline", () => {
  const files = [
    new URL("../src/config/vocationalCareerTraits.json", import.meta.url),
    new URL("./validateVocationalCareerTraits.js", import.meta.url),
    new URL("./testVocationalCareerTraits.js", import.meta.url),
  ];
  for (const file of files) {
    const bytes = readFileSync(file);
    const source = bytes.toString("utf8");
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(source.endsWith("\n"), true);
    assert.equal(source.endsWith("\n\n"), false);
  }
});
const passCount = results.filter(({ status }) => status === "PASS").length;
const failCount = results.length - passCount;
console.log(`Total: ${results.length}`);
console.log(`PASS: ${passCount}`);
console.log(`FAIL: ${failCount}`);
if (failCount > 0) process.exitCode = 1;

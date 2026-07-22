import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  VOCATIONAL_CAREER_MATCH_LIMITS,
  VOCATIONAL_CAREER_MATCH_STATUSES,
  createVocationalCareerMatcher,
  matchVocationalCareer,
  normalizeVocationalCareerInput,
} from "../src/services/vocationalCareerMatchingService.js";

const tests = [];
const test = (name, run) => tests.push({ name, run });

function fixturePrograms() {
  return {
    psicologia: {
      canonicalName: "Psicología",
      displayName: "Psicología",
      level: "licenciatura",
      exactAliases: ["Licenciatura en Psicología", "Psicología"],
      inputAliases: ["Psico"],
    },
    arquitectura: {
      canonicalName: "Arquitectura",
      displayName: "Arquitectura",
      level: "licenciatura",
      exactAliases: ["Licenciatura en Arquitectura", "Arquitectura"],
      inputAliases: [],
    },
    arquitectura_3d: {
      canonicalName: "Arquitectura 3D",
      displayName: "Arquitectura 3D",
      level: "licenciatura",
      exactAliases: ["Arquitectura 3D"],
      inputAliases: [],
    },
    ingenieria_civil: {
      canonicalName: "Ingeniería Civil",
      displayName: "Ingeniería Civil",
      level: "ingenieria",
      exactAliases: ["Ingeniería Civil"],
      inputAliases: ["Civil"],
    },
    mecatronica_ingenieria: {
      canonicalName: "Ingeniería en Mecatrónica",
      displayName: "Ingeniería en Mecatrónica",
      level: "ingenieria",
      exactAliases: ["Ingeniería en Mecatrónica"],
      inputAliases: ["Mecatrónica"],
    },
    mecatronica_tecnica: {
      canonicalName: "Mecatrónica",
      displayName: "Mecatrónica",
      level: "tecnico_bachillerato",
      exactAliases: ["Mecatrónica"],
      inputAliases: [],
    },
    diseno_grafico: {
      canonicalName: "Diseño Gráfico",
      displayName: "Diseño Gráfico",
      level: "licenciatura",
      exactAliases: ["Diseño Gráfico"],
      inputAliases: [],
    },
  };
}

function fixtureCatalog(programs = fixturePrograms()) {
  return { programs };
}

function createFixtureMatcher(programs) {
  return createVocationalCareerMatcher(fixtureCatalog(programs));
}

const matcher = createFixtureMatcher();
const match = (value, options) => matcher.match(value, options);
const isNoProgram = (value) => value.programId === null;

test("01 nombre canonico exacto", () => assert.equal(match("Psicología").status, "exact"));
test("02 alias exacto", () => assert.equal(match("Licenciatura en Psicología").status, "approved_alias"));
test("03 mayusculas", () => assert.equal(match("PSICOLOGÍA").status, "exact"));
test("04 minusculas", () => assert.equal(match("psicología").status, "exact"));
test("05 acentos controlados", () => assert.equal(match("psicologia").status, "normalized_exact"));
test("06 espacios repetidos", () => assert.equal(match("Ingeniería   Civil").status, "normalized_exact"));
test("07 espacios exteriores", () => assert.equal(match("  Psicología  ").status, "exact"));
test("08 puntuacion controlada", () => assert.equal(match("Diseño, Gráfico").status, "normalized_exact"));
test("09 error de una letra", () => assert.equal(match("psiclogía").status, "fuzzy_confirmation_required"));
test("10 transposicion", () => assert.equal(match("psciología").status, "fuzzy_confirmation_required"));
test("11 omision de letra", () => assert.equal(match("psicoloía").status, "fuzzy_confirmation_required"));
test("12 letra duplicada", () => assert.equal(match("psicologíaa").status, "fuzzy_confirmation_required"));
test("13 dos letras en nombre largo", () => assert.equal(match("ingenieria civxl").status, "fuzzy_confirmation_required"));
test("14 string de un caracter", () => assert.equal(match("a").reasonCode, "input_too_short_for_fuzzy"));
test("15 string de cuatro caracteres", () => assert.equal(match("psic").reasonCode, "input_too_short_for_fuzzy"));
test("16 string de cinco caracteres conservador", () => assert.equal(match("psico").status, "approved_alias"));
test("17 input vacio", () => assert.equal(match("").status, "invalid_input"));
test("18 solo espacios", () => assert.equal(match("   ").status, "invalid_input"));
test("19 input excesivamente largo", () => assert.equal(match("a".repeat(121)).reasonCode, "invalid_match_input_length"));
test("20 demasiados tokens", () => assert.equal(match(Array(13).fill("palabra").join(" ")).reasonCode, "invalid_match_input_tokens"));
test("21 caracteres de control", () => assert.equal(match("psico\nlogia").reasonCode, "invalid_match_input_characters"));
test("22 zero width", () => assert.equal(match("psico\u200blogia").reasonCode, "invalid_match_input_characters"));
test("23 unicode NFKC", () => assert.equal(match("Ｐｓｉｃｏｌｏｇíａ").status, "exact"));
test("24 cirilico visual", () => assert.equal(match("рsicologia").reasonCode, "invalid_match_input_characters"));
test("25 emoji", () => assert.equal(match("psicologia😀").reasonCode, "invalid_match_input_characters"));
test("26 alias compartido", () => assert.equal(match("Mecatrónica").status, "ambiguous"));
test("27 nombre compartido entre niveles", () => assert.equal(match("mecatroncia").status, "ambiguous"));
test("28 nivel resuelve alias compartido", () => assert.equal(match("Mecatrónica", { academicLevel: "ingenieria" }).programId, "mecatronica_ingenieria"));
test("29 empate fuzzy", () => assert.equal(match("mecatroncia").reasonCode, "tied_candidates"));
test("30 candidato unico con margen", () => assert.equal(match("arquiectura").programId, "arquitectura"));
test("31 programa inexistente", () => assert.ok(isNoProgram(match("programa inexistente"))));
test("32 no inventa ID", () => assert.ok(isNoProgram(match("programa totalmente inventado"))));
test("33 no usa prefijo", () => assert.ok(isNoProgram(match("arquite"))));
test("34 no usa sufijo", () => assert.ok(isNoProgram(match("tectura"))));
test("35 no usa contains", () => assert.ok(isNoProgram(match("texto arquitectura texto"))));
test("36 no reordena palabras", () => assert.ok(isNoProgram(match("civil ingenieria"))));
test("37 no expande abreviaturas", () => assert.ok(isNoProgram(match("arq"))));
test("38 no aplica sinonimos", () => assert.ok(isNoProgram(match("terapia mental"))));
test("39 no traduce", () => assert.ok(isNoProgram(match("psychology"))));
test("40 no usa fonetica", () => assert.ok(isNoProgram(match("sicolojia"))));
test("41 exacto tiene prioridad", () => assert.equal(match("Arquitectura").matchMethod, "canonical_name"));
test("42 alias tiene prioridad", () => assert.equal(match("Psico").matchMethod, "approved_alias"));
test("43 numero no pasa por fuzzy", () => assert.equal(match("2").reasonCode, "context_not_applicable"));
test("44 accion de carreras no pasa", () => assert.equal(match("Mostrar más carreras").reasonCode, "context_not_applicable"));
test("45 accion institucional no pasa", () => assert.equal(match("Más escuelas").reasonCode, "context_not_applicable"));
test("46 texto Gemini no tiene API especial", () => assert.equal(Object.keys(matcher).sort().join(","), "match,programCount"));
test("47 institucion no pasa", () => assert.equal(match("Universidad Psiclogia").reasonCode, "context_not_applicable"));
test("48 fuzzy requiere confirmacion", () => assert.equal(match("arquiectura").status, "fuzzy_confirmation_required"));
test("49 ambiguo no devuelve programa", () => assert.ok(isNoProgram(match("mecatroncia"))));
test("50 no match no devuelve programa", () => assert.ok(isNoProgram(match("abcdefghi"))));
test("51 inputs congelados", () => {
  const frozen = Object.freeze({ programs: Object.freeze({
    unico: Object.freeze({
      canonicalName: "Programa Unico", displayName: "Programa Unico", level: "licenciatura",
      exactAliases: Object.freeze(["Programa Unico"]), inputAliases: Object.freeze([]),
    }),
  }) });
  assert.equal(createVocationalCareerMatcher(frozen).programCount, 1);
});
test("52 inputs no mutados", () => {
  const input = fixtureCatalog(); const before = JSON.stringify(input);
  createVocationalCareerMatcher(input); assert.equal(JSON.stringify(input), before);
});
test("53 output independiente", () => assert.notEqual(match("psiclogia"), match("psiclogia")));
test("54 indice inmutable", () => assert.ok(Object.isFrozen(matcher)));
test("55 getter que lanza", () => {
  const hostile = {}; Object.defineProperty(hostile, "programs", { enumerable: true, get() { throw new Error("boom"); } });
  assert.throws(() => createVocationalCareerMatcher(hostile), /invalid_match_catalog/);
});
test("56 prototipo personalizado", () => assert.throws(() => createVocationalCareerMatcher(Object.create({ programs: {} })), /invalid_match_catalog/));
test("57 clave proto", () => assert.throws(() => createVocationalCareerMatcher({ programs: { __proto__: {} } }), /invalid_match_catalog/));
test("58 clave constructor", () => assert.throws(() => createVocationalCareerMatcher({ programs: { constructor: {} } }), /invalid_match_catalog/));
test("59 clave prototype", () => assert.throws(() => createVocationalCareerMatcher({ programs: { prototype: {} } }), /invalid_match_catalog/));
test("60 determinismo", () => assert.deepEqual(match("psiclogia"), match("psiclogia")));
test("61 repeticion estable", () => {
  const values = Array.from({ length: 20 }, () => JSON.stringify(match("arquiectura")));
  assert.equal(new Set(values).size, 1);
});
test("62 orden de catalogo no altera decision", () => {
  const entries = Object.entries(fixturePrograms()).reverse();
  const reversed = createFixtureMatcher(Object.fromEntries(entries));
  assert.deepEqual(reversed.match("psiclogia"), match("psiclogia"));
});
test("63 sin red", () => {
  const source = readFileSync(new URL("../src/services/vocationalCareerMatchingService.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|https?:|node:https|node:http/);
});
test("64 sin Gemini", () => {
  const source = readFileSync(new URL("../src/services/vocationalCareerMatchingService.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Gemini|generateContent|generateAssistantReply/);
});
test("65 sin base de datos", () => {
  const source = readFileSync(new URL("../src/services/vocationalCareerMatchingService.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /prisma|queryRaw|findMany|repositories/);
});
test("66 sin filesystem en matcher", () => {
  const source = readFileSync(new URL("../src/services/vocationalCareerMatchingService.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:fs|readFile|writeFile/);
});
test("67 sin estado global mutable", () => assert.ok(Object.isFrozen(VOCATIONAL_CAREER_MATCH_LIMITS)));
test("68 limite de complejidad", () => assert.equal(VOCATIONAL_CAREER_MATCH_LIMITS.maximumComparisons, 128));
test("69 logs sin PII", () => {
  const source = readFileSync(new URL("../src/services/vocationalCareerMatchingService.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\.|logger\./);
});
test("70 statuses cerrados", () => assert.deepEqual(VOCATIONAL_CAREER_MATCH_STATUSES, [
  "exact", "approved_alias", "normalized_exact", "fuzzy_confirmation_required", "ambiguous", "no_match", "invalid_input",
]));
test("71 query con prefijo documentado", () => assert.equal(match("Quiero estudiar psiclogia").programId, "psicologia"));
test("72 allowedProgramIds limita pagina visible", () => assert.equal(
  match("mecatroncia", { allowedProgramIds: ["mecatronica_ingenieria"] }).programId,
  "mecatronica_ingenieria",
));
test("73 allowedProgramIds desconocido falla cerrado", () => assert.throws(
  () => match("psiclogia", { allowedProgramIds: ["inventado"] }),
  /invalid_match_options/,
));
test("74 catalogo real psiclogia", () => assert.equal(matchVocationalCareer("psiclogía").programId, "licenciatura_psicologia"));
test("75 catalogo real arquitectura", () => assert.equal(matchVocationalCareer("arquiectura").programId, "licenciatura_arquitectura"));
test("76 catalogo real mecatronica ambiguo", () => assert.equal(matchVocationalCareer("mecatroncia").status, "ambiguous"));
test("77 catalogo real contaduria", () => assert.equal(matchVocationalCareer("contaduriaa").programId, "licenciatura_contaduria"));
test("78 catalogo real ingenieria civil", () => assert.equal(matchVocationalCareer("ingenieria civl").programId, "ingenieria_civil"));
test("79 normalizador no reordena", () => assert.equal(normalizeVocationalCareerInput("Civil Ingeniería"), "civil ingenieria"));
test("80 salida congelada", () => assert.ok(Object.isFrozen(match("psiclogia"))));
test("81 campos symbol en catalogo fallan cerrado", () => {
  const catalog = fixtureCatalog();
  catalog[Symbol("oculto")] = "dato";
  assert.throws(() => createVocationalCareerMatcher(catalog), /invalid_match_catalog/);
});
test("82 arrays con propiedades extra fallan cerrado", () => {
  const programs = fixturePrograms();
  programs.psicologia.inputAliases.extra = "oculto";
  assert.throws(() => createFixtureMatcher(programs), /invalid_match_catalog/);
});
test("83 ordenamiento no depende de locale", () => {
  const source = readFileSync(new URL("../src/services/vocationalCareerMatchingService.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /localeCompare|toLocaleLowerCase/);
});
test("84 arrays sparse y getters fallan cerrado sin ejecutar accessor", () => {
  const sparsePrograms = fixturePrograms();
  sparsePrograms.psicologia.inputAliases = Array(1);
  assert.throws(() => createFixtureMatcher(sparsePrograms), /invalid_match_catalog/);
  const getterPrograms = fixturePrograms();
  let invoked = false;
  Object.defineProperty(getterPrograms.psicologia.inputAliases, "0", {
    enumerable: true,
    get() { invoked = true; throw new Error("boom"); },
  });
  assert.throws(() => createFixtureMatcher(getterPrograms), /invalid_match_catalog/);
  assert.equal(invoked, false);
});

let passed = 0;
for (const { name, run } of tests) {
  try {
    await run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

console.log(`\n${passed}/${tests.length} PASS`);
if (passed !== tests.length) process.exitCode = 1;

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  closeVocationalCareerPaginationState,
  createVocationalCareerPaginationState,
  getCurrentVocationalCareerPage,
  getNextVocationalCareerPage,
  resolveVocationalCareerSelection,
  validateVocationalCareerPaginationState,
  VOCATIONAL_CAREER_MAX_OPTIONS,
  VOCATIONAL_CAREER_PAGE_SIZE,
  VOCATIONAL_CAREER_PAGINATION_VERSION,
} from "../src/services/vocationalCareerPaginationService.js";

const results = [];
async function test(name, callback) {
  try {
    await callback();
    results.push({ name, status: "PASS" });
    console.log(`PASS ${results.length}: ${name}`);
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
    console.error(`FAIL ${results.length}: ${name} - ${error.message}`);
  }
}

function option(index, bucket = "accepted") {
  return {
    canonicalProgramId: `program_${String(index).padStart(3, "0")}`,
    bucket,
    name: `Carrera ${index}`,
    normalizedName: `CARRERA ${index}`,
    level: "undergraduate",
    academicLevel: "licenciatura",
    searchQuery: `Carrera ${index}`,
    familyId: `family_${index}`,
    exactAliases: [`Carrera ${index}`],
  };
}

function options(count, bucket = "accepted") {
  return Array.from({ length: count }, (_, index) => option(index + 1, bucket));
}

function state(count, extra = {}) {
  return createVocationalCareerPaginationState(options(count), extra);
}

function code(callback, expected) {
  assert.throws(callback, (error) => error?.code === expected);
}

for (const count of [0, 1, 3, 5, 6, 10, 11, 25, 128]) {
  await test(`${count} candidatos conserva total y primera pagina`, () => {
    const created = state(count);
    const page = getCurrentVocationalCareerPage(created);
    assert.equal(created.total, count);
    assert.equal(page.careers.length, Math.min(count, VOCATIONAL_CAREER_PAGE_SIZE));
    assert.equal(page.hasMore, count > VOCATIONAL_CAREER_PAGE_SIZE);
  });
}

await test("constantes de contrato cerradas", () => {
  assert.equal(VOCATIONAL_CAREER_PAGINATION_VERSION, 1);
  assert.equal(VOCATIONAL_CAREER_PAGE_SIZE, 5);
  assert.equal(VOCATIONAL_CAREER_MAX_OPTIONS, 128);
});
await test("primera pagina preserva orden", () =>
  assert.deepEqual(getCurrentVocationalCareerPage(state(6)).careers.map((item) => item.name),
    [1, 2, 3, 4, 5].map((value) => `Carrera ${value}`)));
await test("segunda pagina empieza en candidato seis", () => {
  const next = getNextVocationalCareerPage(state(10));
  assert.equal(getCurrentVocationalCareerPage(next).careers[0].name, "Carrera 6");
});
await test("ultima pagina puede contener uno", () => {
  const next = getNextVocationalCareerPage(state(6));
  assert.equal(getCurrentVocationalCareerPage(next).careers.length, 1);
});
await test("once candidatos producen tres paginas", () => {
  const first = state(11);
  const second = getNextVocationalCareerPage(first);
  const third = getNextVocationalCareerPage(second);
  assert.deepEqual([first.hasMore, second.hasMore, third.hasMore], [true, true, false]);
  assert.equal(getCurrentVocationalCareerPage(third).careers.length, 1);
});
await test("128 candidatos producen 26 paginas y ultima de tres", () => {
  let current = state(128);
  let pages = 1;
  const seen = [];
  while (true) {
    seen.push(...getCurrentVocationalCareerPage(current).careers.map((item) => item.canonicalProgramId));
    if (!current.hasMore) break;
    current = getNextVocationalCareerPage(current);
    pages += 1;
  }
  assert.equal(pages, 26);
  assert.equal(getCurrentVocationalCareerPage(current).careers.length, 3);
  assert.equal(new Set(seen).size, 128);
});
await test("sin repeticiones entre paginas", () => {
  const first = getCurrentVocationalCareerPage(state(10)).careers;
  const second = getCurrentVocationalCareerPage(getNextVocationalCareerPage(state(10))).careers;
  assert.equal(first.some((left) => second.some((right) => left.canonicalProgramId === right.canonicalProgramId)), false);
});
await test("rejected se excluye sin consumir lugar", () => {
  const created = createVocationalCareerPaginationState([
    option(1), option(2, "rejected"), option(3, "confirmation_required"),
  ]);
  assert.deepEqual(created.options.map((item) => item.bucket), ["accepted", "confirmation_required"]);
});
await test("accepted se preserva", () => assert.equal(state(1).options[0].bucket, "accepted"));
await test("confirmation se preserva", () => {
  const created = createVocationalCareerPaginationState([option(1, "confirmation_required")]);
  assert.equal(created.options[0].bucket, "confirmation_required");
});
await test("seleccion local uno valida", () =>
  assert.equal(resolveVocationalCareerSelection(state(5), "1").canonicalProgramId, "program_001"));
await test("seleccion local cinco valida", () =>
  assert.equal(resolveVocationalCareerSelection(state(5), 5).canonicalProgramId, "program_005"));
await test("seleccion fuera de rango falla", () =>
  code(() => resolveVocationalCareerSelection(state(5), "6"), "vocational_career_selection_not_visible"));
await test("seleccion por nombre canonico visible", () =>
  assert.equal(resolveVocationalCareerSelection(state(5), "Carrera 3").canonicalProgramId, "program_003"));
await test("numero uno en pagina dos selecciona seis", () => {
  const second = getNextVocationalCareerPage(state(8));
  assert.equal(resolveVocationalCareerSelection(second, "1").canonicalProgramId, "program_006");
});
await test("nombre de pagina anterior no se resuelve como accion visible", () => {
  const second = getNextVocationalCareerPage(state(8));
  code(() => resolveVocationalCareerSelection(second, "Carrera 1"), "vocational_career_selection_not_visible");
});
await test("cursor negativo rechazado", () => {
  const created = state(6); created.cursor = -5;
  code(() => validateVocationalCareerPaginationState(created), "invalid_vocational_career_state");
});
await test("cursor decimal rechazado", () => {
  const created = state(6); created.cursor = 0.5;
  code(() => validateVocationalCareerPaginationState(created), "invalid_vocational_career_state");
});
await test("cursor excesivo rechazado", () => {
  const created = state(6); created.cursor = 10;
  code(() => validateVocationalCareerPaginationState(created), "invalid_vocational_career_state");
});
await test("tamano de pagina manipulado rechazado", () => {
  const created = state(6); created.pageSize = 6;
  code(() => validateVocationalCareerPaginationState(created), "invalid_vocational_career_state");
});
await test("estado ausente rechazado", () =>
  code(() => validateVocationalCareerPaginationState(null), "invalid_vocational_career_state"));
await test("estado expirado rechazado", () => {
  const created = state(1, { expiresAt: "2026-01-01T00:00:00.000Z" });
  code(() => validateVocationalCareerPaginationState(created, { now: Date.parse("2026-01-02T00:00:00.000Z") }),
    "expired_vocational_career_state");
});
await test("fecha imposible rechazada", () =>
  code(() => state(1, { expiresAt: "2026-02-30T00:00:00.000Z" }),
    "invalid_vocational_career_expiration"));
await test("fecha local permisiva rechazada", () =>
  code(() => state(1, { expiresAt: "01/02/2027" }),
    "invalid_vocational_career_expiration"));
await test("fecha sin hora rechazada", () =>
  code(() => state(1, { expiresAt: "2027-01-01" }),
    "invalid_vocational_career_expiration"));
await test("reloj manipulado rechazado", () =>
  code(() => validateVocationalCareerPaginationState(state(1), { now: "0" }),
    "invalid_vocational_career_clock"));
await test("version incorrecta rechazada", () => {
  const created = state(1); created.version = 2;
  code(() => validateVocationalCareerPaginationState(created), "invalid_vocational_career_state");
});
await test("snapshot corrupto rechazado", () => {
  const created = state(1); created.options = "corrupto";
  code(() => validateVocationalCareerPaginationState(created), "invalid_vocational_career_state");
});
await test("ID visible inexistente rechazado", () => {
  const created = state(1); created.visibleIds = ["program_999"];
  code(() => validateVocationalCareerPaginationState(created), "invalid_vocational_career_state");
});
await test("duplicados rechazados", () =>
  code(() => createVocationalCareerPaginationState([option(1), option(1)]), "duplicate_vocational_career"));
await test("inputs congelados son aceptados", () => {
  const rows = Object.freeze([Object.freeze({ ...option(1), exactAliases: Object.freeze(["Carrera 1"]) })]);
  assert.equal(createVocationalCareerPaginationState(rows).total, 1);
});
await test("inputs no son mutados", () => {
  const rows = options(6); const before = structuredClone(rows);
  createVocationalCareerPaginationState(rows);
  assert.deepEqual(rows, before);
});
await test("output es independiente", () => {
  const created = state(2);
  const page = getCurrentVocationalCareerPage(created);
  page.careers[0].name = "mutada";
  assert.equal(created.options[0].name, "Carrera 1");
});
await test("determinismo", () => assert.deepEqual(state(11), state(11)));
await test("repeticion estable", () => {
  const created = state(6);
  assert.deepEqual(getCurrentVocationalCareerPage(created), getCurrentVocationalCareerPage(created));
});
await test("clave peligrosa rechazada", () => {
  const hostile = option(1); Object.defineProperty(hostile, "constructor", { value: "x", enumerable: true });
  code(() => createVocationalCareerPaginationState([hostile]), "invalid_vocational_career_option");
});
await test("getter que lanza rechazado", () => {
  const hostile = option(1); Object.defineProperty(hostile, "name", { get() { throw new Error("secret"); }, enumerable: true });
  code(() => createVocationalCareerPaginationState([hostile]), "invalid_vocational_career_option");
});
await test("prototipo personalizado rechazado", () => {
  const hostile = Object.assign(Object.create({ inherited: true }), option(1));
  code(() => createVocationalCareerPaginationState([hostile]), "invalid_vocational_career_option");
});
await test("limite de 128 aceptado", () => assert.equal(state(128).total, 128));
await test("candidato 129 falla cerrado", () =>
  code(() => state(129), "invalid_vocational_career_snapshot"));
await test("pagina siguiente incrementa version", () => {
  const first = state(6, { stateVersion: 8 });
  assert.equal(getNextVocationalCareerPage(first).stateVersion, 9);
});
await test("pagina final no avanza", () =>
  code(() => getNextVocationalCareerPage(state(5)), "vocational_career_page_unavailable"));
await test("cierre invalida seleccion y avance", () => {
  const closed = closeVocationalCareerPaginationState(state(6));
  code(() => resolveVocationalCareerSelection(closed, 1), "vocational_career_state_closed");
  code(() => getNextVocationalCareerPage(closed), "vocational_career_page_unavailable");
});
await test("servicio no importa Gemini", () => {
  const source = readFileSync(new URL("../src/services/vocationalCareerPaginationService.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /aiService|generateAssistantReply|GoogleGenerativeAI/);
});
await test("servicio no importa base", () => {
  const source = readFileSync(new URL("../src/services/vocationalCareerPaginationService.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /prisma|repositories|queryRaw|findMany/);
});
await test("servicio no usa filesystem", () => {
  const source = readFileSync(new URL("../src/services/vocationalCareerPaginationService.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:fs|readFile|writeFile/);
});
await test("servicio no usa estado global", () => {
  const source = readFileSync(new URL("../src/services/vocationalCareerPaginationService.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /globalThis|process\.env/);
});

const passed = results.filter((item) => item.status === "PASS").length;
const failed = results.length - passed;
console.log(`TOTAL: ${results.length} | PASS: ${passed} | FAIL: ${failed}`);
if (failed) process.exitCode = 1;

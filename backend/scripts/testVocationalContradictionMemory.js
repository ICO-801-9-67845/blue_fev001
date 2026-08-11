import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyVocationalUpdates, extractExplicitVocationalUpdates, getDefaultVocationalProfile } from "../src/services/vocationalPreferenceService.js";
import { buildEducativeContinuitySummary } from "../src/services/aiContextService.js";
const results = []; let clock = 0;
const extract = (text) => extractExplicitVocationalUpdates({ text, canonicalMentions: [] });
const applyText = (profile, text) => applyVocationalUpdates(profile, extract(text), {
  nextRevision: profile.revision + 1,
  observedAt: new Date(Date.UTC(2026, 7, 5, 3, 0, clock++)).toISOString(),
}).profile;
async function test(name, callback) {
  try { await callback(); results.push({ name, status: "PASS" }); console.log("PASS " + name); }
  catch (error) { results.push({ name, status: "FAIL", error: error.message }); console.error("FAIL " + name + ": " + error.message); }
}
await test("A interest then difficulty keeps independent dimensions", () => {
  let p = applyText(getDefaultVocationalProfile(), "Me gustan las matematicas");
  p = applyText(p, "Pensandolo mejor, las matematicas se me dificultan");
  assert.deepEqual(p.signals.map(({ dimension, polarity }) => [dimension, polarity]), [["ability", "negative"], ["interest", "positive"]]);
});
await test("B ability then negation uses latest value", () => {
  let p = applyText(getDefaultVocationalProfile(), "Soy bueno dibujando");
  p = applyText(p, "No soy bueno para dibujar");
  assert.equal(p.signals.length, 1); assert.equal(p.signals[0].polarity, "negative");
});
await test("C preference then rejection uses latest value", () => {
  let p = applyText(getDefaultVocationalProfile(), "Me gusta disenar");
  p = applyText(p, "Ya no me gusta disenar");
  assert.equal(p.signals[0].polarity, "negative");
});
await test("D explicit restriction removal lifts only restriction", () => {
  let p = applyText(getDefaultVocationalProfile(), "No me gusta trabajar con sangre");
  p = applyText(p, "Ya no tengo problema con sangre");
  assert.equal(p.signals.length, 0);
});
await test("E correction preserves unrelated data", () => {
  let p = applyText(getDefaultVocationalProfile(), "Me interesa programar y disenar");
  p = applyText(p, "Las matematicas se me dificultan");
  assert.deepEqual(p.signals.map((item) => item.conceptId).sort(), ["design", "mathematics", "programming"]);
});
await test("F ambiguous message removes nothing", () => {
  const p = applyText(getDefaultVocationalProfile(), "Me interesa programar");
  const operations = extract("Tal vez cambie de opinion");
  assert.equal(operations.updates.length + operations.removeSignals.length, 0);
  assert.deepEqual(applyVocationalUpdates(p, operations, { nextRevision: 2, observedAt: "2026-08-05T03:01:00.000Z" }).profile, p);
});
await test("G unequivocal contradiction latest revision wins", () => {
  let p = applyText(getDefaultVocationalProfile(), "Me gusta construir");
  p = applyText(p, "Ya no me gusta construir");
  assert.equal(p.signals[0].updatedRevision, 2); assert.equal(p.signals[0].polarity, "negative");
});
await test("H equivalent repetition creates no duplicate", () => {
  let p = applyText(getDefaultVocationalProfile(), "Me interesa programar");
  p = applyText(p, "Me interesa programar"); assert.equal(p.signals.length, 1);
});
await test("I revision changes only on semantic change", () => {
  const p = applyText(getDefaultVocationalProfile(), "Me interesa programar");
  const r = applyVocationalUpdates(p, extract("Me interesa programar"), { nextRevision: 2, observedAt: "2026-08-05T03:02:00.000Z" });
  assert.equal(r.changed, false); assert.equal(r.profile.revision, 1);
});
await test("J summary and final context represent no contradiction", () => {
  let p = getDefaultVocationalProfile();
  for (const text of ["Me gustan las matematicas", "Tambien me interesa programar", "Pensandolo mejor, las matematicas se me dificultan", "Me gusta disenar"]) p = applyText(p, text);
  const summary = buildEducativeContinuitySummary({ status: "idle", vocationalProfile: p });
  assert.match(summary, /mathematics: habilidad negativa/);
  assert.match(summary, /mathematics: interes positiva/);
  assert.match(summary, /programming: interes positiva/);
  assert.match(summary, /design: interes positiva/);
  assert.ok(summary.length <= 220);
  const source = readFileSync(new URL("../src/services/aiService.js", import.meta.url), "utf8");
  assert.match(source, /no conviertas dificultad en desinteres ni interes en habilidad/);
  assert.doesNotMatch(source, /Me gustan las matematicas|Pensandolo mejor/);
});
const passed = results.filter((item) => item.status === "PASS").length;
const failed = results.length - passed;
console.log("TOTAL: " + results.length + " | PASS: " + passed + " | FAIL: " + failed);
if (failed) process.exitCode = 1;

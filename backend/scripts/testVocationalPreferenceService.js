import assert from "node:assert/strict";
import {
  applyVocationalUpdates,
  extractExplicitVocationalUpdates,
  getDefaultVocationalProfile,
  normalizeVocationalProfile,
  profilesEqual,
} from "../src/services/vocationalPreferenceService.js";

const NOW = "2026-07-19T00:00:00.000Z";
const PSYCHOLOGY = {
  canonicalProgramId: "psychology",
  name: "Psicología",
  normalizedName: "psicologia",
  matchedAlias: "psicologia",
  exactAliases: ["psicologia"],
};
const DENTISTRY = {
  canonicalProgramId: "dentistry",
  name: "Odontología",
  normalizedName: "odontologia",
  exactAliases: ["odontologia"],
};
const results = [];

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

const extract = (text, canonicalMentions = []) => extractExplicitVocationalUpdates({
  text,
  currentProfile: getDefaultVocationalProfile(),
  canonicalMentions,
});
const apply = (profile, operations, revision = profile.revision + 1) =>
  applyVocationalUpdates(profile, operations, { nextRevision: revision, observedAt: NOW });
const signal = (overrides = {}) => ({
  conceptKind: "subject", conceptId: "mathematics", dimension: "interest",
  polarity: "positive", intensity: 4, source: "explicit_statement",
  updatedRevision: 1, updatedAt: NOW, ...overrides,
});

await test("01 neutral mathematics", () => {
  const result = extract("matemáticas");
  assert.equal(result.updates.length, 0);
  assert.equal(result.reason, "neutral_mentions_only");
});
await test("02 positive mathematics interest", () => {
  assert.deepEqual(extract("Me gustan las matemáticas").updates[0], {
    conceptKind: "subject", conceptId: "mathematics", dimension: "interest",
    polarity: "positive", intensity: 4, source: "explicit_statement",
  });
});
await test("03 rejection replaces positive interest", () => {
  const first = apply(getDefaultVocationalProfile(), extract("Me gustan las matemáticas")).profile;
  const second = apply(first, extract("No me gustan las matemáticas")).profile;
  assert.equal(second.signals.length, 1);
  assert.equal(second.signals[0].polarity, "negative");
});
await test("04 difficulty is negative ability", () => {
  const update = extract("Se me dificultan las matemáticas").updates[0];
  assert.equal(update.dimension, "ability");
  assert.equal(update.polarity, "negative");
});
await test("05 exact program exclusion", () => {
  assert.deepEqual(extract("No quiero estudiar Psicología", [PSYCHOLOGY]).exclusionsToAdd[0], {
    targetKind: "program", targetId: "psychology", mode: "exact", source: "explicit_statement",
  });
});
await test("06 requirement exclusion", () => {
  assert.deepEqual(extract("No quiero carreras con matemáticas").exclusionsToAdd[0], {
    targetKind: "subject", targetId: "mathematics", mode: "requirement", source: "explicit_statement",
  });
});
await test("07 difficulty and interest coexist", () => {
  const applied = apply(getDefaultVocationalProfile(), extract(
    "No soy bueno en matemáticas, pero sí me interesan",
  ));
  assert.equal(applied.profile.signals.length, 2);
  assert.deepEqual(applied.profile.signals.map((item) => item.dimension).sort(), ["ability", "interest"]);
});
await test("08 before liked but no longer", () => {
  const update = extract("Antes me gustaban las matemáticas, pero ya no").updates;
  assert.equal(update.length, 1);
  assert.equal(update[0].source, "explicit_correction");
  assert.equal(update[0].polarity, "negative");
});
await test("09 coordinated interests", () => {
  const ids = extract("Me gusta construir y diseñar").updates.map((item) => item.conceptId).sort();
  assert.deepEqual(ids, ["construction", "design"]);
});
await test("10 comparative preference", () => {
  const updates = extract("Prefiero diseño, no construcción").updates;
  assert.deepEqual(updates.map((item) => [item.conceptId, item.dimension, item.polarity]), [
    ["design", "preference", "positive"], ["construction", "preference", "negative"],
  ]);
  assert.ok(updates.every((item) => item.source === "explicit_comparison"));
});
await test("11 dentistry correction", () => {
  const result = extract("No dije que quisiera Odontología", [DENTISTRY]);
  assert.equal(result.updates[0].conceptId, "dentistry");
  assert.equal(result.updates[0].polarity, "negative");
  assert.equal(result.exclusionsToAdd.length, 0);
});
await test("12 psychology no longer wanted", () => {
  const result = extract("Ya no quiero Psicología", [PSYCHOLOGY]);
  assert.equal(result.exclusionsToAdd[0].targetId, "psychology");
  assert.equal(result.removeSignals.length, 2);
});
await test("13 explicit psychology reactivation", () => {
  const result = extract("Pensándolo bien, sí quiero Psicología", [PSYCHOLOGY]);
  assert.equal(result.updates[0].polarity, "positive");
  assert.equal(result.exclusionsToLift[0].targetId, "psychology");
});
await test("14 strength and rejection coexist", () => {
  let profile = apply(getDefaultVocationalProfile(), extract("Soy bueno dibujando")).profile;
  profile = apply(profile, extract("No me gusta dibujar")).profile;
  assert.deepEqual(profile.signals.map((item) => item.dimension).sort(), ["ability", "interest"]);
});
await test("15 blood restriction and health interest", () => {
  const updates = extract("No me gusta trabajar con sangre, pero me interesa la salud").updates;
  assert.deepEqual(updates.map((item) => [item.conceptId, item.dimension]), [
    ["blood_environment", "restriction"], ["health", "interest"],
  ]);
});
await test("16 assistant text is not an input surface", () => {
  const result = extractExplicitVocationalUpdates({
    text: "conversación neutral", assistantText: "Me gustan las matemáticas",
    currentProfile: null, canonicalMentions: [],
  });
  assert.equal(result.updates.length, 0);
  assert.equal(Object.hasOwn(result, "text"), false);
});
await test("17 invalid career creates no target", () => {
  const result = extract("No quiero estudiar Astrología", []);
  assert.equal(result.exclusionsToAdd.length, 0);
  assert.equal(result.reason, "ambiguous_statement");
});
await test("18 empty text", () => assert.equal(extract("").reason, "no_explicit_updates"));
await test("19 non-string text", () => {
  assert.equal(extractExplicitVocationalUpdates({ text: 42 }).reason, "invalid_input");
});
await test("20 text over limit", () => {
  assert.equal(extract("a".repeat(2001)).reason, "input_limit_reached");
});
await test("21 unicode character counting", () => {
  assert.notEqual(extract("😀".repeat(2000)).reason, "input_limit_reached");
  assert.equal(extract("😀".repeat(2001)).reason, "input_limit_reached");
});
await test("22 legacy profile", () => assert.deepEqual(normalizeVocationalProfile({ status: "idle" }), getDefaultVocationalProfile()));
await test("23 null profile", () => assert.deepEqual(normalizeVocationalProfile(null), getDefaultVocationalProfile()));
await test("24 malformed profile", () => {
  const normalized = normalizeVocationalProfile({ version: 1, revision: 0, signals: [42], exclusions: {} });
  assert.deepEqual(normalized, getDefaultVocationalProfile());
});
await test("25 duplicate resolution", () => {
  const normalized = normalizeVocationalProfile({
    version: 1, revision: 2,
    signals: [signal(), signal({ polarity: "negative", updatedRevision: 2, updatedAt: "2026-07-19T00:00:01.000Z" })],
    exclusions: [],
  });
  assert.equal(normalized.signals.length, 1);
  assert.equal(normalized.signals[0].polarity, "negative");
});
await test("26 maximum capacity", () => {
  const signals = Array.from({ length: 128 }, (_, index) => signal({ conceptId: `m${index}` }));
  assert.equal(normalizeVocationalProfile({ version: 1, revision: 1, signals, exclusions: [] }).signals.length, 128);
});
await test("27 exceeded capacity preserves profile", () => {
  const full = normalizeVocationalProfile({
    version: 1, revision: 1,
    signals: Array.from({ length: 128 }, (_, index) => signal({ conceptId: `m${index}` })), exclusions: [],
  });
  const result = apply(full, { updates: [{
    conceptKind: "subject", conceptId: "overflow", dimension: "interest",
    polarity: "positive", intensity: 4, source: "explicit_statement",
  }] });
  assert.equal(result.reason, "profile_capacity_exceeded");
  assert.ok(profilesEqual(result.profile, full));
  assert.equal(result.profile.signals.length, 128);
});
await test("28 recent contradiction wins", () => {
  const normalized = normalizeVocationalProfile({
    version: 1, revision: 3,
    signals: [signal({ updatedRevision: 3, polarity: "negative" }), signal({ updatedRevision: 2 })], exclusions: [],
  });
  assert.equal(normalized.signals[0].polarity, "negative");
});
await test("29 different dimensions coexist", () => {
  const profile = normalizeVocationalProfile({
    version: 1, revision: 1,
    signals: [signal(), signal({ dimension: "ability", polarity: "negative" })], exclusions: [],
  });
  assert.equal(profile.signals.length, 2);
});
await test("30 short neutral word", () => assert.equal(extract("salud").updates.length, 0));
await test("31 exact career differs from concept", () => {
  const result = extract("No quiero estudiar Psicología, me interesan las matemáticas", [PSYCHOLOGY]);
  assert.equal(result.exclusionsToAdd[0].targetKind, "program");
  assert.equal(result.updates[0].conceptKind, "subject");
});
await test("32 subject and program are not mixed", () => {
  const result = extract("No quiero estudiar Matemáticas", [{ ...PSYCHOLOGY, canonicalProgramId: "math-degree", name: "Matemáticas", normalizedName: "matematicas", exactAliases: ["matematicas"] }]);
  assert.equal(result.exclusionsToAdd[0].targetId, "math-degree");
  assert.equal(result.exclusionsToAdd[0].targetKind, "program");
});
await test("33 getters are not executed", () => {
  let reads = 0;
  const profile = { version: 1, revision: 0, exclusions: [] };
  Object.defineProperty(profile, "signals", { enumerable: true, get() { reads += 1; return []; } });
  normalizeVocationalProfile(profile);
  assert.equal(reads, 0);
});
await test("34 dangerous prototype is rejected", () => {
  const profile = Object.create({ signals: [signal()] });
  profile.version = 1;
  profile.revision = 1;
  profile.exclusions = [];
  assert.deepEqual(normalizeVocationalProfile(profile), getDefaultVocationalProfile());
});
await test("35 deterministic order", () => {
  const profile = normalizeVocationalProfile({
    version: 1, revision: 1,
    signals: [signal({ conceptId: "zeta" }), signal({ conceptId: "alpha" })], exclusions: [],
  });
  assert.deepEqual(profile.signals.map((item) => item.conceptId), ["alpha", "zeta"]);
});
await test("36 input is not modified", () => {
  const profile = { version: 1, revision: 1, signals: [signal()], exclusions: [] };
  const before = JSON.stringify(profile);
  normalizeVocationalProfile(profile);
  assert.equal(JSON.stringify(profile), before);
});
await test("37 ambiguous exclusion is not persisted", () => {
  const result = extract("No quiero estudiar Psicología", [PSYCHOLOGY, { ...PSYCHOLOGY, canonicalProgramId: "psychology-2" }]);
  assert.equal(result.exclusionsToAdd.length, 0);
  assert.equal(result.ambiguous, true);
});
await test("38 neutral mention does not increment revision", () => {
  const result = apply(getDefaultVocationalProfile(), extract("matemáticas"));
  assert.equal(result.profile.revision, 0);
  assert.equal(result.changed, false);
});
await test("39 real change increments once", () => {
  const result = apply(getDefaultVocationalProfile(), extract("Me gustan las matemáticas"));
  assert.equal(result.profile.revision, 1);
});
await test("40 same-message changes share revision", () => {
  const result = apply(getDefaultVocationalProfile(), extract("Me gusta construir y diseñar"));
  assert.equal(result.profile.signals.length, 2);
  assert.ok(result.profile.signals.every((item) => item.updatedRevision === 1));
});

await test("41 contrasted interest preserves explicit rejection", () => {
  const updates = extract("Me gusta diseñar, pero no construir").updates;
  assert.deepEqual(updates.map((item) => [item.conceptId, item.polarity]), [
    ["design", "positive"], ["construction", "negative"],
  ]);
});
await test("42 impossible calendar date is rejected", () => {
  const profile = normalizeVocationalProfile({
    version: 1, revision: 1,
    signals: [signal({ updatedAt: "2026-02-31T00:00:00.000Z" })], exclusions: [],
  });
  assert.equal(profile.signals.length, 0);
});
await test("43 total signal tie is input-order independent", () => {
  const positive = signal({ polarity: "positive" });
  const negative = signal({ polarity: "negative" });
  const left = normalizeVocationalProfile({ version: 1, revision: 1, signals: [positive, negative], exclusions: [] });
  const right = normalizeVocationalProfile({ version: 1, revision: 1, signals: [negative, positive], exclusions: [] });
  assert.deepEqual(left, right);
});
await test("44 total exclusion tie is input-order independent", () => {
  const base = { targetKind: "subject", targetId: "mathematics", mode: "requirement",
    source: "explicit_statement", updatedRevision: 1, updatedAt: NOW };
  const correction = { ...base, source: "explicit_correction" };
  const left = normalizeVocationalProfile({ version: 1, revision: 1, signals: [], exclusions: [base, correction] });
  const right = normalizeVocationalProfile({ version: 1, revision: 1, signals: [], exclusions: [correction, base] });
  assert.deepEqual(left, right);
});
await test("45 exclusion capacity rejects without truncation", () => {
  const exclusions = Array.from({ length: 64 }, (_, index) => ({
    targetKind: "subject", targetId: `e${index}`, mode: "requirement",
    source: "explicit_statement", updatedRevision: 1, updatedAt: NOW,
  }));
  const profile = normalizeVocationalProfile({ version: 1, revision: 1, signals: [], exclusions });
  const result = apply(profile, { exclusionsToAdd: [{
    targetKind: "subject", targetId: "overflow", mode: "requirement", source: "explicit_statement",
  }] });
  assert.equal(result.reason, "profile_capacity_exceeded");
  assert.equal(result.profile.exclusions.length, 64);
  assert.ok(profilesEqual(result.profile, profile));
});
await test("46 serialized byte limit uses real UTF-8 byte length", () => {
  const oversized = {
    version: 1, revision: 1,
    signals: Array.from({ length: 128 }, (_, index) => signal({ conceptId: `s${index}` })),
    exclusions: Array.from({ length: 64 }, (_, index) => ({
      targetKind: "subject", targetId: `e${index}`, mode: "requirement",
      source: "explicit_statement", updatedRevision: 1, updatedAt: NOW,
    })),
  };
  assert.ok(Buffer.byteLength(JSON.stringify(oversized), "utf8") > 32768);
  assert.deepEqual(normalizeVocationalProfile(oversized), getDefaultVocationalProfile());
});
await test("47 one invalid update rejects the whole message", () => {
  const result = apply(getDefaultVocationalProfile(), { updates: [
    { conceptKind: "subject", conceptId: "mathematics", dimension: "interest",
      polarity: "positive", intensity: 4, source: "explicit_statement" },
    { conceptKind: "subject", conceptId: "invalid", dimension: "restriction",
      polarity: "positive", intensity: 4, source: "explicit_statement" },
  ] });
  assert.equal(result.reason, "invalid_profile_update");
  assert.deepEqual(result.profile, getDefaultVocationalProfile());
});
await test("48 null-prototype profile is normalized safely", () => {
  const profile = Object.create(null);
  Object.assign(profile, { version: 1, revision: 1, signals: [signal()], exclusions: [] });
  assert.equal(normalizeVocationalProfile(profile).signals.length, 1);
});
await test("49 throwing getter is never executed", () => {
  const profile = { version: 1, revision: 0, exclusions: [] };
  Object.defineProperty(profile, "signals", { enumerable: true, get() { throw new Error("getter executed"); } });
  assert.doesNotThrow(() => normalizeVocationalProfile(profile));
  assert.deepEqual(normalizeVocationalProfile(profile), getDefaultVocationalProfile());
});
await test("50 exact text clause and token boundaries", () => {
  const phrase = "Me gustan las matemáticas";
  assert.notEqual(extract(" ".repeat(2000 - [...phrase].length) + phrase).reason, "input_limit_reached");
  assert.equal(extract(" ".repeat(2001 - [...phrase].length) + phrase).reason, "input_limit_reached");
  assert.notEqual(extract(Array(12).fill("salud").join(".")).reason, "input_limit_reached");
  assert.equal(extract(Array(13).fill("salud").join(".")).reason, "input_limit_reached");
  assert.notEqual(extract(Array(256).fill("x").join(" ")).reason, "input_limit_reached");
  assert.equal(extract(Array(257).fill("x").join(" ")).reason, "input_limit_reached");
});
await test("51 exactly twelve extracted operations are accepted", () => {
  const result = extract("Me gusta matemáticas, diseñar, construir, dibujar, programar, ayudar a las personas, escuchar a las personas, hablar en público, salud, hospitales, sangre y trabajar con personas");
  assert.equal(result.updates.length, 12);
  assert.equal(result.reason, "explicit_updates_found");
});
await test("52 unknown fields are removed without mutating input", () => {
  const input = { version: 1, revision: 1, unknown: "drop", signals: [signal({ unknown: "drop" })], exclusions: [] };
  const before = structuredClone(input);
  const normalized = normalizeVocationalProfile(input);
  assert.equal(Object.hasOwn(normalized, "unknown"), false);
  assert.equal(Object.hasOwn(normalized.signals[0], "unknown"), false);
  assert.deepEqual(input, before);
});
await test("53 signal-array getters are not executed", () => {
  const signals = [];
  Object.defineProperty(signals, "0", { enumerable: true, get() { throw new Error("array getter executed"); } });
  signals.length = 1;
  const profile = { version: 1, revision: 1, signals, exclusions: [] };
  assert.doesNotThrow(() => normalizeVocationalProfile(profile));
  assert.equal(normalizeVocationalProfile(profile).signals.length, 0);
});
await test("54 operation-array getters reject the whole update", () => {
  const updates = [];
  Object.defineProperty(updates, "0", { enumerable: true, get() { throw new Error("operation getter executed"); } });
  updates.length = 1;
  const result = apply(getDefaultVocationalProfile(), { updates });
  assert.equal(result.reason, "invalid_profile_update");
  assert.deepEqual(result.profile, getDefaultVocationalProfile());
});
await test("55 canonical mention array getters are not executed", () => {
  const mentions = [];
  Object.defineProperty(mentions, "0", { enumerable: true, get() { throw new Error("mention getter executed"); } });
  mentions.length = 1;
  assert.doesNotThrow(() => extractExplicitVocationalUpdates({
    text: "No quiero estudiar Psicología", currentProfile: null, canonicalMentions: mentions,
  }));
});
await test("56 oversized raw arrays are safely rejected", () => {
  const profile = {
    version: 1, revision: 1,
    signals: Array.from({ length: 129 }, () => signal()), exclusions: [],
  };
  assert.deepEqual(normalizeVocationalProfile(profile), getDefaultVocationalProfile());
});
await test("57 throwing proxy traps return a safe profile", () => {
  const proxy = new Proxy({}, { getPrototypeOf() { throw new Error("proxy trap"); } });
  assert.doesNotThrow(() => normalizeVocationalProfile(proxy));
  assert.deepEqual(normalizeVocationalProfile(proxy), getDefaultVocationalProfile());
});
await test("58 exact exclusion survives neutral mention then explicit reactivation lifts it", () => {
  let profile = apply(getDefaultVocationalProfile(), extract("Ya no quiero Psicología", [PSYCHOLOGY])).profile;
  const neutral = apply(profile, extract("Psicología", [PSYCHOLOGY]));
  assert.equal(neutral.changed, false);
  assert.equal(neutral.profile.exclusions.length, 1);
  profile = apply(neutral.profile, extract("Pensándolo bien, sí quiero Psicología", [PSYCHOLOGY])).profile;
  assert.equal(profile.exclusions.length, 0);
  assert.equal(profile.signals.find((item) => item.conceptId === "psychology").polarity, "positive");
});
await test("59 reactivating another program does not lift psychology", () => {
  let profile = apply(getDefaultVocationalProfile(), extract("Ya no quiero Psicología", [PSYCHOLOGY])).profile;
  profile = apply(profile, extract("Pensándolo bien, sí quiero Odontología", [DENTISTRY])).profile;
  assert.equal(profile.exclusions.length, 1);
  assert.equal(profile.exclusions[0].targetId, "psychology");
});
await test("60 public API contains exactly the five required functions", async () => {
  const service = await import("../src/services/vocationalPreferenceService.js");
  assert.deepEqual(Object.keys(service).sort(), [
    "applyVocationalUpdates", "extractExplicitVocationalUpdates", "getDefaultVocationalProfile",
    "normalizeVocationalProfile", "profilesEqual",
  ]);
});
const passed = results.filter((item) => item.status === "PASS").length;
const failed = results.length - passed;
console.log(`TOTAL: ${results.length} | PASS: ${passed} | FAIL: ${failed}`);
if (failed) process.exitCode = 1;

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as rankingService from "../src/services/vocationalRankingService.js";

const {
  evaluateVocationalCandidate,
  rankVocationalCandidates,
  validateRankingInput,
} = rankingService;

const catalog = JSON.parse(readFileSync(new URL("../src/config/vocationalCareerTraits.json", import.meta.url), "utf8"));
const relations = JSON.parse(readFileSync(new URL("../src/config/educativeProgramRelations.json", import.meta.url), "utf8"));
const lexicon = JSON.parse(readFileSync(new URL("../src/config/vocationalConceptLexicon.json", import.meta.url), "utf8"));
const requireJson = createRequire(import.meta.url);

const IDS = Object.freeze({
  design: "especialidad_especialidad_en_diseno_digital",
  designReduced: "licenciatura_diseno_y_gestion_de_redes_logisticas",
  mathematics: "licenciatura_matematicas",
  mathematicalComputing: "licenciatura_computacion_matematica",
  programming: "tecnico_bachillerato_programacion",
  construction: "tecnico_bachillerato_construccion",
  health: "licenciatura_ciencias_de_la_actividad_fisica_y_salud",
  architecture: "licenciatura_arquitectura",
  psychology: "licenciatura_psicologia",
  dentistry: "licenciatura_odontologia",
  ambiguousDesign: "licenciatura_diseno_grafico",
  software: "ingenieria_de_software_y_sistemas_computacionales",
});

const KIND_BY_CONCEPT = Object.freeze({
  mathematics: "subject",
  design: "activity",
  programming: "activity",
  construction: "activity",
  health: "subject",
  hospital_environment: "environment",
  blood_environment: "environment",
});
const AT = "2026-01-01T00:00:00.000Z";
const profile = (signals = [], exclusions = [], revision = 1) => ({
  version: 1,
  revision,
  signals,
  exclusions,
});
const signal = (conceptId, dimension = "interest", polarity = "positive", intensity = 3, updatedRevision = 1) => ({
  conceptKind: KIND_BY_CONCEPT[conceptId] ?? "activity",
  conceptId,
  dimension,
  polarity,
  intensity,
  source: "explicit_statement",
  updatedRevision,
  updatedAt: AT,
});
const exclusion = (targetId, updatedRevision = 1) => ({
  targetKind: "program",
  targetId,
  mode: "exact",
  source: "explicit_statement",
  updatedRevision,
  updatedAt: AT,
});
const candidate = (canonicalProgramId, source = "profile_inference") => ({
  canonicalProgramId,
  source,
  isExplicitCurrentRequest: source === "explicit_user_request",
  isExplicitCurrentSelection: source === "explicit_user_selection",
});
const single = (vocationalProfile, item, currentRevision) => {
  const input = { vocationalProfile, candidate: item };
  if (currentRevision !== undefined) input.currentRevision = currentRevision;
  return evaluateVocationalCandidate(input);
};
const multiple = (vocationalProfile, candidates, currentRevision) => {
  const input = { vocationalProfile, candidates };
  if (currentRevision !== undefined) input.currentRevision = currentRevision;
  return rankVocationalCandidates(input);
};
const empty = () => profile([], [], 0);
const valueFor = (result, code) => result.scoreBreakdown.find((entry) => entry.code === code)?.value;
const throwsCode = (callback, code) => assert.throws(callback, (error) => error?.code === code);

const results = [];
async function test(number, name, callback) {
  const label = `${String(number).padStart(3, "0")} ${name}`;
  try {
    await callback();
    results.push({ name: label, status: "PASS" });
    console.log(`PASS ${label}`);
  } catch (error) {
    results.push({ name: label, status: "FAIL", error: error.message });
    console.error(`FAIL ${label}: ${error.message}`);
  }
}

await test(1, "service loads", () => assert.equal(typeof rankVocationalCandidates, "function"));
await test(2, "exports are exact", () => assert.deepEqual(Object.keys(rankingService).sort(), [
  "evaluateVocationalCandidate", "rankVocationalCandidates", "validateRankingInput",
]));
await test(3, "approved catalog loads", () => assert.equal(single(empty(), candidate(IDS.mathematics, "explicit_user_request")).classification, "accepted"));
await test(4, "catalog file is not mutated", () => {
  const catalogUrl = new URL("../src/config/vocationalCareerTraits.json", import.meta.url);
  const before = readFileSync(catalogUrl);
  validateRankingInput({ vocationalProfile: empty(), candidates: [] });
  assert.deepEqual(readFileSync(catalogUrl), before);
});
await test(5, "profile is not mutated", () => {
  const input = profile([signal("design")]);
  const before = JSON.stringify(input);
  single(input, candidate(IDS.design));
  assert.equal(JSON.stringify(input), before);
});
await test(6, "candidates are not mutated", () => {
  const items = [candidate(IDS.design, "direct_canonical_mention")];
  const before = JSON.stringify(items);
  multiple(empty(), items);
  assert.equal(JSON.stringify(items), before);
});
await test(7, "output is deterministic", () => {
  const input = profile([signal("design")]);
  assert.deepEqual(single(input, candidate(IDS.design)), single(input, candidate(IDS.design)));
});
await test(8, "output has no personal text", () => {
  const output = JSON.stringify(single(empty(), candidate(IDS.design, "explicit_user_request")));
  assert.doesNotMatch(output, /name|message|url|institution|alias|updatedAt/u);
});
await test(9, "reason codes are closed", () => {
  const allowed = new Set([
    "explicit_user_request", "explicit_user_selection", "direct_canonical_mention", "search_continuation",
    "positive_interest_match", "positive_ability_match", "positive_preference_match",
    "negative_interest_match", "negative_ability_match", "negative_preference_match",
    "negative_restriction_match", "stale_signal_discount", "reduced_program_trait_weight", "score_clamped",
    "accepted_score_threshold", "accepted_explicit_choice", "confirmation_score_threshold", "moderate_positive_match", "invalid_program",
    "exact_exclusion", "unclassified_inferred_candidate", "gemini_only_candidate", "family_inference_disabled",
    "nearby_inference_disabled", "insufficient_evidence", "rejected_score_threshold",
  ]);
  assert.ok(single(profile([signal("design")]), candidate(IDS.design)).reasonCodes.every((code) => allowed.has(code)));
});
await test(10, "breakdown is safe", () => {
  const entries = single(profile([signal("design")]), candidate(IDS.design)).scoreBreakdown;
  assert.ok(entries.every((entry) => Object.keys(entry).every((key) => ["code", "conceptId", "value"].includes(key))));
});

await test(11, "empty profile rejects inference", () => assert.equal(single(empty(), candidate(IDS.design)).classification, "rejected"));
await test(12, "empty profile rejects Gemini", () => assert.deepEqual(single(empty(), candidate(IDS.design, "gemini_response")).reasonCodes, ["gemini_only_candidate"]));
await test(13, "empty profile accepts explicit classified request", () => assert.equal(single(empty(), candidate(IDS.design, "explicit_user_request")).classification, "accepted"));
await test(14, "empty profile accepts explicit unclassified request", () => assert.equal(single(empty(), candidate(IDS.architecture, "explicit_user_request")).classification, "accepted"));
await test(15, "empty profile confirms direct unclassified mention", () => assert.equal(single(empty(), candidate(IDS.architecture, "direct_canonical_mention")).classification, "confirmation_required"));

await test(16, "positive interest design", () => assert.equal(valueFor(single(profile([signal("design")]), candidate(IDS.design)), "positive_interest_match"), 12));
await test(17, "positive ability design", () => assert.equal(valueFor(single(profile([signal("design", "ability")]), candidate(IDS.design)), "positive_ability_match"), 6));
await test(18, "positive preference design", () => assert.equal(valueFor(single(profile([signal("design", "preference")]), candidate(IDS.design)), "positive_preference_match"), 9));
await test(19, "two positive signals satisfy accepted condition", () => {
  const input = profile([signal("design", "interest", "positive", 5), signal("design", "preference", "positive", 5)]);
  assert.equal(single(input, candidate(IDS.design, "direct_canonical_mention")).classification, "accepted");
});
await test(20, "intensity one factor", () => assert.equal(single(profile([signal("design", "interest", "positive", 1)]), candidate(IDS.design)).score, 7.2));
await test(21, "intensity three factor", () => assert.equal(single(profile([signal("design", "interest", "positive", 3)]), candidate(IDS.design)).score, 12));
await test(22, "intensity five factor", () => assert.equal(single(profile([signal("design", "interest", "positive", 5)]), candidate(IDS.design)).score, 16.8));
await test(23, "trait weight three factor", () => assert.equal(single(profile([signal("design")]), candidate(IDS.designReduced)).score, 9));
await test(24, "trait weight five factor", () => assert.equal(single(profile([signal("design")]), candidate(IDS.design)).score, 12));
await test(25, "recency distance zero", () => assert.equal(single(profile([signal("design", "interest", "positive", 3, 50)], [], 50), candidate(IDS.design), 50).score, 12));
await test(26, "recency distance nine", () => assert.equal(single(profile([signal("design", "interest", "positive", 3, 41)], [], 50), candidate(IDS.design), 50).score, 10.2));
await test(27, "recency distance twenty one", () => assert.equal(single(profile([signal("design", "interest", "positive", 3, 29)], [], 50), candidate(IDS.design), 50).score, 8.4));
await test(28, "recency distance forty one", () => assert.equal(single(profile([signal("design", "interest", "positive", 3, 9)], [], 50), candidate(IDS.design), 50).score, 6));

await test(29, "negative interest preserves explicit request", () => {
  const result = single(profile([signal("design", "interest", "negative")]), candidate(IDS.design, "explicit_user_request"));
  assert.equal(result.score, 22);
  assert.equal(result.classification, "accepted");
});
await test(30, "negative ability does not block", () => {
  const result = single(profile([signal("design", "ability", "negative")]), candidate(IDS.design, "explicit_user_request"));
  assert.equal(result.classification, "accepted");
  assert.notDeepEqual(result.reasonCodes, ["exact_exclusion"]);
});
await test(31, "negative preference preserves explicit request", () => {
  const result = single(profile([signal("design", "preference", "negative")]), candidate(IDS.design, "explicit_user_request"));
  assert.equal(result.score, 32);
  assert.equal(result.classification, "accepted");
});
await test(32, "negative restriction does not block without requirement", () => assert.equal(single(profile([signal("design", "restriction", "negative")]), candidate(IDS.design, "explicit_user_request")).classification, "accepted"));
await test(33, "positive interest and difficulty coexist", () => {
  const result = single(profile([signal("design"), signal("design", "ability", "negative")]), candidate(IDS.design));
  assert.equal(result.positiveEvidenceCount, 1);
  assert.equal(result.negativeEvidenceCount, 1);
});
await test(34, "positive preference and difficulty coexist", () => {
  const result = single(profile([signal("design", "preference"), signal("design", "ability", "negative")]), candidate(IDS.design));
  assert.equal(result.score, 4);
});
await test(35, "strong rejection reduces score", () => {
  const mild = single(profile([signal("design", "interest", "negative", 1)]), candidate(IDS.design, "explicit_user_request"));
  const strong = single(profile([signal("design", "interest", "negative", 5)]), candidate(IDS.design, "explicit_user_request"));
  assert.ok(strong.score < mild.score);
});
await test(36, "score below threshold rejects", () => assert.equal(single(profile([signal("design", "ability")]), candidate(IDS.design)).classification, "rejected"));

await test(37, "exact exclusion blocks request", () => assert.deepEqual(single(profile([], [exclusion(IDS.design)]), candidate(IDS.design, "explicit_user_request")).reasonCodes, ["exact_exclusion"]));
await test(38, "exact exclusion blocks selection", () => assert.deepEqual(single(profile([], [exclusion(IDS.design)]), candidate(IDS.design, "explicit_user_selection")).reasonCodes, ["exact_exclusion"]));
await test(39, "exact exclusion blocks Gemini", () => assert.deepEqual(single(profile([signal("design")], [exclusion(IDS.design)]), candidate(IDS.design, "gemini_response")).reasonCodes, ["exact_exclusion"]));
await test(40, "lifted exclusion is absent and does not block", () => assert.equal(single(empty(), candidate(IDS.design, "explicit_user_request")).classification, "accepted"));
await test(41, "other exact exclusion does not affect candidate", () => assert.equal(single(profile([], [exclusion(IDS.mathematics)]), candidate(IDS.design, "explicit_user_request")).classification, "accepted"));

await test(42, "Gemini adds zero points", () => assert.equal(single(profile([signal("design")]), candidate(IDS.design, "gemini_response")).score, 12));
await test(43, "Gemini without evidence has closed gate", () => assert.deepEqual(single(empty(), candidate(IDS.design, "gemini_response")).reasonCodes, ["gemini_only_candidate"]));
await test(44, "Gemini with moderate evidence confirms", () => assert.equal(single(profile([signal("design")]), candidate(IDS.design, "gemini_response")).classification, "confirmation_required"));
await test(45, "Gemini with sufficient evidence accepts", () => {
  const input = profile([
    signal("design", "interest", "positive", 5),
    signal("design", "ability", "positive", 5),
    signal("design", "preference", "positive", 5),
  ]);
  assert.equal(single(input, candidate(IDS.design, "gemini_response")).classification, "accepted");
});
await test(46, "Gemini cannot lift exclusion", () => assert.deepEqual(single(profile([signal("design")], [exclusion(IDS.design)]), candidate(IDS.design, "gemini_response")).reasonCodes, ["exact_exclusion"]));
await test(47, "Gemini evaluation does not mutate profile", () => {
  const input = profile([signal("design")]);
  const before = JSON.stringify(input);
  single(input, candidate(IDS.design, "gemini_response"));
  assert.equal(JSON.stringify(input), before);
});
await test(48, "Gemini cannot open unclassified program", () => assert.deepEqual(single(empty(), candidate(IDS.architecture, "gemini_response")).reasonCodes, ["unclassified_inferred_candidate"]));

await test(49, "unclassified explicit request allowed", () => assert.equal(single(empty(), candidate(IDS.architecture, "explicit_user_request")).classification, "accepted"));
await test(50, "unclassified explicit selection allowed", () => assert.equal(single(empty(), candidate(IDS.architecture, "explicit_user_selection")).classification, "accepted"));
await test(51, "unclassified direct mention allowed", () => assert.equal(single(empty(), candidate(IDS.architecture, "direct_canonical_mention")).classification, "confirmation_required"));
await test(52, "unclassified search continuation allowed", () => assert.equal(single(empty(), candidate(IDS.architecture, "search_continuation")).classification, "confirmation_required"));
await test(53, "unclassified profile inference blocked", () => assert.deepEqual(single(empty(), candidate(IDS.architecture)).reasonCodes, ["unclassified_inferred_candidate"]));
await test(54, "unclassified Gemini blocked", () => assert.deepEqual(single(empty(), candidate(IDS.architecture, "gemini_response")).reasonCodes, ["unclassified_inferred_candidate"]));
await test(55, "unclassified family blocked", () => assert.deepEqual(single(empty(), candidate(IDS.architecture, "same_family")).reasonCodes, ["unclassified_inferred_candidate"]));
await test(56, "unclassified nearby blocked", () => assert.deepEqual(single(empty(), candidate(IDS.architecture, "documented_nearby")).reasonCodes, ["unclassified_inferred_candidate"]));

await test(57, "same family adds zero", () => assert.equal(single(profile([signal("design")]), candidate(IDS.design, "same_family")).score, 12));
await test(58, "nearby adds zero", () => assert.equal(single(profile([signal("design")]), candidate(IDS.design, "documented_nearby")).score, 12));
await test(59, "same family without evidence rejects", () => assert.deepEqual(single(empty(), candidate(IDS.design, "same_family")).reasonCodes, ["family_inference_disabled"]));
await test(60, "nearby without evidence rejects", () => assert.deepEqual(single(empty(), candidate(IDS.design, "documented_nearby")).reasonCodes, ["nearby_inference_disabled"]));
await test(61, "familyId is not accepted as candidate data", () => throwsCode(() => single(empty(), { ...candidate(IDS.design), familyId: "x" }), "invalid_candidate"));
await test(62, "nearby IDs are not accepted as candidate data", () => throwsCode(() => single(empty(), { ...candidate(IDS.design), nearbyProgramIds: [] }), "invalid_candidate"));

await test(63, "mathematics matches mathematics only", () => assert.equal(single(profile([signal("mathematics")]), candidate(IDS.mathematics)).score, 12));
await test(64, "mathematical computing matches mathematics", () => assert.equal(single(profile([signal("mathematics")]), candidate(IDS.mathematicalComputing)).score, 12));
await test(65, "programming matches programming", () => assert.equal(single(profile([signal("programming")]), candidate(IDS.programming)).score, 12));
await test(66, "construction matches construction", () => assert.equal(single(profile([signal("construction")]), candidate(IDS.construction)).score, 12));
await test(67, "logistics design uses reduced factor", () => assert.equal(single(profile([signal("design")]), candidate(IDS.designReduced)).score, 9));
await test(68, "design without category ranks by configured trait", () => assert.equal(single(profile([signal("design")]), candidate(IDS.design)).classification, "confirmation_required"));
await test(69, "architecture stays unclassified", () => assert.deepEqual(single(profile([signal("construction")]), candidate(IDS.architecture)).reasonCodes, ["unclassified_inferred_candidate"]));
await test(70, "psychology stays unclassified", () => assert.deepEqual(single(profile([signal("health")]), candidate(IDS.psychology)).reasonCodes, ["unclassified_inferred_candidate"]));
await test(71, "dentistry stays unclassified", () => assert.deepEqual(single(profile([signal("health")]), candidate(IDS.dentistry)).reasonCodes, ["unclassified_inferred_candidate"]));
await test(72, "ambiguous graphic design stays unclassified", () => assert.deepEqual(single(profile([signal("design")]), candidate(IDS.ambiguousDesign)).reasonCodes, ["unclassified_inferred_candidate"]));

await test(73, "explicit request adds forty", () => assert.equal(valueFor(single(empty(), candidate(IDS.design, "explicit_user_request")), "explicit_user_request"), 40));
await test(74, "explicit selection adds forty five", () => assert.equal(valueFor(single(empty(), candidate(IDS.design, "explicit_user_selection")), "explicit_user_selection"), 45));
await test(75, "direct mention adds eighteen", () => assert.equal(valueFor(single(empty(), candidate(IDS.design, "direct_canonical_mention")), "direct_canonical_mention"), 18));
await test(76, "continuation adds sixteen", () => assert.equal(valueFor(single(empty(), candidate(IDS.design, "search_continuation")), "search_continuation"), 16));
await test(77, "Gemini source points are zero", () => assert.equal(single(profile([signal("design")]), candidate(IDS.design, "gemini_response")).score, 12));
await test(78, "profile inference source points are zero", () => assert.equal(single(profile([signal("design")]), candidate(IDS.design)).score, 12));
await test(79, "family source points are zero", () => assert.equal(single(profile([signal("design")]), candidate(IDS.design, "same_family")).score, 12));
await test(80, "nearby source points are zero", () => assert.equal(single(profile([signal("design")]), candidate(IDS.design, "documented_nearby")).score, 12));
await test(81, "unknown source fails closed", () => throwsCode(() => single(empty(), { ...candidate(IDS.design), source: "invented" }), "invalid_candidate_source"));

await test(82, "accepted threshold with condition", () => {
  const input = profile([signal("design", "interest", "positive", 5), signal("design", "preference", "positive", 5)]);
  assert.equal(single(input, candidate(IDS.design, "direct_canonical_mention")).classification, "accepted");
});
await test(83, "confirmation range", () => assert.equal(single(profile([signal("design")]), candidate(IDS.design)).classification, "confirmation_required"));
await test(84, "rejected below twelve", () => assert.equal(single(profile([signal("design", "ability")]), candidate(IDS.design)).classification, "rejected"));
await test(85, "score thirty still enforces evidence condition", () => {
  const result = single(profile([signal("design")]), candidate(IDS.design, "direct_canonical_mention"));
  assert.equal(result.score, 30);
  assert.equal(result.classification, "rejected");
  assert.ok(result.reasonCodes.includes("insufficient_evidence"));
  assert.ok(!result.reasonCodes.includes("rejected_score_threshold"));
});
await test(86, "score twelve confirms", () => assert.equal(single(profile([signal("design")]), candidate(IDS.design)).classification, "confirmation_required"));
await test(87, "result does not contain negative zero", () => assert.equal(Object.is(single(empty(), candidate(IDS.design)).score, -0), false));
await test(88, "score upper bound", () => {
  const input = profile([signal("design", "interest", "positive", 5), signal("design", "ability", "positive", 5), signal("design", "preference", "positive", 5)]);
  assert.ok(single(input, candidate(IDS.design, "explicit_user_selection")).score <= 100);
});
await test(89, "score lower bound", () => {
  const input = profile([signal("design", "interest", "negative", 5), signal("design", "ability", "negative", 5), signal("design", "preference", "negative", 5), signal("design", "restriction", "negative", 5)]);
  assert.ok(single(input, candidate(IDS.design)).score >= -100);
});
await test(90, "score has at most two decimals", () => {
  const score = single(profile([signal("design", "interest", "positive", 4, 1)], [], 10), candidate(IDS.design), 10).score;
  assert.equal(Number(score.toFixed(2)), score);
});

await test(91, "accepted precedes confirmation", () => {
  const output = multiple(profile([signal("design")]), [candidate(IDS.design), candidate(IDS.mathematics, "explicit_user_request")]);
  assert.equal(output.ordered[0].classification, "accepted");
});
await test(92, "confirmation precedes rejected", () => {
  const output = multiple(profile([signal("design")]), [candidate(IDS.design), candidate(IDS.mathematics)]);
  assert.deepEqual(output.ordered.map(({ classification }) => classification), ["confirmation_required", "rejected"]);
});
await test(93, "score sorts descending", () => {
  const output = multiple(profile([signal("design"), signal("mathematics", "interest", "positive", 5)]), [candidate(IDS.design), candidate(IDS.mathematics)]);
  assert.equal(output.ordered[0].canonicalProgramId, IDS.mathematics);
});
await test(94, "positive evidence count breaks a score tie", () => {
  const input = profile([
    signal("design", "interest", "positive", 5),
    signal("mathematics", "ability", "positive", 3),
    signal("mathematics", "preference", "positive", 4),
  ]);
  const output = multiple(input, [candidate(IDS.design), candidate(IDS.mathematics)]);
  assert.equal(output.ordered[0].canonicalProgramId, IDS.mathematics);
});
await test(95, "negative evidence count breaks a score tie", () => {
  const input = profile([
    signal("design"),
    signal("mathematics", "interest", "positive", 5),
    signal("mathematics", "preference", "negative", 1),
  ]);
  const output = multiple(input, [candidate(IDS.mathematics), candidate(IDS.design)]);
  assert.equal(output.ordered[0].canonicalProgramId, IDS.design);
});
await test(96, "source priority breaks a gate tie", () => {
  const output = multiple(empty(), [candidate("missing_a", "explicit_user_request"), candidate("missing_z", "explicit_user_selection")]);
  assert.equal(output.ordered[0].canonicalProgramId, "missing_z");
});
await test(97, "canonical ID breaks final tie", () => {
  const output = multiple(empty(), [candidate("missing_z"), candidate("missing_a")]);
  assert.equal(output.ordered[0].canonicalProgramId, "missing_a");
});
await test(98, "order is independent of input order", () => {
  const items = [candidate(IDS.design), candidate(IDS.mathematics, "explicit_user_request")];
  assert.deepEqual(multiple(profile([signal("design")]), items).ordered, multiple(profile([signal("design")]), [...items].reverse()).ordered);
});
await test(99, "repeated ranking order is equal", () => {
  const items = [candidate(IDS.design), candidate(IDS.mathematics)];
  assert.deepEqual(multiple(profile([signal("design")]), items), multiple(profile([signal("design")]), items));
});

await test(100, "duplicate candidate is deduplicated", () => assert.equal(multiple(empty(), [candidate(IDS.design), candidate(IDS.design)]).ordered.length, 1));
await test(101, "selection wins request duplicate", () => {
  const output = multiple(empty(), [candidate(IDS.design, "explicit_user_request"), candidate(IDS.design, "explicit_user_selection")]);
  assert.equal(output.ordered[0].score, 45);
});
await test(102, "request wins Gemini duplicate", () => {
  const output = multiple(empty(), [candidate(IDS.design, "gemini_response"), candidate(IDS.design, "explicit_user_request")]);
  assert.equal(output.ordered[0].classification, "accepted");
});
await test(103, "explicit duplicate flags combine safely", () => {
  const output = multiple(empty(), [candidate(IDS.design, "explicit_user_request"), candidate(IDS.design, "explicit_user_selection")]);
  assert.deepEqual(output.ordered[0].reasonCodes.includes("explicit_user_selection"), true);
});
await test(104, "duplicate input remains immutable", () => {
  const items = [candidate(IDS.design, "gemini_response"), candidate(IDS.design, "explicit_user_request")];
  const before = JSON.stringify(items);
  multiple(empty(), items);
  assert.equal(JSON.stringify(items), before);
});

await test(105, "null input fails", () => throwsCode(() => validateRankingInput(null), "invalid_input"));
await test(106, "null profile fails", () => throwsCode(() => validateRankingInput({ vocationalProfile: null, candidates: [] }), "invalid_profile"));
await test(107, "candidates must be an array", () => throwsCode(() => validateRankingInput({ vocationalProfile: empty(), candidates: {} }), "invalid_input"));
await test(108, "more than 128 candidates fails", () => throwsCode(() => multiple(empty(), Array.from({ length: 129 }, (_, index) => candidate(`missing_${index}`))), "invalid_input"));
await test(109, "more than 128 signals fails", () => throwsCode(() => multiple(profile(Array(129).fill(signal("design"))), []), "invalid_profile"));
await test(110, "more than 64 exclusions fails", () => throwsCode(() => multiple(profile([], Array(65).fill(exclusion(IDS.design))), []), "invalid_profile"));
await test(111, "program ID over 5A.1 limit fails", () => throwsCode(() => single(empty(), candidate(`a${"x".repeat(100)}`)), "invalid_candidate"));
await test(112, "empty program ID fails", () => throwsCode(() => single(empty(), candidate("")), "invalid_candidate"));
await test(113, "negative current revision fails", () => throwsCode(() => multiple(empty(), [], -1), "invalid_current_revision"));
await test(114, "decimal current revision fails", () => throwsCode(() => multiple(empty(), [], 1.5), "invalid_current_revision"));
await test(115, "invalid intensity fails", () => throwsCode(() => multiple(profile([signal("design", "interest", "positive", 6)]), []), "invalid_profile"));
await test(116, "future signal revision fails", () => throwsCode(() => multiple(profile([signal("design", "interest", "positive", 3, 2)], [], 1), []), "invalid_profile"));
await test(117, "NaN current revision fails", () => {
  throwsCode(() => multiple(empty(), [], NaN), "invalid_current_revision");
  throwsCode(() => multiple(empty(), [], Number.MAX_SAFE_INTEGER + 1), "invalid_current_revision");
});
await test(118, "Infinity current revision fails", () => {
  throwsCode(() => multiple(empty(), [], Infinity), "invalid_current_revision");
  throwsCode(() => multiple({ ...empty(), revision: Number.MAX_SAFE_INTEGER + 1 }, []), "invalid_profile");
});
await test(119, "loaded catalog traits belong to the lexicon", () => {
  const conceptIds = new Set(lexicon.concepts.map(({ id }) => id));
  assert.ok(Object.values(catalog.programs).every(({ traitWeights }) =>
    Object.keys(traitWeights).every((id) => conceptIds.has(id))));
});
await test(120, "loaded catalog has exact approved weights and policies", () => {
  const weights = Object.values(catalog.programs).flatMap(({ traitWeights }) => Object.values(traitWeights));
  assert.equal(catalog.categories.length, 6);
  assert.equal(Object.keys(catalog.programs).length, 25);
  assert.ok(weights.every((weight) => weight === 3 || weight === 5));
  assert.equal(catalog.policies.familyInferenceEnabled, false);
  assert.equal(catalog.policies.nearbyInferenceEnabled, false);
});

await test(121, "__proto__ own key fails", () => {
  const input = { vocationalProfile: empty(), candidates: [] };
  Object.defineProperty(input, "__proto__", { value: {}, enumerable: true });
  throwsCode(() => validateRankingInput(input), "invalid_input");
});
await test(122, "constructor own key fails", () => {
  const item = candidate(IDS.design);
  Object.defineProperty(item, "constructor", { value: {}, enumerable: true });
  throwsCode(() => single(empty(), item), "invalid_candidate");
});
await test(123, "prototype own key fails", () => {
  const input = empty();
  Object.defineProperty(input, "prototype", { value: {}, enumerable: true });
  throwsCode(() => multiple(input, []), "invalid_profile");
});
await test(124, "throwing getter is not executed", () => {
  let calls = 0;
  const input = { candidates: [] };
  Object.defineProperty(input, "vocationalProfile", { enumerable: true, get() { calls += 1; throw new Error("secret"); } });
  throwsCode(() => validateRankingInput(input), "invalid_input");
  assert.equal(calls, 0);
});
await test(125, "custom prototype fails", () => {
  const input = { vocationalProfile: empty(), candidates: [] };
  Object.setPrototypeOf(input, { polluted: true });
  throwsCode(() => validateRankingInput(input), "invalid_input");
});
await test(126, "require cache mutation cannot alter the internal snapshot", () => {
  const sharedCatalog = requireJson("../src/config/vocationalCareerTraits.json");
  const originalWeight = sharedCatalog.programs[IDS.mathematics].traitWeights.mathematics;
  try {
    sharedCatalog.programs[IDS.mathematics].traitWeights.mathematics = 3;
    assert.equal(single(profile([signal("mathematics")]), candidate(IDS.mathematics)).score, 12);
  } finally {
    sharedCatalog.programs[IDS.mathematics].traitWeights.mathematics = originalWeight;
  }
});
await test(127, "signals object fails", () => throwsCode(() => multiple({ ...empty(), signals: {} }, []), "invalid_profile"));
await test(128, "exclusions object fails", () => throwsCode(() => multiple({ ...empty(), exclusions: {} }, []), "invalid_profile"));
await test(129, "candidate extra field fails", () => throwsCode(() => single(empty(), { ...candidate(IDS.design), name: "forbidden" }), "invalid_candidate"));
await test(130, "profile extra structural field fails", () => throwsCode(() => multiple({ ...empty(), message: "forbidden" }, []), "invalid_profile"));
await test(131, "output does not share references", () => {
  const first = multiple(profile([signal("design")]), [candidate(IDS.design)]);
  first.ordered[0].reasonCodes.push("mutated");
  const second = multiple(profile([signal("design")]), [candidate(IDS.design)]);
  assert.doesNotMatch(JSON.stringify(second), /mutated/u);
});
await test(132, "error does not leak personal content", () => {
  const secret = "PERSONAL_SECRET_VALUE";
  let caught;
  try {
    validateRankingInput({ vocationalProfile: empty(), candidates: [], message: secret });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.doesNotMatch(caught.message, new RegExp(secret, "u"));
});


await test(133, "Gemini request flag manipulation fails", () => {
  throwsCode(() => single(empty(), { ...candidate(IDS.design, "gemini_response"), isExplicitCurrentRequest: true }), "invalid_candidate");
});
await test(134, "Gemini selection flag manipulation fails", () => {
  throwsCode(() => single(empty(), { ...candidate(IDS.design, "gemini_response"), isExplicitCurrentSelection: true }), "invalid_candidate");
});
await test(135, "family explicit flag manipulation fails", () => {
  throwsCode(() => single(empty(), { ...candidate(IDS.design, "same_family"), isExplicitCurrentRequest: true }), "invalid_candidate");
});
await test(136, "nearby explicit flag manipulation fails", () => {
  throwsCode(() => single(empty(), { ...candidate(IDS.design, "documented_nearby"), isExplicitCurrentSelection: true }), "invalid_candidate");
});
await test(137, "profile inference explicit flag manipulation fails", () => {
  throwsCode(() => single(empty(), { ...candidate(IDS.design), isExplicitCurrentRequest: true }), "invalid_candidate");
});
await test(138, "direct mention selection flag manipulation fails", () => {
  throwsCode(() => single(empty(), { ...candidate(IDS.design, "direct_canonical_mention"), isExplicitCurrentSelection: true }), "invalid_candidate");
});
await test(139, "continuation selection flag manipulation fails", () => {
  throwsCode(() => single(empty(), { ...candidate(IDS.design, "search_continuation"), isExplicitCurrentSelection: true }), "invalid_candidate");
});
await test(140, "request contradictory selection flag fails", () => {
  throwsCode(() => single(empty(), { ...candidate(IDS.design, "explicit_user_request"), isExplicitCurrentSelection: true }), "invalid_candidate");
});
await test(141, "selection without its flag fails", () => {
  throwsCode(() => single(empty(), { ...candidate(IDS.design, "explicit_user_selection"), isExplicitCurrentSelection: false }), "invalid_candidate");
});
await test(142, "request with strong interest rejection remains accepted", () => {
  const result = single(profile([signal("design", "interest", "negative", 5)]), candidate(IDS.design, "explicit_user_request"));
  assert.equal(result.classification, "accepted");
  assert.ok(result.reasonCodes.includes("accepted_explicit_choice"));
});
await test(143, "request with all negative dimensions remains accepted", () => {
  const signals = [
    signal("design", "interest", "negative", 5),
    signal("design", "ability", "negative", 5),
    signal("design", "preference", "negative", 5),
    signal("design", "restriction", "negative", 5),
  ];
  const result = single(profile(signals), candidate(IDS.design, "explicit_user_request"));
  assert.equal(result.classification, "accepted");
  assert.equal(result.negativeEvidenceCount, 4);
});
await test(144, "selection with all negative dimensions remains accepted", () => {
  const signals = [
    signal("design", "interest", "negative", 5),
    signal("design", "ability", "negative", 5),
    signal("design", "preference", "negative", 5),
    signal("design", "restriction", "negative", 5),
  ];
  assert.equal(single(profile(signals), candidate(IDS.design, "explicit_user_selection")).classification, "accepted");
});
await test(145, "exact exclusion still defeats negative explicit choice override", () => {
  const input = profile([signal("design", "interest", "negative", 5)], [exclusion(IDS.design)]);
  assert.deepEqual(single(input, candidate(IDS.design, "explicit_user_request")).reasonCodes, ["exact_exclusion"]);
});
await test(146, "duplicate Gemini and selection keeps selection", () => {
  const output = multiple(empty(), [candidate(IDS.design, "gemini_response"), candidate(IDS.design, "explicit_user_selection")]);
  assert.equal(output.ordered.length, 1);
  assert.equal(output.ordered[0].score, 45);
});
await test(147, "duplicate profile and request keeps request", () => {
  const output = multiple(empty(), [candidate(IDS.design), candidate(IDS.design, "explicit_user_request")]);
  assert.equal(output.ordered[0].score, 40);
});
await test(148, "duplicate family and request keeps request", () => {
  const output = multiple(empty(), [candidate(IDS.design, "same_family"), candidate(IDS.design, "explicit_user_request")]);
  assert.equal(output.ordered[0].classification, "accepted");
});
await test(149, "duplicate nearby and selection keeps selection", () => {
  const output = multiple(empty(), [candidate(IDS.design, "documented_nearby"), candidate(IDS.design, "explicit_user_selection")]);
  assert.equal(output.ordered[0].score, 45);
});
await test(150, "duplicate profile and direct mention keeps direct mention", () => {
  const output = multiple(empty(), [candidate(IDS.design), candidate(IDS.design, "direct_canonical_mention")]);
  assert.equal(output.ordered[0].score, 18);
});
await test(151, "three duplicate origins keep highest priority", () => {
  const output = multiple(empty(), [
    candidate(IDS.design, "profile_inference"),
    candidate(IDS.design, "explicit_user_request"),
    candidate(IDS.design, "explicit_user_selection"),
  ]);
  assert.equal(output.ordered.length, 1);
  assert.equal(output.ordered[0].score, 45);
});
await test(152, "duplicate excluded candidate remains excluded", () => {
  const output = multiple(profile([], [exclusion(IDS.design)]), [
    candidate(IDS.design, "gemini_response"), candidate(IDS.design, "explicit_user_selection"),
  ]);
  assert.deepEqual(output.ordered[0].reasonCodes, ["exact_exclusion"]);
});
await test(153, "candidate limit applies before duplicate reduction", () => {
  throwsCode(() => multiple(empty(), Array.from({ length: 129 }, () => candidate(IDS.design))), "invalid_input");
});
await test(154, "maximum valid breakdown remains safely bounded", () => {
  const signals = [
    signal("design", "interest", "positive", 5, 9),
    signal("design", "ability", "positive", 5, 9),
    signal("design", "preference", "positive", 5, 9),
    signal("design", "restriction", "negative", 5, 9),
  ];
  const result = single(profile(signals, [], 50), candidate(IDS.designReduced, "explicit_user_request"), 50);
  assert.ok(result.scoreBreakdown.length <= 64);
  assert.equal(result.scoreBreakdown.length, 14);
});
await test(155, "maximum valid reason set remains safely bounded and unique", () => {
  const signals = [
    signal("design", "interest", "positive", 5, 9),
    signal("design", "ability", "positive", 5, 9),
    signal("design", "preference", "positive", 5, 9),
    signal("design", "restriction", "negative", 5, 9),
  ];
  const codes = single(profile(signals, [], 50), candidate(IDS.designReduced, "explicit_user_request"), 50).reasonCodes;
  assert.ok(codes.length <= 64);
  assert.equal(new Set(codes).size, codes.length);
});
await test(156, "multiple output keys are exact", () => {
  assert.deepEqual(Object.keys(multiple(empty(), [])).sort(), ["accepted", "confirmationRequired", "ordered", "rejected"]);
});
await test(157, "individual output keys are exact", () => {
  assert.deepEqual(Object.keys(single(empty(), candidate(IDS.design, "explicit_user_request"))).sort(), [
    "canonicalProgramId", "classification", "negativeEvidenceCount", "positiveEvidenceCount",
    "reasonCodes", "score", "scoreBreakdown",
  ]);
});
await test(158, "well formed nonexistent program is rejected as invalid program", () => {
  const result = single(empty(), candidate("well_formed_missing_program"));
  assert.equal(result.classification, "rejected");
  assert.deepEqual(result.reasonCodes, ["invalid_program"]);
});
await test(159, "structurally malformed program ID throws validation error", () => {
  throwsCode(() => single(empty(), candidate("INVALID PROGRAM")), "invalid_candidate");
});
await test(160, "output buckets do not share result references", () => {
  const output = multiple(empty(), [candidate(IDS.design, "explicit_user_request")]);
  assert.notStrictEqual(output.accepted[0], output.ordered[0]);
  output.accepted[0].reasonCodes.push("local_mutation");
  assert.doesNotMatch(JSON.stringify(output.ordered[0]), /local_mutation/u);
});
await test(161, "score 11.99 rejects", () => {
  const input = profile([
    signal("design", "ability", "positive", 2, 41),
    signal("design", "preference", "positive", 5, 41),
    signal("design", "restriction", "negative", 2, 9),
  ], [], 50);
  const result = single(input, candidate(IDS.design), 50);
  assert.equal(result.score, 11.99);
  assert.equal(result.classification, "rejected");
});
await test(162, "score 12.01 confirms", () => {
  const input = profile([
    signal("design", "ability", "positive", 2, 50),
    signal("design", "preference", "positive", 5, 41),
    signal("design", "restriction", "negative", 3, 9),
  ], [], 50);
  const result = single(input, candidate(IDS.design), 50);
  assert.equal(result.score, 12.01);
  assert.equal(result.classification, "confirmation_required");
});
await test(163, "score 29.99 confirms", () => {
  const input = profile([
    signal("design", "ability", "positive", 2, 41),
    signal("design", "preference", "positive", 5, 41),
    signal("design", "restriction", "negative", 2, 9),
  ], [], 50);
  const result = single(input, candidate(IDS.design, "direct_canonical_mention"), 50);
  assert.equal(result.score, 29.99);
  assert.equal(result.classification, "confirmation_required");
});
await test(164, "score 30 with two positive evidences accepts", () => {
  const input = profile([
    signal("design", "ability", "positive", 1),
    signal("design", "preference", "positive", 5),
    signal("design", "restriction", "negative", 1),
  ]);
  const result = single(input, candidate(IDS.design, "direct_canonical_mention"));
  assert.equal(result.score, 30);
  assert.equal(result.classification, "accepted");
});
await test(165, "score 30.01 accepts", () => {
  const input = profile([
    signal("design", "ability", "positive", 2, 50),
    signal("design", "preference", "positive", 5, 41),
    signal("design", "restriction", "negative", 3, 9),
  ], [], 50);
  const result = single(input, candidate(IDS.design, "direct_canonical_mention"), 50);
  assert.equal(result.score, 30.01);
  assert.equal(result.classification, "accepted");
});
await test(166, "natural extrema stay inside clamp without false reason", () => {
  const maximum = single(profile([
    signal("design", "interest", "positive", 5),
    signal("design", "ability", "positive", 5),
    signal("design", "preference", "positive", 5),
  ]), candidate(IDS.design, "explicit_user_selection"));
  const minimum = single(profile([
    signal("design", "interest", "negative", 5),
    signal("design", "ability", "negative", 5),
    signal("design", "preference", "negative", 5),
    signal("design", "restriction", "negative", 5),
  ]), candidate(IDS.design));
  assert.equal(maximum.score, 82.8);
  assert.equal(minimum.score, -53.2);
  assert.ok(!maximum.reasonCodes.includes("score_clamped") && !minimum.reasonCodes.includes("score_clamped"));
});
await test(167, "recency boundary eight keeps full factor", () => {
  assert.equal(single(profile([signal("design", "interest", "positive", 3, 42)], [], 50), candidate(IDS.design), 50).score, 12);
});
await test(168, "recency boundary twenty keeps point eighty five", () => {
  assert.equal(single(profile([signal("design", "interest", "positive", 3, 30)], [], 50), candidate(IDS.design), 50).score, 10.2);
});
await test(169, "recency boundary forty keeps point seventy", () => {
  assert.equal(single(profile([signal("design", "interest", "positive", 3, 10)], [], 50), candidate(IDS.design), 50).score, 8.4);
});
await test(170, "missing current revision falls back to profile revision", () => {
  assert.equal(single(profile([signal("design", "interest", "positive", 3, 1)], [], 10), candidate(IDS.design)).score, 10.2);
});
await test(171, "intensity hostile matrix fails closed", () => {
  for (const intensity of [0, -1, 1.5, "3", NaN, Infinity]) {
    throwsCode(() => multiple(profile([signal("design", "interest", "positive", intensity)]), []), "invalid_profile");
  }
});
await test(172, "sparse candidate array fails closed", () => {
  throwsCode(() => multiple(empty(), new Array(1)), "invalid_input");
});
await test(173, "candidate array with extra property fails closed", () => {
  const items = [candidate(IDS.design)];
  items.extra = true;
  throwsCode(() => multiple(empty(), items), "invalid_input");
});
await test(174, "signal getter is not executed", () => {
  let calls = 0;
  const item = signal("design");
  Object.defineProperty(item, "conceptId", { enumerable: true, get() { calls += 1; throw new Error("secret"); } });
  throwsCode(() => multiple(profile([item]), []), "invalid_profile");
  assert.equal(calls, 0);
});
await test(175, "exclusion getter is not executed", () => {
  let calls = 0;
  const item = exclusion(IDS.design);
  Object.defineProperty(item, "targetId", { enumerable: true, get() { calls += 1; throw new Error("secret"); } });
  throwsCode(() => multiple(profile([], [item]), []), "invalid_profile");
  assert.equal(calls, 0);
});
await test(176, "candidate getter is not executed", () => {
  let calls = 0;
  const item = candidate(IDS.design);
  Object.defineProperty(item, "source", { enumerable: true, get() { calls += 1; throw new Error("secret"); } });
  throwsCode(() => single(empty(), item), "invalid_candidate");
  assert.equal(calls, 0);
});
await test(177, "BigInt revision fails closed", () => {
  throwsCode(() => multiple(empty(), [], 1n), "invalid_current_revision");
});
await test(178, "function candidate fails closed", () => {
  throwsCode(() => single(empty(), () => {}), "invalid_candidate");
});
await test(179, "public functions expose no catalog substitution parameter", () => {
  assert.equal(validateRankingInput.length, 1);
  assert.equal(evaluateVocationalCandidate.length, 1);
  assert.equal(rankVocationalCandidates.length, 1);
  const baseline = single(profile([signal("design")]), candidate(IDS.design));
  const manipulated = evaluateVocationalCandidate(
    { vocationalProfile: profile([signal("design")]), candidate: candidate(IDS.design) },
    { catalog: { programs: {} }, relations: {}, lexicon: {} },
  );
  assert.deepEqual(manipulated, baseline);
});
await test(180, "catalog and relation dimensions are exact", () => {
  assert.equal(relations.version, 1);
  assert.equal(Object.keys(relations.programs).length, 462);
  assert.equal(catalog.categories.length, 6);
  assert.equal(Object.keys(catalog.programs).length, 25);
  assert.equal(Math.max(...Object.keys(relations.programs).map((id) => id.length)), 85);
  assert.equal(Math.max(...Object.keys(catalog.programs).map((id) => id.length)), 76);
});

await test(181, "sensitive error is absent from message stack code and serialization", () => {
  const secret = "SENSITIVE_AUDIT_MARKER_9f31";
  let caught;
  try {
    validateRankingInput({ vocationalProfile: empty(), candidates: [], [secret]: true });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.doesNotMatch(String(caught.message), new RegExp(secret, "u"));
  assert.doesNotMatch(String(caught.stack), new RegExp(secret, "u"));
  assert.doesNotMatch(String(caught.code), new RegExp(secret, "u"));
  assert.doesNotMatch(JSON.stringify(caught), new RegExp(secret, "u"));
});
await test(182, "exact exclusion blocks every allowed origin", () => {
  const sources = [
    "explicit_user_request", "explicit_user_selection", "direct_canonical_mention", "search_continuation",
    "profile_inference", "gemini_response", "same_family", "documented_nearby",
  ];
  for (const source of sources) {
    const result = single(profile([], [exclusion(IDS.design)]), candidate(IDS.design, source));
    assert.equal(result.classification, "rejected");
    assert.deepEqual(result.reasonCodes, ["exact_exclusion"]);
  }
});
await test(183, "longest canonical ID is accepted structurally", () => {
  const longestId = Object.keys(relations.programs).sort((left, right) => right.length - left.length)[0];
  assert.equal(longestId.length, 85);
  assert.equal(single(empty(), candidate(longestId, "explicit_user_request")).classification, "accepted");
});
await test(184, "one hundred character ID is bounded but structurally valid", () => {
  const result = single(empty(), candidate("a".repeat(100)));
  assert.deepEqual(result.reasonCodes, ["invalid_program"]);
});
await test(185, "oversized concept ID fails profile validation", () => {
  const oversized = signal("a".repeat(65));
  throwsCode(() => multiple(profile([oversized]), []), "invalid_profile");
});
await test(186, "invented createdRevision on signal is rejected", () => {
  throwsCode(() => multiple(profile([{ ...signal("design"), createdRevision: 1 }]), []), "invalid_profile");
});
await test(187, "invented createdRevision on exclusion is rejected", () => {
  throwsCode(() => multiple(profile([], [{ ...exclusion(IDS.design), createdRevision: 1 }]), []), "invalid_profile");
});
await test(188, "throwing proxy trap fails closed", () => {
  const hostile = new Proxy({}, { getPrototypeOf() { throw new Error("secret"); } });
  throwsCode(() => validateRankingInput(hostile), "invalid_input");
});
const passCount = results.filter(({ status }) => status === "PASS").length;
const failCount = results.length - passCount;
console.log(`Total: ${results.length}`);
console.log(`PASS: ${passCount}`);
console.log(`FAIL: ${failCount}`);
if (failCount > 0) process.exitCode = 1;

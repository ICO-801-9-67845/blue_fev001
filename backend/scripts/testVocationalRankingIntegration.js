import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import {
  VOCATIONAL_CANDIDATE_SOURCES,
  rankVocationalFlowCandidates,
} from "../src/services/vocationalRankingIntegrationService.js";
import {
  getDefaultEducativeState,
} from "../src/services/educativeConfirmationService.js";
import {
  getDefaultVocationalProfile,
} from "../src/services/vocationalPreferenceService.js";
import { toCanonicalCareerCandidate } from "../src/services/educativeProgramRelationsService.js";

const IDS = Object.freeze({
  design: "especialidad_especialidad_en_diseno_digital",
  architecture: "licenciatura_arquitectura",
  mathematics: "licenciatura_matematicas",
  construction: "tecnico_bachillerato_construccion",
});
const NOW = "2026-07-21T00:00:00.000Z";
const emptyProfile = () => getDefaultVocationalProfile();
const profile = (signals = [], exclusions = [], revision = 1) => ({
  version: 1,
  revision,
  signals,
  exclusions,
});
const signal = (
  conceptId,
  dimension = "interest",
  polarity = "positive",
  intensity = 3,
  updatedRevision = 1,
) => ({
  conceptKind: ["mathematics", "health"].includes(conceptId) ? "subject" : "activity",
  conceptId,
  dimension,
  polarity,
  intensity,
  source: "explicit_statement",
  updatedRevision,
  updatedAt: NOW,
});
const exclusion = (targetId, updatedRevision = 1) => ({
  targetKind: "program",
  targetId,
  mode: "exact",
  source: "explicit_statement",
  updatedRevision,
  updatedAt: NOW,
});
const career = (id) => toCanonicalCareerCandidate(id) || {
  name: id,
  normalizedName: id.toUpperCase(),
  level: "undergraduate",
  academicLevel: "licenciatura",
  searchQuery: id,
  canonicalProgramId: id,
  familyId: null,
  exactAliases: [id],
  matchedAlias: id,
};
const entry = (id, source) => ({ career: career(id), source });
const evaluate = (vocationalProfile, candidates, currentRevision) =>
  rankVocationalFlowCandidates({
    vocationalProfile,
    candidates,
    ...(currentRevision === undefined ? {} : { currentRevision }),
  });
const decision = (result) => result.ordered[0]?.decision;
const allAllowed = (result) => [...result.accepted, ...result.confirmation];

const results = [];
let nextNumber = 1;
async function test(name, callback) {
  const label = `${String(nextNumber).padStart(3, "0")} ${name}`;
  nextNumber += 1;
  try {
    await callback();
    results.push({ name: label, status: "PASS" });
    console.log(`PASS ${label}`);
  } catch (error) {
    results.push({ name: label, status: "FAIL", error: error.message });
    console.error(`FAIL ${label}: ${error.stack || error.message}`);
  }
}

await test("API productiva no exporta inyeccion de pruebas", async () => {
  const api = await import("../src/services/vocationalRankingIntegrationService.js");
  assert.deepEqual(Object.keys(api).sort(), [
    "VOCATIONAL_CANDIDATE_SOURCES",
    "rankVocationalFlowCandidates",
  ]);
});
await test("origenes cerrados exactos", () => assert.deepEqual(VOCATIONAL_CANDIDATE_SOURCES, [
  "explicit_user_request", "explicit_user_selection", "direct_canonical_mention",
  "search_continuation", "gemini_response", "profile_inference", "same_family",
  "documented_nearby",
]));
await test("solicitud explicita clasificada aceptada", () =>
  assert.equal(evaluate(emptyProfile(), [entry(IDS.design, "explicit_user_request")]).accepted.length, 1));
await test("solicitud explicita no clasificada aceptada", () =>
  assert.equal(evaluate(emptyProfile(), [entry(IDS.architecture, "explicit_user_request")]).accepted.length, 1));
await test("seleccion explicita aceptada", () =>
  assert.equal(evaluate(emptyProfile(), [entry(IDS.architecture, "explicit_user_selection")]).accepted.length, 1));
await test("seleccion con senales negativas permanece aceptada", () => {
  const result = evaluate(profile([signal("design", "interest", "negative")]), [
    entry(IDS.design, "explicit_user_selection"),
  ]);
  assert.equal(result.accepted.length, 1);
});
await test("exclusion exacta bloquea solicitud", () =>
  assert.deepEqual(decision(evaluate(profile([], [exclusion(IDS.design)]), [
    entry(IDS.design, "explicit_user_request"),
  ])).reasonCodes, ["exact_exclusion"]));
await test("exclusion exacta bloquea seleccion", () =>
  assert.equal(evaluate(profile([], [exclusion(IDS.design)]), [
    entry(IDS.design, "explicit_user_selection"),
  ]).rejected.length, 1));
await test("exclusion exacta bloquea Gemini", () =>
  assert.equal(evaluate(profile([signal("design")], [exclusion(IDS.design)]), [
    entry(IDS.design, "gemini_response"),
  ]).rejected.length, 1));
await test("exclusion exacta bloquea perfil", () =>
  assert.equal(evaluate(profile([signal("design")], [exclusion(IDS.design)]), [
    entry(IDS.design, "profile_inference"),
  ]).rejected.length, 1));
await test("exclusion exacta bloquea familia", () =>
  assert.equal(evaluate(profile([signal("design")], [exclusion(IDS.design)]), [
    entry(IDS.design, "same_family"),
  ]).rejected.length, 1));
await test("exclusion exacta bloquea cercania", () =>
  assert.equal(evaluate(profile([signal("design")], [exclusion(IDS.design)]), [
    entry(IDS.design, "documented_nearby"),
  ]).rejected.length, 1));
await test("mencion directa no clasificada requiere confirmacion", () =>
  assert.equal(evaluate(emptyProfile(), [entry(IDS.architecture, "direct_canonical_mention")])
    .confirmation.length, 1));
await test("continuacion no clasificada requiere confirmacion", () =>
  assert.equal(evaluate(emptyProfile(), [entry(IDS.architecture, "search_continuation")])
    .confirmation.length, 1));
await test("inferencia no clasificada rechazada", () =>
  assert.equal(evaluate(emptyProfile(), [entry(IDS.architecture, "profile_inference")]).rejected.length, 1));
await test("Gemini sin evidencia positiva rechazado", () =>
  assert.deepEqual(decision(evaluate(emptyProfile(), [entry(IDS.design, "gemini_response")]))
    .reasonCodes, ["gemini_only_candidate"]));
await test("Gemini con evidencia real no recibe puntos de origen", () =>
  assert.equal(decision(evaluate(profile([signal("design")]), [entry(IDS.design, "gemini_response")])).score, 12));
await test("familia no agrega puntos", () =>
  assert.equal(decision(evaluate(profile([signal("design")]), [entry(IDS.design, "same_family")])).score, 12));
await test("cercania no agrega puntos", () =>
  assert.equal(decision(evaluate(profile([signal("design")]), [entry(IDS.design, "documented_nearby")])).score, 12));
await test("programa inexistente rechazado", () =>
  assert.deepEqual(decision(evaluate(emptyProfile(), [entry("programa_inexistente", "explicit_user_request")]))
    .reasonCodes, ["invalid_program"]));
await test("texto no canonico no produce ID inventado", () =>
  assert.equal(evaluate(emptyProfile(), [entry("programa$aproximado", "explicit_user_request")]).status,
    "ranking_error"));
await test("duplicados se consolidan", () => {
  const result = evaluate(emptyProfile(), [
    entry(IDS.design, "direct_canonical_mention"),
    entry(IDS.design, "explicit_user_request"),
  ]);
  assert.equal(result.ordered.length, 1);
});
await test("prioridad de origen determinista", () => {
  const result = evaluate(emptyProfile(), [
    entry(IDS.design, "profile_inference"),
    entry(IDS.design, "explicit_user_selection"),
  ]);
  assert.equal(decision(result).score, 45);
});
await test("orden de candidatos no cambia resultado", () => {
  const candidates = [
    entry(IDS.design, "explicit_user_request"),
    entry(IDS.architecture, "direct_canonical_mention"),
  ];
  assert.deepEqual(evaluate(emptyProfile(), candidates), evaluate(emptyProfile(), [...candidates].reverse()));
});
await test("inputs no son mutados", () => {
  const candidates = [entry(IDS.design, "explicit_user_request")];
  const before = structuredClone(candidates);
  evaluate(emptyProfile(), candidates);
  assert.deepEqual(candidates, before);
});
await test("perfil no es mutado", () => {
  const value = profile([signal("design")]);
  const before = structuredClone(value);
  evaluate(value, [entry(IDS.design, "gemini_response")]);
  assert.deepEqual(value, before);
});
await test("catalogo no es mutado", () => {
  const path = new URL("../src/config/vocationalCareerTraits.json", import.meta.url);
  const before = readFileSync(path);
  evaluate(emptyProfile(), [entry(IDS.design, "explicit_user_request")]);
  assert.deepEqual(readFileSync(path), before);
});
await test("conjunto consolidado produce una evaluacion completa", () => {
  const result = evaluate(profile([signal("design")]), [
    entry(IDS.design, "profile_inference"),
    entry(IDS.architecture, "direct_canonical_mention"),
  ]);
  assert.equal(result.candidateCount, 2);
  assert.equal(result.ordered.length, 2);
});
await test("ranking vacio no requiere evaluacion", () => {
  const result = evaluate(emptyProfile(), []);
  assert.equal(result.status, "not_evaluated");
  assert.equal(result.candidateCount, 0);
});
await test("ranking no importa ni llama Gemini", () => {
  const source = readFileSync(new URL("../src/services/vocationalRankingIntegrationService.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /aiService|generateAssistantReply|GoogleGenerativeAI/);
});
await test("confirmacion se traduce al bucket existente", () => {
  const result = evaluate(emptyProfile(), [entry(IDS.architecture, "direct_canonical_mention")]);
  assert.equal(result.confirmation[0].decision.classification, "confirmation_required");
});
await test("rechazados no aparecen en buckets permitidos", () => {
  const result = evaluate(emptyProfile(), [entry(IDS.design, "gemini_response")]);
  assert.equal(allAllowed(result).length, 0);
});
await test("accepted conserva candidato normalizado", () => {
  const result = evaluate(emptyProfile(), [entry(IDS.architecture, "explicit_user_request")]);
  assert.equal(result.accepted[0].career.canonicalProgramId, IDS.architecture);
});
await test("perfil version 1 funciona", () =>
  assert.equal(evaluate({ version: 1, revision: 0, signals: [], exclusions: [] }, [
    entry(IDS.architecture, "explicit_user_request"),
  ]).status, "ok"));
await test("origen desconocido falla cerrado", () =>
  assert.equal(evaluate(emptyProfile(), [entry(IDS.design, "origen_inventado")]).status, "ranking_error"));
await test("origen solicitud activa el contrato explicito", () => {
  const result = evaluate(emptyProfile(), [entry(IDS.design, "explicit_user_request")]);
  assert.equal(result.accepted[0].decision.classification, "accepted");
});
await test("origen seleccion activa el contrato explicito", () => {
  const result = evaluate(emptyProfile(), [entry(IDS.design, "explicit_user_selection")]);
  assert.equal(result.accepted[0].decision.classification, "accepted");
});
await test("fallo estructural usa codigo cerrado", () => {
  const result = evaluate({ version: 99 }, [entry(IDS.design, "profile_inference")]);
  assert.deepEqual({ status: result.status, code: result.code }, {
    status: "ranking_error", code: "VOCATIONAL_RANKING_INPUT_REJECTED",
  });
});
await test("fallo no filtra datos personales", () => {
  const secret = "persona@example.com mensaje privado";
  const result = evaluate({ version: secret }, [entry(IDS.design, "profile_inference")]);
  assert.doesNotMatch(JSON.stringify(result), /persona@example|mensaje privado/);
});
await test("salida repetida es identica", () => {
  const input = [entry(IDS.design, "direct_canonical_mention")];
  assert.deepEqual(evaluate(profile([signal("design")]), input), evaluate(profile([signal("design")]), input));
});
await test("limite de 128 candidatos es aceptado", () => {
  const candidates = Array.from({ length: 128 }, () => entry(IDS.design, "explicit_user_request"));
  assert.equal(evaluate(emptyProfile(), candidates).status, "ok");
});
await test("mas de 128 candidatos falla cerrado", () => {
  const candidates = Array.from({ length: 129 }, () => entry(IDS.design, "explicit_user_request"));
  assert.equal(evaluate(emptyProfile(), candidates).status, "ranking_error");
});
await test("instituciones y URLs no salen de la integracion", () => {
  const result = evaluate(emptyProfile(), [{
    ...entry(IDS.design, "explicit_user_request"),
    career: { ...career(IDS.design), institution: "Escuela", redirect_url: "https://invalid" },
  }]);
  assert.doesNotMatch(JSON.stringify(result), /Escuela|https|redirect/);
});
await test("bucket accepted no comparte referencias", () => {
  const result = evaluate(emptyProfile(), [entry(IDS.design, "explicit_user_request")]);
  result.accepted[0].decision.reasonCodes.push("mutated");
  assert.doesNotMatch(JSON.stringify(result.ordered), /mutated/);
});
await test("bucket confirmation no comparte referencias", () => {
  const result = evaluate(emptyProfile(), [entry(IDS.architecture, "direct_canonical_mention")]);
  result.confirmation[0].career.name = "mutated";
  assert.doesNotMatch(JSON.stringify(result.ordered), /mutated/);
});
await test("evidencia matematica y diseno vigente llega completa", () => {
  const value = profile([signal("mathematics"), signal("design")]);
  const result = evaluate(value, [entry(IDS.design, "gemini_response")]);
  assert.equal(result.confirmation[0].decision.positiveEvidenceCount, 1);
  assert.equal(value.signals.length, 2);
});
await test("inferencia de perfil clasificada con evidencia se evalua", () =>
  assert.equal(evaluate(profile([signal("design")]), [entry(IDS.design, "profile_inference")])
    .confirmation.length, 1));

const chatServiceUrl = new URL("../src/services/chatService.js", import.meta.url).href;
const confirmationUrl = new URL("../src/services/educativeConfirmationService.js", import.meta.url).href;
const vocationalUrl = new URL("../src/services/vocationalPreferenceService.js", import.meta.url).href;
const integrationUrl = new URL("../src/services/vocationalRankingIntegrationService.js", import.meta.url).href;
const stubSources = {
  chatRepository: `
    const h = () => globalThis.__rankingChatHarness;
    export const findChatById = async (id) => h().chat.id === id ? h().chat : null;
    export const listRecentChatSummariesByUserId = async () => [];
    export const listChatsByUserId = async () => [];
    export const createChat = async (data) => ({ id: "new-chat", ...data });
    export const deleteChat = async () => null;
    export const updateChat = async (_id, data) => Object.assign(h().chat, data);
  `,
  messageRepository: `
    const h = () => globalThis.__rankingChatHarness;
    export const createMessage = async (data) => h().createMessage(data);
    export const listMessagesByChatId = async (id) => h().messages.filter((item) => item.chatId === id);
    export const countMessagesByChatId = async (id) => h().messages.filter((item) => item.chatId === id).length;
  `,
  userMemoryRepository: `export const findUserMemoryByUserId = async () => null;`,
  prisma: `export default new Proxy({}, { get(_target, key) { return globalThis.__rankingChatHarness.prisma[key]; } });`,
  aiService: `
    export async function generateAssistantReply() {
      const h = globalThis.__rankingChatHarness;
      h.calls.gemini += 1; h.events.push("gemini");
      return h.assistantReply;
    }
  `,
  aiContextService: `
    export const shouldIncludePreviousChatSummaries = () => false;
    export const buildEducativeContinuitySummary = () => "";
  `,
  memoryRefreshService: `
    export const MEMORY_REFRESH_FLOWS = Object.freeze({ CONVERSATION: "conversation", CONTINUE_AFTER_ACTION: "continue" });
    export async function refreshMemoryAfterEligibleTurn() { globalThis.__rankingChatHarness.calls.memory += 1; }
  `,
  educativeSearchService: `
    export function buildEducativeSearchReply(result) {
      return result.offerContext?.[0]?.redirect_url || "Resultados educativos stubbed";
    }
    export async function searchEducativeOffers(args) {
      const h = globalThis.__rankingChatHarness;
      const { prisma: _prisma, ...safeArgs } = args;
      h.calls.search += 1; h.searchArgs.push(structuredClone(safeArgs)); h.events.push("search");
      if (h.failSearch) {
        h.failSearch = false;
        throw new Error("stubbed search persistence failure");
      }
      return structuredClone(h.searchResult);
    }
    export async function findEligibleEducativePrograms(args) {
      const h = globalThis.__rankingChatHarness;
      const { prisma: _prisma, ...safeArgs } = args;
      h.calls.relatedEligibility += 1;
      h.relatedEligibilityArgs.push(structuredClone(safeArgs));
      return structuredClone(h.relatedEligibleCareers);
    }
  `,
  educativeConfirmationService: `
    export * from ${JSON.stringify(confirmationUrl)};
    import * as actual from ${JSON.stringify(confirmationUrl)};
    export function detectCareerOptions(text, options) {
      const h = globalThis.__rankingChatHarness;
      h.detectorOptions.push(options || {});
      return h.detectedCareers
        ? structuredClone(h.detectedCareers)
        : actual.detectCareerOptions(text, options);
    }
  `,
  vocationalPreferenceService: `export * from ${JSON.stringify(vocationalUrl)};`,
  vocationalRankingIntegrationService: `
    export * from ${JSON.stringify(integrationUrl)};
    import { rankVocationalFlowCandidates as actualRank } from ${JSON.stringify(integrationUrl)};
    export function rankVocationalFlowCandidates(input) {
      const h = globalThis.__rankingChatHarness;
      h.calls.ranking += 1; h.rankingInputs.push(structuredClone(input)); h.events.push("ranking");
      if (h.forceRankingError) return { status: "ranking_error", code: "VOCATIONAL_RANKING_INPUT_REJECTED", candidateCount: input.candidates.length, accepted: [], confirmation: [], rejected: [], ordered: [] };
      if (h.relatedRankingResult && input.candidates.some((candidate) => ["same_family", "documented_nearby"].includes(candidate.source))) {
        return structuredClone(h.relatedRankingResult);
      }
      if (h.rankingResult) return structuredClone(h.rankingResult);
      return actualRank(input);
    }
  `,
};
const replacements = {
  "../repositories/chatRepository.js": "chatRepository",
  "../repositories/messageRepository.js": "messageRepository",
  "../config/prisma.js": "prisma",
  "../repositories/userMemoryRepository.js": "userMemoryRepository",
  "./aiService.js": "aiService",
  "./aiContextService.js": "aiContextService",
  "./memoryRefreshService.js": "memoryRefreshService",
  "./educativeSearchService.js": "educativeSearchService",
  "./educativeConfirmationService.js": "educativeConfirmationService",
  "./vocationalPreferenceService.js": "vocationalPreferenceService",
  "./vocationalRankingIntegrationService.js": "vocationalRankingIntegrationService",
};
const hookSource = `
  const parent = ${JSON.stringify(chatServiceUrl)};
  const replacements = ${JSON.stringify(replacements)};
  const sources = ${JSON.stringify(stubSources)};
  export async function resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(parent) && replacements[specifier]) return { url: "ranking-stub:" + replacements[specifier], shortCircuit: true };
    return nextResolve(specifier, context);
  }
  export async function load(url, context, nextLoad) {
    if (url.startsWith("ranking-stub:")) return { format: "module", source: sources[url.slice("ranking-stub:".length)], shortCircuit: true };
    return nextLoad(url, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(hookSource)}`, import.meta.url);
const { sendMessage } = await import(`${chatServiceUrl}?ranking-integration-suite`);

function createHarness(vocationalProfile = emptyProfile()) {
  const harness = {
    chat: {
      id: "chat-1", userId: "user-1", title: "Nueva conversacion", summary: null,
      educativeStateVersion: 0,
      educativeState: { ...getDefaultEducativeState(), vocationalProfile },
    },
    messages: [], nextMessageId: 1,
    calls: { gemini: 0, ranking: 0, search: 0, relatedEligibility: 0, memory: 0 },
    events: [], rankingInputs: [], searchArgs: [], relatedEligibilityArgs: [], detectorOptions: [],
    assistantReply: "Respuesta conversacional stubbed",
    forceRankingError: false,
    failSearch: false,
    failUserMessage: false,
    failAssistantMessage: false,
    detectedCareers: null,
    rankingResult: null,
    relatedRankingResult: null,
    relatedEligibleCareers: [],
    searchResult: {
      offerContext: [{ id: "91", redirect_url: "/oferta-educativa/detalle/91" }],
      remainingCount: 0, searchSignature: "stub-signature",
    },
  };
  harness.createMessage = (data) => {
    if (data.role === "user" && harness.failUserMessage) {
      harness.failUserMessage = false;
      throw new Error("stubbed user message failure");
    }
    if (data.role === "assistant" && harness.failAssistantMessage) {
      harness.failAssistantMessage = false;
      throw new Error("stubbed assistant message failure");
    }
    const message = { id: `message-${harness.nextMessageId++}`, createdAt: new Date(NOW), uiAction: null, ...structuredClone(data) };
    harness.messages.push(message);
    return message;
  };
  const messageApi = {
    create: async ({ data }) => harness.createMessage(data),
    findFirst: async ({ where }) => harness.messages.find((message) =>
      (!where.id || message.id === where.id) && (!where.chatId || message.chatId === where.chatId) &&
      (!where.role || message.role === where.role)) || null,
    update: async ({ where, data }) => {
      const message = harness.messages.find((item) => item.id === where.id);
      Object.assign(message, structuredClone(data));
      return message;
    },
  };
  const updateMany = async ({ where, data }) => {
    if (where.educativeStateVersion !== harness.chat.educativeStateVersion) return { count: 0 };
    harness.chat.educativeState = structuredClone(data.educativeState);
    harness.chat.educativeStateVersion += data.educativeStateVersion?.increment || 0;
    return { count: 1 };
  };
  const transaction = { message: messageApi, chat: { updateMany } };
  let transactionTail = Promise.resolve();
  const runTransaction = async (callback) => {
    const previous = transactionTail;
    let release;
    transactionTail = new Promise((resolve) => { release = resolve; });
    await previous;
    const snapshot = {
      chat: structuredClone(harness.chat),
      messages: structuredClone(harness.messages),
      nextMessageId: harness.nextMessageId,
    };
    try {
      return await callback(transaction);
    } catch (error) {
      Object.assign(harness.chat, snapshot.chat);
      harness.messages.splice(0, harness.messages.length, ...snapshot.messages);
      harness.nextMessageId = snapshot.nextMessageId;
      throw error;
    } finally {
      release();
    }
  };
  harness.prisma = {
    message: messageApi,
    chat: { updateMany },
    $transaction: runTransaction,
  };
  globalThis.__rankingChatHarness = harness;
  return harness;
}

function addPendingAction(harness, type, state) {
  const uiAction = {
    id: `action-${harness.nextMessageId}`,
    type,
    status: "pending",
    canonicalProgramId: state.currentCanonicalProgramId || null,
    academicLevel: state.currentLevel || null,
    familyId: state.currentFamilyId || null,
    relatedStage: state.relatedStage || null,
  };
  const message = harness.createMessage({ chatId: harness.chat.id, role: "assistant", content: "Accion", uiAction });
  harness.chat.educativeState = {
    ...harness.chat.educativeState,
    ...state,
    pendingConfirmationActionId: uiAction.id,
    pendingActionMessageId: message.id,
  };
  return uiAction;
}
function paginationRanking(careers) {
  const ordered = careers.map((candidate, index) => ({
    career: candidate,
    decision: {
      classification: index === careers.length - 1
        ? "rejected"
        : index === careers.length - 2 ? "confirmation_required" : "accepted",
    },
  }));
  return {
    status: "ok", code: "VOCATIONAL_RANKING_COMPLETED", candidateCount: careers.length,
    accepted: ordered.filter((item) => item.decision.classification === "accepted"),
    confirmation: ordered.filter((item) => item.decision.classification === "confirmation_required"),
    rejected: ordered.filter((item) => item.decision.classification === "rejected"),
    ordered,
  };
}

await test("mensaje no vocacional no ejecuta ranking", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Quiero conversar");
  assert.equal(h.calls.ranking, 0);
  assert.equal(h.calls.gemini, 1);
});
await test("solicitud directa rankea antes de elegibilidad", async () => {
  const h = createHarness();
  const response = await sendMessage(h.chat.id, h.chat.userId, "Quiero estudiar Arquitectura");
  assert.equal(h.rankingInputs[0].candidates[0].source, "explicit_user_request");
  assert.equal(h.calls.search, 0);
  assert.equal(response.assistantMessage.uiAction.type, "career_confirmation");
  assert.equal(h.calls.gemini, 0);
});
await test("mencion neutral usa origen directo y confirmacion", async () => {
  const h = createHarness();
  const response = await sendMessage(h.chat.id, h.chat.userId, "Hoy pense en Arquitectura");
  assert.equal(h.rankingInputs[0].candidates[0].source, "direct_canonical_mention");
  assert.equal(response.assistantMessage.uiAction.type, "career_confirmation");
});
await test("mencion con palabra carrera no se eleva a solicitud explicita", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "La carrera de Arquitectura me parece interesante");
  assert.equal(h.rankingInputs[0].candidates[0].source, "direct_canonical_mention");
  assert.equal(h.calls.search, 0);
});
await test("exclusion directa bloquea busqueda y Gemini", async () => {
  const h = createHarness();
  const response = await sendMessage(h.chat.id, h.chat.userId, "No quiero estudiar Arquitectura");
  assert.equal(h.calls.search, 0);
  assert.equal(h.calls.gemini, 0);
  assert.doesNotMatch(response.assistantMessage.content, /Arquitectura/i);
});
await test("Gemini no sustentado se rechaza sin buscar", async () => {
  const h = createHarness();
  h.assistantReply = "Podrias estudiar Especialidad en Diseno Digital";
  const response = await sendMessage(h.chat.id, h.chat.userId, "Orientame por favor");
  assert.equal(h.calls.gemini, 1);
  assert.equal(h.calls.ranking, 1);
  assert.equal(h.calls.search, 0);
  assert.doesNotMatch(response.assistantMessage.content, /Diseno Digital/i);
});
await test("Gemini con evidencia positiva usa confirmacion existente", async () => {
  const h = createHarness(profile([signal("design")]));
  h.assistantReply = "Podrias estudiar Especialidad en Diseno Digital";
  const response = await sendMessage(h.chat.id, h.chat.userId, "Orientame por favor");
  assert.equal(h.rankingInputs[0].candidates[0].source, "gemini_response");
  assert.equal(h.calls.gemini, 1);
  assert.equal(response.assistantMessage.uiAction.type, "career_confirmation");
});
await test("matematicas construccion y diseno conservan todas las senales", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Me gustan las matematicas");
  await sendMessage(h.chat.id, h.chat.userId, "Me interesan la construccion y el diseno");
  const ids = h.chat.educativeState.vocationalProfile.signals.map((item) => item.conceptId);
  assert.ok(ids.includes("mathematics") && ids.includes("construction") && ids.includes("design"));
});
await test("seleccion explicita se rankea antes de buscar instituciones", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Quiero estudiar Arquitectura");
  h.calls.ranking = 0; h.calls.search = 0; h.events = []; h.rankingInputs = [];
  await sendMessage(h.chat.id, h.chat.userId, "la primera");
  assert.equal(h.rankingInputs[0].candidates[0].source, "explicit_user_selection");
  assert.ok(h.events.indexOf("ranking") < h.events.indexOf("search"));
});
await test("exclusion exacta bloquea seleccion previa", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Quiero estudiar Arquitectura");
  h.chat.educativeState.vocationalProfile = profile([], [exclusion(IDS.architecture)]);
  h.calls.search = 0;
  await sendMessage(h.chat.id, h.chat.userId, "la primera");
  assert.equal(h.calls.search, 0);
});
await test("continuacion institucional no vuelve a ranking", async () => {
  const h = createHarness();
  const active = career(IDS.architecture);
  addPendingAction(h, "search_followup", {
    status: "showing_results", activeConfirmedCareer: active,
    activeConfirmedLevel: active.level, activeSearchQuery: active.searchQuery,
    currentCanonicalProgramId: active.canonicalProgramId, currentLevel: active.academicLevel,
    excludedOfferIds: ["91"], hasMoreResults: true,
  });
  const response = await sendMessage(h.chat.id, h.chat.userId, "mas opciones");
  assert.equal(h.calls.ranking, 0);
  assert.equal(h.calls.search, 1);
  assert.equal(response.assistantMessage.uiAction.type, "search_exhausted");
});
await test("accion relacionada usa snapshot previamente elegible", async () => {
  const h = createHarness();
  const active = career(IDS.architecture);
  addPendingAction(h, "search_exhausted", {
    status: "exhausted", activeConfirmedCareer: active,
    activeConfirmedLevel: active.level, activeSearchQuery: active.searchQuery,
    currentCanonicalProgramId: active.canonicalProgramId, currentLevel: active.academicLevel,
    currentFamilyId: active.familyId, relatedStage: "family",
    eligibleRelatedCareers: [
      { ...career("licenciatura_psicologia"), fromRelated: true, relationType: "family" },
      { ...career("licenciatura_derecho"), fromRelated: true, relationType: "nearby" },
    ],
  });
  const response = await sendMessage(h.chat.id, h.chat.userId, "otras carreras");
  assert.equal(response.assistantMessage.uiAction.careers.length, 1);
  assert.equal(h.calls.ranking, 0);
  assert.equal(h.calls.search, 0);
});
await test("cero relaciones con oferta no muestra accion", async () => {
  const h = createHarness();
  const first = await sendMessage(h.chat.id, h.chat.userId, "Quiero estudiar Arquitectura");
  const response = await sendMessage(h.chat.id, h.chat.userId, "la primera");
  assert.equal(h.calls.relatedEligibility, 1);
  assert.equal(response.assistantMessage.uiAction.hasEligibleRelatedPrograms, false);
  assert.equal(first.assistantMessage.uiAction.type, "career_confirmation");
});
await test("relacion excluida no muestra accion", async () => {
  const excludedId = "licenciatura_arquitecto";
  const h = createHarness(profile([], [exclusion(excludedId)]));
  h.relatedEligibleCareers = [career(excludedId)];
  await sendMessage(h.chat.id, h.chat.userId, "Quiero estudiar Arquitectura");
  const response = await sendMessage(h.chat.id, h.chat.userId, "la primera");
  assert.equal(response.assistantMessage.uiAction.hasEligibleRelatedPrograms, false);
});
await test("relaciones de nivel invalido no llegan a elegibilidad", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Quiero estudiar Arquitectura");
  await sendMessage(h.chat.id, h.chat.userId, "la primera");
  assert.ok(h.relatedEligibilityArgs[0].candidates.every((candidate) =>
    candidate.academicLevel === "licenciatura"
  ));
});
await test("relacion valida con oferta y ranking muestra accion", async () => {
  const related = career("licenciatura_arquitecto");
  const h = createHarness();
  h.relatedEligibleCareers = [related];
  h.relatedRankingResult = {
    status: "ok",
    code: "VOCATIONAL_RANKING_COMPLETED",
    candidateCount: 1,
    accepted: [{
      career: related,
      decision: { classification: "accepted" },
    }],
    confirmation: [],
    rejected: [],
    ordered: [{
      career: related,
      decision: { classification: "accepted" },
    }],
  };
  await sendMessage(h.chat.id, h.chat.userId, "Quiero estudiar Arquitectura");
  const response = await sendMessage(h.chat.id, h.chat.userId, "la primera");
  assert.equal(response.assistantMessage.uiAction.hasEligibleRelatedPrograms, true);
});
await test("municipio explicito llega a la busqueda confirmada", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Quiero estudiar Psicologia en Guanajuato");
  await sendMessage(h.chat.id, h.chat.userId, "la primera");
  assert.equal(h.searchArgs[0].requestedMunicipality, "Guanajuato");
});
await test("sin municipio explicito no se crea filtro de Leon", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Quiero estudiar Psicologia");
  await sendMessage(h.chat.id, h.chat.userId, "la primera");
  assert.equal(h.searchArgs[0].requestedMunicipality, null);
});
for (const phrase of [
  "Dame más opciones",
  "Dame más escuelas",
  "Muéstrame más escuelas",
  "Más escuelas",
  "Otras escuelas",
  "Ver más escuelas",
]) {
  await test(phrase + " agotado no rankea busca ni llama Gemini", async () => {
    const h = createHarness();
    const active = career(IDS.architecture);
    const action = addPendingAction(h, "search_exhausted", {
      status: "exhausted",
      activeConfirmedCareer: active,
      activeConfirmedLevel: active.level,
      activeSearchQuery: active.searchQuery,
      currentCanonicalProgramId: active.canonicalProgramId,
      currentLevel: active.academicLevel,
      hasMoreResults: false,
      eligibleRelatedCareers: [],
    });
    const before = structuredClone(h.calls);
    const firstResponse = await sendMessage(h.chat.id, h.chat.userId, phrase);
    const secondResponse = await sendMessage(h.chat.id, h.chat.userId, phrase);
    assert.equal(h.calls.ranking, before.ranking);
    assert.equal(h.calls.search, before.search);
    assert.equal(h.calls.gemini, before.gemini);
    assert.match(firstResponse.assistantMessage.content, /todas las instituciones elegibles/i);
    assert.match(secondResponse.assistantMessage.content, /todas las instituciones elegibles/i);
    assert.equal(
      firstResponse.assistantMessage.content,
      secondResponse.assistantMessage.content,
    );
    assert.equal(action.status, "pending");
  });
}
await test("accion agotada obsoleta falla cerrado", async () => {
  const h = createHarness();
  const active = career(IDS.architecture);
  const action = addPendingAction(h, "search_exhausted", {
    status: "exhausted",
    activeConfirmedCareer: active,
    activeConfirmedLevel: active.level,
    activeSearchQuery: active.searchQuery,
    currentCanonicalProgramId: active.canonicalProgramId,
    currentLevel: active.academicLevel,
    hasMoreResults: false,
    eligibleRelatedCareers: [],
  });
  const payload = {
    type: "acknowledge_educative_results_exhausted",
    actionId: action.id,
  };
  await sendMessage(h.chat.id, h.chat.userId, "Más escuelas", payload);
  await assert.rejects(
    sendMessage(h.chat.id, h.chat.userId, "Más escuelas", payload),
    /disponible|utilizada|expiro/,
  );
});
await test("limite visual se aplica despues del ranking", async () => {
  const h = createHarness();
  const response = await sendMessage(
    h.chat.id,
    h.chat.userId,
    "Quiero estudiar Arquitectura, Psicologia, Odontologia o Diseno Grafico",
  );
  assert.ok(h.rankingInputs[0].candidates.length >= 4);
  assert.equal(response.assistantMessage.uiAction.careers.length,
    Math.min(h.rankingInputs[0].candidates.length, 5));
  assert.equal(h.detectorOptions[0].limit, 128);
});
await test("redirect_url permanece intacto y no se rankea", async () => {
await test("ocho rankeadas retienen siete validas y muestran cinco", async () => {
  const h = createHarness();
  h.detectedCareers = [
    "licenciatura_arquitectura",
    "licenciatura_matematicas",
    "tecnico_bachillerato_construccion",
    "especialidad_especialidad_en_diseno_digital",
    "licenciatura_psicologia",
    "licenciatura_derecho",
    "licenciatura_odontologia",
    "licenciatura_diseno_grafico",
  ].map(career);
  h.rankingResult = paginationRanking(h.detectedCareers);
  const response = await sendMessage(h.chat.id, h.chat.userId, "Orientacion vocacional");
  assert.equal(response.assistantMessage.uiAction.careers.length, 5);
  assert.equal(response.assistantMessage.uiAction.hasMoreCareers, true);
  assert.equal(h.chat.educativeState.vocationalCareerPagination.total, 7);
  assert.equal(h.chat.educativeState.vocationalCareerPagination.options.some((item) => item.bucket === "rejected"), false);
  assert.equal(h.calls.search, 0);
});

await test("mostrar mas carreras usa segunda pagina sin ranking Gemini ni base", async () => {
  const h = createHarness();
  h.detectedCareers = [
    IDS.architecture, IDS.mathematics, IDS.construction, IDS.design,
    "licenciatura_psicologia", "licenciatura_derecho",
    "licenciatura_odontologia", "licenciatura_diseno_grafico",
  ].map(career);
  h.rankingResult = paginationRanking(h.detectedCareers);
  const first = await sendMessage(h.chat.id, h.chat.userId, "Orientacion vocacional");
  const before = structuredClone(h.calls);
  const second = await sendMessage(h.chat.id, h.chat.userId, "Mostrar mas carreras", {
    type: "more_vocational_careers",
    actionId: first.assistantMessage.uiAction.id,
  });
  assert.equal(second.assistantMessage.uiAction.careers.length, 2);
  assert.equal(second.assistantMessage.uiAction.hasMoreCareers, false);
  assert.equal(h.calls.ranking, before.ranking);
  assert.equal(h.calls.gemini, before.gemini);
  assert.equal(h.calls.search, before.search);
  const firstNames = new Set(first.assistantMessage.uiAction.careers.map((item) => item.name));
  assert.equal(second.assistantMessage.uiAction.careers.some((item) => firstNames.has(item.name)), false);
});

await test("seleccion de pagina dos busca solo la carrera visible", async () => {
  const h = createHarness();
  h.detectedCareers = [
    IDS.architecture, IDS.mathematics, IDS.construction, IDS.design,
    "licenciatura_psicologia", "licenciatura_derecho",
    "licenciatura_odontologia", "licenciatura_diseno_grafico",
  ].map(career);
  h.rankingResult = paginationRanking(h.detectedCareers);
  const first = await sendMessage(h.chat.id, h.chat.userId, "Orientacion vocacional");
  const second = await sendMessage(h.chat.id, h.chat.userId, "Mostrar mas carreras", {
    type: "more_vocational_careers", actionId: first.assistantMessage.uiAction.id,
  });
  h.rankingResult = null;
  const selected = second.assistantMessage.uiAction.careers[0];
  await sendMessage(h.chat.id, h.chat.userId, "Mostrar opciones de " + selected.name, {
    type: "confirm_educative_search",
    actionId: second.assistantMessage.uiAction.id,
    career: selected.normalizedName,
  });
  assert.equal(h.calls.search, 1);
  assert.equal(h.searchArgs[0].canonicalProgramId,
    h.rankingInputs.at(-1).candidates[0].career.canonicalProgramId);
  assert.equal(h.chat.educativeState.vocationalCareerPagination, null);
});

await test("doble clic no salta dos paginas", async () => {
  const h = createHarness();
  h.detectedCareers = [
    IDS.architecture, IDS.mathematics, IDS.construction, IDS.design,
    "licenciatura_psicologia", "licenciatura_derecho",
    "licenciatura_odontologia", "licenciatura_diseno_grafico",
  ].map(career);
  h.rankingResult = paginationRanking(h.detectedCareers);
  const first = await sendMessage(h.chat.id, h.chat.userId, "Orientacion vocacional");
  const action = { type: "more_vocational_careers", actionId: first.assistantMessage.uiAction.id };
  const settled = await Promise.allSettled([
    sendMessage(h.chat.id, h.chat.userId, "Mostrar mas carreras", action),
    sendMessage(h.chat.id, h.chat.userId, "Mostrar mas carreras", action),
  ]);
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(h.chat.educativeState.vocationalCareerPagination.cursor, 5);
});
await test("seguir conversando limpia paginacion de carreras", async () => {
  const h = createHarness();
  h.detectedCareers = [
    IDS.architecture, IDS.mathematics, IDS.construction, IDS.design,
    "licenciatura_psicologia", "licenciatura_derecho",
  ].map(career);
  h.rankingResult = paginationRanking(h.detectedCareers);
  const first = await sendMessage(h.chat.id, h.chat.userId, "Orientacion vocacional");
  await sendMessage(h.chat.id, h.chat.userId, "Seguir conversando", {
    type: "defer_educative_search",
    actionId: first.assistantMessage.uiAction.id,
  });
  assert.equal(h.chat.educativeState.vocationalCareerPagination, null);
  assert.deepEqual(h.chat.educativeState.pendingCareers, []);
});

await test("tema vocacional nuevo reemplaza lista anterior", async () => {
  const h = createHarness();
  h.detectedCareers = [
    IDS.architecture, IDS.mathematics, IDS.construction, IDS.design,
    "licenciatura_derecho", "licenciatura_odontologia",
  ].map(career);
  h.rankingResult = paginationRanking(h.detectedCareers);
  const first = await sendMessage(h.chat.id, h.chat.userId, "Orientacion vocacional");
  h.detectedCareers = null;
  h.rankingResult = null;
  const next = await sendMessage(h.chat.id, h.chat.userId, "Ahora quiero estudiar Psicologia");
  assert.equal(next.assistantMessage.uiAction.careers.length, 1);
  assert.match(next.assistantMessage.uiAction.careers[0].name, /Psicolog/i);
  assert.equal(h.chat.educativeState.vocationalCareerPagination.cursor, 0);
  assert.equal(h.chat.educativeState.vocationalCareerPagination.total, 1);
  const oldMessage = h.messages.find((message) => message.id === first.assistantMessage.id);
  assert.equal(oldMessage.uiAction.status, "expired");
});

await test("mas escuelas no avanza cursor de carreras", async () => {
  const h = createHarness();
  h.detectedCareers = [
    IDS.architecture, IDS.mathematics, IDS.construction, IDS.design,
    "licenciatura_derecho", "licenciatura_odontologia",
  ].map(career);
  h.rankingResult = paginationRanking(h.detectedCareers);
  await sendMessage(h.chat.id, h.chat.userId, "Orientacion vocacional");
  h.detectedCareers = null;
  h.rankingResult = null;
  await sendMessage(h.chat.id, h.chat.userId, "Mas escuelas");
  assert.equal(h.chat.educativeState.vocationalCareerPagination, null);
});
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Quiero estudiar Arquitectura");
  const response = await sendMessage(h.chat.id, h.chat.userId, "la primera");
  assert.equal(response.assistantMessage.content, "/oferta-educativa/detalle/91");
  assert.doesNotMatch(JSON.stringify(h.rankingInputs), /redirect_url|detalle\/91/);
});
await test("fallo del ranking cierra flujo con log agregado", async () => {
  const h = createHarness();
  h.forceRankingError = true;
  const logs = [];
  const original = console.warn;
  console.warn = (value) => logs.push(value);
  try {
    await sendMessage(h.chat.id, h.chat.userId, "Quiero estudiar Arquitectura");
  } finally {
    console.warn = original;
  }
  assert.deepEqual(Object.keys(logs[0]).sort(), ["candidateCount", "code", "event"]);
  assert.equal(h.calls.search, 0);
});
await test("fallo del ranking no agrega llamada a Gemini", async () => {
  const h = createHarness();
  h.forceRankingError = true;
  await sendMessage(h.chat.id, h.chat.userId, "Quiero estudiar Arquitectura");
  assert.equal(h.calls.gemini, 0);
});
await test("Gemini y ranking no modifican perfil", async () => {
  const value = profile([signal("design")]);
  const h = createHarness(value);
  h.assistantReply = "Podrias estudiar Especialidad en Diseno Digital";
  await sendMessage(h.chat.id, h.chat.userId, "Orientame por favor");
  assert.deepEqual(h.chat.educativeState.vocationalProfile, value);
});
await test("conversacion sin perfil conserva compatibilidad", async () => {
  const h = createHarness();
  h.chat.educativeState = { status: "idle" };
  await sendMessage(h.chat.id, h.chat.userId, "Quiero conversar");
  assert.equal(h.calls.gemini, 1);
  assert.equal(h.calls.ranking, 0);
});
await test("repeticion de flujo produce decision identica", async () => {
  const first = createHarness();
  const firstResponse = await sendMessage(first.chat.id, first.chat.userId, "Quiero estudiar Arquitectura");
  const firstCareers = firstResponse.assistantMessage.uiAction.careers;
  const second = createHarness();
  const secondResponse = await sendMessage(second.chat.id, second.chat.userId, "Quiero estudiar Arquitectura");
  assert.deepEqual(secondResponse.assistantMessage.uiAction.careers, firstCareers);
});

await test("fuzzy seguro crea confirmacion sin ranking busqueda ni Gemini", async () => {
  const h = createHarness();
  const beforeProfile = structuredClone(h.chat.educativeState.vocationalProfile);
  const response = await sendMessage(h.chat.id, h.chat.userId, "psiclogía");
  assert.equal(response.assistantMessage.uiAction.type, "career_confirmation");
  assert.match(response.assistantMessage.content, /Te refieres a/i);
  assert.equal(h.calls.ranking, 0);
  assert.equal(h.calls.search, 0);
  assert.equal(h.calls.gemini, 0);
  assert.deepEqual(h.chat.educativeState.vocationalProfile, beforeProfile);
});
await test("confirmacion fuzzy positiva rankea y busca programa canonico", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "psiclogía");
  await sendMessage(h.chat.id, h.chat.userId, "si");
  assert.equal(h.calls.ranking, 1);
  assert.equal(h.rankingInputs[0].candidates[0].source, "explicit_user_selection");
  assert.equal(h.calls.search, 1);
  assert.equal(h.searchArgs[0].canonicalProgramId, "licenciatura_psicologia");
  assert.equal(h.calls.gemini, 0);
});
await test("confirmacion fuzzy negativa no busca ni llama Gemini", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "psiclogía");
  const response = await sendMessage(h.chat.id, h.chat.userId, "no");
  assert.equal(h.calls.ranking, 0);
  assert.equal(h.calls.search, 0);
  assert.equal(h.calls.gemini, 0);
  assert.match(response.assistantMessage.content, /No usare esa opcion/i);
});
await test("exclusion exacta prevalece tras confirmar fuzzy", async () => {
  const h = createHarness(profile([], [exclusion("licenciatura_psicologia")]));
  await sendMessage(h.chat.id, h.chat.userId, "psiclogía");
  await sendMessage(h.chat.id, h.chat.userId, "si");
  assert.equal(h.calls.ranking, 1);
  assert.equal(h.calls.search, 0);
  assert.equal(h.calls.gemini, 0);
});
await test("fuzzy ambiguo no elige programa", async () => {
  const h = createHarness();
  const response = await sendMessage(h.chat.id, h.chat.userId, "mecatroncia");
  assert.equal(response.assistantMessage.uiAction, null);
  assert.match(response.assistantMessage.content, /nivel educativo/i);
  assert.equal(h.calls.ranking, 0);
  assert.equal(h.calls.search, 0);
  assert.equal(h.calls.gemini, 0);
});
await test("solicitud vocacional sin match aclara sin Gemini", async () => {
  const h = createHarness();
  const response = await sendMessage(h.chat.id, h.chat.userId, "Quiero estudiar programa inexistente");
  assert.match(response.assistantMessage.content, /No pude identificar/i);
  assert.equal(h.calls.ranking, 0);
  assert.equal(h.calls.search, 0);
  assert.equal(h.calls.gemini, 0);
});
await test("fuzzy de pagina visible conserva cursor y snapshot", async () => {
  const h = createHarness();
  h.detectedCareers = [
    "licenciatura_psicologia", IDS.architecture, IDS.mathematics,
    IDS.construction, IDS.design, "licenciatura_derecho",
  ].map(career);
  h.rankingResult = paginationRanking(h.detectedCareers);
  await sendMessage(h.chat.id, h.chat.userId, "Orientacion vocacional");
  const before = structuredClone(h.chat.educativeState.vocationalCareerPagination);
  h.detectedCareers = null;
  h.rankingResult = null;
  const response = await sendMessage(h.chat.id, h.chat.userId, "psiclogía");
  assert.equal(response.assistantMessage.uiAction.careers.length, 1);
  assert.equal(h.chat.educativeState.vocationalCareerPagination.cursor, before.cursor);
  assert.deepEqual(h.chat.educativeState.vocationalCareerPagination.options, before.options);
  assert.equal(h.calls.search, 0);
});
await test("seleccion visible exacta conserva prioridad sobre fuzzy", async () => {
  const h = createHarness();
  h.detectedCareers = [IDS.architecture, "licenciatura_psicologia"].map(career);
  h.rankingResult = paginationRanking(h.detectedCareers);
  await sendMessage(h.chat.id, h.chat.userId, "Orientacion vocacional");
  h.detectedCareers = null;
  h.rankingResult = null;
  await sendMessage(h.chat.id, h.chat.userId, "la primera");
  assert.equal(h.calls.search, 1);
  assert.equal(h.searchArgs[0].canonicalProgramId, IDS.architecture);
});
await test("doble confirmacion fuzzy ejecuta como maximo una busqueda", async () => {
  const h = createHarness();
  const first = await sendMessage(h.chat.id, h.chat.userId, "psiclogía");
  const action = {
    type: "confirm_educative_search",
    actionId: first.assistantMessage.uiAction.id,
    career: first.assistantMessage.uiAction.careers[0].normalizedName,
  };
  const settled = await Promise.allSettled([
    sendMessage(h.chat.id, h.chat.userId, "si", action),
    sendMessage(h.chat.id, h.chat.userId, "si", action),
  ]);
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(h.calls.search, 1);
});
await test("carreras concurrentes cierran una sola operacion", async () => {
  for (const competingText of ["no", "Quiero conversar", "Mostrar mas carreras", "Mas escuelas"]) {
    const h = createHarness();
    const first = await sendMessage(h.chat.id, h.chat.userId, "psiclogia");
    const action = {
      type: "confirm_educative_search",
      actionId: first.assistantMessage.uiAction.id,
      career: first.assistantMessage.uiAction.careers[0].normalizedName,
    };
    const settled = await Promise.allSettled([
      sendMessage(h.chat.id, h.chat.userId, "si", action),
      sendMessage(h.chat.id, h.chat.userId, competingText),
    ]);
    assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1, competingText);
    assert.ok(h.calls.search <= 1, competingText);
    assert.ok(h.calls.ranking <= 1, competingText);
  }
});
await test("estado fuzzy obsoleto falla cerrado", async () => {
  const h = createHarness();
  const first = await sendMessage(h.chat.id, h.chat.userId, "psiclogía");
  const action = {
    type: "confirm_educative_search",
    actionId: first.assistantMessage.uiAction.id,
    career: first.assistantMessage.uiAction.careers[0].normalizedName,
  };
  await sendMessage(h.chat.id, h.chat.userId, "si", action);
  await assert.rejects(sendMessage(h.chat.id, h.chat.userId, "si", action), /disponible|utilizada|expiro/);
  assert.equal(h.calls.search, 1);
});
await test("fallo al guardar mensaje revierte accion y permite reintento", async () => {
  const h = createHarness();
  const first = await sendMessage(h.chat.id, h.chat.userId, "psiclogía");
  const action = {
    type: "confirm_educative_search",
    actionId: first.assistantMessage.uiAction.id,
    career: first.assistantMessage.uiAction.careers[0].normalizedName,
  };
  const before = {
    state: structuredClone(h.chat.educativeState),
    version: h.chat.educativeStateVersion,
    messages: structuredClone(h.messages),
  };
  h.failUserMessage = true;
  await assert.rejects(sendMessage(h.chat.id, h.chat.userId, "si", action), /user message failure/);
  assert.deepEqual(h.chat.educativeState, before.state);
  assert.equal(h.chat.educativeStateVersion, before.version);
  assert.deepEqual(h.messages, before.messages);
  assert.equal(h.calls.search, 0);
  await sendMessage(h.chat.id, h.chat.userId, "si", action);
  assert.equal(h.calls.search, 1);
});
await test("fallo de busqueda revierte accion y permite reintento", async () => {
  const h = createHarness();
  const first = await sendMessage(h.chat.id, h.chat.userId, "psiclogía");
  const action = {
    type: "confirm_educative_search",
    actionId: first.assistantMessage.uiAction.id,
    career: first.assistantMessage.uiAction.careers[0].normalizedName,
  };
  const before = {
    state: structuredClone(h.chat.educativeState),
    version: h.chat.educativeStateVersion,
    messages: structuredClone(h.messages),
  };
  h.failSearch = true;
  await assert.rejects(sendMessage(h.chat.id, h.chat.userId, "si", action), /search persistence failure/);
  assert.deepEqual(h.chat.educativeState, before.state);
  assert.equal(h.chat.educativeStateVersion, before.version);
  assert.deepEqual(h.messages, before.messages);
  await sendMessage(h.chat.id, h.chat.userId, "si", action);
  assert.equal(h.calls.search, 2);
  assert.equal(h.messages.filter((message) => message.uiAction?.type === "search_exhausted").length, 1);
});
await test("fallo al guardar respuesta revierte accion y permite reintento", async () => {
  const h = createHarness();
  const first = await sendMessage(h.chat.id, h.chat.userId, "psiclogía");
  const action = {
    type: "confirm_educative_search",
    actionId: first.assistantMessage.uiAction.id,
    career: first.assistantMessage.uiAction.careers[0].normalizedName,
  };
  const before = {
    state: structuredClone(h.chat.educativeState),
    version: h.chat.educativeStateVersion,
    messages: structuredClone(h.messages),
  };
  h.failAssistantMessage = true;
  await assert.rejects(sendMessage(h.chat.id, h.chat.userId, "si", action), /assistant message failure/);
  assert.deepEqual(h.chat.educativeState, before.state);
  assert.equal(h.chat.educativeStateVersion, before.version);
  assert.deepEqual(h.messages, before.messages);
  await sendMessage(h.chat.id, h.chat.userId, "si", action);
  assert.equal(h.messages.filter((message) => message.uiAction?.type === "search_exhausted").length, 1);
});
await test("cambio de municipio reemplaza el filtro anterior", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Quiero estudiar Psicologia en Guanajuato");
  await sendMessage(h.chat.id, h.chat.userId, "la primera");
  await sendMessage(h.chat.id, h.chat.userId, "Quiero estudiar Psicologia en León");
  await sendMessage(h.chat.id, h.chat.userId, "la primera");
  assert.deepEqual(
    h.searchArgs.map((args) => args.requestedMunicipality),
    ["Guanajuato", "León"],
  );
});
await test("frase institucional fuera de contexto no inventa busqueda", async () => {
  const h = createHarness();
  const response = await sendMessage(h.chat.id, h.chat.userId, "Más escuelas");
  assert.equal(h.calls.search, 0);
  assert.equal(h.calls.ranking, 0);
  assert.equal(response.assistantMessage.uiAction, null);
});
await test("acciones cerradas no activan fuzzy", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Mostrar mas carreras");
  assert.equal(h.calls.search, 0);
  assert.equal(h.calls.ranking, 0);
});
await test("menciones lexicas no vocacionales conservan la conversacion normal", async () => {
  const phrases = [
    "La arquitectura de este sistema es complicada", "Tengo derecho a entrar",
    "La psicologia del personaje es interesante", "La red civil esta caida",
    "Diseno paginas web", "La ingenieria del puente fue buena",
  ];
  for (const phrase of phrases) {
    const h = createHarness();
    const response = await sendMessage(h.chat.id, h.chat.userId, phrase);
    assert.equal(response.assistantMessage.uiAction, null, phrase);
    assert.equal(h.calls.ranking, 0, phrase);
    assert.equal(h.calls.search, 0, phrase);
    assert.equal(h.calls.gemini, 1, phrase);
  }
});
await test("cancelaciones fuzzy cerradas no rankean buscan ni llaman Gemini", async () => {
  for (const cancellation of ["no era esa", "cancelar", "volver", "otra carrera", "no se"]) {
    const h = createHarness();
    await sendMessage(h.chat.id, h.chat.userId, "psiclogia");
    const response = await sendMessage(h.chat.id, h.chat.userId, cancellation);
    assert.equal(h.calls.ranking, 0, cancellation);
    assert.equal(h.calls.search, 0, cancellation);
    assert.equal(h.calls.gemini, 0, cancellation);
    assert.match(response.assistantMessage.content, /No usare esa opcion/i, cancellation);
  }
});
const passed = results.filter((item) => item.status === "PASS").length;
const failed = results.length - passed;
console.log(`TOTAL: ${results.length} | PASS: ${passed} | FAIL: ${failed}`);
if (failed) process.exitCode = 1;

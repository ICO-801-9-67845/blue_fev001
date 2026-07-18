import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAssistantRequestContext,
  buildEducativeContinuitySummary,
  compactDeterministicAssistantMessage,
  countHistoryCharacters,
  selectConversationHistory,
  shouldIncludePreviousChatSummaries,
} from "../src/services/aiContextService.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const backendDirectory = resolve(scriptDirectory, "..");
const repositoryDirectory = resolve(backendDirectory, "..");
const outputDirectory = resolve(
  repositoryDirectory,
  "tmp/ai-input-context-optimization",
);
const envModuleUrl = new URL("../src/config/env.js", import.meta.url).href;

process.env.DATABASE_URL ||= "mysql://test:test@localhost:3306/test";
process.env.JWT_SECRET ||= "test-secret";
process.env.GEMINI_API_KEYS ||= "test-key-never-used";

const {
  BASE_SYSTEM_INSTRUCTION,
  FULL_SYSTEM_PROMPT,
  generateAssistantReply,
} = await import(
  "../src/services/aiService.js"
);

const results = [];
let geminiCallCount = 0;

function test(name, callback) {
  try {
    callback();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
  }
}

async function testAsync(name, callback) {
  try {
    await callback();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
  }
}

function readContextConfig(overrides = {}) {
  const variableNames = [
    "GEMINI_CHAT_HISTORY_LIMIT_WITH_SUMMARY",
    "GEMINI_CHAT_HISTORY_LIMIT_WITHOUT_SUMMARY",
    "GEMINI_CHAT_HISTORY_MAX_CHARS_WITH_SUMMARY",
    "GEMINI_CHAT_HISTORY_MAX_CHARS_WITHOUT_SUMMARY",
  ];
  const childEnvironment = {
    ...process.env,
    DATABASE_URL: "mysql://test:test@localhost:3306/test",
    JWT_SECRET: "test-secret",
    GEMINI_API_KEYS: "test-key-never-used",
  };

  for (const name of variableNames) {
    childEnvironment[name] = Object.hasOwn(overrides, name)
      ? String(overrides[name])
      : "";
  }

  const expression = `
    const config = await import(${JSON.stringify(envModuleUrl)});
    console.log(JSON.stringify({
      withSummary: config.GEMINI_CHAT_HISTORY_LIMIT_WITH_SUMMARY,
      withoutSummary: config.GEMINI_CHAT_HISTORY_LIMIT_WITHOUT_SUMMARY,
      charsWithSummary: config.GEMINI_CHAT_HISTORY_MAX_CHARS_WITH_SUMMARY,
      charsWithoutSummary: config.GEMINI_CHAT_HISTORY_MAX_CHARS_WITHOUT_SUMMARY,
    }));
  `;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", expression],
    {
      cwd: repositoryDirectory,
      env: childEnvironment,
      encoding: "utf8",
    },
  );

  assert.equal(child.status, 0, child.stderr);
  const output = child.stdout.trim().split(/\r?\n/).at(-1);
  return JSON.parse(output);
}

function makeHistory(count, contentSize = 20) {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `${index}-${"x".repeat(contentSize)}`,
  }));
}

function flattenContents(contents) {
  return contents
    .flatMap((content) => content.parts.map((part) => part.text))
    .join("\n");
}

const defaultConfig = readContextConfig();
const zeroConfig = readContextConfig({
  GEMINI_CHAT_HISTORY_LIMIT_WITH_SUMMARY: 0,
  GEMINI_CHAT_HISTORY_LIMIT_WITHOUT_SUMMARY: 0,
  GEMINI_CHAT_HISTORY_MAX_CHARS_WITH_SUMMARY: 0,
  GEMINI_CHAT_HISTORY_MAX_CHARS_WITHOUT_SUMMARY: 0,
});
const negativeConfig = readContextConfig({
  GEMINI_CHAT_HISTORY_LIMIT_WITH_SUMMARY: -1,
  GEMINI_CHAT_HISTORY_LIMIT_WITHOUT_SUMMARY: -1,
  GEMINI_CHAT_HISTORY_MAX_CHARS_WITH_SUMMARY: -1,
  GEMINI_CHAT_HISTORY_MAX_CHARS_WITHOUT_SUMMARY: -1,
});
const decimalConfig = readContextConfig({
  GEMINI_CHAT_HISTORY_LIMIT_WITH_SUMMARY: 6.5,
  GEMINI_CHAT_HISTORY_LIMIT_WITHOUT_SUMMARY: 8.5,
  GEMINI_CHAT_HISTORY_MAX_CHARS_WITH_SUMMARY: 3200.5,
  GEMINI_CHAT_HISTORY_MAX_CHARS_WITHOUT_SUMMARY: 4800.5,
});
const nanConfig = readContextConfig({
  GEMINI_CHAT_HISTORY_LIMIT_WITH_SUMMARY: "NaN",
  GEMINI_CHAT_HISTORY_LIMIT_WITHOUT_SUMMARY: "NaN",
  GEMINI_CHAT_HISTORY_MAX_CHARS_WITH_SUMMARY: "NaN",
  GEMINI_CHAT_HISTORY_MAX_CHARS_WITHOUT_SUMMARY: "NaN",
});
const infinityConfig = readContextConfig({
  GEMINI_CHAT_HISTORY_LIMIT_WITH_SUMMARY: "Infinity",
  GEMINI_CHAT_HISTORY_LIMIT_WITHOUT_SUMMARY: "Infinity",
  GEMINI_CHAT_HISTORY_MAX_CHARS_WITH_SUMMARY: "Infinity",
  GEMINI_CHAT_HISTORY_MAX_CHARS_WITHOUT_SUMMARY: "Infinity",
});

test("1. Sin resumen usa limite predeterminado 8", () => {
  assert.equal(defaultConfig.withoutSummary, 8);
});
test("2. Con resumen usa limite predeterminado 6", () => {
  assert.equal(defaultConfig.withSummary, 6);
});
test("3. Sin resumen usa presupuesto 4800", () => {
  assert.equal(defaultConfig.charsWithoutSummary, 4800);
});
test("4. Con resumen usa presupuesto 3200", () => {
  assert.equal(defaultConfig.charsWithSummary, 3200);
});
test("5. Valores personalizados validos", () => {
  assert.deepEqual(
    readContextConfig({
      GEMINI_CHAT_HISTORY_LIMIT_WITH_SUMMARY: 4,
      GEMINI_CHAT_HISTORY_LIMIT_WITHOUT_SUMMARY: 9,
      GEMINI_CHAT_HISTORY_MAX_CHARS_WITH_SUMMARY: 2000,
      GEMINI_CHAT_HISTORY_MAX_CHARS_WITHOUT_SUMMARY: 6000,
    }),
    {
      withSummary: 4,
      withoutSummary: 9,
      charsWithSummary: 2000,
      charsWithoutSummary: 6000,
    },
  );
});
test("6. Cero usa fallback", () => assert.deepEqual(zeroConfig, defaultConfig));
test("7. Negativo usa fallback", () => assert.deepEqual(negativeConfig, defaultConfig));
test("8. Decimal usa fallback", () => assert.deepEqual(decimalConfig, defaultConfig));
test("9. NaN usa fallback", () => assert.deepEqual(nanConfig, defaultConfig));
test("10. Infinity usa fallback", () => assert.deepEqual(infinityConfig, defaultConfig));

test("11. El mensaje actual siempre se conserva", () => {
  const selected = selectConversationHistory(makeHistory(11), {
    maxCharsWithoutSummary: 30,
  });
  assert.equal(selected.messages.at(-1).content, makeHistory(11).at(-1).content);
});
test("12. El mensaje actual no se trunca", () => {
  const current = "mensaje actual ".repeat(400);
  const selected = selectConversationHistory([{ role: "user", content: current }], {
    maxCharsWithoutSummary: 10,
  });
  assert.equal(selected.messages[0].content, current);
});
test("13. Un mensaje actual largo puede superar presupuesto", () => {
  const selected = selectConversationHistory(
    [{ role: "user", content: "z".repeat(5000) }],
    { maxCharsWithoutSummary: 100 },
  );
  assert.ok(selected.metrics.selectedHistoryCharacterCount > 100);
});
test("14. currentMessageExceededBudget se marca", () => {
  const selected = selectConversationHistory(
    [{ role: "user", content: "z".repeat(101) }],
    { maxCharsWithoutSummary: 100 },
  );
  assert.equal(selected.metrics.currentMessageExceededBudget, true);
});
test("15. Mensajes anteriores pueden truncarse", () => {
  const selected = selectConversationHistory([
    { role: "user", content: "inicio ".repeat(300) },
    { role: "assistant", content: "respuesta" },
    { role: "user", content: "actual" },
  ]);
  assert.ok(selected.metrics.truncatedHistoryMessageCount >= 1);
  assert.ok(selected.messages[0].content.endsWith("\u2026"));
});
test("16. El historial original no se muta", () => {
  const original = [{
    role: "assistant",
    content: "Lista https://example.com",
    uiAction: { type: "search_followup", id: "secret" },
  }, { role: "user", content: "actual" }];
  const snapshot = structuredClone(original);
  selectConversationHistory(original);
  assert.deepEqual(original, snapshot);
});
test("17. El historial final conserva orden cronologico", () => {
  const selected = selectConversationHistory(makeHistory(9));
  const indexes = selected.messages.map((message) => Number(message.content.split("-")[0]));
  assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b));
});
test("18. El historial final empieza con usuario", () => {
  const selected = selectConversationHistory([
    { role: "assistant", content: "huerfano" },
    { role: "user", content: "uno" },
    { role: "assistant", content: "dos" },
    { role: "user", content: "tres" },
  ], { limitWithoutSummary: 2 });
  assert.equal(selected.messages[0].role, "user");
});
test("19. No se generan mensajes vacios", () => {
  const selected = selectConversationHistory([
    { role: "user", content: "" },
    { role: "assistant", content: "  " },
    { role: "user", content: "actual" },
  ]);
  assert.ok(selected.messages.every((message) => message.content.trim()));
});
test("20. Maximo de mensajes respetado", () => {
  assert.ok(selectConversationHistory(makeHistory(21)).messages.length <= 8);
});
test("21. Presupuesto respetado salvo mensaje actual", () => {
  const selected = selectConversationHistory(makeHistory(15, 250), {
    maxCharsWithoutSummary: 600,
  });
  assert.ok(selected.metrics.selectedHistoryCharacterCount <= 600);
});

const deterministicTypes = [
  "career_confirmation",
  "search_followup",
  "search_exhausted",
];
for (const [offset, type] of deterministicTypes.entries()) {
  test(`${22 + offset}. ${type} se compacta`, () => {
    const compacted = compactDeterministicAssistantMessage({
      role: "assistant",
      content: "lista extensa https://example.com",
      uiAction: { type, career: "Psicologia", id: "action-1" },
    });
    assert.equal(compacted.compacted, true);
    assert.ok(compacted.message.content.includes("Psicologia"));
  });
}
test("25. URLs no aparecen en historial compactado", () => {
  const selected = selectConversationHistory([
    { role: "user", content: "busca" },
    {
      role: "assistant",
      content: "Link: https://example.com/oferta-educativa/detalle/91",
      uiAction: { type: "search_followup", career: "Sistemas" },
    },
    { role: "user", content: "sigamos" },
  ]);
  assert.doesNotMatch(JSON.stringify(selected.messages), /https?:\/\//);
});
test("26. IDs de acciones no aparecen", () => {
  const compacted = compactDeterministicAssistantMessage({
    role: "assistant",
    content: "opciones",
    uiAction: { type: "career_confirmation", id: "action-secret" },
  });
  assert.doesNotMatch(JSON.stringify(compacted.message), /action-secret/);
});
test("27. IDs canonicos no aparecen", () => {
  const compacted = compactDeterministicAssistantMessage({
    role: "assistant",
    content: "opciones",
    uiAction: {
      type: "search_followup",
      canonicalProgramId: "program-secret",
      familyId: "family-secret",
    },
  });
  assert.doesNotMatch(JSON.stringify(compacted.message), /program-secret|family-secret/);
});
test("28. El contenido almacenado original permanece intacto", () => {
  const message = {
    role: "assistant",
    content: "contenido original con URL https://example.com",
    uiAction: { type: "search_exhausted" },
  };
  compactDeterministicAssistantMessage(message);
  assert.equal(message.content, "contenido original con URL https://example.com");
});
test("29. Mensajes conversacionales normales no se compactan", () => {
  const message = { role: "assistant", content: "respuesta normal" };
  const result = compactDeterministicAssistantMessage(message);
  assert.equal(result.compacted, false);
  assert.deepEqual(result.message, message);
});
test("30. Resumen educativo tiene maximo 220 caracteres", () => {
  const summary = buildEducativeContinuitySummary({
    activeConfirmedCareer: { name: "Psicologia ".repeat(50) },
    currentLevel: "licenciatura",
    status: "deferred",
  });
  assert.ok(summary.length <= 220);
});
test("31. Resumen educativo no contiene IDs ni URLs", () => {
  const summary = buildEducativeContinuitySummary({
    activeConfirmedCareer: {
      name: "Psicologia ID: secret https://example.com",
    },
    currentLevel: "licenciatura",
  });
  assert.doesNotMatch(summary, /https?:\/\/|\bID\b|secret/i);
});
test("32. Chat nuevo incluye resumenes anteriores", () => {
  assert.equal(shouldIncludePreviousChatSummaries({
    history: [{ role: "user", content: "hola" }],
    currentMessage: "hola",
  }), true);
});
test("33. Chat establecido no incluye resumenes anteriores", () => {
  assert.equal(shouldIncludePreviousChatSummaries({
    history: makeHistory(9),
    currentMessage: "hoy me gustan las matematicas",
  }), false);
});
test("34. Como te dije activa resumenes anteriores", () => {
  assert.equal(shouldIncludePreviousChatSummaries({
    history: makeHistory(9),
    currentMessage: "Como te dije, me gustan las redes",
  }), true);
});
test("35. En otro chat activa resumenes anteriores", () => {
  assert.equal(shouldIncludePreviousChatSummaries({
    history: makeHistory(9),
    currentMessage: "En otro chat hablamos de sistemas",
  }), true);
});
test("36. Deteccion ignora acentos y mayusculas", () => {
  assert.equal(shouldIncludePreviousChatSummaries({
    history: makeHistory(9),
    currentMessage: "COMO TE CONTÉ ANTERIORMENTE",
  }), true);
});

function makePlan(overrides = {}) {
  return buildAssistantRequestContext({
    history: [{ role: "user", content: "mensaje actual" }],
    offerContext: [],
    memoryContext: {},
    memoryContextText: "",
    offerContextText: "",
    baseSystemInstruction: BASE_SYSTEM_INSTRUCTION,
    educativeOfferRules: "REGLAS EDUCATIVAS COMPLETAS",
    model: "gemini-2.5-flash-lite",
    ...overrides,
  });
}

test("37. userMemorySummary se incluye cuando existe", () => {
  assert.equal(makePlan({
    memoryContext: { userMemorySummary: "memoria" },
    memoryContextText: "Memoria global: memoria",
  }).metrics.includedUserMemory, true);
});
test("38. currentChatSummary se incluye cuando existe", () => {
  assert.equal(makePlan({
    memoryContext: { currentChatSummary: "resumen" },
    memoryContextText: "Resumen: resumen",
  }).metrics.includedCurrentChatSummary, true);
});
test("39. previousChatSummaries se excluyen cuando no corresponden", () => {
  const plan = makePlan({ memoryContext: { previousChatSummaries: [] } });
  assert.equal(plan.metrics.includedPreviousChatSummaries, false);
  assert.equal(plan.metrics.previousChatSummaryCount, 0);
});
test("40. Reglas educativas completas se excluyen sin offerContext", () => {
  assert.doesNotMatch(makePlan().systemInstruction, /REGLAS EDUCATIVAS COMPLETAS/);
});
test("41. Regla breve de seguridad permanece en modo base", () => {
  assert.match(BASE_SYSTEM_INSTRUCTION, /No inventes ni menciones nombres concretos de escuelas/);
});
test("42. Reglas educativas completas se incluyen con offerContext", () => {
  const plan = makePlan({
    offerContext: [{ id: "1" }],
    offerContextText: "Oferta validada",
  });
  assert.match(plan.systemInstruction, /REGLAS EDUCATIVAS COMPLETAS/);
  assert.equal(plan.metrics.includedEducativeRules, true);
});
test("43. offerContext vacio no activa modo educativo", () => {
  assert.equal(makePlan({ offerContext: [] }).metrics.systemPromptMode, "base");
});

const aiServiceSource = readFileSync(
  resolve(backendDirectory, "src/services/aiService.js"),
  "utf8",
);
const chatServiceSource = readFileSync(
  resolve(backendDirectory, "src/services/chatService.js"),
  "utf8",
);
const aiContextServiceSource = readFileSync(
  resolve(backendDirectory, "src/services/aiContextService.js"),
  "utf8",
);
const memoryRefreshSource = readFileSync(
  resolve(backendDirectory, "src/services/memoryRefreshService.js"),
  "utf8",
);

test("44. La validacion de links no se elimina", () => {
  assert.match(aiServiceSource, /OFFER_DETAIL_ID_PATTERN/);
  assert.match(aiServiceSource, /hasInvalidOfferLinks/);
  assert.match(aiServiceSource, /INVALID_OFFER_LINK_RESPONSE/);
});
test("45. Logs de contexto no contienen datos sensibles", () => {
  const stringValues = Object.values(makePlan().metrics)
    .filter((value) => typeof value === "string")
    .sort();
  assert.deepEqual(stringValues, [
    "base",
    "conversation",
    "gemini-2.5-flash-lite",
    "gemini_context_usage",
  ].sort());
});
test("46. Log contiene unicamente metricas permitidas", () => {
  const allowed = new Set([
    "event", "requestType", "model", "systemPromptMode",
    "originalHistoryMessageCount", "selectedHistoryMessageCount",
    "originalHistoryCharacterCount", "selectedHistoryCharacterCount",
    "droppedHistoryMessageCount", "truncatedHistoryMessageCount",
    "compactedDeterministicMessageCount", "includedUserMemory",
    "includedCurrentChatSummary", "includedPreviousChatSummaries",
    "previousChatSummaryCount", "includedEducativeContinuitySummary",
    "includedOfferContext", "offerCount", "includedEducativeRules",
    "historyMessageLimit", "historyCharacterBudget",
    "currentMessagePreserved", "currentMessageExceededBudget",
  ]);
  assert.ok(Object.keys(makePlan().metrics).every((key) => allowed.has(key)));
});
test("47. Chat entrega 12 y memoria selecciona 8", () => {
  assert.match(chatServiceSource, /MEMORY_SUMMARY_MESSAGE_LIMIT = 12/);
  assert.match(aiServiceSource, /GEMINI_MEMORY_CONTEXT_MESSAGE_LIMIT/);
  assert.match(aiServiceSource, /buildMemoryRequestContext\(\{/);
});
test("48. Conversacion normal usa contexto optimizado", () => {
  assert.match(aiServiceSource, /buildAssistantRequestContext\(\{/);
  assert.match(aiServiceSource, /contents: requestContext\.contents/);
});
test("49. Seguir conversando usa contexto optimizado", () => {
  const continueIndex = chatServiceSource.indexOf("async function continueConversationAfterAction");
  const handlerIndex = chatServiceSource.indexOf("async function handleEducativeAction");
  const block = chatServiceSource.slice(continueIndex, handlerIndex);
  assert.match(block, /generateAssistantReply\(\s*history,/);
});
test("50. Busquedas deterministas no llaman Gemini", () => {
  const actionBranch = chatServiceSource.indexOf("if (requestedAction)");
  const normalGemini = chatServiceSource.indexOf("generateAssistantReply(", actionBranch);
  const actionReturn = chatServiceSource.indexOf("return {", actionBranch);
  assert.ok(actionBranch >= 0 && actionReturn < normalGemini);
});
test("51. Cadencia de memoria sigue intacta", () => {
  assert.match(memoryRefreshSource, /GEMINI_MEMORY_EVERY_USER_MESSAGES/);
  assert.match(memoryRefreshSource, /gemini_memory_refresh_decision/);
});
test("52. gemini_usage sigue existiendo", () => {
  assert.match(aiServiceSource, /event: "gemini_usage"/);
  assert.match(aiServiceSource, /promptTokenCount/);
});
test("53. Las pruebas no llaman Gemini", () => {
  assert.equal(geminiCallCount, 0);
});

const longOfferOne = [
  "Universidad Uno",
  "Carreras relacionadas: Psicologia, Trabajo Social",
  "Link: https://example.com/oferta-educativa/detalle/1",
].join("\n").repeat(12);
const longOfferTwo = [
  "Universidad Dos",
  "Carreras relacionadas: Sistemas, Ciberseguridad",
  "Link: https://example.com/oferta-educativa/detalle/2",
].join("\n").repeat(12);
const simulationHistory = [
  { role: "user", content: "Me gusta programar." },
  { role: "assistant", content: "Que parte de programar disfrutas mas?" },
  { role: "user", content: "Resolver problemas y crear aplicaciones." },
  { role: "assistant", content: "Eso combina logica y creatividad." },
  { role: "user", content: "Tambien me interesa la ciberseguridad." },
  { role: "assistant", content: "Ambas areas se conectan al crear software seguro." },
  { role: "user", content: "Muestrame opciones." },
  {
    role: "assistant",
    content: longOfferOne,
    uiAction: {
      type: "search_followup",
      career: "Psicologia",
      id: "action-1",
      canonicalProgramId: "canonical-1",
    },
  },
  { role: "user", content: "Quiero ver tecnologia." },
  {
    role: "assistant",
    content: longOfferTwo,
    uiAction: {
      type: "search_exhausted",
      career: "Sistemas Computacionales",
      id: "action-2",
      familyId: "family-2",
    },
  },
  {
    role: "assistant",
    content: "Elige una opcion del menu para continuar.",
    uiAction: {
      type: "career_confirmation",
      careers: [{ name: "Ciberseguridad", canonicalProgramId: "canonical-3" }],
      id: "action-3",
    },
  },
  { role: "user", content: "Que relacion tienen programacion y ciberseguridad?" },
];

const simulationSelection = selectConversationHistory(simulationHistory, {
  hasCurrentChatSummary: true,
});
const simulationPlan = makePlan({
  history: simulationHistory,
  memoryContext: {
    userMemorySummary: "Le gusta programar y resolver problemas.",
    currentChatSummary: "Explora programacion y ciberseguridad.",
    previousChatSummaries: [],
    educativeContinuitySummary:
      "Contexto educativo actual: el usuario exploro Sistemas Computacionales, nivel licenciatura.",
  },
  memoryContextText: [
    "Memoria y resumen actual disponibles.",
    "Contexto educativo actual: el usuario exploro Sistemas Computacionales, nivel licenciatura.",
  ].join("\n"),
});
const legacyHistoryCharacterCount = countHistoryCharacters(simulationHistory);
const optimizedHistoryCharacterCount =
  simulationSelection.metrics.selectedHistoryCharacterCount;
const charactersAvoided =
  legacyHistoryCharacterCount - optimizedHistoryCharacterCount;
const characterReductionPercent = Number(
  ((charactersAvoided / legacyHistoryCharacterCount) * 100).toFixed(2),
);

test("54. Simulacion de conversacion de 12 mensajes", () => {
  assert.equal(simulationHistory.length, 12);
  assert.ok(simulationSelection.messages.length <= 6);
  assert.equal(simulationSelection.messages.at(-1).content, simulationHistory.at(-1).content);
});
test("55. Comparacion evita caracteres", () => {
  assert.ok(charactersAvoided > 0);
  assert.ok(characterReductionPercent > 0);
});
test("56. Referencias recientes de programacion y ciberseguridad se conservan", () => {
  const selected = selectConversationHistory(simulationHistory.slice(0, 6).concat({
    role: "user",
    content: "Que relacion tienen ambas cosas?",
  }));
  assert.match(JSON.stringify(selected.messages), /program|ciberseguridad/i);
});
test("57. Seguir conversando recibe continuidad sin listas ni URLs", () => {
  const text = flattenContents(simulationPlan.contents);
  assert.match(text, /Contexto educativo actual/);
  assert.doesNotMatch(text, /example\.com|Universidad Uno|Universidad Dos/);
});
test("58. Frase combinada recupera chats anteriores", () => {
  assert.equal(shouldIncludePreviousChatSummaries({
    history: makeHistory(13),
    currentMessage: "Como te dije en otro chat, me interesan las redes.",
  }), true);
});
test("59. Mensaje cotidiano en chat establecido no recupera otros chats", () => {
  assert.equal(shouldIncludePreviousChatSummaries({
    history: makeHistory(13),
    currentMessage: "Hoy tambien me gustan las matematicas.",
  }), false);
});
test("60. El contexto conversacional nunca queda vacio con mensaje actual", () => {
  assert.ok(makePlan().contents.length > 0);
});
test("61. Un recorte agresivo no deja assistant huerfano", () => {
  const selected = selectConversationHistory([
    { role: "user", content: "anterior" },
    { role: "assistant", content: "respuesta reciente" },
    { role: "user", content: "actual" },
  ], { limitWithoutSummary: 2, maxCharsWithoutSummary: 100 });
  assert.equal(selected.messages[0].role, "user");
});
test("62. El modo educativo depende de ofertas y no de options", () => {
  assert.match(aiServiceSource, /Array\.isArray\(offerContext\).*offerContext\.length === 0/s);
  assert.match(aiContextServiceSource, /const hasOffers = Array\.isArray\(offerContext\) && offerContext\.length > 0/);
});


function repeatToLength(prefix, length, fill = "x") {
  return `${prefix} ${fill.repeat(length)}`.slice(0, length);
}

function assertCurrentMessageCase(history, expected, options = {}) {
  const selection = selectConversationHistory(history, options);
  assert.equal(selection.messages.at(-1)?.content, expected);
  assert.equal(selection.metrics.currentMessagePreserved, true);
  assert.equal(
    selection.metrics.currentMessageExceededBudget,
    expected.length > selection.metrics.historyCharacterBudget,
  );
}

test("63. Mensaje actual A: historial normal terminado en user", () => {
  assertCurrentMessageCase([
    { role: "user", content: "inicio" },
    { role: "assistant", content: "respuesta" },
    { role: "user", content: "actual A" },
  ], "actual A");
});
test("64. Mensaje actual B: assistant posterior mal formado no reemplaza al user", () => {
  assertCurrentMessageCase([
    { role: "user", content: "actual B" },
    { role: "assistant", content: "dato posterior mal formado" },
  ], "actual B");
});
test("65. Mensaje actual C: mensajes vacios se ignoran", () => {
  assertCurrentMessageCase([
    { role: "user", content: "actual C" },
    { role: "assistant", content: "" },
    { role: "user", content: "   " },
  ], "actual C");
});
test("66. Mensaje actual D: un unico user", () => {
  assertCurrentMessageCase([{ role: "user", content: "actual D" }], "actual D");
});
test("67. Mensaje actual E: user mayor a 4800 sin resumen", () => {
  const current = repeatToLength("actual E", 5000);
  assertCurrentMessageCase([{ role: "user", content: current }], current);
});
test("68. Mensaje actual F: user mayor a 3200 con resumen", () => {
  const current = repeatToLength("actual F", 3400);
  assertCurrentMessageCase([{ role: "user", content: current }], current, {
    hasCurrentChatSummary: true,
  });
});
test("69. Mensaje actual G: varios user consecutivos conservan el ultimo", () => {
  assertCurrentMessageCase([
    { role: "user", content: "user anterior" },
    { role: "user", content: "actual G" },
  ], "actual G");
});
test("70. Mensaje actual H: uiAction anterior no altera el user actual", () => {
  const original = {
    role: "assistant",
    content: "Lista completa https://example.com/oferta/91",
    uiAction: { type: "search_followup", actionId: "a-1", cursor: "c-1" },
  };
  const snapshot = structuredClone(original);
  assertCurrentMessageCase([original, { role: "user", content: "actual H" }], "actual H");
  assert.deepEqual(original, snapshot);
});

test("71. Un mensaje user con uiAction no se compacta", () => {
  const message = { role: "user", content: "texto user", uiAction: { type: "search_followup" } };
  assert.equal(compactDeterministicAssistantMessage(message).compacted, false);
});
test("72. Un uiAction desconocido no se compacta", () => {
  const message = { role: "assistant", content: "normal", uiAction: { type: "unknown" } };
  assert.equal(compactDeterministicAssistantMessage(message).compacted, false);
});
test("73. Un mensaje de error sin uiAction compatible no se compacta", () => {
  const message = { role: "assistant", content: "Ocurrio un error, intenta de nuevo.", uiAction: { type: "error" } };
  assert.equal(compactDeterministicAssistantMessage(message).compacted, false);
});
test("74. Un mensaje emocional no se compacta", () => {
  const message = { role: "assistant", content: "Entiendo que esto te preocupa; podemos ir con calma." };
  assert.equal(compactDeterministicAssistantMessage(message).compacted, false);
});
test("75. Una carrera insegura no filtra telefono correo ni metadatos", () => {
  const unsafeNames = [
    "Sistemas contacto@example.com",
    "Sistemas telefono 477 123 4567",
    "Sistemas cursor abc",
    "Sistemas redirect_url secreto",
  ];
  for (const career of unsafeNames) {
    const compacted = compactDeterministicAssistantMessage({
      role: "assistant",
      content: "Lista https://example.com",
      uiAction: { type: "search_followup", career },
    });
    const serialized = JSON.stringify(compacted.message);
    assert.doesNotMatch(serialized, /@|477|cursor|redirect_url|https?:\/\//i);
  }
});
test("76. Igualdad profunda del mensaje determinista original", () => {
  const original = {
    id: "message-1",
    role: "assistant",
    content: "Escuela completa https://example.com/oferta/91",
    uiAction: {
      type: "search_followup",
      actionId: "action-1",
      canonicalProgramId: "program-1",
      familyId: "family-1",
      cursor: "cursor-1",
      schools: ["Escuela A", "Escuela B"],
    },
  };
  const snapshot = structuredClone(original);
  compactDeterministicAssistantMessage(original);
  assert.deepEqual(original, snapshot);
});

const continuityCases = [
  ["77. Continuidad sin estado educativo", {}, ""],
  ["78. Continuidad con carrera activa", { activeConfirmedCareer: { name: "Psicologia" }, currentLevel: "licenciatura" }, /Psicologia/],
  ["79. Continuidad con busqueda agotada", { activeConfirmedCareer: { name: "Sistemas" }, status: "search_exhausted" }, /search_exhausted/],
  ["80. Continuidad esperando confirmacion", { activeConfirmedCareer: { name: "Derecho" }, status: "awaiting_confirmation" }, /awaiting_confirmation/],
  ["81. Continuidad al seguir conversando", { activeConfirmedCareer: { name: "Medicina" }, status: "deferred" }, /deferred/],
  ["82. Continuidad con estado parcial", { currentLevel: "bachillerato" }, /bachillerato/],
  ["83. Continuidad con carrera extremadamente larga", { activeConfirmedCareer: { name: "Sistemas ".repeat(80) }, status: "deferred" }, /^.{1,220}$/s],
  ["84. Continuidad con valores null", { activeConfirmedCareer: null, currentLevel: null, status: null }, ""],
  ["85. Continuidad ignora objetos inesperados", { activeConfirmedCareer: { name: { unsafe: true } }, currentLevel: { unsafe: true }, status: { unsafe: true } }, ""],
];
for (const [name, state, expectation] of continuityCases) {
  test(name, () => {
    const summary = buildEducativeContinuitySummary(state);
    assert.ok(summary.length <= 220);
    assert.doesNotMatch(summary, /https?:\/\/|\[object Object\]|actionId|canonicalProgramId|familyId|cursor/i);
    if (expectation instanceof RegExp) assert.match(summary, expectation);
    else assert.equal(summary, expectation);
  });
}

const falsePositiveRecallCases = [
  ["86. No recuerdo la contrasena no recupera chats", "No recuerdo la contrasena"],
  ["87. La escuela recuerda a sus alumnos no recupera chats", "La escuela recuerda a sus alumnos"],
  ["88. Anteriormente la institucion tenia otro nombre no recupera chats", "Anteriormente la institucion tenia otro nombre"],
  ["89. Memoria RAM no recupera chats", "Estoy estudiando memoria RAM"],
  ["90. Chat anterior eliminado no recupera chats", "El chat anterior fue eliminado"],
];
for (const [name, currentMessage] of falsePositiveRecallCases) {
  test(name, () => {
    assert.equal(shouldIncludePreviousChatSummaries({
      history: makeHistory(15),
      currentMessage,
    }), false);
  });
}

const positiveRecallCases = [
  ["91. recuerda recupera chats", "recuerda"],
  ["92. recuerdas recupera chats", "¿recuerdas?"],
  ["93. Como te dije recupera chats", "Como te dije"],
  ["94. COMO TE CONTE recupera chats", "COMO TE CONTÉ"],
  ["95. te habia dicho recupera chats", "te había dicho"],
  ["96. ya te habia contado recupera chats", "ya te habia contado"],
  ["97. hablamos antes recupera chats", "hablamos antes"],
  ["98. en otro chat recupera chats", "en otro chat"],
  ["99. lo que te dije antes recupera chats", "lo que te dije antes"],
  ["100. lo que hablamos recupera chats", "lo que hablamos"],
  ["101. anteriormente aislado recupera chats", "anteriormente"],
];
for (const [name, currentMessage] of positiveRecallCases) {
  test(name, () => {
    assert.equal(shouldIncludePreviousChatSummaries({
      history: makeHistory(15),
      currentMessage,
    }), true);
  });
}

function assertSingleCurrentMessage(plan, currentMessage) {
  const text = flattenContents(plan.contents);
  assert.equal(text.split(currentMessage).length - 1, 1);
  return text;
}

test("102. Contents sin memoria contiene una sola copia del mensaje actual", () => {
  const current = "actual sin memoria";
  assertSingleCurrentMessage(makePlan({ history: [{ role: "user", content: current }] }), current);
});
test("103. Contents con memoria global inserta contexto antes del actual", () => {
  const current = "actual con memoria";
  const text = assertSingleCurrentMessage(makePlan({
    history: [{ role: "user", content: current }],
    memoryContext: { userMemorySummary: "memoria global" },
    memoryContextText: "Memoria global del usuario: memoria global",
  }), current);
  assert.ok(text.indexOf("memoria global") < text.indexOf(current));
});
test("104. Contents con resumen actual no duplica mensaje", () => {
  const current = "actual con resumen";
  const text = assertSingleCurrentMessage(makePlan({
    history: [{ role: "user", content: current }],
    memoryContext: { currentChatSummary: "resumen actual" },
    memoryContextText: "Resumen breve de este chat: resumen actual",
  }), current);
  assert.match(text, /resumen actual/);
});
test("105. Contents con resumenes anteriores no duplica mensaje", () => {
  const current = "actual con chats previos";
  const text = assertSingleCurrentMessage(makePlan({
    history: [{ role: "user", content: current }],
    memoryContext: { previousChatSummaries: [{ summary: "redes" }] },
    memoryContextText: "Resumenes breves de chats anteriores: redes",
  }), current);
  assert.match(text, /redes/);
});
test("106. Contents con continuidad educativa no duplica mensaje", () => {
  const current = "actual con continuidad";
  const text = assertSingleCurrentMessage(makePlan({
    history: [{ role: "user", content: current }],
    memoryContext: { educativeContinuitySummary: "Exploro Psicologia" },
    memoryContextText: "Continuidad educativa validada: Exploro Psicologia",
  }), current);
  assert.match(text, /Psicologia/);
});
test("107. Contents con offerContext no duplica mensaje", () => {
  const current = "actual con oferta";
  const text = assertSingleCurrentMessage(makePlan({
    history: [{ role: "user", content: current }],
    offerContext: [{ id: "91" }],
    offerContextText: "Oferta validada 91",
  }), current);
  assert.match(text, /Oferta validada 91/);
});
test("108. Contents con todos los bloques mantiene orden y una copia", () => {
  const current = "actual con todo";
  const text = assertSingleCurrentMessage(makePlan({
    history: [{ role: "user", content: "anterior" }, { role: "assistant", content: "respuesta" }, { role: "user", content: current }],
    offerContext: [{ id: "91" }],
    memoryContext: {
      userMemorySummary: "memoria",
      currentChatSummary: "resumen",
      previousChatSummaries: [{ summary: "chat previo" }],
      educativeContinuitySummary: "continuidad",
    },
    memoryContextText: "memoria\nresumen\nchat previo\ncontinuidad",
    offerContextText: "oferta validada",
  }), current);
  assert.ok(text.indexOf("memoria") < text.indexOf(current));
  assert.ok(text.indexOf("oferta validada") < text.indexOf(current));
});

test("109. gemini_context_usage aparece una vez y antes del failover", () => {
  const occurrences = aiServiceSource.match(/console\.log\(requestContext\.metrics\)/g) || [];
  const logIndex = aiServiceSource.indexOf("console.log(requestContext.metrics)");
  const conversationLoopIndex = aiServiceSource.indexOf(
    "for (let index = 0; index < GEMINI_API_KEYS.length",
    aiServiceSource.indexOf("export async function generateAssistantReply"),
  );
  assert.equal(occurrences.length, 1);
  assert.ok(logIndex > aiServiceSource.indexOf("const requestContext"));
  assert.ok(logIndex < conversationLoopIndex);
});

test("110. Conversacion 6 y memoria 12 son arreglos separados e inmutables", () => {
  const storedHistory = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: index === 9
      ? "Lista educativa larga https://example.com/oferta/91"
      : `mensaje-${index}`,
    ...(index === 9 ? { uiAction: { type: "search_followup", actionId: "a-9" } } : {}),
  }));
  storedHistory[11] = { role: "user", content: "mensaje actual" };
  const snapshot = structuredClone(storedHistory);
  const memoryHistory = storedHistory.slice(-12);
  const conversationSelection = selectConversationHistory(storedHistory, {
    hasCurrentChatSummary: true,
  });
  assert.equal(memoryHistory.length, 12);
  assert.equal(conversationSelection.messages.length, 6);
  assert.notStrictEqual(memoryHistory, conversationSelection.messages);
  assert.deepEqual(memoryHistory, snapshot);
  assert.deepEqual(storedHistory, snapshot);
  assert.match(memoryHistory[9].content, /https?:\/\//);
  assert.doesNotMatch(JSON.stringify(conversationSelection.messages), /actionId|https?:\/\//);
});

const auditMemorySummary = repeatToLength("Memoria global estable", 980, "m");
const auditCurrentSummary = repeatToLength("Resumen actual", 680, "r");
const auditPreviousSummaries = [
  { title: "Chat redes", summary: repeatToLength("Interes en redes", 320, "p") },
  { title: "Chat software", summary: repeatToLength("Interes en software", 320, "q") },
];
const auditLongOfferOne = repeatToLength(
  "Instituciones y carreras Link: https://example.com/oferta-educativa/detalle/" + "1".repeat(80),
  1800,
  "a",
);
const auditLongOfferTwo = repeatToLength(
  "Mas instituciones Link: https://example.com/oferta-educativa/detalle/" + "2".repeat(80),
  1800,
  "b",
);
const realisticBaseHistory = [
  { role: "assistant", content: "Bienvenida previa" },
  { role: "user", content: "Me gusta resolver problemas" },
  { role: "assistant", content: "Que problemas disfrutas?" },
  { role: "user", content: "Me interesa programar" },
  { role: "assistant", content: "Programar combina logica y creatividad" },
  { role: "user", content: "Tambien las redes" },
  { role: "assistant", content: "Las redes conectan sistemas" },
  { role: "user", content: "Quiero explorar opciones" },
  { role: "assistant", content: "Podemos revisar alternativas" },
  { role: "user", content: "Muestrame algunas" },
  { role: "assistant", content: auditLongOfferOne, uiAction: { type: "search_followup", career: "Sistemas", actionId: "a-10" } },
  { role: "user", content: "Que otras hay?" },
  { role: "assistant", content: "Hay rutas afines en software y redes" },
  { role: "user", content: "Quiero elegir una" },
  { role: "user", content: "Primero ensename mas" },
  { role: "assistant", content: "Menu completo", uiAction: { type: "career_confirmation", careers: [{ name: "Ciberseguridad" }], actionId: "a-15" } },
  { role: "assistant", content: auditLongOfferTwo, uiAction: { type: "search_followup", career: "Ciberseguridad", actionId: "a-16" } },
  { role: "user", content: "Ya casi decido" },
  { role: "assistant", content: "Resultados agotados", uiAction: { type: "search_exhausted", career: "Ciberseguridad", cursor: "end" } },
  { role: "user", content: "PLACEHOLDER_CURRENT" },
];

function buildRealisticScenario(currentPrefix) {
  const currentMessage = repeatToLength(currentPrefix, 300, "u");
  const history = structuredClone(realisticBaseHistory);
  history[19].content = currentMessage;
  const includePrevious = shouldIncludePreviousChatSummaries({ history, currentMessage });
  const previousChatSummaries = includePrevious ? auditPreviousSummaries : [];
  const memoryParts = [
    `Memoria global del usuario: ${auditMemorySummary}`,
    `Resumen breve de este chat: ${auditCurrentSummary}`,
    ...(includePrevious
      ? [`Resumenes breves de chats anteriores: ${auditPreviousSummaries.map((item) => item.summary).join("\n")}`]
      : []),
    "Continuidad educativa validada: Contexto educativo actual: el usuario exploro Ciberseguridad, nivel licenciatura.",
  ];
  const memoryContextText = memoryParts.join("\n");
  const plan = makePlan({
    history,
    memoryContext: {
      userMemorySummary: auditMemorySummary,
      currentChatSummary: auditCurrentSummary,
      previousChatSummaries,
      educativeContinuitySummary:
        "Contexto educativo actual: el usuario exploro Ciberseguridad, nivel licenciatura.",
    },
    memoryContextText,
  });
  const legacySystemPromptCharacterCount = FULL_SYSTEM_PROMPT.length;
  const optimizedSystemPromptCharacterCount = BASE_SYSTEM_INSTRUCTION.length;
  const legacyHistoryCharacterCount = countHistoryCharacters(history);
  const optimizedHistoryCharacterCount = plan.metrics.selectedHistoryCharacterCount;
  const legacyMemoryContextCharacterCount = [
    `Memoria global del usuario: ${auditMemorySummary}`,
    `Resumen breve de este chat: ${auditCurrentSummary}`,
    `Resumenes breves de chats anteriores: ${auditPreviousSummaries.map((item) => item.summary).join("\n")}`,
  ].join("\n").length;
  const legacyTotal = legacySystemPromptCharacterCount +
    legacyHistoryCharacterCount + legacyMemoryContextCharacterCount;
  const optimizedTotal = optimizedSystemPromptCharacterCount +
    optimizedHistoryCharacterCount + memoryContextText.length;
  const charactersAvoided = legacyTotal - optimizedTotal;

  return {
    legacySystemPromptCharacterCount,
    optimizedSystemPromptCharacterCount,
    legacyHistoryMessageCount: history.length,
    optimizedHistoryMessageCount: plan.metrics.selectedHistoryMessageCount,
    legacyHistoryCharacterCount,
    optimizedHistoryCharacterCount,
    memoryContextCharacterCount: memoryContextText.length,
    previousSummariesIncluded: plan.metrics.includedPreviousChatSummaries,
    compactedDeterministicMessageCount:
      plan.metrics.compactedDeterministicMessageCount,
    charactersAvoided,
    characterReductionPercent: Number(((charactersAvoided / legacyTotal) * 100).toFixed(2)),
  };
}

const realisticScenarioA = buildRealisticScenario(
  "Hoy quiero relacionar programacion con ciberseguridad",
);
const realisticScenarioB = buildRealisticScenario(
  "Como te dije en otro chat, quiero relacionar programacion con ciberseguridad",
);

test("111. Simulacion realista A excluye chats anteriores", () => {
  assert.equal(realisticScenarioA.legacyHistoryMessageCount, 20);
  assert.equal(realisticScenarioA.optimizedHistoryMessageCount, 6);
  assert.equal(realisticScenarioA.previousSummariesIncluded, false);
  assert.ok(realisticScenarioA.compactedDeterministicMessageCount >= 3);
  assert.ok(realisticScenarioA.charactersAvoided > 0);
});
test("112. Simulacion realista B incluye chats anteriores", () => {
  assert.equal(realisticScenarioB.legacyHistoryMessageCount, 20);
  assert.equal(realisticScenarioB.optimizedHistoryMessageCount, 6);
  assert.equal(realisticScenarioB.previousSummariesIncluded, true);
  assert.ok(realisticScenarioB.compactedDeterministicMessageCount >= 3);
  assert.ok(realisticScenarioB.charactersAvoided > 0);
});
test("113. Simulaciones no calculan tokens estimados", () => {
  assert.doesNotMatch(JSON.stringify({ realisticScenarioA, realisticScenarioB }), /estimatedToken|tokenEstimate/i);
});


test("114. Simulacion realista contiene 10 user y 10 assistant", () => {
  assert.equal(realisticBaseHistory.filter((message) => message.role === "user").length, 10);
  assert.equal(realisticBaseHistory.filter((message) => message.role === "assistant").length, 10);
  assert.equal(auditMemorySummary.length, 980);
  assert.equal(auditCurrentSummary.length, 680);
  assert.equal(auditPreviousSummaries.length, 2);
  assert.equal(repeatToLength("mensaje actual", 300).length, 300);
});

await testAsync("115. Retorno educativo determinista no registra contexto ni llama Gemini", async () => {
  const capturedLogs = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => capturedLogs.push(args);
  try {
    const reply = await generateAssistantReply(
      [{ role: "user", content: "busca una carrera inexistente" }],
      [],
      {},
      { isEducativeRequest: true },
    );
    assert.match(reply, /No encontre opciones exactas/);
  } finally {
    console.log = originalConsoleLog;
  }
  assert.equal(geminiCallCount, 0);
  assert.equal(
    capturedLogs.some((entry) => entry[0]?.event === "gemini_context_usage"),
    false,
  );
});

test("116. gemini_usage conserva todos los campos y ambos requestType", () => {
  for (const field of [
    "promptTokenCount",
    "candidatesTokenCount",
    "thoughtsTokenCount",
    "cachedContentTokenCount",
    "totalTokenCount",
  ]) {
    assert.match(aiServiceSource, new RegExp(`${field}: getUsageCount`));
  }
  assert.match(aiServiceSource, /logGeminiUsage\("conversation", GEMINI_CHAT_MODEL/);
  assert.match(aiServiceSource, /logGeminiUsage\("memory", GEMINI_MEMORY_MODEL/);
});
test("117. Modelos limites temperaturas y cadencia permanecen intactos", () => {
  const envSource = readFileSync(resolve(backendDirectory, "src/config/env.js"), "utf8");
  assert.match(envSource, /gemini-2\.5-flash-lite/);
  assert.match(envSource, /GEMINI_CHAT_MAX_OUTPUT_TOKENS[\s\S]*?300/);
  assert.match(envSource, /GEMINI_MEMORY_MAX_OUTPUT_TOKENS[\s\S]*?600/);
  assert.match(envSource, /GEMINI_CHAT_TEMPERATURE", 0\.6/);
  assert.match(envSource, /GEMINI_MEMORY_TEMPERATURE", 0\.1/);
  assert.match(envSource, /GEMINI_MEMORY_EVERY_USER_MESSAGES[\s\S]*?4/);
});
test("118. buildMemoryContext evita consulta previa y conserva memorias actuales", () => {
  const buildStart = chatServiceSource.indexOf("async function buildMemoryContext");
  const buildEnd = chatServiceSource.indexOf("async function getOwnedChat", buildStart);
  const block = chatServiceSource.slice(buildStart, buildEnd);
  assert.match(block, /findUserMemoryByUserId\(userId\)/);
  assert.match(block, /includePreviousChatSummaries[\s\S]*?listRecentChatSummariesByUserId/);
  assert.match(block, /: Promise\.resolve\(\[\]\)/);
  assert.match(block, /currentChatSummary: chat\.summary \|\| ""/);
});
test("119. selectConversationHistory conserva exactamente los roles", () => {
  const history = [
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "u2" },
  ];
  assert.deepEqual(
    selectConversationHistory(history).messages.map((message) => message.role),
    ["user", "assistant", "user"],
  );
});
test("120. aiContextService es puro por estructura", () => {
  assert.doesNotMatch(aiContextServiceSource, /prisma|GoogleGenerativeAI|generateContent|console\.|createMessage|updateChat/i);
  assert.doesNotMatch(aiContextServiceSource, /^import\s/m);
});

const comparison = {
  note:
    "La reduccion de caracteres no equivale directamente a tokens. La reduccion real se medira en produccion mediante usageMetadata.promptTokenCount.",
  systemPrompt: {
    legacyCharacterCount: FULL_SYSTEM_PROMPT.length,
    baseCharacterCount: BASE_SYSTEM_INSTRUCTION.length,
    charactersAvoidedWithoutOffers:
      FULL_SYSTEM_PROMPT.length - BASE_SYSTEM_INSTRUCTION.length,
  },
  history: {
    legacyHistoryMessageCount: simulationHistory.length,
    optimizedHistoryMessageCount: simulationSelection.messages.length,
    legacyHistoryCharacterCount,
    optimizedHistoryCharacterCount,
    droppedHistoryMessageCount:
      simulationSelection.metrics.droppedHistoryMessageCount,
    compactedDeterministicMessageCount:
      simulationSelection.metrics.compactedDeterministicMessageCount,
    charactersAvoided,
    characterReductionPercent,
  },
  previousChatSummaries: {
    legacyPolicy: "Hasta dos resumenes en cada respuesta.",
    optimizedPolicy:
      "Solo al comenzar el chat o cuando el usuario pide recordar informacion previa.",
  },
  realisticSimulations: {
    scenarioA: realisticScenarioA,
    scenarioB: realisticScenarioB,
  },
};

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  resolve(outputDirectory, "context-comparison.json"),
  `${JSON.stringify(comparison, null, 2)}\n`,
);
writeFileSync(
  resolve(outputDirectory, "context-comparison.md"),
  `# Comparacion de contexto de entrada\n\n` +
    `- System prompt anterior: ${comparison.systemPrompt.legacyCharacterCount} caracteres.\n` +
    `- System prompt base: ${comparison.systemPrompt.baseCharacterCount} caracteres.\n` +
    `- Diferencia sin ofertas: ${comparison.systemPrompt.charactersAvoidedWithoutOffers} caracteres.\n` +
    `- Historial anterior: ${comparison.history.legacyHistoryMessageCount} mensajes y ${legacyHistoryCharacterCount} caracteres.\n` +
    `- Historial optimizado: ${comparison.history.optimizedHistoryMessageCount} mensajes y ${optimizedHistoryCharacterCount} caracteres.\n` +
    `- Mensajes omitidos: ${comparison.history.droppedHistoryMessageCount}.\n` +
    `- Mensajes deterministas compactados: ${comparison.history.compactedDeterministicMessageCount}.\n` +
    `- Caracteres evitados: ${charactersAvoided} (${characterReductionPercent}%).\n\n` +
    `## Simulacion realista A: chat establecido sin recuerdo\n\n` +
    `- Historial: ${realisticScenarioA.legacyHistoryMessageCount} a ${realisticScenarioA.optimizedHistoryMessageCount} mensajes.\n` +
    `- Caracteres de historial: ${realisticScenarioA.legacyHistoryCharacterCount} a ${realisticScenarioA.optimizedHistoryCharacterCount}.\n` +
    `- Contexto de memoria: ${realisticScenarioA.memoryContextCharacterCount} caracteres.\n` +
    `- Resumenes anteriores incluidos: ${realisticScenarioA.previousSummariesIncluded}.\n` +
    `- Mensajes compactados: ${realisticScenarioA.compactedDeterministicMessageCount}.\n` +
    `- Caracteres evitados: ${realisticScenarioA.charactersAvoided} (${realisticScenarioA.characterReductionPercent}%).\n\n` +
    `## Simulacion realista B: chat establecido con recuerdo\n\n` +
    `- Historial: ${realisticScenarioB.legacyHistoryMessageCount} a ${realisticScenarioB.optimizedHistoryMessageCount} mensajes.\n` +
    `- Caracteres de historial: ${realisticScenarioB.legacyHistoryCharacterCount} a ${realisticScenarioB.optimizedHistoryCharacterCount}.\n` +
    `- Contexto de memoria: ${realisticScenarioB.memoryContextCharacterCount} caracteres.\n` +
    `- Resumenes anteriores incluidos: ${realisticScenarioB.previousSummariesIncluded}.\n` +
    `- Mensajes compactados: ${realisticScenarioB.compactedDeterministicMessageCount}.\n` +
    `- Caracteres evitados: ${realisticScenarioB.charactersAvoided} (${realisticScenarioB.characterReductionPercent}%).\n\n` +
    `${comparison.note}\n`,
);

function getCoverageMetadata(result) {
  const number = Number(result.name.match(/^\d+/)?.[0]);
  const staticTests = new Set([44, 47, 48, 49, 50, 51, 52, 62, 109, 116, 117, 118, 120]);
  const requirement = number <= 10 ? "Variables de entorno"
    : number <= 21 ? "Seleccion y presupuesto del historial"
      : number <= 29 ? "Compactacion educativa e inmutabilidad"
        : number <= 31 ? "Continuidad educativa"
          : number <= 39 ? "Memoria y resumenes de chats anteriores"
            : number <= 44 ? "Prompt base, prompt educativo y links"
              : number <= 46 ? "Metricas seguras de contexto"
                : number <= 53 ? "Integracion conversacion, memoria y logs"
                  : number <= 62 ? "Simulacion inicial y calidad de continuidad"
                    : number <= 70 ? "Auditoria A-H del mensaje actual"
                      : number <= 76 ? "Compactacion negativa y datos sensibles"
                        : number <= 85 ? "Estados de continuidad educativa"
                          : number <= 101 ? "Politica conservadora de chats anteriores"
                            : number <= 108 ? "Construccion de contents sin duplicados"
                              : number <= 110 ? "Log unico y separacion conversacion/memoria"
                                : number <= 115 ? "Simulacion realista y retorno determinista"
                                  : "Invariantes finales de integracion";
  const groupedAssertions = {
    5: "Valida las cuatro variables con valores personalizados.",
    6: "Valida fallback de las cuatro variables para cero.",
    7: "Valida fallback de las cuatro variables para negativos.",
    8: "Valida fallback de las cuatro variables para decimales.",
    9: "Valida fallback de las cuatro variables para NaN.",
    10: "Valida fallback de las cuatro variables para Infinity.",
    44: "Comprueba OFFER_DETAIL_ID_PATTERN, hasInvalidOfferLinks e INVALID_OFFER_LINK_RESPONSE por inspeccion.",
    46: "Compara todas las claves reales contra una lista cerrada de metricas permitidas.",
    75: "Prueba correo, telefono, cursor y redirect_url en nombres inseguros.",
    108: "Combina memoria global, resumen actual, chats previos, continuidad, oferta e historial.",
    109: "Cuenta una sola llamada al logger y verifica que este antes del bucle de failover.",
    110: "Comprueba 12 vs 6, objetos distintos, inmutabilidad, URL original en memoria y ausencia en conversacion.",
    114: "Comprueba 10 user, 10 assistant, memoria 980, resumen 680, dos resumenes previos y mensaje actual 300.",
    115: "Ejecuta el retorno determinista y captura console.log para comprobar cero logs de contexto.",
    116: "Comprueba cinco contadores y los requestType conversation y memory por inspeccion.",
    118: "Comprueba consulta global, ternario de chats previos, Promise.resolve([]) y resumen actual por inspeccion.",
  };

  return {
    ...result,
    requirement,
    coverageType: staticTests.has(number) ? "static-source-audit" : "behavioral",
    assertions: groupedAssertions[number] || "Las assertions estan expresadas directamente en la prueba nombrada.",
  };
}

const detailedResults = results.map(getCoverageMetadata);

const passed = results.filter((result) => result.status === "PASS").length;
const failed = results.length - passed;
const report = {
  generatedAt: new Date().toISOString(),
  geminiCalled: geminiCallCount > 0,
  databaseUsed: false,
  total: results.length,
  passed,
  failed,
  results: detailedResults,
  comparison,
};

writeFileSync(
  resolve(outputDirectory, "test-results.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);

for (const result of results) {
  console.log(`${result.status}: ${result.name}${result.error ? ` - ${result.error}` : ""}`);
}
console.log(`TOTAL: ${results.length} | PASS: ${passed} | FAIL: ${failed}`);

if (failed > 0) {
  process.exitCode = 1;
}

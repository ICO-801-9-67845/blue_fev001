import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ||= "mysql://test:test@127.0.0.1:3306/test";
process.env.JWT_SECRET ||= "memory-context-test";
process.env.GEMINI_API_KEYS ||= "not-a-real-key";

const {
  buildMemoryPrompt,
  buildMemoryRequestContext,
  buildMemorySummarySystemInstruction,
  countUnicodeCharacters,
  selectMemoryMessages,
  truncateMemoryText,
} = await import("../src/services/memoryContextService.js");
const env = await import("../src/config/env.js");
const { createMemorySummaryGenerator } = await import("../src/services/aiService.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const reportDirectory = resolve(root, "tmp/ai-memory-context-optimization");
const results = [];

async function test(name, run) {
  try {
    await run();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
  }
}

function messages(count, size = 20) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `${index}-` + "x".repeat(size),
  }));
}

function buildOldPrompt({ messages: source, currentChatSummary = "", userMemorySummary = "" }) {
  const transcript = (Array.isArray(source) ? source.slice(-12) : [])
    .map((message) => {
      const role = message.role === "assistant" ? "Blue" : "Usuario";
      const content = message?.content === null || message?.content === undefined
        ? ""
        : String(message.content).trim();
      return `${role}: ${content.slice(0, 900)}`;
    })
    .join("\n");
  return `
Resumen actual del chat:
${String(currentChatSummary || "").trim() || "Sin resumen previo."}

Memoria global actual:
${String(userMemorySummary || "").trim() || "Sin memoria previa."}

Mensajes recientes:
${transcript}
`;
}

const select = (source, limits) => selectMemoryMessages(source, limits);

await test("1. Arreglo vacio", () => assert.deepEqual(select([]).messages, []));
await test("2. Entrada null", () => assert.deepEqual(select(null).messages, []));
await test("3. Entrada undefined", () => assert.deepEqual(select(undefined).messages, []));
await test("4. Un mensaje del usuario", () => assert.equal(select([{ role: "user", content: "hola" }]).messages.length, 1));
await test("5. Un mensaje del asistente", () => assert.equal(select([{ role: "assistant", content: "hola" }]).messages.length, 1));
await test("6. Ocho mensajes", () => assert.equal(select(messages(8)).messages.length, 8));
await test("7. Doce mensajes seleccionan ocho", () => assert.equal(select(messages(12)).messages.length, 8));
await test("8. Mas de doce mensajes seleccionan ocho", () => assert.equal(select(messages(20)).messages.length, 8));
await test("9. Limite predeterminado de ocho", () => assert.equal(select(messages(10)).metrics.selectedMessageCount, 8));
await test("10. Presupuesto predeterminado de 3600", () => assert.equal(select(messages(2)).metrics.transcriptCharacterBudget, 3600));
await test("11. Limite usuario de 600", () => assert.equal(countUnicodeCharacters(select([{ role: "user", content: "u".repeat(900) }]).messages[0].content), 600));
await test("12. Limite asistente de 350", () => assert.equal(countUnicodeCharacters(select([{ role: "assistant", content: "a".repeat(900) }]).messages[0].content), 350));
await test("13. Prioridad del usuario", () => {
  const source = [{ role: "assistant", content: "a1" }, { role: "user", content: "u1" }, { role: "user", content: "u2" }, { role: "assistant", content: "a2" }];
  assert.deepEqual(select(source, { messageLimit: 3 }).messages.map((item) => item.content), ["u1", "u2", "a2"]);
});
await test("14. Preservacion del usuario mas reciente", () => assert.equal(select(messages(20)).metrics.latestUserMessagePreserved, true));
await test("15. Orden cronologico final", () => {
  const indexes = select(messages(12)).messages.map((item) => Number(item.content.split("-")[0]));
  assert.deepEqual(indexes, [...indexes].sort((left, right) => left - right));
});
await test("16. Roles desconocidos ignorados", () => assert.deepEqual(select([{ role: "system", content: "x" }, { role: "user", content: "u" }]).messages, [{ role: "user", content: "u" }]));
await test("17. Contenido null", () => assert.deepEqual(select([{ role: "user", content: null }]).messages, []));
await test("18. Contenido numerico", () => assert.equal(select([{ role: "user", content: 42 }]).messages[0].content, "42"));
await test("19. Contenido objeto", () => assert.equal(select([{ role: "user", content: { value: 1 } }]).messages[0].content, "[object Object]"));
await test("20. Mensaje enorme respeta limite", () => assert.ok(select([{ role: "user", content: "x".repeat(100000) }]).metrics.transcriptCharacterCount <= 3600));
await test("21. Unicode sin pares sustitutos rotos", () => assert.equal(select([{ role: "user", content: "😀".repeat(900) }]).messages[0].content.endsWith("😀"), true));
await test("22. No mutacion del arreglo", () => {
  const source = messages(10); const snapshot = structuredClone(source); select(source); assert.deepEqual(source, snapshot);
});
await test("23. No mutacion de mensajes", () => {
  const source = Object.freeze({ role: "assistant", content: "x", uiAction: Object.freeze({ type: "search_followup" }) }); select([source]); assert.equal(source.content, "x");
});
await test("24. IDs duplicados conservan la copia reciente", () => assert.deepEqual(select([{ id: "1", role: "user", content: "viejo" }, { id: "1", role: "user", content: "nuevo" }]).messages, [{ role: "user", content: "nuevo" }]));
await test("25. Misma referencia no se duplica", () => { const item = { role: "user", content: "unico" }; assert.equal(select([item, item]).messages.length, 1); });
await test("26. Sin resumen actual", () => assert.doesNotMatch(buildMemoryPrompt({ transcript: "U: hola" }).prompt, /CHAT_PREV/));
await test("27. Con resumen actual", () => assert.match(buildMemoryPrompt({ transcript: "U: hola", currentChatSummary: "previo" }).prompt, /CHAT_PREV:\nprevio/));
await test("28. Resumen actual limitado a 500", () => assert.equal(countUnicodeCharacters(buildMemoryPrompt({ currentChatSummary: "x".repeat(900) }).currentChatSummary), 500));
await test("29. Sin memoria global", () => assert.doesNotMatch(buildMemoryPrompt({ transcript: "U: hola" }).prompt, /USER_PREV/));
await test("30. Con memoria global", () => assert.match(buildMemoryPrompt({ userMemorySummary: "estable" }).prompt, /USER_PREV:\nestable/));
await test("31. Memoria global limitada a 700", () => assert.equal(countUnicodeCharacters(buildMemoryPrompt({ userMemorySummary: "x".repeat(900) }).userMemorySummary), 700));
await test("32. Secciones vacias omitidas", () => assert.equal(buildMemoryPrompt().prompt, ""));
await test("33. Sin frases de relleno", () => assert.doesNotMatch(buildMemoryPrompt({ transcript: "U: hola" }).prompt, /Sin resumen previo|Sin memoria previa/));
await test("34. Etiquetas U y A", () => assert.equal(select([{ role: "user", content: "u" }, { role: "assistant", content: "a" }]).transcript, "U: u\nA: a"));
await test("35. Prompt sin timestamps ni IDs internos", () => assert.doesNotMatch(buildMemoryRequestContext({ messages: [{ id: "secret", role: "user", content: "hola", createdAt: "2099-01-01" }] }).prompt, /secret|2099/));
await test("36. uiAction no se serializa", () => assert.doesNotMatch(buildMemoryRequestContext({ messages: [{ role: "assistant", content: "normal", uiAction: { type: "unknown", id: "secret" } }] }).prompt, /uiAction|secret/));
await test("37. Respuesta educativa determinista compactada", () => assert.match(select([{ role: "assistant", content: "https://falsa.example oferta 99", uiAction: { type: "search_followup" } }]).transcript, /opciones educativas verificadas/));
await test("38. Confirmacion educativa compactada", () => assert.match(select([{ role: "assistant", content: "lista", uiAction: { type: "career_confirmation" } }]).transcript, /confirmacion de una carrera/));
await test("39. Mostrar mas compactado", () => assert.match(select([{ role: "assistant", content: "lista", uiAction: { type: "search_followup" } }]).transcript, /mostrar mas/));
await test("40. Continuar conversacion compactado", () => assert.match(select([{ role: "assistant", content: "lista", uiAction: { type: "search_exhausted" } }]).transcript, /continuar la conversacion/));
await test("41. Tipo desconocido conserva contenido", () => assert.equal(select([{ role: "assistant", content: "charla normal", uiAction: { type: "unknown" } }]).messages[0].content, "charla normal"));
await test("42. URLs deterministas eliminadas", () => assert.doesNotMatch(select([{ role: "assistant", content: "https://falsa.example", uiAction: { type: "search_followup" } }]).transcript, /https?:/));
await test("43. redirect_url determinista eliminado", () => assert.doesNotMatch(select([{ role: "assistant", content: "redirect_url=https://falsa.example", uiAction: { type: "search_exhausted" } }]).transcript, /redirect_url/));
await test("44. IDs de oferta deterministas eliminados", () => assert.doesNotMatch(select([{ role: "assistant", content: "oferta 123 id=abc", uiAction: { type: "career_confirmation" } }]).transcript, /123|abc/));
await test("45. Mensaje normal de Blue conservado", () => assert.equal(select([{ role: "assistant", content: "Que actividad disfrutas?" }]).messages[0].content, "Que actividad disfrutas?"));
await test("46. Mensaje del usuario no se compacta", () => assert.equal(select([{ role: "user", content: "https://mi-preferencia.example", uiAction: { type: "search_followup" } }]).messages[0].content, "https://mi-preferencia.example"));
await test("47. Metrica originalMessageCount", () => assert.equal(select(messages(12)).metrics.originalMessageCount, 12));
await test("48. Metrica selectedMessageCount", () => assert.equal(select(messages(12)).metrics.selectedMessageCount, 8));
await test("49. Metrica droppedMessageCount", () => assert.equal(select(messages(12)).metrics.droppedMessageCount, 4));
await test("50. Metrica truncatedMessageCount", () => assert.equal(select([{ role: "user", content: "x".repeat(700) }]).metrics.truncatedMessageCount, 1));
await test("51. Metrica compactedDeterministicMessageCount", () => assert.equal(select([{ role: "assistant", content: "lista", uiAction: { type: "search_followup" } }]).metrics.compactedDeterministicMessageCount, 1));
await test("52. Metrica promptCharacterCount", () => { const value = buildMemoryRequestContext({ messages: [{ role: "user", content: "hola" }] }); assert.equal(value.metrics.promptCharacterCount, countUnicodeCharacters(value.prompt)); });
await test("53. latestUserMessagePreserved falso sin usuario", () => assert.equal(select([{ role: "assistant", content: "hola" }]).metrics.latestUserMessagePreserved, false));
await test("54. Presupuesto incluye etiquetas", () => { const value = select([{ role: "user", content: "x".repeat(100) }], { characterBudget: 10 }); assert.equal(value.metrics.transcriptCharacterCount, 10); });
await test("55. Caracteres originales se miden antes de compactar", () => { const value = select([{ role: "assistant", content: "x".repeat(500), uiAction: { type: "search_followup" } }]); assert.equal(value.metrics.originalMessageCharacterCount, 500); });

function createGeneratorHarness() {
  const calls = { order: [], contexts: [], prompts: [], modelOptions: [] };
  const generator = createMemorySummaryGenerator({
    apiKeys: ["synthetic-key"],
    createClient() {
      return { getGenerativeModel(options) {
        calls.modelOptions.push(options);
        return { async generateContent(request) {
          calls.prompts.push(request.contents[0].parts[0].text);
          return { response: {
            usageMetadata: { promptTokenCount: 1, totalTokenCount: 2 },
            candidates: [{ finishReason: "STOP" }],
            text: () => '{"chatSummary":"Chat","userMemorySummary":"Usuario"}',
          } };
        } };
      } };
    },
    writeContextUsage(entry) { calls.order.push("context"); calls.contexts.push(entry); },
    writeUsage() { calls.order.push("usage"); },
    writeResult() { calls.order.push("result"); },
    writeAttempt() { calls.order.push("attempt"); },
  });
  return { calls, generator };
}

await test("56. Evento sin contenido ni datos sensibles", async () => {
  const harness = createGeneratorHarness();
  await harness.generator({ messages: [{ role: "user", content: "DATABASE_URL=mysql://secret secret-api-key usuario@example.com https://privado.example UNIVERSIDAD SECRETA redirect_url chat-id-secret user-id-secret" }] });
  const serialized = JSON.stringify(harness.calls.contexts[0]);
  assert.doesNotMatch(serialized, /mysql|secret-api|usuario@|privado|UNIVERSIDAD|redirect_url|chat-id|user-id/);
});
await test("57. Evento exactamente una vez", async () => { const harness = createGeneratorHarness(); await harness.generator({ messages: [{ role: "user", content: "x" }] }); assert.equal(harness.calls.contexts.length, 1); });
await test("58. Orden contexto antes de usage", async () => { const harness = createGeneratorHarness(); await harness.generator({ messages: [{ role: "user", content: "x" }] }); assert.deepEqual(harness.calls.order, ["context", "usage", "result"]); });
await test("59. Instruccion JSON exacta", () => { const text = buildMemorySummarySystemInstruction(); assert.match(text, /exactamente las claves "chatSummary" y "userMemorySummary"/); });
await test("60. Objetivos 450 y 650", () => { const text = buildMemorySummarySystemInstruction(); assert.match(text, /450 caracteres/); assert.match(text, /650 caracteres/); });
await test("61. Parser conserva limites 700 y 1000", () => { const source = readFileSync(resolve(root, "backend/src/services/aiService.js"), "utf8"); assert.match(source, /truncateUnicode\(descriptors\.chatSummary\?\.value \|\| "", 700\)/); assert.match(source, /descriptors\.userMemorySummary\?\.value \|\| "",\s*1000/); });
await test("62. Parser robusto sigue intacto", () => { const source = readFileSync(resolve(root, "backend/src/services/aiService.js"), "utf8"); assert.match(source, /extractFirstJsonObject/); assert.match(source, /validateMemorySummaryPayload/); });
await test("63. Resultado estructurado sigue intacto", () => { const source = readFileSync(resolve(root, "backend/src/services/aiService.js"), "utf8"); assert.match(source, /\{ ok: false, summaries: null, reason \}/); assert.match(source, /ok: true,\s*summaries:/); });
await test("64. Rotacion de claves sigue intacta", () => { const source = readFileSync(resolve(root, "backend/src/services/aiService.js"), "utf8"); assert.match(source, /for \(let index = 0; index < apiKeys\.length/); });
await test("65. Watermark sigue intacto", () => { const source = readFileSync(resolve(root, "backend/src/services/memoryRefreshService.js"), "utf8"); assert.match(source, /durable watermark/); assert.match(source, /claimRefresh/); });
await test("66. Persistencia atomica sigue intacta", () => { const source = readFileSync(resolve(root, "backend/src/services/memoryRefreshService.js"), "utf8"); assert.equal((source.match(/prismaClient\.\$transaction/g) || []).length, 1); });
await test("67. Cadencia sigue en cuatro", () => assert.equal(env.GEMINI_MEMORY_EVERY_USER_MESSAGES, 4));
await test("68. No hay transaccion durante Gemini", () => { const source = readFileSync(resolve(root, "backend/src/services/memoryRefreshService.js"), "utf8"); assert.ok(source.indexOf("await persist(") > source.indexOf("await generateSummaries")); });
await test("69. No se agrega segunda llamada", () => { const source = readFileSync(resolve(root, "backend/src/services/aiService.js"), "utf8"); const memoryBlock = source.slice(source.indexOf("export function createMemorySummaryGenerator"), source.indexOf("const defaultMemorySummaryGenerator")); assert.equal((memoryBlock.match(/generateContent\(/g) || []).length, 1); });
await test("70. Contexto conversacional no se modifica", () => { const source = readFileSync(resolve(root, "backend/src/services/aiContextService.js"), "utf8"); assert.match(source, /limitWithSummary = 6/); assert.match(source, /limitWithoutSummary = 8/); assert.match(source, /maxCharsWithSummary = 3200/); assert.match(source, /maxCharsWithoutSummary = 4800/); });
await test("71. Configuracion predeterminada exacta", () => assert.deepEqual({ limit: env.GEMINI_MEMORY_CONTEXT_MESSAGE_LIMIT, budget: env.GEMINI_MEMORY_CONTEXT_MAX_CHARS, user: env.GEMINI_MEMORY_USER_MESSAGE_MAX_CHARS, assistant: env.GEMINI_MEMORY_ASSISTANT_MESSAGE_MAX_CHARS, chat: env.GEMINI_MEMORY_CURRENT_CHAT_SUMMARY_MAX_CHARS, memory: env.GEMINI_MEMORY_USER_MEMORY_MAX_CHARS }, { limit: 8, budget: 3600, user: 600, assistant: 350, chat: 500, memory: 700 }));
await test("72. Validacion de enteros positivos reutilizada", () => { process.env.TEST_POSITIVE = "0"; assert.equal(env.positiveInteger("TEST_POSITIVE", 8), 8); process.env.TEST_POSITIVE = "9"; assert.equal(env.positiveInteger("TEST_POSITIVE", 8), 9); delete process.env.TEST_POSITIVE; });
await test("73. Maximo de salida sigue en 600", () => assert.equal(env.GEMINI_MEMORY_MAX_OUTPUT_TOKENS, 600));
await test("74. Modelo y temperatura permanecen", () => { assert.equal(env.GEMINI_MEMORY_MODEL, "gemini-2.5-flash-lite"); assert.equal(env.GEMINI_MEMORY_TEMPERATURE, 0.1); });
await test("75. Logger de contexto no altera generacion", async () => {
  const harness = createGeneratorHarness();
  const generator = createMemorySummaryGenerator({
    apiKeys: ["synthetic-key"],
    createClient: () => ({ getGenerativeModel: () => ({ generateContent: async () => ({ response: { usageMetadata: {}, candidates: [{ finishReason: "STOP" }], text: () => '{"chatSummary":"Chat"}' } }) }) }),
    writeContextUsage() { throw new Error("logger failure"); }, writeUsage() {}, writeResult() {}, writeAttempt() {},
  });
  assert.equal((await generator({ messages: [{ role: "user", content: "x" }] })).ok, true);
  assert.equal(harness.calls.contexts.length, 0);
});


function createScenarioHarness(steps, modelName = "synthetic-memory-model") {
  let stepIndex = 0;
  const calls = { order: [], contexts: [], clients: 0 };
  const generator = createMemorySummaryGenerator({
    apiKeys: steps.map((_, index) => `synthetic-key-${index}`),
    modelName,
    createClient() {
      return {
        getGenerativeModel() {
          return {
            async generateContent() {
              calls.order.push("client");
              calls.clients += 1;
              const step = steps[stepIndex++];
              if (step.error) throw step.error;
              return {
                response: {
                  usageMetadata: {},
                  candidates: [{ finishReason: step.finishReason || "STOP" }],
                  text() {
                    if (step.textError) throw step.textError;
                    return step.text;
                  },
                },
              };
            },
          };
        },
      };
    },
    writeContextUsage(entry) {
      calls.order.push("context");
      calls.contexts.push(entry);
    },
    writeUsage() { calls.order.push("usage"); },
    writeResult() { calls.order.push("result"); },
    writeAttempt() { calls.order.push("attempt"); },
  });
  return { calls, generator };
}

await test("76. Presupuesto menor al limite individual conserva usuario truncado", () => {
  const value = select([{ role: "user", content: "abcdefghij" }], { characterBudget: 5 });
  assert.equal(value.transcript, "U: ab");
  assert.equal(value.metrics.latestUserMessagePreserved, true);
  assert.equal(value.metrics.transcriptCharacterCount, 5);
});
await test("77. Presupuesto de un caracter produce contexto vacio seguro", () => {
  const value = select([{ role: "user", content: "hola" }], { characterBudget: 1 });
  assert.deepEqual(value.messages, []);
  assert.equal(value.transcript, "");
  assert.equal(value.metrics.transcriptCharacterCount, 0);
});
await test("78. Presupuesto menor que etiqueta U produce contexto vacio", () => {
  const value = select([{ role: "user", content: "hola" }], { characterBudget: 2 });
  assert.deepEqual(value.messages, []);
  assert.equal(value.metrics.latestUserMessagePreserved, false);
});
await test("79. Limite de mensajes uno reserva ultimo usuario", () => {
  const value = select([{ role: "assistant", content: "a" }, { role: "user", content: "u" }, { role: "assistant", content: "a2" }], { messageLimit: 1 });
  assert.deepEqual(value.messages, [{ role: "user", content: "u" }]);
});
await test("80. Limite de usuario uno", () => assert.equal(select([{ role: "user", content: "abc" }], { userMessageMaxChars: 1 }).transcript, "U: a"));
await test("81. Limite de asistente uno", () => assert.equal(select([{ role: "assistant", content: "abc" }], { assistantMessageMaxChars: 1 }).transcript, "A: a"));
await test("82. Todos los roles desconocidos", () => assert.deepEqual(select([{ role: "system", content: "x" }, { role: "tool", content: "y" }]).messages, []));
await test("83. Solo asistentes consecutivos", () => assert.deepEqual(select([{ role: "assistant", content: "a1" }, { role: "assistant", content: "a2" }]).messages.map((item) => item.content), ["a1", "a2"]));
await test("84. Solo usuarios consecutivos", () => assert.deepEqual(select([{ role: "user", content: "u1" }, { role: "user", content: "u2" }]).messages.map((item) => item.content), ["u1", "u2"]));
await test("85. Ultimo usuario vacio conserva ultimo usuario util", () => {
  const value = select([{ role: "user", content: "util" }, { role: "user", content: "   " }]);
  assert.deepEqual(value.messages, [{ role: "user", content: "util" }]);
  assert.equal(value.metrics.latestUserMessagePreserved, true);
});
await test("86. Ultimo usuario enorme se trunca", () => assert.equal(countUnicodeCharacters(select([{ role: "user", content: "z".repeat(10000) }]).messages[0].content), 600));
await test("87. Emojis conservan puntos de codigo", () => assert.equal(select([{ role: "user", content: "😀😀" }], { userMessageMaxChars: 1 }).messages[0].content, "😀"));
await test("88. Caracteres combinados tienen conteo documentado por punto de codigo", () => assert.equal(countUnicodeCharacters("a\u0301"), 2));
await test("89. Saltos CRLF se conservan y cuentan", () => {
  const value = select([{ role: "user", content: "a\r\nb" }]);
  assert.equal(value.messages[0].content, "a\r\nb");
  assert.equal(value.metrics.selectedMessageCharacterCount, 4);
});
await test("90. Contenido repetido en objetos distintos no se deduplica", () => assert.equal(select([{ role: "user", content: "igual" }, { role: "user", content: "igual" }]).messages.length, 2));
await test("91. uiAction circular no lanza", () => {
  const action = { type: "search_followup" }; action.self = action;
  assert.match(select([{ role: "assistant", content: "lista", uiAction: action }]).transcript, /mostrar mas/);
});
await test("92. Getter de uiAction no se ejecuta", () => {
  let invoked = false;
  const action = {};
  Object.defineProperty(action, "type", { get() { invoked = true; return "search_followup"; } });
  const value = select([{ role: "assistant", content: "normal", uiAction: action }]);
  assert.equal(invoked, false);
  assert.equal(value.messages[0].content, "normal");
});
await test("93. uiAction heredado no compacta", () => {
  const action = Object.create({ type: "search_followup" });
  assert.equal(select([{ role: "assistant", content: "normal", uiAction: action }]).messages[0].content, "normal");
});
await test("94. URL normal de usuario se conserva", () => assert.equal(select([{ role: "user", content: "https://usuario.example" }]).transcript.includes("https://usuario.example"), true));
await test("95. URL normal de asistente se conserva", () => assert.equal(select([{ role: "assistant", content: "https://blue.example" }]).transcript.includes("https://blue.example"), true));
await test("96. Contenido determinista sensible completo desaparece", () => {
  const sensitive = "https://privado.example/oferta/123 redirect_url UNIVERSIDAD SECRETA offerId=123 cursor=abc usuario@example.com https://otra.example";
  const transcript = select([{ role: "assistant", content: sensitive, uiAction: { type: "search_followup" } }]).transcript;
  assert.doesNotMatch(transcript, /privado|redirect_url|UNIVERSIDAD|offerId|cursor|usuario@|otra/);
});
await test("97. Conteo manual U Hola A Hola es exacto", () => {
  const value = select([{ role: "user", content: "Hola" }, { role: "assistant", content: "Hola" }]);
  assert.equal(value.metrics.originalMessageCharacterCount, 8);
  assert.equal(value.metrics.selectedMessageCharacterCount, 8);
  assert.equal(value.metrics.transcriptCharacterCount, 15);
  assert.equal(value.transcript, "U: Hola\nA: Hola");
});
await test("98. Resumen de espacios se omite", () => assert.equal(buildMemoryPrompt({ currentChatSummary: "   ", userMemorySummary: " ", transcript: "U: x" }).prompt, "RECENT:\nU: x"));
await test("99. Resumen de chat exactamente 500", () => assert.equal(countUnicodeCharacters(buildMemoryPrompt({ currentChatSummary: "x".repeat(500) }).currentChatSummary), 500));
await test("100. Resumen de chat con emojis no rompe Unicode", () => assert.equal(buildMemoryPrompt({ currentChatSummary: "😀".repeat(501) }).currentChatSummary, "😀".repeat(500)));
await test("101. Memoria exactamente 700", () => assert.equal(countUnicodeCharacters(buildMemoryPrompt({ userMemorySummary: "x".repeat(700) }).userMemorySummary), 700));
await test("102. Memoria con emojis no rompe Unicode", () => assert.equal(buildMemoryPrompt({ userMemorySummary: "😀".repeat(701) }).userMemorySummary, "😀".repeat(700)));
await test("103. Saltos de linea en resumen se conservan", () => assert.match(buildMemoryPrompt({ currentChatSummary: "linea 1\nlinea 2" }).prompt, /linea 1\nlinea 2/));
await test("104. Configuracion vacia no numerica negativa y cero usa fallback", () => {
  for (const value of ["", "abc", "-1", "0"]) {
    process.env.TEST_POSITIVE = value;
    assert.equal(env.positiveInteger("TEST_POSITIVE", 8), 8);
  }
  delete process.env.TEST_POSITIVE;
});
await test("105. Evento tiene propiedades y tipos exactos", async () => {
  const harness = createScenarioHarness([{ text: '{"chatSummary":"Chat"}' }]);
  await harness.generator({ messages: [{ role: "user", content: "x" }] });
  const event = harness.calls.contexts[0];
  const expected = ["event", "requestType", "model", "originalMessageCount", "selectedMessageCount", "originalMessageCharacterCount", "selectedMessageCharacterCount", "droppedMessageCount", "truncatedMessageCount", "compactedDeterministicMessageCount", "transcriptCharacterBudget", "transcriptCharacterCount", "latestUserMessagePreserved", "currentChatSummaryCharacterCount", "userMemoryCharacterCount", "promptCharacterCount", "includedCurrentChatSummary", "includedUserMemory"].sort();
  assert.deepEqual(Object.keys(event).sort(), expected);
  for (const [key, value] of Object.entries(event)) {
    if (["event", "requestType", "model"].includes(key)) assert.equal(typeof value, "string");
    else if (key.startsWith("included") || key === "latestUserMessagePreserved") assert.equal(typeof value, "boolean");
    else assert.equal(Number.isFinite(value) && value >= 0, true);
  }
});
await test("106. Rotacion recuperable registra un solo contexto", async () => {
  const harness = createScenarioHarness([{ error: new Error("429 rate limit") }, { text: '{"chatSummary":"Chat"}' }]);
  await harness.generator({ messages: [{ role: "user", content: "x" }] });
  assert.deepEqual(harness.calls.order, ["context", "client", "attempt", "client", "usage", "result"]);
  assert.equal(harness.calls.contexts.length, 1);
});
await test("107. Error no recuperable conserva orden", async () => {
  const harness = createScenarioHarness([{ error: new Error("invalid request") }, { text: '{"chatSummary":"no"}' }]);
  await harness.generator({ messages: [{ role: "user", content: "x" }] });
  assert.deepEqual(harness.calls.order, ["context", "client", "attempt", "result"]);
  assert.equal(harness.calls.clients, 1);
});
await test("108. JSON invalido conserva orden", async () => {
  const harness = createScenarioHarness([{ text: "no-json" }]);
  await harness.generator({ messages: [{ role: "user", content: "x" }] });
  assert.deepEqual(harness.calls.order, ["context", "client", "usage", "result"]);
});
await test("109. Respuesta vacia conserva orden", async () => {
  const harness = createScenarioHarness([{ text: "" }]);
  const result = await harness.generator({ messages: [{ role: "user", content: "x" }] });
  assert.equal(result.reason, "empty_response");
  assert.deepEqual(harness.calls.order, ["context", "client", "usage", "result"]);
});
await test("110. Excepcion response text conserva orden", async () => {
  const harness = createScenarioHarness([{ textError: new Error("synthetic text error") }]);
  const result = await harness.generator({ messages: [{ role: "user", content: "x" }] });
  assert.equal(result.reason, "generation_error");
  assert.deepEqual(harness.calls.order, ["context", "client", "usage", "result"]);
});
await test("111. Evento usa modelName inyectado", async () => {
  const harness = createScenarioHarness([{ text: '{"chatSummary":"Chat"}' }], "fake-model-name");
  await harness.generator({ messages: [{ role: "user", content: "x" }] });
  assert.equal(harness.calls.contexts[0].model, "fake-model-name");
});
await test("112. Contexto vacio no llama cliente", async () => {
  const harness = createScenarioHarness([]);
  const result = await harness.generator({ messages: [] });
  assert.equal(result.reason, "empty_summary");
  assert.deepEqual(harness.calls.order, ["context", "result"]);
});
await test("113. Higiene de archivos nuevos", () => {
  for (const relativePath of ["backend/src/services/memoryContextService.js", "backend/scripts/testMemoryContextOptimization.js"]) {
    const buffer = readFileSync(resolve(root, relativePath));
    const text = buffer.toString("utf8");
    assert.equal(buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false);
    assert.equal(text.endsWith("\n"), true);
    assert.equal(text.endsWith("\n\n"), false);
    assert.doesNotMatch(text, /[ \t]+$/m);
    assert.doesNotMatch(text, /\t/);
  }
});

function comparisonCase(name, source, currentChatSummary, userMemorySummary) {
  const oldPrompt = buildOldPrompt({ messages: source, currentChatSummary, userMemorySummary });
  const optimized = buildMemoryRequestContext({ messages: source, currentChatSummary, userMemorySummary, model: env.GEMINI_MEMORY_MODEL });
  const oldCharacters = countUnicodeCharacters(oldPrompt);
  const newCharacters = countUnicodeCharacters(optimized.prompt);
  return {
    name,
    previous: { messageCount: Math.min(source.length, 12), promptCharacterCount: oldCharacters },
    optimized: { ...optimized.metrics, prompt: optimized.prompt },
    characterReductionPercentage: Number((((oldCharacters - newCharacters) / oldCharacters) * 100).toFixed(2)),
  };
}

const caseA = messages(8, 180).map((item, index) => ({ ...item, content: `${item.content} preferencia sintetica ${index}` }));
const caseB = [
  { role: "user", content: "Me interesa resolver problemas con tecnologia." },
  { role: "assistant", content: "Institucion Ficticia Uno https://ficticia-a.example/oferta/101", uiAction: { type: "search_followup", id: "offer-101" } },
  { role: "user", content: "Prefiero actividades practicas y proyectos." },
  { role: "assistant", content: "Institucion Ficticia Dos https://ficticia-b.example/oferta/202", uiAction: { type: "career_confirmation", id: "offer-202" } },
  { role: "user", content: "Tambien disfruto explicar ideas a otras personas." },
  { role: "assistant", content: "Institucion Ficticia Tres https://ficticia-c.example/oferta/303", uiAction: { type: "search_exhausted", id: "offer-303" } },
  { role: "user", content: "Quiero equilibrar creatividad y analisis." },
  { role: "assistant", content: "Podemos explorar que tipo de proyectos te hacen perder la nocion del tiempo." },
];
const caseC = messages(12, 2200).map((item, index) => ({
  ...item,
  content: `${item.content} 😀 https://ficticia-${index}.example/oferta/${index}`,
  ...(item.role === "assistant" ? { uiAction: { type: index % 4 === 1 ? "search_followup" : "unknown", id: `offer-${index}` } } : {}),
}));
const comparisons = [
  comparisonCase("Caso A", caseA, "Resumen sintetico del chat ".repeat(15), "Memoria sintetica global ".repeat(20)),
  comparisonCase("Caso B", caseB, "La conversacion explora preferencias practicas y creativas.", "La persona valora tecnologia, proyectos y comunicacion."),
  comparisonCase("Caso C", caseC, "Resumen 😀 ".repeat(100), "Memoria 😀 ".repeat(120)),
];

mkdirSync(reportDirectory, { recursive: true });
writeFileSync(resolve(reportDirectory, "test-results.json"), JSON.stringify({ total: results.length, passed: results.filter((item) => item.status === "PASS").length, failed: results.filter((item) => item.status === "FAIL").length, results }, null, 2));
writeFileSync(resolve(reportDirectory, "context-comparison.json"), JSON.stringify({ measurement: "characters_not_tokens", cases: comparisons }, null, 2));
writeFileSync(resolve(reportDirectory, "context-comparison.md"), [
  "# Comparacion reproducible del contexto de memoria",
  "",
  "Datos completamente sinteticos. Las reducciones son de caracteres, no de tokens.",
  "",
  ...comparisons.flatMap((item) => [
    `## ${item.name}`,
    "",
    `- Prompt anterior: ${item.previous.promptCharacterCount} caracteres`,
    `- Prompt optimizado: ${item.optimized.promptCharacterCount} caracteres`,
    `- Mensajes anteriores/seleccionados: ${item.previous.messageCount}/${item.optimized.selectedMessageCount}`,
    `- Reduccion de caracteres: ${item.characterReductionPercentage}%`,
    `- Ultimo usuario preservado: ${item.optimized.latestUserMessagePreserved}`,
    "",
  ]),
].join("\n"));

for (const result of results) console.log(`${result.status} ${result.name}${result.error ? `: ${result.error}` : ""}`);
const passed = results.filter((item) => item.status === "PASS").length;
const failed = results.length - passed;
console.log(`Memory context optimization: ${passed}/${results.length} PASS, ${failed} FAIL`);
if (failed) process.exitCode = 1;

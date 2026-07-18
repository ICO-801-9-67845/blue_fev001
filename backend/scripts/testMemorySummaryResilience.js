import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ||= "mysql://test:test@127.0.0.1:3306/test";
process.env.JWT_SECRET ||= "memory-resilience-test";
process.env.GEMINI_API_KEYS ||= "not-a-real-key";

const {
  MEMORY_SUMMARY_FAILURE_REASONS,
  buildMemorySummaryResult,
  createMemorySummaryGenerator,
  createMemorySummaryResultLog,
  normalizeMemoryFinishReason,
  parseMemorySummaryResponse,
  validateMemorySummaryPayload,
} = await import("../src/services/aiService.js");
const {
  MEMORY_REFRESH_FLOWS,
  createMemoryRefreshService,
  createMemorySummaryPersistence,
} = await import("../src/services/memoryRefreshService.js");
const { GEMINI_MEMORY_EVERY_USER_MESSAGES } = await import("../src/config/env.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportPath = resolve(__dirname, "../../tmp/ai-memory-summary-resilience/test-results.json");
const results = [];
const simulation = {};

async function test(name, run) {
  try {
    await run();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
  }
}

function validResult(chatSummary = "Chat", userMemorySummary = "Usuario") {
  return {
    ok: true,
    summaries: { chatSummary, userMemorySummary },
    reason: "valid_summary",
    metadata: { finishReason: "STOP", responseCharacterCount: 50 },
  };
}

function failureResult(reason) {
  return {
    ok: false,
    summaries: null,
    reason,
    metadata: { finishReason: "STOP", responseCharacterCount: 10 },
  };
}

function createCadenceHarness({
  eligible = 0,
  summarized = 0,
  cadence = 4,
  generate = async () => validResult(),
  persist = async () => {},
} = {}) {
  const state = { eligible, summarized };
  const calls = { generation: 0, persistence: 0, rollback: 0 };
  const logs = [];
  const service = createMemoryRefreshService({
    cadence,
    async incrementEligibleTurn() {
      state.eligible += 1;
      return {
        memoryEligibleTurnCount: state.eligible,
        memorySummarizedTurnCount: state.summarized,
      };
    },
    async claimRefresh(_chatId, previousCount, claimedCount) {
      if (state.summarized !== previousCount) return false;
      state.summarized = claimedCount;
      return true;
    },
    async rollbackRefresh(_chatId, claimedCount, previousCount) {
      calls.rollback += 1;
      if (state.summarized !== claimedCount) return false;
      state.summarized = previousCount;
      return true;
    },
    async generateSummaries() {
      calls.generation += 1;
      return generate(calls.generation);
    },
    async persistSummaries(params) {
      calls.persistence += 1;
      return persist(params);
    },
    writeLog(entry) {
      logs.push(entry);
    },
  });

  return {
    state,
    calls,
    logs,
    run() {
      return service({
        flow: MEMORY_REFRESH_FLOWS.CONVERSATION,
        chatId: "test-chat",
        userId: "test-user",
        messages: [{ role: "user", content: "test" }],
      });
    },
  };
}

function createFakePrisma({ failChat = false, failUserMemory = false } = {}) {
  const state = { chatSummary: "old-chat", userMemorySummary: "old-user" };
  const calls = { transactions: 0, chat: 0, userMemory: 0, operations: [] };
  const transactionClient = {
    chat: {
      async update(args) {
        calls.chat += 1;
        calls.operations.push({ type: "chat", args });
        if (failChat) throw new Error("simulated chat failure");
        state.chatSummary = args.data.summary;
      },
    },
    userMemory: {
      async upsert(args) {
        calls.userMemory += 1;
        calls.operations.push({ type: "userMemory", args });
        if (failUserMemory) throw new Error("simulated persistence failure");
        state.userMemorySummary = args.update.summary;
      },
    },
  };

  return {
    state,
    calls,
    client: {
      chat: transactionClient.chat,
      userMemory: transactionClient.userMemory,
      async $transaction(run) {
        calls.transactions += 1;
        const snapshot = { ...state };
        try {
          return await run(transactionClient);
        } catch (error) {
          Object.assign(state, snapshot);
          throw error;
        }
      },
    },
  };
}

function createGeneratorHarness(steps) {
  let callIndex = 0;
  const calls = { keys: [], usage: [], results: [], attempts: [], order: [] };
  const apiKeys = steps.map((_, index) => `fake-key-${index}`);
  const generator = createMemorySummaryGenerator({
    apiKeys,
    createClient(apiKey) {
      return {
        getGenerativeModel() {
          return {
            async generateContent() {
              calls.keys.push(apiKey);
              const step = steps[callIndex];
              callIndex += 1;
              if (step.error) throw step.error;
              return {
                response: {
                  usageMetadata: { promptTokenCount: 10, totalTokenCount: 20 },
                  candidates: step.candidates === undefined
                    ? [{ finishReason: step.finishReason || "STOP" }]
                    : step.candidates,
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
    writeUsage(...args) {
      calls.order.push("usage");
      calls.usage.push(args);
    },
    writeResult(entry) {
      calls.order.push("result");
      calls.results.push(entry);
    },
    writeAttempt(entry) {
      calls.order.push("attempt");
      calls.attempts.push(entry);
    },
  });
  return { calls, generator };
}

const parserCases = [
  ["1. JSON valido con ambos resumenes", '{"chatSummary":"Chat","userMemorySummary":"Usuario"}', true],
  ["2. JSON valido solo con chatSummary", '{"chatSummary":"Chat"}', true],
  ["3. JSON valido solo con userMemorySummary", '{"userMemorySummary":"Usuario"}', true],
  ["4. JSON dentro de bloque markdown", '```json\n{"chatSummary":"Chat"}\n```', true],
  ["5. Texto controlado alrededor de JSON", 'Resultado: {"chatSummary":"Llave { segura }"} fin.', true],
  ["6. JSON invalido", "no-json", "invalid_json"],
  ["7. JSON truncado", '{"chatSummary":"Chat"', "invalid_json"],
  ["8. Respuesta vacia", "  ", "empty_response"],
  ["9. Objeto vacio", "{}", "empty_summary"],
  ["10. Campos null", '{"chatSummary":null}', "invalid_schema"],
  ["11. Campos numericos", '{"chatSummary":42}', "invalid_schema"],
  ["12. Campos objeto", '{"chatSummary":{"text":"x"}}', "invalid_schema"],
  ["13. Campos arreglo", '{"userMemorySummary":[]}', "invalid_schema"],
  ["14. Ambos strings vacios", '{"chatSummary":" ","userMemorySummary":""}', "empty_summary"],
];

for (const [name, input, expected] of parserCases) {
  await test(name, () => {
    const result = parseMemorySummaryResponse(input);
    if (expected === true) assert.equal(result.ok, true);
    else assert.equal(result.reason, expected);
  });
}

await test("15. Limites 700 y 1000", () => {
  const result = parseMemorySummaryResponse(JSON.stringify({
    chatSummary: "a".repeat(705),
    userMemorySummary: "b".repeat(1005),
  }));
  assert.equal(result.summaries.chatSummary.length, 700);
  assert.equal(result.summaries.userMemorySummary.length, 1000);
});

await test("16. Inmutabilidad", () => {
  const input = '{"chatSummary":"Chat"}';
  parseMemorySummaryResponse(input);
  assert.equal(input, '{"chatSummary":"Chat"}');
});

await test("17. Log de exito sin contenido", () => {
  const log = createMemorySummaryResultLog(validResult("SECRET_A", "SECRET_B"));
  assert.equal(log.outcome, "success");
  assert.doesNotMatch(JSON.stringify(log), /SECRET_A|SECRET_B/);
});

await test("18. Log invalid_json sin contenido", () => {
  const log = createMemorySummaryResultLog(failureResult("invalid_json"));
  assert.equal(log.reason, "invalid_json");
  assert.equal(log.hasChatSummary, false);
});

await test("19. Log empty_summary sin contenido", () => {
  assert.equal(
    createMemorySummaryResultLog(failureResult("empty_summary")).reason,
    "empty_summary",
  );
});

await test("20. finishReason seguro", () => {
  assert.equal(normalizeMemoryFinishReason("STOP secret text!"), "STOPsecrettext");
  assert.equal(normalizeMemoryFinishReason(null), "UNKNOWN");
});

await test("21. responseCharacterCount correcto", () => {
  const text = '{"chatSummary":"Chat"}';
  const result = buildMemorySummaryResult(text, "STOP");
  assert.equal(result.metadata.responseCharacterCount, text.length);
  assert.equal(result.metadata.finishReason, "STOP");
});

await test("22. Fallo en turno 8 no reintenta en turno 9", async () => {
  const harness = createCadenceHarness({
    eligible: 7,
    summarized: 4,
    generate: async () => failureResult("invalid_json"),
  });
  assert.equal((await harness.run()).action, "defer");
  assert.equal((await harness.run()).action, "skip");
  assert.equal(harness.calls.generation, 1);
});

await test("23. Fallo en turno 8 no reintenta en 10 y 11", async () => {
  const harness = createCadenceHarness({
    eligible: 7,
    summarized: 4,
    generate: async () => failureResult("empty_summary"),
  });
  for (let index = 0; index < 4; index += 1) await harness.run();
  assert.equal(harness.state.eligible, 11);
  assert.equal(harness.calls.generation, 1);
});

await test("24. Nuevo intento en turno 12", async () => {
  const harness = createCadenceHarness({
    eligible: 7,
    summarized: 4,
    generate: async (attempt) => attempt === 1
      ? failureResult("empty_response")
      : validResult(),
  });
  for (let index = 0; index < 5; index += 1) await harness.run();
  assert.equal(harness.calls.generation, 2);
  assert.equal(harness.calls.persistence, 1);
});

await test("25. Exito mantiene cadencia normal", async () => {
  const harness = createCadenceHarness();
  for (let index = 0; index < 8; index += 1) await harness.run();
  assert.equal(harness.calls.generation, 2);
  assert.equal(harness.state.summarized, 8);
});

await test("26. Concurrencia mantiene una sola llamada", async () => {
  let eligible = 3;
  let summarized = 0;
  let generationCalls = 0;
  const service = createMemoryRefreshService({
    cadence: 4,
    async incrementEligibleTurn() {
      eligible += 1;
      return { memoryEligibleTurnCount: eligible, memorySummarizedTurnCount: summarized };
    },
    async claimRefresh(_id, previous, claimed) {
      await Promise.resolve();
      if (summarized !== previous) return false;
      summarized = claimed;
      return true;
    },
    async rollbackRefresh() { return false; },
    async generateSummaries() { generationCalls += 1; return validResult(); },
    async persistSummaries() {},
    writeLog() {},
  });
  const params = {
    flow: MEMORY_REFRESH_FLOWS.CONVERSATION,
    chatId: "test",
    userId: "test",
    messages: [],
  };
  await Promise.all(Array.from({ length: 20 }, () => service(params)));
  assert.equal(generationCalls, 1);
});

await test("27. Fallo no produce tormenta de llamadas", async () => {
  const harness = createCadenceHarness({
    generate: async () => failureResult("generation_error"),
  });
  for (let index = 0; index < 20; index += 1) await harness.run();
  assert.equal(harness.calls.generation, 5);
  assert.equal(harness.calls.rollback, 0);
});

await test("28. Ambos resumenes se guardan atomicamente", async () => {
  const fake = createFakePrisma();
  const persist = createMemorySummaryPersistence(fake.client);
  await persist({ chatId: "chat", userId: "user", summaries: {
    chatSummary: "new-chat",
    userMemorySummary: "new-user",
  }});
  assert.equal(fake.calls.transactions, 1);
  assert.equal(fake.state.chatSummary, "new-chat");
  assert.equal(fake.state.userMemorySummary, "new-user");
});

await test("29. Error de persistencia no deja guardado parcial", async () => {
  const fake = createFakePrisma({ failUserMemory: true });
  const persist = createMemorySummaryPersistence(fake.client);
  await assert.rejects(persist({ chatId: "chat", userId: "user", summaries: {
    chatSummary: "new-chat",
    userMemorySummary: "new-user",
  }}));
  assert.deepEqual(fake.state, { chatSummary: "old-chat", userMemorySummary: "old-user" });
});

await test("30. Solo chatSummary se puede guardar", async () => {
  const fake = createFakePrisma();
  await createMemorySummaryPersistence(fake.client)({
    chatId: "chat",
    userId: "user",
    summaries: { chatSummary: "new-chat", userMemorySummary: "" },
  });
  assert.equal(fake.calls.transactions, 0);
  assert.equal(fake.state.chatSummary, "new-chat");
});

await test("31. Solo userMemorySummary se puede guardar", async () => {
  const fake = createFakePrisma();
  await createMemorySummaryPersistence(fake.client)({
    chatId: "chat",
    userId: "user",
    summaries: { chatSummary: "", userMemorySummary: "new-user" },
  });
  assert.equal(fake.calls.transactions, 0);
  assert.equal(fake.state.userMemorySummary, "new-user");
});

const aiSource = readFileSync(resolve(__dirname, "../src/services/aiService.js"), "utf8");
const memorySource = readFileSync(resolve(__dirname, "../src/services/memoryRefreshService.js"), "utf8");

await test("32. Cadencia sigue siendo 4", () => {
  assert.equal(GEMINI_MEMORY_EVERY_USER_MESSAGES, 4);
});

await test("33. Ventana de memoria sigue siendo 12", () => {
  assert.match(aiSource, /messages\.slice\(-12\)/);
});

await test("34. Rotacion de claves continua", () => {
  assert.match(aiSource, /index < GEMINI_API_KEYS\.length/);
  assert.match(aiSource, /isRecoverableGeminiError/);
});

await test("35. gemini_usage permanece", () => {
  assert.match(aiSource, /event: "gemini_usage"/);
  assert.match(aiSource, /logGeminiUsage\("memory", GEMINI_MEMORY_MODEL/);
});

await test("36. No se filtra contenido en logs", () => {
  const log = createMemorySummaryResultLog(validResult("private-a", "private-b"));
  assert.deepEqual(Object.keys(log).sort(), [
    "event", "finishReason", "hasChatSummary", "hasUserMemorySummary",
    "model", "outcome", "reason", "responseCharacterCount",
  ]);
  assert.doesNotMatch(JSON.stringify(log), /private-a|private-b|chatId|userId|apiKey/);
});

await test("37. Codigos de fallo cerrados", async () => {
  for (const reason of Object.values(MEMORY_SUMMARY_FAILURE_REASONS)) {
    const harness = createCadenceHarness({
      eligible: 3,
      generate: async () => failureResult(reason),
    });
    assert.equal((await harness.run()).reason, reason);
  }
});

await test("38. Watermark del intervalo documentado", () => {
  assert.match(memorySource, /durable watermark for this processed interval/);
});

await test("39. Sin timers ni mapas locales", () => {
  assert.doesNotMatch(memorySource, /setTimeout|setInterval|new Map\s*\(/);
});

await test("40. Simulacion de 20 turnos", async () => {
  let latestAttempt = 0;
  const harness = createCadenceHarness({
    generate: async (attempt) => {
      latestAttempt = attempt;
      return attempt === 2 ? failureResult("invalid_json") : validResult();
    },
    persist: async () => {
      if (latestAttempt === 4) throw new Error("simulated persistence failure");
    },
  });
  const turns = [];
  for (let turn = 1; turn <= 20; turn += 1) {
    const generationBefore = harness.calls.generation;
    const outcome = await harness.run();
    turns.push({
      turn,
      eligible: harness.state.eligible,
      watermark: harness.state.summarized,
      decision: outcome.action,
      generationCalled: harness.calls.generation > generationBefore,
      result: outcome.reason,
    });
  }
  simulation.eligibleTurns = 20;
  simulation.generationAttempts = harness.calls.generation;
  simulation.failedIntervals = 2;
  simulation.rollbacks = harness.calls.rollback;
  simulation.deferCount = turns.filter((item) => item.decision === "defer").length;
  simulation.turns = turns;
  assert.equal(harness.calls.generation, 5);
  assert.equal(harness.calls.rollback, 0);
  assert.equal(simulation.deferCount, 2);
  assert.equal(harness.state.summarized, 20);
  assert.deepEqual(
    turns.filter((item) => item.generationCalled).map((item) => item.turn),
    [4, 8, 12, 16, 20],
  );
  assert.equal(turns[7].result, "invalid_json");
  assert.equal(turns[15].result, "persistence_failed");
});

await test("41. Fallo sin mensajes conserva forma cerrada", async () => {
  const harness = createGeneratorHarness([]);
  const result = await harness.generator();
  assert.deepEqual(Object.keys(result).sort(), ["metadata", "ok", "reason", "summaries"]);
  assert.equal(result.ok, false);
  assert.equal(result.summaries, null);
  assert.equal(result.reason, "empty_summary");
  assert.equal(harness.calls.results.length, 1);
});

await test("42. Exito del generador conserva forma cerrada", async () => {
  const harness = createGeneratorHarness([{
    text: '{"chatSummary":"Chat","userMemorySummary":"Usuario"}',
  }]);
  const result = await harness.generator({ messages: [{ role: "user", content: "x" }] });
  assert.deepEqual(Object.keys(result).sort(), ["metadata", "ok", "reason", "summaries"]);
  assert.equal(result.ok, true);
  assert.equal(result.reason, "valid_summary");
  assert.equal(typeof result.summaries.chatSummary, "string");
});

await test("43. Todos los fallos del parser tienen summaries null", () => {
  const inputs = ["bad", "", "{}", "[]", '{"chatSummary":1}'];
  for (const input of inputs) {
    const result = parseMemorySummaryResponse(input);
    assert.equal(result.ok, false);
    assert.equal(result.summaries, null);
    assert.ok(Object.values(MEMORY_SUMMARY_FAILURE_REASONS).includes(result.reason));
  }
});

await test("44. Llave de cierre dentro de string", () => {
  const result = parseMemorySummaryResponse(
    'antes {"chatSummary":"programar } es util"} despues',
  );
  assert.equal(result.summaries.chatSummary, "programar } es util");
});

await test("45. Comillas escapadas dentro de string", () => {
  const text = `antes ${JSON.stringify({ chatSummary: 'Me dijo "hola"' })} despues`;
  assert.equal(parseMemorySummaryResponse(text).summaries.chatSummary, 'Me dijo "hola"');
});

await test("46. Barras invertidas escapadas", () => {
  const text = JSON.stringify({ chatSummary: "C:\\ruta\\archivo" });
  assert.equal(parseMemorySummaryResponse(text).summaries.chatSummary, "C:\\ruta\\archivo");
});

await test("47. Saltos de linea escapados", () => {
  const text = JSON.stringify({ chatSummary: "linea uno\nlinea dos" });
  assert.equal(parseMemorySummaryResponse(text).summaries.chatSummary, "linea uno\nlinea dos");
});

await test("48. Dos objetos consecutivos usan solo el primero", () => {
  const result = parseMemorySummaryResponse(
    '{"chatSummary":"primero"}{"chatSummary":"segundo"}',
  );
  assert.equal(result.summaries.chatSummary, "primero");
});

await test("49. Bloque Markdown sin etiqueta json", () => {
  const result = parseMemorySummaryResponse('```\n{"chatSummary":"Chat"}\n```');
  assert.equal(result.ok, true);
});

await test("50. Bloque Markdown sin cierre es invalido", () => {
  const result = parseMemorySummaryResponse('```json\n{"chatSummary":"Chat"}');
  assert.equal(result.reason, "invalid_json");
});

await test("51. Arreglo como raiz es esquema invalido", () => {
  assert.equal(parseMemorySummaryResponse("[]").reason, "invalid_schema");
});

await test("52. Null como raiz es esquema invalido", () => {
  assert.equal(parseMemorySummaryResponse("null").reason, "invalid_schema");
});

await test("53. String como raiz es esquema invalido", () => {
  assert.equal(parseMemorySummaryResponse('"texto"').reason, "invalid_schema");
});

await test("54. Prototipo inesperado es rechazado", () => {
  const payload = Object.create({ inherited: true });
  payload.chatSummary = "Chat";
  assert.equal(validateMemorySummaryPayload(payload).reason, "invalid_schema");
});

await test("55. Claves extra provocan invalid_schema", () => {
  assert.equal(validateMemorySummaryPayload({ chatSummary: "Chat", extra: "x" }).reason, "invalid_schema");
});

await test("56. Campos heredados son rechazados", () => {
  const payload = Object.create({ chatSummary: "heredado" });
  assert.equal(validateMemorySummaryPayload(payload).reason, "invalid_schema");
});

await test("57. Getter es rechazado sin ejecutarse", () => {
  let invoked = false;
  const payload = {};
  Object.defineProperty(payload, "chatSummary", {
    enumerable: true,
    get() { invoked = true; return "secreto"; },
  });
  assert.equal(validateMemorySummaryPayload(payload).reason, "invalid_schema");
  assert.equal(invoked, false);
});

await test("58. Entrada extremadamente larga se procesa linealmente", () => {
  const text = `prefijo ${JSON.stringify({ chatSummary: "x".repeat(200000) })} sufijo`;
  const result = parseMemorySummaryResponse(text);
  assert.equal(result.ok, true);
  assert.equal(result.summaries.chatSummary.length, 700);
});

await test("59. Campo undefined es rechazado", () => {
  assert.equal(validateMemorySummaryPayload({ chatSummary: undefined }).reason, "invalid_schema");
});

await test("60. Campo boolean es rechazado", () => {
  assert.equal(validateMemorySummaryPayload({ chatSummary: true }).reason, "invalid_schema");
});

await test("61. Campo funcion es rechazado", () => {
  assert.equal(validateMemorySummaryPayload({ chatSummary() {} }).reason, "invalid_schema");
});

await test("62. Instancia de clase es rechazada", () => {
  class Payload { constructor() { this.chatSummary = "Chat"; } }
  assert.equal(validateMemorySummaryPayload(new Payload()).reason, "invalid_schema");
});

await test("63. Date es rechazado", () => {
  assert.equal(validateMemorySummaryPayload(new Date()).reason, "invalid_schema");
});

await test("64. String object es rechazado", () => {
  assert.equal(validateMemorySummaryPayload({ chatSummary: new String("Chat") }).reason, "invalid_schema");
});

await test("65. Truncado Unicode no rompe pares sustitutos", () => {
  const result = validateMemorySummaryPayload({ chatSummary: "😀".repeat(701) });
  assert.equal(Array.from(result.summaries.chatSummary).length, 700);
  assert.equal(result.summaries.chatSummary.endsWith("😀"), true);
});

await test("66. Finish reasons conocidos permanecen controlados", () => {
  for (const reason of ["STOP", "MAX_TOKENS", "SAFETY"]) {
    assert.equal(normalizeMemoryFinishReason(reason), reason);
  }
});

await test("67. Finish reason ausente o inesperado usa UNKNOWN", () => {
  for (const value of [undefined, null, 1, {}, []]) {
    assert.equal(normalizeMemoryFinishReason(value), "UNKNOWN");
  }
});

await test("68. Error crudo sensible no aparece en logs", async () => {
  const sensitive = "DATABASE_URL=mysql://secret usuario@example.com https://sitio-privado.example";
  const harness = createGeneratorHarness([{ error: new Error(sensitive) }]);
  const result = await harness.generator({ messages: [{ role: "user", content: "x" }] });
  const logs = JSON.stringify({ attempts: harness.calls.attempts, results: harness.calls.results });
  assert.equal(result.reason, "generation_error");
  assert.doesNotMatch(logs, /mysql:\/\/secret|usuario@example\.com|sitio-privado/);
});

await test("69. Error recuperable rota y la siguiente clave tiene exito", async () => {
  const harness = createGeneratorHarness([
    { error: new Error("quota exceeded") },
    { text: '{"chatSummary":"Chat"}' },
  ]);
  const result = await harness.generator({ messages: [{ role: "user", content: "x" }] });
  assert.equal(result.ok, true);
  assert.equal(harness.calls.keys.length, 2);
  assert.equal(harness.calls.results.length, 1);
});

await test("70. Todas las claves recuperables terminan en generation_error", async () => {
  const harness = createGeneratorHarness([
    { error: new Error("429 rate limit") },
    { error: new Error("503 unavailable") },
  ]);
  const result = await harness.generator({ messages: [{ role: "user", content: "x" }] });
  assert.equal(result.reason, "generation_error");
  assert.equal(harness.calls.keys.length, 2);
  assert.equal(harness.calls.results.length, 1);
});

await test("71. Error no recuperable detiene la rotacion", async () => {
  const harness = createGeneratorHarness([
    { error: new Error("invalid request") },
    { text: '{"chatSummary":"no debe llamarse"}' },
  ]);
  const result = await harness.generator({ messages: [{ role: "user", content: "x" }] });
  assert.equal(result.reason, "generation_error");
  assert.equal(harness.calls.keys.length, 1);
});

for (const [number, name, text, reason] of [
  [72, "JSON invalido no consume otra clave", "not-json", "invalid_json"],
  [73, "empty_summary no consume otra clave", "{}", "empty_summary"],
  [74, "invalid_schema no consume otra clave", '{"chatSummary":1}', "invalid_schema"],
]) {
  await test(`${number}. ${name}`, async () => {
    const harness = createGeneratorHarness([{ text }, { text: '{"chatSummary":"otra"}' }]);
    const result = await harness.generator({ messages: [{ role: "user", content: "x" }] });
    assert.equal(result.reason, reason);
    assert.equal(harness.calls.keys.length, 1);
    assert.equal(harness.calls.results.length, 1);
  });
}

await test("75. Orden de eventos es usage antes de result", async () => {
  const harness = createGeneratorHarness([{ text: '{"chatSummary":"Chat"}' }]);
  await harness.generator({ messages: [{ role: "user", content: "x" }] });
  assert.deepEqual(harness.calls.order, ["usage", "result"]);
});

await test("76. MAX_TOKENS con JSON truncado es invalid_json", async () => {
  const harness = createGeneratorHarness([
    { finishReason: "MAX_TOKENS", text: '{"chatSummary":"truncado"' },
    { text: '{"chatSummary":"otra"}' },
  ]);
  const result = await harness.generator({ messages: [{ role: "user", content: "x" }] });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_json");
  assert.equal(result.metadata.finishReason, "MAX_TOKENS");
  assert.equal(harness.calls.keys.length, 1);
});

await test("77. Ningun resumen produce cero escrituras", async () => {
  const fake = createFakePrisma();
  const input = { chatSummary: "", userMemorySummary: "" };
  const result = await createMemorySummaryPersistence(fake.client)({ chatId: "chat", userId: "user", summaries: input });
  assert.deepEqual(result, { written: false });
  assert.equal(fake.calls.chat + fake.calls.userMemory + fake.calls.transactions, 0);
});

await test("78. Fallo de la primera operacion revierte sin segunda escritura", async () => {
  const fake = createFakePrisma({ failChat: true });
  await assert.rejects(createMemorySummaryPersistence(fake.client)({
    chatId: "chat", userId: "user",
    summaries: { chatSummary: "new-chat", userMemorySummary: "new-user" },
  }));
  assert.deepEqual(fake.state, { chatSummary: "old-chat", userMemorySummary: "old-user" });
  assert.equal(fake.calls.userMemory, 0);
});

await test("79. Persistencia no muta summaries", async () => {
  const fake = createFakePrisma();
  const summaries = { chatSummary: "new-chat", userMemorySummary: "new-user" };
  const snapshot = structuredClone(summaries);
  await createMemorySummaryPersistence(fake.client)({ chatId: "chat", userId: "user", summaries });
  assert.deepEqual(summaries, snapshot);
});

await test("80. Chat y usuario no invierten argumentos", async () => {
  const fake = createFakePrisma();
  await createMemorySummaryPersistence(fake.client)({
    chatId: "CHAT-ID-UNICO", userId: "USER-ID-UNICO",
    summaries: { chatSummary: "CHAT-SUMMARY-UNICO", userMemorySummary: "USER-SUMMARY-UNICO" },
  });
  assert.equal(fake.calls.operations[0].args.where.id, "CHAT-ID-UNICO");
  assert.equal(fake.calls.operations[0].args.data.summary, "CHAT-SUMMARY-UNICO");
  assert.equal(fake.calls.operations[1].args.where.userId, "USER-ID-UNICO");
  assert.equal(fake.calls.operations[1].args.update.summary, "USER-SUMMARY-UNICO");
});

await test("81. Objeto legado se difiere como invalid_schema", async () => {
  const harness = createCadenceHarness({
    eligible: 3,
    generate: async () => ({ chatSummary: "legado", userMemorySummary: "legado" }),
  });
  const result = await harness.run();
  assert.equal(result.action, "defer");
  assert.equal(result.reason, "invalid_schema");
});

await test("82. Secuencia exacta de turnos 8 a 12", async () => {
  const harness = createCadenceHarness({
    eligible: 7, summarized: 4,
    generate: async (attempt) => attempt === 1 ? failureResult("invalid_json") : validResult(),
  });
  const sequence = [];
  for (let turn = 8; turn <= 12; turn += 1) {
    const before = harness.calls.generation;
    const result = await harness.run();
    sequence.push({
      turn, eligible: harness.state.eligible, watermark: harness.state.summarized,
      decision: result.action, generationCalled: harness.calls.generation > before,
      result: result.reason,
    });
  }
  simulation.turns8to12 = sequence;
  assert.deepEqual(sequence.map((item) => item.watermark), [8, 8, 8, 8, 12]);
  assert.deepEqual(sequence.map((item) => item.generationCalled), [true, false, false, false, true]);
  assert.equal(harness.calls.rollback, 0);
});

await test("83. Proceso que pierde claim no genera memoria", async () => {
  let generationCalls = 0;
  const service = createMemoryRefreshService({
    cadence: 4,
    async incrementEligibleTurn() { return { memoryEligibleTurnCount: 8, memorySummarizedTurnCount: 4 }; },
    async claimRefresh() { return false; },
    async rollbackRefresh() { return false; },
    async generateSummaries() { generationCalls += 1; return validResult(); },
    async persistSummaries() {},
    writeLog() {},
  });
  const result = await service({
    flow: MEMORY_REFRESH_FLOWS.CONVERSATION,
    chatId: "chat", userId: "user", messages: [],
  });
  assert.equal(result.action, "lost_claim");
  assert.equal(generationCalls, 0);
});

await test("84. Transaccion ocurre solo despues de generar", () => {
  const generateIndex = memorySource.indexOf("await generateSummaries");
  const persistIndex = memorySource.indexOf("await persist(");
  assert.ok(generateIndex >= 0 && persistIndex > generateIndex);
  assert.equal((memorySource.match(/prismaClient\.\$transaction/g) || []).length, 1);
});

await test("85. Todos los llamadores usan el servicio estructurado", () => {
  const chatSource = readFileSync(resolve(__dirname, "../src/services/chatService.js"), "utf8");
  assert.equal((chatSource.match(/await refreshMemoryAfterEligibleTurn\(/g) || []).length, 2);
  assert.equal(chatSource.includes("generateMemorySummaries"), false);
  assert.match(memorySource, /generationResult\.summaries/);
});

await test("86. Cada resultado logico registra result exactamente una vez", async () => {
  const harness = createGeneratorHarness([
    { error: new Error("429 rate limit") },
    { error: new Error("503 unavailable") },
  ]);
  await harness.generator({ messages: [{ role: "user", content: "x" }] });
  assert.equal(harness.calls.results.length, 1);
});

await test("87. Contrato de upsertUserMemory mantiene userId antes de summary", () => {
  const repositorySource = readFileSync(resolve(__dirname, "../src/repositories/userMemoryRepository.js"), "utf8");
  assert.match(repositorySource, /upsertUserMemory\(userId, summary\)/);
  assert.match(memorySource, /where: \{ userId \}/);
});
await test("88. Fallo interno inesperado usa rollback seguro", async () => {
  let summarized = 4;
  let rollbacks = 0;
  const counts = { memoryEligibleTurnCount: 8, memorySummarizedTurnCount: 4 };
  Object.defineProperty(counts, "unexpected", {
    enumerable: true,
    get() { throw new Error("internal test failure"); },
  });
  const service = createMemoryRefreshService({
    cadence: 4,
    async incrementEligibleTurn() { return counts; },
    async claimRefresh(_id, previous, claimed) {
      if (summarized !== previous) return false;
      summarized = claimed;
      return true;
    },
    async rollbackRefresh(_id, claimed, previous) {
      rollbacks += 1;
      if (summarized !== claimed) return false;
      summarized = previous;
      return true;
    },
    async generateSummaries() { return validResult(); },
    async persistSummaries() {},
    writeLog() {},
  });
  const result = await service({
    flow: MEMORY_REFRESH_FLOWS.CONVERSATION,
    chatId: "chat", userId: "user", messages: [],
  });
  assert.equal(result.action, "rollback");
  assert.equal(result.reason, "internal_failure");
  assert.equal(rollbacks, 1);
  assert.equal(summarized, 4);
});

await test("89. Orden integrado es usage result y defer", async () => {
  const generatorHarness = createGeneratorHarness([{ text: "not-json" }]);
  const service = createMemoryRefreshService({
    cadence: 4,
    async incrementEligibleTurn() {
      return { memoryEligibleTurnCount: 4, memorySummarizedTurnCount: 0 };
    },
    async claimRefresh() { return true; },
    async rollbackRefresh() { return false; },
    generateSummaries: generatorHarness.generator,
    async persistSummaries() {},
    writeLog(entry) {
      generatorHarness.calls.order.push(`refresh:${entry.action}:${entry.reason}`);
    },
  });
  await service({
    flow: MEMORY_REFRESH_FLOWS.CONVERSATION,
    chatId: "chat", userId: "user", messages: [{ role: "user", content: "x" }],
  });
  const order = generatorHarness.calls.order;
  assert.ok(order.indexOf("usage") < order.indexOf("result"));
  assert.ok(order.indexOf("result") < order.indexOf("refresh:defer:invalid_json"));
});

await test("90. Truncado MAX_TOKENS difiere sin persistir", async () => {
  let persistenceCalls = 0;
  const truncated = buildMemorySummaryResult(
    '{"chatSummary":"truncado"',
    "MAX_TOKENS",
  );
  const harness = createCadenceHarness({
    eligible: 3,
    generate: async () => truncated,
    persist: async () => { persistenceCalls += 1; },
  });
  const result = await harness.run();
  assert.equal(result.action, "defer");
  assert.equal(result.reason, "invalid_json");
  assert.equal(persistenceCalls, 0);
  assert.equal(harness.state.summarized, 4);
});
const report = {
  generatedAt: new Date().toISOString(),
  total: results.length,
  passed: results.filter((item) => item.status === "PASS").length,
  failed: results.filter((item) => item.status === "FAIL").length,
  realGeminiCalls: 0,
  productionDatabaseWrites: 0,
  simulation,
  results,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.failed > 0) process.exitCode = 1;

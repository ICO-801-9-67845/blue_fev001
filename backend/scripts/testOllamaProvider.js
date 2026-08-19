import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import {
  AI_PROVIDER_OPERATIONS,
  createAiProviderRouter,
} from "../src/services/aiProviderService.js";
import {
  OLLAMA_ERROR_CODES,
  OllamaProviderError,
  buildOllamaMessages,
  createOllamaGenerator,
  requestOllamaJson,
} from "../src/services/ollamaProviderService.js";

let passed = 0;
let failed = 0;

async function test(name, run) {
  try {
    await run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

function mockNodeRequest(handler, captures = []) {
  return (url, options, callback) => {
    const request = new EventEmitter();
    let timeoutHandler = () => {};
    request.setTimeout = (_milliseconds, handlerForTimeout) => {
      timeoutHandler = handlerForTimeout;
    };
    request.destroy = (error) => queueMicrotask(() => request.emit("error", error));
    request.end = (body) => {
      const capture = { url, options, body: body.toString("utf8") };
      captures.push(capture);
      const result = handler(capture);
      if (result.timeout) {
        queueMicrotask(timeoutHandler);
        return;
      }
      if (result.error) {
        queueMicrotask(() => request.emit("error", result.error));
        return;
      }
      const response = new EventEmitter();
      response.statusCode = result.statusCode;
      callback(response);
      queueMicrotask(() => {
        if (result.body !== undefined) response.emit("data", Buffer.from(result.body));
        response.emit("end");
      });
    };
    return request;
  };
}

function validResponse(content = "¿Qué actividades disfrutas más?") {
  return JSON.stringify({
    model: "qwen3:1.7b",
    message: { role: "assistant", content },
    done: true,
    done_reason: "stop",
    prompt_eval_count: 40,
    eval_count: 12,
    total_duration: 25_000_000,
  });
}

function makeGenerator(overrides = {}) {
  return createOllamaGenerator({
    baseUrl: "https://private-ollama.example",
    hostHeader: "localhost:11434",
    timeoutMs: 180000,
    contextLength: 2048,
    writeUsage: () => {},
    ...overrides,
  });
}

const basicContents = [
  { role: "user", parts: [{ text: "Hola, aún no sé qué estudiar." }] },
  { role: "model", parts: [{ text: "Cuéntame qué materias disfrutas." }] },
  { role: "user", parts: [{ text: "Me gusta diseñar y resolver problemas." }] },
];

await test("01 configuracion conceptual Ollama valida", async () => {
  const router = createAiProviderRouter({
    activeProvider: "ollama",
    fallbackProvider: "none",
    providers: { ollama: { conversation: async () => "ok", memory: async () => "ok" } },
  });
  assert.equal(await router(AI_PROVIDER_OPERATIONS.CONVERSATION, {}), "ok");
});

await test("02 proveedor invalido se rechaza", async () => {
  assert.throws(() => createAiProviderRouter({ activeProvider: "otro", providers: {} }));
});

await test("03 fallback automatico se rechaza", async () => {
  assert.throws(() => createAiProviderRouter({
    activeProvider: "ollama",
    fallbackProvider: "gemini",
    providers: {},
  }));
});

await test("04 operacion invalida se rechaza", async () => {
  const router = createAiProviderRouter({
    activeProvider: "ollama",
    providers: { ollama: { conversation: async () => "ok" } },
  });
  await assert.rejects(() => router("otra", {}));
});

await test("05 cero inicializaciones y llamadas Gemini en conversacion", async () => {
  const calls = { gemini: 0, ollama: 0 };
  const router = createAiProviderRouter({
    activeProvider: "ollama",
    fallbackProvider: "none",
    providers: {
      gemini: { conversation: async () => { calls.gemini += 1; } },
      ollama: { conversation: async () => { calls.ollama += 1; return "ok"; } },
    },
  });
  await router(AI_PROVIDER_OPERATIONS.CONVERSATION, {});
  assert.deepEqual(calls, { gemini: 0, ollama: 1 });
});

await test("06 cero llamadas Gemini en memoria y cero rotacion", async () => {
  const keysVisited = [];
  const router = createAiProviderRouter({
    activeProvider: "ollama",
    providers: {
      gemini: { memory: async () => keysVisited.push("key") },
      ollama: { memory: async () => ({ ok: true }) },
    },
  });
  await router(AI_PROVIDER_OPERATIONS.MEMORY, {});
  assert.deepEqual(keysVisited, []);
});

await test("07 caida Ollama no activa fallback", async () => {
  let geminiCalls = 0;
  const router = createAiProviderRouter({
    activeProvider: "ollama",
    providers: {
      gemini: { conversation: async () => { geminiCalls += 1; } },
      ollama: { conversation: async () => { throw new Error("offline"); } },
    },
  });
  await assert.rejects(() => router(AI_PROVIDER_OPERATIONS.CONVERSATION, {}));
  assert.equal(geminiCalls, 0);
});

await test("08 roles e historial se transforman correctamente", async () => {
  assert.deepEqual(buildOllamaMessages("Sistema actual", basicContents), [
    { role: "system", content: "Sistema actual" },
    { role: "user", content: "Hola, aún no sé qué estudiar." },
    { role: "assistant", content: "Cuéntame qué materias disfrutas." },
    { role: "user", content: "Me gusta diseñar y resolver problemas." },
  ]);
});

await test("09 rol no permitido se rechaza", async () => {
  assert.throws(
    () => buildOllamaMessages("Sistema", [{ role: "tool", parts: [{ text: "x" }] }]),
    (error) => error.code === OLLAMA_ERROR_CODES.INVALID_RESPONSE,
  );
});

await test("10 contenido no textual se rechaza", async () => {
  assert.throws(
    () => buildOllamaMessages("Sistema", [{ role: "user", parts: [{ text: 7 }] }]),
    (error) => error.code === OLLAMA_ERROR_CODES.INVALID_RESPONSE,
  );
});

await test("11 respuesta valida conserva acentos y espanol", async () => {
  const generator = makeGenerator({ requestJson: async () => validResponse("¿Qué área te gustaría explorar?") });
  const result = await generator({ requestType: "conversation", model: "qwen3:1.7b", systemInstruction: "Sistema", contents: basicContents, maxOutputTokens: 300, temperature: 0.6 });
  assert.equal(result.content, "¿Qué área te gustaría explorar?");
});

await test("12 stream false think false y contexto 2048", async () => {
  let request;
  const generator = makeGenerator({ requestJson: async (value) => { request = value; return validResponse(); } });
  await generator({ requestType: "conversation", model: "qwen3:1.7b", systemInstruction: "Sistema", contents: basicContents, maxOutputTokens: 300, temperature: 0.6 });
  assert.equal(request.body.stream, false);
  assert.equal(request.body.think, false);
  assert.equal(request.body.options.num_ctx, 2048);
});

await test("13 limite y temperatura de chat", async () => {
  let body;
  const generator = makeGenerator({ requestJson: async (request) => { body = request.body; return validResponse(); } });
  await generator({ requestType: "conversation", model: "qwen3:1.7b", systemInstruction: "Sistema", contents: basicContents, maxOutputTokens: 300, temperature: 0.6 });
  assert.equal(body.options.num_predict, 300);
  assert.equal(body.options.temperature, 0.6);
});

await test("14 limite y temperatura de memoria", async () => {
  let body;
  const generator = makeGenerator({ requestJson: async (request) => { body = request.body; return validResponse('{"chatSummary":"Resumen","userMemorySummary":"Memoria"}'); } });
  await generator({ requestType: "memory", model: "qwen3:1.7b", systemInstruction: "Sistema de memoria", contents: [{ role: "user", parts: [{ text: "Contexto reducido" }] }], maxOutputTokens: 600, temperature: 0.1 });
  assert.equal(body.options.num_predict, 600);
  assert.equal(body.options.temperature, 0.1);
  assert.equal(body.messages[1].content, "Contexto reducido");
});

await test("15 respuesta vacia se rechaza", async () => {
  const generator = makeGenerator({ requestJson: async () => validResponse("   ") });
  await assert.rejects(() => generator({ requestType: "conversation", model: "qwen3:1.7b", systemInstruction: "Sistema", contents: basicContents, maxOutputTokens: 300, temperature: 0.6 }), (error) => error.code === OLLAMA_ERROR_CODES.EMPTY_RESPONSE);
});

await test("16 JSON invalido se rechaza", async () => {
  const generator = makeGenerator({ requestJson: async () => "{" });
  await assert.rejects(() => generator({ requestType: "conversation", model: "qwen3:1.7b", systemInstruction: "Sistema", contents: basicContents, maxOutputTokens: 300, temperature: 0.6 }), (error) => error.code === OLLAMA_ERROR_CODES.INVALID_JSON);
});

await test("17 respuesta incompleta se rechaza", async () => {
  const generator = makeGenerator({ requestJson: async () => JSON.stringify({ done: false, message: { content: "parcial" } }) });
  await assert.rejects(() => generator({ requestType: "conversation", model: "qwen3:1.7b", systemInstruction: "Sistema", contents: basicContents, maxOutputTokens: 300, temperature: 0.6 }), (error) => error.code === OLLAMA_ERROR_CODES.INCOMPLETE_RESPONSE);
});

await test("18 bloque think se rechaza", async () => {
  const generator = makeGenerator({ requestJson: async () => validResponse("<think>interno</think>Respuesta") });
  await assert.rejects(() => generator({ requestType: "conversation", model: "qwen3:1.7b", systemInstruction: "Sistema", contents: basicContents, maxOutputTokens: 300, temperature: 0.6 }), (error) => error.code === OLLAMA_ERROR_CODES.REASONING_CONTENT);
});

await test("19 razonamiento separado no se expone", async () => {
  const body = JSON.parse(validResponse("Respuesta segura"));
  body.message.thinking = "interno";
  const generator = makeGenerator({ requestJson: async () => JSON.stringify(body) });
  const result = await generator({ requestType: "conversation", model: "qwen3:1.7b", systemInstruction: "Sistema", contents: basicContents, maxOutputTokens: 300, temperature: 0.6 });
  assert.deepEqual(Object.keys(result).sort(), ["content", "finishReason", "usageMetadata"]);
  assert.equal(result.content, "Respuesta segura");
});

async function httpFailure(statusCode, body = "") {
  const requestImpl = mockNodeRequest(() => ({ statusCode, body }));
  return requestOllamaJson({ url: "https://private-ollama.example/api/chat", hostHeader: "localhost:11434", body: {}, timeoutMs: 1000, requestImpl });
}

await test("20 HTTP 403 distinguido", async () => assert.rejects(() => httpFailure(403), (error) => error.code === OLLAMA_ERROR_CODES.HTTP_403));
await test("21 HTTP 404 distinguido", async () => assert.rejects(() => httpFailure(404), (error) => error.code === OLLAMA_ERROR_CODES.HTTP_404));
await test("22 HTTP 500 distinguido", async () => assert.rejects(() => httpFailure(500), (error) => error.code === OLLAMA_ERROR_CODES.HTTP_500));
await test("23 modelo ausente distinguido", async () => assert.rejects(() => httpFailure(404, '{"error":"model qwen3 not found"}'), (error) => error.code === OLLAMA_ERROR_CODES.MODEL_UNAVAILABLE));

await test("24 timeout distinguido", async () => {
  const requestImpl = mockNodeRequest(() => ({ timeout: true }));
  await assert.rejects(() => requestOllamaJson({ url: "https://private-ollama.example/api/chat", hostHeader: "localhost:11434", body: {}, timeoutMs: 1, requestImpl }), (error) => error.code === OLLAMA_ERROR_CODES.TIMEOUT);
});

await test("25 conexion rechazada distinguida", async () => {
  const error = new Error(); error.code = "ECONNREFUSED";
  const requestImpl = mockNodeRequest(() => ({ error }));
  await assert.rejects(() => requestOllamaJson({ url: "https://private-ollama.example/api/chat", hostHeader: "localhost:11434", body: {}, timeoutMs: 1000, requestImpl }), (value) => value.code === OLLAMA_ERROR_CODES.CONNECTION_REFUSED);
});

await test("26 DNS distinguido", async () => {
  const error = new Error(); error.code = "ENOTFOUND";
  const requestImpl = mockNodeRequest(() => ({ error }));
  await assert.rejects(() => requestOllamaJson({ url: "https://private-ollama.example/api/chat", hostHeader: "localhost:11434", body: {}, timeoutMs: 1000, requestImpl }), (value) => value.code === OLLAMA_ERROR_CODES.DNS);
});

await test("26a Tailscale inalcanzable distinguido", async () => {
  const error = new Error(); error.code = "ENETUNREACH";
  const requestImpl = mockNodeRequest(() => ({ error }));
  await assert.rejects(() => requestOllamaJson({ url: "https://private-ollama.example/api/chat", hostHeader: "localhost:11434", body: {}, timeoutMs: 1000, requestImpl }), (value) => value.code === OLLAMA_ERROR_CODES.TAILSCALE_UNAVAILABLE);
});

await test("26b servidor interrumpido distinguido", async () => {
  const error = new Error(); error.code = "ECONNRESET";
  const requestImpl = mockNodeRequest(() => ({ error }));
  await assert.rejects(() => requestOllamaJson({ url: "https://private-ollama.example/api/chat", hostHeader: "localhost:11434", body: {}, timeoutMs: 1000, requestImpl }), (value) => value.code === OLLAMA_ERROR_CODES.SERVER_UNAVAILABLE);
});

await test("26c fallo TLS distinguido", async () => {
  const error = new Error(); error.code = "EPROTO";
  const requestImpl = mockNodeRequest(() => ({ error }));
  await assert.rejects(() => requestOllamaJson({ url: "https://private-ollama.example/api/chat", hostHeader: "localhost:11434", body: {}, timeoutMs: 1000, requestImpl }), (value) => value.code === OLLAMA_ERROR_CODES.TLS);
});

await test("27 Host incorrecto reproduce 403 y Host correcto 200", async () => {
  const captures = [];
  const requestImpl = mockNodeRequest(({ options }) => options.headers.Host === "localhost:11434"
    ? { statusCode: 200, body: validResponse() }
    : { statusCode: 403, body: "forbidden" }, captures);
  await assert.rejects(() => requestOllamaJson({ url: "https://private-ollama.example/api/chat", hostHeader: "incorrecto", body: {}, timeoutMs: 1000, requestImpl }), (error) => error.code === OLLAMA_ERROR_CODES.HTTP_403);
  const response = await requestOllamaJson({ url: "https://private-ollama.example/api/chat", hostHeader: "localhost:11434", body: {}, timeoutMs: 1000, requestImpl });
  assert.equal(JSON.parse(response).message.content.length > 0, true);
  assert.equal(captures[1].options.headers.Host, "localhost:11434");
  assert.equal(captures[1].options.servername, "private-ollama.example");
});

await test("28 logs de uso no contienen contenido ni URL", async () => {
  const logs = [];
  const generator = makeGenerator({ requestJson: async () => validResponse(), writeUsage: (entry) => logs.push(entry) });
  await generator({ requestType: "conversation", model: "qwen3:1.7b", systemInstruction: "SECRETO", contents: basicContents, maxOutputTokens: 300, temperature: 0.6 });
  assert.deepEqual(Object.keys(logs[0]).sort(), ["durationMs", "event", "model", "outputTokenCount", "promptTokenCount", "provider", "requestType", "status"].sort());
  assert.equal(JSON.stringify(logs).includes("SECRETO"), false);
  assert.equal(logs[0].promptTokenCount, 40);
  assert.equal(logs[0].outputTokenCount, 12);
});

await test("29 recuperacion tras restablecer Ollama", async () => {
  let attempt = 0;
  const generator = makeGenerator({ requestJson: async () => { attempt += 1; if (attempt === 1) throw new OllamaProviderError(OLLAMA_ERROR_CODES.CONNECTION); return validResponse("Recuperado"); } });
  const input = { requestType: "conversation", model: "qwen3:1.7b", systemInstruction: "Sistema", contents: basicContents, maxOutputTokens: 300, temperature: 0.6 };
  await assert.rejects(() => generator(input));
  assert.equal((await generator(input)).content, "Recuperado");
});

await test("30 contrato frontend y doble envio permanecen intactos", async () => {
  const api = readFileSync(new URL("../../frontend/src/api/chatApi.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../frontend/src/pages/ChatPage.jsx", import.meta.url), "utf8");
  assert.match(api, /return response\.data\.data/);
  assert.match(api, /content,\s*\.\.\.\(action \? \{ action \} : \{\}\)/s);
  assert.match(page, /sendingGuardRef\.current/);
  assert.match(page, /if \(sending \|\| sendingGuardRef\.current\)/);
});

console.log(`TOTAL ${passed + failed} PASS ${passed} FAIL ${failed}`);
if (failed) process.exitCode = 1;

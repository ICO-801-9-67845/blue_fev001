import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

let passed = 0;
let failed = 0;

function runEnv(overrides = {}) {
  const script = `
    const config = await import('./src/config/env.js');
    console.log(JSON.stringify({
      provider: config.AI_PROVIDER,
      fallback: config.AI_FALLBACK_PROVIDER,
      url: config.OLLAMA_BASE_URL,
      host: config.OLLAMA_HOST_HEADER,
      chatModel: config.OLLAMA_CHAT_MODEL,
      memoryModel: config.OLLAMA_MEMORY_MODEL,
      timeout: config.OLLAMA_TIMEOUT_MS,
      context: config.OLLAMA_CONTEXT_LENGTH,
      chatTokens: config.OLLAMA_CHAT_MAX_OUTPUT_TOKENS,
      memoryTokens: config.OLLAMA_MEMORY_MAX_OUTPUT_TOKENS,
      chatTemperature: config.OLLAMA_CHAT_TEMPERATURE,
      memoryTemperature: config.OLLAMA_MEMORY_TEMPERATURE,
      geminiKeyCount: config.GEMINI_API_KEYS.length,
    }));
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: "file:test.db",
      JWT_SECRET: "test-secret",
      AI_PROVIDER: "ollama",
      AI_FALLBACK_PROVIDER: "none",
      OLLAMA_BASE_URL: "https://private-ollama.example",
      OLLAMA_HOST_HEADER: "localhost:11434",
      OLLAMA_CHAT_MODEL: "qwen3:1.7b",
      OLLAMA_MEMORY_MODEL: "qwen3:1.7b",
      OLLAMA_TIMEOUT_MS: "180000",
      OLLAMA_CONTEXT_LENGTH: "2048",
      OLLAMA_CHAT_MAX_OUTPUT_TOKENS: "300",
      OLLAMA_MEMORY_MAX_OUTPUT_TOKENS: "600",
      OLLAMA_CHAT_TEMPERATURE: "0.6",
      OLLAMA_MEMORY_TEMPERATURE: "0.1",
      GEMINI_API_KEYS: "",
      ...overrides,
    },
  });
}

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

function expectInvalid(overrides, variable) {
  const result = runEnv(overrides);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(variable));
}

await test("01 configuracion Ollama valida y exacta", () => {
  const result = runEnv();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    provider: "ollama",
    fallback: "none",
    url: "https://private-ollama.example",
    host: "localhost:11434",
    chatModel: "qwen3:1.7b",
    memoryModel: "qwen3:1.7b",
    timeout: 180000,
    context: 2048,
    chatTokens: 300,
    memoryTokens: 600,
    chatTemperature: 0.6,
    memoryTemperature: 0.1,
    geminiKeyCount: 0,
  });
});

await test("02 proveedor invalido", () => expectInvalid({ AI_PROVIDER: "otro" }, "AI_PROVIDER"));
await test("03 fallback distinto de none", () => expectInvalid({ AI_FALLBACK_PROVIDER: "gemini" }, "AI_FALLBACK_PROVIDER"));
await test("04 URL HTTP rechazada", () => expectInvalid({ OLLAMA_BASE_URL: "http://private-ollama.example" }, "OLLAMA_BASE_URL"));
await test("05 URL con credenciales rechazada", () => expectInvalid({ OLLAMA_BASE_URL: "https://user:pass@private-ollama.example" }, "OLLAMA_BASE_URL"));
await test("06 URL con ruta rechazada", () => expectInvalid({ OLLAMA_BASE_URL: "https://private-ollama.example/api" }, "OLLAMA_BASE_URL"));
await test("07 Host con salto de linea rechazado", () => expectInvalid({ OLLAMA_HOST_HEADER: "localhost:11434\nOtro: valor" }, "OLLAMA_HOST_HEADER"));
await test("08 puerto Host fuera de rango", () => expectInvalid({ OLLAMA_HOST_HEADER: "localhost:99999" }, "OLLAMA_HOST_HEADER"));
await test("09 timeout invalido", () => expectInvalid({ OLLAMA_TIMEOUT_MS: "999" }, "OLLAMA_TIMEOUT_MS"));
await test("10 contexto invalido", () => expectInvalid({ OLLAMA_CONTEXT_LENGTH: "0" }, "OLLAMA_CONTEXT_LENGTH"));
await test("11 limite conversacional invalido", () => expectInvalid({ OLLAMA_CHAT_MAX_OUTPUT_TOKENS: "8.5" }, "OLLAMA_CHAT_MAX_OUTPUT_TOKENS"));
await test("12 limite de memoria invalido", () => expectInvalid({ OLLAMA_MEMORY_MAX_OUTPUT_TOKENS: "9000" }, "OLLAMA_MEMORY_MAX_OUTPUT_TOKENS"));
await test("13 temperatura de chat invalida", () => expectInvalid({ OLLAMA_CHAT_TEMPERATURE: "2.1" }, "OLLAMA_CHAT_TEMPERATURE"));
await test("14 temperatura de memoria invalida", () => expectInvalid({ OLLAMA_MEMORY_TEMPERATURE: "NaN" }, "OLLAMA_MEMORY_TEMPERATURE"));
await test("14a modelo de chat con control invalido", () => expectInvalid({ OLLAMA_CHAT_MODEL: "qwen3\nmalicioso" }, "OLLAMA_CHAT_MODEL"));
await test("14b modelo de memoria demasiado largo", () => expectInvalid({ OLLAMA_MEMORY_MODEL: "x".repeat(129) }, "OLLAMA_MEMORY_MODEL"));
await test("15 Gemini sigue disponible como reversion manual", () => {
  const result = runEnv({ AI_PROVIDER: "gemini", GEMINI_API_KEYS: "manual-key", OLLAMA_BASE_URL: "", OLLAMA_HOST_HEADER: "" });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout.trim());
  assert.equal(config.provider, "gemini");
  assert.equal(config.geminiKeyCount, 1);
});
await test("16 Gemini exige key al activarse", () => {
  const result = runEnv({ AI_PROVIDER: "gemini", GEMINI_API_KEYS: "", OLLAMA_BASE_URL: "", OLLAMA_HOST_HEADER: "" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GEMINI_API_KEYS/);
});

console.log(`TOTAL ${passed + failed} PASS ${passed} FAIL ${failed}`);
if (failed) process.exitCode = 1;

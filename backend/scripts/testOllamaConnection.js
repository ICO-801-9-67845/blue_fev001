import {
  OLLAMA_BASE_URL,
  OLLAMA_CHAT_MODEL,
  OLLAMA_CONTEXT_LENGTH,
  OLLAMA_HOST_HEADER,
  OLLAMA_PROXY_URL,
  OLLAMA_TIMEOUT_MS,
} from "../src/config/env.js";
import { createOllamaGenerator } from "../src/services/ollamaProviderService.js";

console.log("[ollama-smoke] provider=ollama");
console.log(`[ollama-smoke] model=${OLLAMA_CHAT_MODEL}`);

try {
  const generate = createOllamaGenerator({
    baseUrl: OLLAMA_BASE_URL,
    hostHeader: OLLAMA_HOST_HEADER,
    proxyUrl: OLLAMA_PROXY_URL,
    timeoutMs: Math.min(OLLAMA_TIMEOUT_MS, 180000),
    contextLength: OLLAMA_CONTEXT_LENGTH,
    writeUsage: () => {},
  });
  const result = await generate({
    requestType: "conversation",
    model: OLLAMA_CHAT_MODEL,
    systemInstruction: "Responde solamente con la palabra OK.",
    contents: [{ role: "user", parts: [{ text: "Prueba de conectividad." }] }],
    maxOutputTokens: 8,
    temperature: 0,
  });
  if (!result.content.trim() || !["STOP", "stop"].includes(result.finishReason)) {
    throw Object.assign(new Error("invalid response"), { code: "ollama_invalid_response" });
  }
  console.log("[ollama-smoke] status=success");
} catch (error) {
  const safeCode = /^ollama_[a-z_]+$/.test(error?.code || "") ? error.code : "ollama_smoke_failed";
  console.error(`[ollama-smoke] status=failure code=${safeCode}`);
  process.exitCode = 1;
}

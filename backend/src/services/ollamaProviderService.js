import { Agent as HttpsAgent, request as httpsRequest } from "node:https";

export const OLLAMA_ERROR_CODES = Object.freeze({
  TIMEOUT: "ollama_timeout",
  CONNECTION_REFUSED: "ollama_connection_refused",
  DNS: "ollama_dns_error",
  TAILSCALE_UNAVAILABLE: "ollama_tailscale_unavailable",
  SERVER_UNAVAILABLE: "ollama_server_unavailable",
  TLS: "ollama_tls_error",
  CONNECTION: "ollama_connection_error",
  HTTP_403: "ollama_http_403",
  HTTP_404: "ollama_http_404",
  HTTP_500: "ollama_http_500",
  HTTP_ERROR: "ollama_http_error",
  MODEL_UNAVAILABLE: "ollama_model_unavailable",
  INVALID_JSON: "ollama_invalid_json",
  EMPTY_RESPONSE: "ollama_empty_response",
  INCOMPLETE_RESPONSE: "ollama_incomplete_response",
  INVALID_RESPONSE: "ollama_invalid_response",
  REASONING_CONTENT: "ollama_reasoning_content",
});

export class OllamaProviderError extends Error {
  constructor(code, statusCode = 0) {
    super(code);
    this.name = "OllamaProviderError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function createOllamaHttpsAgent(proxyUrl) {
  if (!proxyUrl) return undefined;
  return new HttpsAgent({
    proxyEnv: {
      HTTPS_PROXY: proxyUrl,
    },
  });
}

function usageCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function durationMilliseconds(response, startedAt, now) {
  const nanoseconds = Number(response?.total_duration);
  if (Number.isFinite(nanoseconds) && nanoseconds >= 0) {
    return Math.round(nanoseconds / 1_000_000);
  }
  return Math.max(0, now() - startedAt);
}

function textFromParts(parts) {
  if (!Array.isArray(parts) || !parts.length) {
    throw new OllamaProviderError(OLLAMA_ERROR_CODES.INVALID_RESPONSE);
  }
  const values = parts.map((part) => {
    if (!part || typeof part !== "object" || typeof part.text !== "string") {
      throw new OllamaProviderError(OLLAMA_ERROR_CODES.INVALID_RESPONSE);
    }
    return part.text;
  });
  const content = values.join("").trim();
  if (!content) {
    throw new OllamaProviderError(OLLAMA_ERROR_CODES.INVALID_RESPONSE);
  }
  return content;
}

export function buildOllamaMessages(systemInstruction, contents) {
  if (typeof systemInstruction !== "string" || !systemInstruction.trim()) {
    throw new OllamaProviderError(OLLAMA_ERROR_CODES.INVALID_RESPONSE);
  }
  if (!Array.isArray(contents) || !contents.length) {
    throw new OllamaProviderError(OLLAMA_ERROR_CODES.INVALID_RESPONSE);
  }

  return [
    { role: "system", content: systemInstruction.trim() },
    ...contents.map((entry) => {
      const role = entry?.role === "model" ? "assistant" : entry?.role;
      if (role !== "user" && role !== "assistant") {
        throw new OllamaProviderError(OLLAMA_ERROR_CODES.INVALID_RESPONSE);
      }
      return { role, content: textFromParts(entry.parts) };
    }),
  ];
}

function mapNetworkError(error) {
  if (error?.code === "ETIMEDOUT" || error?.code === "ESOCKETTIMEDOUT") {
    return new OllamaProviderError(OLLAMA_ERROR_CODES.TIMEOUT);
  }
  if (error instanceof OllamaProviderError) {
    return error;
  }
  if (error?.code === "ECONNREFUSED") {
    return new OllamaProviderError(OLLAMA_ERROR_CODES.CONNECTION_REFUSED);
  }
  if (error?.code === "ENOTFOUND" || error?.code === "EAI_AGAIN") {
    return new OllamaProviderError(OLLAMA_ERROR_CODES.DNS);
  }
  if (error?.code === "EHOSTUNREACH" || error?.code === "ENETUNREACH") {
    return new OllamaProviderError(OLLAMA_ERROR_CODES.TAILSCALE_UNAVAILABLE);
  }
  if (error?.code === "ECONNRESET" || error?.code === "EPIPE") {
    return new OllamaProviderError(OLLAMA_ERROR_CODES.SERVER_UNAVAILABLE);
  }
  if (error?.code === "EPROTO" || `${error?.code || ""}`.startsWith("ERR_TLS_")) {
    return new OllamaProviderError(OLLAMA_ERROR_CODES.TLS);
  }
  return new OllamaProviderError(OLLAMA_ERROR_CODES.CONNECTION);
}

function errorForHttpStatus(statusCode, responseBody) {
  if (statusCode === 403) {
    return new OllamaProviderError(OLLAMA_ERROR_CODES.HTTP_403, statusCode);
  }
  if (statusCode === 404) {
    let errorText = "";
    try {
      const parsed = JSON.parse(responseBody);
      errorText = typeof parsed?.error === "string" ? parsed.error.toLowerCase() : "";
    } catch {
      // The response body is intentionally not exposed.
    }
    const code = /model|manifest/.test(errorText)
      ? OLLAMA_ERROR_CODES.MODEL_UNAVAILABLE
      : OLLAMA_ERROR_CODES.HTTP_404;
    return new OllamaProviderError(code, statusCode);
  }
  if (statusCode >= 500) {
    return new OllamaProviderError(OLLAMA_ERROR_CODES.HTTP_500, statusCode);
  }
  return new OllamaProviderError(OLLAMA_ERROR_CODES.HTTP_ERROR, statusCode);
}

export function requestOllamaJson({
  url,
  hostHeader,
  body,
  timeoutMs,
  agent,
  requestImpl = httpsRequest,
}) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      reject(new OllamaProviderError(OLLAMA_ERROR_CODES.CONNECTION));
      return;
    }
    if (parsedUrl.protocol !== "https:") {
      reject(new OllamaProviderError(OLLAMA_ERROR_CODES.CONNECTION));
      return;
    }

    const encodedBody = Buffer.from(JSON.stringify(body), "utf8");
    const request = requestImpl(
      parsedUrl,
      {
        method: "POST",
        servername: parsedUrl.hostname,
        ...(agent ? { agent } : {}),
        headers: {
          Host: hostHeader,
          "Content-Type": "application/json",
          "Content-Length": encodedBody.length,
        },
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 1_048_576) {
            request.destroy(new OllamaProviderError(OLLAMA_ERROR_CODES.INVALID_RESPONSE));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          const statusCode = Number(response.statusCode) || 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(errorForHttpStatus(statusCode, responseBody));
            return;
          }
          resolve(responseBody);
        });
        response.on("error", (error) => reject(mapNetworkError(error)));
      },
    );

    request.setTimeout(timeoutMs, () => {
      const timeoutError = new OllamaProviderError(OLLAMA_ERROR_CODES.TIMEOUT);
      timeoutError.code = "ETIMEDOUT";
      request.destroy(timeoutError);
    });
    request.on("error", (error) => reject(mapNetworkError(error)));
    request.end(encodedBody);
  });
}

function parseOllamaResponse(responseBody) {
  let response;
  try {
    response = JSON.parse(responseBody);
  } catch {
    throw new OllamaProviderError(OLLAMA_ERROR_CODES.INVALID_JSON);
  }

  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new OllamaProviderError(OLLAMA_ERROR_CODES.INVALID_RESPONSE);
  }
  if (response.done === false) {
    throw new OllamaProviderError(OLLAMA_ERROR_CODES.INCOMPLETE_RESPONSE);
  }
  if (!response.message || typeof response.message !== "object" || Array.isArray(response.message)) {
    throw new OllamaProviderError(OLLAMA_ERROR_CODES.INCOMPLETE_RESPONSE);
  }
  if (typeof response.message.content !== "string") {
    throw new OllamaProviderError(OLLAMA_ERROR_CODES.INCOMPLETE_RESPONSE);
  }

  const content = response.message.content.trim();
  if (!content) {
    throw new OllamaProviderError(OLLAMA_ERROR_CODES.EMPTY_RESPONSE);
  }
  if (/<\/?think>/i.test(content)) {
    throw new OllamaProviderError(OLLAMA_ERROR_CODES.REASONING_CONTENT);
  }
  return { response, content };
}

export function createOllamaGenerator({
  baseUrl,
  hostHeader,
  timeoutMs,
  contextLength,
  proxyUrl = "",
  requestJson = requestOllamaJson,
  writeUsage = (entry) => console.info(entry),
  now = Date.now,
}) {
  const agent = createOllamaHttpsAgent(proxyUrl);
  return async function generate({
    requestType,
    model,
    systemInstruction,
    contents,
    maxOutputTokens,
    temperature,
  }) {
    const messages = buildOllamaMessages(systemInstruction, contents);
    const startedAt = now();
    let status = "failure";
    let promptTokenCount = 0;
    let outputTokenCount = 0;
    let durationMs = 0;

    try {
      const responseBody = await requestJson({
        url: `${baseUrl}/api/chat`,
        hostHeader,
        timeoutMs,
        agent,
        body: {
          model,
          messages,
          stream: false,
          think: false,
          options: {
            temperature,
            num_predict: maxOutputTokens,
            num_ctx: contextLength,
          },
        },
      });
      const { response, content } = parseOllamaResponse(responseBody);
      status = "success";
      promptTokenCount = usageCount(response.prompt_eval_count);
      outputTokenCount = usageCount(response.eval_count);
      durationMs = durationMilliseconds(response, startedAt, now);
      return {
        content,
        finishReason: response.done_reason || (response.done === true ? "STOP" : "UNKNOWN"),
        usageMetadata: {
          promptTokenCount,
          candidatesTokenCount: outputTokenCount,
        },
      };
    } finally {
      try {
        writeUsage({
          event: "ai_usage",
          provider: "ollama",
          requestType,
          model,
          promptTokenCount,
          outputTokenCount,
          durationMs: durationMs || Math.max(0, now() - startedAt),
          status,
        });
      } catch {
        // Usage logging must not alter generation behavior.
      }
    }
  };
}

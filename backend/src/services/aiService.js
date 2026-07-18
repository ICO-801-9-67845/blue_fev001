import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  GEMINI_API_KEYS,
  GEMINI_CHAT_HISTORY_LIMIT_WITH_SUMMARY,
  GEMINI_CHAT_HISTORY_LIMIT_WITHOUT_SUMMARY,
  GEMINI_CHAT_HISTORY_MAX_CHARS_WITH_SUMMARY,
  GEMINI_CHAT_HISTORY_MAX_CHARS_WITHOUT_SUMMARY,
  GEMINI_CHAT_MAX_OUTPUT_TOKENS,
  GEMINI_CHAT_MODEL,
  GEMINI_CHAT_TEMPERATURE,
  GEMINI_MEMORY_MAX_OUTPUT_TOKENS,
  GEMINI_MEMORY_MODEL,
  GEMINI_MEMORY_TEMPERATURE,
  GEMINI_MEMORY_CONTEXT_MESSAGE_LIMIT,
  GEMINI_MEMORY_CONTEXT_MAX_CHARS,
  GEMINI_MEMORY_USER_MESSAGE_MAX_CHARS,
  GEMINI_MEMORY_ASSISTANT_MESSAGE_MAX_CHARS,
  GEMINI_MEMORY_CURRENT_CHAT_SUMMARY_MAX_CHARS,
  GEMINI_MEMORY_USER_MEMORY_MAX_CHARS,
  GEMINI_MEMORY_TARGET_CHAT_SUMMARY_CHARS,
  GEMINI_MEMORY_TARGET_USER_MEMORY_CHARS,
} from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { buildAssistantRequestContext } from "./aiContextService.js";
import {
  buildMemoryRequestContext,
  buildMemorySummarySystemInstruction,
} from "./memoryContextService.js";

const SYSTEM_PROMPT = `
Habla siempre en espanol natural, cercano y humano.
Eres una presencia confiable, calida y respetuosa. Suenas como un amigo inteligente que escucha de verdad.
No te presentes de inmediato como orientador vocacional.
Primero conversa de forma organica y natural para conocer a la persona: gustos, hobbies, materias favoritas, frustraciones, fortalezas, ritmo de vida, motivaciones, valores, entorno y dudas.
Haz preguntas con tacto, una o dos a la vez, sin invadir ni interrogar.
No inventes datos del usuario ni asumas informacion que no te hayan dicho.
No fuerces recomendaciones academicas o profesionales demasiado pronto.
Solo cuando tengas suficientes senales, conecta sutilmente la conversacion con posibles caminos de estudio, areas, carreras, tipos de escuela o trayectorias.
Si el usuario pide orientacion vocacional de forma directa, entonces responde con claridad y estructura, pero manteniendo un tono cercano y cero robotico.
Si el usuario comparte algo emocional o personal, responde con tacto, validacion y cuidado.
Evita sonar como coach corporativo o consejero formal.
Tus respuestas deben sentirse conversacionales, utiles y con calidez real.
Cuando recomiendes opciones, explica brevemente por que encajan con lo que el usuario ha compartido.
`;

const RESPONSE_STYLE_RULES = `
Reglas adicionales de estilo:
- Responde de forma corta, precisa y concisa.
- Evita parrafos largos.
- No des explicaciones innecesarias.
- No repitas informacion.
- Si necesitas preguntar algo, haz maximo 1 o 2 preguntas claras.
- Si el usuario esta explorando, guia poco a poco.
- Si ya puedes recomendar opciones, muestra maximo 3 opciones principales.
- Usa frases naturales y directas.
- No uses listas enormes.
- No satures al usuario con demasiada informacion en una sola respuesta.
`;

const EDUCATIVE_OFFER_RULES = `
Reglas adicionales para recomendaciones educativas:
- No inventes escuelas, universidades, preparatorias, carreras, telefonos, correos, promociones, direcciones ni sitios web.
- Si se proporcionan opciones educativas desde la base de datos, usa unicamente esas opciones.
- Si no hay opciones educativas proporcionadas en el contexto, no recomiendes escuelas ni muestres links.
- Solo puedes mencionar escuelas incluidas explicitamente en las opciones educativas del contexto.
- Usa unicamente redirect_url como link de redireccion. No uses website como link principal.
- Copia redirect_url exactamente como viene. Nunca cambies el ID del link.
- No inventes enlaces ni construyas links tipo /detalle/ID. Si una escuela no tiene redirect_url, no muestres link.
- Si no se proporcionan opciones educativas desde la base de datos, no menciones nombres concretos de escuelas.
- Si todavia falta informacion, pregunta solo lo indispensable: nivel, area de interes o municipio.
- Cuando recomiendes escuelas, responde con formato breve:
  1. Nombre de la escuela
  2. Por que encaja
  3. Carreras relevantes, si existen
  4. Link: redirect_url, si existe
- Si incluyes link, escribelo como URL completa en una linea asi: Link: https://...
- Si algun dato no viene en la base, omitelo. No lo inventes.
- Prioriza precision sobre cantidad.
`;

const EDUCATIVE_SAFETY_RULE = `
Regla permanente de seguridad educativa:
- No inventes ni menciones nombres concretos de escuelas, universidades o enlaces cuando no existan opciones educativas validadas en el contexto.
`;

export const BASE_SYSTEM_INSTRUCTION = `${SYSTEM_PROMPT}

${RESPONSE_STYLE_RULES}

${EDUCATIVE_SAFETY_RULE}`;

export const FULL_SYSTEM_PROMPT = `${BASE_SYSTEM_INSTRUCTION}

${EDUCATIVE_OFFER_RULES}`;

const MEMORY_SUMMARY_PROMPT = buildMemorySummarySystemInstruction({
  targetChatSummaryChars: GEMINI_MEMORY_TARGET_CHAT_SUMMARY_CHARS,
  targetUserMemoryChars: GEMINI_MEMORY_TARGET_USER_MEMORY_CHARS,
});

const MEMORY_CONTEXT_LIMITS = Object.freeze({
  messageLimit: GEMINI_MEMORY_CONTEXT_MESSAGE_LIMIT,
  characterBudget: GEMINI_MEMORY_CONTEXT_MAX_CHARS,
  userMessageMaxChars: GEMINI_MEMORY_USER_MESSAGE_MAX_CHARS,
  assistantMessageMaxChars: GEMINI_MEMORY_ASSISTANT_MESSAGE_MAX_CHARS,
  currentChatSummaryMaxChars: GEMINI_MEMORY_CURRENT_CHAT_SUMMARY_MAX_CHARS,
  userMemoryMaxChars: GEMINI_MEMORY_USER_MEMORY_MAX_CHARS,
});

const OFFER_DETAIL_ID_PATTERN = /\/oferta-educativa\/detalle\/(\d+)/gi;

const INVALID_OFFER_LINK_RESPONSE =
  "Encontre un problema validando los enlaces. Para evitar darte informacion incorrecta, intenta pedirme la busqueda de nuevo con carrera y municipio.";

function getUsageCount(usageMetadata, property) {
  const value = Number(usageMetadata?.[property]);

  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function logGeminiUsage(requestType, model, usageMetadata) {
  console.log({
    event: "gemini_usage",
    requestType,
    model,
    promptTokenCount: getUsageCount(usageMetadata, "promptTokenCount"),
    candidatesTokenCount: getUsageCount(usageMetadata, "candidatesTokenCount"),
    thoughtsTokenCount: getUsageCount(usageMetadata, "thoughtsTokenCount"),
    cachedContentTokenCount: getUsageCount(usageMetadata, "cachedContentTokenCount"),
    totalTokenCount: getUsageCount(usageMetadata, "totalTokenCount"),
  });
}

function isRecoverableGeminiError(error) {
  const message = `${error?.message || ""}`.toLowerCase();
  return (
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("429") ||
    message.includes("503") ||
    message.includes("temporarily") ||
    message.includes("unavailable")
  );
}

function toSafeString(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function getOfferId(offer) {
  return toSafeString(offer?.id || offer?.offerId || offer?.offer_id);
}

function getLevelLabel(level) {
  const normalizedLevel = toSafeString(level).toLowerCase();

  if (
    normalizedLevel === "1" ||
    normalizedLevel === "prepa" ||
    normalizedLevel === "preparatoria" ||
    normalizedLevel === "bachillerato"
  ) {
    return "Preparatoria / bachillerato";
  }

  if (
    normalizedLevel === "2" ||
    normalizedLevel === "universidad" ||
    normalizedLevel === "superior" ||
    normalizedLevel === "licenciatura"
  ) {
    return "Universidad / educacion superior";
  }

  if (
    normalizedLevel === "3" ||
    normalizedLevel === "otros" ||
    normalizedLevel === "otro"
  ) {
    return "Otros servicios educativos";
  }

  return toSafeString(level) || "No especificado";
}

function normalizeCareers(careers) {
  if (!Array.isArray(careers)) {
    return [];
  }

  return careers
    .map((career) => {
      if (typeof career === "string") {
        return career;
      }

      return career?.name || career?.career || career?.title || "";
    })
    .map(toSafeString)
    .filter(Boolean)
    .slice(0, 8);
}

function normalizePhones(offer) {
  const phones = Array.isArray(offer?.phones)
    ? offer.phones
    : [
        offer?.telephone_1,
        offer?.telephone_2,
        offer?.phone,
        offer?.whatsapp,
      ];

  return phones.map(toSafeString).filter(Boolean).slice(0, 3);
}

function buildOfferContextText(offerContext = []) {
  if (!Array.isArray(offerContext) || offerContext.length === 0) {
    return "";
  }

  const offers = offerContext
    .filter((offer) => toSafeString(offer?.name))
    .slice(0, 3);

  if (offers.length === 0) {
    return "";
  }

  const formattedOffers = offers
    .map((offer, index) => {
      const name = toSafeString(offer?.name);
      const id = getOfferId(offer);
      const shortName = toSafeString(offer?.shortName || offer?.short_name);
      const levelLabel = toSafeString(offer?.levelLabel) || getLevelLabel(offer?.level);
      const municipality = toSafeString(offer?.municipality);
      const redirectUrl = toSafeString(offer?.redirectUrl || offer?.redirect_url);
      const careers = normalizeCareers(offer?.careers);

      const lines = [
        `${index + 1}. ${name}`,
        id ? `ID: ${id}` : "",
        shortName ? `Abreviacion: ${shortName}` : "",
        levelLabel ? `Nivel: ${levelLabel}` : "",
        municipality ? `Municipio: ${municipality}` : "",
        careers.length ? `Carreras relevantes: ${careers.join(", ")}` : "",
        redirectUrl ? `redirect_url: ${redirectUrl}` : "",
      ];

      return lines.filter(Boolean).join("\n");
    })
    .join("\n\n");

  return `
Opciones educativas reales obtenidas desde la base de datos:

${formattedOffers}

Instruccion importante:
Usa solamente estas opciones educativas si vas a recomendar escuelas. No inventes ni agregues escuelas que no esten en esta lista.
`;
}

function buildMemoryContextText(memoryContext = {}) {
  const userMemorySummary = toSafeString(memoryContext?.userMemorySummary).slice(0, 1000);
  const currentChatSummary = toSafeString(memoryContext?.currentChatSummary).slice(0, 700);
  const educativeContinuitySummary = toSafeString(
    memoryContext?.educativeContinuitySummary,
  ).slice(0, 220);
  const previousChatSummaries = Array.isArray(memoryContext?.previousChatSummaries)
    ? memoryContext.previousChatSummaries
    : [];

  const previousSummariesText = previousChatSummaries
    .map((chat, index) => {
      const title = toSafeString(chat?.title);
      const summary = toSafeString(chat?.summary).slice(0, 700);

      if (!summary) {
        return "";
      }

      return `${index + 1}. ${title ? `${title}: ` : ""}${summary}`;
    })
    .filter(Boolean)
    .slice(0, 2)
    .join("\n");

  const lines = [
    userMemorySummary ? `Memoria global del usuario: ${userMemorySummary}` : "",
    currentChatSummary ? `Resumen breve de este chat: ${currentChatSummary}` : "",
    previousSummariesText ? `Resumenes breves de chats anteriores:\n${previousSummariesText}` : "",
    educativeContinuitySummary
      ? `Continuidad educativa validada: ${educativeContinuitySummary}`
      : "",
  ].filter(Boolean);

  if (!lines.length) {
    return "";
  }

  return `
Contexto resumido para continuidad, sin asumir datos no mencionados:
${lines.join("\n")}
`;
}

export const MEMORY_SUMMARY_SUCCESS_REASON = "valid_summary";

export const MEMORY_SUMMARY_FAILURE_REASONS = Object.freeze({
  INVALID_JSON: "invalid_json",
  INVALID_SCHEMA: "invalid_schema",
  EMPTY_SUMMARY: "empty_summary",
  GENERATION_ERROR: "generation_error",
  EMPTY_RESPONSE: "empty_response",
});

function createMemorySummaryFailure(reason) {
  return { ok: false, summaries: null, reason };
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function truncateUnicode(value, maxCharacters) {
  return Array.from(value.trim()).slice(0, maxCharacters).join("");
}

function extractFirstJsonObject(text) {
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (startIndex < 0) {
      if (character === "{") {
        startIndex = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return "";
}

function parseJsonCandidate(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function validateMemorySummaryPayload(payload) {
  if (!isPlainObject(payload)) {
    return createMemorySummaryFailure(
      MEMORY_SUMMARY_FAILURE_REASONS.INVALID_SCHEMA,
    );
  }

  const allowedFields = new Set(["chatSummary", "userMemorySummary"]);
  const fields = Reflect.ownKeys(payload);
  if (
    fields.some(
      (field) => typeof field !== "string" || !allowedFields.has(field),
    )
  ) {
    return createMemorySummaryFailure(
      MEMORY_SUMMARY_FAILURE_REASONS.INVALID_SCHEMA,
    );
  }

  const descriptors = Object.getOwnPropertyDescriptors(payload);
  for (const field of allowedFields) {
    const descriptor = descriptors[field];
    if (!descriptor) {
      continue;
    }
    if ("get" in descriptor || "set" in descriptor) {
      return createMemorySummaryFailure(
        MEMORY_SUMMARY_FAILURE_REASONS.INVALID_SCHEMA,
      );
    }
    if (typeof descriptor.value !== "string") {
      return createMemorySummaryFailure(
        MEMORY_SUMMARY_FAILURE_REASONS.INVALID_SCHEMA,
      );
    }
  }

  const chatSummary = truncateUnicode(descriptors.chatSummary?.value || "", 700);
  const userMemorySummary = truncateUnicode(
    descriptors.userMemorySummary?.value || "",
    1000,
  );

  if (!chatSummary && !userMemorySummary) {
    return createMemorySummaryFailure(
      MEMORY_SUMMARY_FAILURE_REASONS.EMPTY_SUMMARY,
    );
  }

  return {
    ok: true,
    summaries: { chatSummary, userMemorySummary },
    reason: MEMORY_SUMMARY_SUCCESS_REASON,
  };
}

export function parseMemorySummaryResponse(responseText) {
  const text = typeof responseText === "string" ? responseText.trim() : "";

  if (!text) {
    return createMemorySummaryFailure(
      MEMORY_SUMMARY_FAILURE_REASONS.EMPTY_RESPONSE,
    );
  }

  let parsed = parseJsonCandidate(text);

  if (parsed === undefined) {
    const fencedMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fencedMatch) {
      parsed = parseJsonCandidate(fencedMatch[1].trim());
    } else if (text.startsWith("```")) {
      return createMemorySummaryFailure(
        MEMORY_SUMMARY_FAILURE_REASONS.INVALID_JSON,
      );
    }
  }

  if (parsed === undefined) {
    const objectText = extractFirstJsonObject(text);
    if (objectText) {
      parsed = parseJsonCandidate(objectText);
    }
  }

  if (parsed === undefined) {
    return createMemorySummaryFailure(
      MEMORY_SUMMARY_FAILURE_REASONS.INVALID_JSON,
    );
  }

  return validateMemorySummaryPayload(parsed);
}

export function normalizeMemoryFinishReason(finishReason) {
  if (typeof finishReason !== "string") {
    return "UNKNOWN";
  }

  return finishReason.replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "UNKNOWN";
}

export function createMemorySummaryResultLog(
  result,
  model = GEMINI_MEMORY_MODEL,
) {
  return {
    event: "gemini_memory_summary_result",
    outcome: result.ok ? "success" : "failure",
    reason: result.reason,
    model,
    finishReason: result.metadata.finishReason,
    responseCharacterCount: result.metadata.responseCharacterCount,
    hasChatSummary: Boolean(result.ok && result.summaries.chatSummary),
    hasUserMemorySummary: Boolean(result.ok && result.summaries.userMemorySummary),
  };
}

function withMemoryMetadata(result, metadata) {
  return { ...result, metadata };
}

export function buildMemorySummaryResult(responseText, finishReason) {
  return withMemoryMetadata(parseMemorySummaryResponse(responseText), {
    finishReason: normalizeMemoryFinishReason(finishReason),
    responseCharacterCount:
      typeof responseText === "string" ? responseText.length : 0,
  });
}

function getAllowedOfferLinkIds(offerContext = []) {
  return new Set(
    (Array.isArray(offerContext) ? offerContext : [])
      .filter((offer) => toSafeString(offer?.redirectUrl || offer?.redirect_url))
      .map(getOfferId)
      .filter(Boolean),
  );
}

function extractOfferDetailIds(text) {
  const ids = [];
  let match = OFFER_DETAIL_ID_PATTERN.exec(toSafeString(text));

  while (match) {
    ids.push(match[1]);
    match = OFFER_DETAIL_ID_PATTERN.exec(toSafeString(text));
  }

  OFFER_DETAIL_ID_PATTERN.lastIndex = 0;
  return ids;
}

function hasInvalidOfferLinks(response, offerContext = []) {
  const linkedIds = extractOfferDetailIds(response);

  if (!linkedIds.length) {
    return false;
  }

  const allowedOfferLinkIds = getAllowedOfferLinkIds(offerContext);
  return linkedIds.some((id) => !allowedOfferLinkIds.has(id));
}

export function createMemorySummaryGenerator({
  apiKeys = GEMINI_API_KEYS,
  createClient = (apiKey) => new GoogleGenerativeAI(apiKey),
  modelName = GEMINI_MEMORY_MODEL,
  maxOutputTokens = GEMINI_MEMORY_MAX_OUTPUT_TOKENS,
  temperature = GEMINI_MEMORY_TEMPERATURE,
  writeUsage,
  writeContextUsage = (entry) => console.info(entry),
  writeResult = (entry) => console.info(entry),
  writeAttempt = (entry) => console.warn(entry),
} = {}) {
  const publishUsage =
    writeUsage ||
    ((_requestType, _model, usageMetadata) =>
      logGeminiUsage("memory", GEMINI_MEMORY_MODEL, usageMetadata));
  const publishResult = (result) => {
    writeResult(createMemorySummaryResultLog(result, modelName));
    return result;
  };

  return async function generateStructuredMemorySummaries({
    messages,
    currentChatSummary = "",
    userMemorySummary = "",
  } = {}) {
    const memoryContext = buildMemoryRequestContext({
      messages,
      currentChatSummary,
      userMemorySummary,
      model: modelName,
      limits: MEMORY_CONTEXT_LIMITS,
    });

    try {
      writeContextUsage(memoryContext.metrics);
    } catch {
      // Context metrics must not change memory generation behavior.
    }

    if (!memoryContext.messages.length) {
      return publishResult(
        withMemoryMetadata(
          createMemorySummaryFailure(
            MEMORY_SUMMARY_FAILURE_REASONS.EMPTY_SUMMARY,
          ),
          { finishReason: "NOT_RUN", responseCharacterCount: 0 },
        ),
      );
    }

    const prompt = memoryContext.prompt;

    for (let index = 0; index < apiKeys.length; index += 1) {
      const apiKey = apiKeys[index];

      try {
        const client = createClient(apiKey);
        const model = client.getGenerativeModel({
          model: modelName,
          systemInstruction: MEMORY_SUMMARY_PROMPT,
          generationConfig: {
            maxOutputTokens,
            temperature,
            responseMimeType: "application/json",
          },
        });
        const result = await model.generateContent({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
        });
        publishUsage("memory", modelName, result.response?.usageMetadata);
        const finishReason = normalizeMemoryFinishReason(
          result.response?.candidates?.[0]?.finishReason,
        );
        let responseText;

        try {
          responseText = result.response.text();
        } catch {
          return publishResult(
            withMemoryMetadata(
              createMemorySummaryFailure(
                MEMORY_SUMMARY_FAILURE_REASONS.GENERATION_ERROR,
              ),
              { finishReason, responseCharacterCount: 0 },
            ),
          );
        }

        return publishResult(
          buildMemorySummaryResult(responseText, finishReason),
        );
      } catch (error) {
        const recoverable = isRecoverableGeminiError(error);
        writeAttempt({
          event: "gemini_memory_generation_attempt_failed",
          keyIndex: index,
          recoverable,
        });

        if (!recoverable) {
          return publishResult(
            withMemoryMetadata(
              createMemorySummaryFailure(
                MEMORY_SUMMARY_FAILURE_REASONS.GENERATION_ERROR,
              ),
              { finishReason: "ERROR", responseCharacterCount: 0 },
            ),
          );
        }
      }
    }

    return publishResult(
      withMemoryMetadata(
        createMemorySummaryFailure(
          MEMORY_SUMMARY_FAILURE_REASONS.GENERATION_ERROR,
        ),
        { finishReason: "ERROR", responseCharacterCount: 0 },
      ),
    );
  };
}

const defaultMemorySummaryGenerator = createMemorySummaryGenerator();

export async function generateMemorySummaries(params) {
  return defaultMemorySummaryGenerator(params);
}

export async function generateAssistantReply(
  history,
  offerContext = [],
  memoryContext = {},
  options = {},
) {
  if (!GEMINI_API_KEYS.length) {
    throw new ApiError(500, "No hay API keys de Gemini configuradas");
  }

  if (options?.isEducativeRequest && (!Array.isArray(offerContext) || offerContext.length === 0)) {
    return "No encontre opciones exactas en la base con esos datos. Me dices municipio, nivel o carrera para buscar mejor?";
  }

  const requestContext = buildAssistantRequestContext({
    history,
    offerContext,
    memoryContext,
    memoryContextText: buildMemoryContextText(memoryContext),
    offerContextText: buildOfferContextText(offerContext),
    baseSystemInstruction: BASE_SYSTEM_INSTRUCTION,
    educativeOfferRules: EDUCATIVE_OFFER_RULES,
    model: GEMINI_CHAT_MODEL,
    limits: {
      limitWithSummary: GEMINI_CHAT_HISTORY_LIMIT_WITH_SUMMARY,
      limitWithoutSummary: GEMINI_CHAT_HISTORY_LIMIT_WITHOUT_SUMMARY,
      maxCharsWithSummary: GEMINI_CHAT_HISTORY_MAX_CHARS_WITH_SUMMARY,
      maxCharsWithoutSummary: GEMINI_CHAT_HISTORY_MAX_CHARS_WITHOUT_SUMMARY,
    },
  });

  console.log(requestContext.metrics);
  let lastError;

  for (let index = 0; index < GEMINI_API_KEYS.length; index += 1) {
    const apiKey = GEMINI_API_KEYS[index];

    try {
      const client = new GoogleGenerativeAI(apiKey);
      const model = client.getGenerativeModel({
        model: GEMINI_CHAT_MODEL,
        systemInstruction: requestContext.systemInstruction,
        generationConfig: {
          maxOutputTokens: GEMINI_CHAT_MAX_OUTPUT_TOKENS,
          temperature: GEMINI_CHAT_TEMPERATURE,
        },
      });

      const result = await model.generateContent({
        contents: requestContext.contents,
      });
      logGeminiUsage("conversation", GEMINI_CHAT_MODEL, result.response?.usageMetadata);

      const response = result.response.text().trim();

      console.log(`Gemini success with key index ${index}`);

      if (!response) {
        throw new Error("Gemini devolvio una respuesta vacia");
      }

      if (hasInvalidOfferLinks(response, offerContext)) {
        console.error("Gemini response blocked because it included invalid offer links");
        return INVALID_OFFER_LINK_RESPONSE;
      }

      return response;
    } catch (error) {
      lastError = error;
      console.error(`Gemini failed with key index ${index}: ${error.message}`);

      if (!isRecoverableGeminiError(error) && index < GEMINI_API_KEYS.length - 1) {
        continue;
      }

      if (!isRecoverableGeminiError(error)) {
        break;
      }
    }
  }

  throw new ApiError(
    502,
    `No fue posible obtener respuesta de Gemini. ${lastError?.message || ""}`.trim()
  );
}

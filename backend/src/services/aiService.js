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
} from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { buildAssistantRequestContext } from "./aiContextService.js";

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

const MEMORY_SUMMARY_PROMPT = `
Resume informacion persistente util del usuario para continuidad vocacional.
Guarda solo datos utiles y relativamente estables: nivel educativo, ciudad o municipio, intereses, gustos, fortalezas, areas, carreras y preferencias.
No guardes datos triviales, sensibles innecesarios ni texto enorme.
Responde solo JSON valido con esta forma:
{"chatSummary":"maximo 700 caracteres","userMemorySummary":"maximo 1000 caracteres"}
`;

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

function extractJsonFromText(text) {
  const cleanText = toSafeString(text)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const jsonMatch = cleanText.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    return null;
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
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

export async function generateMemorySummaries({
  messages,
  currentChatSummary = "",
  userMemorySummary = "",
} = {}) {
  const recentMessages = Array.isArray(messages) ? messages.slice(-12) : [];

  if (!recentMessages.length) {
    return null;
  }

  const transcript = recentMessages
    .map((message) => {
      const role = message.role === "assistant" ? "Blue" : "Usuario";
      return `${role}: ${toSafeString(message.content).slice(0, 900)}`;
    })
    .join("\n");

  const prompt = `
Resumen actual del chat:
${toSafeString(currentChatSummary) || "Sin resumen previo."}

Memoria global actual:
${toSafeString(userMemorySummary) || "Sin memoria previa."}

Mensajes recientes:
${transcript}
`;

  for (let index = 0; index < GEMINI_API_KEYS.length; index += 1) {
    const apiKey = GEMINI_API_KEYS[index];

    try {
      const client = new GoogleGenerativeAI(apiKey);
      const model = client.getGenerativeModel({
        model: GEMINI_MEMORY_MODEL,
        systemInstruction: MEMORY_SUMMARY_PROMPT,
        generationConfig: {
          maxOutputTokens: GEMINI_MEMORY_MAX_OUTPUT_TOKENS,
          temperature: GEMINI_MEMORY_TEMPERATURE,
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
      logGeminiUsage("memory", GEMINI_MEMORY_MODEL, result.response?.usageMetadata);
      const parsed = extractJsonFromText(result.response.text());

      if (!parsed) {
        return null;
      }

      return {
        chatSummary: toSafeString(parsed.chatSummary).slice(0, 700),
        userMemorySummary: toSafeString(parsed.userMemorySummary).slice(0, 1000),
      };
    } catch (error) {
      console.error(`Memory summary failed with key index ${index}: ${error.message}`);

      if (!isRecoverableGeminiError(error)) {
        return null;
      }
    }
  }

  return null;
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

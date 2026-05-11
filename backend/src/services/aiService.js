import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_API_KEYS, GEMINI_MODEL } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

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
- Si no se proporcionan opciones educativas desde la base de datos, no menciones nombres concretos de escuelas.
- Si todavia falta informacion, pregunta solo lo indispensable: nivel, area de interes o municipio.
- Cuando recomiendes escuelas, responde con formato breve:
  1. Nombre de la escuela
  2. Por que encaja
  3. Carreras relevantes, si existen
  4. Website, correo o telefono, si existe
- Si algun dato no viene en la base, omitelo. No lo inventes.
- Prioriza precision sobre cantidad.
`;

const FULL_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

${RESPONSE_STYLE_RULES}

${EDUCATIVE_OFFER_RULES}`;

const MEMORY_SUMMARY_PROMPT = `
Resume informacion persistente util del usuario para continuidad vocacional.
Guarda solo datos utiles y relativamente estables: nivel educativo, ciudad o municipio, intereses, gustos, fortalezas, areas, carreras y preferencias.
No guardes datos triviales, sensibles innecesarios ni texto enorme.
Responde solo JSON valido con esta forma:
{"chatSummary":"maximo 700 caracteres","userMemorySummary":"maximo 1000 caracteres"}
`;

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
    .slice(0, 5);

  if (offers.length === 0) {
    return "";
  }

  const formattedOffers = offers
    .map((offer, index) => {
      const name = toSafeString(offer?.name);
      const shortName = toSafeString(offer?.shortName || offer?.short_name);
      const levelLabel = toSafeString(offer?.levelLabel) || getLevelLabel(offer?.level);
      const municipality = toSafeString(offer?.municipality);
      const description = toSafeString(offer?.description);
      const address = toSafeString(offer?.address);
      const email = toSafeString(offer?.email);
      const website = toSafeString(offer?.website);
      const promotions = toSafeString(offer?.promotions || offer?.text_promo);
      const careers = normalizeCareers(offer?.careers);
      const phones = normalizePhones(offer);

      const lines = [
        `${index + 1}. ${name}`,
        shortName ? `Abreviacion: ${shortName}` : "",
        levelLabel ? `Nivel: ${levelLabel}` : "",
        municipality ? `Municipio: ${municipality}` : "",
        description ? `Descripcion: ${description}` : "",
        careers.length ? `Carreras relevantes: ${careers.join(", ")}` : "",
        address ? `Direccion: ${address}` : "",
        phones.length ? `Telefono: ${phones.join(", ")}` : "",
        email ? `Correo: ${email}` : "",
        website ? `Website: ${website}` : "",
        promotions ? `Promocion: ${promotions}` : "",
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
  ].filter(Boolean);

  if (!lines.length) {
    return "";
  }

  return `
Contexto resumido para continuidad, sin asumir datos no mencionados:
${lines.join("\n")}
`;
}

function buildContents(history, offerContext = [], memoryContext = {}) {
  const safeHistory = Array.isArray(history) ? history : [];

  const contents = safeHistory
    .filter(Boolean)
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: toSafeString(message.content) }],
    }));

  const contextBlocks = [
    buildMemoryContextText(memoryContext),
    buildOfferContextText(offerContext),
  ].filter(Boolean);
  const contextualText = contextBlocks.join("\n");

  if (!contextualText) {
    return contents;
  }

  let lastUserIndex = -1;

  for (let index = contents.length - 1; index >= 0; index -= 1) {
    if (contents[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }

  if (lastUserIndex === -1) {
    return [
      {
        role: "user",
        parts: [{ text: contextualText }],
      },
      ...contents,
    ];
  }

  const originalUserText = contents[lastUserIndex].parts
    .map((part) => part.text)
    .join("\n");

  contents[lastUserIndex] = {
    role: "user",
    parts: [
      {
        text: `${contextualText}

Mensaje actual del usuario:
${originalUserText}`,
      },
    ],
  };

  return contents;
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
        model: GEMINI_MODEL,
        systemInstruction: MEMORY_SUMMARY_PROMPT,
      });
      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
      });
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

export async function generateAssistantReply(history, offerContext = [], memoryContext = {}) {
  if (!GEMINI_API_KEYS.length) {
    throw new ApiError(500, "No hay API keys de Gemini configuradas");
  }

  let lastError;

  for (let index = 0; index < GEMINI_API_KEYS.length; index += 1) {
    const apiKey = GEMINI_API_KEYS[index];

    try {
      const client = new GoogleGenerativeAI(apiKey);
      const model = client.getGenerativeModel({
        model: GEMINI_MODEL,
        systemInstruction: FULL_SYSTEM_PROMPT,
      });

      const result = await model.generateContent({
        contents: buildContents(history, offerContext, memoryContext),
      });

      const response = result.response.text().trim();

      console.log(`Gemini success with key index ${index}`);

      if (!response) {
        throw new Error("Gemini devolvio una respuesta vacia");
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

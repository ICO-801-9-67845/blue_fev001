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

function buildContents(history) {
  return history.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
}

export async function generateAssistantReply(history) {
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
        systemInstruction: SYSTEM_PROMPT,
      });

      const result = await model.generateContent({
        contents: buildContents(history),
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

  throw new ApiError(502, `No fue posible obtener respuesta de Gemini. ${lastError?.message || ""}`.trim());
}

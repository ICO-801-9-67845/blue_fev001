import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
dotenv.config({ path: envPath });

function required(name, fallback = "") {
  const value = process.env[name] || fallback;

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function positiveInteger(name, fallback) {
  const value = Number(process.env[name]);

  return Number.isFinite(value) && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function temperature(name, fallback) {
  const value = Number(process.env[name]);

  return Number.isFinite(value) && value >= 0 && value <= 2 ? value : fallback;
}

export const NODE_ENV = process.env.NODE_ENV || "development";
export const PORT = Number(process.env.PORT || 4000);
export const DATABASE_URL = required("DATABASE_URL");
export const JWT_SECRET = required("JWT_SECRET");
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
export const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
export const GEMINI_CHAT_MODEL =
  process.env.GEMINI_CHAT_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
export const GEMINI_MEMORY_MODEL =
  process.env.GEMINI_MEMORY_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
export const GEMINI_CHAT_MAX_OUTPUT_TOKENS = positiveInteger(
  "GEMINI_CHAT_MAX_OUTPUT_TOKENS",
  300,
);
export const GEMINI_MEMORY_MAX_OUTPUT_TOKENS = positiveInteger(
  "GEMINI_MEMORY_MAX_OUTPUT_TOKENS",
  600,
);
export const GEMINI_CHAT_TEMPERATURE = temperature("GEMINI_CHAT_TEMPERATURE", 0.6);
export const GEMINI_MEMORY_TEMPERATURE = temperature("GEMINI_MEMORY_TEMPERATURE", 0.1);
export const GEMINI_API_KEYS = required("GEMINI_API_KEYS")
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);

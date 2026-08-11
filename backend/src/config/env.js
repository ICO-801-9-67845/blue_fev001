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

export function positiveInteger(name, fallback) {
  const value = Number(process.env[name]);

  return Number.isFinite(value) && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function temperature(name, fallback) {
  const value = Number(process.env[name]);

  return Number.isFinite(value) && value >= 0 && value <= 2 ? value : fallback;
}

function oneOf(name, fallback, allowedValues) {
  const value = (process.env[name] || fallback).trim().toLowerCase();

  if (!allowedValues.includes(value)) {
    throw new Error(`Invalid environment variable: ${name}`);
  }

  return value;
}

function boundedNumber(name, fallback, { min, max, integer = false }) {
  const rawValue = process.env[name];
  const value = rawValue === undefined || rawValue === "" ? fallback : Number(rawValue);

  if (
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value)) ||
    value < min ||
    value > max
  ) {
    throw new Error(`Invalid environment variable: ${name}`);
  }

  return value;
}

function frontendOrigins(primaryValue, additionalValue = "") {
  const values = [primaryValue, ...String(additionalValue || "").split(",")]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const origins = [];
  for (const value of values) {
    let parsed;
    try { parsed = new URL(value); } catch {
      throw new Error("Invalid environment variable: FRONTEND_URL");
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password ||
        (parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash) {
      throw new Error("Invalid environment variable: FRONTEND_URL");
    }
    if (!origins.includes(parsed.origin)) origins.push(parsed.origin);
  }
  if (!origins.length || origins.length > 16) {
    throw new Error("Invalid environment variable: FRONTEND_URL");
  }
  return Object.freeze(origins);
}

function ollamaBaseUrl(value, requiredForProvider) {
  const rawValue = `${value || ""}`.trim();
  if (!rawValue) {
    if (requiredForProvider) {
      throw new Error("Missing environment variable: OLLAMA_BASE_URL");
    }
    return "";
  }

  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error("Invalid environment variable: OLLAMA_BASE_URL");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Invalid environment variable: OLLAMA_BASE_URL");
  }

  return rawValue.replace(/\/+$/, "");
}

function hostHeader(value, requiredForProvider) {
  const normalized = `${value || ""}`.trim();
  if (!normalized && requiredForProvider) {
    throw new Error("Missing environment variable: OLLAMA_HOST_HEADER");
  }
  const match = normalized.match(/^([a-z0-9.-]+)(?::(\d{1,5}))?$/i);
  const port = match?.[2] ? Number(match[2]) : 0;
  if (
    normalized &&
    (!match || /[\r\n]/.test(normalized) || (match[2] && (port < 1 || port > 65535)))
  ) {
    throw new Error("Invalid environment variable: OLLAMA_HOST_HEADER");
  }
  return normalized;
}

function ollamaModel(name, fallback) {
  const value = process.env[name]?.trim() || fallback;
  if (value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Invalid environment variable: ${name}`);
  }
  return value;
}

export const NODE_ENV = process.env.NODE_ENV || "development";
export const PORT = Number(process.env.PORT || 4000);
export const DATABASE_URL = required("DATABASE_URL");
export const JWT_SECRET = required("JWT_SECRET");
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
export const FRONTEND_ORIGINS = frontendOrigins(
  process.env.FRONTEND_URL || "http://localhost:5173",
  process.env.FRONTEND_ADDITIONAL_ORIGINS,
);
export const FRONTEND_URL = FRONTEND_ORIGINS[0];
export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
export const AI_PROVIDER = oneOf("AI_PROVIDER", "gemini", ["gemini", "ollama"]);
export const AI_FALLBACK_PROVIDER = oneOf("AI_FALLBACK_PROVIDER", "none", ["none"]);
const OLLAMA_IS_ACTIVE = AI_PROVIDER === "ollama";
export const OLLAMA_BASE_URL = ollamaBaseUrl(process.env.OLLAMA_BASE_URL, OLLAMA_IS_ACTIVE);
export const OLLAMA_HOST_HEADER = hostHeader(process.env.OLLAMA_HOST_HEADER, OLLAMA_IS_ACTIVE);
export const OLLAMA_CHAT_MODEL = ollamaModel("OLLAMA_CHAT_MODEL", "qwen3:1.7b");
export const OLLAMA_MEMORY_MODEL = ollamaModel("OLLAMA_MEMORY_MODEL", "qwen3:1.7b");
export const OLLAMA_TIMEOUT_MS = boundedNumber("OLLAMA_TIMEOUT_MS", 180000, {
  min: 1000,
  max: 600000,
  integer: true,
});
export const OLLAMA_CONTEXT_LENGTH = boundedNumber("OLLAMA_CONTEXT_LENGTH", 2048, {
  min: 256,
  max: 131072,
  integer: true,
});
export const OLLAMA_CHAT_MAX_OUTPUT_TOKENS = boundedNumber(
  "OLLAMA_CHAT_MAX_OUTPUT_TOKENS",
  300,
  { min: 1, max: 8192, integer: true },
);
export const OLLAMA_MEMORY_MAX_OUTPUT_TOKENS = boundedNumber(
  "OLLAMA_MEMORY_MAX_OUTPUT_TOKENS",
  600,
  { min: 1, max: 8192, integer: true },
);
export const OLLAMA_CHAT_TEMPERATURE = boundedNumber(
  "OLLAMA_CHAT_TEMPERATURE",
  0.6,
  { min: 0, max: 2 },
);
export const OLLAMA_MEMORY_TEMPERATURE = boundedNumber(
  "OLLAMA_MEMORY_TEMPERATURE",
  0.1,
  { min: 0, max: 2 },
);
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
export const GEMINI_MEMORY_EVERY_USER_MESSAGES = positiveInteger(
  "GEMINI_MEMORY_EVERY_USER_MESSAGES",
  4,
);
export const GEMINI_MEMORY_CONTEXT_MESSAGE_LIMIT = positiveInteger(
  "GEMINI_MEMORY_CONTEXT_MESSAGE_LIMIT",
  8,
);
export const GEMINI_MEMORY_CONTEXT_MAX_CHARS = positiveInteger(
  "GEMINI_MEMORY_CONTEXT_MAX_CHARS",
  3600,
);
export const GEMINI_MEMORY_USER_MESSAGE_MAX_CHARS = positiveInteger(
  "GEMINI_MEMORY_USER_MESSAGE_MAX_CHARS",
  600,
);
export const GEMINI_MEMORY_ASSISTANT_MESSAGE_MAX_CHARS = positiveInteger(
  "GEMINI_MEMORY_ASSISTANT_MESSAGE_MAX_CHARS",
  350,
);
export const GEMINI_MEMORY_CURRENT_CHAT_SUMMARY_MAX_CHARS = positiveInteger(
  "GEMINI_MEMORY_CURRENT_CHAT_SUMMARY_MAX_CHARS",
  500,
);
export const GEMINI_MEMORY_USER_MEMORY_MAX_CHARS = positiveInteger(
  "GEMINI_MEMORY_USER_MEMORY_MAX_CHARS",
  700,
);
export const GEMINI_MEMORY_TARGET_CHAT_SUMMARY_CHARS = positiveInteger(
  "GEMINI_MEMORY_TARGET_CHAT_SUMMARY_CHARS",
  450,
);
export const GEMINI_MEMORY_TARGET_USER_MEMORY_CHARS = positiveInteger(
  "GEMINI_MEMORY_TARGET_USER_MEMORY_CHARS",
  650,
);
export const GEMINI_CHAT_HISTORY_LIMIT_WITH_SUMMARY = positiveInteger(
  "GEMINI_CHAT_HISTORY_LIMIT_WITH_SUMMARY",
  6,
);
export const GEMINI_CHAT_HISTORY_LIMIT_WITHOUT_SUMMARY = positiveInteger(
  "GEMINI_CHAT_HISTORY_LIMIT_WITHOUT_SUMMARY",
  8,
);
export const GEMINI_CHAT_HISTORY_MAX_CHARS_WITH_SUMMARY = positiveInteger(
  "GEMINI_CHAT_HISTORY_MAX_CHARS_WITH_SUMMARY",
  3200,
);
export const GEMINI_CHAT_HISTORY_MAX_CHARS_WITHOUT_SUMMARY = positiveInteger(
  "GEMINI_CHAT_HISTORY_MAX_CHARS_WITHOUT_SUMMARY",
  4800,
);
export const GEMINI_API_KEYS = required(
  "GEMINI_API_KEYS",
  AI_PROVIDER === "gemini" ? "" : "unused-while-ollama-is-active",
)
  .split(",")
  .map((key) => key.trim())
  .filter((key) => key && key !== "unused-while-ollama-is-active");

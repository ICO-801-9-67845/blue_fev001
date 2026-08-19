import { isPlainObject } from "../storage/storageUtils.js";
import {
  createInitialResume,
  isResumeStructurallyValid,
  normalizeResume,
  sanitizeResumeFilenamePart,
} from "./resumeUtils.js";

export const RESUME_BACKUP_FORMAT = "project-blue-resume-backup";
export const RESUME_BACKUP_VERSION = 1;
export const MAX_RESUME_BACKUP_BYTES = 1024 * 1024;

const RESUME_KEYS = Object.keys(createInitialResume());
const OBJECT_SECTIONS = ["basics", "objective"];
const ARRAY_SECTIONS = RESUME_KEYS.filter(
  (section) => !OBJECT_SECTIONS.includes(section),
);

function isCompatibleResumeCandidate(value) {
  if (!isPlainObject(value)) return false;

  const hasKnownSection = RESUME_KEYS.some((section) => section in value);
  if (!hasKnownSection) return false;

  const objectsAreCompatible = OBJECT_SECTIONS.every(
    (section) => !(section in value) || isPlainObject(value[section]),
  );
  const arraysAreCompatible = ARRAY_SECTIONS.every(
    (section) => !(section in value) || Array.isArray(value[section]),
  );

  return objectsAreCompatible && arraysAreCompatible;
}

export function createResumeBackup(resume, exportedAt = new Date()) {
  return {
    format: RESUME_BACKUP_FORMAT,
    version: RESUME_BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    resume: normalizeResume(resume),
  };
}

export function parseResumeBackup(text) {
  let backup;

  try {
    backup = JSON.parse(text);
  } catch (_error) {
    return {
      ok: false,
      code: "invalid-json",
      message: "El archivo no contiene JSON válido.",
    };
  }

  if (!isPlainObject(backup) || backup.format !== RESUME_BACKUP_FORMAT) {
    return {
      ok: false,
      code: "invalid-format",
      message: "Este archivo no es un respaldo válido de CV de Project Blue.",
    };
  }

  if (backup.version !== RESUME_BACKUP_VERSION) {
    return {
      ok: false,
      code: "unsupported-version",
      message: "Esta versión del respaldo no es compatible.",
    };
  }

  if (!isCompatibleResumeCandidate(backup.resume)) {
    return {
      ok: false,
      code: "invalid-resume",
      message: "Este archivo no es un respaldo válido de CV de Project Blue.",
    };
  }

  const normalizedResume = normalizeResume(backup.resume);
  if (!isResumeStructurallyValid(normalizedResume)) {
    return {
      ok: false,
      code: "invalid-resume",
      message: "Este archivo no es un respaldo válido de CV de Project Blue.",
    };
  }

  return {
    ok: true,
    resume: normalizedResume,
    exportedAt: typeof backup.exportedAt === "string" ? backup.exportedAt : "",
  };
}

export function isResumeBackupFileTooLarge(size) {
  return typeof size === "number" && size > MAX_RESUME_BACKUP_BYTES;
}

export function getResumeBackupFilename(fullName) {
  const safeName = sanitizeResumeFilenamePart(fullName);
  return safeName
    ? `CV-Backup-${safeName}.json`
    : "CV-Backup-Project-Blue.json";
}

import {
  createUserStorageKey,
  readStoredJson,
  removeStoredValue,
  writeStoredJson,
} from "./storageUtils.js";
import {
  createInitialResume,
  isResumeStructurallyValid,
  normalizeResume,
} from "../utils/resumeUtils.js";

const RESUME_STORAGE_NAMESPACE = "blue:tools:resume:v1";

function getStorageKey(userId) {
  return createUserStorageKey(RESUME_STORAGE_NAMESPACE, userId);
}

export function getResume(userId) {
  const storedResume = readStoredJson(getStorageKey(userId));

  return storedResume ? normalizeResume(storedResume) : createInitialResume();
}

export function saveResume(userId, data) {
  if (!isResumeStructurallyValid(data)) {
    return false;
  }

  return writeStoredJson(getStorageKey(userId), normalizeResume(data));
}

export function removeResume(userId) {
  return removeStoredValue(getStorageKey(userId));
}

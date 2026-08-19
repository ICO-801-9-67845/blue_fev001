import {
  createUserStorageKey,
  isPlainObject,
  readStoredJson,
  removeStoredValue,
  writeStoredJson,
} from "./storageUtils.js";

const RESUME_STORAGE_NAMESPACE = "blue:tools:resume:v1";

function createInitialResume() {
  return {
    basics: {},
    sections: [],
  };
}

function isValidResume(value) {
  return (
    isPlainObject(value) &&
    isPlainObject(value.basics) &&
    Array.isArray(value.sections)
  );
}

function getStorageKey(userId) {
  return createUserStorageKey(RESUME_STORAGE_NAMESPACE, userId);
}

export function getResume(userId) {
  const storedResume = readStoredJson(getStorageKey(userId));

  if (!isValidResume(storedResume)) {
    return createInitialResume();
  }

  return {
    basics: storedResume.basics,
    sections: storedResume.sections,
  };
}

export function saveResume(userId, data) {
  if (!isValidResume(data)) {
    return false;
  }

  return writeStoredJson(getStorageKey(userId), {
    basics: data.basics,
    sections: data.sections,
  });
}

export function removeResume(userId) {
  return removeStoredValue(getStorageKey(userId));
}

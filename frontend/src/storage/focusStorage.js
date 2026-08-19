import {
  createUserStorageKey,
  isPlainObject,
  readStoredJson,
  removeStoredValue,
  writeStoredJson,
} from "./storageUtils.js";

const FOCUS_STORAGE_NAMESPACE = "blue:tools:focus:v1";

function createInitialFocusSettings() {
  return {
    workMinutes: 20,
    restMinutes: 5,
    soundEnabled: true,
    completedSessions: 0,
  };
}

function isValidFocusSettings(value) {
  return (
    isPlainObject(value) &&
    Number.isInteger(value.workMinutes) &&
    value.workMinutes > 0 &&
    Number.isInteger(value.restMinutes) &&
    value.restMinutes >= 0 &&
    typeof value.soundEnabled === "boolean" &&
    Number.isInteger(value.completedSessions) &&
    value.completedSessions >= 0
  );
}

function getStorageKey(userId) {
  return createUserStorageKey(FOCUS_STORAGE_NAMESPACE, userId);
}

export function getFocusSettings(userId) {
  const storedSettings = readStoredJson(getStorageKey(userId));

  if (!isValidFocusSettings(storedSettings)) {
    return createInitialFocusSettings();
  }

  return {
    workMinutes: storedSettings.workMinutes,
    restMinutes: storedSettings.restMinutes,
    soundEnabled: storedSettings.soundEnabled,
    completedSessions: storedSettings.completedSessions,
  };
}

export function saveFocusSettings(userId, data) {
  if (!isValidFocusSettings(data)) {
    return false;
  }

  return writeStoredJson(getStorageKey(userId), {
    workMinutes: data.workMinutes,
    restMinutes: data.restMinutes,
    soundEnabled: data.soundEnabled,
    completedSessions: data.completedSessions,
  });
}

export function removeFocusSettings(userId) {
  return removeStoredValue(getStorageKey(userId));
}

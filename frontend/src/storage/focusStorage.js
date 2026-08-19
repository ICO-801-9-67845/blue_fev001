import {
  createUserStorageKey,
  readStoredJson,
  removeStoredValue,
  writeStoredJson,
} from "./storageUtils.js";
import {
  isValidFocusState,
  normalizeFocusState,
} from "../utils/focusUtils.js";

const FOCUS_STORAGE_NAMESPACE = "blue:tools:focus:v1";

function getStorageKey(userId) {
  return createUserStorageKey(FOCUS_STORAGE_NAMESPACE, userId);
}

export function getFocusSettings(userId) {
  const storedSettings = readStoredJson(getStorageKey(userId));
  return normalizeFocusState(storedSettings);
}

export function saveFocusSettings(userId, data) {
  if (!isValidFocusState(data)) {
    return false;
  }

  return writeStoredJson(getStorageKey(userId), data);
}

export function removeFocusSettings(userId) {
  return removeStoredValue(getStorageKey(userId));
}

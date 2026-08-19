export function createUserStorageKey(namespace, userId) {
  if (typeof userId !== "string" || !userId.trim()) {
    return null;
  }

  return `${namespace}:${userId.trim()}`;
}

export function readStoredJson(key) {
  if (!key || typeof window === "undefined") {
    return null;
  }

  try {
    const storedValue = window.localStorage.getItem(key);
    return storedValue === null ? null : JSON.parse(storedValue);
  } catch (_error) {
    return null;
  }
}

export function writeStoredJson(key, value) {
  if (!key || typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_error) {
    return false;
  }
}

export function removeStoredValue(key) {
  if (!key || typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.removeItem(key);
    return true;
  } catch (_error) {
    return false;
  }
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

import {
  createUserStorageKey,
  isPlainObject,
  readStoredJson,
  removeStoredValue,
  writeStoredJson,
} from "./storageUtils.js";
import { isValidScheduleActivity } from "../utils/scheduleUtils.js";

const SCHEDULE_STORAGE_NAMESPACE = "blue:tools:schedule:v1";

function createInitialSchedule() {
  return {
    activities: [],
  };
}

function isValidSchedule(value) {
  return (
    isPlainObject(value) &&
    Array.isArray(value.activities) &&
    value.activities.every(isValidScheduleActivity)
  );
}

function getStorageKey(userId) {
  return createUserStorageKey(SCHEDULE_STORAGE_NAMESPACE, userId);
}

export function getSchedule(userId) {
  const storedSchedule = readStoredJson(getStorageKey(userId));

  if (!isValidSchedule(storedSchedule)) {
    return createInitialSchedule();
  }

  return {
    activities: storedSchedule.activities,
  };
}

export function saveSchedule(userId, data) {
  if (!isValidSchedule(data)) {
    return false;
  }

  return writeStoredJson(getStorageKey(userId), {
    activities: data.activities,
  });
}

export function removeSchedule(userId) {
  return removeStoredValue(getStorageKey(userId));
}

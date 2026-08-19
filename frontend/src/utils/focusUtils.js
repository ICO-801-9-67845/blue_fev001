export const FOCUS_MODES = {
  work: "work",
  rest: "rest",
};

export const FOCUS_STATUSES = {
  idle: "idle",
  running: "running",
  paused: "paused",
  completed: "completed",
};

export const FOCUS_LIMITS = {
  work: { min: 1, max: 180 },
  rest: { min: 1, max: 60 },
};

const DEFAULT_WORK_MINUTES = 20;
const DEFAULT_REST_MINUTES = 5;
const VALID_MODES = new Set(Object.values(FOCUS_MODES));
const VALID_STATUSES = new Set(Object.values(FOCUS_STATUSES));
const MAX_SESSION_DURATION_MS = FOCUS_LIMITS.work.max * 60 * 1000;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNullableId(value) {
  return value === null || (typeof value === "string" && Boolean(value.trim()));
}

function normalizeMinutes(value, mode) {
  const limits = FOCUS_LIMITS[mode];
  const fallback = mode === FOCUS_MODES.work ? DEFAULT_WORK_MINUTES : DEFAULT_REST_MINUTES;

  return Number.isInteger(value) && value >= limits.min && value <= limits.max
    ? value
    : fallback;
}

function normalizeCompletedSessions(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function getFocusModeDurationMs(state, mode = state.mode) {
  const minutes = mode === FOCUS_MODES.rest ? state.restMinutes : state.workMinutes;
  return minutes * 60 * 1000;
}

export function createDefaultFocusState(baseSettings = {}) {
  const workMinutes = normalizeMinutes(baseSettings.workMinutes, FOCUS_MODES.work);
  const restMinutes = normalizeMinutes(baseSettings.restMinutes, FOCUS_MODES.rest);
  const mode = VALID_MODES.has(baseSettings.mode) ? baseSettings.mode : FOCUS_MODES.work;
  const state = {
    workMinutes,
    restMinutes,
    soundEnabled:
      typeof baseSettings.soundEnabled === "boolean" ? baseSettings.soundEnabled : true,
    completedSessions: normalizeCompletedSessions(baseSettings.completedSessions),
    mode,
    status: FOCUS_STATUSES.idle,
    endTime: null,
    remainingMs: 0,
    sessionDurationMs: 0,
    activeSessionId: null,
    lastCompletedSessionId: isNullableId(baseSettings.lastCompletedSessionId)
      ? baseSettings.lastCompletedSessionId
      : null,
  };
  const durationMs = getFocusModeDurationMs(state);

  return {
    ...state,
    remainingMs: durationMs,
    sessionDurationMs: durationMs,
  };
}

export function isValidFocusState(state) {
  if (!isPlainObject(state)) {
    return false;
  }

  const hasValidBase =
    Number.isInteger(state.workMinutes) &&
    state.workMinutes >= FOCUS_LIMITS.work.min &&
    state.workMinutes <= FOCUS_LIMITS.work.max &&
    Number.isInteger(state.restMinutes) &&
    state.restMinutes >= FOCUS_LIMITS.rest.min &&
    state.restMinutes <= FOCUS_LIMITS.rest.max &&
    typeof state.soundEnabled === "boolean" &&
    Number.isInteger(state.completedSessions) &&
    state.completedSessions >= 0 &&
    VALID_MODES.has(state.mode) &&
    VALID_STATUSES.has(state.status) &&
    Number.isInteger(state.sessionDurationMs) &&
    state.sessionDurationMs > 0 &&
    state.sessionDurationMs <= MAX_SESSION_DURATION_MS &&
    Number.isInteger(state.remainingMs) &&
    state.remainingMs >= 0 &&
    state.remainingMs <= state.sessionDurationMs &&
    isNullableId(state.activeSessionId) &&
    isNullableId(state.lastCompletedSessionId);

  if (!hasValidBase) {
    return false;
  }

  if (state.status === FOCUS_STATUSES.idle) {
    const configuredDuration = getFocusModeDurationMs(state);
    return (
      state.endTime === null &&
      state.activeSessionId === null &&
      state.sessionDurationMs === configuredDuration &&
      state.remainingMs === configuredDuration
    );
  }

  if (state.status === FOCUS_STATUSES.running) {
    return (
      Number.isInteger(state.endTime) &&
      state.endTime > 0 &&
      typeof state.activeSessionId === "string" &&
      state.remainingMs > 0
    );
  }

  if (state.status === FOCUS_STATUSES.paused) {
    return (
      state.endTime === null &&
      typeof state.activeSessionId === "string" &&
      state.remainingMs > 0
    );
  }

  return (
    state.endTime === null &&
    state.remainingMs === 0 &&
    typeof state.activeSessionId === "string" &&
    state.lastCompletedSessionId === state.activeSessionId
  );
}

export function normalizeFocusState(storedValue) {
  const fallback = createDefaultFocusState(
    isPlainObject(storedValue) ? storedValue : {},
  );

  if (!isPlainObject(storedValue) || !VALID_STATUSES.has(storedValue.status)) {
    return fallback;
  }

  const candidate = {
    workMinutes: fallback.workMinutes,
    restMinutes: fallback.restMinutes,
    soundEnabled: fallback.soundEnabled,
    completedSessions: fallback.completedSessions,
    mode: fallback.mode,
    status: storedValue.status,
    endTime: storedValue.endTime ?? null,
    remainingMs: storedValue.remainingMs,
    sessionDurationMs: storedValue.sessionDurationMs,
    activeSessionId: storedValue.activeSessionId ?? null,
    lastCompletedSessionId: isNullableId(storedValue.lastCompletedSessionId)
      ? storedValue.lastCompletedSessionId
      : null,
  };

  return isValidFocusState(candidate) ? candidate : fallback;
}

export function calculateFocusRemainingMs(endTime, now = Date.now()) {
  return Math.max(0, endTime - now);
}

export function calculateFocusProgress(sessionDurationMs, remainingMs) {
  if (!Number.isFinite(sessionDurationMs) || sessionDurationMs <= 0) {
    return 0;
  }

  const boundedRemaining = Math.min(Math.max(remainingMs, 0), sessionDurationMs);
  return (sessionDurationMs - boundedRemaining) / sessionDurationMs;
}

export function formatFocusTime(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function completeFocusSession(state) {
  if (
    state.status !== FOCUS_STATUSES.running ||
    typeof state.activeSessionId !== "string"
  ) {
    return { state, didIncrement: false, isNewCompletion: false };
  }

  const isNewCompletion = state.lastCompletedSessionId !== state.activeSessionId;
  const didIncrement = isNewCompletion && state.mode === FOCUS_MODES.work;

  return {
    state: {
      ...state,
      status: FOCUS_STATUSES.completed,
      endTime: null,
      remainingMs: 0,
      completedSessions: state.completedSessions + (didIncrement ? 1 : 0),
      lastCompletedSessionId: state.activeSessionId,
    },
    didIncrement,
    isNewCompletion,
  };
}

export function recoverFocusState(state, now = Date.now()) {
  if (state.status !== FOCUS_STATUSES.running) {
    return {
      state,
      didComplete: false,
      didIncrement: false,
      isNewCompletion: false,
    };
  }

  const remainingMs = calculateFocusRemainingMs(state.endTime, now);

  if (remainingMs > 0) {
    return {
      state: { ...state, remainingMs },
      didComplete: false,
      didIncrement: false,
      isNewCompletion: false,
    };
  }

  const completion = completeFocusSession(state);
  return {
    state: completion.state,
    didComplete: true,
    didIncrement: completion.didIncrement,
    isNewCompletion: completion.isNewCompletion,
  };
}

export function createFocusSessionId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `focus-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function playFocusCompletionSound() {
  if (typeof window === "undefined") {
    return false;
  }

  const AudioContext = window.AudioContext || window.webkitAudioContext;

  if (!AudioContext) {
    return false;
  }

  try {
    const context = new AudioContext();

    if (context.state === "suspended") {
      await context.resume();
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = context.currentTime;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, startAt);
    oscillator.frequency.setValueAtTime(880, startAt + 0.18);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.42);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.44);
    oscillator.addEventListener("ended", () => {
      context.close().catch(() => {});
    });
    return true;
  } catch (_error) {
    return false;
  }
}

import { useCallback, useEffect, useRef, useState } from "react";
import { getFocusSettings, saveFocusSettings } from "../storage/focusStorage";
import {
  calculateFocusRemainingMs,
  completeFocusSession,
  createFocusSessionId,
  FOCUS_MODES,
  FOCUS_STATUSES,
  getFocusModeDurationMs,
  playFocusCompletionSound,
  recoverFocusState,
} from "../utils/focusUtils";

const STORAGE_ERROR_MESSAGE =
  "No fue posible guardar el estado de Focus en este dispositivo. El temporizador puede continuar, pero los cambios podrían perderse al recargar.";

export function useFocusTimer(userId) {
  const [focusState, setFocusState] = useState(null);
  const [storageError, setStorageError] = useState("");
  const stateRef = useRef(null);
  const completionLockRef = useRef(null);

  const setTransientState = useCallback((nextState) => {
    stateRef.current = nextState;
    setFocusState(nextState);
  }, []);

  const persistState = useCallback(
    (nextState) => {
      setTransientState(nextState);

      const saved = saveFocusSettings(userId, nextState);
      setStorageError(saved ? "" : STORAGE_ERROR_MESSAGE);
      return saved;
    },
    [setTransientState, userId],
  );

  useEffect(() => {
    if (!userId) {
      return;
    }

    completionLockRef.current = null;
    const storedState = getFocusSettings(userId);
    const recovered = recoverFocusState(storedState, Date.now());
    setTransientState(recovered.state);

    if (recovered.didComplete) {
      const saved = saveFocusSettings(userId, recovered.state);
      setStorageError(saved ? "" : STORAGE_ERROR_MESSAGE);

      if (recovered.isNewCompletion && recovered.state.soundEnabled) {
        void playFocusCompletionSound();
      }
    } else {
      setStorageError("");
    }
  }, [setTransientState, userId]);

  const finishSession = useCallback(() => {
    const currentState = stateRef.current;

    if (
      currentState?.status !== FOCUS_STATUSES.running ||
      completionLockRef.current === currentState.activeSessionId
    ) {
      return;
    }

    completionLockRef.current = currentState.activeSessionId;
    const completion = completeFocusSession(currentState);
    persistState(completion.state);

    if (completion.isNewCompletion && completion.state.soundEnabled) {
      void playFocusCompletionSound();
    }
  }, [persistState]);

  useEffect(() => {
    if (focusState?.status !== FOCUS_STATUSES.running) {
      return undefined;
    }

    function updateVisualTime() {
      const currentState = stateRef.current;

      if (currentState?.status !== FOCUS_STATUSES.running) {
        return false;
      }

      const remainingMs = calculateFocusRemainingMs(currentState.endTime, Date.now());

      if (remainingMs === 0) {
        finishSession();
        return false;
      }

      setTransientState({ ...currentState, remainingMs });
      return true;
    }

    if (!updateVisualTime()) {
      return undefined;
    }

    const intervalId = window.setInterval(updateVisualTime, 250);
    return () => window.clearInterval(intervalId);
  }, [finishSession, focusState?.status, setTransientState]);

  const start = useCallback(() => {
    const currentState = stateRef.current;

    if (
      !currentState ||
      ![FOCUS_STATUSES.idle, FOCUS_STATUSES.completed].includes(currentState.status)
    ) {
      return;
    }

    const durationMs = getFocusModeDurationMs(currentState);
    const sessionId = createFocusSessionId();
    completionLockRef.current = null;
    persistState({
      ...currentState,
      status: FOCUS_STATUSES.running,
      endTime: Date.now() + durationMs,
      remainingMs: durationMs,
      sessionDurationMs: durationMs,
      activeSessionId: sessionId,
    });
  }, [persistState]);

  const pause = useCallback(() => {
    const currentState = stateRef.current;

    if (currentState?.status !== FOCUS_STATUSES.running) {
      return;
    }

    const remainingMs = calculateFocusRemainingMs(currentState.endTime, Date.now());

    if (remainingMs === 0) {
      finishSession();
      return;
    }

    persistState({
      ...currentState,
      status: FOCUS_STATUSES.paused,
      endTime: null,
      remainingMs,
    });
  }, [finishSession, persistState]);

  const resume = useCallback(() => {
    const currentState = stateRef.current;

    if (currentState?.status !== FOCUS_STATUSES.paused) {
      return;
    }

    persistState({
      ...currentState,
      status: FOCUS_STATUSES.running,
      endTime: Date.now() + currentState.remainingMs,
    });
  }, [persistState]);

  const reset = useCallback(() => {
    const currentState = stateRef.current;

    if (!currentState) {
      return;
    }

    const durationMs = getFocusModeDurationMs(currentState);
    completionLockRef.current = null;
    persistState({
      ...currentState,
      status: FOCUS_STATUSES.idle,
      endTime: null,
      remainingMs: durationMs,
      sessionDurationMs: durationMs,
      activeSessionId: null,
    });
  }, [persistState]);

  const selectMode = useCallback(
    (mode) => {
      const currentState = stateRef.current;

      if (
        !currentState ||
        ![FOCUS_STATUSES.idle, FOCUS_STATUSES.completed].includes(currentState.status) ||
        !Object.values(FOCUS_MODES).includes(mode)
      ) {
        return;
      }

      const nextState = { ...currentState, mode };
      const durationMs = getFocusModeDurationMs(nextState);
      completionLockRef.current = null;
      persistState({
        ...nextState,
        status: FOCUS_STATUSES.idle,
        endTime: null,
        remainingMs: durationMs,
        sessionDurationMs: durationMs,
        activeSessionId: null,
      });
    },
    [persistState],
  );

  const saveSettings = useCallback(
    (settings) => {
      const currentState = stateRef.current;

      if (
        !currentState ||
        [FOCUS_STATUSES.running, FOCUS_STATUSES.paused].includes(currentState.status)
      ) {
        return false;
      }

      const nextState = {
        ...currentState,
        ...settings,
        status: FOCUS_STATUSES.idle,
        endTime: null,
        activeSessionId: null,
      };
      const durationMs = getFocusModeDurationMs(nextState);
      completionLockRef.current = null;
      return persistState({
        ...nextState,
        remainingMs: durationMs,
        sessionDurationMs: durationMs,
      });
    },
    [persistState],
  );

  return {
    focusState,
    storageError,
    start,
    pause,
    resume,
    reset,
    selectMode,
    saveSettings,
  };
}

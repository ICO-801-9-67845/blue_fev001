import { useEffect, useState } from "react";
import FocusControls from "../components/focus/FocusControls";
import FocusResources from "../components/focus/FocusResources";
import FocusSettings from "../components/focus/FocusSettings";
import FocusTimer from "../components/focus/FocusTimer";
import FocusTodaySchedule from "../components/focus/FocusTodaySchedule";
import { useAuth } from "../hooks/useAuth";
import { useFocusTimer } from "../hooks/useFocusTimer";
import { getSchedule } from "../storage/scheduleStorage";
import { FOCUS_MODES, FOCUS_STATUSES } from "../utils/focusUtils";
import { getScheduleActivitiesForDate } from "../utils/scheduleUtils";
import "../styles/focus.css";

export default function FocusPage() {
  const { user } = useAuth();
  const [todayActivities, setTodayActivities] = useState([]);
  const {
    focusState,
    storageError,
    pause,
    reset,
    resume,
    saveSettings,
    selectMode,
    start,
  } = useFocusTimer(user.id);

  useEffect(() => {
    const schedule = getSchedule(user.id);
    setTodayActivities(getScheduleActivitiesForDate(schedule.activities, new Date()));
  }, [user.id]);

  if (!focusState) {
    return <div className="app-shell-centered">Preparando Focus...</div>;
  }

  const sessionActive = [FOCUS_STATUSES.running, FOCUS_STATUSES.paused].includes(
    focusState.status,
  );

  return (
    <section className="focus-page" aria-labelledby="focus-title">
      <header className="focus-page-heading">
        <p className="eyebrow">Herramientas Blue</p>
        <h1 id="focus-title">Focus</h1>
        <p>Concéntrate en tus sesiones de estudio o trabajo.</p>
      </header>

      {storageError ? (
        <div className="focus-storage-error" role="alert">
          <strong>No se pudieron guardar los cambios.</strong>
          <span>{storageError}</span>
        </div>
      ) : null}

      <section className="focus-console" aria-label="Temporizador Focus">
        <div className="focus-mode-selector" role="group" aria-label="Modo del temporizador">
          <button
            type="button"
            className={focusState.mode === FOCUS_MODES.work ? "active" : ""}
            aria-pressed={focusState.mode === FOCUS_MODES.work}
            disabled={sessionActive}
            onClick={() => selectMode(FOCUS_MODES.work)}
          >
            Work / Study
          </button>
          <button
            type="button"
            className={focusState.mode === FOCUS_MODES.rest ? "active" : ""}
            aria-pressed={focusState.mode === FOCUS_MODES.rest}
            disabled={sessionActive}
            onClick={() => selectMode(FOCUS_MODES.rest)}
          >
            Rest
          </button>
        </div>

        <FocusTimer
          mode={focusState.mode}
          remainingMs={focusState.remainingMs}
          sessionDurationMs={focusState.sessionDurationMs}
          status={focusState.status}
        />

        <FocusControls
          status={focusState.status}
          onPause={pause}
          onReset={reset}
          onResume={resume}
          onStart={start}
        />

        <p className="focus-session-count" aria-live="polite">
          Sesiones de enfoque completadas:{" "}
          <strong>{focusState.completedSessions}</strong>
        </p>

        <FocusSettings
          disabled={sessionActive}
          settings={focusState}
          onSave={saveSettings}
        />
      </section>

      <FocusTodaySchedule activities={todayActivities} />
      <FocusResources />
    </section>
  );
}

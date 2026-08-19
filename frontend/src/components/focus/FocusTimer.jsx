import {
  calculateFocusProgress,
  FOCUS_MODES,
  FOCUS_STATUSES,
  formatFocusTime,
} from "../../utils/focusUtils";

const MODE_LABELS = {
  [FOCUS_MODES.work]: "Work / Study",
  [FOCUS_MODES.rest]: "Rest",
};

const STATUS_LABELS = {
  [FOCUS_STATUSES.idle]: "Lista para comenzar",
  [FOCUS_STATUSES.running]: "Sesión en curso",
  [FOCUS_STATUSES.paused]: "Sesión en pausa",
  [FOCUS_STATUSES.completed]: "Sesión completada",
};

const RADIUS = 116;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function FocusTimer({ mode, remainingMs, sessionDurationMs, status }) {
  const progress = calculateFocusProgress(sessionDurationMs, remainingMs);
  const dashOffset = CIRCUMFERENCE * (1 - progress);
  const formattedTime = formatFocusTime(remainingMs);

  return (
    <div
      className={`focus-timer mode-${mode} status-${status}`}
      role="timer"
      aria-label={`${MODE_LABELS[mode]}, ${formattedTime} restantes, ${STATUS_LABELS[status]}`}
    >
      <svg className="focus-progress" viewBox="0 0 280 280" aria-hidden="true">
        <circle className="focus-progress-track" cx="140" cy="140" r={RADIUS} />
        <circle
          className="focus-progress-value"
          cx="140"
          cy="140"
          r={RADIUS}
          style={{
            strokeDasharray: CIRCUMFERENCE,
            strokeDashoffset: dashOffset,
          }}
        />
      </svg>

      <div className="focus-timer-content">
        <span className="focus-mode-label">{MODE_LABELS[mode]}</span>
        <strong className="focus-time" aria-hidden="true">
          {formattedTime}
        </strong>
        <span className="focus-status" aria-live="polite">
          {STATUS_LABELS[status]}
        </span>
      </div>
    </div>
  );
}

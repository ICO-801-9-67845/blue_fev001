import { FOCUS_STATUSES } from "../../utils/focusUtils";

export default function FocusControls({ status, onPause, onReset, onResume, onStart }) {
  return (
    <div className="focus-controls" aria-label="Controles del temporizador">
      {status === FOCUS_STATUSES.idle ? (
        <button className="primary-button focus-primary-control" type="button" onClick={onStart}>
          Iniciar
        </button>
      ) : null}

      {status === FOCUS_STATUSES.running ? (
        <>
          <button className="primary-button focus-primary-control" type="button" onClick={onPause}>
            Pausar
          </button>
          <button className="focus-secondary-control" type="button" onClick={onReset}>
            Reiniciar
          </button>
        </>
      ) : null}

      {status === FOCUS_STATUSES.paused ? (
        <>
          <button className="primary-button focus-primary-control" type="button" onClick={onResume}>
            Continuar
          </button>
          <button className="focus-secondary-control" type="button" onClick={onReset}>
            Reiniciar
          </button>
        </>
      ) : null}

      {status === FOCUS_STATUSES.completed ? (
        <>
          <button className="primary-button focus-primary-control" type="button" onClick={onStart}>
            Iniciar otra sesión
          </button>
          <button className="focus-secondary-control" type="button" onClick={onReset}>
            Reiniciar
          </button>
        </>
      ) : null}
    </div>
  );
}

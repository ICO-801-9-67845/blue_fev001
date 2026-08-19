import { useEffect, useState } from "react";
import { FOCUS_LIMITS } from "../../utils/focusUtils";

export default function FocusSettings({ disabled, settings, onSave }) {
  const [values, setValues] = useState({
    workMinutes: String(settings.workMinutes),
    restMinutes: String(settings.restMinutes),
    soundEnabled: settings.soundEnabled,
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    setValues({
      workMinutes: String(settings.workMinutes),
      restMinutes: String(settings.restMinutes),
      soundEnabled: settings.soundEnabled,
    });
    setErrors({});
  }, [settings.restMinutes, settings.soundEnabled, settings.workMinutes]);

  function handleChange(event) {
    const { checked, name, type, value } = event.target;
    setValues((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
    setErrors((current) => ({ ...current, [name]: "" }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const workMinutes = Number(values.workMinutes);
    const restMinutes = Number(values.restMinutes);
    const nextErrors = {};

    if (
      !Number.isInteger(workMinutes) ||
      workMinutes < FOCUS_LIMITS.work.min ||
      workMinutes > FOCUS_LIMITS.work.max
    ) {
      nextErrors.workMinutes = "Usa un valor entero entre 1 y 180 minutos.";
    }

    if (
      !Number.isInteger(restMinutes) ||
      restMinutes < FOCUS_LIMITS.rest.min ||
      restMinutes > FOCUS_LIMITS.rest.max
    ) {
      nextErrors.restMinutes = "Usa un valor entero entre 1 y 60 minutos.";
    }

    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    onSave({
      workMinutes,
      restMinutes,
      soundEnabled: values.soundEnabled,
    });
  }

  return (
    <form className="focus-settings" onSubmit={handleSubmit} noValidate>
      <fieldset disabled={disabled}>
        <legend>Configuración</legend>
        {disabled ? (
          <p className="focus-settings-note">Disponible al reiniciar o completar la sesión.</p>
        ) : null}

        <div className="focus-settings-fields">
          <label className="focus-setting-field" htmlFor="focus-work-minutes">
            <span>Work / Study</span>
            <span className="focus-number-input">
              <input
                id="focus-work-minutes"
                name="workMinutes"
                type="number"
                min={FOCUS_LIMITS.work.min}
                max={FOCUS_LIMITS.work.max}
                step="1"
                inputMode="numeric"
                value={values.workMinutes}
                onChange={handleChange}
                aria-invalid={Boolean(errors.workMinutes)}
                aria-describedby={errors.workMinutes ? "focus-work-error" : undefined}
                required
              />
              <small>min</small>
            </span>
            {errors.workMinutes ? (
              <small className="focus-setting-error" id="focus-work-error">
                {errors.workMinutes}
              </small>
            ) : null}
          </label>

          <label className="focus-setting-field" htmlFor="focus-rest-minutes">
            <span>Rest</span>
            <span className="focus-number-input">
              <input
                id="focus-rest-minutes"
                name="restMinutes"
                type="number"
                min={FOCUS_LIMITS.rest.min}
                max={FOCUS_LIMITS.rest.max}
                step="1"
                inputMode="numeric"
                value={values.restMinutes}
                onChange={handleChange}
                aria-invalid={Boolean(errors.restMinutes)}
                aria-describedby={errors.restMinutes ? "focus-rest-error" : undefined}
                required
              />
              <small>min</small>
            </span>
            {errors.restMinutes ? (
              <small className="focus-setting-error" id="focus-rest-error">
                {errors.restMinutes}
              </small>
            ) : null}
          </label>

          <label className="focus-sound-setting" htmlFor="focus-sound-enabled">
            <input
              id="focus-sound-enabled"
              name="soundEnabled"
              type="checkbox"
              checked={values.soundEnabled}
              onChange={handleChange}
            />
            <span>
              <strong>Sonido al finalizar</strong>
              <small>Una señal breve al completar la sesión.</small>
            </span>
          </label>
        </div>

        <button className="focus-save-settings" type="submit">
          Guardar configuración
        </button>
      </fieldset>
    </form>
  );
}

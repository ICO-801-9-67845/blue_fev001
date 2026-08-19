import { useEffect, useState } from "react";
import {
  SCHEDULE_CATEGORIES,
  SCHEDULE_DAYS,
  validateActivityDraft,
} from "../../utils/scheduleUtils";

const EMPTY_ACTIVITY = {
  title: "",
  day: "monday",
  startTime: "",
  endTime: "",
  category: "estudio",
};

function getInitialValues(activity) {
  if (!activity) {
    return EMPTY_ACTIVITY;
  }

  return {
    title: activity.title,
    day: activity.day,
    startTime: activity.startTime,
    endTime: activity.endTime,
    category: activity.category,
  };
}

export default function ScheduleForm({ activity, onCancel, onSave }) {
  const [values, setValues] = useState(() => getInitialValues(activity));
  const [errors, setErrors] = useState({});

  useEffect(() => {
    setValues(getInitialValues(activity));
    setErrors({});
  }, [activity]);

  function handleChange(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: "" }));
  }

  function handleSubmit(event) {
    event.preventDefault();

    const nextValues = {
      ...values,
      title: values.title.trim(),
    };
    const nextErrors = validateActivityDraft(nextValues);

    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    onSave(nextValues);
  }

  return (
    <section className="schedule-form-panel" aria-labelledby="activity-form-title">
      <div className="schedule-form-heading">
        <div>
          <p className="eyebrow">Actividad</p>
          <h2 id="activity-form-title">
            {activity ? "Editar actividad" : "Nueva actividad"}
          </h2>
        </div>
        <button className="schedule-icon-button" type="button" onClick={onCancel}>
          <span aria-hidden="true">×</span>
          <span className="visually-hidden">Cerrar formulario</span>
        </button>
      </div>

      <form className="schedule-form" onSubmit={handleSubmit} noValidate>
        <label className="schedule-field" htmlFor="schedule-title-input">
          <span>Título</span>
          <input
            id="schedule-title-input"
            name="title"
            type="text"
            value={values.title}
            onChange={handleChange}
            placeholder="Ej. Estudiar matemáticas"
            autoComplete="off"
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? "schedule-title-error" : undefined}
            required
          />
          {errors.title ? (
            <small className="schedule-field-error" id="schedule-title-error">
              {errors.title}
            </small>
          ) : null}
        </label>

        <label className="schedule-field" htmlFor="schedule-day-input">
          <span>Día</span>
          <select
            id="schedule-day-input"
            name="day"
            value={values.day}
            onChange={handleChange}
            aria-invalid={Boolean(errors.day)}
            aria-describedby={errors.day ? "schedule-day-error" : undefined}
            required
          >
            {SCHEDULE_DAYS.map((day) => (
              <option key={day.id} value={day.id}>
                {day.label}
              </option>
            ))}
          </select>
          {errors.day ? (
            <small className="schedule-field-error" id="schedule-day-error">
              {errors.day}
            </small>
          ) : null}
        </label>

        <div className="schedule-time-fields">
          <label className="schedule-field" htmlFor="schedule-start-input">
            <span>Inicio</span>
            <input
              id="schedule-start-input"
              name="startTime"
              type="time"
              value={values.startTime}
              onChange={handleChange}
              aria-invalid={Boolean(errors.startTime)}
              aria-describedby={errors.startTime ? "schedule-start-error" : undefined}
              required
            />
            {errors.startTime ? (
              <small className="schedule-field-error" id="schedule-start-error">
                {errors.startTime}
              </small>
            ) : null}
          </label>

          <label className="schedule-field" htmlFor="schedule-end-input">
            <span>Finalización</span>
            <input
              id="schedule-end-input"
              name="endTime"
              type="time"
              value={values.endTime}
              onChange={handleChange}
              aria-invalid={Boolean(errors.endTime)}
              aria-describedby={errors.endTime ? "schedule-end-error" : undefined}
              required
            />
            {errors.endTime ? (
              <small className="schedule-field-error" id="schedule-end-error">
                {errors.endTime}
              </small>
            ) : null}
          </label>
        </div>

        <label className="schedule-field" htmlFor="schedule-category-input">
          <span>Categoría</span>
          <select
            id="schedule-category-input"
            name="category"
            value={values.category}
            onChange={handleChange}
            aria-invalid={Boolean(errors.category)}
            aria-describedby={errors.category ? "schedule-category-error" : undefined}
            required
          >
            {SCHEDULE_CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
          {errors.category ? (
            <small className="schedule-field-error" id="schedule-category-error">
              {errors.category}
            </small>
          ) : null}
        </label>

        <div className="schedule-form-actions">
          <button className="schedule-secondary-button" type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button className="primary-button" type="submit">
            {activity ? "Guardar cambios" : "Agregar actividad"}
          </button>
        </div>
      </form>
    </section>
  );
}

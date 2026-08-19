export const SCHEDULE_DAYS = [
  { id: "monday", label: "Lunes" },
  { id: "tuesday", label: "Martes" },
  { id: "wednesday", label: "Miércoles" },
  { id: "thursday", label: "Jueves" },
  { id: "friday", label: "Viernes" },
  { id: "saturday", label: "Sábado" },
  { id: "sunday", label: "Domingo" },
];

export const SCHEDULE_CATEGORIES = [
  { id: "escuela", label: "Escuela" },
  { id: "estudio", label: "Estudio" },
  { id: "trabajo", label: "Trabajo" },
  { id: "proyecto", label: "Proyecto" },
  { id: "personal", label: "Personal" },
  { id: "descanso", label: "Descanso" },
  { id: "otro", label: "Otro" },
];

const DAY_INDEX = new Map(SCHEDULE_DAYS.map((day, index) => [day.id, index]));
const VALID_CATEGORIES = new Set(SCHEDULE_CATEGORIES.map((category) => category.id));
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function timeToMinutes(time) {
  if (!TIME_PATTERN.test(time)) {
    return null;
  }

  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function validateActivityDraft(activity) {
  const errors = {};

  if (typeof activity.title !== "string" || !activity.title.trim()) {
    errors.title = "Escribe un título para la actividad.";
  }

  if (!DAY_INDEX.has(activity.day)) {
    errors.day = "Selecciona un día válido.";
  }

  const startMinutes = timeToMinutes(activity.startTime);
  const endMinutes = timeToMinutes(activity.endTime);

  if (startMinutes === null) {
    errors.startTime = "Selecciona una hora de inicio válida.";
  }

  if (endMinutes === null) {
    errors.endTime = "Selecciona una hora de finalización válida.";
  } else if (startMinutes !== null && endMinutes <= startMinutes) {
    errors.endTime = "La hora de finalización debe ser posterior a la de inicio.";
  }

  if (!VALID_CATEGORIES.has(activity.category)) {
    errors.category = "Selecciona una categoría válida.";
  }

  return errors;
}

export function isValidScheduleActivity(activity) {
  return (
    activity !== null &&
    typeof activity === "object" &&
    !Array.isArray(activity) &&
    typeof activity.id === "string" &&
    Boolean(activity.id.trim()) &&
    Object.keys(validateActivityDraft(activity)).length === 0
  );
}

export function sortScheduleActivities(activities) {
  return [...activities].sort((first, second) => {
    const dayDifference = DAY_INDEX.get(first.day) - DAY_INDEX.get(second.day);

    if (dayDifference !== 0) {
      return dayDifference;
    }

    const startDifference = first.startTime.localeCompare(second.startTime);

    if (startDifference !== 0) {
      return startDifference;
    }

    return first.title.localeCompare(second.title, "es");
  });
}

export function findScheduleConflictIds(activities) {
  const conflictingIds = new Set();

  for (let firstIndex = 0; firstIndex < activities.length; firstIndex += 1) {
    const first = activities[firstIndex];
    const firstStart = timeToMinutes(first.startTime);
    const firstEnd = timeToMinutes(first.endTime);

    for (let secondIndex = firstIndex + 1; secondIndex < activities.length; secondIndex += 1) {
      const second = activities[secondIndex];

      if (first.day !== second.day) {
        continue;
      }

      const secondStart = timeToMinutes(second.startTime);
      const secondEnd = timeToMinutes(second.endTime);

      if (firstStart < secondEnd && secondStart < firstEnd) {
        conflictingIds.add(first.id);
        conflictingIds.add(second.id);
      }
    }
  }

  return conflictingIds;
}

export function getScheduleCategoryLabel(categoryId) {
  return (
    SCHEDULE_CATEGORIES.find((category) => category.id === categoryId)?.label || "Otro"
  );
}

export function createScheduleActivityId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `activity-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

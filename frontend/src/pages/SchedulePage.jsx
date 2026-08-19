import { useEffect, useMemo, useState } from "react";
import ScheduleDay from "../components/schedule/ScheduleDay";
import ScheduleForm from "../components/schedule/ScheduleForm";
import { useAuth } from "../hooks/useAuth";
import { getSchedule, saveSchedule } from "../storage/scheduleStorage";
import {
  createScheduleActivityId,
  findScheduleConflictIds,
  SCHEDULE_DAYS,
  sortScheduleActivities,
} from "../utils/scheduleUtils";
import "../styles/schedule.css";

export default function SchedulePage() {
  const { user } = useAuth();
  const [activities, setActivities] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState(null);
  const [persistenceError, setPersistenceError] = useState("");

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    const schedule = getSchedule(user.id);
    setActivities(sortScheduleActivities(schedule.activities));
  }, [user?.id]);

  const conflictIds = useMemo(
    () => findScheduleConflictIds(activities),
    [activities],
  );

  function persistActivities(nextActivities) {
    const sortedActivities = sortScheduleActivities(nextActivities);
    const saved = saveSchedule(user.id, { activities: sortedActivities });

    if (!saved) {
      setPersistenceError(
        "No fue posible guardar los cambios en este dispositivo. Intenta de nuevo sin cerrar esta página.",
      );
      return false;
    }

    setActivities(sortedActivities);
    setPersistenceError("");
    return true;
  }

  function handleNewActivity() {
    setEditingActivity(null);
    setFormOpen(true);
  }

  function handleEditActivity(activity) {
    setEditingActivity(activity);
    setFormOpen(true);
  }

  function handleCloseForm() {
    setEditingActivity(null);
    setFormOpen(false);
  }

  function handleSaveActivity(values) {
    const nextActivity = {
      id: editingActivity?.id || createScheduleActivityId(),
      ...values,
    };
    const nextActivities = editingActivity
      ? activities.map((activity) =>
          activity.id === editingActivity.id ? nextActivity : activity,
        )
      : [...activities, nextActivity];

    if (persistActivities(nextActivities)) {
      handleCloseForm();
    }
  }

  function handleDeleteActivity(activityId) {
    const nextActivities = activities.filter((activity) => activity.id !== activityId);

    if (persistActivities(nextActivities) && editingActivity?.id === activityId) {
      handleCloseForm();
    }
  }

  return (
    <section className="schedule-page" aria-labelledby="schedule-title">
      <header className="schedule-hero">
        <div>
          <p className="eyebrow">Herramientas Blue</p>
          <h1 id="schedule-title">Horario</h1>
          <p>Organiza tus actividades y tu semana.</p>
        </div>
        <button className="primary-button schedule-new-button" type="button" onClick={handleNewActivity}>
          Nueva actividad
        </button>
      </header>

      {persistenceError ? (
        <div className="schedule-save-error" role="alert">
          <strong>No se guardaron los cambios.</strong>
          <span>{persistenceError}</span>
        </div>
      ) : null}

      <div className={`schedule-workspace${formOpen ? " form-open" : ""}`}>
        {formOpen ? (
          <ScheduleForm
            activity={editingActivity}
            onCancel={handleCloseForm}
            onSave={handleSaveActivity}
          />
        ) : null}

        <section className="schedule-week" aria-labelledby="schedule-week-title">
          <div className="schedule-week-heading">
            <div>
              <p className="eyebrow">Vista semanal</p>
              <h2 id="schedule-week-title">Tus actividades</h2>
            </div>
            <span aria-live="polite">
              {activities.length} {activities.length === 1 ? "actividad" : "actividades"}
            </span>
          </div>

          {conflictIds.size ? (
            <div className="schedule-conflict-banner" role="status">
              <strong>Hay horarios que se superponen.</strong>
              <span>Revisa las actividades marcadas con “Conflicto de horario”.</span>
            </div>
          ) : null}

          <div className="schedule-days">
            {SCHEDULE_DAYS.map((day) => (
              <ScheduleDay
                key={day.id}
                day={day}
                activities={activities.filter((activity) => activity.day === day.id)}
                conflictIds={conflictIds}
                onDelete={handleDeleteActivity}
                onEdit={handleEditActivity}
              />
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

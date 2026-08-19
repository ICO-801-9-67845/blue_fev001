import ScheduleActivity from "./ScheduleActivity";

export default function ScheduleDay({ day, activities, conflictIds, onDelete, onEdit }) {
  const headingId = `schedule-day-${day.id}`;

  return (
    <section className="schedule-day" aria-labelledby={headingId}>
      <header className="schedule-day-heading">
        <h3 id={headingId}>{day.label}</h3>
        <span>
          {activities.length} {activities.length === 1 ? "actividad" : "actividades"}
        </span>
      </header>

      {activities.length ? (
        <div className="schedule-day-activities">
          {activities.map((activity) => (
            <ScheduleActivity
              key={activity.id}
              activity={activity}
              hasConflict={conflictIds.has(activity.id)}
              onDelete={onDelete}
              onEdit={onEdit}
            />
          ))}
        </div>
      ) : (
        <p className="schedule-day-empty">Sin actividades para este día.</p>
      )}
    </section>
  );
}

import { getScheduleCategoryLabel } from "../../utils/scheduleUtils";

export default function ScheduleActivity({ activity, hasConflict, onDelete, onEdit }) {
  return (
    <article
      className={`schedule-activity${hasConflict ? " has-conflict" : ""}`}
      data-category={activity.category}
    >
      <div className="schedule-activity-time">
        <time dateTime={activity.startTime}>{activity.startTime}</time>
        <span aria-hidden="true">—</span>
        <time dateTime={activity.endTime}>{activity.endTime}</time>
      </div>

      <div className="schedule-activity-content">
        <h4>{activity.title}</h4>
        <span className="schedule-category-label">
          {getScheduleCategoryLabel(activity.category)}
        </span>
        {hasConflict ? (
          <p className="schedule-conflict-label">
            <span aria-hidden="true">!</span> Conflicto de horario
          </p>
        ) : null}
      </div>

      <div className="schedule-activity-actions" aria-label={`Acciones para ${activity.title}`}>
        <button type="button" onClick={() => onEdit(activity)}>
          Editar
        </button>
        <button className="danger" type="button" onClick={() => onDelete(activity.id)}>
          Eliminar
        </button>
      </div>
    </article>
  );
}

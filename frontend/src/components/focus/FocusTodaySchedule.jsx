import { Link } from "react-router-dom";
import { getScheduleCategoryLabel } from "../../utils/scheduleUtils";

export default function FocusTodaySchedule({ activities }) {
  if (!activities.length) {
    return null;
  }

  return (
    <section className="focus-support-section focus-today" aria-labelledby="focus-today-title">
      <div className="focus-support-heading">
        <div>
          <p className="eyebrow">Tu día</p>
          <h2 id="focus-today-title">Horario de hoy</h2>
        </div>
        <Link to="/tools/schedule">Ver horario completo</Link>
      </div>

      <div className="focus-today-list">
        {activities.map((activity) => (
          <article
            className="focus-today-activity"
            data-category={activity.category}
            key={activity.id}
          >
            <div className="focus-today-time">
              <time dateTime={activity.startTime}>{activity.startTime}</time>
              <span aria-hidden="true">—</span>
              <time dateTime={activity.endTime}>{activity.endTime}</time>
            </div>
            <h3>{activity.title}</h3>
            <span className="focus-today-category">
              {getScheduleCategoryLabel(activity.category)}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

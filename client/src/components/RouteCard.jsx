import React from "react";
import Icon from "./Icon";
export const formatDistance = (m) =>
  `${((Number(m) || 0) / 1000).toFixed(1)} км`;
export const formatDuration = (s) => {
  const minutes = Math.round((Number(s) || 0) / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} год ${minutes % 60} хв`
    : `${minutes} хв`;
};
export default function RouteCard({
  route,
  index,
  onSelect,
  onEdit,
  onDelete,
  selected,
}) {
  return (
    <article className={"route-card " + (selected ? "selected" : "")}>
      <div className={"card-art art-" + (index % 3)}>
        <svg
          viewBox="0 0 400 120"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0 120V85L65 31l59 53 52-64 72 73 53-49 99 64v12Z"
            fill="currentColor"
            opacity=".18"
          />
          <path
            d="M0 120V111l113-53 63 50 87-42 79 40 58-18v32Z"
            fill="currentColor"
            opacity=".13"
          />
          <path
            d="m36 99 102-37 62 28 107-42"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="5 5"
          />
          <circle cx="36" cy="99" r="4" fill="currentColor" />
          <circle cx="307" cy="48" r="4" fill="currentColor" />
        </svg>
        <span
          className={"badge " + (route.state === "ready" ? "ready" : "draft")}
        >
          {route.local
            ? "На пристрої"
            : route.state === "ready"
              ? "Готовий маршрут"
              : "Чернетка"}
        </span>
      </div>
      <div className="card-body">
        <button className="card-title" onClick={() => onSelect(route)}>
          {route.name}
          <Icon name="arrow" size={17} />
        </button>
        <p>{route.description || "Ваш наступний вихід починається тут."}</p>
        <div className="card-stats">
          <span>
            <Icon name="routes" size={15} />
            {formatDistance(route.distance_m)}
          </span>
          <span>
            <Icon name="clock" size={15} />
            {formatDuration(route.duration_s)}
          </span>
          <span>
            <Icon name="pin" size={15} />
            {route.points.length}
          </span>
        </div>
        <footer>
          <span>Пішки · приблизна оцінка</span>
          <div>
            <button
              className="icon-button"
              aria-label={`Редагувати ${route.name}`}
              onClick={() => onEdit(route)}
            >
              <Icon name="edit" size={17} />
            </button>
            <button
              className="icon-button"
              aria-label={`Видалити ${route.name}`}
              onClick={() => onDelete(route)}
            >
              <Icon name="trash" size={17} />
            </button>
          </div>
        </footer>
      </div>
    </article>
  );
}

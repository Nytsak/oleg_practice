import React from "react";
import Icon from "./Icon";

const compactLabels = {
  routes: "Маршрути",
  places: "Локації",
  trips: "Подорожі",
  account: "Профіль",
  admin: "Адмін",
};

// Desktop і Mobile використовують одну карту переходів та один поточний екран.
export default function Navigation({ items, page, mobile = false }) {
  return (
    <nav
      className={mobile ? "mobile-nav" : undefined}
      aria-label={mobile ? "Мобільна навігація" : "Основна навігація"}
    >
      {items.map(([id, icon, label]) => (
        <a
          href={"#/" + id}
          key={id}
          className={page === id ? "active" : ""}
          aria-current={page === id ? "page" : undefined}
        >
          <Icon name={icon} />
          <span>{mobile ? compactLabels[id] : label}</span>
          {!mobile && page === id && <i />}
        </a>
      ))}
    </nav>
  );
}

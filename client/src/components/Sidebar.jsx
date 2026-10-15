import React from "react";
import Icon from "./Icon";
import Navigation from "./Navigation";

// Бічна панель відображає props і передає дії керуванню в App.
export default function Sidebar({ nav, page, user, onLogin, onLogout }) {
  return (
    <aside className="sidebar">
      <a href="#/routes" className="brand">
        <span>
          <Icon name="mountain" size={29} />
        </span>
        <div>
          trailway<small>ПЛАНУЙТЕ. ВИРУШАЙТЕ.</small>
        </div>
      </a>
      <div className="nav-label">ВАШ ПРОСТІР</div>
      <Navigation items={nav} page={page} />
      <div className="sidebar-bottom">
        <div className="local-tip">
          <Icon name="wifi" />
          <strong>Плани завжди поруч</strong>
          <p>
            Зберігайте маршрути на пристрої й синхронізуйте, коли є зв’язок.
          </p>
        </div>

        <div className="sidebar-user">
          <span className="avatar">{user ? user.display_name[0] : "Г"}</span>
          <div>
            <strong>{user?.display_name || "Гостьовий режим"}</strong>
            <small>
              {user?.role === "admin"
                ? "Адміністратор"
                : user
                  ? "Особистий простір"
                  : "Плани на цьому пристрої"}
            </small>
          </div>
          {user ? (
            <button
              aria-label="Вийти"
              className="icon-button"
              onClick={onLogout}
            >
              <Icon name="logout" size={18} />
            </button>
          ) : (
            <button className="text-button" onClick={onLogin}>
              Вхід
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

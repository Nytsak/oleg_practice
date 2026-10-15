import React from "react";
import Icon from "./Icon";

// Стан мережі й операції синхронізації є спільними та надходять з App.
export default function AppHeader({ online, syncing, user, pendingCount, onSync, onLogin }) {
  return (
    <header className="topbar">
      <span className="topbar-title">
        <Icon name="mountain" size={21} />
        Івано-Франківськ та околиці
      </span>
      <div>
        <span className={"connection " + (!online ? "offline" : "")}>
          <i />
          {online ? "На зв’язку" : "Офлайн"}
        </span>
        <button
          className="sync-button"
          disabled={syncing || !user}
          onClick={onSync}
        >
          <Icon name="sync" size={17} />
          <span>
            {syncing
              ? "Синхронізуємо…"
              : pendingCount
                ? `Синхронізувати (${pendingCount})`
                : "Синхронізація"}
          </span>
        </button>
        {!user && (
          <button className="primary small" onClick={onLogin}>
            Увійти
          </button>
        )}
      </div>
    </header>
  );
}

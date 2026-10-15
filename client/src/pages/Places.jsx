import React, { useState } from "react";
import Icon from "../components/Icon";
import Modal from "../components/Modal";
export default function Places({
  places,
  categories,
  admin,
  onSave,
  onDelete,
  onCreateRoute,
}) {
  const [q, setQ] = useState(""),
    [category, setCategory] = useState(""),
    [editor, setEditor] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(null);
  const items = places.filter(
    (p) =>
      (!category || String(p.category_id) === category) &&
      p.name.toLowerCase().includes(q.toLowerCase()),
  );
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave({
        ...editor,
        latitude: Number(editor.latitude),
        longitude: Number(editor.longitude),
        category_id: Number(editor.category_id),
      });
      setEditor(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {admin ? "КЕРУВАННЯ КАТАЛОГОМ" : "ВІДКРИВАЙТЕ ПРИКАРПАТТЯ"}
          </span>
          <h1>
            {admin ? "Локації адміністратора" : "Місця, до яких хочеться піти"}
          </h1>
          <p>Природа, краєвиди та історія — оберіть точки для свого плану.</p>
        </div>
        {admin && (
          <button
            className="primary"
            onClick={() =>
              setEditor({
                name: "",
                description: "",
                latitude: 48.922,
                longitude: 24.711,
                category_id: 2,
                is_visible: true,
              })
            }
          >
            <Icon name="plus" />
            Додати локацію
          </button>
        )}
      </div>
      <div className="filters">
        <div className="search-field">
          <Icon name="search" />
          <input
            aria-label="Пошук локацій"
            placeholder="Знайти локацію…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          aria-label="Категорія локацій"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Усі категорії</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="muted">{items.length} локацій</span>
      </div>
      <div className="places-grid">
        {items.map((p, i) => (
          <article className="place-card" key={p.id}>
            <div className={"place-symbol art-" + (i % 3)}>
              <Icon
                name={
                  p.category_id === 3
                    ? "mountain"
                    : p.category_id === 1
                      ? "sun"
                      : "pin"
                }
                size={36}
              />
              <span>
                {categories.find((c) => c.id === p.category_id)?.name}
              </span>
            </div>
            <div className="card-body">
              <h3>{p.name}</h3>
              <p>{p.description}</p>
              <small>
                {Number(p.latitude).toFixed(5)}° N,{" "}
                {Number(p.longitude).toFixed(5)}° E
              </small>
              <footer>
                {admin ? (
                  <>
                    <span
                      className={"badge " + (p.is_visible ? "ready" : "draft")}
                    >
                      {p.is_visible ? "Видима" : "Прихована"}
                    </span>
                    <div>
                      <button
                        className="icon-button"
                        aria-label={`Редагувати локацію ${p.name}`}
                        onClick={() => setEditor(p)}
                      >
                        <Icon name="edit" />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Видалити локацію ${p.name}`}
                        onClick={() => setConfirm(p)}
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    className="text-button"
                    onClick={() => onCreateRoute(p)}
                  >
                    Створити маршрут звідси <Icon name="arrow" size={16} />
                  </button>
                )}
              </footer>
            </div>
          </article>
        ))}
      </div>
      {!items.length && <p className="empty">Локацій за цими умовами немає.</p>}
      {editor && (
        <Modal
          title={editor.id ? "Редагування локації" : "Нова локація"}
          onClose={() => setEditor(null)}
        >
          <form onSubmit={submit}>
            <label>
              Назва локації
              <input
                required
                minLength={2}
                maxLength={160}
                value={editor.name}
                onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              />
            </label>
            <label>
              Опис
              <textarea
                rows={3}
                maxLength={4000}
                value={editor.description}
                onChange={(e) =>
                  setEditor({ ...editor, description: e.target.value })
                }
              />
            </label>
            <label>
              Категорія
              <select
                value={editor.category_id}
                onChange={(e) =>
                  setEditor({ ...editor, category_id: e.target.value })
                }
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="two-columns">
              <label>
                Широта
                <input
                  required
                  type="number"
                  step="any"
                  min="-90"
                  max="90"
                  value={editor.latitude}
                  onChange={(e) =>
                    setEditor({ ...editor, latitude: e.target.value })
                  }
                />
              </label>
              <label>
                Довгота
                <input
                  required
                  type="number"
                  step="any"
                  min="-180"
                  max="180"
                  value={editor.longitude}
                  onChange={(e) =>
                    setEditor({ ...editor, longitude: e.target.value })
                  }
                />
              </label>
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={editor.is_visible}
                onChange={(e) =>
                  setEditor({ ...editor, is_visible: e.target.checked })
                }
              />
              Показувати локацію в каталозі
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                className="secondary"
                type="button"
                onClick={() => setEditor(null)}
              >
                Скасувати
              </button>
              <button className="primary" disabled={busy}>
                Зберегти локацію
              </button>
            </div>
          </form>
        </Modal>
      )}
      {confirm && (
        <Modal title="Видалення локації" onClose={() => setConfirm(null)}>
          <p>
            Видалити «{confirm.name}»? Точки вже збережених маршрутів збережуть
            назву та координати.
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setConfirm(null)}>
              Скасувати
            </button>
            <button
              className="danger"
              onClick={async () => {
                try {
                  await onDelete(confirm.id);
                  setConfirm(null);
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              Видалити локацію
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </Modal>
      )}
    </>
  );
}

import React, { useState } from "react";
import Modal from "../components/Modal";
import RouteMap from "../components/RouteMap";
import Icon from "../components/Icon";
export function estimate(points) {
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      rad = (n) => (n * Math.PI) / 180,
      x =
        Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
        Math.cos(rad(a.latitude)) *
          Math.cos(rad(b.latitude)) *
          Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
    m += 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
  }
  return { distance_m: Math.round(m), duration_s: Math.round(m / 1.1) };
}
export default function RouteEditor({ route, places, onSave, onClose }) {
  // Чернетка форми локальна: скасування не змінює збережений маршрут у App.
  const [name, setName] = useState(route?.name || ""),
    [description, setDescription] = useState(route?.description || ""),
    [state, setState] = useState(route?.state || "draft"),
    [points, setPoints] = useState(route?.points || []),
    [place, setPlace] = useState(""),
    [manual, setManual] = useState({ label: "", lat: "", lon: "" }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const add = (p) => {
    if (points.length >= 20) {
      setError("Максимум 20 точок у маршруті.");
      return;
    }
    setPoints([...points, p]);
    setError("");
  };
  const pick = (p) =>
    add({
      ...p,
      place_id: null,
      label_snapshot: `Власна точка ${points.length + 1}`,
    });
  const move = (i, delta) => {
    const list = [...points],
      target = i + delta;
    if (target < 0 || target >= list.length) return;
    [list[i], list[target]] = [list[target], list[i]];
    setPoints(list);
  };
  const submit = async (e) => {
    e.preventDefault();
    if (
      name.trim().length < 2 ||
      !points.length ||
      (state === "ready" && points.length < 2)
    ) {
      setError(
        "Вкажіть назву та точки. Для готового маршруту потрібні щонайменше дві точки.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(
        {
          id: route?.id || crypto.randomUUID(),
          name: name.trim(),
          description: description.trim(),
          state,
          points,
          ...estimate(points),
          version: route?.version || 1,
        },
        !route,
      );
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={route ? "Редагування маршруту" : "Новий маршрут"}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <div className="editor-layout">
          <div className="editor-fields">
            <label>
              Назва маршруту
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={160}
                placeholder="Наприклад, від озера до пагорбів"
              />
            </label>
            <label>
              Короткий опис
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={4000}
                rows={2}
                placeholder="Що хочете побачити дорогою?"
              />
            </label>
            <label>
              Стан маршруту
              <select value={state} onChange={(e) => setState(e.target.value)}>
                <option value="draft">Чернетка</option>
                <option value="ready">Готовий до подорожі</option>
              </select>
            </label>
            <div className="field-heading">
              <h3>Точки маршруту</h3>
              <span>{points.length} / 20</span>
            </div>
            <div className="inline-field">
              <select
                aria-label="Локація з каталогу"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
              >
                <option value="">Оберіть локацію</option>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                className="secondary"
                type="button"
                aria-label="Додати локацію до маршруту"
                onClick={() => {
                  const p = places.find((x) => x.id === place);
                  if (p) {
                    add({
                      place_id: p.id,
                      label_snapshot: p.name,
                      latitude: Number(p.latitude),
                      longitude: Number(p.longitude),
                    });
                    setPlace("");
                  }
                }}
              >
                <Icon name="plus" />
              </button>
            </div>
            <div className="point-list">
              {points.map((p, i) => (
                <div className="point-row" key={i}>
                  <span className="point-index">{i + 1}</span>
                  <div>
                    <strong>{p.label_snapshot}</strong>
                    <small>
                      {Number(p.latitude).toFixed(5)},{" "}
                      {Number(p.longitude).toFixed(5)}
                    </small>
                  </div>
                  <div className="point-actions">
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Підняти точку ${i + 1}`}
                    >
                      <Icon name="up" size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => move(i, 1)}
                      disabled={i === points.length - 1}
                      aria-label={`Опустити точку ${i + 1}`}
                    >
                      <Icon name="down" size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() =>
                        setPoints(points.filter((_, j) => j !== i))
                      }
                      aria-label={`Видалити точку ${i + 1}`}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <details>
              <summary>Додати точку за координатами</summary>
              <label>
                Назва точки
                <input
                  value={manual.label}
                  maxLength={160}
                  onChange={(e) =>
                    setManual({ ...manual, label: e.target.value })
                  }
                />
              </label>
              <div className="two-columns">
                <label>
                  Широта
                  <input
                    type="number"
                    step="any"
                    min="-90"
                    max="90"
                    value={manual.lat}
                    onChange={(e) =>
                      setManual({ ...manual, lat: e.target.value })
                    }
                  />
                </label>
                <label>
                  Довгота
                  <input
                    type="number"
                    step="any"
                    min="-180"
                    max="180"
                    value={manual.lon}
                    onChange={(e) =>
                      setManual({ ...manual, lon: e.target.value })
                    }
                  />
                </label>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const lat = Number(manual.lat),
                    lon = Number(manual.lon);
                  if (
                    !manual.label.trim() ||
                    manual.lat === "" ||
                    manual.lon === "" ||
                    !Number.isFinite(lat) ||
                    !Number.isFinite(lon) ||
                    Math.abs(lat) > 90 ||
                    Math.abs(lon) > 180
                  ) {
                    setError("Введіть назву й коректні координати.");
                    return;
                  }
                  add({
                    place_id: null,
                    label_snapshot: manual.label.trim(),
                    latitude: lat,
                    longitude: lon,
                  });
                  setManual({ label: "", lat: "", lon: "" });
                }}
              >
                Додати точку
              </button>
            </details>
          </div>
          <div className="editor-map">
            <RouteMap points={points} onPick={pick} />
            <p className="muted">
              Порядок точок визначає план. Пунктир і тривалість є приблизною
              оцінкою; вони не враховують дороги, рельєф та доступність проходу.
            </p>
          </div>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Скасувати
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Зберігаємо…" : "Зберегти маршрут"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

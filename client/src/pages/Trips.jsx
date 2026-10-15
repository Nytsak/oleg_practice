import React, { useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import RouteMap from "../components/RouteMap";
import { formatDistance, formatDuration } from "../components/RouteCard";
import { mutate, load } from "../storage";
import { api } from "../api";
export default function Trips({ trips, user, onRefresh, notify, flush }) {
  const active = trips.find((t) => t.state !== "finished"),
    [detail, setDetail] = useState(null),
    [watching, setWatching] = useState(false),
    [gps, setGps] = useState(""),
    [busy, setBusy] = useState(false),
    watch = useRef(null),
    segment = useRef(crypto.randomUUID());
  const selected = detail?.id === active?.id ? detail : active;
  const stop = () => {
    if (watch.current !== null)
      navigator.geolocation?.clearWatch(watch.current);
    watch.current = null;
    setWatching(false);
  };
  useEffect(
    () => () => {
      if (watch.current !== null)
        navigator.geolocation?.clearWatch(watch.current);
    },
    [],
  );
  useEffect(() => {
    if (!active) return;
    api(`/trips/${active.id}`)
      .then(setDetail)
      .catch(() => {});
  }, [active?.id, active?.state]);
  const append = async (point) => {
    const id = crypto.randomUUID();
    await mutate(user.id, (data) =>
      data.trackQueue.push({ id, trip_id: active.id, points: [point] }),
    );
    setDetail((old) => ({
      ...selected,
      ...old,
      points: [...(old?.points || []), point],
    }));
  };
  const gpsStart = () => {
    if (!navigator.geolocation) {
      setGps("Браузер не підтримує геолокацію.");
      return;
    }
    segment.current = crypto.randomUUID();
    watch.current = navigator.geolocation.watchPosition(
      async (p) => {
        setGps(`Точність ${Math.round(p.coords.accuracy)} м`);
        await append({
          segment_id: segment.current,
          recorded_at: new Date(p.timestamp).toISOString(),
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy_m: Math.min(p.coords.accuracy, 99999),
        });
      },
      (e) => {
        setGps(
          e.code === 1
            ? "Доступ до геолокації заборонено. Дозвольте його в налаштуваннях браузера."
            : "Не вдалося отримати GPS.",
        );
        stop();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
    setWatching(true);
  };
  const action = async (type) => {
    setBusy(true);
    stop();
    try {
      await flush();
      const next = await api(`/trips/${active.id}/${type}`, {
        method: "POST",
        body: {},
      });
      setDetail(next);
      segment.current = crypto.randomUUID();
      await onRefresh();
      notify(
        type === "finish"
          ? "Подорож збережено в історії."
          : "Стан подорожі оновлено.",
      );
    } catch (e) {
      notify(e.message, true);
    } finally {
      setBusy(false);
    }
  };
  const demo = async () => {
    setBusy(true);
    try {
      const points = active.route_snapshot.points || [];
      if (!points.length) return;
      const data = await load(user.id),
        count = (selected?.points?.length || 0) + data.trackQueue.length;
      const p = points[count % points.length];
      await append({
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
        segment_id: segment.current,
        recorded_at: new Date().toISOString(),
        accuracy_m: 5,
      });
      await flush();
      await onRefresh();
      setGps("Демонстраційне вимірювання. Це не реальне положення.");
    } catch (e) {
      notify(e.message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ВАШІ ПРОЙДЕНІ ШЛЯХИ</span>
          <h1>Подорожі та GPS-треки</h1>
          <p>
            Зберігайте реальні проходження окремо від запланованих маршрутів.
          </p>
        </div>
      </div>
      {!user ? (
        <div className="empty">
          Увійдіть, щоб записувати подорожі та переглядати історію.
        </div>
      ) : (
        <>
          {active && (
            <section className="active-trip">
              <div>
                <span className="badge ready">
                  {active.state === "active" ? "Подорож триває" : "На паузі"}
                </span>
                <h2>{active.route_snapshot.name}</h2>
                <p>
                  Початок: {new Date(active.started_at).toLocaleString("uk-UA")}
                </p>
                <div className="card-stats">
                  <span>{formatDistance(active.distance_m)} фактично</span>
                  <span>{selected?.points?.length || 0} GPS-точок</span>
                </div>
                <div className="trip-actions">
                  {active.state === "active" ? (
                    <>
                      <button
                        className="primary"
                        onClick={watching ? stop : gpsStart}
                      >
                        <Icon name="location" />
                        {watching ? "Зупинити GPS" : "Записувати GPS"}
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => action("pause")}
                      >
                        <Icon name="pause" />
                        Пауза
                      </button>
                    </>
                  ) : (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => action("resume")}
                    >
                      <Icon name="play" />
                      Продовжити
                    </button>
                  )}
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => action("finish")}
                  >
                    <Icon name="check" />
                    Завершити
                  </button>
                </div>
                <p className="muted">
                  {gps ||
                    "GPS-точки зберігаються на пристрої й надсилаються після синхронізації."}
                </p>
                {active.state === "active" && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={demo}
                  >
                    Додати демо GPS-точку
                  </button>
                )}
                <p className="muted">
                  Для фонового запису залишайте сторінку відкритою. Дії початку,
                  паузи й завершення потребують зв’язку з сервером.
                </p>
              </div>
              <RouteMap
                points={active.route_snapshot.points || []}
                tracking={selected?.points || []}
              />
            </section>
          )}
          <div className="section-heading">
            <h2>Історія подорожей</h2>
            <span>
              {trips.filter((t) => t.state === "finished").length} завершених
            </span>
          </div>
          <div className="history-list">
            {trips
              .filter((t) => t.state === "finished")
              .map((t) => (
                <article key={t.id}>
                  <span className="history-icon">
                    <Icon name="check" />
                  </span>
                  <div>
                    <h3>{t.route_snapshot.name || "Подорож"}</h3>
                    <p>
                      {new Date(t.started_at).toLocaleDateString("uk-UA")} ·{" "}
                      {formatDuration(t.active_duration_s)}
                    </p>
                  </div>
                  <strong>{formatDistance(t.distance_m)}</strong>
                  <button
                    className="secondary"
                    onClick={async () => {
                      try {
                        setDetail(await api(`/trips/${t.id}`));
                      } catch (e) {
                        notify(e.message, true);
                      }
                    }}
                  >
                    Переглянути
                  </button>
                </article>
              ))}
          </div>
          {!trips.length && (
            <div className="empty">
              Поки немає подорожей. Відкрийте готовий маршрут і натисніть
              «Почати подорож».
            </div>
          )}
          {detail && detail.state === "finished" && (
            <section className="history-detail">
              <h3>{detail.route_snapshot.name}</h3>
              <RouteMap
                points={detail.route_snapshot.points || []}
                tracking={detail.points || []}
              />
              <p className="muted">
                {detail.points.length} вимірювань. Помаранчева лінія показує
                GPS-трек; різні сегменти не з’єднуються.
              </p>
              <button className="secondary" onClick={() => setDetail(null)}>
                Закрити перегляд
              </button>
            </section>
          )}
        </>
      )}
    </>
  );
}

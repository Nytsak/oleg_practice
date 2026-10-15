import React, { useEffect, useState, useRef } from "react";
import Icon from "./components/Icon";
import Sidebar from "./components/Sidebar";
import AppHeader from "./components/AppHeader";
import AppFooter from "./components/AppFooter";
import Navigation from "./components/Navigation";
import Modal from "./components/Modal";
import RouteMap from "./components/RouteMap";
import RouteCard, {
  formatDistance,
  formatDuration,
} from "./components/RouteCard";
import RouteEditor from "./pages/RouteEditor";
import AuthDialog from "./pages/AuthDialog";
import Places from "./pages/Places";
import Trips from "./pages/Trips";
import { api, refreshSession, setToken, SessionChangedError } from "./api";
import * as local from "./storage";
const pageFromHash = () => location.hash.slice(2) || "routes";
const remembered = () => {
  try {
    return JSON.parse(localStorage.getItem("trailway-user"));
  } catch {
    return null;
  }
};

export default function App() {
  // Спільний стан належить App; дочірні компоненти отримують дані через props.
  const [user, setUser] = useState(remembered),
    [page, setPage] = useState(pageFromHash),
    [routes, setRoutes] = useState([]),
    [places, setPlaces] = useState([]),
    [categories, setCategories] = useState([]),
    [trips, setTrips] = useState([]),
    [selected, setSelected] = useState(null),
    [editor, setEditor] = useState(null),
    [login, setLogin] = useState(false),
    [confirmation, setConfirmation] = useState(null),
    [share, setShare] = useState(null),
    [sharedRoute, setSharedRoute] = useState(null),
    [shareError, setShareError] = useState(""),
    [notice, setNotice] = useState(null),
    [online, setOnline] = useState(navigator.onLine),
    [pending, setPending] = useState([]),
    [syncing, setSyncing] = useState(false),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [routePage, setRoutePage] = useState(0),
    [adminPlaces, setAdminPlaces] = useState([]);
  const syncLock = useRef(false),
    scope = user?.id || "guest";
  const scopeRef = useRef(scope),
    renderedScope = useRef(scope);
  if (renderedScope.current !== scope) {
    scopeRef.current = scope;
    renderedScope.current = scope;
  }
  const currentScope = () => scopeRef.current === scope;
  const ensureScope = () => {
    if (!currentScope()) throw new SessionChangedError();
  };
  const scopedApi = (path, options) => {
    ensureScope();
    return api(path, options);
  };
  const notify = (message, error = false) => {
    if (currentScope()) setNotice({ message, error });
  };
  const refreshLocal = async () => {
    ensureScope();
    const data = await local.load(scope);
    ensureScope();
    setRoutes(data.routes);
    setPending(data.queue);
  };
  const all = async (endpoint) => {
    const rows = [];
    let offset = 0;
    while (true) {
      const data = await scopedApi(`${endpoint}?limit=100&offset=${offset}`);
      ensureScope();
      rows.push(...data.items);
      offset += data.items.length;
      if (offset >= data.total || !data.items.length) break;
    }
    return rows;
  };
  const refreshTrips = async () => {
    if (!user) return;
    const data = await all("/trips");
    ensureScope();
    setTrips(data);
    await local.write("trips:" + scope, data);
  };
  // Асинхронні відповіді перевіряють scope, щоб не змішати дані різних акаунтів.
  const refreshData = async () => {
    try {
      await refreshLocal();
      const cache = await local.read("catalog");
      ensureScope();
      if (cache) {
        setPlaces(cache.places);
        setCategories(cache.categories);
      }
      const savedTrips = await local.read("trips:" + scope);
      ensureScope();
      setTrips(savedTrips || []);
      const [p, c] = await Promise.all([
        all("/places"),
        scopedApi("/categories"),
      ]);
      ensureScope();
      setPlaces(p);
      setCategories(c);
      await local.write("catalog", { places: p, categories: c });
      ensureScope();
      setOnline(true);
      if (user) {
        const remote = await all("/routes");
        ensureScope();
        await local.mergeRemote(scope, remote);
        await refreshLocal();
        await refreshTrips();
        if (user.role === "admin") {
          const records = await scopedApi("/admin/places");
          ensureScope();
          setAdminPlaces(records);
        }
      }
    } catch (error) {
      if (!currentScope() || error.cancelled) return;
      if (!error.status) setOnline(false);
      else if (error.status === 401) notify(error.message, true);
    } finally {
      if (currentScope()) setLoading(false);
    }
  };
  const flush = async () => {
    if (!user || syncLock.current) return;
    ensureScope();
    syncLock.current = true;
    setSyncing(true);
    try {
      const data = await local.synchronize(scope, scopedApi);
      ensureScope();
      setPending(data.queue);
      const remote = await all("/routes");
      ensureScope();
      await local.mergeRemote(scope, remote);
      await refreshLocal();
      await refreshTrips();
      ensureScope();
      setOnline(true);
      if (data.queue.some((op) => op.error))
        notify("Є конфлікт синхронізації. Перегляньте локальні зміни.", true);
    } catch (error) {
      if (currentScope() && !error.cancelled) {
        if (!error.status) setOnline(false);
        notify(error.message, true);
      }
      throw error;
    } finally {
      syncLock.current = false;
      if (currentScope()) setSyncing(false);
    }
  };
  useEffect(() => {
    const handler = () => setPage(pageFromHash());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  useEffect(() => {
    let disposed = false;
    refreshSession()
      .then((session) => {
        if (disposed) return;
        scopeRef.current = session.user.id;
        setUser(session.user);
        localStorage.setItem("trailway-user", JSON.stringify(session.user));
      })
      .catch((error) => {
        if (!disposed && error.status === 401) {
          scopeRef.current = "guest";
          setUser(null);
          setRoutes([]);
          setTrips([]);
          setPending([]);
          localStorage.removeItem("trailway-user");
        }
      });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    setLoading(true);
    setSelected(null);
    setRoutes([]);
    setPending([]);
    setEditor(null);
    setConfirmation(null);
    setShare(null);
    setAdminPlaces([]);
    setSyncing(false);
    refreshData();
  }, [scope]);
  useEffect(() => {
    const connected = () => {
      setOnline(true);
      if (user) flush().catch(() => {});
      else refreshData();
    };
    const disconnected = () => setOnline(false);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    return () => {
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
    };
  }, [scope]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    setRoutePage(0);
  }, [search, filter]);
  useEffect(() => {
    const total = routes.filter(
      (r) =>
        (filter === "all" || r.state === filter) &&
        r.name.toLowerCase().includes(search.toLowerCase()),
    ).length;
    setRoutePage((previous) =>
      Math.min(previous, Math.max(0, Math.ceil(total / 6) - 1)),
    );
  }, [routes, search, filter]);
  useEffect(() => {
    if (!page.startsWith("share/")) return;
    let disposed = false;
    setSharedRoute(null);
    setShareError("");
    api("/shares/" + page.slice(6))
      .then((route) => {
        if (!disposed) setSharedRoute(route);
      })
      .catch((error) => {
        if (!disposed && !error.cancelled) setShareError(error.message);
      });
    return () => {
      disposed = true;
    };
  }, [page]);
  const saveRoute = async (route, isNew) => {
    const data = await local.load(scope);
    ensureScope();
    const hasPending = data.queue.some((op) => op.entity_id === route.id);
    if (user && online && !hasPending) {
      try {
        const saved = await scopedApi(
          isNew ? "/routes" : `/routes/${route.id}`,
          {
            method: isNew ? "POST" : "PUT",
            body: { ...route, base_version: route.version },
          },
        );
        ensureScope();
        await local.mutate(scope, (data) => {
          data.routes = [
            saved,
            ...data.routes.filter((r) => r.id !== route.id),
          ];
        });
        await refreshLocal();
        ensureScope();
        setSelected(route.id);
        notify("Маршрут збережено.");
        return;
      } catch (error) {
        if (error.status) throw error;
        setOnline(false);
      }
    }
    ensureScope();
    await local.saveLocal(scope, route, isNew);
    await refreshLocal();
    ensureScope();
    setSelected(route.id);
    notify(
      "Маршрут збережено на пристрої. Синхронізуйте після входу та відновлення зв’язку.",
    );
  };
  const deleteRoute = async () => {
    const route = confirmation;
    try {
      const data = await local.load(scope);
      ensureScope();
      if (
        user &&
        online &&
        !data.queue.some((op) => op.entity_id === route.id)
      ) {
        try {
          await scopedApi(`/routes/${route.id}`, { method: "DELETE" });
          ensureScope();
          await local.mutate(scope, (data) => {
            data.routes = data.routes.filter((r) => r.id !== route.id);
          });
        } catch (error) {
          if (error.status) throw error;
          ensureScope();
          await local.removeLocal(scope, route.id);
          setOnline(false);
        }
      } else await local.removeLocal(scope, route.id);
      await refreshLocal();
      ensureScope();
      setConfirmation(null);
      notify("Маршрут видалено.");
    } catch (error) {
      if (!error.cancelled) notify(error.message, true);
    }
  };
  const signedIn = async (user) => {
    scopeRef.current = user.id;
    await local.importGuests(user.id);
    localStorage.setItem("trailway-user", JSON.stringify(user));
    setUser(user);
    setNotice({
      message:
        "Вхід виконано. Гостьові плани перенесено до вашого локального сховища.",
      error: false,
    });
  };
  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST", body: {} });
    } catch (error) {
      if (!error.cancelled)
        notify("Для завершення серверної сесії потрібен зв’язок.", true);
      return;
    }
    setToken(null);
    scopeRef.current = "guest";
    localStorage.removeItem("trailway-user");
    setUser(null);
    setRoutes([]);
    setPending([]);
    setTrips([]);
    setAdminPlaces([]);
    setEditor(null);
    setConfirmation(null);
    setShare(null);
    location.hash = "#/routes";
  };
  const chosen = routes.find((r) => r.id === selected) || routes[0],
    filtered = routes.filter(
      (r) =>
        (filter === "all" || r.state === filter) &&
        r.name.toLowerCase().includes(search.toLowerCase()),
    ),
    visible = filtered.slice(routePage * 6, routePage * 6 + 6);
  const openShare = async () => {
    if (!user) {
      setLogin(true);
      return;
    }
    try {
      const token = await scopedApi(`/routes/${chosen.id}/shares`, {
        method: "POST",
        body: {},
      });
      setShare({
        ...token,
        url: location.origin + token.path,
        links: await scopedApi(`/routes/${chosen.id}/shares`),
      });
    } catch (e) {
      if (!e.cancelled) notify(e.message, true);
    }
  };
  const start = async () => {
    if (!user) {
      setLogin(true);
      return;
    }
    try {
      await flush();
      await scopedApi("/trips", {
        method: "POST",
        body: { route_id: chosen.id },
      });
      await refreshTrips();
      ensureScope();
      location.hash = "#/trips";
      notify("Подорож розпочато. Увімкніть запис GPS.");
    } catch (e) {
      if (!e.cancelled) notify(e.message, true);
    }
  };
  const savePlace = async (p) => {
    await scopedApi(p.id ? `/places/${p.id}` : "/places", {
      method: p.id ? "PUT" : "POST",
      body: p,
    });
    await refreshData();
    notify("Локацію збережено.");
  };
  const nav = [
    ["routes", "routes", "Мої маршрути"],
    ["places", "pin", "Каталог локацій"],
    ["trips", "clock", "Мої подорожі"],
    ["account", "user", "Обліковий запис"],
    ...(user?.role === "admin" ? [["admin", "edit", "Адміністрування"]] : []),
  ];

  return (
    <div className="app-shell">
      <Sidebar nav={nav} page={page} user={user}
        onLogin={() => setLogin(true)} onLogout={logout} />
      <div className="workspace">
        <AppHeader online={online} syncing={syncing} user={user}
          pendingCount={pending.length} onLogin={() => setLogin(true)}
          onSync={() => flush().then(() => notify("Синхронізацію завершено.")).catch(() => {})} />
        <main>
          {page === "routes" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">КОЖЕН МАРШРУТ — НОВА ІСТОРІЯ</span>
                  <h1>Куди вирушимо цього разу?</h1>
                  <p>Зберіть улюблені місця в маршрут. Решта — за вами.</p>
                </div>
                <button
                  className="primary"
                  onClick={() => setEditor({ route: null })}
                >
                  <Icon name="plus" />
                  Новий маршрут
                </button>
              </div>
              <section className="hero">
                <div>
                  <span className="hero-tag">
                    <Icon name="sun" size={15} /> Ближче, ніж здається
                  </span>
                  <h2>
                    Відкрийте місто
                    <br />у власному темпі.
                  </h2>
                  <p>
                    Озеро, старі вулиці чи панорама з пагорбів.
                    <br />
                    {" "}
                    Ваш наступний вихід починається з однієї точки.
                  </p>
                  <a href="#/places">
                    Переглянути локації <Icon name="arrow" size={18} />
                  </a>
                </div>
                <svg viewBox="0 0 540 240" aria-hidden="true">
                  <path
                    d="M0 240V195l95-126 55 73L235 28l92 113 66-82 147 174v7Z"
                    fill="#80a78a"
                  />
                  <path
                    d="m190 88 45-60 49 60-24-10-22 15-20-16Z"
                    fill="#e2ebe1"
                  />
                  <path
                    d="M0 240v-36l86-58 78 62 104-87 96 84 57-49 119 60v24Z"
                    fill="#44755c"
                  />
                  <path
                    d="M0 240v-32l111-39 82 51 117-46 68 43 99-24 63 26v21Z"
                    fill="#2e624e"
                  />
                  <path
                    d="M314 238c-24-17 66-29 39-43s-72-11-51-30 36-12 28-27"
                    fill="none"
                    stroke="#d2e2bf"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray="9 7"
                  />
                  <circle cx="330" cy="135" r="8" fill="#edbc78" />
                  <circle cx="330" cy="135" r="3" fill="#fff" />
                </svg>
              </section>
              <div className="overview-stats">
                <div>
                  <Icon name="routes" />
                  <strong>{routes.length}</strong>
                  <span>збережених маршрутів</span>
                </div>
                <div>
                  <Icon name="pin" />
                  <strong>{places.length}</strong>
                  <span>локацій для відкриттів</span>
                </div>
                <div>
                  <Icon name="check" />
                  <strong>
                    {trips.filter((t) => t.state === "finished").length}
                  </strong>
                  <span>завершених подорожей</span>
                </div>
              </div>
              <div className="dashboard-columns">
                <section className="routes-section">
                  <div className="section-heading">
                    <h2>Мої маршрути</h2>
                    <span>{filtered.length} планів</span>
                  </div>
                  <div className="filters route-filters">
                    <div className="search-field">
                      <Icon name="search" size={18} />
                      <input
                        aria-label="Пошук маршрутів"
                        placeholder="Пошук маршруту…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <select
                      aria-label="Стан маршрутів"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">Усі стани</option>
                      <option value="ready">Готові</option>
                      <option value="draft">Чернетки</option>
                    </select>
                  </div>
                  {loading && (
                    <p className="muted" role="status">
                      Завантажуємо маршрути…
                    </p>
                  )}
                  <div className="route-grid">
                    {visible.map((r, i) => (
                      <RouteCard
                        key={r.id}
                        route={r}
                        index={i}
                        selected={r.id === chosen?.id}
                        onSelect={(r) => setSelected(r.id)}
                        onEdit={(route) => setEditor({ route })}
                        onDelete={setConfirmation}
                      />
                    ))}
                  </div>
                  {!loading && !filtered.length && (
                    <div className="empty">
                      <Icon name="routes" size={32} />
                      <h3>
                        {search
                          ? "Маршрутів не знайдено"
                          : "Сплануйте свій перший маршрут"}
                      </h3>
                      <p>
                        {search
                          ? "Спробуйте іншу назву або стан."
                          : "Додайте локації та збережіть план на пристрої або у своєму обліковому записі."}
                      </p>
                      <button
                        className="primary"
                        onClick={() => setEditor({ route: null })}
                      >
                        Створити маршрут
                      </button>
                    </div>
                  )}
                  {filtered.length > 6 && (
                    <div className="pagination">
                      <button
                        className="secondary"
                        disabled={routePage === 0}
                        onClick={() => setRoutePage(routePage - 1)}
                      >
                        Назад
                      </button>
                      <span>
                        {routePage + 1} / {Math.ceil(filtered.length / 6)}
                      </span>
                      <button
                        className="secondary"
                        disabled={(routePage + 1) * 6 >= filtered.length}
                        onClick={() => setRoutePage(routePage + 1)}
                      >
                        Далі
                      </button>
                    </div>
                  )}
                </section>
                <aside className="route-preview">
                  <div className="section-heading">
                    <h2>На карті</h2>
                    <span className="map-live">
                      <Icon name="location" size={15} />
                    </span>
                  </div>
                  <RouteMap points={chosen?.points || []} />
                  {chosen ? (
                    <div className="preview-body">
                      <span className="eyebrow">ВАШ ПЛАН</span>
                      <h3>{chosen.name}</h3>
                      <div className="preview-stats">
                        <span>
                          <strong>{formatDistance(chosen.distance_m)}</strong>
                          <small>приблизно</small>
                        </span>
                        <span>
                          <strong>{formatDuration(chosen.duration_s)}</strong>
                          <small>пішки 4 км/год</small>
                        </span>
                      </div>
                      <ol className="preview-points">
                        {chosen.points.map((p, i) => (
                          <li key={i}>
                            <span>{i + 1}</span>
                            {p.label_snapshot}
                          </li>
                        ))}
                      </ol>
                      <div className="preview-actions">
                        <button
                          className="primary"
                          disabled={
                            chosen.state !== "ready" || chosen.local || !online
                          }
                          onClick={start}
                        >
                          <Icon name="play" size={17} />
                          Почати подорож
                        </button>
                        <button
                          className="secondary"
                          aria-label="Поділитися маршрутом"
                          disabled={chosen.local || !online}
                          onClick={openShare}
                        >
                          <Icon name="share" size={18} />
                        </button>
                      </div>
                      <p className="muted">
                        Відстань між точками оцінено за прямими лініями.
                      </p>
                    </div>
                  ) : (
                    <div className="preview-body">
                      <h3>Ваш маршрут з’явиться тут</h3>
                      <p className="muted">
                        Додайте точки з каталогу або натисніть на карту в
                        редакторі.
                      </p>
                    </div>
                  )}
                </aside>
              </div>
              {pending.some((op) => op.error) && (
                <section className="sync-conflicts">
                  <h3>Локальні зміни потребують уваги</h3>
                  {pending
                    .filter((op) => op.error)
                    .map((op) => (
                      <div key={op.client_operation_id}>
                        <p>
                          {op.payload?.name || "Маршрут"}: {op.error}
                        </p>
                        <button
                          className="secondary"
                          onClick={async () => {
                            await local.mutate(scope, (d) => {
                              d.queue = d.queue.filter(
                                (x) => x.entity_id !== op.entity_id,
                              );
                              d.routes = d.routes.filter(
                                (x) => x.id !== op.entity_id,
                              );
                            });
                            await refreshData();
                            notify("Завантажено серверну копію.");
                          }}
                        >
                          Відкинути локальні зміни та оновити
                        </button>
                      </div>
                    ))}
                </section>
              )}
            </>
          )}
          {page === "places" && (
            <Places
              places={places}
              categories={categories}
              onCreateRoute={(p) =>
                setEditor({
                  route: {
                    name: "",
                    description: "",
                    state: "draft",
                    points: [
                      {
                        place_id: p.id,
                        label_snapshot: p.name,
                        latitude: Number(p.latitude),
                        longitude: Number(p.longitude),
                      },
                    ],
                  },
                  fromPlace: true,
                })
              }
            />
          )}{" "}
          {page === "admin" && user?.role === "admin" && (
            <Places
              places={adminPlaces}
              categories={categories}
              admin
              onSave={savePlace}
              onDelete={async (id) => {
                await api(`/places/${id}`, { method: "DELETE" });
                await refreshData();
                notify("Локацію видалено.");
              }}
            />
          )}
          {page === "trips" && (
            <Trips
              key={scope}
              trips={trips}
              user={user}
              onRefresh={refreshTrips}
              notify={notify}
              flush={flush}
            />
          )}{" "}
          {page === "account" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">ВАШ ПРОСТІР</span>
                  <h1>Обліковий запис</h1>
                  <p>Маршрути, локальні зміни та стан синхронізації.</p>
                </div>
              </div>
              <section className="account-panel">
                <span className="avatar large">
                  {user?.display_name[0] || "Г"}
                </span>
                <h2>{user?.display_name || "Гостьовий режим"}</h2>
                <p>
                  {user?.email ||
                    "Гостьові плани зберігаються тільки на цьому пристрої."}
                </p>
                <p className="muted">
                  {user?.role === "admin"
                    ? "Адміністратор каталогу"
                    : user
                      ? "Турист"
                      : "Увійдіть, щоб перенести гостьові маршрути до облікового запису."}
                </p>
                <p>
                  Змін у черзі: <strong>{pending.length}</strong>
                </p>
                {user ? (
                  <div className="trip-actions">
                    <button
                      className="primary"
                      disabled={syncing}
                      onClick={() => flush().catch(() => {})}
                    >
                      Синхронізувати
                    </button>
                    <button className="secondary" onClick={logout}>
                      Вийти з облікового запису
                    </button>
                  </div>
                ) : (
                  <button className="primary" onClick={() => setLogin(true)}>
                    Увійти або зареєструватися
                  </button>
                )}
              </section>
              <p className="muted account-note">
                Маршрути та незавершені зміни зберігаються в цьому браузері.
                Синхронізуйте їх перед виходом і використовуйте власний пристрій
                для особистих маршрутів.
              </p>
            </>
          )}
          {page.startsWith("share/") && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">МАРШРУТ, ЯКИМ ПОДІЛИЛИСЯ</span>
                  <h1>{sharedRoute?.name || "Поширений маршрут"}</h1>
                  <p>{sharedRoute?.description}</p>
                </div>
              </div>
              {shareError ? (
                <p className="error" role="alert">
                  {shareError}
                </p>
              ) : sharedRoute ? (
                <section className="shared-detail">
                  <RouteMap points={sharedRoute.points} />
                  <div>
                    <h2>Точки маршруту</h2>
                    {sharedRoute.points.map((p, i) => (
                      <p key={i}>
                        {i + 1}. {p.label_snapshot}
                      </p>
                    ))}
                    <p>
                      {formatDistance(sharedRoute.distance_m)} ·{" "}
                      {formatDuration(sharedRoute.duration_s)} приблизно
                    </p>
                    <button
                      className="primary"
                      onClick={() => {
                        setEditor({
                          route: {
                            ...sharedRoute,
                            id: undefined,
                            name: sharedRoute.name + " — копія",
                          },
                          fromPlace: true,
                        });
                      }}
                    >
                      Зберегти власну копію
                    </button>
                  </div>
                </section>
              ) : (
                <p>Завантажуємо маршрут…</p>
              )}
            </>
          )}
          {!["routes", "places", "trips", "account"].includes(page) &&
            !page.startsWith("share/") &&
            !(page === "admin" && user?.role === "admin") && (
              <div className="empty">
                Сторінка недоступна.{" "}
                <a href="#/routes">Повернутися до маршрутів</a>
              </div>
            )}
        </main>
        <AppFooter />
      </div>
      <Navigation items={nav} page={page} mobile />
      {notice && (
        <div
          className={"toast " + (notice.error ? "toast-error" : "")}
          role={notice.error ? "alert" : "status"}
        >
          <Icon name={notice.error ? "close" : "check"} />
          <span>{notice.message}</span>
          <button
            className="icon-button"
            aria-label="Закрити повідомлення"
            onClick={() => setNotice(null)}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {editor && (
        <RouteEditor
          route={editor.route}
          places={places}
          onClose={() => setEditor(null)}
          onSave={(r, isNew) => saveRoute(r, editor.fromPlace ? true : isNew)}
        />
      )}{" "}
      {login && (
        <AuthDialog onSuccess={signedIn} onClose={() => setLogin(false)} />
      )}{" "}
      {confirmation && (
        <Modal title="Видалити маршрут" onClose={() => setConfirmation(null)}>
          <p>
            Видалити «{confirmation.name}»? Завершені подорожі збережуться в
            історії.
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setConfirmation(null)}>
              Скасувати
            </button>
            <button className="danger" onClick={deleteRoute}>
              Видалити маршрут
            </button>
          </div>
        </Modal>
      )}
      {share && (
        <Modal title="Поділіться маршрутом" onClose={() => setShare(null)}>
          <p>
            Будь-хто з цим посиланням зможе переглянути маршрут протягом семи
            днів.
          </p>
          <label>
            Посилання
            <input
              readOnly
              value={share.url}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button
            className="primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(share.url);
                notify("Посилання скопійовано.");
              } catch {
                notify("Виділіть посилання та скопіюйте його вручну.");
              }
            }}
          >
            Скопіювати посилання
          </button>
          <h3>Створені посилання</h3>
          {share.links.map((link) => (
            <div className="share-row" key={link.id}>
              <span>
                {new Date(link.created_at).toLocaleDateString("uk-UA")} ·{" "}
                {link.revoked_at ? "Відкликано" : "Чинне"}
              </span>
              <button
                className="secondary"
                disabled={!!link.revoked_at}
                onClick={async () => {
                  try {
                    await api(`/routes/${chosen.id}/shares/${link.id}`, {
                      method: "DELETE",
                    });
                    setShare({
                      ...share,
                      links: await api(`/routes/${chosen.id}/shares`),
                    });
                  } catch (e) {
                    notify(e.message, true);
                  }
                }}
              >
                Відкликати
              </button>
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}

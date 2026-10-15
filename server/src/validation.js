import { requireValue } from "./errors.js";
import { RouteState } from "./models.js";
export function object(value, label = "data") {
  requireValue(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `Поле ${label} має бути JSON-об’єктом.`,
    { [label]: "Потрібен об’єкт." },
  );
  return value;
}
export function uuid(value, label = "id") {
  requireValue(
    typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      ),
    `Некоректний ${label}.`,
  );
  return value;
}
export function text(value, label, min, max) {
  requireValue(typeof value === "string", `Поле ${label} має бути текстом.`);
  const out = value.trim();
  requireValue(
    out.length >= min && out.length <= max,
    `Поле ${label}: від ${min} до ${max} символів.`,
    { [label]: `Дозволено ${min}–${max} символів.` },
  );
  return out;
}
export function number(value, label, min, max) {
  requireValue(
    typeof value === "number" &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max,
    `Поле ${label}: число від ${min} до ${max}.`,
  );
  return value;
}
export function integer(value, label, min, max) {
  number(value, label, min, max);
  requireValue(Number.isInteger(value), `${label} має бути цілим числом.`);
  return value;
}
export function account(body, register = false) {
  const email = text(body.email, "email", 3, 254).toLowerCase();
  requireValue(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    "Введіть коректну електронну адресу.",
    { email: "Некоректна адреса." },
  );
  const password = body.password;
  requireValue(
    typeof password === "string" &&
      password.length >= 10 &&
      password.length <= 128,
    "Пароль має містити від 10 до 128 символів.",
    { password: "Мінімум 10 символів." },
  );
  return {
    email,
    password,
    ...(register
      ? { display_name: text(body.display_name, "display_name", 2, 100) }
      : {}),
  };
}
export function routeInput(body) {
  object(body, "route");
  const name = text(body.name, "name", 2, 160),
    description = text(body.description ?? "", "description", 0, 4000);
  const state = body.state ?? "draft";
  requireValue(Object.values(RouteState).includes(state), "Невідомий стан маршруту.");
  requireValue(
    Array.isArray(body.points) &&
      body.points.length >= 1 &&
      body.points.length <= 20,
    "Додайте від 1 до 20 точок.",
  );
  requireValue(
    state !== "ready" || body.points.length >= 2,
    "Готовий маршрут потребує щонайменше двох точок.",
  );
  const points = body.points.map((p, index) => {
    object(p, `points[${index}]`);
    return {
      place_id: p.place_id ? uuid(p.place_id, "place_id") : null,
      label_snapshot: text(p.label_snapshot, "label_snapshot", 1, 160),
      latitude: number(p.latitude, "latitude", -90, 90),
      longitude: number(p.longitude, "longitude", -180, 180),
    };
  });
  return { name, description, state, points };
}
export function placeInput(body) {
  requireValue(
    typeof (body.is_visible ?? true) === "boolean",
    "is_visible має бути boolean.",
  );
  return {
    name: text(body.name, "name", 2, 160),
    description: text(body.description ?? "", "description", 0, 4000),
    category_id: integer(body.category_id, "category_id", 1, 32767),
    latitude: number(body.latitude, "latitude", -90, 90),
    longitude: number(body.longitude, "longitude", -180, 180),
    is_visible: body.is_visible ?? true,
  };
}
export function pagination(query) {
  const limit = Number(query.limit ?? 50),
    offset = Number(query.offset ?? 0);
  integer(limit, "limit", 1, 100);
  integer(offset, "offset", 0, 1000000);
  return { limit, offset };
}

import { mkdir, writeFile } from "node:fs/promises";
import { openapi } from "../server/src/openapi.js";

const directory = new URL("../docs/api/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("openapi.json", directory), JSON.stringify(openapi, null, 2) + "\n");
const item = [];
function request(name, method, path, { body, status = 200, public: anonymous = false, capture = {} } = {}) {
  const checks = [`pm.test("HTTP ${status}", () => pm.response.to.have.status(${status}));`];
  if (Object.keys(capture).length) {
    checks.push("if (pm.response.code < 300) { const data = pm.response.json();");
    for (const [variable, field] of Object.entries(capture)) checks.push(`pm.collectionVariables.set(${JSON.stringify(variable)}, data.${field});`);
    checks.push("}");
  }
  item.push({ name, request: { method, auth: anonymous ? { type: "noauth" } : { type: "bearer", bearer: [{ key: "token", value: "{{access_token}}", type: "string" }] }, header: body ? [{ key: "Content-Type", value: "application/json" }] : [], url: "{{base_url}}" + path, ...(body ? { body: { mode: "raw", raw: JSON.stringify(body, null, 2).replace(/"\{\{route_version\}\}"/g, "{{route_version}}"), options: { raw: { language: "json" } } } } : {}) }, event: [{ listen: "test", script: { type: "text/javascript", exec: checks } }] });
}
const points = [{ label_snapshot: "Міське озеро", latitude: 48.91412, longitude: 24.68918 }, { label_snapshot: "Парк Шевченка", latitude: 48.91194, longitude: 24.69895 }];
const route = { name: "Перевірка REST API", description: "Маршрут із колекції Postman", state: "ready", points };
request("Стан API", "GET", "/health", { public: true });
request("Вхід туриста", "POST", "/auth/login", { public: true, body: { email: "oleh@example.com", password: "Tourist2026!" }, capture: { access_token: "access_token" } });
request("Поточний користувач", "GET", "/auth/me");
request("Каталог", "GET", "/places?limit=10&offset=0", { public: true });
request("Створити маршрут", "POST", "/routes", { status: 201, body: route, capture: { route_id: "id", route_version: "version" } });
request("Прочитати маршрут", "GET", "/routes/{{route_id}}");
request("Оновити маршрут", "PUT", "/routes/{{route_id}}", { body: { ...route, name: "Оновлений маршрут REST API", base_version: "{{route_version}}" }, capture: { route_version: "version" } });
request("Поширити маршрут", "POST", "/routes/{{route_id}}/shares", { status: 201, capture: { share_id: "id", share_token: "token" } });
request("Анонімний перегляд", "GET", "/shares/{{share_token}}", { public: true });
request("Почати подорож", "POST", "/trips", { status: 201, body: { route_id: "{{route_id}}" }, capture: { trip_id: "id" } });
request("Пауза", "POST", "/trips/{{trip_id}}/pause");
request("Продовження", "POST", "/trips/{{trip_id}}/resume");
request("Завершення", "POST", "/trips/{{trip_id}}/finish");
request("Історія подорожей", "GET", "/trips?limit=10&offset=0");
request("Відкликати посилання", "DELETE", "/routes/{{route_id}}/shares/{{share_id}}", { status: 204 });
request("Видалити маршрут", "DELETE", "/routes/{{route_id}}", { status: 204 });
request("Повторне видалення", "DELETE", "/routes/{{route_id}}", { status: 204 });
request("Оновлення сесії через cookie", "POST", "/auth/refresh", { public: true, capture: { access_token: "access_token" } });
request("Вихід", "POST", "/auth/logout", { public: true, status: 204 });
const collection = { info: { name: "Trailway Labs 8–10", description: "Запустіть npm start, імпортуйте колекцію та виконуйте запити по порядку. Postman зберігає HttpOnly cookie у cookie jar; access_token, UUID і version передаються автоматично. Колекція створює власний маршрут і видаляє його; завершена подорож лишається в історії.", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, variable: [{ key: "base_url", value: "http://localhost:3001/api" }, { key: "access_token", value: "" }, { key: "route_id", value: "" }, { key: "route_version", value: "1" }, { key: "trip_id", value: "" }, { key: "share_id", value: "" }, { key: "share_token", value: "" }], item };
await writeFile(new URL("Trailway.postman_collection.json", directory), JSON.stringify(collection, null, 2) + "\n");
console.log(`Exported OpenAPI and ${item.length} Postman requests to docs/api.`);

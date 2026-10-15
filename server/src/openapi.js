const object = (properties, required = []) => ({
  type: "object",
  properties,
  required,
});
const str = (example) => ({ type: "string", ...(example ? { example } : {}) });
const num = { type: "number" };
const point = object(
  {
    place_id: { type: "string", format: "uuid", nullable: true },
    label_snapshot: str("Міське озеро"),
    latitude: { ...num, minimum: -90, maximum: 90, example: 48.91412 },
    longitude: { ...num, minimum: -180, maximum: 180, example: 24.68918 },
  },
  ["label_snapshot", "latitude", "longitude"],
);
const route = object(
  {
    id: { type: "string", format: "uuid" },
    name: { ...str("Мій маршрут"), minLength: 2, maxLength: 160 },
    description: { ...str("Прогулянка містом"), maxLength: 4000 },
    state: { type: "string", enum: ["draft", "ready"], example: "draft" },
    points: { type: "array", minItems: 1, maxItems: 20, items: point },
    base_version: { type: "integer", minimum: 1, example: 1 },
  },
  ["name", "points"],
);
const place = object(
  {
    name: str("Локація"),
    description: str("Опис"),
    category_id: { type: "integer", example: 2 },
    latitude: { ...num, minimum: -90, maximum: 90 },
    longitude: { ...num, minimum: -180, maximum: 180 },
    is_visible: { type: "boolean", default: true },
  },
  ["name", "category_id", "latitude", "longitude"],
);
export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "Trailway REST API",
    version: "1.1.0",
    description:
      "Туристичні маршрути. Login повертає access_token; вставте його в Authorize. Refresh-token зберігається в HttpOnly cookie. Відстань плану є оцінкою за прямими лініями.",
  },
  servers: [{ url: "/api" }],
  paths: {},
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      RouteInput: route,
      PlaceInput: place,
      Error: object({
        status: { type: "integer" },
        message: str(),
        fields: { type: "object" },
        requestId: str(),
      }, ["status", "message", "fields", "requestId"]),
    },
  },
};
function add(
  path,
  method,
  summary,
  { auth = false, schema, status = 200, params = [] } = {},
) {
  const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({
    name: m[1],
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
  openapi.paths[path] ??= {};
  openapi.paths[path][method] = {
    summary,
    tags: [path.split("/")[1]],
    ...(auth ? { security: [{ bearerAuth: [] }] } : {}),
    parameters: [
      ...parameters,
      ...params.map((name) => ({
        name,
        in: "query",
        schema: {
          type:
            name === "limit" || name === "offset" || name === "category"
              ? "integer"
              : "string",
        },
      })),
    ],
    ...(schema
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema } },
          },
        }
      : {}),
    responses: {
      [status]: { description: status === 204 ? "Без тіла" : "Успіх" },
      ...Object.fromEntries(Object.entries({400: "Помилка валідації", 401: "Потрібен вхід", 403: "Немає доступу", 404: "Не знайдено", 409: "Конфлікт", 413: "Тіло перевищує 1 МБ", 415: "Непідтримуваний формат", 429: "Забагато спроб", 500: "Внутрішня помилка"}).map(([code, description]) => [code, { description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }])),
    },
  };
}
add("/health", "get", "Стан API та бази");
for (const register of [false, true])
  add(
    `/auth/${register ? "register" : "login"}`,
    "post",
    register ? "Реєстрація" : "Вхід",
    {
      schema: object(
        {
          email: str("oleh@example.com"),
          password: str("Tourist2026!"),
          ...(register ? { display_name: str("Олег") } : {}),
        },
        register
          ? ["email", "password", "display_name"]
          : ["email", "password"],
      ),
      status: register ? 201 : 200,
    },
  );
add("/auth/refresh", "post", "Оновити сесію через cookie");
add("/auth/logout", "post", "Завершити сесію", { status: 204 });
add("/auth/me", "get", "Поточний користувач", { auth: true });
add("/categories", "get", "Категорії");
add("/places", "get", "Каталог локацій", {
  params: ["q", "category", "limit", "offset"],
});
add("/places/{id}", "get", "Одна локація");
add("/admin/places", "get", "Усі локації для адміністратора", { auth: true });
add("/places", "post", "Додати локацію адміністратором", {
  auth: true,
  schema: place,
  status: 201,
});
add("/places/{id}", "put", "Оновити локацію адміністратором", {
  auth: true,
  schema: place,
});
add("/places/{id}", "delete", "Видалити локацію адміністратором", {
  auth: true,
  status: 204,
});
add("/routes", "get", "Власні маршрути", {
  auth: true,
  params: ["q", "state", "limit", "offset"],
});
add("/routes/{id}", "get", "Деталі власного маршруту", { auth: true });
add("/routes", "post", "Створити маршрут", {
  auth: true,
  schema: route,
  status: 201,
});
for (const method of ["put", "patch"])
  add("/routes/{id}", method, "Змінити маршрут із base_version", {
    auth: true,
    schema:
      method === "put"
        ? { ...route, required: [...route.required, "base_version"] }
        : object({ ...route.properties }, ["base_version"]),
  });
add("/routes/{id}", "delete", "Ідемпотентне видалення маршруту", {
  auth: true,
  status: 204,
});
add("/routes/{id}/shares", "post", "Створити посилання на 7 днів", {
  auth: true,
  status: 201,
});
add("/routes/{id}/shares", "get", "Список посилань", { auth: true });
add("/routes/{id}/shares/{shareId}", "delete", "Відкликати посилання", {
  auth: true,
  status: 204,
});
add("/shares/{token}", "get", "Перегляд поширеного маршруту");
add("/trips", "get", "Історія подорожей", {
  auth: true,
  params: ["limit", "offset"],
});
add("/trips/{id}", "get", "Подорож і GPS-трек", { auth: true });
add("/trips", "post", "Розпочати подорож", {
  auth: true,
  status: 201,
  schema: object({ route_id: { type: "string", format: "uuid" } }, [
    "route_id",
  ]),
});
for (const action of ["pause", "resume", "finish"])
  add(`/trips/{id}/${action}`, "post", `Подорож ${action}`, { auth: true });
add("/trips/{id}/track", "post", "Додати GPS-вимірювання", {
  auth: true,
  schema: object(
    {
      points: {
        type: "array",
        maxItems: 200,
        items: object(
          {
            ...point.properties,
            recorded_at: { type: "string", format: "date-time" },
            segment_id: { type: "string", format: "uuid" },
            accuracy_m: { type: "number", minimum: 0 },
          },
          ["latitude", "longitude", "recorded_at", "segment_id", "accuracy_m"],
        ),
      },
    },
    ["points"],
  ),
});
add("/sync", "post", "Ідемпотентна синхронізація локальних маршрутів", {
  auth: true,
  schema: object(
    {
      operations: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: object(
          {
            client_operation_id: { type: "string", format: "uuid" },
            entity_id: { type: "string", format: "uuid" },
            operation_type: {
              type: "string",
              enum: ["create", "update", "delete"],
            },
            base_version: { type: "integer", minimum: 1 },
            payload: route,
          },
          ["client_operation_id", "entity_id", "operation_type"],
        ),
      },
    },
    ["operations"],
  ),
});

// Document the JSON returned by the running implementation, not only inputs.
const id = { type: "string", format: "uuid" };
const publicUser = object({ id, email: { type: "string", format: "email" }, display_name: str("Олег"), role: { type: "string", enum: ["tourist", "admin"] } }, ["id", "email", "display_name", "role"]);
const session = object({ access_token: str(), token_type: { type: "string", enum: ["Bearer"] }, expires_in: { type: "integer", example: 900 }, user: publicUser }, ["access_token", "token_type", "expires_in", "user"]);
const routeOutput = object({ ...route.properties, id, owner_id: id, version: { type: "integer", minimum: 1 }, distance_m: { type: "integer" }, duration_s: { type: "integer" }, geometry_kind: { type: "string", enum: ["straight"] } }, ["id", "name", "state", "version", "points"]);
delete routeOutput.properties.base_version;
const page = items => object({ items: { type: "array", items }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } }, ["items", "total", "limit", "offset"]);
Object.assign(openapi.components.schemas, { PublicUser: publicUser, Session: session, Route: routeOutput });
function output(path, method, schema) {
  const responses = openapi.paths[path][method].responses;
  const status = Object.keys(responses).find(code => code.startsWith("2"));
  responses[status].content = { "application/json": { schema } };
}
for (const name of ["login", "register", "refresh"]) output(`/auth/${name}`, "post", { $ref: "#/components/schemas/Session" });
output("/auth/me", "get", { $ref: "#/components/schemas/PublicUser" });
output("/health", "get", object({ status: { type: "string", enum: ["ok"] }, database: { type: "string", enum: ["pglite", "postgres"] } }, ["status", "database"]));
output("/routes", "get", page({ $ref: "#/components/schemas/Route" }));
output("/routes", "post", { $ref: "#/components/schemas/Route" });
for (const method of ["get", "put", "patch"]) output("/routes/{id}", method, { $ref: "#/components/schemas/Route" });
output("/places", "get", page(object({ id, ...place.properties })));

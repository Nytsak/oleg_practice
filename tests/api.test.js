import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../server/src/db.js";
import { createApp } from "../server/src/app.js";
import { seedDatabase, demoUsers, seedPlaces } from "../server/src/seed.js";
import { createAccessToken } from "../server/src/security.js";
let db, server, url, tourist, admin;
const secret = "test-secret-that-is-at-least-32-characters-long";
async function request(
  path,
  {
    method = "GET",
    body,
    token = tourist?.body.access_token,
    cookie,
    origin,
  } = {},
) {
  const res = await fetch(url + "/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: res.status,
    body: res.status === 204 ? null : await res.json(),
    cookie: res.headers.get("set-cookie")?.split(";")[0],
    headers: res.headers,
  };
}
const payload = (name = "Тестовий маршрут") => ({
  name,
  description: "Навчальна прогулянка",
  state: "ready",
  points: [0, 2].map((i) => ({
    place_id: seedPlaces[i][0],
    label_snapshot: seedPlaces[i][2],
    latitude: seedPlaces[i][4],
    longitude: seedPlaces[i][5],
  })),
});
async function route(name) {
  const r = await request("/routes", { method: "POST", body: payload(name) });
  assert.equal(r.status, 201);
  return r.body;
}
before(async () => {
  db = await openDatabase({ directory: "memory://" });
  await seedDatabase(db);
  const app = createApp(db, { secret, logging: false });
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  url = `http://127.0.0.1:${server.address().port}`;
  tourist = await request("/auth/login", {
    method: "POST",
    body: demoUsers.tourist,
    token: null,
  });
  admin = await request("/auth/login", {
    method: "POST",
    body: demoUsers.admin,
    token: null,
  });
  assert.equal(tourist.status, 200);
  assert.equal(admin.status, 200);
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
});
test("Health and all nine Lab 5 tables exist", async () => {
  assert.equal((await request("/health")).body.status, "ok");
  for (const table of [
    "users",
    "place_categories",
    "tourist_places",
    "routes",
    "route_points",
    "trips",
    "track_points",
    "share_links",
    "sync_operations",
  ])
    assert.ok(
      (await db.query("SELECT to_regclass($1) AS name", [table])).rows[0].name,
    );
});
test("Private routes require authentication", async () =>
  assert.equal((await request("/routes", { token: null })).status, 401));
test("Registration hashes password and prevents role escalation", async () => {
  const r = await request("/auth/register", {
    method: "POST",
    token: null,
    body: {
      email: "NEW@example.com",
      password: "StrongPassword123",
      display_name: "Новий турист",
      role: "admin",
    },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.role, "tourist");
  assert.ok(r.headers.get("set-cookie").includes("HttpOnly"));
  const saved = (
    await db.query("SELECT password_hash FROM users WHERE id=$1", [
      r.body.user.id,
    ])
  ).rows[0];
  assert.ok(saved.password_hash.startsWith("scrypt$"));
  assert.notEqual(saved.password_hash, "StrongPassword123");
  assert.equal(
    (
      await request("/auth/register", {
        method: "POST",
        token: null,
        body: {
          email: "new@example.com",
          password: "StrongPassword123",
          display_name: "Інший",
        },
      })
    ).status,
    409,
  );
});
test("Invalid email and short password return 400", async () => {
  assert.equal(
    (
      await request("/auth/register", {
        method: "POST",
        body: { email: "bad", password: "123", display_name: "A" },
        token: null,
      })
    ).status,
    400,
  );
});
test("Incorrect credentials return 401", async () =>
  assert.equal(
    (
      await request("/auth/login", {
        method: "POST",
        body: { email: demoUsers.tourist.email, password: "WrongPassword10" },
        token: null,
      })
    ).status,
    401,
  ));
test("Refresh token rotates and logout revokes it", async () => {
  const login = await request("/auth/login", {
    method: "POST",
    body: demoUsers.tourist,
    token: null,
  });
  const rotated = await request("/auth/refresh", {
    method: "POST",
    body: {},
    cookie: login.cookie,
    token: null,
  });
  assert.equal(rotated.status, 200);
  assert.notEqual(login.cookie, rotated.cookie);
  assert.equal(
    (
      await request("/auth/refresh", {
        method: "POST",
        body: {},
        cookie: login.cookie,
        token: null,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/auth/logout", {
        method: "POST",
        body: {},
        cookie: rotated.cookie,
        token: null,
      })
    ).status,
    204,
  );
  assert.equal(
    (
      await request("/auth/refresh", {
        method: "POST",
        body: {},
        cookie: rotated.cookie,
        token: null,
      })
    ).status,
    401,
  );
});
test("Expired or modified JWT is rejected", async () => {
  assert.equal(
    (
      await request("/routes", {
        token: createAccessToken(demoUsers.tourist, secret, -1),
      })
    ).status,
    401,
  );
  assert.equal(
    (await request("/routes", { token: tourist.body.access_token + "tamper" }))
      .status,
    401,
  );
});
test("Route CRUD stores ordered points and estimates", async () => {
  const r = await route();
  assert.equal(r.points.length, 2);
  assert.deepEqual(
    r.points.map((p) => p.position),
    [1, 2],
  );
  assert.ok(r.distance_m > 1000);
  const u = await request(`/routes/${r.id}`, {
    method: "PUT",
    body: { ...payload("Оновлений маршрут"), base_version: r.version },
  });
  assert.equal(u.status, 200);
  assert.equal(u.body.version, 2);
  assert.equal(
    (await request(`/routes/${r.id}`)).body.name,
    "Оновлений маршрут",
  );
});
test("PATCH preserves route points", async () => {
  const r = await route();
  const u = await request(`/routes/${r.id}`, {
    method: "PATCH",
    body: { name: "Змінена назва", base_version: 1 },
  });
  assert.equal(u.status, 200);
  assert.equal(u.body.points.length, 2);
});
test("Foreign owner cannot read, update or delete routes", async () => {
  const r = await route();
  for (const method of ["GET", "PUT", "DELETE"])
    assert.equal(
      (
        await request(`/routes/${r.id}`, {
          method,
          token: admin.body.access_token,
          ...(method === "PUT"
            ? { body: { ...payload(), base_version: 1 } }
            : {}),
        })
      ).status,
      403,
    );
});
test("Stale version returns 409 and keeps server data", async () => {
  const r = await route();
  await request(`/routes/${r.id}`, {
    method: "PATCH",
    body: { name: "Версія два", base_version: 1 },
  });
  const stale = await request(`/routes/${r.id}`, {
    method: "PUT",
    body: { ...payload("Стара копія"), base_version: 1 },
  });
  assert.equal(stale.status, 409);
  assert.equal((await request(`/routes/${r.id}`)).body.name, "Версія два");
});
test("Invalid coordinates are rejected atomically", async () => {
  const count = Number(
    (await db.query("SELECT count(*) FROM routes")).rows[0].count,
  );
  const p = payload();
  p.points[0].latitude = 100;
  assert.equal(
    (await request("/routes", { method: "POST", body: p })).status,
    400,
  );
  assert.equal(
    Number((await db.query("SELECT count(*) FROM routes")).rows[0].count),
    count,
  );
});
test("Invalid catalogue reference rolls back route and points", async () => {
  const p = payload("Не має зберегтись");
  p.points[1].place_id = randomUUID();
  assert.equal(
    (await request("/routes", { method: "POST", body: p })).status,
    400,
  );
  assert.equal(
    (await db.query("SELECT id FROM routes WHERE name=$1", [p.name])).rows
      .length,
    0,
  );
});
test("Missing base version and malformed UUID return 400", async () => {
  const r = await route();
  assert.equal(
    (await request(`/routes/${r.id}`, { method: "PUT", body: payload() }))
      .status,
    400,
  );
  assert.equal((await request("/routes/bad-id")).status, 400);
});
test("Route filter, sorting and limit offset pagination work", async () => {
  await route("Унікальний фільтр");
  const r = await request(
    "/routes?q=" +
      encodeURIComponent("Унікальний") +
      "&state=ready&limit=1&offset=0",
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 1);
  assert.equal(r.body.items.length, 1);
  assert.equal((await request("/routes?limit=0")).status, 400);
});
test("SQL injection stays a parameter value", async () => {
  const p = await route("Маршрут '; DROP TABLE users; --");
  assert.ok(p.id);
  assert.ok((await db.query("SELECT count(*) FROM users")).rows[0].count);
});
test("DELETE is idempotent and preserves historical snapshot", async () => {
  const r = await route("Історія після видалення");
  const trip = await request("/trips", {
    method: "POST",
    body: { route_id: r.id },
  });
  assert.equal(trip.status, 201);
  await request(`/trips/${trip.body.id}/finish`, { method: "POST", body: {} });
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await request(`/routes/${r.id}`, { method: "DELETE" })).status,
      204,
    );
  const t = (await request(`/trips/${trip.body.id}`)).body;
  assert.equal(t.route_id, null);
  assert.equal(t.route_snapshot.name, r.name);
  assert.equal(
    (await db.query("SELECT * FROM route_points WHERE route_id=$1", [r.id]))
      .rows.length,
    0,
  );
});
test("Tourist cannot manage catalogue", async () =>
  assert.equal(
    (
      await request("/places", {
        method: "POST",
        body: { name: "Тест", category_id: 2, latitude: 0, longitude: 0 },
      })
    ).status,
    403,
  ));
test("Admin catalogue CRUD keeps route point snapshots after deletion", async () => {
  const p = await request("/places", {
    method: "POST",
    token: admin.body.access_token,
    body: {
      name: "Тестова локація",
      category_id: 2,
      latitude: 48.91,
      longitude: 24.69,
    },
  });
  assert.equal(p.status, 201);
  const input = payload();
  input.points[0] = {
    place_id: p.body.id,
    label_snapshot: p.body.name,
    latitude: 48.91,
    longitude: 24.69,
  };
  const r = await request("/routes", { method: "POST", body: input });
  assert.equal(r.status, 201);
  const hidden = await request(`/places/${p.body.id}`, {
    method: "PUT",
    token: admin.body.access_token,
    body: { ...p.body, is_visible: false },
  });
  assert.equal(hidden.status, 200);
  assert.equal((await request(`/places/${p.body.id}`)).status, 404);
  await request(`/places/${p.body.id}`, {
    method: "DELETE",
    token: admin.body.access_token,
  });
  const point = (await request(`/routes/${r.body.id}`)).body.points[0];
  assert.equal(point.place_id, null);
  assert.equal(point.label_snapshot, "Тестова локація");
});
test("Sharing hashes token, allows anonymous access, supports revocation", async () => {
  const r = await route();
  const share = await request(`/routes/${r.id}/shares`, {
    method: "POST",
    body: {},
  });
  assert.equal(share.status, 201);
  assert.equal(share.body.token.length, 43);
  const saved = (
    await db.query("SELECT token_hash FROM share_links WHERE id=$1", [
      share.body.id,
    ])
  ).rows[0];
  assert.notEqual(saved.token_hash, share.body.token);
  assert.equal(
    (await request(`/shares/${share.body.token}`, { token: null })).status,
    200,
  );
  await request(`/routes/${r.id}/shares/${share.body.id}`, {
    method: "DELETE",
  });
  assert.equal(
    (await request(`/shares/${share.body.token}`, { token: null })).status,
    404,
  );
});
test("Expired sharing link is rejected", async () => {
  const r = await route();
  const s = await request(`/routes/${r.id}/shares`, {
    method: "POST",
    body: {},
  });
  await db.query(
    "UPDATE share_links SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",
    [s.body.id],
  );
  assert.equal(
    (await request(`/shares/${s.body.token}`, { token: null })).status,
    404,
  );
});
test("Offline create replay applies only once", async () => {
  const op = {
    client_operation_id: randomUUID(),
    entity_id: randomUUID(),
    operation_type: "create",
    payload: payload("Офлайн маршрут"),
  };
  const first = await request("/sync", {
    method: "POST",
    body: { operations: [op] },
  });
  const retry = await request("/sync", {
    method: "POST",
    body: { operations: [op] },
  });
  assert.equal(first.body.results[0].status, "applied");
  assert.equal(retry.body.results[0].replayed, true);
  assert.equal(retry.body.results[0].route.version, 1);
  assert.equal(
    (
      await db.query(
        "SELECT * FROM sync_operations WHERE client_operation_id=$1",
        [op.client_operation_id],
      )
    ).rows.length,
    1,
  );
});
test("Same operation UUID cannot carry different payload", async () => {
  const op = {
    client_operation_id: randomUUID(),
    entity_id: randomUUID(),
    operation_type: "create",
    payload: payload(),
  };
  await request("/sync", { method: "POST", body: { operations: [op] } });
  op.payload.name = "Інші дані";
  assert.equal(
    (await request("/sync", { method: "POST", body: { operations: [op] } }))
      .status,
    409,
  );
});
test("Offline stale update is logged as conflict", async () => {
  const r = await route();
  await request(`/routes/${r.id}`, {
    method: "PATCH",
    body: { name: "Актуальний маршрут", base_version: 1 },
  });
  const op = {
    client_operation_id: randomUUID(),
    entity_id: r.id,
    operation_type: "update",
    base_version: 1,
    payload: payload("Стара зміна"),
  };
  const s = await request("/sync", {
    method: "POST",
    body: { operations: [op] },
  });
  assert.equal(s.body.results[0].status, "conflict");
  assert.equal(
    (await request(`/routes/${r.id}`)).body.name,
    "Актуальний маршрут",
  );
});
test("Failed sync rolls back mutation while recording failure", async () => {
  const p = payload();
  p.points[1].place_id = randomUUID();
  const op = {
    client_operation_id: randomUUID(),
    entity_id: randomUUID(),
    operation_type: "create",
    payload: p,
  };
  const s = await request("/sync", {
    method: "POST",
    body: { operations: [op] },
  });
  assert.equal(s.status, 200);
  assert.equal(s.body.results[0].status, "failed");
  assert.equal(
    (await db.query("SELECT * FROM routes WHERE id=$1", [op.entity_id])).rows
      .length,
    0,
  );
});
test("Trip state machine, uniqueness, tracking and segment gaps", async () => {
  const r = await route(),
    trip = await request("/trips", {
      method: "POST",
      body: { route_id: r.id },
    });
  assert.equal(trip.status, 201);
  const id = trip.body.id;
  assert.equal(
    (await request("/trips", { method: "POST", body: { route_id: r.id } }))
      .status,
    409,
  );
  const time = Date.now(),
    seg = randomUUID();
  const track = [
    {
      latitude: 48.92,
      longitude: 24.7,
      accuracy_m: 5,
      segment_id: seg,
      recorded_at: new Date(time).toISOString(),
    },
    {
      latitude: 48.921,
      longitude: 24.701,
      accuracy_m: 5,
      segment_id: seg,
      recorded_at: new Date(time + 1).toISOString(),
    },
    {
      latitude: 49,
      longitude: 25,
      accuracy_m: 5,
      segment_id: randomUUID(),
      recorded_at: new Date(time + 2).toISOString(),
    },
  ];
  const recorded = await request(`/trips/${id}/track`, {
    method: "POST",
    body: { points: track },
  });
  assert.equal(recorded.status, 200);
  assert.ok(recorded.body.distance_m > 100 && recorded.body.distance_m < 200);
  const replay = await request(`/trips/${id}/track`, {
    method: "POST",
    body: { points: track },
  });
  assert.equal(replay.body.points.length, 3);
  assert.equal(
    (await request(`/trips/${id}/resume`, { method: "POST", body: {} })).status,
    400,
  );
  assert.equal(
    (await request(`/trips/${id}/pause`, { method: "POST", body: {} })).body
      .state,
    "paused",
  );
  assert.equal(
    (
      await request(`/trips/${id}/track`, {
        method: "POST",
        body: { points: track },
      })
    ).status,
    400,
  );
  assert.equal(
    (await request(`/trips/${id}/resume`, { method: "POST", body: {} })).body
      .state,
    "active",
  );
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await request(`/trips/${id}/finish`, { method: "POST", body: {} })).body
        .state,
      "finished",
    );
  assert.equal(
    (await request(`/trips/${id}/pause`, { method: "POST", body: {} })).status,
    400,
  );
});
test("HTTP errors have consistent format and reject cross origin requests", async () => {
  const r = await request("/unknown");
  assert.equal(r.status, 404);
  assert.equal(typeof r.body.requestId, "string");
  assert.equal(
    (
      await request("/auth/refresh", {
        method: "POST",
        origin: "https://attacker.example",
        body: {},
        token: null,
      })
    ).status,
    403,
  );
  const bad = await fetch(url + "/api/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{bad",
  });
  assert.equal(bad.status, 400);
  const empty = await request("/auth/register", {
    method: "POST",
    token: null,
  });
  assert.equal(empty.status, 400);
});
test("OpenAPI describes all operations and bearer authorization", async () => {
  const r = await request("/openapi.json");
  assert.equal(r.body.openapi, "3.0.3");
  assert.ok(r.body.paths["/sync"].post);
  assert.ok(r.body.components.securitySchemes.bearerAuth);
});
test("Authentication rate limiting returns 429", async () => {
  let last;
  for (let i = 0; i < 31; i++)
    last = await request("/auth/login", {
      method: "POST",
      token: null,
      body: { email: "missing@example.com", password: "WrongPassword10" },
    });
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get("retry-after")) > 0);
});
test("Malformed route point objects return 400 without a partial write", async () => {
  const before = Number(
    (await db.query("SELECT count(*) FROM routes")).rows[0].count,
  );
  for (const value of [null, [], 5, "not a point"]) {
    const body = payload();
    body.points[1] = value;
    const result = await request("/routes", { method: "POST", body });
    assert.equal(result.status, 400);
    assert.ok(result.body.fields["points[1]"]);
  }
  assert.equal(
    Number((await db.query("SELECT count(*) FROM routes")).rows[0].count),
    before,
  );
});
test("Invalid sync envelope is rejected before earlier operations mutate data", async () => {
  for (const value of [null, [], 5, "not an operation"]) {
    const op = {
      client_operation_id: randomUUID(),
      entity_id: randomUUID(),
      operation_type: "create",
      payload: payload("Не застосовувати"),
    };
    const result = await request("/sync", {
      method: "POST",
      body: { operations: [op, value] },
    });
    assert.equal(result.status, 400);
    assert.equal(
      (await db.query("SELECT id FROM routes WHERE id=$1", [op.entity_id])).rows
        .length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "SELECT id FROM sync_operations WHERE client_operation_id=$1",
          [op.client_operation_id],
        )
      ).rows.length,
      0,
    );
  }
});
test("Sync replay accepts reordered JSON keys but rejects changed values", async () => {
  const op = {
    client_operation_id: randomUUID(),
    entity_id: randomUUID(),
    operation_type: "create",
    payload: payload("Стабільний повтор"),
  };
  assert.equal(
    (await request("/sync", { method: "POST", body: { operations: [op] } }))
      .body.results[0].status,
    "applied",
  );
  const reordered = {
    payload: {
      points: op.payload.points.map((point) => ({
        longitude: point.longitude,
        latitude: point.latitude,
        label_snapshot: point.label_snapshot,
        place_id: point.place_id,
      })),
      state: op.payload.state,
      description: op.payload.description,
      name: op.payload.name,
    },
    operation_type: op.operation_type,
    entity_id: op.entity_id,
    client_operation_id: op.client_operation_id,
  };
  const replay = await request("/sync", {
    method: "POST",
    body: { operations: [reordered] },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.results[0].replayed, true);
  assert.equal(replay.body.results[0].route.version, 1);
  reordered.payload.name = "Змінені дані";
  assert.equal(
    (
      await request("/sync", {
        method: "POST",
        body: { operations: [reordered] },
      })
    ).status,
    409,
  );
});
test("Malformed GPS batch rolls back earlier valid measurements", async () => {
  const r = await route("Валідація GPS"),
    trip = await request("/trips", {
      method: "POST",
      body: { route_id: r.id },
    }),
    id = trip.body.id;
  const point = {
    latitude: 48.92,
    longitude: 24.7,
    accuracy_m: 5,
    segment_id: randomUUID(),
    recorded_at: new Date().toISOString(),
  };
  const result = await request(`/trips/${id}/track`, {
    method: "POST",
    body: { points: [point, null] },
  });
  assert.equal(result.status, 400);
  assert.equal(
    (await db.query("SELECT id FROM track_points WHERE trip_id=$1", [id])).rows
      .length,
    0,
  );
  await request(`/trips/${id}/finish`, { method: "POST", body: {} });
});

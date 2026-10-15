import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../server/src/db.js";
import { createApp } from "../server/src/app.js";
import { seedDatabase, demoUsers } from "../server/src/seed.js";

const secret = "http-contract-secret-with-more-than-32-characters";
let db, server, base, session, cookie;
async function listen(app) {
  const instance = app.listen(0, "127.0.0.1");
  await new Promise(resolve => instance.once("listening", resolve));
  return [instance, `http://127.0.0.1:${instance.address().port}`];
}
const close = instance => new Promise(resolve => instance.close(resolve));
before(async () => {
  db = await openDatabase({ directory: "memory://" });
  await seedDatabase(db);
  [server, base] = await listen(createApp(db, { secret, logging: false }));
  const response = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(demoUsers.tourist),
  });
  assert.equal(response.status, 200);
  cookie = response.headers.get("set-cookie");
  session = await response.json();
});
after(async () => { await close(server); await db.close(); });
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` });

test("Private API responses and errors have no-store and request correlation", async () => {
  for (const path of ["/api/routes", "/api/missing"]) {
    const response = await fetch(base + path, { headers: headers() });
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    if (response.status === 404) assert.equal(body.requestId, response.headers.get("x-request-id"));
  }
});
test("Refresh cookie uses the mounted auth API path and rotates", async () => {
  assert.match(cookie, /Path=\/api\/auth(?:;|$)/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const old = cookie.split(";")[0];
  const response = await fetch(base + "/api/auth/refresh", { method: "POST", headers: { Cookie: old } });
  assert.equal(response.status, 200);
  assert.notEqual(response.headers.get("set-cookie").split(";")[0], old);
  const repeated = await fetch(base + "/api/auth/refresh", { method: "POST", headers: { Cookie: old } });
  assert.equal(repeated.status, 401);
});
test("Non-JSON and oversized bodies return safe 415 and 413 JSON errors", async () => {
  for (const [type, body, status] of [
    ["text/plain", "not-json", 415],
    ["application/json", JSON.stringify({ text: "x".repeat(1024 * 1024) }), 413],
  ]) {
    const response = await fetch(base + "/api/routes", { method: "POST", headers: { "Content-Type": type }, body });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const error = await response.json();
    assert.equal(error.status, status);
    assert.equal(error.requestId, response.headers.get("x-request-id"));
    assert.ok(error.message.length < 150);
    assert.ok(!JSON.stringify(error).includes(body.slice(0, 200)) || status === 415);
  }
});
test("Sync conflicts do not expose SQL or constraint names and replay safely", async () => {
  const payload = { name: "Конфлікт перевірки", state: "draft", points: [{ label_snapshot: "Моя точка", latitude: 48.92, longitude: 24.71 }] };
  const created = await fetch(base + "/api/routes", { method: "POST", headers: headers(), body: JSON.stringify(payload) });
  assert.equal(created.status, 201);
  const route = await created.json();
  const operations = [{ client_operation_id: randomUUID(), entity_id: route.id, operation_type: "create", payload }];
  for (const replayed of [false, true]) {
    const response = await fetch(base + "/api/sync", { method: "POST", headers: headers(), body: JSON.stringify({ operations }) });
    assert.equal(response.status, 200);
    const result = (await response.json()).results[0];
    assert.equal(result.status, "conflict");
    assert.equal(Boolean(result.replayed), replayed);
    assert.doesNotMatch(result.message, /duplicate key|constraint|routes_pkey|INSERT|SELECT/i);
  }
  assert.equal(Number((await db.query("SELECT count(*) FROM routes WHERE id=$1", [route.id])).rows[0].count), 1);
});
test("Unexpected database errors return a safe JSON 500", async () => {
  const broken = { mode: "test", query: async () => { throw Error("SELECT password_hash FROM users secret-database-detail"); } };
  const [instance, url] = await listen(createApp(broken, { secret, logging: false }));
  try {
    const response = await fetch(url + "/api/health");
    assert.equal(response.status, 500);
    const error = await response.json();
    assert.equal(error.requestId, response.headers.get("x-request-id"));
    assert.doesNotMatch(JSON.stringify(error), /SELECT|password_hash|secret-database-detail/);
    assert.deepEqual(error.fields, {});
  } finally { await close(instance); }
});
test("Request logs use route templates and exclude bodies and capability tokens", async () => {
  const entries = [], original = console.log;
  const [instance, url] = await listen(createApp(db, { secret }));
  const capability = "a".repeat(43);
  console.log = value => entries.push(value);
  try {
    const shared = await fetch(url + "/api/shares/" + capability);
    await shared.json();
    const login = await fetch(url + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "private@example.com", password: "PrivatePassword123" }) });
    await login.json();
    const records = entries.map(value => JSON.parse(value));
    assert.ok(records.some(record => record.path === "/api/shares/:token" && record.status === 404));
    assert.ok(records.some(record => record.requestId === login.headers.get("x-request-id")));
    assert.doesNotMatch(entries.join("\n"), new RegExp(capability + "|PrivatePassword123|private@example.com"));
  } finally { console.log = original; await close(instance); }
});

test("Local loopback browser origins support login, registration, refresh and logout", async () => {
  const [instance, url] = await listen(createApp(db, { secret, logging: false, clientOrigin: "" }));
  try {
    const port = new URL(url).port;
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173", `http://localhost:${port}`]) {
      const headers = { "Content-Type": "application/json", Origin: origin };
      const login = await fetch(url + "/api/auth/login", { method: "POST", headers, body: JSON.stringify(demoUsers.tourist) });
      assert.equal(login.status, 200, `login from ${origin}`);
      assert.ok((await login.json()).access_token);
      const refresh = await fetch(url + "/api/auth/refresh", { method: "POST", headers: { ...headers, Cookie: login.headers.get("set-cookie").split(";")[0] } });
      assert.equal(refresh.status, 200, `refresh from ${origin}`);
      assert.ok((await refresh.json()).access_token);
      const logout = await fetch(url + "/api/auth/logout", { method: "POST", headers: { ...headers, Cookie: refresh.headers.get("set-cookie").split(";")[0] } });
      assert.equal(logout.status, 204, `logout from ${origin}`);
    }
    const registered = await fetch(url + "/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({ email: `origin-${randomUUID()}@example.com`, password: "OriginTest2026!", display_name: "Origin Test" }),
    });
    assert.equal(registered.status, 201);
    assert.ok((await registered.json()).access_token);
  } finally { await close(instance); }
});

test("Configured client origins support a comma-separated list and a trailing slash", async () => {
  const [instance, url] = await listen(createApp(db, { secret, logging: false, clientOrigin: " http://localhost:5174/ , https://trailway.example/ " }));
  try {
    for (const origin of ["http://localhost:5174", "https://trailway.example"]) {
      const response = await fetch(url + "/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(demoUsers.tourist),
      });
      assert.equal(response.status, 200, origin);
      assert.ok((await response.json()).access_token);
    }
  } finally { await close(instance); }
});

test("Hostile, opaque and malformed origins stay blocked before authentication", async () => {
  for (const origin of ["https://attacker.example", "null", "http://localhost.attacker.example:5173", "http://127.0.0.1.attacker.example:5173", "http://localhost:5999", "https://127.0.0.1:5173", "http://user:password@localhost:5173", "http://localhost:5173/path"]) {
    const response = await fetch(base + "/api/auth/refresh", {
      method: "POST", headers: { Origin: origin, "X-Forwarded-Host": "attacker.example", "X-Forwarded-Proto": "https" },
    });
    assert.equal(response.status, 403, origin);
    const error = await response.json();
    assert.equal(error.status, 403);
    assert.equal(error.requestId, response.headers.get("x-request-id"));
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("Production permits same-origin and configured origins without implicit local development access", async () => {
  const previous = process.env.NODE_ENV;
  let app;
  try {
    process.env.NODE_ENV = "production";
    app = createApp(db, { secret, logging: false, clientOrigin: "https://trailway.example/" });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
  const [instance, url] = await listen(app);
  try {
    for (const [origin, status] of [[url, 401], ["https://trailway.example", 401], ["http://localhost:5173", 403], ["http://127.0.0.1:5173", 403], [`http://localhost:${new URL(url).port}`, 403]]) {
      const response = await fetch(url + "/api/auth/refresh", { method: "POST", headers: { Origin: origin } });
      assert.equal(response.status, status, origin);
    }
  } finally { await close(instance); }
});

test("Invalid client-origin configuration fails with a clear startup error", () => {
  for (const clientOrigin of ["*", "null", "file:///tmp/index.html", "https://user:password@example.com", "https://example.com/path", "https://example.com?query=1", "https://example.com#fragment"]) {
    assert.throws(() => createApp(db, { secret, logging: false, clientOrigin }), /CLIENT_ORIGIN/);
  }
});

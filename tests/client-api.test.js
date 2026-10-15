import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { api, setToken, refreshSession } from "../client/src/api.js";
const originalFetch = globalThis.fetch;
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
afterEach(() => {
  globalThis.fetch = originalFetch;
  setToken(null);
});

test("Concurrent 401 responses share one refresh and retry with the new token", async () => {
  setToken("expired");
  let refreshes = 0;
  globalThis.fetch = async (url, options) => {
    if (url === "/api/auth/refresh") {
      refreshes++;
      await new Promise((r) => setTimeout(r, 5));
      return json({ access_token: "renewed", user: { id: "owner" } });
    }
    return options.headers.Authorization === "Bearer renewed"
      ? json({ ok: true })
      : json({ message: "expired" }, 401);
  };
  const results = await Promise.all([api("/routes"), api("/trips")]);
  assert.deepEqual(results, [{ ok: true }, { ok: true }]);
  assert.equal(refreshes, 1);
});

test("A route response arriving after logout cannot return private data", async () => {
  setToken("owner-token");
  const pending = deferred();
  let authorization;
  globalThis.fetch = async (url, options) => {
    authorization = options.headers.Authorization;
    return pending.promise;
  };
  const request = api("/routes");
  const rejected = assert.rejects(request, (error) => error.cancelled === true);
  setToken(null);
  pending.resolve(json({ items: [{ name: "Private route" }] }));
  await rejected;
  globalThis.fetch = async (url, options) => {
    authorization = options.headers.Authorization;
    return json({ ok: true });
  };
  await api("/health");
  assert.equal(authorization, undefined);
});

test("Login waits for an older refresh and its response cannot overwrite the new session", async () => {
  setToken(null);
  const pending = deferred();
  let loginStarted = false,
    authorization;
  globalThis.fetch = async (url, options) => {
    if (url === "/api/auth/refresh") return pending.promise;
    if (url === "/api/auth/login") {
      loginStarted = true;
      return json({ access_token: "new-account", user: { id: "new-owner" } });
    }
    authorization = options.headers.Authorization;
    return json({ ok: true });
  };
  const refresh = refreshSession();
  const rejected = assert.rejects(refresh, (error) => error.cancelled === true);
  const login = api("/auth/login", {
    method: "POST",
    body: { email: "new@example.com", password: "StrongPassword123" },
  });
  assert.equal(loginStarted, false);
  pending.resolve(
    json({ access_token: "old-account", user: { id: "old-owner" } }),
  );
  const session = await login;
  await rejected;
  setToken(session.access_token);
  await api("/routes");
  assert.equal(authorization, "Bearer new-account");
});

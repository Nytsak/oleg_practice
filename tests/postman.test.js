import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { openDatabase } from "../server/src/db.js";
import { createApp } from "../server/src/app.js";
import { seedDatabase } from "../server/src/seed.js";

test("All 19 exported Postman requests run in order against the actual API", async () => {
  const collection = JSON.parse(await readFile(new URL("../docs/api/Trailway.postman_collection.json", import.meta.url)));
  const db = await openDatabase({ directory: "memory://" });
  await seedDatabase(db);
  const server = createApp(db, { secret: "postman-only-test-secret-with-more-than-32-characters", logging: false }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const variables = Object.fromEntries(collection.variable.map(({ key, value }) => [key, value]));
  variables.base_url = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = "", cookiePath = "";
  const expand = value => value.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    assert.ok(key in variables && variables[key] !== "", "Variable is available: " + key);
    return variables[key];
  });
  let assertions = 0;
  try {
    for (const { name, request, event } of collection.item) {
      const url = expand(request.url);
      const headers = Object.fromEntries(request.header.map(({ key, value }) => [key, expand(value)]));
      if (request.auth.type === "bearer") headers.Authorization = "Bearer " + expand(request.auth.bearer[0].value);
      if (cookie && new URL(url).pathname.startsWith(cookiePath)) headers.Cookie = cookie;
      const response = await fetch(url, { method: request.method, headers, ...(request.body ? { body: expand(request.body.raw) } : {}) });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) {
        cookie = setCookie.split(";")[0];
        cookiePath = setCookie.match(/Path=([^;]+)/)?.[1] || "/";
      }
      const data = response.status === 204 ? null : await response.json();
      // Execute only this repository's own collection tests in an isolated context.
      const pm = {
        test: (_label, fn) => { fn(); assertions++; },
        response: { code: response.status, json: () => data, to: { have: { status: code => assert.equal(response.status, code, name) } } },
        collectionVariables: { set: (key, value) => { variables[key] = String(value); } },
      };
      for (const hook of event.filter(value => value.listen === "test")) vm.runInNewContext(hook.script.exec.join("\n"), { pm }, { timeout: 1000 });
    }
    assert.equal(assertions, 19);
    assert.equal(Number((await db.query("SELECT count(*) FROM routes WHERE id=$1", [variables.route_id])).rows[0].count), 0);
    assert.equal((await db.query("SELECT state FROM trips WHERE id=$1", [variables.trip_id])).rows[0].state, "finished");
  } finally {
    await new Promise(resolve => server.close(resolve));
    await db.close();
  }
});

// Exercises the real entry point with an isolated persistent database.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { root } from "../server/src/db.js";

const directory = await mkdtemp(path.join(tmpdir(), "trailway-launch-"));
const reservation = net.createServer();
await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port), DATABASE_URL: "", DB_DIR: directory, SEED_DEMO: "true", TOKEN_SECRET: randomBytes(48).toString("hex"), CLIENT_ORIGIN: "http://localhost:5174/, http://127.0.0.1:5174/" };
const checks = [];
let child, output = "";
async function start() {
  output = "";
  child = spawn(process.execPath, ["server/src/index.js"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", value => { output += value.toString(); });
  child.stderr.on("data", value => { output += value.toString(); });
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null) throw Error("Server stopped before startup: " + output);
    if (output.includes("Trailway:")) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error("Server startup timeout: " + output);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const instance = child;
  const timer = setTimeout(() => instance.kill("SIGKILL"), 5000);
  await new Promise(resolve => { instance.once("exit", resolve); instance.kill("SIGTERM"); });
  clearTimeout(timer);
}
async function login(origin = "http://127.0.0.1:5173") {
  const response = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ email: "oleh@example.com", password: "Tourist2026!" }) });
  assert.equal(response.status, 200);
  return (await response.json()).access_token;
}
try {
  await start();
  const health = await fetch(base + "/api/health");
  assert.deepEqual(await health.json(), { status: "ok", database: "pglite" });
  checks.push("Real server entry point connects the persistent database and seeds demo users");
  const ui = await fetch(base);
  assert.equal(ui.status, 200);
  assert.match(await ui.text(), /id="root"/);
  checks.push("Production React HTML is served by the API server");
  assert.equal((await fetch(base + "/docs")).status, 200);
  assert.equal((await fetch(base + "/api/openapi.json")).status, 200);
  checks.push("Swagger and OpenAPI are accessible");
  const token = await login();
  checks.push("The real entry point accepts the local 127.0.0.1 frontend origin");
  const created = await fetch(base + "/api/routes", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ name: "Тест перезапуску сервера", state: "draft", points: [{ label_snapshot: "Тестова точка", latitude: 48.92, longitude: 24.71 }] }) });
  assert.equal(created.status, 201);
  const route = await created.json();
  checks.push("Authenticated route creation writes SQL data");
  await stop();
  await start();
  const nextToken = await login("http://127.0.0.1:5174");
  checks.push("CLIENT_ORIGIN is loaded from the environment and normalizes comma-separated origins with trailing slashes");
  const saved = await fetch(base + "/api/routes/" + route.id, { headers: { Authorization: "Bearer " + nextToken } });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).name, route.name);
  checks.push("The same route survives a complete server process restart");
  const removed = await fetch(base + "/api/routes/" + route.id, { method: "DELETE", headers: { Authorization: "Bearer " + nextToken } });
  assert.equal(removed.status, 204);
  checks.push("Cleanup through the actual API succeeds");
  const result = { date: new Date().toISOString(), node: process.version, database: "pglite", status: "passed", checks };
  await writeFile(path.join(root, "docs/evidence/launch-smoke.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally { await stop(); await rm(directory, { recursive: true, force: true }); }

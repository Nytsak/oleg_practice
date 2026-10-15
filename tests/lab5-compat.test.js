import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase, root } from "../server/src/db.js";
import { seedDatabase, demoUsers } from "../server/src/seed.js";
import { hashPassword, verifyPassword } from "../server/src/security.js";
import { createApp } from "../server/src/app.js";

const tables = ["users", "place_categories", "tourist_places", "routes", "route_points", "trips", "track_points", "share_links", "sync_operations"];
const legacy = { tourist: "11111111-1111-1111-1111-111111111111", admin: "22222222-2222-2222-2222-222222222222", route: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", trip: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };
const fixture = await readFile(new URL("./fixtures/lab5.sql", import.meta.url), "utf8");
async function snapshot(db) {
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows])));
}
function preserved(before, after) {
  for (const table of tables) for (const old of before[table]) {
    const current = after[table].find(row => String(row.id) === String(old.id));
    assert.ok(current, `${table}: original row ${old.id} exists`);
    for (const [key, value] of Object.entries(old)) {
      if (table === "users" && key === "password_hash") continue;
      assert.deepEqual(current[key], value, `${table}.${key}: original value is preserved`);
    }
  }
}

test("Actual setup upgrades the Lab 5 database, preserves every original business row and restores login", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "trailway-lab5-"));
  let engine, db, server;
  try {
    engine = new PGlite(directory);
    await engine.exec(fixture);
    const before = await snapshot(engine);
    await engine.close(); engine = null;
    const runSetup = () => {
      const result = spawnSync(process.execPath, ["server/src/setup.js"], {
        cwd: root, encoding: "utf8", timeout: 30000,
        env: { ...process.env, DATABASE_URL: "", DB_DIR: directory, NODE_ENV: "test" },
      });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    assert.match(runSetup(), /заглушк/);
    db = await openDatabase({ directory, url: "" });
    const after = await snapshot(db);
    preserved(before, after);
    assert.equal(after.users.length, 2);
    assert.equal(after.tourist_places.length, 6, "legacy places are reused instead of duplicated");
    assert.equal(after.routes.length, 3, "the historical route is reused");
    assert.equal(after.trips.length, 1, "the historical trip is reused");
    for (const role of ["tourist", "admin"]) {
      const user = after.users.find(user => user.email === demoUsers[role].email);
      assert.equal(user.id, legacy[role]);
      assert.ok(await verifyPassword(demoUsers[role].password, user.password_hash));
    }
    await db.close(); db = null;
    runSetup();
    db = await openDatabase({ directory, url: "" });
    assert.deepEqual(await snapshot(db), after, "repeated setup does not rewrite existing rows or hashes");
    server = createApp(db, { secret: "lab5-compatibility-secret-with-at-least-32-characters", logging: false }).listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const role of ["tourist", "admin"]) {
      const response = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify(demoUsers[role]) });
      assert.equal(response.status, 200);
      const session = await response.json();
      assert.equal(session.user.id, legacy[role]);
      const headers = { Authorization: "Bearer " + session.access_token };
      if (role === "tourist") {
        const route = await (await fetch(base + "/api/routes/" + legacy.route, { headers })).json();
        assert.equal(route.version, 3);
        assert.equal(route.points.length, 3);
        const trip = await (await fetch(base + "/api/trips/" + legacy.trip, { headers })).json();
        assert.equal(trip.points.length, 3);
        assert.equal(trip.distance_m, 7900);
      } else {
        assert.equal((await fetch(base + "/api/admin/places", { headers })).status, 200);
      }
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.close();
    if (engine) await engine.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Existing account IDs, names, roles and real passwords are preserved", async () => {
  const db = await openDatabase({ directory: "memory://", url: "" });
  try {
    const hash = await hashPassword("MyExistingPassword2026!");
    for (const u of Object.values(demoUsers)) await db.query("INSERT INTO users(id,email,password_hash,display_name,role) VALUES($1,$2,$3,'Existing name','tourist')", [randomUUID(), u.email, hash]);
    const before = (await db.query("SELECT * FROM users ORDER BY email")).rows;
    await seedDatabase(db);
    assert.deepEqual((await db.query("SELECT * FROM users ORDER BY email")).rows, before);
    const admin = before.find(user => user.email === demoUsers.admin.email);
    assert.equal((await db.query("SELECT DISTINCT created_by FROM tourist_places")).rows[0].created_by, admin.id);
  } finally { await db.close(); }
});

test("A preferred demo UUID occupied by another account never changes that account or its ownership", async () => {
  const db = await openDatabase({ directory: "memory://", url: "" });
  try {
    await db.query("INSERT INTO users(id,email,password_hash,display_name,role) VALUES($1,'owner@example.test','unrelated-hash','Original owner','tourist')", [demoUsers.admin.id]);
    const original = (await db.query("SELECT * FROM users")).rows[0];
    await seedDatabase(db);
    assert.deepEqual((await db.query("SELECT * FROM users WHERE id=$1", [original.id])).rows[0], original);
    const admin = (await db.query("SELECT id FROM users WHERE email=$1", [demoUsers.admin.email])).rows[0];
    assert.notEqual(admin.id, original.id);
    assert.ok((await db.query("SELECT created_by FROM tourist_places")).rows.every(place => place.created_by === admin.id));
  } finally { await db.close(); }
});

test("Categories are resolved by code when an existing database uses different numeric IDs", async () => {
  const db = await openDatabase({ directory: "memory://", url: "" });
  try {
    await db.query("INSERT INTO place_categories(id,code,name) VALUES(1,'other','Original category'),(10,'nature','Existing nature'),(20,'viewpoint','Existing viewpoints')");
    await seedDatabase(db);
    const rows = (await db.query("SELECT p.name,c.code,p.category_id FROM tourist_places p JOIN place_categories c ON c.id=p.category_id")).rows;
    assert.ok(rows.filter(p => p.code === "nature").every(p => p.category_id === 10));
    assert.ok(rows.filter(p => p.code === "viewpoint").every(p => p.category_id === 20));
    assert.equal((await db.query("SELECT name FROM place_categories WHERE id=1")).rows[0].name, "Original category");
  } finally { await db.close(); }
});

test("Fresh setup is idempotent and placeholder migration is limited to the two known demo accounts", async () => {
  const db = await openDatabase({ directory: "memory://", url: "" });
  try {
    await db.query("INSERT INTO users(email,password_hash,display_name) VALUES('someone@example.test','$hash$oleh','Keep this account')");
    await seedDatabase(db);
    const once = await snapshot(db);
    await seedDatabase(db);
    assert.deepEqual(await snapshot(db), once);
    assert.equal(once.users.find(user => user.email === "someone@example.test").password_hash, "$hash$oleh");
    assert.equal(once.users.length, 3);
  } finally { await db.close(); }
});

test("A failed setup rolls back placeholder updates and all new demo records", async () => {
  const db = await openDatabase({ directory: "memory://", url: "" });
  try {
    await db.query("INSERT INTO users(id,email,password_hash,display_name,role) VALUES($1,$2,'$hash$admin','Original admin','admin')", [legacy.admin, demoUsers.admin.email]);
    await db.exec("CREATE FUNCTION reject_demo_place() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test setup rollback'; END $$; CREATE TRIGGER reject_demo_place BEFORE INSERT ON tourist_places FOR EACH ROW EXECUTE FUNCTION reject_demo_place()");
    const before = await snapshot(db);
    await assert.rejects(seedDatabase(db), /test setup rollback/);
    assert.deepEqual(await snapshot(db), before);
  } finally { await db.close(); }
});

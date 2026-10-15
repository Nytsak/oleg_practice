import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../server/src/db.js";
test("Embedded PostgreSQL persists data and migrations across restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "trailway-db-"));
  let db;
  try {
    db = await openDatabase({ directory });
    await db.query(
      "INSERT INTO users(email,password_hash,display_name) VALUES('persist@example.com','test-only','Persist')",
    );
    await db.close();
    db = await openDatabase({ directory });
    assert.equal(
      (await db.query("SELECT display_name FROM users")).rows[0].display_name,
      "Persist",
    );
    assert.equal(
      Number(
        (await db.query("SELECT count(*) FROM schema_migrations")).rows[0]
          .count,
      ),
      1,
    );
  } finally {
    if (db && !db.closed) await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

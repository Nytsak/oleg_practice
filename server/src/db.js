import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export async function openDatabase({
  url = process.env.DATABASE_URL,
  directory = process.env.DB_DIR || path.join(root, "data", "pgdata"),
} = {}) {
  let db;
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    db = {
      mode: "postgres",
      query: (sql, params) => pool.query(sql, params),
      exec: (sql) => pool.query(sql),
      close: () => pool.end(),
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn(client);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    };
  } else {
    if (directory !== "memory://") await mkdir(directory, { recursive: true });
    const engine = new PGlite(
      directory === "memory://" ? undefined : directory,
    );
    await engine.waitReady;
    db = {
      mode: "pglite",
      query: (sql, params) => engine.query(sql, params),
      exec: (sql) => engine.exec(sql),
      transaction: (fn) => engine.transaction(fn),
      close: () => engine.close(),
    };
  }
  try {
    await db.transaction(async (tx) => {
      await tx.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
      );
      const applied = await tx.query(
        "SELECT version FROM schema_migrations WHERE version=1",
      );
      if (!applied.rows.length) {
        const sql = await readFile(
          path.join(root, "server/sql/001_schema.sql"),
          "utf8",
        );
        if (tx.exec) await tx.exec(sql);
        else await tx.query(sql);
      }
    });
    return db;
  } catch (e) {
    await db.close();
    throw e;
  }
}

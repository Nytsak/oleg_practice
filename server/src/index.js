import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { openDatabase, root } from "./db.js";
import { seedDatabase } from "./seed.js";
import { createApp } from "./app.js";
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const port = Number(process.env.PORT || 3001);
let secret = process.env.TOKEN_SECRET;
if (!secret) {
  if (process.env.NODE_ENV === "production")
    throw Error("Для production задайте TOKEN_SECRET у середовищі.");
  const dir = path.join(root, "data");
  await mkdir(dir, { recursive: true });
  const keyfile = path.join(dir, "token-secret");
  try {
    secret = await readFile(keyfile, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    secret = randomBytes(48).toString("hex");
    await writeFile(keyfile, secret, { mode: 0o600 });
  }
}
const db = await openDatabase();
if (process.env.SEED_DEMO !== "false") {
  const users = (await db.query("SELECT count(*) FROM users")).rows[0].count;
  if (Number(users) === 0) await seedDatabase(db);
}
const app = createApp(db, { secret });
const server = app.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(
    `Trailway: http://localhost:${port} | API docs: http://localhost:${port}/docs | DB: ${db.mode}`,
  ),
);
server.on("error", async (e) => {
  console.error(e.message);
  await db.close();
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await db.close();
      process.exit(0);
    }),
  );

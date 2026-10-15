import path from "node:path";
import { openDatabase, root } from "./db.js";
import { seedDatabase, demoUsers } from "./seed.js";
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const db = await openDatabase();
try {
  const result = await seedDatabase(db);
  console.log(`Схему та демодані підготовлено (${db.mode}). Наявні UUID, ролі й пов’язані дані збережено.`);
  for (const user of result.accounts) {
    const status = user.status === "created" ? "Створено" : user.status === "placeholder_migrated"
      ? "Навчальну заглушку пароля з лабораторної №5 оновлено" : "Обліковий запис існує; його пароль збережено";
    console.log(`${status}: ${user.email}; UUID: ${user.id}; роль: ${user.role}.`);
    if (user.status !== "preserved") {
      const demo = Object.values(demoUsers).find(demo => demo.email === user.email);
      console.log(`Демонстраційний вхід: ${demo.email} / ${demo.password}`);
    }
  }
} finally {
  await db.close();
}

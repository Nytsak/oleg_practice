// Optional browser verification: see README. API tests do not need Playwright.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { openDatabase } from "../server/src/db.js";
import { createApp } from "../server/src/app.js";
import { seedDatabase } from "../server/src/seed.js";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = process.env.E2E_OUTPUT || "test-results";
await mkdir(output, { recursive: true });
const db = await openDatabase({ directory: "memory://" });
await seedDatabase(db);
const server = createApp(db, {
  secret: "e2e-only-secret-at-least-thirty-two-characters",
  logging: false,
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}`;
const launch = {
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-zygote",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
};
if (process.env.CHROMIUM_EXECUTABLE_PATH)
  launch.executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
let browser;
const errors = [],
  checks = [];
const passed = (label) => {
  checks.push(label);
  console.log("PASS:", label);
};
async function bounded(promise, label, milliseconds = 15000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out: " + label)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
async function clearToast(p) {
  const button = p.getByRole("button", {
    name: "Закрити повідомлення",
    exact: true,
  });
  if (await button.count()) await button.click();
}
async function login(p, email = "oleh@example.com", password = "Tourist2026!") {
  await p.getByRole("button", { name: "Увійти", exact: true }).click();
  await p.getByLabel("Електронна адреса").fill(email);
  await p.getByLabel("Пароль", { exact: true }).fill(password);
  await p
    .getByRole("dialog")
    .getByRole("button", { name: "Увійти", exact: true })
    .click();
  await p.getByRole("dialog").waitFor({ state: "hidden" });
  await clearToast(p);
}
async function overflow(p) {
  assert.ok(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "No horizontal overflow",
  );
}
async function addRoute(p, name) {
  await p.getByRole("button", { name: "Новий маршрут", exact: true }).click();
  await p.getByLabel("Назва маршруту").fill(name);
  for (const id of [
    "33333333-3333-4333-8333-333333333331",
    "33333333-3333-4333-8333-333333333333",
  ]) {
    await p.getByLabel("Локація з каталогу").selectOption(id);
    await p.locator(".inline-field button").click();
  }
  await p.getByLabel("Стан маршруту").selectOption("ready");
}
try {
  browser = await chromium.launch(launch);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["geolocation"],
    geolocation: { latitude: 48.92, longitude: 24.7 },
    locale: "uk-UA",
  });
  const p = await context.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(url);
  await login(p);
  await p
    .getByRole("button", { name: "Від озера до пагорбів", exact: true })
    .waitFor();
  await overflow(p);
  await p.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  passed("Desktop login, catalogue and seeded routes");
  const routeCount = (await db.query("SELECT count(*) FROM routes")).rows[0].count;
  await p.getByRole("button", { name: "Новий маршрут", exact: true }).click();
  const dialog = p.getByRole("dialog");
  await dialog.waitFor();
  await dialog.focus();
  await p.keyboard.press("Shift+Tab");
  assert.equal(await p.evaluate(() => document.activeElement.textContent.trim()), "Зберегти маршрут");
  await p.keyboard.press("Tab");
  assert.equal(await p.evaluate(() => document.activeElement.getAttribute("aria-label")), "Закрити");
  await p.keyboard.press("Shift+Tab");
  assert.equal(await p.evaluate(() => document.activeElement.textContent.trim()), "Зберегти маршрут");
  await p.getByLabel("Назва маршруту").fill("Незбережена перевірка");
  await p.getByLabel("Локація з каталогу").selectOption("33333333-3333-4333-8333-333333333331");
  await p.getByRole("button", { name: "Додати локацію до маршруту", exact: true }).click();
  await p.getByLabel("Стан маршруту").selectOption("ready");
  await p.getByRole("button", { name: "Зберегти маршрут", exact: true }).click();
  await p.getByRole("alert").filter({ hasText: "дві точки" }).waitFor();
  assert.equal((await db.query("SELECT count(*) FROM routes")).rows[0].count, routeCount);
  await p.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await p.evaluate(() => document.activeElement.textContent.trim()), "Новий маршрут");
  passed("Keyboard focus, Escape cancellation and ready-route validation with one point");
  await p.setViewportSize({ width: 390, height: 844 });
  await overflow(p);
  const heroLayout = await p.locator(".hero").evaluate((hero) => ({
    copyBottom: hero.querySelector(":scope > div").getBoundingClientRect()
      .bottom,
    imageTop: hero.querySelector(":scope > svg").getBoundingClientRect().top,
  }));
  assert.ok(
    heroLayout.imageTop >= heroLayout.copyBottom,
    "Mobile hero illustration must leave the text unobscured",
  );
  await p.screenshot({ path: `${output}/mobile.png` });
  await p.locator(".route-card").first().scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${output}/mobile-routes.png` });
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.evaluate(() => scrollTo(0, 0));
  passed(
    "Mobile layout at 390 px has no horizontal overflow or hero text overlap",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  const mobileNav = p.getByRole("navigation", { name: "Мобільна навігація" });
  await mobileNav.getByRole("link", { name: "Локації", exact: true }).click();
  await p.getByRole("heading", { name: "Місця, до яких хочеться піти" }).waitFor();
  assert.equal(await mobileNav.locator('[aria-current="page"]').innerText(), "Локації");
  await overflow(p);
  await p.screenshot({ path: `${output}/mobile-places.png`, fullPage: true });
  await mobileNav.getByRole("link", { name: "Маршрути", exact: true }).click();
  await p.getByRole("heading", { name: "Куди вирушимо цього разу?", exact: true }).waitFor();
  assert.equal(await mobileNav.locator('[aria-current="page"]').innerText(), "Маршрути");
  await p.setViewportSize({ width: 1440, height: 1000 });
  passed("Mobile navigation opens the catalogue and identifies the current screen");
  await addRoute(p, "Наскрізний тест маршруту");
  await p.screenshot({ path: `${output}/editor.png` });
  await p
    .getByRole("button", { name: "Зберегти маршрут", exact: true })
    .click();
  await p.getByRole("dialog").waitFor({ state: "hidden" });
  await p
    .getByRole("button", { name: "Наскрізний тест маршруту", exact: true })
    .waitFor();
  await clearToast(p);
  await p
    .getByRole("button", {
      name: "Редагувати Наскрізний тест маршруту",
      exact: true,
    })
    .click();
  await p.getByLabel("Короткий опис").fill("Зміна опису через реальний API.");
  await p
    .getByRole("button", { name: "Зберегти маршрут", exact: true })
    .click();
  await p.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    (
      await db.query("SELECT version FROM routes WHERE name=$1", [
        "Наскрізний тест маршруту",
      ])
    ).rows[0].version,
    2,
  );
  await clearToast(p);
  passed("Create and edit a route through the UI and real API");
  await p
    .getByRole("button", { name: "Поділитися маршрутом", exact: true })
    .click();
  const shareUrl = await p
    .getByLabel("Посилання", { exact: true })
    .inputValue();
  const outsider = await browser.newContext();
  const sp = await outsider.newPage();
  await sp.goto(shareUrl);
  await sp
    .getByRole("heading", { name: "Наскрізний тест маршруту", exact: true })
    .waitFor();
  await sp.screenshot({ path: `${output}/shared.png`, fullPage: true });
  await p
    .getByRole("button", { name: "Відкликати", exact: true })
    .first()
    .click();
  await sp.reload();
  await sp.getByRole("alert").waitFor();
  await outsider.close();
  await p.getByRole("button", { name: "Закрити", exact: true }).click();
  passed("Anonymous sharing and revocation");
  await p.getByRole("button", { name: "Почати подорож", exact: true }).click();
  await p.getByRole("heading", { name: "Подорожі та GPS-треки" }).waitFor();
  await context.setGeolocation({
    latitude: 48.92,
    longitude: 24.7,
    accuracy: 5,
  });
  await p.getByRole("button", { name: "Записувати GPS", exact: true }).click();
  await p.getByText(/Точність \d+ м/).waitFor();
  await p.getByRole("button", { name: "Зупинити GPS", exact: true }).click();
  await clearToast(p);
  await p.screenshot({ path: `${output}/trip.png`, fullPage: true });
  await p.getByRole("button", { name: "Пауза", exact: true }).click();
  await p.getByRole("button", { name: "Продовжити", exact: true }).waitFor();
  await p.getByRole("button", { name: "Продовжити", exact: true }).click();
  await p.getByRole("button", { name: "Завершити", exact: true }).click();
  await p.locator(".active-trip").waitFor({ state: "hidden" });
  assert.ok(
    Number(
      (await db.query("SELECT count(*) FROM track_points")).rows[0].count,
    ) >= 1,
  );
  passed("Browser geolocation fixture, pause, resume and finish");
  await p.goto(url + "/#/places");
  await p
    .getByRole("heading", { name: "Місця, до яких хочеться піти" })
    .waitFor();
  await p.screenshot({ path: `${output}/places.png`, fullPage: true });
  await p.goto(url + "/#/routes");
  await p.getByRole("button", { name: "Новий маршрут", exact: true }).waitFor();
  await context.setOffline(true);
  await p.getByText("Офлайн", { exact: true }).waitFor();
  await addRoute(p, "Офлайн перевірка");
  await p
    .getByRole("button", { name: "Зберегти маршрут", exact: true })
    .click();
  await p.getByRole("dialog").waitFor({ state: "hidden" });
  await clearToast(p);
  await p.screenshot({ path: `${output}/offline.png`, fullPage: true });
  await p.reload();
  await p
    .getByRole("button", { name: "Офлайн перевірка", exact: true })
    .waitFor();
  await context.setOffline(false);
  await p.waitForFunction(async () => {
    const db = await new Promise((r, j) => {
      const x = indexedDB.open("trailway-local", 1);
      x.onsuccess = () => r(x.result);
      x.onerror = () => j(x.error);
    });
    const record = await new Promise((r) => {
      const x = db
        .transaction("records")
        .objectStore("records")
        .get("scope:11111111-1111-4111-8111-111111111111");
      x.onsuccess = () => r(x.result);
    });
    return record?.queue.length === 0;
  });
  assert.equal(
    (
      await db.query("SELECT count(*) FROM routes WHERE name=$1", [
        "Офлайн перевірка",
      ])
    ).rows[0].count,
    1,
  );
  passed(
    "Offline save, reload from service worker and synchronization without duplicates",
  );
  await p
    .getByRole("button", {
      name: "Видалити Наскрізний тест маршруту",
      exact: true,
    })
    .click();
  await p
    .getByRole("dialog")
    .getByRole("button", { name: "Видалити маршрут", exact: true })
    .click();
  await p.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    (
      await db.query("SELECT count(*) FROM routes WHERE name=$1", [
        "Наскрізний тест маршруту",
      ])
    ).rows[0].count,
    0,
  );
  passed("Delete route through UI");
  await context.setOffline(true);
  await p.getByText("Офлайн", { exact: true }).waitFor();
  for (const name of ["Локальна зміна один", "Локальна зміна два"]) {
    const edit = p.getByRole("button", {
      name:
        "Редагувати " +
        (name.endsWith("один") ? "Офлайн перевірка" : "Локальна зміна один"),
      exact: true,
    });
    await edit.click();
    await p.getByLabel("Назва маршруту").fill(name);
    await p
      .getByRole("button", { name: "Зберегти маршрут", exact: true })
      .click();
    await p.getByRole("dialog").waitFor({ state: "hidden" });
    await clearToast(p);
  }
  await db.query(
    "UPDATE routes SET name='Серверна копія',version=version+1 WHERE name='Офлайн перевірка'",
  );
  await context.setOffline(false);
  await p
    .getByRole("button", {
      name: "Відкинути локальні зміни та оновити",
      exact: true,
    })
    .waitFor();
  const protectedRoute = (
    await db.query(
      "SELECT name,version FROM routes WHERE name='Серверна копія'",
    )
  ).rows[0];
  assert.equal(protectedRoute.version, 2);
  await p
    .getByRole("button", {
      name: "Відкинути локальні зміни та оновити",
      exact: true,
    })
    .click();
  await p
    .getByRole("button", { name: "Серверна копія", exact: true })
    .waitFor();
  passed(
    "Conflict blocks later changes of the same route until explicit resolution",
  );
  const guest = await browser.newContext({
      viewport: { width: 1200, height: 900 },
    }),
    gp = await guest.newPage();
  gp.on("pageerror", (e) => errors.push(e.message));
  await gp.goto(url);
  await gp.locator(".places-grid").count();
  await gp.waitForFunction(() => document.body.textContent.includes("6"));
  await addRoute(gp, "Гостьовий план");
  await gp
    .getByRole("button", { name: "Зберегти маршрут", exact: true })
    .click();
  await gp.getByRole("dialog").waitFor({ state: "hidden" });
  await clearToast(gp);
  await gp.getByRole("button", { name: "Увійти", exact: true }).click();
  await gp.screenshot({ path: `${output}/login.png` });
  await gp.getByRole("button", { name: "Реєстрація", exact: true }).click();
  await gp.getByLabel("Ім’я", { exact: true }).fill("Тестовий мандрівник");
  await gp.getByLabel("Електронна адреса").fill("e2e@example.com");
  await gp.getByLabel("Пароль", { exact: true }).fill("LongPassword2026");
  await gp
    .getByRole("button", { name: "Зареєструватися", exact: true })
    .click();
  await gp.getByRole("dialog").waitFor({ state: "hidden" });
  await clearToast(gp);
  await gp.getByRole("button", { name: /Синхронізувати \(1\)/ }).click();
  await gp.waitForFunction(
    () => !document.body.textContent.includes("Синхронізуємо"),
  );
  const imported = await db.query(
    "SELECT r.id FROM routes r JOIN users u ON u.id=r.owner_id WHERE r.name='Гостьовий план' AND u.email='e2e@example.com'",
  );
  assert.equal(imported.rows.length, 1);
  await gp.getByRole("button", { name: "Вийти", exact: true }).click();
  await gp.getByText("Гостьовий режим", { exact: true }).waitFor();
  assert.equal(
    await gp
      .getByRole("button", { name: "Гостьовий план", exact: true })
      .count(),
    0,
  );
  await guest.close();
  passed(
    "Guest draft import on registration and private data isolation on logout",
  );
  const privacy = await browser.newContext({
    viewport: { width: 1200, height: 900 },
  });
  const pp = await privacy.newPage();
  pp.on("pageerror", (error) => errors.push(error.message));
  await pp.goto(url);
  await login(pp);
  await pp
    .getByRole("button", { name: "Від озера до пагорбів", exact: true })
    .waitFor();
  let releasePrivate, capturePrivate;
  const privateGate = new Promise((resolve) => {
    releasePrivate = resolve;
  });
  const privateStarted = new Promise((resolve) => {
    capturePrivate = resolve;
  });
  await pp.route("**/api/routes?*", async (route) => {
    // Hold the actual private response so logout can overtake its delivery.
    const response = await route.fetch();
    capturePrivate();
    await privateGate;
    await route.fulfill({ response });
  });
  try {
    await pp.reload({ waitUntil: "domcontentloaded" });
    await bounded(privateStarted, "private request after reload");
    await pp.getByRole("button", { name: "Вийти", exact: true }).click();
    await pp.getByText("Гостьовий режим", { exact: true }).waitFor();
    const late = pp.waitForResponse((response) =>
      response.url().includes("/api/routes?"),
    );
    releasePrivate();
    const lateResponse = await bounded(late, "late response arrival");
    assert.equal(lateResponse.status(), 200);
    // The client intentionally rejects this Response before reading its body.
    // Wait for rendering, then verify that the private UI remains cleared.
    await pp.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(await pp.locator(".route-card").count(), 0);
    assert.equal(
      await pp
        .getByRole("button", { name: "Від озера до пагорбів", exact: true })
        .count(),
      0,
    );
    await pp.screenshot({
      path: `${output}/privacy-logout.png`,
      fullPage: true,
    });
  } finally {
    releasePrivate();
    await privacy.close();
  }
  passed(
    "A delayed private route response cannot repopulate the guest UI after logout",
  );

  const credentials = await context.request.post(url + "/api/auth/login", {
    data: { email: "oleh@example.com", password: "Tourist2026!" },
  });
  const account = await credentials.json();
  const names = (
    await db.query(
      "SELECT id,name FROM routes WHERE owner_id='11111111-1111-4111-8111-111111111111' AND state='ready' ORDER BY name LIMIT 2",
    )
  ).rows;
  const links = [];
  for (const route of names) {
    const response = await context.request.post(
      `${url}/api/routes/${route.id}/shares`,
      {
        headers: { Authorization: "Bearer " + account.access_token },
        data: {},
      },
    );
    assert.equal(response.status(), 201);
    links.push(await response.json());
  }
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  publicPage.on("pageerror", (error) => errors.push(error.message));
  let releaseShare, captureShare;
  const shareGate = new Promise((resolve) => {
    releaseShare = resolve;
  });
  const shareStarted = new Promise((resolve) => {
    captureShare = resolve;
  });
  await publicPage.route("**/api/shares/*", async (route) => {
    if (route.request().url().endsWith(links[0].token)) {
      captureShare();
      await shareGate;
    }
    await route.continue();
  });
  try {
    await publicPage.goto(url + links[0].path);
    await shareStarted;
    await publicPage.evaluate((path) => {
      location.hash = path.slice(1);
    }, links[1].path);
    await publicPage
      .getByRole("heading", { name: names[1].name, exact: true })
      .waitFor();
    const late = publicPage.waitForResponse((response) =>
      response.url().endsWith(links[0].token),
    );
    releaseShare();
    await (await late).finished();
    await publicPage.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(
      await publicPage
        .getByRole("heading", { name: names[1].name, exact: true })
        .count(),
      1,
    );
    assert.equal(
      await publicPage
        .getByRole("heading", { name: names[0].name, exact: true })
        .count(),
      0,
    );
    await publicPage.screenshot({
      path: `${output}/share-navigation.png`,
      fullPage: true,
    });
  } finally {
    releaseShare();
    await publicContext.close();
  }
  passed(
    "Switching shared links ignores an older response and keeps the requested route",
  );

  const admin = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    ap = await admin.newPage();
  ap.on("pageerror", (e) => errors.push(e.message));
  await ap.goto(url);
  await login(ap, "admin@example.com", "Admin2026!");
  await ap.getByRole("link", { name: "Адміністрування", exact: true }).click();
  await ap.getByRole("button", { name: "Додати локацію", exact: true }).click();
  await ap.getByLabel("Назва локації").fill("Локація наскрізного тесту");
  await ap
    .getByRole("button", { name: "Зберегти локацію", exact: true })
    .click();
  await ap.getByRole("dialog").waitFor({ state: "hidden" });
  await clearToast(ap);
  await ap.screenshot({ path: `${output}/admin.png`, fullPage: true });
  assert.equal(
    (
      await db.query("SELECT count(*) FROM tourist_places WHERE name=$1", [
        "Локація наскрізного тесту",
      ])
    ).rows[0].count,
    1,
  );
  await admin.close();
  passed("Admin UI writes catalogue records to PostgreSQL");
  const dp = await context.newPage();
  await dp.goto(url + "/docs");
  await dp
    .getByRole("heading", { name: "Trailway REST API", exact: false })
    .waitFor();
  await dp.screenshot({ path: `${output}/swagger.png`, fullPage: true });
  await dp
    .locator(".opblock-summary")
    .filter({ hasText: "/health" })
    .first()
    .click();
  await dp.getByRole("button", { name: "Try it out", exact: true }).click();
  const healthResponse = dp.waitForResponse(
    (response) => response.url() === url + "/api/health",
  );
  await dp.getByRole("button", { name: "Execute", exact: true }).click();
  const health = await healthResponse;
  assert.equal(health.status(), 200);
  assert.equal((await health.json()).database, "pglite");
  await dp.setViewportSize({ width: 1440, height: 1800 });
  await dp.locator(".live-responses-table .response-col_status").filter({ hasText: "200" }).waitFor();
  await dp.evaluate(() => window.scrollTo(0, 0));
  const healthBlock = dp.locator(".opblock").filter({ hasText: "/health" }).first();
  const requestBox = await healthBlock.locator(".request-url").boundingBox();
  const labelBox = await healthBlock.getByRole("heading", { name: "Request URL", exact: true }).boundingBox();
  const responseBox = await healthBlock.locator(".live-responses-table").boundingBox();
  await dp.screenshot({ path: `${output}/swagger-health.png`, clip: {
    x: requestBox.x, y: labelBox.y - 2, width: requestBox.width,
    height: responseBox.y + responseBox.height - labelBox.y + 4,
  } });
  passed(
    "Swagger UI loads OpenAPI and executes the health request against the real API",
  );
  assert.deepEqual(errors, []);
  passed("No browser JavaScript errors");
  await writeFile(
    `${output}/e2e-results.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        node: process.version,
        checks,
        errors,
        viewport: { desktop: [1440, 1000], mobile: [390, 844] },
        geolocation: "browser test fixture",
      },
      null,
      2,
    ),
  );
} catch (e) {
  if (browser)
    for (const c of browser.contexts())
      for (const p of c.pages()) {
        await p.screenshot({ path: `${output}/failure.png` }).catch(() => {});
        console.error(
          "VISIBLE ERROR:",
          await p
            .locator(".toast-error")
            .allTextContents()
            .catch(() => []),
        );
      }
  throw e;
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
  await db.close();
}

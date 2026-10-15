import express from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApiError, errorHandler } from "./errors.js";
import { authMiddleware } from "./security.js";
import { root } from "./db.js";
import { openapi } from "./openapi.js";
import { createAuthRouter } from "./routers/auth.js";
import { createCatalogRouter } from "./routers/catalog.js";
import { createRoutesRouter } from "./routers/routes.js";
import { createTripsRouter } from "./routers/trips.js";
import { createSyncRouter } from "./routers/sync.js";

function clientOrigins(value) {
  const origins = new Set();
  for (const item of value.split(",").map(item => item.trim()).filter(Boolean)) {
    try {
      const url = new URL(item);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
        throw Error("invalid origin");
      origins.add(url.origin);
    } catch {
      throw Error("CLIENT_ORIGIN: задайте адресу http(s)://host:port без шляху; кілька адрес розділяйте комами.");
    }
  }
  return origins;
}

const isLoopback = hostname => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);

export function createApp(db, { secret, logging = true, clientOrigin = process.env.CLIENT_ORIGIN || "" } = {}) {
  if (!secret || secret.length < 32)
    throw Error("TOKEN_SECRET має містити щонайменше 32 символи.");
  const allowedOrigins = clientOrigins(clientOrigin);
  const localDevelopment = process.env.NODE_ENV !== "production";
  const app = express();
  app.disable("x-powered-by");
  // PostgreSQL NUMERIC is returned as text by drivers; the API contract uses numbers.
  app.set("json replacer", (key, value) =>
    ["latitude", "longitude", "accuracy_m"].includes(key) && value !== null
      ? Number(value)
      : value,
  );
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    const time = Date.now();
    if (logging)
      res.on("finish", () =>
        console.log(
          JSON.stringify({
            requestId: req.requestId,
            method: req.method,
            path: req.route?.path
              ? `${req.originalUrl.startsWith("/api/") && !req.route.path.startsWith("/api/") ? "/api" : ""}${req.route.path}`
              : req.path.replace(/\/shares\/[^/]+$/, "/shares/:token"),
            status: res.statusCode,
            ms: Date.now() - time,
          }),
        ),
      );
    next();
  });
  // API data and credentials must never enter the browser HTTP cache.
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      if ((Number(req.headers["content-length"]) > 0 || req.headers["transfer-encoding"]) && !req.is("application/json"))
        return next(new ApiError(415, "Використайте Content-Type: application/json."));
      req.body ??= {};
      if (
        typeof req.body !== "object" ||
        Array.isArray(req.body) ||
        req.body === null
      )
        return next(new ApiError(400, "Тіло запиту має бути JSON-об’єктом."));
    }
    next();
  });
  app.use((req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin
    ) {
      let permitted = false;
      try {
        const origin = new URL(req.headers.origin);
        const target = new URL(`${req.protocol}://${req.headers.host}`);
        // Browser Origin is a serialized origin, never a path, credentials or "null".
        if (req.headers.origin === origin.origin) {
          permitted = origin.origin === target.origin || allowedOrigins.has(origin.origin);
          // Only local development: support loopback aliases and the default Vite port.
          // Do not trust forwarded headers or grant access to arbitrary local ports.
          permitted ||= localDevelopment && isLoopback(origin.hostname) && isLoopback(target.hostname)
            && origin.protocol === target.protocol && (origin.port === target.port || origin.port === "5173");
        }
      } catch { /* An opaque or malformed origin stays forbidden. */ }
      if (!permitted)
        return next(new ApiError(403, "Адреса сторінки не дозволена сервером. Перевірте CLIENT_ORIGIN."));
    }
    next();
  });
  const auth = authMiddleware(db, secret);
  app.get("/api/health", async (req, res) => {
    await db.query("SELECT 1");
    res.json({ status: "ok", database: db.mode });
  });
  // HTTP controllers are grouped by domain; services own transactions and rules.
  app.use("/api", createAuthRouter(db, secret, auth));
  app.use("/api", createCatalogRouter(db, auth));
  app.use("/api", createRoutesRouter(db, auth));
  app.use("/api", createTripsRouter(db, auth));
  app.use("/api", createSyncRouter(db, auth));
  app.get("/api/openapi.json", (req, res) => res.json(openapi));
  app.use(
    "/docs/assets",
    express.static(path.join(root, "node_modules/swagger-ui-dist")),
  );
  app.get("/docs", (req, res) =>
    res
      .type("html")
      .send(
        `<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>Trailway API</title><link rel="stylesheet" href="/docs/assets/swagger-ui.css"></head><body><div id="swagger"></div><script src="/docs/assets/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/api/openapi.json',dom_id:'#swagger',persistAuthorization:false});</script></body></html>`,
      ),
  );
  app.use("/api", (req, res, next) =>
    next(new ApiError(404, "API-ендпоінт не знайдено.")),
  );
  app.use(express.static(path.join(root, "client/dist")));
  app.get("/", (req, res) =>
    res.sendFile(path.join(root, "client/dist/index.html")),
  );
  app.use(errorHandler);
  return app;
}

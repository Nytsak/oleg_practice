import { Router } from "express";
import { account } from "../validation.js";
import { ApiError } from "../errors.js";
import { hashPassword, verifyPassword, issueTokens, hashToken, publicUser } from "../security.js";

export function createAuthRouter(db, secret, auth) {
  const router = Router();
  const sessions = new Map();
  router.use("/auth", (req, res, next) => {
    if (!["/login", "/register"].includes(req.path)) return next();
    const now = Date.now(),
      key = req.ip;
    let item = sessions.get(key);
    if (!item || item.until < now) item = { count: 0, until: now + 900000 };
    item.count++;
    sessions.set(key, item);
    if (sessions.size > 1000)
      for (const [k, v] of sessions) if (v.until < now) sessions.delete(k);
    if (item.count > 30) {
      res.setHeader("Retry-After", Math.ceil((item.until - now) / 1000));
      return next(
        new ApiError(429, "Забагато спроб. Повторіть через 15 хвилин."),
      );
    }
    next();
  });
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth",
    maxAge: 7 * 86400000,
  };
  const getRefresh = (req) =>
    req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("trailway_refresh="))
      ?.slice(17);
  const sendSession = (res, tokens, status = 200) => {
    res.cookie("trailway_refresh", tokens.refreshToken, cookieOptions);
    res.setHeader("Cache-Control", "no-store");
    return res
      .status(status)
      .json({
        access_token: tokens.accessToken,
        token_type: "Bearer",
        expires_in: 900,
        user: tokens.user,
      });
  };
  router.post("/auth/register", async (req, res) => {
    const input = account(req.body, true),
      hash = await hashPassword(input.password);
    const tokens = await db.transaction(async (tx) => {
      const user = (
        await tx.query(
          "INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3) RETURNING *",
          [input.email, hash, input.display_name],
        )
      ).rows[0];
      return issueTokens(tx, user, secret);
    });
    sendSession(res, tokens, 201);
  });
  router.post("/auth/login", async (req, res) => {
    const input = account(req.body);
    const user = (
      await db.query("SELECT * FROM users WHERE email=$1", [input.email])
    ).rows[0];
    if (!user || !(await verifyPassword(input.password, user.password_hash)))
      throw new ApiError(401, "Неправильна електронна адреса або пароль.");
    const tokens = await db.transaction((tx) => issueTokens(tx, user, secret));
    sendSession(res, tokens);
  });
  router.post("/auth/refresh", async (req, res) => {
    const refresh = getRefresh(req);
    if (!refresh) throw new ApiError(401, "Увійдіть до облікового запису.");
    const tokens = await db.transaction(async (tx) => {
      const token = (
        await tx.query(
          "SELECT * FROM refresh_tokens WHERE token_hash=$1 FOR UPDATE",
          [hashToken(refresh)],
        )
      ).rows[0];
      if (
        !token ||
        token.revoked_at ||
        new Date(token.expires_at) <= new Date()
      )
        throw new ApiError(401, "Сесія завершилась.");
      await tx.query("UPDATE refresh_tokens SET revoked_at=now() WHERE id=$1", [
        token.id,
      ]);
      const user = (
        await tx.query("SELECT * FROM users WHERE id=$1", [token.user_id])
      ).rows[0];
      return issueTokens(tx, user, secret);
    });
    sendSession(res, tokens);
  });
  router.post("/auth/logout", async (req, res) => {
    const refresh = getRefresh(req);
    if (refresh)
      await db.query(
        "UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1",
        [hashToken(refresh)],
      );
    res.clearCookie("trailway_refresh", {
      ...cookieOptions,
      maxAge: undefined,
    });
    res.status(204).end();
  });
  router.get("/auth/me", auth, (req, res) => res.json(publicUser(req.user)));
  return router;
}

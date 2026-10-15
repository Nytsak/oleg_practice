import {
  randomBytes,
  randomUUID,
  scrypt as callbackScrypt,
  timingSafeEqual,
  createHash,
  createHmac,
} from "node:crypto";
import { promisify } from "node:util";
import { ApiError } from "./errors.js";
import { UserRole } from "./models.js";
const scrypt = promisify(callbackScrypt);
export const hashToken = (token) =>
  createHash("sha256").update(token).digest("hex");
export function hashOperation(operation) {
  const ordered = (value) =>
    Array.isArray(value)
      ? value.map(ordered)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, ordered(value[key])]),
          )
        : value;
  return hashToken(JSON.stringify(ordered(operation)));
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt}$${derived.toString("hex")}`;
}
export async function verifyPassword(password, encoded) {
  const [kind, cost, salt, hex] = encoded.split("$");
  if (kind !== "scrypt" || cost !== "16384" || !salt || !hex) return false;
  const expected = Buffer.from(hex, "hex");
  const actual = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function createAccessToken(user, secret, seconds = 900) {
  const encoded = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const head = encoded({ alg: "HS256", typ: "JWT" });
  const now = Math.floor(Date.now() / 1000);
  const body = encoded({
    sub: user.id,
    typ: "access",
    iss: "trailway",
    aud: "trailway-client",
    iat: now,
    exp: now + seconds,
  });
  const input = `${head}.${body}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}
export function readAccessToken(token, secret) {
  try {
    const [header, body, signature, ...extra] = token.split(".");
    if (extra.length || !signature) throw Error();
    const h = JSON.parse(Buffer.from(header, "base64url"));
    const p = JSON.parse(Buffer.from(body, "base64url"));
    if (
      h.alg !== "HS256" ||
      h.typ !== "JWT" ||
      p.typ !== "access" ||
      p.iss !== "trailway" ||
      p.aud !== "trailway-client" ||
      !p.sub ||
      !Number.isFinite(p.exp) ||
      p.exp <= Date.now() / 1000
    )
      throw Error();
    const expected = createHmac("sha256", secret)
      .update(`${header}.${body}`)
      .digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw Error();
    return p;
  } catch {
    throw new ApiError(401, "Сесія завершилась. Увійдіть знову.");
  }
}
export async function issueTokens(tx, user, secret) {
  const refreshToken = randomBytes(32).toString("base64url");
  await tx.query(
    "INSERT INTO refresh_tokens(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,$4)",
    [
      randomUUID(),
      user.id,
      hashToken(refreshToken),
      new Date(Date.now() + 7 * 86400000),
    ],
  );
  return {
    accessToken: createAccessToken(user, secret),
    refreshToken,
    user: publicUser(user),
  };
}
/** @param {Pick<import('./models.js').User,'id'|'email'|'display_name'|'role'>} user */
export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
  };
}
export function authMiddleware(db, secret) {
  return async (req, res, next) => {
    try {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new ApiError(401, "Увійдіть до облікового запису.");
      const p = readAccessToken(token, secret);
      const { rows } = await db.query(
        "SELECT id,email,display_name,role FROM users WHERE id=$1",
        [p.sub],
      );
      if (!rows[0]) throw new ApiError(401, "Обліковий запис не знайдено.");
      req.user = rows[0];
      next();
    } catch (e) {
      next(e);
    }
  };
}
export function adminOnly(req, res, next) {
  if (req.user.role !== UserRole.ADMIN)
    return next(new ApiError(403, "Ця дія доступна лише адміністратору."));
  next();
}

import { randomUUID } from "node:crypto";
import { ApiError, requireValue } from "./errors.js";
import { routeInput, uuid, integer } from "./validation.js";
export function haversine(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dlat = rad(b.latitude - a.latitude),
    dlon = rad(b.longitude - a.longitude);
  const x =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}
export function buildGeometry(points) {
  const distance_m = Math.round(
    points.slice(1).reduce((sum, p, i) => sum + haversine(points[i], p), 0),
  );
  return {
    geometry: {
      type: "LineString",
      coordinates: points.map((p) => [p.longitude, p.latitude]),
    },
    distance_m,
    duration_s: Math.round(distance_m / 1.1),
  };
}
export async function routeDetail(
  tx,
  id,
  owner,
  { lock = false, shared = false } = {},
) {
  uuid(id);
  const { rows } = await tx.query(
    `SELECT * FROM routes WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
    [id],
  );
  const route = rows[0];
  if (!route) throw new ApiError(404, "Маршрут не знайдено.");
  if (!shared && route.owner_id !== owner)
    throw new ApiError(403, "Цей маршрут належить іншому користувачеві.");
  const points = (
    await tx.query(
      "SELECT * FROM route_points WHERE route_id=$1 ORDER BY position",
      [id],
    )
  ).rows.map((p) => ({
    ...p,
    latitude: Number(p.latitude),
    longitude: Number(p.longitude),
  }));
  return {
    ...route,
    points,
    geometry_kind: "straight",
    distance_label: "Оцінка за прямими лініями",
  };
}
async function replacePoints(tx, id, points) {
  for (const p of points)
    if (p.place_id) {
      const place = (
        await tx.query(
          "SELECT id FROM tourist_places WHERE id=$1 AND is_visible=true",
          [p.place_id],
        )
      ).rows[0];
      if (!place)
        throw new ApiError(
          400,
          "Локація недоступна. Оновіть каталог або використайте власну точку.",
        );
    }
  await tx.query("DELETE FROM route_points WHERE route_id=$1", [id]);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    await tx.query(
      "INSERT INTO route_points(id,route_id,place_id,position,label_snapshot,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        randomUUID(),
        id,
        p.place_id,
        i + 1,
        p.label_snapshot,
        p.latitude,
        p.longitude,
      ],
    );
  }
}
export async function createRoute(tx, owner, body, explicitId) {
  const r = routeInput(body),
    id = explicitId ? uuid(explicitId) : randomUUID(),
    g = buildGeometry(r.points);
  await tx.query(
    "INSERT INTO routes(id,owner_id,name,description,state,geometry,distance_m,duration_s) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      id,
      owner,
      r.name,
      r.description,
      r.state,
      JSON.stringify(g.geometry),
      g.distance_m,
      g.duration_s,
    ],
  );
  await replacePoints(tx, id, r.points);
  return routeDetail(tx, id, owner);
}
export async function updateRoute(tx, owner, id, body) {
  const existing = await routeDetail(tx, id, owner, { lock: true });
  integer(body.base_version, "base_version", 1, 2147483647);
  if (body.base_version !== existing.version)
    throw new ApiError(
      409,
      "Маршрут змінено на іншому пристрої. Оновіть дані.",
      { version: existing.version },
    );
  const r = routeInput(body),
    g = buildGeometry(r.points);
  await tx.query(
    "UPDATE routes SET name=$2,description=$3,state=$4,geometry=$5,distance_m=$6,duration_s=$7,version=version+1,updated_at=now() WHERE id=$1",
    [
      id,
      r.name,
      r.description,
      r.state,
      JSON.stringify(g.geometry),
      g.distance_m,
      g.duration_s,
    ],
  );
  await replacePoints(tx, id, r.points);
  return routeDetail(tx, id, owner);
}
export async function deleteRoute(tx, owner, id, baseVersion) {
  uuid(id);
  const existing = (
    await tx.query(
      "SELECT owner_id,version FROM routes WHERE id=$1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!existing) return;
  if (existing.owner_id !== owner)
    throw new ApiError(403, "Цей маршрут належить іншому користувачеві.");
  if (baseVersion !== undefined && baseVersion !== existing.version)
    throw new ApiError(409, "Версія маршруту змінилась.");
  await tx.query("DELETE FROM routes WHERE id=$1", [id]);
}
export async function listRoutes(
  db,
  owner,
  { q = "", state = "", limit = 50, offset = 0 } = {},
) {
  const params = [owner, `%${q}%`, state];
  const filter = "owner_id=$1 AND name ILIKE $2 AND ($3='' OR state::text=$3)";
  const total = Number(
    (await db.query(`SELECT count(*) FROM routes WHERE ${filter}`, params))
      .rows[0].count,
  );
  const { rows } = await db.query(
    `SELECT id FROM routes WHERE ${filter} ORDER BY updated_at DESC,id LIMIT $4 OFFSET $5`,
    [...params, limit, offset],
  );
  const items = [];
  for (const r of rows) items.push(await routeDetail(db, r.id, owner));
  return { items, total, limit, offset };
}

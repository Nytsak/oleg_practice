import { randomUUID } from "node:crypto";
import { ApiError, requireValue } from "./errors.js";
import { uuid, number, object } from "./validation.js";
import { routeDetail, haversine } from "./routes-service.js";
export async function tripDetail(tx, id, owner, lock = false) {
  uuid(id);
  const t = (
    await tx.query(
      `SELECT * FROM trips WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
  if (!t) throw new ApiError(404, "Подорож не знайдено.");
  if (t.owner_id !== owner)
    throw new ApiError(403, "Ця подорож належить іншому користувачеві.");
  const points = (
    await tx.query(
      "SELECT * FROM track_points WHERE trip_id=$1 ORDER BY recorded_at",
      [id],
    )
  ).rows.map((p) => ({
    ...p,
    latitude: Number(p.latitude),
    longitude: Number(p.longitude),
    accuracy_m: Number(p.accuracy_m),
  }));
  return { ...t, points };
}
export async function startTrip(tx, owner, routeId) {
  const r = await routeDetail(tx, uuid(routeId), owner);
  requireValue(r.state === "ready", "Спочатку підготуйте маршрут.");
  const id = randomUUID();
  await tx.query(
    "INSERT INTO trips(id,owner_id,route_id,route_snapshot,started_at,active_since) VALUES($1,$2,$3,$4,now(),now())",
    [id, owner, r.id, JSON.stringify(r)],
  );
  return tripDetail(tx, id, owner);
}
export async function transitionTrip(tx, owner, id, action) {
  const t = await tripDetail(tx, id, owner, true);
  const states = {
    pause: ["active", "paused"],
    resume: ["paused", "active"],
    finish: ["active", "finished"],
  };
  requireValue(Object.hasOwn(states, action), "Невідома дія.");
  if (action === "finish" && t.state === "finished") return t;
  requireValue(
    t.state === states[action][0] ||
      (action === "finish" && t.state === "paused"),
    "Недопустимий перехід стану подорожі.",
  );
  const additional =
    t.state === "active" && t.active_since
      ? Math.max(
          0,
          Math.floor((Date.now() - new Date(t.active_since).getTime()) / 1000),
        )
      : 0;
  await tx.query(
    "UPDATE trips SET state=$2,active_duration_s=active_duration_s+$3,active_since=$4,finished_at=$5 WHERE id=$1",
    [
      id,
      states[action][1],
      additional,
      action === "resume" ? new Date() : null,
      action === "finish" ? new Date() : null,
    ],
  );
  return tripDetail(tx, id, owner);
}
export async function addTrack(tx, owner, id, body) {
  const t = await tripDetail(tx, id, owner, true);
  requireValue(
    t.state === "active",
    "Трек записується лише під час активної подорожі.",
  );
  requireValue(
    Array.isArray(body.points) &&
      body.points.length >= 1 &&
      body.points.length <= 200,
    "Надішліть від 1 до 200 вимірювань.",
  );
  for (const p of body.points) {
    object(p, "points[]");
    uuid(p.segment_id, "segment_id");
    number(p.latitude, "latitude", -90, 90);
    number(p.longitude, "longitude", -180, 180);
    number(p.accuracy_m, "accuracy_m", 0, 99999);
    const time = new Date(p.recorded_at);
    requireValue(
      Number.isFinite(time.getTime()) &&
        time >= new Date(t.started_at) &&
        time.getTime() <= Date.now() + 10000,
      "Некоректний час вимірювання.",
    );
    // Idempotency is enforced by UNIQUE(trip_id, recorded_at).
    await tx.query(
      "INSERT INTO track_points(trip_id,segment_id,recorded_at,latitude,longitude,accuracy_m) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(trip_id,recorded_at) DO NOTHING",
      [id, p.segment_id, time, p.latitude, p.longitude, p.accuracy_m],
    );
  }
  const all = (
    await tx.query(
      "SELECT * FROM track_points WHERE trip_id=$1 ORDER BY recorded_at",
      [id],
    )
  ).rows;
  let distance = 0;
  for (let i = 1; i < all.length; i++)
    if (
      all[i].segment_id === all[i - 1].segment_id &&
      Number(all[i].accuracy_m) <= 100 &&
      Number(all[i - 1].accuracy_m) <= 100
    )
      distance += haversine(all[i - 1], all[i]);
  await tx.query("UPDATE trips SET distance_m=$2 WHERE id=$1", [
    id,
    Math.round(distance),
  ]);
  return tripDetail(tx, id, owner);
}

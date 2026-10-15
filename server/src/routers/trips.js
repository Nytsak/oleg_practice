import { Router } from "express";
import { pagination } from "../validation.js";
import { startTrip, transitionTrip, tripDetail, addTrack } from "../trips-service.js";

export function createTripsRouter(db, auth) {
  const router = Router();
  router.get("/trips", auth, async (req, res) => {
    const { limit, offset } = pagination(req.query);
    const items = (
      await db.query(
        "SELECT * FROM trips WHERE owner_id=$1 ORDER BY started_at DESC LIMIT $2 OFFSET $3",
        [req.user.id, limit, offset],
      )
    ).rows;
    const total = Number(
      (
        await db.query("SELECT count(*) FROM trips WHERE owner_id=$1", [
          req.user.id,
        ])
      ).rows[0].count,
    );
    res.json({ items, total, limit, offset });
  });
  router.get("/trips/:id", auth, async (req, res) =>
    res.json(await tripDetail(db, req.params.id, req.user.id)),
  );
  router.post("/trips", auth, async (req, res) =>
    res
      .status(201)
      .json(
        await db.transaction((tx) =>
          startTrip(tx, req.user.id, req.body.route_id),
        ),
      ),
  );
  router.post("/trips/:id/:action", auth, async (req, res) => {
    if (req.params.action === "track")
      return res.json(
        await db.transaction((tx) =>
          addTrack(tx, req.user.id, req.params.id, req.body),
        ),
      );
    res.json(
      await db.transaction((tx) =>
        transitionTrip(tx, req.user.id, req.params.id, req.params.action),
      ),
    );
  });
  return router;
}

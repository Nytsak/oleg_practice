import { Router } from "express";
import { randomUUID, randomBytes } from "node:crypto";
import { ApiError, requireValue } from "../errors.js";
import { pagination, text, uuid } from "../validation.js";
import { hashToken } from "../security.js";
import { createRoute, updateRoute, deleteRoute, routeDetail, listRoutes } from "../routes-service.js";

export function createRoutesRouter(db, auth) {
  const router = Router();
  router.get("/routes", auth, async (req, res) =>
    res.json(
      await listRoutes(db, req.user.id, {
        ...pagination(req.query),
        q: text(req.query.q ?? "", "q", 0, 160),
        state: text(req.query.state ?? "", "state", 0, 20),
      }),
    ),
  );
  router.get("/routes/:id", auth, async (req, res) =>
    res.json(await routeDetail(db, req.params.id, req.user.id)),
  );
  router.post("/routes", auth, async (req, res) =>
    res
      .status(201)
      .json(
        await db.transaction((tx) =>
          createRoute(tx, req.user.id, req.body, req.body.id),
        ),
      ),
  );
  router.put("/routes/:id", auth, async (req, res) =>
    res.json(
      await db.transaction((tx) =>
        updateRoute(tx, req.user.id, req.params.id, req.body),
      ),
    ),
  );
  router.patch("/routes/:id", auth, async (req, res) =>
    res.json(
      await db.transaction(async (tx) => {
        const old = await routeDetail(tx, req.params.id, req.user.id, {
          lock: true,
        });
        return updateRoute(tx, req.user.id, req.params.id, {
          ...old,
          ...req.body,
        });
      }),
    ),
  );
  router.delete("/routes/:id", auth, async (req, res) => {
    await db.transaction((tx) => deleteRoute(tx, req.user.id, req.params.id));
    res.status(204).end();
  });
  router.post("/routes/:id/shares", auth, async (req, res) => {
    const result = await db.transaction(async (tx) => {
      await routeDetail(tx, req.params.id, req.user.id);
      const token = randomBytes(32).toString("base64url"),
        id = randomUUID();
      await tx.query(
        "INSERT INTO share_links(id,route_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
        [id, req.params.id, hashToken(token)],
      );
      return { id, token, path: `/#/share/${token}`, expires_in: 604800 };
    });
    res.status(201).json(result);
  });
  router.get("/routes/:id/shares", auth, async (req, res) => {
    await routeDetail(db, req.params.id, req.user.id);
    res.json(
      (
        await db.query(
          "SELECT id,created_at,expires_at,revoked_at FROM share_links WHERE route_id=$1 ORDER BY created_at DESC",
          [req.params.id],
        )
      ).rows,
    );
  });
  router.delete("/routes/:id/shares/:shareId", auth, async (req, res) => {
    await routeDetail(db, req.params.id, req.user.id);
    await db.query(
      "UPDATE share_links SET revoked_at=now() WHERE id=$1 AND route_id=$2",
      [uuid(req.params.shareId), req.params.id],
    );
    res.status(204).end();
  });
  router.get("/shares/:token", async (req, res) => {
    requireValue(
      /^[A-Za-z0-9_-]{43}$/.test(req.params.token),
      "Некоректне посилання.",
    );
    const link = (
      await db.query(
        "SELECT * FROM share_links WHERE token_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())",
        [hashToken(req.params.token)],
      )
    ).rows[0];
    if (!link)
      throw new ApiError(
        404,
        "Посилання відкликано або термін його дії завершився.",
      );
    const r = await routeDetail(db, link.route_id, null, { shared: true });
    delete r.owner_id;
    res.setHeader("Cache-Control", "no-store");
    res.json(r);
  });
  return router;
}

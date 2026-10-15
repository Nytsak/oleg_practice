import { Router } from "express";
import { synchronizeRoutes } from "../sync-service.js";

export function createSyncRouter(db, auth) {
  const router = Router();
  router.post("/sync", auth, async (req, res) => {
    res.json(await synchronizeRoutes(db, req.user.id, req.body.operations));
  });
  return router;
}

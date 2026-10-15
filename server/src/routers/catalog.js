import { Router } from "express";
import { ApiError } from "../errors.js";
import { pagination, text, integer, uuid, placeInput } from "../validation.js";
import { adminOnly } from "../security.js";

export function createCatalogRouter(db, auth) {
  const router = Router();
  router.get("/categories", async (req, res) =>
    res.json(
      (await db.query("SELECT * FROM place_categories ORDER BY id")).rows,
    ),
  );
  router.get("/places", async (req, res) => {
    const { limit, offset } = pagination(req.query),
      q = text(req.query.q ?? "", "q", 0, 160),
      category = Number(req.query.category ?? 0);
    integer(category, "category", 0, 32767);
    const where =
      "is_visible=true AND name ILIKE $1 AND ($2=0 OR category_id=$2)";
    const total = Number(
      (
        await db.query(`SELECT count(*) FROM tourist_places WHERE ${where}`, [
          `%${q}%`,
          category,
        ])
      ).rows[0].count,
    );
    const items = (
      await db.query(
        `SELECT * FROM tourist_places WHERE ${where} ORDER BY name,id LIMIT $3 OFFSET $4`,
        [`%${q}%`, category, limit, offset],
      )
    ).rows;
    res.json({ items, total, limit, offset });
  });
  router.get("/places/:id", async (req, res) => {
    const place = (
      await db.query(
        "SELECT * FROM tourist_places WHERE id=$1 AND is_visible=true",
        [uuid(req.params.id)],
      )
    ).rows[0];
    if (!place) throw new ApiError(404, "Локацію не знайдено.");
    res.json(place);
  });
  router.get("/admin/places", auth, adminOnly, async (req, res) =>
    res.json(
      (await db.query("SELECT * FROM tourist_places ORDER BY name")).rows,
    ),
  );
  router.post("/places", auth, adminOnly, async (req, res) => {
    const p = placeInput(req.body);
    const place = (
      await db.query(
        "INSERT INTO tourist_places(category_id,created_by,name,description,latitude,longitude,is_visible) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          p.category_id,
          req.user.id,
          p.name,
          p.description,
          p.latitude,
          p.longitude,
          p.is_visible,
        ],
      )
    ).rows[0];
    res.status(201).json(place);
  });
  router.put("/places/:id", auth, adminOnly, async (req, res) => {
    const p = placeInput(req.body);
    const place = (
      await db.query(
        "UPDATE tourist_places SET category_id=$2,name=$3,description=$4,latitude=$5,longitude=$6,is_visible=$7,updated_at=now() WHERE id=$1 RETURNING *",
        [
          uuid(req.params.id),
          p.category_id,
          p.name,
          p.description,
          p.latitude,
          p.longitude,
          p.is_visible,
        ],
      )
    ).rows[0];
    if (!place) throw new ApiError(404, "Локацію не знайдено.");
    res.json(place);
  });
  router.delete("/places/:id", auth, adminOnly, async (req, res) => {
    await db.query("DELETE FROM tourist_places WHERE id=$1", [
      uuid(req.params.id),
    ]);
    res.status(204).end();
  });
  return router;
}

import { randomUUID } from "node:crypto";
import { hashPassword } from "./security.js";
import { createRoute } from "./routes-service.js";
export const demoUsers = {
  tourist: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "oleh@example.com",
    password: "Tourist2026!",
    display_name: "Олег Ницак",
  },
  admin: {
    id: "22222222-2222-4222-8222-222222222222",
    email: "admin@example.com",
    password: "Admin2026!",
    display_name: "Адміністратор",
  },
};
export const seedPlaces = [
  [
    "33333333-3333-4333-8333-333333333331",
    2,
    "Міське озеро",
    "Тиха прогулянка берегом у західній частині Івано-Франківська.",
    48.91412,
    24.68918,
  ],
  [
    "33333333-3333-4333-8333-333333333332",
    1,
    "Вовчинецькі пагорби",
    "Оглядова локація з краєвидом на місто та передгір’я.",
    48.94571,
    24.76783,
  ],
  [
    "33333333-3333-4333-8333-333333333333",
    3,
    "Краєзнавчий музей",
    "Історія Прикарпаття в центральній частині міста.",
    48.92224,
    24.71063,
  ],
  [
    "33333333-3333-4333-8333-333333333334",
    2,
    "Парк Шевченка",
    "Зелений простір для короткої міської прогулянки.",
    48.91194,
    24.69895,
  ],
  [
    "33333333-3333-4333-8333-333333333335",
    3,
    "Бастіон",
    "Міська галерея та залишки історичної фортифікації.",
    48.92356,
    24.70744,
  ],
  [
    "33333333-3333-4333-8333-333333333336",
    2,
    "Берег Бистриці",
    "Прогулянкова локація поблизу річки.",
    48.93371,
    24.72822,
  ],
];
// Lab 5 used these historical IDs and illustrative password values.
// Resolve existing records instead of changing primary keys or their dependants.
const legacyPlaceIds = [
  "33333333-3333-3333-3333-333333333331",
  "33333333-3333-3333-3333-333333333332",
  "33333333-3333-3333-3333-333333333333",
];
const legacyPasswords = { tourist: "$hash$oleh", admin: "$hash$admin" };

export async function seedDatabase(db) {
  const hashes = Object.fromEntries(await Promise.all(
    Object.entries(demoUsers).map(async ([role, user]) => [role, await hashPassword(user.password)]),
  ));
  return db.transaction(async (tx) => {
    const users = {}, accounts = [];
    for (const [role, template] of Object.entries(demoUsers)) {
      let user = (await tx.query("SELECT * FROM users WHERE email=$1 FOR UPDATE", [template.email])).rows[0];
      let status = "preserved";
      if (!user) {
        const occupied = (await tx.query("SELECT id FROM users WHERE id=$1", [template.id])).rows.length > 0;
        await tx.query(
          "INSERT INTO users(id,email,password_hash,display_name,role) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING",
          [occupied ? randomUUID() : template.id, template.email, hashes[role], template.display_name, role],
        );
        user = (await tx.query("SELECT * FROM users WHERE email=$1 FOR UPDATE", [template.email])).rows[0];
        status = "created";
      } else if (user.password_hash === legacyPasswords[role]) {
        // Upgrade only the exact two known Lab 5 placeholders, never a real password.
        await tx.query("UPDATE users SET password_hash=$2 WHERE id=$1", [user.id, hashes[role]]);
        status = "placeholder_migrated";
      }
      users[role] = user;
      accounts.push({ email: user.email, id: user.id, role: user.role, status });
    }

    const categoryIds = new Map();
    for (const [preferred, code, name] of [
      [1, "viewpoint", "Оглядові майданчики"],
      [2, "nature", "Природні локації"],
      [3, "museum", "Музеї"],
    ]) {
      let category = (await tx.query("SELECT id FROM place_categories WHERE code=$1", [code])).rows[0];
      if (!category) {
        const occupied = (await tx.query("SELECT id FROM place_categories WHERE id=$1", [preferred])).rows.length > 0;
        const id = occupied ? Number((await tx.query("SELECT COALESCE(max(id),0)+1 AS id FROM place_categories")).rows[0].id) : preferred;
        await tx.query("INSERT INTO place_categories(id,code,name) VALUES($1,$2,$3) ON CONFLICT(code) DO NOTHING", [id, code, name]);
        category = (await tx.query("SELECT id FROM place_categories WHERE code=$1", [code])).rows[0];
      }
      categoryIds.set(preferred, category.id);
    }

    const places = [];
    for (const [index, p] of seedPlaces.entries()) {
      let place = (await tx.query(
        "SELECT * FROM tourist_places WHERE id IN ($1,$2) ORDER BY (id=$1) DESC LIMIT 1",
        [p[0], legacyPlaceIds[index] || p[0]],
      )).rows[0];
      if (!place) {
        place = (await tx.query(
          "INSERT INTO tourist_places(id,category_id,name,description,latitude,longitude,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [p[0], categoryIds.get(p[1]), ...p.slice(2), users.admin.id],
        )).rows[0];
      }
      places.push(place);
    }

    const demoRoutes = [];
    for (const [id, name, description, indices, state, legacyId] of [
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Від озера до пагорбів", "Міський маршрут крізь природні та культурні локації.", [0, 2, 1], "ready", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", "Зелене коло міста", "Неспішний вихід до парку та міського озера.", [3, 0], "ready"],
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac", "Історичний центр", "Бастіон і краєзнавчий музей за одну прогулянку.", [4, 2], "draft"],
    ]) {
      let route = (await tx.query("SELECT * FROM routes WHERE id IN ($1,$2) ORDER BY (id=$1) DESC LIMIT 1", [id, legacyId || id])).rows[0];
      if (!route) route = await createRoute(tx, users.tourist.id, {
        name, description, state,
        points: indices.map(index => ({
          place_id: places[index].is_visible ? places[index].id : null,
          label_snapshot: places[index].name,
          latitude: Number(places[index].latitude), longitude: Number(places[index].longitude),
        })),
      }, id);
      demoRoutes.push(route);
    }
    const trip = (await tx.query("SELECT id FROM trips WHERE id IN ($1,$2)", ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"])).rows[0];
    if (!trip && demoRoutes[0].owner_id === users.tourist.id) await tx.query(
      "INSERT INTO trips(id,owner_id,route_id,route_snapshot,state,started_at,finished_at,active_duration_s,distance_m) SELECT 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',$1,id,jsonb_build_object('name',name,'points',(SELECT jsonb_agg(to_jsonb(p) ORDER BY position) FROM route_points p WHERE p.route_id=routes.id)),'finished',now()-interval '2 days 2 hours',now()-interval '2 days',6700,7400 FROM routes WHERE id=$2 AND owner_id=$1 ON CONFLICT(id) DO NOTHING",
      [users.tourist.id, demoRoutes[0].id],
    );
    return { accounts };
  });
}

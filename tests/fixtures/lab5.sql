-- Historical schema and data from Lab5.pdf, pages 8-12.
-- gen_random_uuid() is built into the PostgreSQL engine used by these tests.
CREATE TYPE user_role AS ENUM ('tourist','admin');
CREATE TYPE route_state AS ENUM ('draft','ready');
CREATE TYPE trip_state AS ENUM ('active','paused','finished');
CREATE TYPE sync_status AS ENUM ('pending','applied','conflict','failed');
CREATE TABLE users (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email VARCHAR(254) NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, display_name VARCHAR(100) NOT NULL,
 role user_role NOT NULL DEFAULT 'tourist', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE place_categories (id SMALLSERIAL PRIMARY KEY, code VARCHAR(40) NOT NULL UNIQUE, name VARCHAR(100) NOT NULL UNIQUE);
CREATE TABLE tourist_places (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), category_id SMALLINT NOT NULL REFERENCES place_categories(id),
 created_by UUID REFERENCES users(id) ON DELETE SET NULL, name VARCHAR(160) NOT NULL, description TEXT NOT NULL DEFAULT '',
 latitude NUMERIC(9,6) NOT NULL CHECK(latitude BETWEEN -90 AND 90), longitude NUMERIC(9,6) NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 is_visible BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE routes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name VARCHAR(160) NOT NULL, description TEXT NOT NULL DEFAULT '', state route_state NOT NULL DEFAULT 'draft', geometry JSONB,
 distance_m INTEGER CHECK(distance_m IS NULL OR distance_m>=0), duration_s INTEGER CHECK(duration_s IS NULL OR duration_s>=0),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE route_points (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
 place_id UUID REFERENCES tourist_places(id) ON DELETE SET NULL, position SMALLINT NOT NULL CHECK(position BETWEEN 1 AND 20),
 label_snapshot VARCHAR(160) NOT NULL, latitude NUMERIC(9,6) NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude NUMERIC(9,6) NOT NULL CHECK(longitude BETWEEN -180 AND 180), UNIQUE(route_id,position)
);
CREATE TABLE trips (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 route_id UUID REFERENCES routes(id) ON DELETE SET NULL, route_snapshot JSONB NOT NULL, state trip_state NOT NULL DEFAULT 'active',
 started_at TIMESTAMPTZ NOT NULL, finished_at TIMESTAMPTZ, active_duration_s INTEGER NOT NULL DEFAULT 0 CHECK(active_duration_s>=0),
 distance_m INTEGER NOT NULL DEFAULT 0 CHECK(distance_m>=0), CHECK(finished_at IS NULL OR finished_at>=started_at)
);
CREATE TABLE track_points (
 id BIGSERIAL PRIMARY KEY, trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE, segment_id UUID NOT NULL, recorded_at TIMESTAMPTZ NOT NULL,
 latitude NUMERIC(9,6) NOT NULL CHECK(latitude BETWEEN -90 AND 90), longitude NUMERIC(9,6) NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 accuracy_m NUMERIC(7,2) NOT NULL CHECK(accuracy_m>=0), UNIQUE(trip_id,recorded_at)
);
CREATE TABLE share_links (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE, token_hash CHAR(64) NOT NULL UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ,
 CHECK(expires_at IS NULL OR expires_at>created_at), CHECK(revoked_at IS NULL OR revoked_at>=created_at)
);
CREATE TABLE sync_operations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, client_operation_id UUID NOT NULL,
 entity_type VARCHAR(40) NOT NULL, entity_id UUID NOT NULL, operation_type VARCHAR(20) NOT NULL CHECK(operation_type IN ('create','update','delete')),
 base_version INTEGER, result_version INTEGER, status sync_status NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 processed_at TIMESTAMPTZ, UNIQUE(user_id,client_operation_id)
);
CREATE INDEX idx_places_category_visible ON tourist_places(category_id,is_visible);
CREATE INDEX idx_routes_owner_updated ON routes(owner_id,updated_at DESC);
CREATE INDEX idx_route_points_route_position ON route_points(route_id,position);
CREATE INDEX idx_trips_owner_started ON trips(owner_id,started_at DESC);
CREATE INDEX idx_track_points_trip_time ON track_points(trip_id,recorded_at);
CREATE INDEX idx_sync_operations_user_status ON sync_operations(user_id,status,created_at);
INSERT INTO users(id,email,password_hash,display_name,role) VALUES
 ('11111111-1111-1111-1111-111111111111','oleh@example.com','$hash$oleh','Олег Ницак','tourist'),
 ('22222222-2222-2222-2222-222222222222','admin@example.com','$hash$admin','Адміністратор','admin');
INSERT INTO place_categories(id,code,name) VALUES (1,'viewpoint','Оглядові майданчики'),(2,'nature','Природні локації'),(3,'museum','Музеї');
INSERT INTO tourist_places(id,category_id,created_by,name,description,latitude,longitude) VALUES
 ('33333333-3333-3333-3333-333333333331',2,'22222222-2222-2222-2222-222222222222','Міське озеро','Зона відпочинку біля води',48.914120,24.689180),
 ('33333333-3333-3333-3333-333333333332',1,'22222222-2222-2222-2222-222222222222','Вовчинецькі пагорби','Оглядова локація біля міста',48.945710,24.767830),
 ('33333333-3333-3333-3333-333333333333',3,'22222222-2222-2222-2222-222222222222','Краєзнавчий музей','Музей у центральній частині міста',48.922240,24.710630);
INSERT INTO routes(id,owner_id,name,description,state,geometry,distance_m,duration_s,version) VALUES
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','Карпатський оглядовий маршрут','Навчальний пішохідний маршрут','ready',
 '{"type":"LineString","coordinates":[[24.68918,48.91412],[24.71063,48.92224],[24.76783,48.94571]]}',8200,7200,3);
INSERT INTO route_points(id,route_id,place_id,position,label_snapshot,latitude,longitude) VALUES
 ('44444444-4444-4444-4444-444444444441','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33333333-3333-3333-3333-333333333331',1,'Міське озеро',48.914120,24.689180),
 ('44444444-4444-4444-4444-444444444442','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33333333-3333-3333-3333-333333333333',2,'Краєзнавчий музей',48.922240,24.710630),
 ('44444444-4444-4444-4444-444444444443','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33333333-3333-3333-3333-333333333332',3,'Вовчинецькі пагорби',48.945710,24.767830);
INSERT INTO trips(id,owner_id,route_id,route_snapshot,state,started_at,finished_at,active_duration_s,distance_m) VALUES
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 '{"name":"Карпатський оглядовий маршрут","version":3}','finished','2026-09-15 07:30:00+00','2026-09-15 09:25:00+00',6900,7900);
INSERT INTO track_points(trip_id,segment_id,recorded_at,latitude,longitude,accuracy_m) VALUES
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-ccccccccccc1','2026-09-15 07:45:00+00',48.915000,24.690000,4.5),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-ccccccccccc1','2026-09-15 08:10:00+00',48.920000,24.700000,5.0),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-ccccccccccc2','2026-09-15 09:15:00+00',48.940000,24.750000,6.2);
INSERT INTO share_links(id,route_id,token_hash,created_at,expires_at,revoked_at) VALUES
 ('dddddddd-dddd-dddd-dddd-dddddddddddd','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855','2026-09-14 10:00:00+00','2026-10-15 10:00:00+00',NULL);
INSERT INTO sync_operations(id,user_id,client_operation_id,entity_type,entity_id,operation_type,base_version,result_version,status,created_at,processed_at) VALUES
 ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','11111111-1111-1111-1111-111111111111','ffffffff-ffff-ffff-ffff-ffffffffffff','route','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','update',2,3,'applied','2026-09-14 12:00:00+00','2026-09-14 12:00:05+00');

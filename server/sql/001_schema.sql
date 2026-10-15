-- PostgreSQL schema from Lab 5; additive fields implement authentication and trips.
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('tourist','admin'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE route_state AS ENUM ('draft','ready'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE trip_state AS ENUM ('active','paused','finished'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE sync_status AS ENUM ('pending','applied','conflict','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS users (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email VARCHAR(254) NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, display_name VARCHAR(100) NOT NULL,
 role user_role NOT NULL DEFAULT 'tourist', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS place_categories (
 id SMALLSERIAL PRIMARY KEY, code VARCHAR(40) NOT NULL UNIQUE, name VARCHAR(100) NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS tourist_places (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), category_id SMALLINT NOT NULL REFERENCES place_categories(id),
 created_by UUID REFERENCES users(id) ON DELETE SET NULL, name VARCHAR(160) NOT NULL,
 description TEXT NOT NULL DEFAULT '', latitude NUMERIC(9,6) NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude NUMERIC(9,6) NOT NULL CHECK(longitude BETWEEN -180 AND 180), is_visible BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS routes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name VARCHAR(160) NOT NULL, description TEXT NOT NULL DEFAULT '', state route_state NOT NULL DEFAULT 'draft',
 geometry JSONB, distance_m INTEGER CHECK(distance_m IS NULL OR distance_m>=0),
 duration_s INTEGER CHECK(duration_s IS NULL OR duration_s>=0), version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS route_points (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
 place_id UUID REFERENCES tourist_places(id) ON DELETE SET NULL, position SMALLINT NOT NULL CHECK(position BETWEEN 1 AND 20),
 label_snapshot VARCHAR(160) NOT NULL, latitude NUMERIC(9,6) NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude NUMERIC(9,6) NOT NULL CHECK(longitude BETWEEN -180 AND 180), UNIQUE(route_id,position)
);
CREATE TABLE IF NOT EXISTS trips (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 route_id UUID REFERENCES routes(id) ON DELETE SET NULL, route_snapshot JSONB NOT NULL,
 state trip_state NOT NULL DEFAULT 'active', started_at TIMESTAMPTZ NOT NULL, finished_at TIMESTAMPTZ,
 active_duration_s INTEGER NOT NULL DEFAULT 0 CHECK(active_duration_s>=0),
 distance_m INTEGER NOT NULL DEFAULT 0 CHECK(distance_m>=0), CHECK(finished_at IS NULL OR finished_at>=started_at)
);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS active_since TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS track_points (
 id BIGSERIAL PRIMARY KEY, trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
 segment_id UUID NOT NULL, recorded_at TIMESTAMPTZ NOT NULL,
 latitude NUMERIC(9,6) NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude NUMERIC(9,6) NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 accuracy_m NUMERIC(7,2) NOT NULL CHECK(accuracy_m>=0), UNIQUE(trip_id,recorded_at)
);
CREATE TABLE IF NOT EXISTS share_links (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
 token_hash CHAR(64) NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ,
 revoked_at TIMESTAMPTZ, CHECK(expires_at IS NULL OR expires_at>created_at),
 CHECK(revoked_at IS NULL OR revoked_at>=created_at)
);
CREATE TABLE IF NOT EXISTS sync_operations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 client_operation_id UUID NOT NULL, entity_type VARCHAR(40) NOT NULL, entity_id UUID NOT NULL,
 operation_type VARCHAR(20) NOT NULL CHECK(operation_type IN ('create','update','delete')),
 base_version INTEGER, result_version INTEGER, status sync_status NOT NULL DEFAULT 'pending',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), processed_at TIMESTAMPTZ, UNIQUE(user_id,client_operation_id)
);
ALTER TABLE sync_operations ADD COLUMN IF NOT EXISTS response JSONB;
ALTER TABLE sync_operations ADD COLUMN IF NOT EXISTS request_hash CHAR(64);
CREATE TABLE IF NOT EXISTS refresh_tokens (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash CHAR(64) NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_places_category_visible ON tourist_places(category_id,is_visible);
CREATE INDEX IF NOT EXISTS idx_routes_owner_updated ON routes(owner_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_route_points_route_position ON route_points(route_id,position);
CREATE INDEX IF NOT EXISTS idx_trips_owner_started ON trips(owner_id,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_track_points_trip_time ON track_points(trip_id,recorded_at);
CREATE INDEX IF NOT EXISTS idx_sync_operations_user_status ON sync_operations(user_id,status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_trip ON trips(owner_id) WHERE state!='finished';
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;

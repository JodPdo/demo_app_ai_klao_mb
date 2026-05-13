-- AiKlao Bot v3.0 — PostgreSQL schema
-- ทำงานกับ migration tool แบบ idempotent: รันซ้ำได้ปลอดภัย

CREATE TABLE IF NOT EXISTS trips (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  dest_lat      DOUBLE PRECISION,
  dest_lng      DOUBLE PRECISION,
  dest_name     TEXT,
  line_group_id TEXT UNIQUE,           -- 'g:Uxxx' / 'r:Rxxx' / 'dm:Uxxx'
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id            BIGSERIAL PRIMARY KEY,
  trip_id       BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  line_user_id  TEXT NOT NULL,
  display_name  TEXT,
  is_leader     BOOLEAN NOT NULL DEFAULT false,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trip_id, line_user_id)
);

CREATE TABLE IF NOT EXISTS locations (
  id           BIGSERIAL PRIMARY KEY,
  trip_id      BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_id    BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  latitude     DOUBLE PRECISION NOT NULL,
  longitude    DOUBLE PRECISION NOT NULL,
  distance_km  DOUBLE PRECISION,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_settings (
  trip_id        BIGINT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  enabled        BOOLEAN NOT NULL DEFAULT false,
  interval_min   INTEGER NOT NULL DEFAULT 60 CHECK (interval_min >= 5),
  last_pushed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS push_log (
  id            BIGSERIAL PRIMARY KEY,
  trip_id       BIGINT REFERENCES trips(id) ON DELETE SET NULL,
  pushed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT NOT NULL,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS quota_counter (
  ym    TEXT PRIMARY KEY,            -- '2026-05'
  count INTEGER NOT NULL DEFAULT 0
);

-- indexes
CREATE INDEX IF NOT EXISTS idx_locations_member ON locations(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_locations_trip   ON locations(trip_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_members_trip     ON members(trip_id);
CREATE INDEX IF NOT EXISTS idx_members_user     ON members(line_user_id);
CREATE INDEX IF NOT EXISTS idx_trips_group      ON trips(line_group_id);
CREATE INDEX IF NOT EXISTS idx_trips_status     ON trips(status);
CREATE INDEX IF NOT EXISTS idx_push_log_trip    ON push_log(trip_id, pushed_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_enabled    ON notification_settings(enabled) WHERE enabled = true;
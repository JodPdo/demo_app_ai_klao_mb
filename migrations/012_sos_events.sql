-- 012_sos_events.sql
-- Phase 6.2 Session A — SOS Button backend.
-- New table for emergency SOS events. Writes here, NOT to locations stream,
-- so Pattern A (mobile bg task is sole writer of locations) is preserved.
-- Idempotent per repo convention (IF NOT EXISTS guards, no DROP).

CREATE TABLE IF NOT EXISTS sos_events (
  id                BIGSERIAL PRIMARY KEY,
  trip_id           BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id           BIGINT NOT NULL REFERENCES users(id),
  lat               DOUBLE PRECISION NOT NULL,
  lng               DOUBLE PRECISION NOT NULL,
  accuracy_m        REAL NULL,
  triggered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at      TIMESTAMPTZ NULL,
  cancelled_by      BIGINT NULL REFERENCES users(id),
  push_sent_count   INT NOT NULL DEFAULT 0,
  push_failed_count INT NOT NULL DEFAULT 0
);

-- Fast "active SOS on trip X" lookup (partial index — only uncancelled rows)
CREATE INDEX IF NOT EXISTS idx_sos_trip_active ON sos_events (trip_id)
  WHERE cancelled_at IS NULL;

-- Per-user audit history
CREATE INDEX IF NOT EXISTS idx_sos_user_history ON sos_events (user_id, triggered_at DESC);

-- Defense in depth: at most ONE active (uncancelled) SOS per (trip_id, user_id).
-- The app-level TX dedupe (SELECT ... FOR UPDATE) covers the common case, but in
-- READ COMMITTED a FOR UPDATE locks no rows when zero match — so two truly
-- simultaneous "first" SOS attempts could both pass dedupe and both insert.
-- This UNIQUE partial index makes the DB reject the second with 23505.
-- Cancelled rows are excluded, so a user may fire many SOS over time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sos_one_active_per_user
  ON sos_events (trip_id, user_id)
  WHERE cancelled_at IS NULL;

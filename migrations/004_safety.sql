-- v3.4 — Safety Pack
-- รันได้ปลอดภัย idempotent

-- per-trip stale threshold (default 30 min)
ALTER TABLE trips ADD COLUMN IF NOT EXISTS stale_threshold_min INTEGER NOT NULL DEFAULT 30;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS all_arrived_at TIMESTAMPTZ;

-- per-member arrival + alert tracking
ALTER TABLE members ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;
ALTER TABLE members ADD COLUMN IF NOT EXISTS emergency_contact_user_id TEXT;     -- LINE userId (v2 จะใช้)
ALTER TABLE members ADD COLUMN IF NOT EXISTS last_stale_alert_at TIMESTAMPTZ;
ALTER TABLE members ADD COLUMN IF NOT EXISTS last_stationary_check_at TIMESTAMPTZ;

-- audit table — ทุก safety event log
CREATE TABLE IF NOT EXISTS safety_alerts (
  id            BIGSERIAL PRIMARY KEY,
  trip_id       BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_id     BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  alert_type    TEXT NOT NULL,                       -- 'stale' | 'sos' | 'stationary' | 'arrival' | 'all_arrived'
  triggered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  metadata      JSONB
);

CREATE INDEX IF NOT EXISTS idx_safety_alerts_trip ON safety_alerts(trip_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_safety_alerts_type ON safety_alerts(alert_type, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_members_arrived   ON members(arrived_at) WHERE arrived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_members_stale     ON members(last_stale_alert_at);
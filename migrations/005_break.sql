-- v3.4.2 — Break Mode
-- รันได้ปลอดภัย idempotent

-- per-member break state
ALTER TABLE members ADD COLUMN IF NOT EXISTS break_until         TIMESTAMPTZ;
ALTER TABLE members ADD COLUMN IF NOT EXISTS break_reason        TEXT;       -- 'fuel' | 'meal' | 'restroom' | 'rest' | 'other'
ALTER TABLE members ADD COLUMN IF NOT EXISTS break_started_at    TIMESTAMPTZ;
ALTER TABLE members ADD COLUMN IF NOT EXISTS break_location_lat  DOUBLE PRECISION;
ALTER TABLE members ADD COLUMN IF NOT EXISTS break_location_lng  DOUBLE PRECISION;
ALTER TABLE members ADD COLUMN IF NOT EXISTS break_reminder_sent BOOLEAN NOT NULL DEFAULT false;

-- group break (leader announces all-team rest)
ALTER TABLE trips ADD COLUMN IF NOT EXISTS group_break_until      TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS group_break_started_by TEXT;

-- index — query active breaks ใน scheduler บ่อย
CREATE INDEX IF NOT EXISTS idx_members_break_active
  ON members(break_until)
  WHERE break_until IS NOT NULL;

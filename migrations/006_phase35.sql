-- v3.5 — Group Break + Trip Naming
-- รันได้ปลอดภัย idempotent

-- Trip name length constraint (กัน user ตั้งชื่อยาวเกิน)
-- ลบ constraint เดิมก่อน (ถ้ามี) — บางเวอร์ชันอาจไม่มี
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'trips_name_length_check' AND table_name = 'trips'
  ) THEN
    ALTER TABLE trips ADD CONSTRAINT trips_name_length_check
      CHECK (char_length(name) >= 1 AND char_length(name) <= 50);
  END IF;
END $$;

-- group break — already added in 005, reaffirm exists
ALTER TABLE trips ADD COLUMN IF NOT EXISTS group_break_until      TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS group_break_started_by TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS group_break_reason     TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS group_break_started_at TIMESTAMPTZ;

-- audit: track name changes
CREATE INDEX IF NOT EXISTS idx_trips_group_break_active
  ON trips(group_break_until)
  WHERE group_break_until IS NOT NULL;

-- new alert types acceptable in safety_alerts (no constraint to update — text col)
-- 'group_break_started', 'group_break_ended', 'group_break_extended', 'trip_renamed'

-- v3.2: audit columns สำหรับยกเลิก/รีเซ็ตทริป
-- รันได้ปลอดภัย idempotent

ALTER TABLE trips ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS cancelled_by TEXT;     -- line_user_id ของหัวหน้า
ALTER TABLE trips ADD COLUMN IF NOT EXISTS reset_at     TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS reset_count  INTEGER NOT NULL DEFAULT 0;

-- index สำหรับ query ทริปที่ active เร็วขึ้น (status filter ใช้บ่อย)
CREATE INDEX IF NOT EXISTS idx_trips_active ON trips(status) WHERE status = 'active';
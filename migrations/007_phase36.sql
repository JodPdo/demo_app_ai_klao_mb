-- v3.6 — ETA + Live Location
-- รันได้ปลอดภัย idempotent

-- accuracy + source ของ location update
ALTER TABLE locations ADD COLUMN IF NOT EXISTS accuracy_m DOUBLE PRECISION;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'line';
-- 'line' = LINE webhook event
-- 'liff' = HTML5 watchPosition จาก LIFF
-- 'unknown' = legacy

-- live share session tracking (optional — เผื่อจะแสดงว่าใครกำลัง live)
ALTER TABLE members ADD COLUMN IF NOT EXISTS live_share_started_at TIMESTAMPTZ;
ALTER TABLE members ADD COLUMN IF NOT EXISTS live_share_until       TIMESTAMPTZ;
-- live_share_until > now() = แสดง 🔴 LIVE บนแผนที่

-- index สำหรับ ETA query (locations โดย member เรียง created_at DESC)
CREATE INDEX IF NOT EXISTS idx_locations_member_created
  ON locations(member_id, created_at DESC);

-- v4.0 — Parent Share View
-- Public share tokens สำหรับครอบครัวที่ไม่ได้อยู่ใน LINE group
-- Idempotent: รันซ้ำได้ปลอดภัย

-- เปิด pgcrypto สำหรับ gen_random_uuid() (PostgreSQL 13+)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS share_tokens (
  id              SERIAL PRIMARY KEY,
  trip_id         INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  token           UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  label           TEXT,                                          -- "แม่", "พ่อ", etc.
  created_by      INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,                                    -- NULL = ไม่หมด (จบเมื่อ trip archived)
  revoked_at      TIMESTAMPTZ,                                    -- NULL = ยังใช้ได้
  privacy_mode    TEXT NOT NULL DEFAULT 'full'
                  CHECK (privacy_mode IN ('full', 'initial-only')),
  view_count      INTEGER NOT NULL DEFAULT 0,
  last_viewed_at  TIMESTAMPTZ
);

-- index: lookup ตาม token (ตัด revoked ออก)
CREATE INDEX IF NOT EXISTS idx_share_tokens_active
  ON share_tokens(token)
  WHERE revoked_at IS NULL;

-- index: list ตาม trip_id (สำหรับ leader management)
CREATE INDEX IF NOT EXISTS idx_share_tokens_trip
  ON share_tokens(trip_id, created_at DESC);
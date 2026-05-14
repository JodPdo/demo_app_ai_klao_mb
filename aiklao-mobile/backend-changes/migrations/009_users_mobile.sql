-- Migration 009 — users table for mobile auth
-- Run on production:  psql $DATABASE_URL -f migrations/009_users_mobile.sql

CREATE TABLE IF NOT EXISTS users (
    id              BIGSERIAL PRIMARY KEY,
    line_user_id    TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    picture_url     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_line_user_id ON users (line_user_id);

-- Optional: backfill จาก existing trips ถ้ามี user_id column
-- INSERT INTO users (line_user_id, display_name)
-- SELECT DISTINCT line_user_id, line_user_id FROM trips
-- ON CONFLICT (line_user_id) DO NOTHING;

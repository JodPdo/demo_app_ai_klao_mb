-- Migration 011: LIFF session store for dualAuth cookie authentication
-- Sessions established at POST /api/liff/init after LINE profile verification.
-- 4-hour TTL. Lazy cleanup on each init call.

CREATE TABLE IF NOT EXISTS aiklao_liff_sessions (
  session_id   text          PRIMARY KEY,
  line_user_id text          NOT NULL,
  display_name text,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  expires_at   timestamptz   NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_liff_sessions_expires
  ON aiklao_liff_sessions(expires_at);

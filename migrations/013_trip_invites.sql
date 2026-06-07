-- migrations/013_trip_invites.sql
-- Phase 6.4 — invite-link growth loop
-- Leader generates token → invitee redeems → becomes member
-- Idempotent per repo convention (IF NOT EXISTS guards, no DROP)

CREATE TABLE IF NOT EXISTS trip_invites (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_by_member_id BIGINT NOT NULL REFERENCES members(id),
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invites_token ON trip_invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_trip ON trip_invites(trip_id);

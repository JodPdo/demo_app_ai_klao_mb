-- Migration 010: add ended_at to trips
-- Records exact timestamp when a trip is archived (stopped by leader).
-- Null for active trips and for archived trips created before this migration.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS ended_at timestamptz;

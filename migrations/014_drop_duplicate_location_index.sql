-- idx_locations_member (001_initial.sql) and idx_locations_member_created (007_phase36.sql)
-- are identical indexes (member_id, created_at DESC). Drop the redundant one.
DROP INDEX IF EXISTS idx_locations_member;

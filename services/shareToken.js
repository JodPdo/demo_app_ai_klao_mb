// Share Token Service
// Public share links สำหรับครอบครัวที่ไม่ได้อยู่ใน LINE group
//
// Token lifecycle:
//   - Create: leader สร้าง token (UUID auto)
//   - View: anyone with URL ดูได้ (read-only)
//   - Revoke: leader เพิกถอนได้
//   - Auto-expire: เมื่อ trip archived

const db = require("../lib/db");
const logger = require("../lib/logger");

const PRIVACY_MODES = ["full", "initial-only"];
const DEFAULT_LABEL = "ลิงก์แชร์";
const MAX_TOKENS_PER_TRIP = 20;  // ป้องกัน leader spam

/* =========================================================
   VALIDATION
========================================================= */

function validateLabel(label) {
  if (label == null || label === "") return DEFAULT_LABEL;
  if (typeof label !== "string") return null;
  const trimmed = label.trim();
  if (trimmed.length > 30) return null;
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return null;
  return trimmed;
}

function validatePrivacyMode(mode) {
  if (!mode) return "full";
  return PRIVACY_MODES.includes(mode) ? mode : null;
}

function validateExpiresInHours(hours) {
  if (hours == null) return null;  // null = ไม่หมด (auto-expire เมื่อ trip archived)
  const n = parseInt(hours, 10);
  if (!Number.isFinite(n) || n < 1 || n > 24 * 30) return undefined;  // 1ชม. - 30วัน
  return n;
}

/* =========================================================
   CREATE
========================================================= */

async function createToken(trip, leader, opts = {}) {
  if (!leader.is_leader) return { ok: false, error: "leader only" };

  // limit
  const count = await db.one(
    `SELECT COUNT(*)::int AS n FROM share_tokens
     WHERE trip_id = $1 AND revoked_at IS NULL`,
    [trip.id]
  );
  if (count && count.n >= MAX_TOKENS_PER_TRIP) {
    return { ok: false, error: `เกินจำนวน token สูงสุด ${MAX_TOKENS_PER_TRIP} อัน` };
  }

  const label = validateLabel(opts.label);
  if (label === null) return { ok: false, error: "ชื่อลิงก์ไม่ถูกต้อง (ห้ามว่าง 30 ตัวอักษรสูงสุด)" };

  const privacyMode = validatePrivacyMode(opts.privacy_mode);
  if (!privacyMode) return { ok: false, error: "privacy_mode ต้องเป็น 'full' หรือ 'initial-only'" };

  const expiresInHours = validateExpiresInHours(opts.expires_in_hours);
  if (expiresInHours === undefined) return { ok: false, error: "expires_in_hours: 1-720 (1ชม-30วัน) หรือ null" };

  const expiresAt = expiresInHours ? new Date(Date.now() + expiresInHours * 3600_000) : null;

  const row = await db.one(
    `INSERT INTO share_tokens (trip_id, label, created_by, expires_at, privacy_mode)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, token, label, expires_at, privacy_mode, created_at`,
    [trip.id, label, leader.id, expiresAt, privacyMode]
  );

  logger.info({ tripId: trip.id, leaderId: leader.id, tokenId: row.id, label }, "🔗 share token created");
  return { ok: true, token: row };
}

/* =========================================================
   LIST
========================================================= */

async function listTokens(tripId) {
  const rows = await db.many(
    `SELECT
       st.id, st.token, st.label, st.created_at, st.expires_at,
       st.revoked_at, st.privacy_mode, st.view_count, st.last_viewed_at,
       m.display_name AS created_by_name
     FROM share_tokens st
     LEFT JOIN members m ON m.id = st.created_by
     WHERE st.trip_id = $1
     ORDER BY st.revoked_at NULLS FIRST, st.created_at DESC`,
    [tripId]
  );
  return rows;
}

/* =========================================================
   REVOKE
========================================================= */

async function revokeToken(tripId, tokenId, leader) {
  if (!leader.is_leader) return { ok: false, error: "leader only" };

  const t = await db.one(
    `SELECT id, revoked_at FROM share_tokens WHERE id = $1 AND trip_id = $2`,
    [tokenId, tripId]
  );
  if (!t) return { ok: false, error: "token not found" };
  if (t.revoked_at) return { ok: false, error: "token revoked already" };

  await db.query(
    `UPDATE share_tokens SET revoked_at = now() WHERE id = $1`,
    [tokenId]
  );
  logger.info({ tripId, tokenId, leaderId: leader.id }, "🚫 share token revoked");
  return { ok: true };
}

/* =========================================================
   VALIDATE — public lookup
========================================================= */

async function validateToken(token) {
  if (!token || typeof token !== "string") return { ok: false, error: "missing token" };
  // basic UUID check (32 hex + 4 dashes)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return { ok: false, error: "invalid token format" };
  }

  const row = await db.one(
    `SELECT
       st.id, st.trip_id, st.label, st.privacy_mode,
       st.expires_at, st.revoked_at,
       t.status AS trip_status
     FROM share_tokens st
     JOIN trips t ON t.id = st.trip_id
     WHERE st.token = $1`,
    [token]
  );
  if (!row) return { ok: false, error: "ลิงก์ไม่ถูกต้อง" };
  if (row.revoked_at) return { ok: false, error: "ลิงก์ถูกเพิกถอนแล้ว" };
  if (row.trip_status !== "active") return { ok: false, error: "ทริปจบแล้ว" };
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return { ok: false, error: "ลิงก์หมดอายุแล้ว" };
  }
  return { ok: true, share: row };
}

/* =========================================================
   RECORD VIEW — increment counter
========================================================= */

async function recordView(tokenId) {
  await db.query(
    `UPDATE share_tokens
     SET view_count = view_count + 1, last_viewed_at = now()
     WHERE id = $1`,
    [tokenId]
  );
}

/* =========================================================
   PRIVACY FILTER — apply mode to members data
========================================================= */

function applyPrivacy(members, mode) {
  if (!members) return [];
  if (mode === "full") {
    return members.map((m) => ({
      id: m.id,
      display_name: m.display_name,
      picture_url: m.picture_url,
      is_leader: m.is_leader,
      arrived_at: m.arrived_at,
      latitude: m.latitude,
      longitude: m.longitude,
      distance_km: m.distance_km,
      location_at: m.location_at,
      minutes_ago: m.minutes_ago,
      eta_min: m.eta_min,
      avg_speed_kmh: m.avg_speed_kmh,
      live_share_until: m.live_share_until,
      break_until: m.break_until,
      break_reason: m.break_reason
    }));
  }
  // initial-only: ซ่อน picture + แสดง initial เท่านั้น
  return members.map((m) => ({
    id: m.id,
    display_name: (m.display_name || "?").charAt(0).toUpperCase(),
    picture_url: null,
    is_leader: m.is_leader,
    arrived_at: m.arrived_at,
    latitude: m.latitude,
    longitude: m.longitude,
    distance_km: m.distance_km,
    location_at: m.location_at,
    minutes_ago: m.minutes_ago,
    eta_min: m.eta_min,
    avg_speed_kmh: m.avg_speed_kmh,
    live_share_until: m.live_share_until,
    break_until: m.break_until,
    break_reason: null  // hide reason ใน privacy mode
  }));
}

function applyTripPrivacy(trip, mode) {
  if (mode === "full") return trip;
  return {
    ...trip,
    line_group_id: undefined,  // never expose
    cancelled_by: undefined
  };
}

module.exports = {
  createToken,
  listTokens,
  revokeToken,
  validateToken,
  recordView,
  applyPrivacy,
  applyTripPrivacy,
  PRIVACY_MODES,
  MAX_TOKENS_PER_TRIP
};
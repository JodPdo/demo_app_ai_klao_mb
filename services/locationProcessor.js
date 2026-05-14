
// Shared location processor
// ใช้จาก handlers/webhook (LINE location event) + routes/api (LIFF live share)
// ทำ: store location + checkArrival + checkStationary + checkBreakMovement + auto-renew live_share_until

const db = require("../lib/db");
const logger = require("../lib/logger");
const { getDistance } = require("../utils/distance");
const safety = require("./safety");

// live indicator อายุ 10 นาที — ส่ง location ใหม่จะ renew
const LIVE_INDICATOR_DURATION_MIN = 10;

/**
 * Process incoming location update
 * @param {object} trip — trip row (must have id, dest_lat, dest_lng)
 * @param {object} member — member row
 * @param {number} lat
 * @param {number} lng
 * @param {object} opts — { source: "line"|"liff", accuracy?: number }
 * @returns {Promise<object>}
 */
async function processLocation(trip, member, lat, lng, opts = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: "invalid coords" };
  }

  // 1. ตรวจ break movement ก่อน (ถ้าอยู่ในพัก)
  let breakEnded = false;
  if (safety.isOnBreak(member)) {
    breakEnded = await safety.checkBreakMovement(trip, member, lat, lng);
    if (breakEnded) member.break_until = null;
  }

  // 2. คำนวณ distance ถ้ามีปลายทาง
  let distance = null;
  if (trip.dest_lat != null && trip.dest_lng != null) {
    distance = getDistance(lat, lng, Number(trip.dest_lat), Number(trip.dest_lng));
  }

  // 3. store location
  await db.query(
    `INSERT INTO locations (trip_id, member_id, latitude, longitude, distance_km, accuracy_m, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      trip.id,
      member.id,
      lat,
      lng,
      distance,
      opts.accuracy || null,
      opts.source || "unknown"
    ]
  );

  // 4. clear stale alert (member just sent location → not stale anymore)
  if (member.last_stale_alert_at) {
    await db.query(`UPDATE members SET last_stale_alert_at = NULL WHERE id = $1`, [member.id]);
  }

  if (!member.arrived_at && !safety.isOnBreak(member)) {
    await db.query(
      "UPDATE members SET live_share_until = now() + INTERVAL '10 minutes', live_share_started_at = COALESCE(live_share_started_at, now()) WHERE id = $1",
      [member.id]
    );
  }

  // 5. arrival check + stationary check
  let arrived = false;
  if (trip.dest_lat != null && trip.dest_lng != null) {
    arrived = await safety.checkArrival(trip, member, lat, lng);
    if (!arrived) {
      const fresh = await db.one("SELECT * FROM members WHERE id = $1", [member.id]);
      await safety.checkStationary(trip, fresh || member, lat, lng);
    }
  }

  return { ok: true, distance_km: distance, arrived, break_ended: breakEnded };
}

module.exports = { processLocation, LIVE_INDICATOR_DURATION_MIN };
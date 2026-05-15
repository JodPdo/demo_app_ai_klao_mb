// ETA — v3.6
// คำนวณเวลาที่จะถึงปลายทาง (ETA = remaining_distance / avg_speed)
//
// approach:
//  1. ดึง location ล่าสุด N จุด (default 5) ที่ห่างกันอย่างน้อย 30 วินาที
//  2. คำนวณ avg speed (km/h) จาก distance ระหว่างจุดต่อเวลา
//  3. ETA = remaining_distance_km / avg_speed_kmh * 60 = นาที
//
// edge cases:
//  - on break / arrived / no destination → return null
//  - < 2 location points → return null
//  - speed < 5 km/h → cap (probably stuck / parked) → return null
//  - speed > 200 km/h → clamp (ผิดพลาด GPS) → ใช้ 80 km/h
//  - ETA > 24 ชั่วโมง → return null (probably wrong)

const db = require("../lib/db");
const { getDistance } = require("../utils/distance");

const N_POINTS = 5;            // จำนวน location points ที่ใช้คำนวณ
const MIN_GAP_SEC = 30;        // จุดที่อยู่ใกล้กันเกินไปไม่ใช้
const MIN_AVG_SPEED_KMH = 5;   // ต่ำกว่านี้ ETA ไม่น่าเชื่อถือ
const MAX_AVG_SPEED_KMH = 200; // เร็วเกินไป = clamp
const FALLBACK_SPEED_KMH = 80; // ถ้า GPS error
const MAX_ETA_MIN = 24 * 60;   // 24 ชั่วโมง — เกินนี้ไม่แสดง

function isOnBreak(member) {
  return !!(member.break_until && new Date(member.break_until) > new Date());
}

/**
 * คำนวณ avg speed (km/h) จาก array of {lat, lng, ts}
 * เรียง ASC ตาม ts
 */
function calcAvgSpeed(points) {
  if (!points || points.length < 2) return null;

  let totalDistKm = 0;
  let totalSec = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const dt = (cur.ts - prev.ts) / 1000; // sec
    if (dt < MIN_GAP_SEC) continue;
    const d = getDistance(prev.lat, prev.lng, cur.lat, cur.lng);
    totalDistKm += d;
    totalSec += dt;
  }

  if (totalSec < 30) return null; // ข้อมูลน้อยเกิน
  const speedKmh = (totalDistKm / totalSec) * 3600;
  return speedKmh;
}

/**
 * คำนวณ ETA สำหรับ member 1 คน
 * @param {object} trip — มี dest_lat, dest_lng
 * @param {object} member — มี break_until, arrived_at, latitude, longitude, distance_km
 * @returns {object|null} { eta_min, avg_speed_kmh } หรือ null
 */
async function calcMemberETA(trip, member) {
  if (!trip.dest_lat || !trip.dest_lng) return null;
  if (member.arrived_at) return null;
  if (isOnBreak(member)) return null;

  const remainingKm = member.distance_km != null ? Number(member.distance_km) : null;
  if (remainingKm == null || remainingKm < 0.1) return null;

  // ดึง 5 จุดล่าสุด
  const rows = await db.many(
    `SELECT latitude, longitude, EXTRACT(EPOCH FROM created_at) * 1000 AS ts
    FROM locations
    WHERE member_id = $1
    ORDER BY created_at DESC
    LIMIT $2`,
    [member.id, N_POINTS]
  );

  if (rows.length < 2) return null;

  // เรียง ASC
  const points = rows
    .map((r) => ({ lat: Number(r.latitude), lng: Number(r.longitude), ts: Number(r.ts) }))
    .sort((a, b) => a.ts - b.ts);

  let speed = calcAvgSpeed(points);
  if (speed == null) return null;
  if (speed < MIN_AVG_SPEED_KMH) return null;
  if (speed > MAX_AVG_SPEED_KMH) speed = FALLBACK_SPEED_KMH;

  const etaMin = Math.round((remainingKm / speed) * 60);
  if (etaMin > MAX_ETA_MIN) return null;
  if (etaMin < 0) return null;

  return { eta_min: etaMin, avg_speed_kmh: Math.round(speed * 10) / 10 };
}

/**
 * Batch — คำนวณ ETA สำหรับ members[] หลายคน (1 query / member)
 */
async function attachETAs(trip, members) {
  if (!trip.dest_lat || !trip.dest_lng) return members;
  await Promise.all(
    members.map(async (m) => {
      const eta = await calcMemberETA(trip, m);
      m.eta_min = eta?.eta_min ?? null;
      m.avg_speed_kmh = eta?.avg_speed_kmh ?? null;
    })
  );
  return members;
}

/**
 * Format ETA เป็น human-readable
 *   72 → "1 ชม. 12 นาที"
 *   45 → "45 นาที"
 *   null → "—"
 */
function formatETA(etaMin) {
  if (etaMin == null) return "—";
  if (etaMin < 60) return `${etaMin} นาที`;
  const h = Math.floor(etaMin / 60);
  const m = etaMin % 60;
  return m === 0 ? `${h} ชม.` : `${h} ชม. ${m} นาที`;
}

/**
 * Format ETA เป็นเวลาเป้าหมาย (now + etaMin)
 *   72 → "14:30"
 */
function formatArrivalTime(etaMin, tz = "Asia/Bangkok") {
  if (etaMin == null) return null;
  const at = new Date(Date.now() + etaMin * 60_000);
  return at.toLocaleTimeString("th-TH", {
    hour: "2-digit", minute: "2-digit", timeZone: tz
  });
}

module.exports = {
  calcMemberETA,
  attachETAs,
  calcAvgSpeed,
  formatETA,
  formatArrivalTime,
  N_POINTS,
  MIN_AVG_SPEED_KMH,
  MAX_AVG_SPEED_KMH
};

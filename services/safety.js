// Safety service — v3.4.2 (Break Mode)
//
// Phase 3.4 (existing): stale, arrival, stationary, SOS
// Phase 3.4.2 (new):
//   - enterBreak / exitBreak / extendBreak / isOnBreak / checkBreakExpiry
//   - stale/stationary checks SKIP members in break

const db = require("../lib/db");
const logger = require("../lib/logger");
const { client } = require("../lib/lineClient");
const { extractLineTarget } = require("../utils/lineTarget");
const { getDistance } = require("../utils/distance");

const STALE_COOLDOWN_MIN = 30;
const STATIONARY_RADIUS_M = 50;
const STATIONARY_TIME_MIN = 20;
const STATIONARY_COOLDOWN_MIN = 30;
const ARRIVAL_RADIUS_KM = 0.1;

const BREAK_REMINDER_BEFORE_MIN = 5;        // เตือนก่อนหมด 5 นาที
const BREAK_AUTO_END_RADIUS_KM = 1.0;       // ขยับเกินนี้จากจุดพัก = auto-end
const BREAK_DURATION_MIN = 5;               // ขั้นต่ำ
const BREAK_DURATION_MAX = 480;             // 8 ชั่วโมง

const BREAK_REASON_LABEL = {
  fuel: "⛽ เติมน้ำมัน",
  meal: "🍽 กินข้าว",
  restroom: "🚻 ห้องน้ำ",
  rest: "😴 พักผ่อน",
  other: "☕ พักรถ"
};

/* =========================================================
   STALE CHECK — skip members in break
========================================================= */

async function checkStaleMembers() {
  const candidates = await db.many(
    `
    SELECT
      m.id, m.display_name, m.line_user_id, m.last_stale_alert_at,
      t.id   AS trip_id,
      t.line_group_id,
      t.dest_name,
      t.stale_threshold_min,
      EXTRACT(EPOCH FROM (now() - l.created_at)) / 60.0 AS minutes_ago
    FROM members m
    JOIN trips t ON t.id = m.trip_id
    LEFT JOIN LATERAL (
      SELECT created_at FROM locations
      WHERE member_id = m.id
      ORDER BY created_at DESC LIMIT 1
    ) l ON true
    WHERE t.status = 'active'
      AND t.dest_lat IS NOT NULL
      AND m.arrived_at IS NULL
      AND (m.break_until IS NULL OR m.break_until < now())
      AND l.created_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (now() - l.created_at)) / 60.0 > t.stale_threshold_min
      AND (m.last_stale_alert_at IS NULL
           OR m.last_stale_alert_at < now() - (INTERVAL '1 minute' * $1))
    `,
    [STALE_COOLDOWN_MIN]
  );

  for (const m of candidates) await sendStaleAlert(m);
  return candidates.length;
}

async function sendStaleAlert(member) {
  const target = extractLineTarget(member.line_group_id);
  if (!target) return;
  const minutes = Math.floor(member.minutes_ago);
  const text =
    `⚠️ ${member.display_name} หายไปนาน\n\n` +
    `📍 ส่ง location ครั้งล่าสุดเมื่อ ${minutes} นาทีที่แล้ว\n` +
    `🎯 ${member.dest_name || "(ยังไม่ตั้ง)"}\n\n` +
    `💡 ${member.display_name} กดปุ่ม "📍 ส่งตำแหน่ง" หรือ "☕ พัก" ถ้าจอดพัก`;

  try {
    await client.pushMessage({ to: target, messages: [{ type: "text", text }] });
    await db.query(`UPDATE members SET last_stale_alert_at = now() WHERE id = $1`, [member.id]);
    await db.query(
      `INSERT INTO safety_alerts (trip_id, member_id, alert_type, metadata)
       VALUES ($1, $2, 'stale', $3)`,
      [member.trip_id, member.id, JSON.stringify({ minutes })]
    );
    logger.info({ memberId: member.id, minutes }, "⚠️ stale alert");
  } catch (err) {
    logger.error({ err: err.message, memberId: member.id }, "stale alert failed");
  }
}

/* =========================================================
   ARRIVAL CHECK — keep working even during break
========================================================= */

async function checkArrival(trip, member, lat, lng) {
  if (member.arrived_at) return false;
  if (!trip.dest_lat || !trip.dest_lng) return false;

  const distKm = getDistance(lat, lng, trip.dest_lat, trip.dest_lng);
  if (distKm > ARRIVAL_RADIUS_KM) return false;

  await db.query(`UPDATE members SET arrived_at = now() WHERE id = $1`, [member.id]);
  await db.query(
    `INSERT INTO safety_alerts (trip_id, member_id, alert_type, metadata)
     VALUES ($1, $2, 'arrival', $3)`,
    [trip.id, member.id, JSON.stringify({ distance_m: Math.round(distKm * 1000) })]
  );

  // ถ้าเดินทางมาถึง = ออกจาก break อัตโนมัติด้วย
  if (member.break_until && new Date(member.break_until) > new Date()) {
    await clearBreakColumns(member.id);
  }

  const target = extractLineTarget(trip.line_group_id);
  if (target) {
    try {
      await client.pushMessage({
        to: target,
        messages: [{ type: "text", text: `🎉 ${member.display_name} ถึงปลายทางแล้ว!\n🎯 ${trip.dest_name}` }]
      });
    } catch (err) {
      logger.warn({ err: err.message }, "arrival push failed");
    }
  }

  // เช็คทุกคนถึง?
  const remaining = await db.one(
    `SELECT COUNT(*)::int AS n FROM members WHERE trip_id = $1 AND arrived_at IS NULL`,
    [trip.id]
  );
  if (remaining && remaining.n === 0) {
    await db.query(
      `UPDATE trips SET all_arrived_at = now() WHERE id = $1 AND all_arrived_at IS NULL`,
      [trip.id]
    );
    await db.query(
      `INSERT INTO safety_alerts (trip_id, member_id, alert_type) VALUES ($1, $2, 'all_arrived')`,
      [trip.id, member.id]
    );
    if (target) {
      try {
        await client.pushMessage({
          to: target,
          messages: [{ type: "text", text: `🏆 ทุกคนถึงปลายทางแล้ว!\n🎯 ${trip.dest_name}` }]
        });
      } catch {}
    }
  }
  return true;
}

/* =========================================================
   STATIONARY CHECK — skip if in break
========================================================= */

async function checkStationary(trip, member, currentLat, currentLng) {
  if (member.arrived_at) return false;

  // 🆕 v3.4.2: skip if in break
  if (member.break_until && new Date(member.break_until) > new Date()) return false;

  if (member.last_stationary_check_at) {
    const ago = (Date.now() - new Date(member.last_stationary_check_at).getTime()) / 60_000;
    if (ago < STATIONARY_COOLDOWN_MIN) return false;
  }

  const recent = await db.many(
    `SELECT latitude, longitude, created_at FROM locations
     WHERE member_id = $1 ORDER BY created_at DESC LIMIT 4`,
    [member.id]
  );
  if (recent.length < 3) return false;

  const oldest = recent[recent.length - 1];
  const ageMin = (Date.now() - new Date(oldest.created_at).getTime()) / 60_000;
  if (ageMin < STATIONARY_TIME_MIN) return false;

  const allWithin = recent.every((r) => {
    const d = getDistance(currentLat, currentLng, Number(r.latitude), Number(r.longitude));
    return d * 1000 <= STATIONARY_RADIUS_M;
  });
  if (!allWithin) return false;

  const target = extractLineTarget(trip.line_group_id);
  if (target) {
    try {
      await client.pushMessage({
        to: target,
        messages: [{
          type: "text",
          text: `🛑 ${member.display_name} ตำแหน่งไม่เคลื่อน ${Math.floor(ageMin)} นาที\n\n💡 ปลอดภัยมั้ย? พิมพ์ "OK" ยืนยัน, "พัก 30" ถ้าจอดพัก, หรือ SOS ถ้าฉุกเฉิน`
        }]
      });
    } catch (err) { logger.warn({ err: err.message }, "stationary push failed"); }
  }

  await db.query(`UPDATE members SET last_stationary_check_at = now() WHERE id = $1`, [member.id]);
  await db.query(
    `INSERT INTO safety_alerts (trip_id, member_id, alert_type, metadata)
     VALUES ($1, $2, 'stationary', $3)`,
    [trip.id, member.id, JSON.stringify({ minutes: Math.floor(ageMin) })]
  );
  return true;
}

/* =========================================================
   SOS — works during break too
========================================================= */

async function triggerSOS(trip, member, lat, lng) {
  const target = extractLineTarget(trip.line_group_id);
  if (!target) return { ok: false, error: "no target" };

  const mapLink = `https://www.google.com/maps?q=${lat},${lng}`;
  const text =
    `🆘 ${member.display_name} ขอความช่วยเหลือ!\n\n` +
    `📍 พิกัด: ${lat.toFixed(5)}, ${lng.toFixed(5)}\n` +
    `🗺️ ${mapLink}\n\n` +
    `⚠️ โปรดติดต่อ ${member.display_name} ทันที`;

  try {
    await client.pushMessage({ to: target, messages: [{ type: "text", text }] });
    await db.query(
      `INSERT INTO safety_alerts (trip_id, member_id, alert_type, metadata)
       VALUES ($1, $2, 'sos', $3)`,
      [trip.id, member.id, JSON.stringify({ lat, lng, mapLink })]
    );
    logger.warn({ memberId: member.id, lat, lng }, "🆘 SOS triggered");
    return { ok: true };
  } catch (err) {
    logger.error({ err: err.message }, "SOS push failed");
    return { ok: false, error: err.message };
  }
}

/* =========================================================
   🆕 BREAK MODE
========================================================= */

function validateBreakInput(durationMin, reason) {
  const n = parseInt(durationMin, 10);
  if (!Number.isFinite(n) || isNaN(n))
    return { ok: false, error: "ระยะเวลาต้องเป็นตัวเลข" };
  if (n < BREAK_DURATION_MIN)
    return { ok: false, error: `เวลาต่ำสุด ${BREAK_DURATION_MIN} นาที` };
  if (n > BREAK_DURATION_MAX)
    return { ok: false, error: `เวลาสูงสุด ${BREAK_DURATION_MAX} นาที (8 ชั่วโมง)` };

  const validReasons = ["fuel", "meal", "restroom", "rest", "other"];
  const r = reason && validReasons.includes(reason) ? reason : "rest";
  return { ok: true, durationMin: n, reason: r };
}

function isOnBreak(member) {
  return !!(member.break_until && new Date(member.break_until) > new Date());
}

async function clearBreakColumns(memberId) {
  await db.query(
    `UPDATE members SET
       break_until = NULL,
       break_reason = NULL,
       break_started_at = NULL,
       break_location_lat = NULL,
       break_location_lng = NULL,
       break_reminder_sent = false
     WHERE id = $1`,
    [memberId]
  );
}

/**
 * Enter break mode
 * @returns {object} { ok, breakUntil, error? }
 */
async function enterBreak(trip, member, durationMin, reason) {
  const v = validateBreakInput(durationMin, reason);
  if (!v.ok) return { ok: false, error: v.error };

  // ตำแหน่งที่พัก = location ล่าสุด
  const lastLoc = await db.one(
    `SELECT latitude, longitude FROM locations
     WHERE member_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [member.id]
  );

  const breakUntil = new Date(Date.now() + v.durationMin * 60_000);

  await db.query(
    `UPDATE members SET
       break_until = $1,
       break_reason = $2,
       break_started_at = now(),
       break_location_lat = $3,
       break_location_lng = $4,
       break_reminder_sent = false,
       last_stationary_check_at = NULL,
       last_stale_alert_at = NULL
     WHERE id = $5`,
    [breakUntil, v.reason, lastLoc?.latitude || null, lastLoc?.longitude || null, member.id]
  );

  await db.query(
    `INSERT INTO safety_alerts (trip_id, member_id, alert_type, metadata)
     VALUES ($1, $2, 'break_started', $3)`,
    [trip.id, member.id, JSON.stringify({ duration_min: v.durationMin, reason: v.reason, lat: lastLoc?.latitude, lng: lastLoc?.longitude })]
  );

  // push group
  const target = extractLineTarget(trip.line_group_id);
  if (target) {
    const reasonLabel = BREAK_REASON_LABEL[v.reason] || BREAK_REASON_LABEL.other;
    const endTime = breakUntil.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
    let text = `☕ ${member.display_name} พักรถ ${reasonLabel}\n⏰ จะกลับมา ~${endTime} (${v.durationMin} นาที)`;
    if (lastLoc?.latitude) {
      text += `\n🗺️ https://www.google.com/maps?q=${lastLoc.latitude},${lastLoc.longitude}`;
    }
    try {
      await client.pushMessage({ to: target, messages: [{ type: "text", text }] });
    } catch (err) { logger.warn({ err: err.message }, "break push failed"); }
  }

  logger.info({ memberId: member.id, durationMin: v.durationMin, reason: v.reason }, "☕ break started");
  return { ok: true, breakUntil, durationMin: v.durationMin, reason: v.reason };
}

/**
 * Exit break — manual / movement / expired
 */
async function exitBreak(trip, member, endReason = "manual") {
  if (!isOnBreak(member)) return { ok: false, error: "not on break" };

  const actualMin = member.break_started_at
    ? Math.round((Date.now() - new Date(member.break_started_at).getTime()) / 60_000)
    : null;

  await clearBreakColumns(member.id);
  await db.query(
    `INSERT INTO safety_alerts (trip_id, member_id, alert_type, metadata)
     VALUES ($1, $2, 'break_ended', $3)`,
    [trip.id, member.id, JSON.stringify({ end_reason: endReason, actual_duration_min: actualMin })]
  );

  const target = extractLineTarget(trip.line_group_id);
  if (target) {
    const text = endReason === "movement"
      ? `🚗 ${member.display_name} เห็นเริ่มเดินทาง — ออกจากพักให้แล้ว`
      : `🚗 ${member.display_name} เริ่มเดินทางต่อแล้ว`;
    try {
      await client.pushMessage({ to: target, messages: [{ type: "text", text }] });
    } catch (err) { logger.warn({ err: err.message }, "exit break push failed"); }
  }

  logger.info({ memberId: member.id, endReason, actualMin }, "🚗 break ended");
  return { ok: true, actualMin };
}

/**
 * Extend break by additional minutes
 */
async function extendBreak(trip, member, additionalMin) {
  if (!isOnBreak(member)) return { ok: false, error: "not on break" };
  const v = validateBreakInput(additionalMin, member.break_reason);
  if (!v.ok) return { ok: false, error: v.error };

  const newUntil = new Date(new Date(member.break_until).getTime() + v.durationMin * 60_000);

  // กัน extend เกิน 8 ชั่วโมงรวมจาก now
  const maxAllowed = new Date(Date.now() + BREAK_DURATION_MAX * 60_000);
  const finalUntil = newUntil > maxAllowed ? maxAllowed : newUntil;

  await db.query(
    `UPDATE members SET break_until = $1, break_reminder_sent = false WHERE id = $2`,
    [finalUntil, member.id]
  );
  await db.query(
    `INSERT INTO safety_alerts (trip_id, member_id, alert_type, metadata)
     VALUES ($1, $2, 'break_extended', $3)`,
    [trip.id, member.id, JSON.stringify({ extra_min: v.durationMin, new_until: finalUntil })]
  );

  logger.info({ memberId: member.id, extra: v.durationMin }, "➕ break extended");
  return { ok: true, breakUntil: finalUntil };
}

/**
 * Auto-end break ถ้า user ขยับเกิน radius
 * called จาก webhookHandler ตอนรับ location
 */
async function checkBreakMovement(trip, member, lat, lng) {
  if (!isOnBreak(member)) return false;
  if (member.break_location_lat == null || member.break_location_lng == null) return false;

  const distKm = getDistance(
    lat, lng,
    Number(member.break_location_lat),
    Number(member.break_location_lng)
  );
  if (distKm < BREAK_AUTO_END_RADIUS_KM) return false;

  await exitBreak(trip, member, "movement");
  return true;
}

/**
 * Scheduler tick — check breaks ที่ใกล้หมด / หมดแล้ว
 */
async function checkBreakExpiry() {
  // 1. ก่อนหมด 5 นาที — ส่ง reminder ถ้ายังไม่ส่ง
  const upcoming = await db.many(
    `
    SELECT m.*, t.line_group_id
    FROM members m
    JOIN trips t ON t.id = m.trip_id
    WHERE t.status = 'active'
      AND m.break_until IS NOT NULL
      AND m.break_until > now()
      AND m.break_until < now() + (INTERVAL '1 minute' * $1)
      AND m.break_reminder_sent = false
    `,
    [BREAK_REMINDER_BEFORE_MIN]
  );

  for (const m of upcoming) {
    const target = extractLineTarget(m.line_group_id);
    if (target) {
      try {
        await client.pushMessage({
          to: target,
          messages: [{
            type: "text",
            text: `🔔 ${m.display_name} เหลืออีก ${BREAK_REMINDER_BEFORE_MIN} นาทีจะครบเวลาพัก\n\nพิมพ์ "พักต่อ N" ถ้ายังไม่เสร็จ\nหรือ "กลับมาแล้ว" ถ้าออกเดินทางต่อ`
          }]
        });
      } catch (err) { logger.warn({ err: err.message }, "break reminder push failed"); }
    }
    await db.query(`UPDATE members SET break_reminder_sent = true WHERE id = $1`, [m.id]);
    await db.query(
      `INSERT INTO safety_alerts (trip_id, member_id, alert_type)
       VALUES ($1, $2, 'break_reminder')`,
      [m.trip_id, m.id]
    );
  }

  // 2. หมดเวลาแล้วยังเงียบ (เกิน 30 นาทีจาก break_until) — auto-clear + resume stale check
  const expired = await db.many(
    `
    SELECT m.*, t.line_group_id
    FROM members m
    JOIN trips t ON t.id = m.trip_id
    WHERE t.status = 'active'
      AND m.break_until IS NOT NULL
      AND m.break_until < now() - INTERVAL '30 minutes'
    `
  );

  for (const m of expired) {
    const target = extractLineTarget(m.line_group_id);
    if (target) {
      try {
        await client.pushMessage({
          to: target,
          messages: [{
            type: "text",
            text: `⏰ ${m.display_name} ครบเวลาพักแล้ว 30 นาที — ระบบจะ resume การแจ้งเตือนปกติ\n\n💡 ส่ง location ใหม่เพื่อ confirm ปลอดภัย`
          }]
        });
      } catch (err) { logger.warn({ err: err.message }, "break expired push failed"); }
    }
    await db.query(
      `INSERT INTO safety_alerts (trip_id, member_id, alert_type)
       VALUES ($1, $2, 'break_expired')`,
      [m.trip_id, m.id]
    );
    await clearBreakColumns(m.id);
  }

  return { remindersSent: upcoming.length, expiredCleared: expired.length };
}

module.exports = {
  // existing v3.4
  checkStaleMembers,
  checkArrival,
  checkStationary,
  triggerSOS,

  // v3.4.2 break
  enterBreak,
  exitBreak,
  extendBreak,
  isOnBreak,
  checkBreakMovement,
  checkBreakExpiry,
  validateBreakInput,
  BREAK_DURATION_MIN,
  BREAK_DURATION_MAX,
  BREAK_REASON_LABEL,

  // constants
  STALE_COOLDOWN_MIN,
  STATIONARY_RADIUS_M,
  STATIONARY_TIME_MIN,
  ARRIVAL_RADIUS_KM
};

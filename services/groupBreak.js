// Group Break + Trip Naming
// แยกจาก safety.js เพื่อให้ deploy/maintain ง่ายขึ้น
//
// Group Break: leader ประกาศพักทั้งกลุ่มในคำสั่งเดียว
//   - atomic update ผ่าน db.tx() (trips + members)
//   - 1 push ลด quota
//   - clearExpiredGroupBreaks ใน scheduler
// Trip Naming: leader ตั้งชื่อทริปเอง

const db = require("../lib/db");
const logger = require("../lib/logger");
const { client } = require("../lib/lineClient");
const { extractLineTarget } = require("../utils/lineTarget");
const safety = require("./safety");

const BREAK_DURATION_MAX = safety.BREAK_DURATION_MAX || 480;
const BREAK_REASON_LABEL = safety.BREAK_REASON_LABEL || {
  fuel: "⛽ เติมน้ำมัน",
  meal: "🍽 กินข้าว",
  restroom: "🚻 ห้องน้ำ",
  rest: "😴 พักผ่อน",
  other: "☕ พักรถ"
};

const TRIP_NAME_MIN = 1;
const TRIP_NAME_MAX = 50;

/* =========================================================
   GROUP BREAK
========================================================= */

function isGroupOnBreak(trip) {
  return !!(trip && trip.group_break_until && new Date(trip.group_break_until) > new Date());
}

async function enterGroupBreak(trip, leader, durationMin, reason) {
  if (!leader.is_leader) return { ok: false, error: "leader only" };
  const v = safety.validateBreakInput(durationMin, reason);
  if (!v.ok) return { ok: false, error: v.error };

  const breakUntil = new Date(Date.now() + v.durationMin * 60_000);

  await db.tx(async (q) => {
    await q(
      `UPDATE trips SET
         group_break_until = $1,
         group_break_started_by = $2,
         group_break_reason = $3,
         group_break_started_at = now()
       WHERE id = $4`,
      [breakUntil, leader.line_user_id, v.reason, trip.id]
    );
    // ทุก member ที่ยังไม่ arrived → break พร้อมกัน
    // (ถ้าใครพักรายบุคคลอยู่ จะถูก overwrite — group authoritative)
    await q(
      `UPDATE members m SET
         break_until = $1,
         break_reason = $2,
         break_started_at = now(),
         break_location_lat = COALESCE(
           m.break_location_lat,
           (SELECT latitude FROM locations WHERE member_id = m.id ORDER BY created_at DESC LIMIT 1)
         ),
         break_location_lng = COALESCE(
           m.break_location_lng,
           (SELECT longitude FROM locations WHERE member_id = m.id ORDER BY created_at DESC LIMIT 1)
         ),
         break_reminder_sent = false,
         last_stationary_check_at = NULL,
         last_stale_alert_at = NULL
       WHERE m.trip_id = $3 AND m.arrived_at IS NULL`,
      [breakUntil, v.reason, trip.id]
    );
    await q(
      `INSERT INTO safety_alerts (trip_id, member_id, alert_type, metadata)
       VALUES ($1, $2, 'group_break_started', $3)`,
      [trip.id, leader.id, JSON.stringify({ duration_min: v.durationMin, reason: v.reason })]
    );
  });

  // 1 push to group (ลด quota)
  const target = extractLineTarget(trip.line_group_id);
  if (target) {
    const reasonLabel = BREAK_REASON_LABEL[v.reason] || BREAK_REASON_LABEL.other;
    const endTime = breakUntil.toLocaleTimeString("th-TH", {
      hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok"
    });
    const text =
      `👥 ${leader.display_name} ประกาศพักทั้งกลุ่ม\n\n` +
      `${reasonLabel} • ${v.durationMin} นาที\n` +
      `⏰ จะกลับมา ~${endTime}\n\n` +
      `💡 ขยับเกิน 1 km จะออกจากพักอัตโนมัติ\n` +
      `💡 พิมพ์ "ออกจากพักกลุ่ม" เพื่อเลิกพักทั้งกลุ่ม`;
    try {
      await client.pushMessage({ to: target, messages: [{ type: "text", text }] });
    } catch (err) { logger.warn({ err: err.message }, "group break push failed"); }
  }

  logger.info(
    { tripId: trip.id, leaderId: leader.id, durationMin: v.durationMin, reason: v.reason },
    "👥 group break started"
  );
  return { ok: true, breakUntil, durationMin: v.durationMin, reason: v.reason };
}

async function exitGroupBreak(trip, leader) {
  if (!leader.is_leader) return { ok: false, error: "leader only" };
  if (!isGroupOnBreak(trip)) return { ok: false, error: "ไม่ได้พักกลุ่มอยู่" };

  await db.tx(async (q) => {
    await q(
      `UPDATE trips SET
         group_break_until = NULL,
         group_break_started_by = NULL,
         group_break_reason = NULL,
         group_break_started_at = NULL
       WHERE id = $1`,
      [trip.id]
    );
    // เคลียร์ break ของทุกคนใน trip (เพราะ group เซ็ตทุกคนพร้อมกัน)
    await q(
      `UPDATE members SET
         break_until = NULL, break_reason = NULL,
         break_started_at = NULL, break_location_lat = NULL,
         break_location_lng = NULL, break_reminder_sent = false
       WHERE trip_id = $1 AND break_until IS NOT NULL`,
      [trip.id]
    );
    await q(
      `INSERT INTO safety_alerts (trip_id, member_id, alert_type, metadata)
       VALUES ($1, $2, 'group_break_ended', $3)`,
      [trip.id, leader.id, JSON.stringify({ end_reason: "manual" })]
    );
  });

  const target = extractLineTarget(trip.line_group_id);
  if (target) {
    try {
      await client.pushMessage({
        to: target,
        messages: [{
          type: "text",
          text: `🚗 ${leader.display_name} ประกาศเริ่มเดินทางต่อ — ออกจากพักทั้งกลุ่ม`
        }]
      });
    } catch (err) { logger.warn({ err: err.message }, "exit group break push failed"); }
  }

  logger.info({ tripId: trip.id, leaderId: leader.id }, "🚗 group break ended");
  return { ok: true };
}

async function extendGroupBreak(trip, leader, additionalMin) {
  if (!leader.is_leader) return { ok: false, error: "leader only" };
  if (!isGroupOnBreak(trip)) return { ok: false, error: "ไม่ได้พักกลุ่มอยู่" };
  const v = safety.validateBreakInput(additionalMin, "rest");
  if (!v.ok) return { ok: false, error: v.error };

  const newUntil = new Date(new Date(trip.group_break_until).getTime() + v.durationMin * 60_000);
  const maxAllowed = new Date(Date.now() + BREAK_DURATION_MAX * 60_000);
  const finalUntil = newUntil > maxAllowed ? maxAllowed : newUntil;

  await db.tx(async (q) => {
    await q(`UPDATE trips SET group_break_until = $1 WHERE id = $2`, [finalUntil, trip.id]);
    await q(
      `UPDATE members SET break_until = $1, break_reminder_sent = false
       WHERE trip_id = $2 AND break_until IS NOT NULL`,
      [finalUntil, trip.id]
    );
    await q(
      `INSERT INTO safety_alerts (trip_id, member_id, alert_type, metadata)
       VALUES ($1, $2, 'group_break_extended', $3)`,
      [trip.id, leader.id, JSON.stringify({ extra_min: v.durationMin, new_until: finalUntil })]
    );
  });

  const target = extractLineTarget(trip.line_group_id);
  if (target) {
    try {
      await client.pushMessage({
        to: target,
        messages: [{
          type: "text",
          text: `➕ พักกลุ่มต่ออีก ${v.durationMin} นาที (โดย ${leader.display_name})`
        }]
      });
    } catch (err) { logger.warn({ err: err.message }, "extend group push failed"); }
  }

  logger.info({ tripId: trip.id, extra: v.durationMin }, "➕ group break extended");
  return { ok: true, breakUntil: finalUntil };
}

/**
 * Cleanup: clear group break ของ trips ที่ใน DB หมดเวลาแล้ว
 * called from scheduler tick — หลัง checkBreakExpiry (ที่เคลียร์ members)
 */
async function clearExpiredGroupBreaks() {
  const expired = await db.many(
    `
    SELECT t.id, t.line_group_id
    FROM trips t
    WHERE t.group_break_until IS NOT NULL
      AND t.group_break_until < now()
    `
  );
  for (const t of expired) {
    await db.query(
      `UPDATE trips SET group_break_until = NULL, group_break_started_by = NULL,
                       group_break_reason = NULL, group_break_started_at = NULL
       WHERE id = $1`,
      [t.id]
    );
    await db.query(
      `INSERT INTO safety_alerts (trip_id, member_id, alert_type, metadata)
       VALUES ($1, NULL, 'group_break_ended', $2)`,
      [t.id, JSON.stringify({ end_reason: "expired" })]
    );
    logger.info({ tripId: t.id }, "⏰ group break auto-cleared");
  }
  return expired.length;
}

/* =========================================================
   TRIP RENAME — leader-only
========================================================= */

function validateTripName(name) {
  if (typeof name !== "string") return { ok: false, error: "ต้องเป็นข้อความ" };
  const trimmed = name.trim();
  if (trimmed.length < TRIP_NAME_MIN) return { ok: false, error: "ชื่อทริปห้ามว่าง" };
  if (trimmed.length > TRIP_NAME_MAX) {
    return { ok: false, error: `ชื่อทริปยาวสุด ${TRIP_NAME_MAX} ตัวอักษร` };
  }
  // ห้าม control chars (newline / tab / null)
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return { ok: false, error: "ชื่อทริปห้ามมีอักขระพิเศษ" };
  }
  return { ok: true, name: trimmed };
}

async function renameTrip(trip, leader, newName) {
  if (!leader.is_leader) return { ok: false, error: "leader only" };
  const v = validateTripName(newName);
  if (!v.ok) return { ok: false, error: v.error };
  if (v.name === trip.name) return { ok: false, error: "ชื่อเดิมอยู่แล้ว" };

  const oldName = trip.name;
  await db.query(`UPDATE trips SET name = $1 WHERE id = $2`, [v.name, trip.id]);
  await db.query(
    `INSERT INTO safety_alerts (trip_id, member_id, alert_type, metadata)
     VALUES ($1, $2, 'trip_renamed', $3)`,
    [trip.id, leader.id, JSON.stringify({ old_name: oldName, new_name: v.name })]
  );

  const target = extractLineTarget(trip.line_group_id);
  if (target) {
    try {
      await client.pushMessage({
        to: target,
        messages: [{
          type: "text",
          text: `📝 เปลี่ยนชื่อทริป\n${oldName || "(ไม่มีชื่อ)"} → ${v.name}\nโดย ${leader.display_name}`
        }]
      });
    } catch (err) { logger.warn({ err: err.message }, "rename push failed"); }
  }

  logger.info({ tripId: trip.id, oldName, newName: v.name }, "📝 trip renamed");
  return { ok: true, name: v.name, oldName };
}

module.exports = {
  // group break
  enterGroupBreak,
  exitGroupBreak,
  extendGroupBreak,
  isGroupOnBreak,
  clearExpiredGroupBreaks,
  // rename
  renameTrip,
  validateTripName,
  TRIP_NAME_MIN,
  TRIP_NAME_MAX
};

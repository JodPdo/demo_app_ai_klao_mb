// LINE webhook event handler — v3.5 (Group Break + Trip Naming)
//   v3.4.2: per-member break (พัก / พักต่อ / กลับมาแล้ว)
//   🆕 v3.5 commands:
//     - "พักทั้งกลุ่ม N" / "พักกลุ่ม N" (leader only) — group break
//     - "ออกจากพักกลุ่ม" / "ยกเลิกพักกลุ่ม" (leader only)
//     - "พักกลุ่มต่อ N" (leader only)
//     - "ตั้งชื่อทริป <name>" (leader only)

const db = require("../lib/db");
const logger = require("../lib/logger");
const { client } = require("../lib/lineClient");
const { getDistance } = require("../utils/distance");
const { geocode } = require("../utils/geocode");
const scheduler = require("../services/scheduler");
const safety = require("../services/safety");
const groupBreak = require("../services/groupBreak");

const ALLOWED_STALE_THRESHOLDS = [15, 30, 45, 60, 90, 120, 180];
const DEFAULT_STALE_THRESHOLD = 30;

/* ========== Quick Reply (8 ปุ่ม) ========== */

const defaultQuickReply = {
  items: [
    { type: "action", action: { type: "location", label: "📍 ส่งตำแหน่ง" } },
    { type: "action", action: { type: "message", label: "📊 สถานะทุกคน", text: "สถานะ" } },
    { type: "action", action: { type: "message", label: "🎯 ตั้งปลายทาง", text: "ตั้งปลายทาง" } },
    { type: "action", action: { type: "message", label: "☕ พักรถ", text: "พัก" } },
    { type: "action", action: { type: "message", label: "🔔 เปิดแจ้งเตือน", text: "เปิดแจ้งเตือน" } },
    { type: "action", action: { type: "uri", label: "🗺️ แผนที่", uri: process.env.LIFF_URL || "https://liff.line.me/" } },
    { type: "action", action: { type: "message", label: "🗑️ ยกเลิกทริป", text: "ยกเลิกทริป" } },
    { type: "action", action: { type: "message", label: "❓ ช่วย", text: "ช่วย" } }
  ]
};

const cancelConfirmQuickReply = {
  items: [
    { type: "action", action: { type: "message", label: "✅ ยืนยันยกเลิก", text: "ยืนยันยกเลิก" } },
    { type: "action", action: { type: "message", label: "❌ ไม่ใช่", text: "ไม่" } }
  ]
};

const resetConfirmQuickReply = {
  items: [
    { type: "action", action: { type: "message", label: "✅ ยืนยันรีเซ็ต", text: "ยืนยันรีเซ็ต" } },
    { type: "action", action: { type: "message", label: "❌ ไม่ใช่", text: "ไม่" } }
  ]
};

const sendLocationQuickReply = {
  items: [{ type: "action", action: { type: "location", label: "📍 แชร์ตำแหน่งของฉัน" } }]
};

// 🆕 Break preset Quick Reply (เลือกประเภท + เวลา รวมเลย)
const breakPresetQuickReply = {
  items: [
    { type: "action", action: { type: "message", label: "⛽ เติมน้ำมัน 15น.", text: "พักเติมน้ำมัน 15" } },
    { type: "action", action: { type: "message", label: "🍽 กินข้าว 60น.", text: "พักกินข้าว 60" } },
    { type: "action", action: { type: "message", label: "🚻 ห้องน้ำ 10น.", text: "พักห้องน้ำ 10" } },
    { type: "action", action: { type: "message", label: "😴 พักผ่อน 30น.", text: "พักผ่อน 30" } },
    { type: "action", action: { type: "message", label: "❌ ไม่พักแล้ว", text: "ไม่" } }
  ]
};

const breakActiveQuickReply = {
  items: [
    { type: "action", action: { type: "message", label: "➕ พักต่อ 15น.", text: "พักต่อ 15" } },
    { type: "action", action: { type: "message", label: "➕ พักต่อ 30น.", text: "พักต่อ 30" } },
    { type: "action", action: { type: "message", label: "✅ กลับมาแล้ว", text: "กลับมาแล้ว" } }
  ]
};

/* ========== HELPERS ========== */

function pickerUrl(tripId = null) {
  const liffId = process.env.LIFF_ID || "";
  if (!liffId) return process.env.LIFF_URL || "https://liff.line.me/";
  const base = `https://liff.line.me/${liffId}/pick`;
  return tripId ? `${base}?trip=${tripId}` : base;
}

function reply(token, text, opts = {}) {
  if (!token) return null;
  const { customQuickReply = null } = opts;
  return client.replyMessage({
    replyToken: token,
    messages: [{ type: "text", text, quickReply: customQuickReply ?? defaultQuickReply }]
  });
}

function getTripKey(source) {
  if (source.groupId) return `g:${source.groupId}`;
  if (source.roomId) return `r:${source.roomId}`;
  if (source.userId) return `dm:${source.userId}`;
  return null;
}

async function getOrCreateTrip(source) {
  const key = getTripKey(source);
  if (!key) return null;
  let trip = await db.one(`SELECT * FROM trips WHERE line_group_id = $1`, [key]);
  if (trip && trip.status === "archived") {
    await db.query(`DELETE FROM trips WHERE id = $1`, [trip.id]);
    trip = null;
  }
  if (trip) return trip;
  const name = source.groupId || source.roomId ? "Trip ใหม่" : "ทริปส่วนตัว";
  const inserted = await db.one(
    `INSERT INTO trips (name, line_group_id) VALUES ($1, $2) RETURNING *`,
    [name, key]
  );
  await db.query(
    `INSERT INTO notification_settings (trip_id, enabled, interval_min)
     VALUES ($1, false, $2) ON CONFLICT (trip_id) DO NOTHING`,
    [inserted.id, scheduler.DEFAULT_INTERVAL]
  );
  logger.info({ key, tripId: inserted.id }, "Create new trip");
  return inserted;
}

async function getOrCreateMember(userId, tripId, source) {
  const existing = await db.one(
    `SELECT * FROM members WHERE line_user_id = $1 AND trip_id = $2`,
    [userId, tripId]
  );
  if (existing) return existing;

  let displayName = "New User";
  let pictureUrl = null;
  try {
    let profile;
    if (source.groupId) profile = await client.getGroupMemberProfile(source.groupId, userId);
    else if (source.roomId) profile = await client.getRoomMemberProfile(source.roomId, userId);
    else profile = await client.getProfile(userId);
    displayName = profile.displayName || displayName;
    pictureUrl = profile.pictureUrl || null;
  } catch (err) { logger.warn({ err: err.message, userId }, "fetch LINE profile failed"); }

  const leaderExists = await db.one(
    `SELECT 1 FROM members WHERE trip_id = $1 AND is_leader = true`,
    [tripId]
  );
  const isLeader = !leaderExists;

  const member = await db.one(
    `INSERT INTO members (trip_id, line_user_id, display_name, picture_url, is_leader)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [tripId, userId, displayName, pictureUrl, isLeader]
  );
  logger.info({ userId, tripId, displayName, isLeader }, "Auto-register member");
  return member;
}

async function getNotifSettings(tripId) {
  let row = await db.one(`SELECT * FROM notification_settings WHERE trip_id = $1`, [tripId]);
  if (!row) {
    row = await db.one(
      `INSERT INTO notification_settings (trip_id, enabled, interval_min)
       VALUES ($1, false, $2)
       ON CONFLICT (trip_id) DO UPDATE SET enabled = notification_settings.enabled
       RETURNING *`,
      [tripId, scheduler.DEFAULT_INTERVAL]
    );
  }
  return row;
}

async function maybePromoteToLeader(member, tripId) {
  if (member.is_leader) return false;
  const anyLeader = await db.one(
    `SELECT id FROM members WHERE trip_id = $1 AND is_leader = true`, [tripId]
  );
  if (anyLeader) return false;
  await db.query(`UPDATE members SET is_leader = true WHERE id = $1`, [member.id]);
  member.is_leader = true;
  return true;
}

async function archiveTrip(tripId, byUserId) {
  await db.query(
    `UPDATE trips SET status = 'archived', cancelled_at = now(), cancelled_by = $2 WHERE id = $1`,
    [tripId, byUserId]
  );
  await db.query(
    `INSERT INTO push_log (trip_id, status, error_message) VALUES ($1, 'cancelled', $2)`,
    [tripId, `by ${byUserId}`]
  );
  logger.info({ tripId, byUserId }, "🗑️ trip archived");
}

async function resetTrip(tripId, byUserId) {
  await db.tx(async (q) => {
    await q(`DELETE FROM locations WHERE trip_id = $1`, [tripId]);
    await q(
      `UPDATE trips
       SET dest_lat = NULL, dest_lng = NULL, dest_name = NULL,
           reset_at = now(), reset_count = reset_count + 1, all_arrived_at = NULL
       WHERE id = $1`, [tripId]
    );
    await q(
      `UPDATE members
       SET arrived_at = NULL, last_stale_alert_at = NULL, last_stationary_check_at = NULL,
           break_until = NULL, break_reason = NULL, break_started_at = NULL,
           break_location_lat = NULL, break_location_lng = NULL, break_reminder_sent = false
       WHERE trip_id = $1`, [tripId]
    );
    await q(`UPDATE notification_settings SET enabled = false, last_pushed_at = NULL WHERE trip_id = $1`, [tripId]);
    await q(`INSERT INTO push_log (trip_id, status, error_message) VALUES ($1, 'reset', $2)`, [tripId, `by ${byUserId}`]);
  });
  logger.info({ tripId, byUserId }, "♻️ trip reset");
}

/* ========== 🆕 BREAK COMMAND PARSER ========== */

const BREAK_REASON_MAP = {
  "เติมน้ำมัน": "fuel",
  "น้ำมัน": "fuel",
  "กินข้าว": "meal",
  "ทานข้าว": "meal",
  "ข้าว": "meal",
  "ห้องน้ำ": "restroom",
  "ฉี่": "restroom",
  "ผ่อน": "rest",
  "นอน": "rest",
  "พักผ่อน": "rest"
};

/**
 * Parse "พัก N" / "พักเติมน้ำมัน N" / "พักผ่อน 30" → {duration, reason}
 */
function parseBreakCommand(text) {
  const cleaned = text.replace(/^พัก\s*/, "").trim();
  if (!cleaned) return { kind: "menu" };

  // หาตัวเลข
  const numMatch = cleaned.match(/(\d+)/);
  if (!numMatch) return { kind: "menu_with_hint", input: cleaned };
  const duration = parseInt(numMatch[1], 10);

  // หา reason
  let reason = "rest";
  for (const [keyword, code] of Object.entries(BREAK_REASON_MAP)) {
    if (cleaned.includes(keyword)) {
      reason = code;
      break;
    }
  }

  return { kind: "execute", duration, reason };
}

/* ========== HANDLE EVENT ========== */

async function handleEvent(event) {
  if (event.type === "join") {
    await getOrCreateTrip(event.source);
    return reply(
      event.replyToken,
      `👋 อ้ายคล้าวเข้ากลุ่มแล้ว!\n\n🚦 วิธีใช้:\n1️⃣ คนแรกที่กด "🎯 ตั้งปลายทาง" = หัวหน้าทริป\n2️⃣ ทุกคนกด "📍 ส่งตำแหน่ง"\n3️⃣ จอดพัก → กด "☕ พักรถ"\n4️⃣ ดูแผนที่ realtime ผ่าน "🗺️ แผนที่"\n5️⃣ ฉุกเฉิน → SOS ใน LIFF`
    );
  }

  if (event.type === "leave") {
    const key = getTripKey(event.source);
    if (key) {
      await db.query(
        `UPDATE trips SET status = 'archived', cancelled_at = now() WHERE line_group_id = $1`,
        [key]
      );
    }
    return null;
  }

  if (event.type === "memberJoined" || event.type === "memberLeft" || event.type === "unfollow") return null;

  const userId = event.source.userId;
  if (!userId) return null;

  const trip = await getOrCreateTrip(event.source);
  if (!trip) return null;

  const member = await getOrCreateMember(userId, trip.id, event.source);
  let isLeader = !!member.is_leader;

  /* FOLLOW */
  if (event.type === "follow") {
    const welcome = isLeader
      ? `👋 ยินดีต้อนรับ! คุณเป็นหัวหน้าทริป 👑\n\n🚦 ขั้นแรก:\n1️⃣ กด "🎯 ตั้งปลายทาง"\n2️⃣ ส่ง location\n3️⃣ จอดพัก → กด "☕ พักรถ"`
      : `👋 ยินดีต้อนรับ!\n\n1️⃣ รอหัวหน้าตั้งปลายทาง (หรือกดเองถ้ายังไม่มี)\n2️⃣ กด "📍 ส่งตำแหน่ง"\n3️⃣ จอดพัก → "☕ พักรถ"`;
    return reply(event.replyToken, welcome);
  }

  /* LOCATION */
  if (event.type === "message" && event.message.type === "location") {
    const { latitude, longitude } = event.message;

    // 🆕 v3.4.2: ตรวจการเคลื่อนที่ระหว่างพัก — ถ้าขยับเกิน 1km ออกจากพักให้
    if (safety.isOnBreak(member)) {
      const moved = await safety.checkBreakMovement(trip, member, latitude, longitude);
      if (moved) {
        member.break_until = null; // refresh local state
      }
    }

    if (trip.dest_lat == null) {
      const hint = isLeader
        ? `\n\n💡 คุณเป็นหัวหน้า กด "🎯 ตั้งปลายทาง" ก่อน`
        : `\n\n💡 รอหัวหน้าตั้งปลายทาง (หรือกด "🎯 ตั้งปลายทาง" เอง)`;
      return reply(event.replyToken, `📍 บันทึก location แล้ว\n\n⚠️ ยังไม่ได้ตั้งปลายทาง${hint}`);
    }

    const distance = getDistance(latitude, longitude, trip.dest_lat, trip.dest_lng);
    await db.query(
      `INSERT INTO locations (trip_id, member_id, latitude, longitude, distance_km)
       VALUES ($1, $2, $3, $4, $5)`,
      [trip.id, member.id, latitude, longitude, distance]
    );

    if (member.last_stale_alert_at) {
      await db.query(`UPDATE members SET last_stale_alert_at = NULL WHERE id = $1`, [member.id]);
    }

    const arrived = await safety.checkArrival(trip, member, latitude, longitude);
    if (!arrived) {
      const fresh = await db.one(`SELECT * FROM members WHERE id = $1`, [member.id]);
      await safety.checkStationary(trip, fresh || member, latitude, longitude);
    }

    if (arrived) {
      return reply(event.replyToken, `🎉 คุณถึงปลายทางแล้ว!\n🎯 ${trip.dest_name}\nพักให้สบายเลย 👍`);
    }

    const mapLink = `https://www.google.com/maps?q=${trip.dest_lat},${trip.dest_lng}`;
    const liffUrl = process.env.LIFF_URL || `https://liff.line.me/${process.env.LIFF_ID || ""}`;
    return reply(
      event.replyToken,
      `📍 บันทึกแล้ว ${member.display_name}\n🎯 ${trip.dest_name}\n🚗 เหลือ ${distance.toFixed(2)} km\n\n` +
      `🗺️ Google Maps: ${mapLink}\n\n` +
      `▶︎ เปิดแผนที่กลุ่ม + track ตำแหน่งสด:\n${liffUrl}\n\n` +
      `💡 เปิด LIFF ค้างไว้ → ระบบจะ track ให้อัตโนมัติจนถึงปลายทาง`
    );
  }

  /* TEXT */
  if (event.type === "message" && event.message.type === "text") {
    const text = event.message.text.trim();
    const lower = text.toLowerCase();

    /* ========== 🆕 v3.5 GROUP / RENAME COMMANDS — check FIRST ========== */

    // "ตั้งชื่อทริป <name>" — leader only
    if (/^ตั้งชื่อทริป\s+/.test(text) || /^ตั้งชื่อ\s+/.test(text) || /^เปลี่ยนชื่อทริป\s+/.test(text)) {
      if (!member.is_leader) {
        return reply(event.replyToken, "🔒 เฉพาะหัวหน้าทริปที่ตั้งชื่อได้");
      }
      const newName = text.replace(/^(ตั้งชื่อทริป|ตั้งชื่อ|เปลี่ยนชื่อทริป)\s+/, "").trim();
      const result = await groupBreak.renameTrip(trip, member, newName);
      if (!result.ok) return reply(event.replyToken, `❌ ${result.error}`);
      return reply(event.replyToken, `📝 เปลี่ยนชื่อทริปเรียบร้อย\n\n→ "${result.name}"`);
    }

    // "ออกจากพักกลุ่ม" / "ยกเลิกพักกลุ่ม" / "จบพักกลุ่ม" — leader only
    if (text === "ออกจากพักกลุ่ม" || text === "ยกเลิกพักกลุ่ม" || text === "จบพักกลุ่ม") {
      if (!member.is_leader) {
        return reply(event.replyToken, "🔒 เฉพาะหัวหน้าทริปที่ยกเลิกพักกลุ่มได้");
      }
      const result = await groupBreak.exitGroupBreak(trip, member);
      if (!result.ok) return reply(event.replyToken, `❌ ${result.error}`);
      return reply(event.replyToken, "🚗 ยกเลิกพักทั้งกลุ่มแล้ว — เริ่มเดินทางต่อ");
    }

    // "พักกลุ่มต่อ N" — leader only (must come before generic "พักต่อ")
    if (/^พักกลุ่มต่อ\s/.test(text) || /^พักทั้งกลุ่มต่อ\s/.test(text)) {
      if (!member.is_leader) {
        return reply(event.replyToken, "🔒 เฉพาะหัวหน้าทริปที่ขยายเวลาพักกลุ่มได้");
      }
      const arg = text.replace(/^(พักกลุ่มต่อ|พักทั้งกลุ่มต่อ)\s*/, "").trim();
      const n = parseInt(arg, 10);
      if (!Number.isFinite(n)) {
        return reply(event.replyToken, `❌ พิมพ์ตัวเลข เช่น "พักกลุ่มต่อ 30"`);
      }
      const result = await groupBreak.extendGroupBreak(trip, member, n);
      if (!result.ok) return reply(event.replyToken, `❌ ${result.error}`);
      const endTime = new Date(result.breakUntil).toLocaleTimeString("th-TH", {
        hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok"
      });
      return reply(event.replyToken, `➕ พักกลุ่มต่ออีก ${n} นาที — กลับมา ~${endTime}`);
    }

    // "พักทั้งกลุ่ม N" / "พักกลุ่ม N" / "พักทั้งกลุ่ม<reason> N" — leader only
    if (/^พัก(ทั้ง)?กลุ่ม/.test(text)) {
      if (!member.is_leader) {
        return reply(event.replyToken, "🔒 เฉพาะหัวหน้าทริปที่ประกาศพักทั้งกลุ่มได้");
      }
      // ถ้าพักกลุ่มอยู่แล้ว → แจ้ง
      if (groupBreak.isGroupOnBreak(trip)) {
        const minLeft = Math.max(0, Math.round((new Date(trip.group_break_until).getTime() - Date.now()) / 60_000));
        return reply(
          event.replyToken,
          `👥 กลุ่มกำลังพักอยู่ — เหลืออีก ${minLeft} นาที\n\nพิมพ์ "พักกลุ่มต่อ 30" หรือ "ออกจากพักกลุ่ม"`
        );
      }
      // parse: "พักทั้งกลุ่ม 60" / "พักกลุ่มกินข้าว 90"
      const stripped = text.replace(/^พัก(ทั้ง)?กลุ่ม/, "").trim();
      const parsed = parseBreakCommand("พัก " + stripped); // reuse existing parser
      if (parsed.kind === "menu" || parsed.kind === "menu_with_hint") {
        return reply(
          event.replyToken,
          `👥 พักทั้งกลุ่ม — พิมพ์เวลา (นาที)\n\n• "พักทั้งกลุ่ม 60"\n• "พักกลุ่มกินข้าว 90"\n• "พักกลุ่มเติมน้ำมัน 20"\n\n💡 ${safety.BREAK_DURATION_MIN}-${safety.BREAK_DURATION_MAX} นาที`
        );
      }
      const result = await groupBreak.enterGroupBreak(trip, member, parsed.duration, parsed.reason);
      if (!result.ok) return reply(event.replyToken, `❌ ${result.error}`);
      const endTime = new Date(result.breakUntil).toLocaleTimeString("th-TH", {
        hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok"
      });
      const reasonLabel = safety.BREAK_REASON_LABEL[result.reason] || "☕ พัก";
      return reply(
        event.replyToken,
        `👥 ประกาศพักทั้งกลุ่ม ${reasonLabel}\n⏰ ${result.durationMin} นาที — กลับมา ~${endTime}`
      );
    }

    /* ========== 🆕 BREAK COMMANDS ========== */

    // "กลับมาแล้ว" / "ออกจากพัก" / "จบพัก"
    if (text === "กลับมาแล้ว" || text === "ออกจากพัก" || text === "จบพัก") {
      if (!safety.isOnBreak(member)) {
        return reply(event.replyToken, `💡 คุณไม่ได้อยู่ในโหมดพัก`);
      }
      const result = await safety.exitBreak(trip, member, "manual");
      if (result.ok) {
        return reply(
          event.replyToken,
          `✅ ออกจากพักแล้ว ${member.display_name}\nระยะเวลาพักจริง: ${result.actualMin || "—"} นาที\n\n📍 ส่ง location ใหม่เพื่อ track ระยะ`
        );
      }
      return reply(event.replyToken, `❌ ${result.error || "ไม่สามารถออกจากพัก"}`);
    }

    // "พักต่อ N" — extend
    if (text.startsWith("พักต่อ")) {
      if (!safety.isOnBreak(member)) {
        return reply(event.replyToken, `💡 คุณไม่ได้อยู่ในโหมดพัก — พิมพ์ "พัก N" เพื่อเริ่มพัก`);
      }
      const arg = text.replace(/^พักต่อ\s*/, "").trim();
      const n = parseInt(arg, 10);
      if (!Number.isFinite(n)) {
        return reply(event.replyToken, `❌ พิมพ์ตัวเลข เช่น "พักต่อ 30"`, { customQuickReply: breakActiveQuickReply });
      }
      const result = await safety.extendBreak(trip, member, n);
      if (!result.ok) {
        return reply(event.replyToken, `❌ ${result.error}`, { customQuickReply: breakActiveQuickReply });
      }
      const endTime = new Date(result.breakUntil).toLocaleTimeString("th-TH", {
        hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok"
      });
      return reply(
        event.replyToken,
        `➕ พักต่ออีก ${n} นาที — กลับมา ~${endTime}`,
        { customQuickReply: breakActiveQuickReply }
      );
    }

    // "พัก" / "พัก N" / "พักเติมน้ำมัน N" / etc
    if (text === "พัก" || text === "พักรถ" || text.startsWith("พัก")) {
      // ถ้าอยู่ระหว่างพักแล้ว — ให้ Quick Reply พักต่อ/กลับมา
      if (safety.isOnBreak(member)) {
        const minLeft = Math.max(0, Math.round((new Date(member.break_until).getTime() - Date.now()) / 60_000));
        return reply(
          event.replyToken,
          `☕ คุณกำลังพักอยู่ — เหลืออีก ${minLeft} นาที\n\nต้องการพักต่อหรือกลับมา?`,
          { customQuickReply: breakActiveQuickReply }
        );
      }

      const parsed = parseBreakCommand(text);

      if (parsed.kind === "menu") {
        return reply(
          event.replyToken,
          `☕ ตั้งพักรถ\n\nเลือกประเภท + เวลา หรือพิมพ์เอง เช่น:\n• "พัก 75"\n• "พักกินข้าว 90"\n• "พักเติมน้ำมัน 20"\n\n💡 ตั้งได้ ${safety.BREAK_DURATION_MIN}-${safety.BREAK_DURATION_MAX} นาที`,
          { customQuickReply: breakPresetQuickReply }
        );
      }

      if (parsed.kind === "menu_with_hint") {
        return reply(
          event.replyToken,
          `❌ ไม่เข้าใจ "${parsed.input}"\n\n💡 ลอง: "พัก 30" หรือกดปุ่มด้านล่าง`,
          { customQuickReply: breakPresetQuickReply }
        );
      }

      // execute
      const result = await safety.enterBreak(trip, member, parsed.duration, parsed.reason);
      if (!result.ok) {
        return reply(event.replyToken, `❌ ${result.error}`, { customQuickReply: breakPresetQuickReply });
      }
      const reasonLabel = safety.BREAK_REASON_LABEL[result.reason] || "☕ พัก";
      const endTime = new Date(result.breakUntil).toLocaleTimeString("th-TH", {
        hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok"
      });
      return reply(
        event.replyToken,
        `☕ ${member.display_name} พัก ${reasonLabel}\n⏰ ${result.durationMin} นาที — กลับมา ~${endTime}\n\n💡 ระบบจะหยุดเตือน "หาย/ไม่ขยับ" จนครบเวลา`,
        { customQuickReply: breakActiveQuickReply }
      );
    }

    /* ========== STATIONARY OK CONFIRM ========== */

    if (lower === "ok" || text === "โอเค" || text === "ปลอดภัย") {
      if (member.last_stationary_check_at) {
        await db.query(`UPDATE members SET last_stationary_check_at = NULL WHERE id = $1`, [member.id]);
        await db.query(
          `UPDATE safety_alerts SET resolved_at = now()
           WHERE member_id = $1 AND alert_type = 'stationary' AND resolved_at IS NULL`,
          [member.id]
        );
        return reply(event.replyToken, `✅ รับทราบ ${member.display_name} ปลอดภัย`);
      }
    }

    /* ========== STALE THRESHOLD ========== */

    if (text.startsWith("ตั้งเวลาแจ้ง")) {
      if (!isLeader) return reply(event.replyToken, `⛔ เฉพาะหัวหน้าเท่านั้น`);
      const arg = text.replace(/^ตั้งเวลาแจ้ง\s*/, "").trim();
      if (!arg) {
        return reply(
          event.replyToken,
          `⏰ ค่าที่รองรับ: ${ALLOWED_STALE_THRESHOLDS.join(", ")} นาที\n\n📌 ปัจจุบัน: ${trip.stale_threshold_min || DEFAULT_STALE_THRESHOLD} นาที`
        );
      }
      const n = parseInt(arg, 10);
      if (!ALLOWED_STALE_THRESHOLDS.includes(n)) {
        return reply(event.replyToken, `❌ ค่าที่รองรับ: ${ALLOWED_STALE_THRESHOLDS.join(", ")} นาที`);
      }
      await db.query(`UPDATE trips SET stale_threshold_min = $1 WHERE id = $2`, [n, trip.id]);
      return reply(event.replyToken, `⏰ ตั้งเวลาแจ้ง stale = ${n} นาที`);
    }

    /* ========== ส่งตำแหน่ง ========== */

    if (text === "ส่งตำแหน่ง") {
      return reply(
        event.replyToken,
        `📍 แชร์ตำแหน่งของคุณ\n\nกดปุ่มด้านล่าง`,
        { customQuickReply: sendLocationQuickReply }
      );
    }

    /* ========== ตั้งปลายทาง ========== */

    if (text.startsWith("ตั้งปลายทาง")) {
      if (!isLeader) {
        const promoted = await maybePromoteToLeader(member, trip.id);
        if (!promoted) {
          return reply(event.replyToken, `⛔ ต้องเป็นหัวหน้าทริปเท่านั้น\n\n💡 มีหัวหน้าแล้ว`);
        }
        isLeader = true;
      }

      const placeName = text.replace(/^ตั้งปลายทาง\s*/, "").trim();

      if (!placeName) {
        const url = pickerUrl(trip.id);
        return reply(
          event.replyToken,
          `🎯 ตั้งปลายทาง\n\n📍 กดปุ่ม "🗺️ เปิดแผนที่" ด้านล่าง`,
          {
            customQuickReply: {
              items: [{ type: "action", action: { type: "uri", label: "🗺️ เปิดแผนที่", uri: url } }]
            }
          }
        );
      }

      logger.info({ tripId: trip.id, place: placeName }, "geocode requested");
      const result = await geocode(placeName);
      if (!result) {
        const url = pickerUrl(trip.id);
        return reply(
          event.replyToken,
          `❌ หา "${placeName}" ไม่เจอ\n\n💡 ลองเปิดแผนที่:\n${url}`,
          {
            customQuickReply: {
              items: [{ type: "action", action: { type: "uri", label: "🗺️ เปิดแผนที่", uri: url } }]
            }
          }
        );
      }
      await db.query(
        `UPDATE trips SET dest_lat = $1, dest_lng = $2, dest_name = $3 WHERE id = $4`,
        [result.lat, result.lng, result.displayName, trip.id]
      );
      const mapLink = `https://www.google.com/maps?q=${result.lat},${result.lng}`;
      return reply(event.replyToken, `✅ ตั้งปลายทางเรียบร้อย\n\n🎯 ${result.displayName}\n🗺️ ${mapLink}`);
    }

    /* ========== ระยะ / สถานะ ========== */

    if (lower === "ระยะ" || lower === "distance") {
      const latest = await db.one(
        `SELECT * FROM locations WHERE member_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [member.id]
      );
      if (!latest) return reply(event.replyToken, `❌ ยังไม่มี location\n\nกด "📍 ส่งตำแหน่ง"`);
      return reply(
        event.replyToken,
        `🚗 ${member.display_name}\n🎯 ${trip.dest_name || "(ยังไม่ตั้ง)"}\n📍 เหลือ ${latest.distance_km.toFixed(2)} km`
      );
    }

    if (lower === "สถานะ" || lower === "status") {
      if (trip.dest_lat == null) {
        return reply(event.replyToken, `⚠️ ยังไม่ได้ตั้งปลายทาง\n\n💡 กด "🎯 ตั้งปลายทาง"`);
      }
      const rows = await db.many(
        `SELECT m.display_name, m.is_leader, m.arrived_at, m.break_until, m.break_reason, l.distance_km
         FROM members m
         LEFT JOIN LATERAL (
           SELECT distance_km FROM locations WHERE member_id = m.id
           ORDER BY created_at DESC LIMIT 1
         ) l ON true
         WHERE m.trip_id = $1
         ORDER BY
           CASE
             WHEN m.arrived_at IS NOT NULL THEN 1
             WHEN m.break_until > now() THEN 3
             WHEN l.distance_km IS NULL THEN 4
             ELSE 2
           END,
           l.distance_km ASC NULLS LAST`,
        [trip.id]
      );
      let txt = `📍 ${trip.name}\n🎯 ${trip.dest_name}\n\n`;
      rows.forEach((r, i) => {
        const crown = r.is_leader ? " 👑" : "";
        let status;
        if (r.arrived_at) status = " ✅ ถึงแล้ว";
        else if (r.break_until && new Date(r.break_until) > new Date()) {
          const minLeft = Math.max(0, Math.round((new Date(r.break_until).getTime() - Date.now()) / 60_000));
          status = ` ☕ พัก ${minLeft}น.`;
        } else status = "";
        const dist = r.distance_km == null ? "ยังไม่ส่ง" : `${r.distance_km.toFixed(1)} km`;
        txt += `${i + 1}. ${r.display_name}${crown}${status} — ${dist}\n`;
      });
      return reply(event.replyToken, txt.trim());
    }

    /* ========== แจ้งเตือน ========== */

    if (text.startsWith("เปิดแจ้งเตือน")) {
      if (!isLeader) return reply(event.replyToken, `⛔ เฉพาะหัวหน้าเท่านั้น`);
      const arg = text.replace(/^เปิดแจ้งเตือน\s*/, "").trim();
      let interval = scheduler.DEFAULT_INTERVAL;
      if (arg) {
        const n = parseInt(arg, 10);
        if (!scheduler.ALLOWED_INTERVALS.includes(n)) {
          return reply(event.replyToken, `❌ Interval: ${scheduler.ALLOWED_INTERVALS.join(", ")} นาที`);
        }
        interval = n;
      }
      await db.query(
        `INSERT INTO notification_settings (trip_id, enabled, interval_min)
         VALUES ($1, true, $2)
         ON CONFLICT (trip_id) DO UPDATE SET enabled = true, interval_min = EXCLUDED.interval_min`,
        [trip.id, interval]
      );
      const q = await scheduler.getQuotaSummary();
      return reply(
        event.replyToken,
        `🔔 เปิดแจ้งเตือนแล้ว\n⏰ ทุก ${interval} นาที\n📊 Quota: ${q.used}/${q.limit} (${q.pct}%)`
      );
    }

    if (text === "ปิดแจ้งเตือน") {
      if (!isLeader) return reply(event.replyToken, `⛔ เฉพาะหัวหน้าเท่านั้น`);
      await db.query(`UPDATE notification_settings SET enabled = false WHERE trip_id = $1`, [trip.id]);
      return reply(event.replyToken, `🔕 ปิดแจ้งเตือนแล้ว`);
    }

    if (text === "ทดสอบแจ้งเตือน") {
      if (!isLeader) return reply(event.replyToken, `⛔ เฉพาะหัวหน้าเท่านั้น`);
      if (trip.dest_lat == null) return reply(event.replyToken, `⚠️ ตั้งปลายทางก่อน`);
      const settings = await getNotifSettings(trip.id);
      const result = await scheduler.pushTripUpdate(trip, settings.interval_min);
      return reply(event.replyToken, `🧪 Test push: ${result.status}${result.error ? ` (${result.error})` : ""}`);
    }

    if (lower === "quota" || text === "โควต้า") {
      const q = await scheduler.getQuotaSummary();
      const settings = await getNotifSettings(trip.id);
      return reply(
        event.replyToken,
        `📊 LINE Push Quota\n\nใช้ไป: ${q.used}/${q.limit} (${q.pct}%)\nเหลือ: ${q.remaining}\n\n🔔 ${settings.enabled ? `ON ${settings.interval_min}น.` : "OFF"}\n⏰ Stale: ${trip.stale_threshold_min || DEFAULT_STALE_THRESHOLD}น.`
      );
    }

    if (text === "แผนที่" || lower === "map") {
      return reply(event.replyToken, `🗺️ ${process.env.LIFF_URL || "(ยังไม่ตั้ง LIFF_URL)"}`);
    }

    /* ========== Cancel / Reset ========== */

    if (text === "ยกเลิกทริป") {
      if (!isLeader) return reply(event.replyToken, `⛔ เฉพาะหัวหน้าเท่านั้น`);
      return reply(
        event.replyToken,
        `⚠️ ยืนยันยกเลิกทริปนี้?\n\n🗑️ Archive ทริป\n💡 พิมพ์อะไรในกลุ่มต่อไป → trip ใหม่อัตโนมัติ`,
        { customQuickReply: cancelConfirmQuickReply }
      );
    }
    if (text === "ยืนยันยกเลิก") {
      if (!isLeader) return reply(event.replyToken, `⛔ เฉพาะหัวหน้าเท่านั้น`);
      await archiveTrip(trip.id, userId);
      return reply(event.replyToken, `🗑️ ยกเลิกทริปเรียบร้อย\n\n💡 พิมพ์อะไรก็ได้เพื่อเริ่มทริปใหม่`);
    }
    if (text === "รีเซ็ตทริป") {
      if (!isLeader) return reply(event.replyToken, `⛔ เฉพาะหัวหน้าเท่านั้น`);
      return reply(
        event.replyToken,
        `⚠️ ยืนยันรีเซ็ตทริปนี้?\n\n♻️ ลบ location + ปลายทาง + พัก ทั้งหมด`,
        { customQuickReply: resetConfirmQuickReply }
      );
    }
    if (text === "ยืนยันรีเซ็ต") {
      if (!isLeader) return reply(event.replyToken, `⛔ เฉพาะหัวหน้าเท่านั้น`);
      await resetTrip(trip.id, userId);
      return reply(event.replyToken, `♻️ รีเซ็ตทริปเรียบร้อย`);
    }
    if (text === "ไม่" || text === "ไม่ใช่") {
      return reply(event.replyToken, `👌 ยกเลิกการดำเนินการ`);
    }

    /* ========== ช่วย ========== */

    if (lower === "ช่วย" || lower === "help") {
      let h = `📖 คำสั่งทั้งหมด\n\n`;
      h += `📍 ส่ง location\n📊 "สถานะ"\n📏 "ระยะ"\n🗺️ "แผนที่"\n☕ "พัก [N]" / "พักกินข้าว 60" / "กลับมาแล้ว"\n✅ "OK" — ยืนยันปลอดภัย\n📊 "quota"\n`;
      h += `\n👑 หัวหน้า:\n🎯 "ตั้งปลายทาง"\n🔔 "เปิดแจ้งเตือน N"\n🔕 "ปิดแจ้งเตือน"\n⏰ "ตั้งเวลาแจ้ง N"\n🗑️ "ยกเลิกทริป" / "รีเซ็ตทริป"\n`;
      h += `\n🆘 ฉุกเฉิน → SOS ใน LIFF`;
      return reply(event.replyToken, h);
    }

    /* default */
    const greeting = isLeader
      ? `อ้ายคล้าวพร้อมรับใช้ 🚗 (หัวหน้า 👑)`
      : `อ้ายคล้าวพร้อมรับใช้ 🚗`;
    return reply(event.replyToken, `${greeting}\n\nกดปุ่มด้านล่าง หรือพิมพ์ "ช่วย"`);
  }

  return null;
}

module.exports = { handleEvent, archiveTrip, resetTrip, pickerUrl };
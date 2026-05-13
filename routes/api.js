// REST API for LIFF Web App — v3.5
// + 🆕 group break: POST /api/trip/:id/group-break, /group-break/end, /group-break/extend
// + 🆕 trip rename: PATCH /api/trip/:id/name
// + GET /api/trip/:id ส่ง group_break_until + name กลับด้วย
// inherits: v3.4.2 break, v3.4 SOS

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const db = require("../lib/db");
const logger = require("../lib/logger");
const liffAuth = require("../middleware/liffAuth");
const { client } = require("../lib/lineClient");
const geocode = require("../utils/geocode");
const { extractLineTarget } = require("../utils/lineTarget");
const { archiveTrip, resetTrip } = require("../handlers/webhook");
const safety = require("../services/safety");
const groupBreak = require("../services/groupBreak");
const eta = require("../services/eta");
const shareToken = require("../services/shareToken");
const locationProcessor = require("../services/locationProcessor");

const router = express.Router();

router.use(
  cors({ origin: process.env.ALLOWED_ORIGINS?.split(",") || true, credentials: false })
);

router.use(rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }));

/* PUBLIC */
router.get("/config", (req, res) => {
  res.json({
    liffId: process.env.LIFF_ID || "",
    refreshIntervalSec: parseInt(process.env.LIFF_REFRESH_SEC || "15", 10)
  });
});


/* PROTECTED */

router.use(liffAuth);

router.get("/me", (req, res) => res.json({ user: req.lineUser }));

router.get("/me/trips", async (req, res) => {
  const trips = await db.many(
    `
    SELECT
      t.id, t.name, t.dest_name, t.dest_lat, t.dest_lng,
      t.line_group_id, t.status, t.created_at,
      m.is_leader,
      (SELECT COUNT(*) FROM members WHERE trip_id = t.id) AS member_count,
      (SELECT COUNT(DISTINCT l.member_id) FROM locations l WHERE l.trip_id = t.id) AS active_count
    FROM trips t
    JOIN members m ON m.trip_id = t.id
    WHERE m.line_user_id = $1 AND t.status = 'active'
    ORDER BY t.created_at DESC
    `,
    [req.lineUser.userId]
  );
  res.json({ trips });
});

router.get("/trip/:tripId", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (Number.isNaN(tripId)) return res.status(400).json({ error: "invalid trip id" });

  const membership = await db.one(
    `SELECT id, is_leader FROM members WHERE trip_id = $1 AND line_user_id = $2`,
    [tripId, req.lineUser.userId]
  );
  if (!membership) return res.status(403).json({ error: "not a member" });

  const trip = await db.one(
    `SELECT id, name, dest_lat, dest_lng, dest_name, status,
            stale_threshold_min, all_arrived_at, created_at,
            group_break_until, group_break_started_by,
            group_break_reason, group_break_started_at
     FROM trips WHERE id = $1`,
    [tripId]
  );
  if (!trip) return res.status(404).json({ error: "trip not found" });

  // 🆕 v3.4.2: include break columns
  const members = await db.many(
    `
    SELECT
      m.id, m.display_name, m.picture_url, m.is_leader, m.arrived_at,
      m.break_until, m.break_reason, m.break_started_at,
      m.break_location_lat, m.break_location_lng,
      m.live_share_until, m.live_share_started_at,
      l.latitude, l.longitude, l.distance_km,
      l.created_at AS location_at,
      EXTRACT(EPOCH FROM (now() - l.created_at)) / 60.0 AS minutes_ago
    FROM members m
    LEFT JOIN LATERAL (
      SELECT latitude, longitude, distance_km, created_at
      FROM locations WHERE member_id = m.id
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
      l.distance_km ASC NULLS LAST
    `,
    [tripId]
  );

  const notif = await db.one(
    `SELECT enabled, interval_min, last_pushed_at FROM notification_settings WHERE trip_id = $1`,
    [tripId]
  );

  // 🆕 v3.6: attach ETA per member
  await eta.attachETAs(trip, members);

  res.json({
    trip,
    members,
    notification: notif,
    me: { ...req.lineUser, isLeader: membership.is_leader, memberId: membership.id }
  });
});

/* GEOCODE */
router.get("/geocode/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.json({ results: [] });
  const results = await geocode.searchMultiple(q, 5);
  res.json({ results });
});

router.get("/geocode/reverse", async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    return res.status(400).json({ error: "invalid coords" });
  const place = await geocode.reverse(lat, lng);
  if (!place) return res.status(404).json({ error: "no place found" });
  res.json(place);
});

/* TRIP MANAGEMENT */
async function requireLeader(req, res, tripId) {
  const m = await db.one(
    `SELECT is_leader FROM members WHERE trip_id = $1 AND line_user_id = $2`,
    [tripId, req.lineUser.userId]
  );
  if (!m) { res.status(403).json({ error: "not a member" }); return null; }
  if (!m.is_leader) { res.status(403).json({ error: "leader only" }); return null; }
  return m;
}

router.post("/trip/:tripId/destination", express.json(), async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (Number.isNaN(tripId)) return res.status(400).json({ error: "invalid trip id" });

  const { lat, lng, name } = req.body || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !name || typeof name !== "string")
    return res.status(400).json({ error: "lat, lng, name required" });
  if (lat < 5 || lat > 21 || lng < 95 || lng > 106)
    return res.status(400).json({ error: "coords outside Thailand" });

  if (!(await requireLeader(req, res, tripId))) return;

  const trip = await db.one(`SELECT * FROM trips WHERE id = $1`, [tripId]);
  if (!trip) return res.status(404).json({ error: "trip not found" });
  if (trip.status !== "active") return res.status(409).json({ error: "trip not active" });

  try {
    await db.query(
      `UPDATE trips SET dest_lat = $1, dest_lng = $2, dest_name = $3 WHERE id = $4`,
      [lat, lng, name.slice(0, 500), tripId]
    );
    const target = extractLineTarget(trip.line_group_id);
    if (target) {
      const mapLink = `https://www.google.com/maps?q=${lat},${lng}`;
      try {
        await client.pushMessage({
          to: target,
          messages: [{
            type: "text",
            text: `✅ ตั้งปลายทางเรียบร้อย\n\n🎯 ${name.slice(0, 200)}\n🗺️ ${mapLink}\n\nสมาชิกกด "📍 ส่งตำแหน่ง" 🚗`
          }]
        });
      } catch (err) { logger.warn({ err: err.message }, "push destination failed"); }
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err: err.message, tripId }, "set destination failed");
    res.status(500).json({ error: "set destination failed" });
  }
});

router.post("/trip/:tripId/archive", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (Number.isNaN(tripId)) return res.status(400).json({ error: "invalid trip id" });
  if (!(await requireLeader(req, res, tripId))) return;
  const trip = await db.one(`SELECT id, status FROM trips WHERE id = $1`, [tripId]);
  if (!trip) return res.status(404).json({ error: "trip not found" });
  if (trip.status === "archived") return res.status(409).json({ error: "already archived" });
  try {
    await archiveTrip(tripId, req.lineUser.userId);
    res.json({ ok: true, action: "archived" });
  } catch (err) {
    logger.error({ err: err.message }, "archive failed");
    res.status(500).json({ error: "archive failed" });
  }
});

router.post("/trip/:tripId/reset", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (Number.isNaN(tripId)) return res.status(400).json({ error: "invalid trip id" });
  if (!(await requireLeader(req, res, tripId))) return;
  const trip = await db.one(`SELECT id, status FROM trips WHERE id = $1`, [tripId]);
  if (!trip) return res.status(404).json({ error: "trip not found" });
  if (trip.status !== "active") return res.status(409).json({ error: "trip not active" });
  try {
    await resetTrip(tripId, req.lineUser.userId);
    res.json({ ok: true, action: "reset" });
  } catch (err) {
    logger.error({ err: err.message }, "reset failed");
    res.status(500).json({ error: "reset failed" });
  }
});

/* v3.4: SOS endpoint */
router.post("/trip/:tripId/sos", express.json(), async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (Number.isNaN(tripId)) return res.status(400).json({ error: "invalid trip id" });

  const { lat, lng } = req.body || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat, lng required" });
  }

  const membership = await db.one(
    `SELECT id, is_leader, display_name FROM members
     WHERE trip_id = $1 AND line_user_id = $2`,
    [tripId, req.lineUser.userId]
  );
  if (!membership) return res.status(403).json({ error: "not a member" });

  const trip = await db.one(`SELECT * FROM trips WHERE id = $1`, [tripId]);
  if (!trip) return res.status(404).json({ error: "trip not found" });

  // ถ้าทริป archived → ยังให้ SOS ส่งได้ (กรณีฉุกเฉินไม่ blocking)
  const member = await db.one(`SELECT * FROM members WHERE id = $1`, [membership.id]);
  const result = await safety.triggerSOS(trip, member, lat, lng);
  if (!result.ok) return res.status(500).json({ error: result.error || "sos failed" });

  res.json({ ok: true });
});

/* v3.4: Safety alert history */
router.get("/trip/:tripId/safety", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (Number.isNaN(tripId)) return res.status(400).json({ error: "invalid trip id" });
  const m = await db.one(
    `SELECT 1 FROM members WHERE trip_id = $1 AND line_user_id = $2`,
    [tripId, req.lineUser.userId]
  );
  if (!m) return res.status(403).json({ error: "not a member" });
  const alerts = await db.many(
    `SELECT a.id, a.alert_type, a.triggered_at, a.resolved_at, a.metadata,
            mb.display_name AS member_name
     FROM safety_alerts a
     JOIN members mb ON mb.id = a.member_id
     WHERE a.trip_id = $1
     ORDER BY a.triggered_at DESC
     LIMIT 50`,
    [tripId]
  );
  res.json({ alerts });
});

/* 🆕 v3.4.2: BREAK endpoints */

// helper: load member + trip with active-status guard
async function loadTripAndMember(req, res, tripId, requireActive = true) {
  const trip = await db.one(`SELECT * FROM trips WHERE id = $1`, [tripId]);
  if (!trip) { res.status(404).json({ error: "trip not found" }); return null; }
  if (requireActive && trip.status !== "active") {
    res.status(409).json({ error: "trip not active" });
    return null;
  }
  const member = await db.one(
    `SELECT * FROM members WHERE trip_id = $1 AND line_user_id = $2`,
    [tripId, req.lineUser.userId]
  );
  if (!member) { res.status(403).json({ error: "not a member" }); return null; }
  return { trip, member };
}

// POST /api/trip/:tripId/break — เริ่มพัก
router.post("/trip/:tripId/break", express.json(), async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (Number.isNaN(tripId)) return res.status(400).json({ error: "invalid trip id" });

  const { duration_min, reason } = req.body || {};
  const ctx = await loadTripAndMember(req, res, tripId);
  if (!ctx) return;
  const { trip, member } = ctx;

  if (member.arrived_at) {
    return res.status(409).json({ error: "ถึงปลายทางแล้ว ไม่ต้องพัก" });
  }
  if (safety.isOnBreak(member)) {
    return res.status(409).json({
      error: "กำลังพักอยู่",
      break_until: member.break_until,
      break_reason: member.break_reason
    });
  }

  try {
    const result = await safety.enterBreak(trip, member, duration_min, reason);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({
      ok: true,
      break_until: result.breakUntil,
      duration_min: result.durationMin,
      reason: result.reason
    });
  } catch (err) {
    logger.error({ err: err.message, tripId, memberId: member.id }, "enter break failed");
    res.status(500).json({ error: "enter break failed" });
  }
});

// POST /api/trip/:tripId/break/extend — เพิ่มเวลาพัก
router.post("/trip/:tripId/break/extend", express.json(), async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (Number.isNaN(tripId)) return res.status(400).json({ error: "invalid trip id" });

  const { additional_min } = req.body || {};
  const ctx = await loadTripAndMember(req, res, tripId);
  if (!ctx) return;
  const { trip, member } = ctx;

  if (!safety.isOnBreak(member)) {
    return res.status(409).json({ error: "ไม่ได้อยู่ในช่วงพัก" });
  }

  try {
    const result = await safety.extendBreak(trip, member, additional_min);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, break_until: result.breakUntil });
  } catch (err) {
    logger.error({ err: err.message, tripId, memberId: member.id }, "extend break failed");
    res.status(500).json({ error: "extend break failed" });
  }
});

// POST /api/trip/:tripId/break/end — ออกจากพัก (manual)
router.post("/trip/:tripId/break/end", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (Number.isNaN(tripId)) return res.status(400).json({ error: "invalid trip id" });

  const ctx = await loadTripAndMember(req, res, tripId);
  if (!ctx) return;
  const { trip, member } = ctx;

  if (!safety.isOnBreak(member)) {
    return res.status(409).json({ error: "ไม่ได้อยู่ในช่วงพัก" });
  }

  try {
    const result = await safety.exitBreak(trip, member, "manual");
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, actual_min: result.actualMin });
  } catch (err) {
    logger.error({ err: err.message, tripId, memberId: member.id }, "exit break failed");
    res.status(500).json({ error: "exit break failed" });
  }
});

/* 🆕 v3.5: GROUP BREAK endpoints (leader only) */
router.post("/trip/:tripId/group-break", express.json(), async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (Number.isNaN(tripId)) return res.status(400).json({ error: "invalid trip id" });
  const { duration_min, reason } = req.body || {};
  const leader = await db.one(
    `SELECT * FROM members WHERE trip_id = $1 AND line_user_id = $2`,
    [tripId, req.lineUser.userId]
  );
  if (!leader) return res.status(403).json({ error: "not a member" });
  if (!leader.is_leader) return res.status(403).json({ error: "leader only" });
  const trip = await db.one(`SELECT * FROM trips WHERE id = $1`, [tripId]);
  if (!trip) return res.status(404).json({ error: "trip not found" });
  if (trip.status !== "active") return res.status(409).json({ error: "trip not active" });
  if (groupBreak.isGroupOnBreak(trip)) {
    return res.status(409).json({ error: "group on break", group_break_until: trip.group_break_until });
  }
  try {
    const result = await groupBreak.enterGroupBreak(trip, leader, duration_min, reason);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, break_until: result.breakUntil, duration_min: result.durationMin, reason: result.reason });
  } catch (err) {
    logger.error({ err: err.message, tripId }, "enter group break failed");
    res.status(500).json({ error: "enter group break failed" });
  }
});

router.post("/trip/:tripId/group-break/extend", express.json(), async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (Number.isNaN(tripId)) return res.status(400).json({ error: "invalid trip id" });
  const { additional_min } = req.body || {};
  const leader = await db.one(
    `SELECT * FROM members WHERE trip_id = $1 AND line_user_id = $2`,
    [tripId, req.lineUser.userId]
  );
  if (!leader) return res.status(403).json({ error: "not a member" });
  if (!leader.is_leader) return res.status(403).json({ error: "leader only" });
  const trip = await db.one(`SELECT * FROM trips WHERE id = $1`, [tripId]);
  if (!trip) return res.status(404).json({ error: "trip not found" });
  try {
    const result = await groupBreak.extendGroupBreak(trip, leader, additional_min);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, break_until: result.breakUntil });
  } catch (err) {
    logger.error({ err: err.message, tripId }, "extend group break failed");
    res.status(500).json({ error: "extend group break failed" });
  }
});

router.post("/trip/:tripId/group-break/end", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (Number.isNaN(tripId)) return res.status(400).json({ error: "invalid trip id" });
  const leader = await db.one(
    `SELECT * FROM members WHERE trip_id = $1 AND line_user_id = $2`,
    [tripId, req.lineUser.userId]
  );
  if (!leader) return res.status(403).json({ error: "not a member" });
  if (!leader.is_leader) return res.status(403).json({ error: "leader only" });
  const trip = await db.one(`SELECT * FROM trips WHERE id = $1`, [tripId]);
  if (!trip) return res.status(404).json({ error: "trip not found" });
  try {
    const result = await groupBreak.exitGroupBreak(trip, leader);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err: err.message, tripId }, "exit group break failed");
    res.status(500).json({ error: "exit group break failed" });
  }
});

router.patch("/trip/:tripId/name", express.json(), async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (Number.isNaN(tripId)) return res.status(400).json({ error: "invalid trip id" });
  const { name } = req.body || {};
  const leader = await db.one(
    `SELECT * FROM members WHERE trip_id = $1 AND line_user_id = $2`,
    [tripId, req.lineUser.userId]
  );
  if (!leader) return res.status(403).json({ error: "not a member" });
  if (!leader.is_leader) return res.status(403).json({ error: "leader only" });
  const trip = await db.one(`SELECT * FROM trips WHERE id = $1`, [tripId]);
  if (!trip) return res.status(404).json({ error: "trip not found" });
  if (trip.status !== "active") return res.status(409).json({ error: "trip not active" });
  try {
    const result = await groupBreak.renameTrip(trip, leader, name);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, name: result.name, old_name: result.oldName });
  } catch (err) {
    logger.error({ err: err.message, tripId }, "rename trip failed");
    res.status(500).json({ error: "rename trip failed" });
  }
});


/* 🆕 v3.6: LIVE LOCATION endpoints */

// per-user simple rate limit (15 sec) — ใน-memory map
const liveRateMap = new Map();
const LIVE_MIN_INTERVAL_MS = 12_000; // 12 sec ระหว่าง location updates ต่อ member
const LIVE_MAX_DURATION_MIN = 60;

router.post("/trip/:tripId/location", express.json(), async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (Number.isNaN(tripId)) return res.status(400).json({ error: "invalid trip id" });

  const { lat, lng, accuracy } = req.body || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat, lng required" });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: "coords out of range" });
  }

  const member = await db.one(
    `SELECT * FROM members WHERE trip_id = $1 AND line_user_id = $2`,
    [tripId, req.lineUser.userId]
  );
  if (!member) return res.status(403).json({ error: "not a member" });

  const trip = await db.one(`SELECT * FROM trips WHERE id = $1`, [tripId]);
  if (!trip) return res.status(404).json({ error: "trip not found" });
  if (trip.status !== "active") return res.status(409).json({ error: "trip not active" });

  // rate limit per member
  const rateKey = `m:${member.id}`;
  const last = liveRateMap.get(rateKey) || 0;
  const now = Date.now();
  if (now - last < LIVE_MIN_INTERVAL_MS) {
    return res.status(429).json({ error: "too fast", retry_after_ms: LIVE_MIN_INTERVAL_MS - (now - last) });
  }
  liveRateMap.set(rateKey, now);

  try {
    const result = await locationProcessor.processLocation(
      trip, member, lat, lng,
      { source: "liff", accuracy: accuracy || null }
    );
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({
      ok: true,
      distance_km: result.distance_km,
      arrived: result.arrived,
      break_ended: result.break_ended
    });
  } catch (err) {
    logger.error({ err: err.message, tripId, memberId: member.id }, "location update failed");
    res.status(500).json({ error: "location update failed" });
  }
});

// POST /trip/:tripId/live-share/start — เริ่ม live share session
router.post("/trip/:tripId/live-share/start", express.json(), async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (Number.isNaN(tripId)) return res.status(400).json({ error: "invalid trip id" });

  const { duration_min } = req.body || {};
  const dur = parseInt(duration_min, 10);
  const finalDur = Number.isFinite(dur) && dur > 0 && dur <= LIVE_MAX_DURATION_MIN
    ? dur : LIVE_MAX_DURATION_MIN;

  const member = await db.one(
    `SELECT * FROM members WHERE trip_id = $1 AND line_user_id = $2`,
    [tripId, req.lineUser.userId]
  );
  if (!member) return res.status(403).json({ error: "not a member" });

  const liveUntil = new Date(Date.now() + finalDur * 60_000);
  await db.query(
    `UPDATE members SET live_share_started_at = now(), live_share_until = $1 WHERE id = $2`,
    [liveUntil, member.id]
  );

  res.json({ ok: true, live_share_until: liveUntil, duration_min: finalDur });
});

// POST /trip/:tripId/live-share/stop — หยุด live share
router.post("/trip/:tripId/live-share/stop", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (Number.isNaN(tripId)) return res.status(400).json({ error: "invalid trip id" });

  const member = await db.one(
    `SELECT id FROM members WHERE trip_id = $1 AND line_user_id = $2`,
    [tripId, req.lineUser.userId]
  );
  if (!member) return res.status(403).json({ error: "not a member" });

  await db.query(
    `UPDATE members SET live_share_until = NULL, live_share_started_at = NULL WHERE id = $1`,
    [member.id]
  );
  res.json({ ok: true });
});


/* 🆕 v4.0: Share token management (leader only) */

router.post("/trip/:tripId/share-tokens", express.json(), async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (Number.isNaN(tripId)) return res.status(400).json({ error: "invalid trip id" });
  const leader = await db.one(
    `SELECT * FROM members WHERE trip_id = $1 AND line_user_id = $2`,
    [tripId, req.lineUser.userId]
  );
  if (!leader) return res.status(403).json({ error: "not a member" });
  if (!leader.is_leader) return res.status(403).json({ error: "leader only" });
  const trip = await db.one(`SELECT id, status FROM trips WHERE id = $1`, [tripId]);
  if (!trip) return res.status(404).json({ error: "trip not found" });
  if (trip.status !== "active") return res.status(409).json({ error: "trip not active" });

  try {
    const result = await shareToken.createToken(trip, leader, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, token: result.token });
  } catch (err) {
    logger.error({ err: err.message, tripId }, "create share token failed");
    res.status(500).json({ error: "create share token failed" });
  }
});

router.get("/trip/:tripId/share-tokens", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (Number.isNaN(tripId)) return res.status(400).json({ error: "invalid trip id" });
  const m = await db.one(
    `SELECT is_leader FROM members WHERE trip_id = $1 AND line_user_id = $2`,
    [tripId, req.lineUser.userId]
  );
  if (!m) return res.status(403).json({ error: "not a member" });
  if (!m.is_leader) return res.status(403).json({ error: "leader only" });

  const tokens = await shareToken.listTokens(tripId);
  res.json({ tokens });
});

router.delete("/trip/:tripId/share-tokens/:tokenId", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  const tokenId = parseInt(req.params.tokenId, 10);
  if (Number.isNaN(tripId) || Number.isNaN(tokenId)) {
    return res.status(400).json({ error: "invalid id" });
  }
  const leader = await db.one(
    `SELECT * FROM members WHERE trip_id = $1 AND line_user_id = $2`,
    [tripId, req.lineUser.userId]
  );
  if (!leader) return res.status(403).json({ error: "not a member" });
  if (!leader.is_leader) return res.status(403).json({ error: "leader only" });

  try {
    const result = await shareToken.revokeToken(tripId, tokenId, leader);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err: err.message, tripId, tokenId }, "revoke token failed");
    res.status(500).json({ error: "revoke failed" });
  }
});

router.use((req, res) => res.status(404).json({ error: "not found" }));
router.use((err, req, res, _next) => {
  logger.error({ err: err.message, path: req.path }, "api error");
  res.status(500).json({ error: "internal error" });
});

module.exports = router;
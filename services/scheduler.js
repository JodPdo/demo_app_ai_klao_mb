// Scheduler

const cron = require("node-cron");
const db = require("../lib/db");
const logger = require("../lib/logger");
const { client } = require("../lib/lineClient");
const { extractLineTarget } = require("../utils/lineTarget");
const safety = require("./safety");
const groupBreak = require("./groupBreak");
const {
  formatLeaderboard,
  STALE_THRESHOLD_MIN
} = require("../utils/pushFormatter");

const TICK_CRON = process.env.SCHEDULER_TICK || "*/5 * * * *";
const TIMEZONE = process.env.TIMEZONE || "Asia/Bangkok";
const MONTHLY_PUSH_LIMIT = parseInt(process.env.MONTHLY_PUSH_LIMIT || "200", 10);
const ALLOWED_INTERVALS = [60, 120, 180, 240];
const DEFAULT_INTERVAL = 60;

/* QUOTA */
function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
async function getQuotaUsed() {
  const ym = getCurrentMonth();
  const row = await db.one(`SELECT count FROM quota_counter WHERE ym = $1`, [ym]);
  return row ? row.count : 0;
}
async function incrementQuota() {
  const ym = getCurrentMonth();
  await db.query(
    `INSERT INTO quota_counter (ym, count) VALUES ($1, 1)
     ON CONFLICT (ym) DO UPDATE SET count = quota_counter.count + 1`,
    [ym]
  );
}
async function getQuotaSummary() {
  const used = await getQuotaUsed();
  return {
    used,
    limit: MONTHLY_PUSH_LIMIT,
    remaining: Math.max(0, MONTHLY_PUSH_LIMIT - used),
    pct: Math.min(100, Math.round((used / MONTHLY_PUSH_LIMIT) * 100))
  };
}

/* HELPERS */
async function getTripLeaderboard(tripId) {
  return db.many(
    `
    SELECT
      m.id           AS member_id,
      m.display_name,
      m.is_leader,
      m.arrived_at,
      m.break_until,
      m.break_reason,
      l.distance_km,
      l.latitude, l.longitude,
      l.created_at   AS location_at,
      EXTRACT(EPOCH FROM (now() - l.created_at)) / 60.0 AS minutes_ago
    FROM members m
    LEFT JOIN LATERAL (
      SELECT id, latitude, longitude, distance_km, created_at
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
}

async function pushTripUpdate(trip, intervalMin) {
  const target = extractLineTarget(trip.line_group_id);
  if (!target) return { status: "failed", error: "no target" };

  const rows = await getTripLeaderboard(trip.id);
  const fresh = rows.filter(
    (r) => r.distance_km != null && r.minutes_ago <= STALE_THRESHOLD_MIN
  );
  if (fresh.length === 0) return { status: "skipped_stale" };

  const text = formatLeaderboard(trip, rows, intervalMin);

  try {
    await client.pushMessage({ to: target, messages: [{ type: "text", text }] });
    await incrementQuota();
    return { status: "success" };
  } catch (err) {
    const statusCode = err?.statusCode || err?.status;
    if (statusCode === 403 || statusCode === 404) {
      await db.query(
        `UPDATE trips SET status = 'archived', cancelled_at = now() WHERE id = $1`,
        [trip.id]
      );
      logger.warn({ tripId: trip.id, statusCode }, "trip auto-archived");
      return { status: "failed", error: `auto-archived (${statusCode})` };
    }
    logger.error({ err: err.message, tripId: trip.id }, "push failed");
    return { status: "failed", error: err.message };
  }
}

/* TICK */
async function tick() {
  // 1. Safety stale alerts
  try {
    const n = await safety.checkStaleMembers();
    if (n > 0) logger.info({ n }, "safety stale alerts sent");
  } catch (err) {
    logger.error({ err: err.message }, "stale check failed");
  }

  try {
    const r = await safety.checkBreakExpiry();
    if (r.remindersSent > 0 || r.expiredCleared > 0) {
      logger.info(r, "break tick");
    }
  } catch (err) {
    logger.error({ err: err.message }, "break check failed");
  }

  try {
    const n = await groupBreak.clearExpiredGroupBreaks();
    if (n > 0) logger.info({ n }, "group break tick");
  } catch (err) {
    logger.error({ err: err.message }, "group break check failed");
  }

  // 2. Push leaderboard
  const used = await getQuotaUsed();
  if (used >= MONTHLY_PUSH_LIMIT) {
    logger.warn({ used, limit: MONTHLY_PUSH_LIMIT }, "monthly quota reached");
    return;
  }

  const candidates = await db.many(
    `
    SELECT t.*, n.interval_min, n.last_pushed_at
    FROM notification_settings n
    JOIN trips t ON t.id = n.trip_id
    WHERE n.enabled = true
      AND t.status = 'active'
      AND t.dest_lat IS NOT NULL
    `
  );

  for (const trip of candidates) {
    if ((await getQuotaUsed()) >= MONTHLY_PUSH_LIMIT) break;
    if (trip.last_pushed_at) {
      const lastMs = new Date(trip.last_pushed_at).getTime();
      const dueMs = lastMs + trip.interval_min * 60 * 1000;
      if (Date.now() < dueMs) continue;
    }
    const result = await pushTripUpdate(trip, trip.interval_min);
    await db.query(
      `INSERT INTO push_log (trip_id, status, error_message)
       VALUES ($1, $2, $3)`,
      [trip.id, result.status, result.error || null]
    );
    if (result.status !== "failed") {
      await db.query(
        `UPDATE notification_settings SET last_pushed_at = now() WHERE trip_id = $1`,
        [trip.id]
      );
    }
    logger.info(
      { tripId: trip.id, status: result.status, intervalMin: trip.interval_min },
      "scheduler tick"
    );
  }
}

let task = null;

function start() {
  if (process.env.DISABLE_SCHEDULER === "true") {
    logger.info("scheduler disabled");
    return;
  }
  task = cron.schedule(
    TICK_CRON,
    () => tick().catch((err) => logger.error({ err: err.message }, "tick error")),
    { timezone: TIMEZONE }
  );
  logger.info(
    { cron: TICK_CRON, timezone: TIMEZONE, monthlyLimit: MONTHLY_PUSH_LIMIT },
    "📅 scheduler started (with safety + break tick)"
  );
}

function stop() { if (task) task.stop(); }

module.exports = {
  start, stop, tick, pushTripUpdate, getTripLeaderboard, getQuotaSummary,
  ALLOWED_INTERVALS, DEFAULT_INTERVAL, STALE_THRESHOLD_MIN
};

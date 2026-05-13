// AiKlao Bot v3.0 — Express + LINE webhook + REST API + LIFF static + Scheduler
//
// Architecture:
//   /webhook        → LINE Messaging API (raw body)
//   /api/*          → REST API for LIFF (json)
//   /liff/*         → static LIFF Web App (Leaflet map)
//   /healthz        → health check (Docker / Render)

require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const path = require("path");
const line = require("@line/bot-sdk");

const db = require("./lib/db");
const logger = require("./lib/logger");
const scheduler = require("./services/scheduler");
const { handleEvent } = require("./handlers/webhook");
const apiRoutes = require("./routes/api");

const app = express();

// 🆕 v3.6 fix: trust proxy (ngrok / nginx / cloudflare set X-Forwarded-For)
// ป้องกัน express-rate-limit ValidationError + ใช้ IP ที่ถูกต้อง
app.set("trust proxy", 1);

// ✅ Security headers — disable CSP สำหรับ LIFF เพราะต้องโหลด external (Leaflet, LIFF SDK)
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

const lineConfig = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
};

/* =========================
   🩺 HEALTH CHECK (no deps)
========================= */
app.get("/healthz", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

/* =========================
   🤖 LINE WEBHOOK (raw body)
========================= */
app.post(
  "/webhook",
  line.middleware(lineConfig),
  async (req, res) => {
    try {
      await Promise.all(req.body.events.map(handleEvent));
      res.status(200).end();
    } catch (err) {
      logger.error(
        { err: err.message, stack: err.stack },
        "webhook error"
      );
      res.status(500).end();
    }
  }
);

/* =========================
   📡 REST API + 🌍 LIFF static
========================= */

// 🆕 v3.6 fix: /liff static FIRST (with no-cache) — ลำดับสำคัญ
//   express middleware เป็น first-match — ถ้าเอา /liff หลัง /public ทั่วไป
//   request `/liff/*` จะถูก served ด้วย /public ก่อน (no setHeaders) ทำให้ cache fix ไม่ทำงาน
app.use("/liff", express.static(path.join(__dirname, "public", "liff"), {
  etag: false,
  lastModified: false,
  setHeaders: (res, p) => {
    if (p.endsWith(".html") || p.endsWith(".js") || p.endsWith(".css")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  }
}));

// 🆕 v4.0: /watch static (public viewer — no auth, no cache)
app.use("/watch", express.static(path.join(__dirname, "public", "watch"), {
  etag: false,
  lastModified: false,
  setHeaders: (res, p) => {
    if (p.endsWith(".html") || p.endsWith(".js") || p.endsWith(".css")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  }
}));

// /watch/:token → ส่ง index.html (SPA — JS อ่าน token จาก URL)
app.get("/watch/:token", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "watch", "index.html"));
});

// 🆕 v4.0 fix: PUBLIC /api/watch/:token — register ที่ app level
// (เพราะ /api/watch/:token ใน router/api.js โดน middleware chain กั้น)
const shareToken = require("./services/shareToken");
const eta = require("./services/eta");
const dbForWatch = require("./lib/db");

app.get("/share/:token", async (req, res) => {
  try {
    const v = await shareToken.validateToken(req.params.token);
    if (!v.ok) return res.status(404).json({ error: v.error });
    const { share } = v;

    const trip = await dbForWatch.one(
      `SELECT id, name, dest_lat, dest_lng, dest_name, status,
              stale_threshold_min, all_arrived_at, created_at,
              group_break_until, group_break_started_by,
              group_break_reason, group_break_started_at
       FROM trips WHERE id = $1`,
      [share.trip_id]
    );
    if (!trip) return res.status(404).json({ error: "trip not found" });

    const members = await dbForWatch.many(
      `SELECT
         m.id, m.display_name, m.picture_url, m.is_leader, m.arrived_at,
         m.break_until, m.break_reason, m.break_started_at,
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
         l.distance_km ASC NULLS LAST`,
      [share.trip_id]
    );

    await eta.attachETAs(trip, members);
    shareToken.recordView(share.id).catch(() => {});

    res.json({
      trip: shareToken.applyTripPrivacy(trip, share.privacy_mode),
      members: shareToken.applyPrivacy(members, share.privacy_mode),
      share: {
        label: share.label,
        privacy_mode: share.privacy_mode,
        expires_at: share.expires_at
      }
    });
  } catch (err) {
    logger.error({ err: err.message, token: req.params.token }, "watch failed");
    res.status(500).json({ error: "internal error" });
  }
});

app.use("/api", apiRoutes);

// fallback: favicon และ static อื่น ๆ ใน public/ (ที่ไม่ใช่ /liff)
app.use(express.static(path.join(__dirname, "public")));

// Root → redirect ไป LIFF
app.get("/", (_req, res) => res.redirect("/liff/"));

/* =========================
   🚀 STARTUP
========================= */

const PORT = parseInt(process.env.PORT || "3001", 10);

async function start() {
  await db.init();
  app.listen(PORT, () => {
    logger.info({ port: PORT }, "🚀 อ้ายคล้าว server started");
    scheduler.start();
  });
}

// Graceful shutdown
async function shutdown(signal) {
  logger.info({ signal }, "shutting down...");
  scheduler.stop();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((err) => {
  logger.error({ err: err.message, stack: err.stack }, "fatal startup error");
  process.exit(1);
});
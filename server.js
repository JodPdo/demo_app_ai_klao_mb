// AiKlao Mobile Backend Service (aiklao_mb)
//
// Standalone Express service for mobile app endpoints
// Routes:
//   POST /api/mobile/auth            — login (LINE id_token → JWT)
//   GET  /api/mobile/oauth/callback  — OAuth callback (LINE → aiklao:// deep link)
//   GET  /api/mobile/me              — current user profile (JWT-protected)
//   GET  /healthz                    — health check
//
// Port: 3002 (configured via PORT env)

require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const pinoHttp = require("pino-http");

const db = require("./lib/db");
const logger = require("./lib/logger");
const jwtAuth = require("./middleware/jwtAuth");
const mobileAuth = require("./routes/mobileAuth");
const oauthCallback = require("./routes/oauthCallback");
const mobileMe = require("./routes/mobileMe");

const app = express();
app.set("trust proxy", 1);

app.use(helmet());

app.use(
  cors({
    origin: true,
    credentials: false,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

app.use(
  pinoHttp({
    logger,
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    serializers: {
      req: (req) => ({ method: req.method, url: req.url, id: req.id }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  })
);

app.use(express.json({ limit: "10kb" }));

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/* =========================
   🩺 HEALTH CHECK
========================= */
app.get("/healthz", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({
      ok: true,
      service: "aiklao_mb",
      version: require("./package.json").version,
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

/* =========================
   📡 PUBLIC ROUTES
========================= */
// POST /api/mobile/auth — login (exchange id_token for JWT)
app.use("/api/mobile/auth", mobileAuth);

// GET /api/mobile/oauth/callback — receives LINE OAuth code, redirects to app via aiklao://
app.use("/api/mobile/oauth", oauthCallback);

/* =========================
   🔐 PROTECTED ROUTES
========================= */
app.use("/api/mobile", jwtAuth, mobileMe);

/* =========================
   ❌ 404 + Error handler
========================= */
app.use((req, res) => {
  res.status(404).json({ error: "not_found", path: req.path });
});

app.use((err, req, res, _next) => {
  logger.error({ err: err.message, stack: err.stack }, "unhandled error");
  res.status(500).json({ error: "internal_error" });
});

/* =========================
   🚀 STARTUP
========================= */
const PORT = parseInt(process.env.PORT || "3002", 10);

async function start() {
  await db.init();
  app.listen(PORT, () => {
    logger.info({ port: PORT, service: "aiklao_mb" }, "🚀 aiklao_mb server started");
  });
}

async function shutdown(signal) {
  logger.info({ signal }, "shutting down...");
  await db.close();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((err) => {
  logger.error({ err: err.message, stack: err.stack }, "fatal startup error");
  process.exit(1);
});

module.exports = { app };

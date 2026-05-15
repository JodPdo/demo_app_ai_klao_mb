// routes/mobileAuth.js
// POST /api/mobile/auth — exchange LINE id_token for app JWT
//
// Flow:
//   1. Mobile app runs LINE Login OAuth → gets id_token
//   2. App POSTs { idToken } to this endpoint
//   3. We verify id_token against LINE (using LINE's verify endpoint)
//   4. We upsert user in our DB
//   5. We sign + return our own JWT
//
// Mount in server.js:
//   const mobileAuth = require("./routes/mobileAuth");
//   app.use("/api/mobile/auth", mobileAuth);

const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../lib/db");
const logger = require("../lib/logger");

const router = express.Router();

const LINE_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID;
const MOBILE_JWT_SECRET = process.env.MOBILE_JWT_SECRET;
const JWT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const LINE_VERIFY_ENDPOINT = "https://api.line.me/oauth2/v2.1/verify";

/**
 * Verify id_token via LINE's verify endpoint
 * Docs: https://developers.line.biz/en/reference/line-login/#verify-id-token
 *
 * Returns decoded claims if valid, throws otherwise
 */
async function verifyLineIdToken(idToken) {
  const params = new URLSearchParams({
    id_token: idToken,
    client_id: LINE_CHANNEL_ID,
  });

  const resp = await fetch(LINE_VERIFY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error(`LINE verify failed: ${resp.status} ${text}`);
    err.code = "LINE_VERIFY_FAILED";
    throw err;
  }

  const claims = await resp.json();
  // claims: { iss, sub, aud, exp, iat, nonce?, name?, picture? }
  if (claims.aud !== LINE_CHANNEL_ID) {
    const err = new Error("audience mismatch");
    err.code = "AUD_MISMATCH";
    throw err;
  }
  return claims;
}

router.post("/", express.json(), async (req, res) => {
  if (!LINE_CHANNEL_ID || !MOBILE_JWT_SECRET) {
    logger.error("[mobile-auth] missing LINE_LOGIN_CHANNEL_ID or MOBILE_JWT_SECRET");
    return res.status(500).json({ error: "server_misconfigured" });
  }

  const { idToken } = req.body || {};
  if (!idToken || typeof idToken !== "string") {
    return res.status(400).json({ error: "missing_id_token" });
  }

  // 1. Verify id_token with LINE
  let claims;
  try {
    claims = await verifyLineIdToken(idToken);
  } catch (err) {
    logger.warn({ reqId: req.id, err: err.message }, "[mobile-auth] verify failed");
    return res.status(401).json({ error: "invalid_id_token" });
  }

  const lineUserId = claims.sub;
  const displayName = claims.name || "ผู้ใช้ AiKlao";
  const pictureUrl = claims.picture || null;

  // 2. Upsert user (assumes `users` table — adjust to your schema)
  let user;
  try {
    const result = await db.query(
      `
      INSERT INTO users (line_user_id, display_name, picture_url, last_login_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (line_user_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        picture_url = EXCLUDED.picture_url,
        last_login_at = NOW()
      RETURNING id, line_user_id, display_name, picture_url
      `,
      [lineUserId, displayName, pictureUrl],
    );
    user = result.rows[0];
  } catch (err) {
    logger.error({ reqId: req.id, err: err.message }, "[mobile-auth] user upsert failed");
    return res.status(500).json({ error: "db_error" });
  }

  // 3. Sign our JWT
  const token = jwt.sign(
    {
      lineUserId: user.line_user_id,
      displayName: user.display_name,
    },
    MOBILE_JWT_SECRET,
    {
      subject: String(user.id),
      issuer: "aiklao",
      audience: "aiklao-mobile",
      expiresIn: JWT_TTL_SECONDS,
    },
  );

  logger.info(
    { reqId: req.id, userId: user.id, lineUserId },
    "[mobile-auth] login success",
  );

  return res.json({
    token,
    expiresIn: JWT_TTL_SECONDS,
    user: {
      id: String(user.id),
      lineUserId: user.line_user_id,
      displayName: user.display_name,
      pictureUrl: user.picture_url,
    },
  });
});

module.exports = router;

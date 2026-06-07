// routes/mobileInvite.js
// Phase 6.4a — invite-link growth loop.
// Leader generates a short read-safe token bound to a trip; anyone with a
// valid (≤7-day) token can join via LIFF or mobile.
//
// Mounted in server.js (per-route auth inside, mirrors mobileTrips.js):
//   app.use("/api/mobile", mobileInvite);   <- POST /trips/:id/invite (jwtAuth)
//                                              POST /invite/:token/join (dualAuth)
//   app.use("/api/public", publicInvite);   <- GET  /invite/:token (no auth)
//
// MUST be mounted BEFORE app.use("/api/mobile", jwtAuth, mobileMe) or that
// guard would 401 the invite routes.

const express = require("express");
const db = require("../lib/db");
const logger = require("../lib/logger");
const { generateInviteToken } = require("../lib/token");
const jwtAuth = require("../middleware/jwtAuth");
const dualAuth = require("../middleware/dualAuth");

const mobileInvite = express.Router();
const publicInvite = express.Router();

// LIFF deep link for the invite accept page. AppProperties/env exposes LIFF_ID
// (no LIFF_URL in app code) — construct the URL the same way utils/flexMessage.js does.
function buildInviteLink(token) {
  return `https://liff.line.me/${process.env.LIFF_ID}?invite=${token}`;
}

// ---- POST /api/mobile/trips/:id/invite (jwtAuth, leader-only) ---------------
// Create OR reuse the active invite for a trip (Decision #4: route-enforced
// reuse, not a DB uniqueness constraint).

mobileInvite.post("/trips/:id/invite", jwtAuth, async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tripId)) return res.status(400).json({ error: "invalid_trip_id" });

  try {
    const member = await db.one(
      `SELECT id, is_leader FROM members WHERE trip_id = $1 AND line_user_id = $2`,
      [tripId, req.user.lineUserId]
    );
    if (!member) return res.status(403).json({ error: "not_member" });
    if (!member.is_leader) return res.status(403).json({ error: "not_leader" });

    const trip = await db.one(`SELECT id, status FROM trips WHERE id = $1`, [tripId]);
    if (!trip) return res.status(404).json({ error: "trip_not_found" });
    if (trip.status !== "active") return res.status(410).json({ error: "trip_not_active" });

    // Reuse the newest still-active invite for this trip; else create a new one.
    let invite = await db.one(
      `SELECT id, token, expires_at, redeemed_count FROM trip_invites
       WHERE trip_id = $1 AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [tripId]
    );
    if (!invite) {
      invite = await db.one(
        `INSERT INTO trip_invites (trip_id, token, created_by_member_id, expires_at)
         VALUES ($1, $2, $3, now() + interval '7 days')
         RETURNING id, token, expires_at, redeemed_count`,
        [tripId, generateInviteToken(), member.id]
      );
    }

    return res.json({
      ok: true,
      token: invite.token,
      code: invite.token, // V1: code === token (both from the read-safe alphabet)
      link: buildInviteLink(invite.token),
      expires_at: invite.expires_at,
      redeemed_count: invite.redeemed_count,
    });
  } catch (err) {
    logger.error({ reqId: req.id, err: err.message }, "[invite] create failed");
    return res.status(500).json({ error: "db_error" });
  }
});

// ---- GET /api/public/invite/:token (no auth) -------------------------------
// Preview trip info for the LIFF accept page before login. Never leaks data
// for expired / archived invites.

publicInvite.get("/invite/:token", async (req, res) => {
  try {
    const row = await db.one(
      `SELECT i.expires_at, t.id AS trip_id, t.name, t.status, t.dest_name,
              (SELECT COUNT(*) FROM members WHERE trip_id = t.id)::int AS member_count
       FROM trip_invites i
       JOIN trips t ON t.id = i.trip_id
       WHERE i.token = $1`,
      [req.params.token]
    );
    if (!row) return res.json({ valid: false, expired: false, trip: null });
    if (new Date(row.expires_at) <= new Date()) {
      return res.json({ valid: false, expired: true, trip: null });
    }
    if (row.status !== "active") {
      return res.json({ valid: false, expired: false, trip: null });
    }
    return res.json({
      valid: true,
      expired: false,
      trip: {
        id: String(row.trip_id),
        name: row.name,
        member_count: row.member_count,
        dest_name: row.dest_name,
      },
    });
  } catch (err) {
    logger.error({ reqId: req.id, err: err.message }, "[invite] preview failed");
    return res.status(500).json({ error: "db_error" });
  }
});

// ---- POST /api/mobile/invite/:token/join (dualAuth) ------------------------
// Redeem a token and become a member. Idempotent — already-member returns ok.

mobileInvite.post("/invite/:token/join", dualAuth, async (req, res) => {
  const token = req.params.token;
  try {
    const invite = await db.one(
      `SELECT i.trip_id, i.expires_at, t.name AS trip_name, t.status
       FROM trip_invites i
       JOIN trips t ON t.id = i.trip_id
       WHERE i.token = $1`,
      [token]
    );
    if (!invite) return res.status(404).json({ error: "invite not found" });
    if (new Date(invite.expires_at) <= new Date()) {
      return res.status(410).json({ error: "invite expired" });
    }
    if (invite.status !== "active") {
      return res.status(410).json({ error: "trip not active" });
    }

    const existing = await db.one(
      `SELECT id FROM members WHERE trip_id = $1 AND line_user_id = $2`,
      [invite.trip_id, req.user.lineUserId]
    );
    if (existing) {
      return res.json({
        ok: true,
        trip_id: String(invite.trip_id),
        member_id: String(existing.id),
        trip_name: invite.trip_name,
        was_already_member: true,
      });
    }

    const result = await db.tx(async (q) => {
      const u = await q(
        `SELECT display_name, picture_url FROM users WHERE line_user_id = $1`,
        [req.user.lineUserId]
      );
      const user = u.rows[0];
      const ins = await q(
        `INSERT INTO members (trip_id, line_user_id, display_name, picture_url, is_leader)
         VALUES ($1, $2, $3, $4, false)
         RETURNING id`,
        [
          invite.trip_id,
          req.user.lineUserId,
          user ? user.display_name : (req.user.displayName || null),
          user ? user.picture_url : null,
        ]
      );
      await q(
        `UPDATE trip_invites SET redeemed_count = redeemed_count + 1 WHERE token = $1`,
        [token]
      );
      return { memberId: ins.rows[0].id };
    });

    return res.json({
      ok: true,
      trip_id: String(invite.trip_id),
      member_id: String(result.memberId),
      trip_name: invite.trip_name,
      was_already_member: false,
    });
  } catch (err) {
    logger.error({ reqId: req.id, err: err.message }, "[invite] join failed");
    return res.status(500).json({ error: "db_error" });
  }
});

module.exports = { mobileInvite, publicInvite };

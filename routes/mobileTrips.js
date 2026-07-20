// routes/mobileTrips.js
// Trip endpoints for mobile app and LIFF WebView (Phase 5.2 + Phase 5.6 dualAuth)
//
// Mounted in server.js:
//   app.use("/api/mobile/trips", mobileTrips);  <- per-route auth inside this file
//
// req.user = { id, lineUserId, displayName, source: 'mobile'|'liff' }
// injected by jwtAuth (mobile) or dualAuth (LIFF)

const express = require("express");
const db = require("../lib/db");
const logger = require("../lib/logger");
const { getDistance } = require("../utils/distance");
const { buildSosFlex, buildArrivalFlex } = require("../utils/flexMessage");
const jwtAuth = require("../middleware/jwtAuth");
const dualAuth = require("../middleware/dualAuth");

const router = express.Router();

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

// Phase 6.5 — arrival detection thresholds
const ARRIVAL_RADIUS_M = 100;   // within this distance of destination = arrived
const MAX_ACCURACY_M = 50;      // skip arrival if GPS accuracy worse than this (or null)

// Per-member location rate limit — mirrors the Java backend's
// LocationService.process (12s minimum between updates per member).
const LOCATION_MIN_INTERVAL_SEC = 12;

// Push a single Flex message to one LINE user. Resolves on 2xx, rejects otherwise.
// Mirrors routes/lineNotify.js (Phase 5.6 B+) — no shared lib helper exists.
async function pushFlexToLine(lineUserId, flexMessage) {
  const token = process.env.CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("CHANNEL_ACCESS_TOKEN not set");
  const res = await fetch(LINE_PUSH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: lineUserId, messages: [flexMessage] }),
    signal: AbortSignal.timeout(5000),   // SEC-004 — 5s timeout
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LINE push ${res.status}: ${text}`);
  }
  return true;
}

/**
 * Phase 6.5 — per-member arrival detection. Called inside the POST /location
 * db.tx, after the location insert. Idempotent (WHERE arrived_at IS NULL).
 *
 * @param q       tx query fn
 * @param tripId  number
 * @param member  { id, arrived_at } row
 * @param lat,lng number — the just-posted coordinates
 * @param accuracyM number|null — GPS accuracy (from req.body.accuracy)
 * @param userId  number — users.id (req.user.id), for SOS auto-cancel
 */
async function checkArrival(q, tripId, member, lat, lng, accuracyM, userId) {
  if (member.arrived_at !== null) return { arrived: false, reason: "already_arrived" };

  // GPS accuracy guard — fail-safe on null or > 50m (avoids false arrivals)
  if (accuracyM == null || accuracyM > MAX_ACCURACY_M) {
    return { arrived: false, reason: "poor_accuracy", accuracyM };
  }

  const tripRes = await q(`SELECT dest_lat, dest_lng, name FROM trips WHERE id = $1`, [tripId]);
  const trip = tripRes.rows[0];
  if (!trip || trip.dest_lat == null || trip.dest_lng == null) {
    return { arrived: false, reason: "no_destination" };
  }

  // getDistance returns kilometres → convert to metres
  const distanceM = getDistance(lat, lng, trip.dest_lat, trip.dest_lng) * 1000;
  if (distanceM > ARRIVAL_RADIUS_M) return { arrived: false, distanceM };

  // Race-safe mark: only the POST that flips NULL→now() "wins"
  const updated = await q(
    `UPDATE members SET arrived_at = now()
     WHERE id = $1 AND arrived_at IS NULL
     RETURNING arrived_at`,
    [member.id]
  );
  if (updated.rowCount === 0) return { arrived: false, reason: "race_loss" };

  // Auto-cancel any active SOS for this user on this trip. members has no
  // user_id column, so we use userId (= req.user.id = users.id) to match
  // sos_events.user_id (FK to users.id).
  const sosCanceled = await q(
    `UPDATE sos_events SET cancelled_at = now(), cancelled_by = $1
     WHERE trip_id = $2 AND user_id = $1 AND cancelled_at IS NULL
     RETURNING id`,
    [userId, tripId]
  );

  return {
    arrived: true,
    arrivedAt: updated.rows[0].arrived_at,
    distanceM,
    tripName: trip.name,
    sosAutoCancelled: sosCanceled.rows.map(r => String(r.id)),
  };
}

/**
 * Phase 6.5 — best-effort LINE push to OTHER members when someone arrives.
 * Fires outside the TX (push failure must not roll back the arrival).
 */
async function sendArrivalPush(tripId, user, arrivalResult) {
  const recipients = await db.many(
    `SELECT line_user_id FROM members
     WHERE trip_id = $1 AND line_user_id <> $2 AND line_user_id IS NOT NULL`,
    [tripId, user.lineUserId]
  );
  if (recipients.length === 0) return;

  const timeHHMM = new Date(arrivalResult.arrivedAt).toLocaleTimeString("th-TH", {
    timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const flex = buildArrivalFlex({
    memberName: user.displayName || "สมาชิก",
    tripName: arrivalResult.tripName,
    tripId: String(tripId),
    timeHHMM,
  });

  const results = await Promise.allSettled(
    recipients.map(r => pushFlexToLine(r.line_user_id, flex))
  );
  const failed = results.filter(r => r.status === "rejected").length;
  if (failed > 0) {
    logger.warn({ tripId, failed, total: recipients.length }, "[arrival] some pushes failed");
  }
}

// ---- POST /api/mobile/trips/start ------------------------------------------

router.post("/start", jwtAuth, async (req, res) => {
  const { name, destination } = req.body || {};

  let destLat = null, destLng = null, destName = null;
  if (destination !== undefined && destination !== null) {
    const lat = Number(destination.lat);
    const lng = Number(destination.lng);
    if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: "invalid_destination" });
    }
    destLat = lat;
    destLng = lng;
    destName = typeof destination.name === "string" ? destination.name.trim() || null : null;
  }

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
  const tripName = (typeof name === "string" && name.trim()) ? name.trim() : `My Trip ${today}`;

  // trips.name has a DB check constraint: 1 <= length <= 50
  if (tripName.length > 50) {
    return res.status(400).json({ error: "name_too_long" });
  }

  // Fresh user fetch -- JWT is 30-day TTL, display_name may have changed since login
  let user;
  try {
    const r = await db.query(
      `SELECT display_name, picture_url FROM users WHERE id = $1`,
      [req.user.id]
    );
    user = r.rows[0];
    if (!user) return res.status(404).json({ error: "user_not_found" });
  } catch (err) {
    logger.error({ reqId: req.id, err: err.message }, "[mobile-trips] user fetch failed");
    return res.status(500).json({ error: "db_error" });
  }

  let trip, member;
  try {
    const result = await db.tx(async (q) => {
      const tripResult = await q(
        `INSERT INTO trips (name, status, dest_lat, dest_lng, dest_name)
         VALUES ($1, 'active', $2, $3, $4)
         RETURNING id, name, status, dest_lat, dest_lng, dest_name, created_at`,
        [tripName, destLat, destLng, destName]
      );
      const t = tripResult.rows[0];
      const memberResult = await q(
        `INSERT INTO members (trip_id, line_user_id, display_name, picture_url, is_leader)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id`,
        [t.id, req.user.lineUserId, user.display_name, user.picture_url]
      );
      return { trip: t, member: memberResult.rows[0] };
    });
    trip = result.trip;
    member = result.member;
  } catch (err) {
    logger.error({ reqId: req.id, err: err.message }, "[mobile-trips] start trip failed");
    return res.status(500).json({ error: "db_error" });
  }

  return res.status(201).json({
    trip: {
      id: String(trip.id),
      name: trip.name,
      status: trip.status,
      destination: trip.dest_lat !== null
        ? { lat: trip.dest_lat, lng: trip.dest_lng, name: trip.dest_name }
        : null,
      createdAt: trip.created_at,
    },
    member: {
      id: String(member.id),
      isLeader: true,
    },
  });
});

// ---- GET /api/mobile/trips -------------------------------------------------

router.get("/", dualAuth, async (req, res) => {
  try {
    const rows = await db.many(
      `SELECT t.id, t.name, t.status, t.dest_lat, t.dest_lng, t.dest_name, t.created_at,
              (SELECT COUNT(*) FROM members WHERE trip_id = t.id)::int AS member_count,
              m.is_leader,
              (SELECT MAX(l.created_at) FROM locations l WHERE l.member_id = m.id) AS last_location_at
       FROM trips t
       JOIN members m ON m.trip_id = t.id AND m.line_user_id = $1
       ORDER BY t.created_at DESC
       LIMIT 50`,
      [req.user.lineUserId]
    );
    return res.json({
      trips: rows.map(r => ({
        id: String(r.id),
        name: r.name,
        status: r.status,
        destination: r.dest_lat !== null
          ? { lat: r.dest_lat, lng: r.dest_lng, name: r.dest_name }
          : null,
        createdAt: r.created_at,
        memberCount: r.member_count,
        isLeader: r.is_leader,
        lastLocationAt: r.last_location_at,
      })),
    });
  } catch (err) {
    logger.error({ reqId: req.id, err: err.message }, "[mobile-trips] list failed");
    return res.status(500).json({ error: "db_error" });
  }
});

// ---- GET /api/mobile/trips/:id ---------------------------------------------

router.get("/:id", dualAuth, async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tripId)) return res.status(400).json({ error: "invalid_trip_id" });

  try {
    const membership = await db.one(
      `SELECT m.id FROM members m WHERE m.trip_id = $1 AND m.line_user_id = $2`,
      [tripId, req.user.lineUserId]
    );
    if (!membership) return res.status(403).json({ error: "forbidden" });

    const trip = await db.one(
      `SELECT id, name, status, dest_lat, dest_lng, dest_name, created_at, all_arrived_at, ended_at
       FROM trips WHERE id = $1`,
      [tripId]
    );
    if (!trip) return res.status(404).json({ error: "trip_not_found" });

    const members = await db.many(
      `SELECT m.id, m.line_user_id, m.display_name, m.picture_url,
              m.is_leader, m.arrived_at, m.joined_at,
              l.latitude, l.longitude, l.distance_km, l.accuracy_m,
              l.created_at AS location_at
       FROM members m
       LEFT JOIN LATERAL (
         SELECT latitude, longitude, distance_km, accuracy_m, created_at
         FROM locations WHERE member_id = m.id
         ORDER BY created_at DESC LIMIT 1
       ) l ON true
       WHERE m.trip_id = $1
       ORDER BY m.is_leader DESC, m.joined_at ASC`,
      [tripId]
    );

    // Fetch leader location history for totalDistanceKm (capped at 500).
    // If leaderLocs.length === 500 the value may be under-counted for very long trips.
    const leaderLocs = await db.many(
      `SELECT l.latitude, l.longitude
       FROM locations l
       JOIN members m ON m.id = l.member_id
       WHERE l.trip_id = $1 AND m.is_leader = true
       ORDER BY l.created_at ASC
       LIMIT 500`,
      [tripId]
    );

    let totalDistanceKm = null;
    if (leaderLocs.length >= 2) {
      let total = 0;
      for (let i = 1; i < leaderLocs.length; i++) {
        total += getDistance(
          leaderLocs[i - 1].latitude, leaderLocs[i - 1].longitude,
          leaderLocs[i].latitude,     leaderLocs[i].longitude
        );
      }
      totalDistanceKm = parseFloat(total.toFixed(2));
    }

    const endTime = trip.ended_at ? new Date(trip.ended_at) : new Date();
    const durationSeconds = Math.floor(
      (endTime.getTime() - new Date(trip.created_at).getTime()) / 1000
    );

    const leaderMember = members.find(m => m.is_leader);
    const leaderLoc = (leaderMember?.latitude != null)
      ? { lat: leaderMember.latitude, lng: leaderMember.longitude }
      : null;

    // Active (uncancelled) SOS events for this trip. camelCase aliases so the
    // mobile client can consume directly (Phase 6.1A convention). Always an
    // array — never null/undefined (mobile does .find()/.map() on it).
    const activeSosRows = await db.many(
      `SELECT s.id, s.user_id AS "userId", u.display_name AS "displayName",
              u.picture_url AS "pictureUrl", s.lat, s.lng, s.triggered_at AS "triggeredAt"
       FROM sos_events s
       JOIN users u ON u.id = s.user_id
       WHERE s.trip_id = $1 AND s.cancelled_at IS NULL
       ORDER BY s.triggered_at DESC`,
      [tripId]
    );
    const activeSos = (activeSosRows ?? []).map(r => ({
      id: String(r.id),
      userId: String(r.userId),
      displayName: r.displayName,
      pictureUrl: r.pictureUrl || null,
      lat: r.lat,
      lng: r.lng,
      triggeredAt: r.triggeredAt,
    }));

    return res.json({
      activeSos,
      trip: {
        id: String(trip.id),
        name: trip.name,
        status: trip.status,
        destination: trip.dest_lat !== null
          ? { lat: trip.dest_lat, lng: trip.dest_lng, name: trip.dest_name }
          : null,
        createdAt: trip.created_at,
        allArrivedAt: trip.all_arrived_at || null,
        endedAt: trip.ended_at || null,
        durationSeconds,
        totalDistanceKm,
      },
      members: members.map(m => ({
        id: String(m.id),
        lineUserId: m.line_user_id,
        displayName: m.display_name,
        pictureUrl: m.picture_url || null,
        isLeader: m.is_leader,
        joinedAt: m.joined_at,
        arrivedAt: m.arrived_at || null,
        lastLocation: m.latitude !== null
          ? {
              lat: m.latitude,
              lng: m.longitude,
              distanceKm: m.distance_km,
              accuracyM: m.accuracy_m || null,
              distanceFromLeaderKm: m.is_leader
                ? 0.0
                : (leaderLoc
                    ? parseFloat(getDistance(m.latitude, m.longitude, leaderLoc.lat, leaderLoc.lng).toFixed(2))
                    : null),
              createdAt: m.location_at,
            }
          : null,
      })),
    });
  } catch (err) {
    logger.error({ reqId: req.id, err: err.message }, "[mobile-trips] get trip failed");
    return res.status(500).json({ error: "db_error" });
  }
});

// ---- POST /api/mobile/trips/:id/location -----------------------------------

router.post("/:id/location", jwtAuth, async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tripId)) return res.status(400).json({ error: "invalid_trip_id" });

  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: "invalid_lat_lng" });
  }

  const timestamp = typeof req.body?.timestamp === "string" ? req.body.timestamp : null;
  const accuracyM = (typeof req.body?.accuracy === "number" && isFinite(req.body.accuracy))
    ? req.body.accuracy : null;

  try {
    const trip = await db.one(
      `SELECT id, dest_lat, dest_lng FROM trips WHERE id = $1`,
      [tripId]
    );
    if (!trip) return res.status(404).json({ error: "trip_not_found" });

    const distanceKm = (trip.dest_lat !== null && trip.dest_lng !== null)
      ? getDistance(lat, lng, trip.dest_lat, trip.dest_lng)
      : null;

    // Atomic: member lookup + location INSERT + arrival mark + SOS auto-cancel.
    // A crash mid-sequence rolls back together (no half-applied arrival).
    const txResult = await db.tx(async (q) => {
      // Membership + arrived_at (members carries arrival state, keyed by line_user_id)
      const memberRes = await q(
        `SELECT id, arrived_at FROM members WHERE trip_id = $1 AND line_user_id = $2`,
        [tripId, req.user.lineUserId]
      );
      const member = memberRes.rows[0];
      if (!member) return { forbidden: true };

      // Per-member rate limit: reject if this member's last location row is
      // younger than LOCATION_MIN_INTERVAL_SEC. Mirrors the Java backend's
      // LocationService.process check -- runs before any write, and before
      // checkArrival, so a rate-limited request never touches the DB.
      const lastLocRes = await q(
        `SELECT created_at FROM locations WHERE member_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [member.id]
      );
      const lastLoc = lastLocRes.rows[0];
      if (lastLoc) {
        const elapsedSec = (Date.now() - new Date(lastLoc.created_at).getTime()) / 1000;
        if (elapsedSec < LOCATION_MIN_INTERVAL_SEC) {
          return { rateLimited: true };
        }
      }

      // locations.trip_id is NOT NULL -- include explicitly.
      // source='mobile' distinguishes from LINE bot locations (default 'line')
      const ins = await q(
        `INSERT INTO locations (trip_id, member_id, latitude, longitude, distance_km, accuracy_m, source, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'mobile', COALESCE($7::timestamptz, NOW()))
         RETURNING id`,
        [tripId, member.id, lat, lng, distanceKm, accuracyM, timestamp]
      );

      const arrival = await checkArrival(q, tripId, member, lat, lng, accuracyM, req.user.id);
      return { locationId: ins.rows[0].id, arrival };
    });

    if (txResult.forbidden) return res.status(403).json({ error: "forbidden" });
    if (txResult.rateLimited) return res.status(429).json({ error: "rate_limited" });

    res.status(201).json({ ok: true, locationId: String(txResult.locationId) });

    // Best-effort arrival push AFTER the response (must not delay /location).
    if (txResult.arrival.arrived) {
      setImmediate(() => {
        sendArrivalPush(tripId, req.user, txResult.arrival).catch((err) =>
          logger.warn({ reqId: req.id, err: err.message, tripId }, "[arrival] push failed")
        );
      });
    }
    return;
  } catch (err) {
    logger.error({ reqId: req.id, err: err.message }, "[mobile-trips] location push failed");
    return res.status(500).json({ error: "db_error" });
  }
});

// ---- POST /api/mobile/trips/:id/stop ---------------------------------------

router.post("/:id/stop", jwtAuth, async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tripId)) return res.status(400).json({ error: "invalid_trip_id" });

  try {
    const result = await db.query(
      `UPDATE trips SET status = 'archived', ended_at = now()
       WHERE id = $1
         AND status = 'active'
         AND EXISTS (
           SELECT 1 FROM members
           WHERE trip_id = $1 AND line_user_id = $2 AND is_leader = true
         )
       RETURNING id, status, ended_at`,
      [tripId, req.user.lineUserId]
    );

    if (result.rows.length > 0) {
      const { id, status, ended_at } = result.rows[0];
      return res.json({
        trip: {
          id: String(id),
          status,
          stoppedAt: ended_at,
          endedAt: ended_at,
        },
      });
    }

    // Distinguish: trip not found vs already archived vs user not leader
    const trip = await db.one(`SELECT id, status FROM trips WHERE id = $1`, [tripId]);
    if (!trip) return res.status(404).json({ error: "trip_not_found" });
    if (trip.status === "archived") return res.status(409).json({ error: "already_archived" });
    return res.status(403).json({ error: "not_leader" });
  } catch (err) {
    logger.error({ reqId: req.id, err: err.message }, "[mobile-trips] stop trip failed");
    return res.status(500).json({ error: "db_error" });
  }
});

// ---- POST /api/mobile/trips/:id/sos ----------------------------------------
// Fire an SOS. jwtAuth only (mobile is the sole trigger — Pattern A spirit:
// SOS originates from the device, like location). Writes to sos_events, NOT
// to the locations stream, so the locations writer invariant is untouched.

router.post("/:id/sos", jwtAuth, async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  if (!Number.isFinite(tripId)) return res.status(400).json({ error: "invalid_trip_id" });

  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: "invalid_lat_lng" });
  }
  const accuracyM = (typeof req.body?.accuracy_m === "number" && isFinite(req.body.accuracy_m))
    ? req.body.accuracy_m : null;

  try {
    // Membership + trip name (members carries the membership; trips the name)
    const membership = await db.one(
      `SELECT m.id FROM members m WHERE m.trip_id = $1 AND m.line_user_id = $2`,
      [tripId, req.user.lineUserId]
    );
    if (!membership) return res.status(403).json({ error: "not_member" });

    const trip = await db.one(`SELECT id, name FROM trips WHERE id = $1`, [tripId]);
    if (!trip) return res.status(404).json({ error: "trip_not_found" });

    // Atomic dedupe + insert: SELECT ... FOR UPDATE inside a TX prevents two
    // concurrent SOS attempts from both passing the dedupe check.
    const txResult = await db.tx(async (q) => {
      const dup = await q(
        `SELECT id FROM sos_events
         WHERE trip_id = $1 AND user_id = $2 AND cancelled_at IS NULL
         LIMIT 1 FOR UPDATE`,
        [tripId, req.user.id]
      );
      if (dup.rows.length > 0) {
        return { duplicate: true, existingId: dup.rows[0].id };
      }
      const inserted = await q(
        `INSERT INTO sos_events (trip_id, user_id, lat, lng, accuracy_m)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, triggered_at`,
        [tripId, req.user.id, lat, lng, accuracyM]
      );
      return { duplicate: false, row: inserted.rows[0] };
    });

    if (txResult.duplicate) {
      return res.status(409).json({
        ok: false,
        code: "ACTIVE_SOS_EXISTS",
        existing: { id: String(txResult.existingId) },
      });
    }

    const sosId = txResult.row.id;
    const triggeredAt = txResult.row.triggered_at;

    // Recipients: other members of this trip with a LINE id (exclude sender).
    // members.line_user_id IS the LINE push target — no users join needed.
    const recipients = await db.many(
      `SELECT line_user_id FROM members
       WHERE trip_id = $1 AND line_user_id <> $2 AND line_user_id IS NOT NULL`,
      [tripId, req.user.lineUserId]
    );

    // Best-effort Push (NOT in the TX — a push failure must not undo the SOS).
    const timeHHMM = new Date(triggeredAt).toLocaleTimeString("th-TH", {
      timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const flex = buildSosFlex({
      senderName: req.user.displayName || "สมาชิก",
      lat, lng, timeHHMM, tripName: trip.name, tripId: String(tripId),
    });

    let sent = 0, failed = 0;
    if (recipients.length > 0) {
      const results = await Promise.allSettled(
        recipients.map(r => pushFlexToLine(r.line_user_id, flex))
      );
      results.forEach(r => { r.status === "fulfilled" ? sent++ : failed++; });
      if (failed > 0) {
        logger.warn({ reqId: req.id, sosId: String(sosId), sent, failed }, "[sos] some pushes failed");
      }
    }

    // Update tally. If the process crashes before this, the SOS row still
    // exists; only the counts stay 0 — acceptable trade-off (documented).
    await db.query(
      `UPDATE sos_events SET push_sent_count = $1, push_failed_count = $2 WHERE id = $3`,
      [sent, failed, sosId]
    );

    return res.json({
      ok: true,
      sos: {
        id: String(sosId),
        tripId: String(tripId),
        userId: String(req.user.id),
        lat, lng,
        triggeredAt,
        pushSentCount: sent,
        pushFailedCount: failed,
      },
    });
  } catch (err) {
    // Concurrent SOS race — slipped past the TX dedupe, caught by the unique
    // partial index idx_sos_one_active_per_user. Convert to the same 409 the
    // app-level dedupe returns, so the client sees a consistent contract.
    if (err.code === "23505" && /sos_one_active/.test(err.constraint || "")) {
      logger.warn(
        { reqId: req.id, tripId, userId: req.user.id },
        "[sos] race condition caught by unique index — converting to 409"
      );
      return res.status(409).json({ ok: false, code: "ACTIVE_SOS_EXISTS" });
    }
    logger.error({ reqId: req.id, err: err.message }, "[mobile-trips] sos failed");
    return res.status(500).json({ error: "db_error" });
  }
});

// ---- POST /api/mobile/trips/:id/sos/:sosId/cancel --------------------------
// Sender-only cancel. Other members cannot cancel someone else's SOS.

router.post("/:id/sos/:sosId/cancel", jwtAuth, async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  const sosId = parseInt(req.params.sosId, 10);
  if (!Number.isFinite(tripId)) return res.status(400).json({ error: "invalid_trip_id" });
  if (!Number.isFinite(sosId)) return res.status(400).json({ error: "invalid_sos_id" });

  try {
    const sos = await db.one(
      `SELECT id, trip_id, user_id, cancelled_at FROM sos_events WHERE id = $1`,
      [sosId]
    );
    if (!sos || Number(sos.trip_id) !== tripId) {
      return res.status(404).json({ ok: false, code: "SOS_NOT_FOUND" });
    }
    if (sos.cancelled_at !== null) {
      return res.status(409).json({ ok: false, code: "ALREADY_CANCELLED" });
    }
    if (Number(sos.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ ok: false, code: "NOT_SENDER" });
    }

    const updated = await db.query(
      `UPDATE sos_events SET cancelled_at = now(), cancelled_by = $1
       WHERE id = $2 RETURNING cancelled_at`,
      [req.user.id, sosId]
    );

    return res.json({
      ok: true,
      sosId: String(sosId),
      cancelledAt: updated.rows[0].cancelled_at,
    });
  } catch (err) {
    logger.error({ reqId: req.id, err: err.message }, "[mobile-trips] sos cancel failed");
    return res.status(500).json({ error: "db_error" });
  }
});

module.exports = router;

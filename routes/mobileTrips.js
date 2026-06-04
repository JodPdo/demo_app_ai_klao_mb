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
const jwtAuth = require("../middleware/jwtAuth");
const dualAuth = require("../middleware/dualAuth");

const router = express.Router();

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

    return res.json({
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

    // locations.trip_id is NOT NULL (no default) -- must include in INSERT
    // source='mobile' distinguishes these from LINE bot locations (default 'line')
    const result = await db.query(
      `INSERT INTO locations (trip_id, member_id, latitude, longitude, distance_km, accuracy_m, source, created_at)
       SELECT m.trip_id, m.id, $1, $2, $3, $4, 'mobile', COALESCE($5::timestamptz, NOW())
       FROM members m
       WHERE m.trip_id = $6 AND m.line_user_id = $7
       RETURNING id`,
      [lat, lng, distanceKm, accuracyM, timestamp, tripId, req.user.lineUserId]
    );

    if (result.rows.length === 0) return res.status(403).json({ error: "forbidden" });

    return res.status(201).json({ ok: true, locationId: String(result.rows[0].id) });
  } catch (err) {
    logger.error({ reqId: req.id, err: err.message }, "[mobile-trips] location push failed");
    return res.status(500).json({ error: "db_error" });
  }
});

// ---- POST /api/mobile/trips/:id/stop ---------------------------------------

router.post("/:id/stop", dualAuth, async (req, res) => {
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

module.exports = router;

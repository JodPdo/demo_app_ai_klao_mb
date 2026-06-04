// tests/routes/mobileTrips.test.js
// Tests for POST /start, GET /, GET /:id, POST /:id/location, POST /:id/stop

// ---- Mocks (before require) ------------------------------------------------

jest.mock("express-rate-limit", () => () => (_req, _res, next) => next());
jest.mock("pino-http", () => () => (_req, _res, next) => next());

jest.mock("../../lib/db", () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  one:   jest.fn().mockResolvedValue(null),
  many:  jest.fn().mockResolvedValue([]),
  tx:    jest.fn().mockImplementation(async (fn) => fn(jest.fn().mockResolvedValue({ rows: [] }))),
  init:  jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../lib/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

jest.mock("../../utils/distance", () => ({
  getDistance: jest.fn().mockReturnValue(42.0),
}));

jest.mock("../../middleware/jwtAuth", () => (req, _res, next) => {
  req.user = { id: "1", lineUserId: "Utest01", displayName: "Test User", source: "mobile" };
  next();
});

jest.mock("../../middleware/dualAuth", () => (req, _res, next) => {
  req.user = { id: "1", lineUserId: "Utest01", displayName: "Test User", source: "mobile" };
  next();
});

// ---- App + supertest -------------------------------------------------------

const request         = require("supertest");
const db              = require("../../lib/db");
const { getDistance } = require("../../utils/distance");
const { app }         = require("../../server");

const AUTH    = { Authorization: "Bearer mock-token" };
const TRIP_ID = 7;

const fakeUser = { display_name: "Test User", picture_url: "https://pic.example.com/u.jpg" };
const fakeCreatedTrip = {
  id: TRIP_ID, name: "My Trip 2026-05-27", status: "active",
  dest_lat: null, dest_lng: null, dest_name: null,
  created_at: new Date("2026-05-27T10:00:00Z"),
};
const fakeCreatedMember = { id: 20 };
const fakeTripWithDest = {
  ...fakeCreatedTrip, dest_lat: 18.796, dest_lng: 98.993, dest_name: "เชียงใหม่",
};
const fakeMember = {
  id: 20, line_user_id: "Utest01", display_name: "Test User",
  picture_url: "https://pic.example.com/u.jpg", is_leader: true, arrived_at: null,
  latitude: 13.756, longitude: 100.502, distance_km: 42.0,
  location_at: new Date("2026-05-27T11:00:00Z"),
};

beforeEach(() => {
  jest.clearAllMocks();
  db.one.mockReset().mockResolvedValue(null);
  db.many.mockReset().mockResolvedValue([]);
  db.query.mockReset().mockResolvedValue({ rows: [] });
  db.tx.mockReset().mockImplementation(async (fn) => fn(jest.fn().mockResolvedValue({ rows: [] })));
});

// ---- POST /api/mobile/trips/start ------------------------------------------

describe("POST /api/mobile/trips/start", () => {
  test("201 -- creates trip without destination", async () => {
    db.query.mockResolvedValueOnce({ rows: [fakeUser] });
    db.tx.mockResolvedValueOnce({ trip: fakeCreatedTrip, member: fakeCreatedMember });

    const res = await request(app).post("/api/mobile/trips/start").set(AUTH).send({});

    expect(res.status).toBe(201);
    expect(res.body.trip).toMatchObject({ id: String(TRIP_ID), status: "active" });
    expect(res.body.trip.destination).toBeNull();
    expect(res.body.member).toMatchObject({ id: "20", isLeader: true });
  });

  test("201 -- creates trip with destination", async () => {
    db.query.mockResolvedValueOnce({ rows: [fakeUser] });
    db.tx.mockResolvedValueOnce({ trip: fakeTripWithDest, member: fakeCreatedMember });

    const res = await request(app)
      .post("/api/mobile/trips/start")
      .set(AUTH)
      .send({ destination: { lat: 18.796, lng: 98.993, name: "เชียงใหม่" } });

    expect(res.status).toBe(201);
    expect(res.body.trip.destination).toMatchObject({ lat: 18.796, lng: 98.993 });
  });

  test("400 -- destination lat out of range", async () => {
    const res = await request(app)
      .post("/api/mobile/trips/start")
      .set(AUTH)
      .send({ destination: { lat: 999, lng: 100 } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_destination" });
  });

  test("400 -- destination lat is non-numeric", async () => {
    const res = await request(app)
      .post("/api/mobile/trips/start")
      .set(AUTH)
      .send({ destination: { lat: "bad", lng: 100 } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_destination" });
  });

  test("400 -- name exceeds 50 character DB check constraint", async () => {
    const res = await request(app)
      .post("/api/mobile/trips/start")
      .set(AUTH)
      .send({ name: "a".repeat(51) });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "name_too_long" });
  });

  test("404 -- user not found in users table", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post("/api/mobile/trips/start").set(AUTH).send({});
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "user_not_found" });
  });

  test("500 -- transaction throws", async () => {
    db.query.mockResolvedValueOnce({ rows: [fakeUser] });
    db.tx.mockRejectedValueOnce(new Error("deadlock"));
    const res = await request(app).post("/api/mobile/trips/start").set(AUTH).send({});
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "db_error" });
  });
});

// ---- GET /api/mobile/trips -------------------------------------------------

describe("GET /api/mobile/trips", () => {
  test("200 -- returns trips list", async () => {
    db.many.mockResolvedValueOnce([
      { id: TRIP_ID, name: "Beach Run", status: "active",
        dest_lat: null, dest_lng: null, dest_name: null,
        created_at: new Date(), member_count: 1, is_leader: true, last_location_at: null },
    ]);
    const res = await request(app).get("/api/mobile/trips").set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.trips)).toBe(true);
    expect(res.body.trips[0]).toMatchObject({ id: String(TRIP_ID), isLeader: true, memberCount: 1 });
    expect(res.body.trips[0].destination).toBeNull();
  });

  test("200 -- returns empty array when user has no trips", async () => {
    db.many.mockResolvedValueOnce([]);
    const res = await request(app).get("/api/mobile/trips").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.trips).toHaveLength(0);
  });

  test("500 -- db.many throws", async () => {
    db.many.mockRejectedValueOnce(new Error("connection reset"));
    const res = await request(app).get("/api/mobile/trips").set(AUTH);
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "db_error" });
  });
});

// ---- GET /api/mobile/trips/:id ---------------------------------------------

describe("GET /api/mobile/trips/:id", () => {
  test("200 -- returns trip with members and last location", async () => {
    db.one
      .mockResolvedValueOnce({ id: 20 })
      .mockResolvedValueOnce(fakeTripWithDest);
    db.many.mockResolvedValueOnce([fakeMember]);

    const res = await request(app).get(`/api/mobile/trips/${TRIP_ID}`).set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.trip).toMatchObject({ id: String(TRIP_ID), status: "active" });
    expect(res.body.trip.destination).toMatchObject({ lat: 18.796, lng: 98.993 });
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0].lastLocation).toMatchObject({ lat: 13.756, lng: 100.502 });
  });

  test("200 -- member with no location has null lastLocation", async () => {
    const memberNoLoc = {
      ...fakeMember, latitude: null, longitude: null, distance_km: null, location_at: null,
    };
    db.one
      .mockResolvedValueOnce({ id: 20 })
      .mockResolvedValueOnce(fakeCreatedTrip);
    db.many.mockResolvedValueOnce([memberNoLoc]);

    const res = await request(app).get(`/api/mobile/trips/${TRIP_ID}`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.members[0].lastLocation).toBeNull();
  });

  test("400 -- non-numeric trip id", async () => {
    const res = await request(app).get("/api/mobile/trips/abc").set(AUTH);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_trip_id" });
  });

  test("403 -- user is not a member of this trip", async () => {
    db.one.mockResolvedValueOnce(null);
    const res = await request(app).get(`/api/mobile/trips/${TRIP_ID}`).set(AUTH);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "forbidden" });
  });

  test("404 -- trip not found after membership check passes", async () => {
    db.one
      .mockResolvedValueOnce({ id: 20 })
      .mockResolvedValueOnce(null);
    const res = await request(app).get(`/api/mobile/trips/${TRIP_ID}`).set(AUTH);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "trip_not_found" });
  });
});

// ---- POST /api/mobile/trips/:id/location -----------------------------------

describe("POST /api/mobile/trips/:id/location", () => {
  test("201 -- inserts location, no destination so distanceKm is null", async () => {
    db.one.mockResolvedValueOnce({ id: TRIP_ID, dest_lat: null, dest_lng: null });
    db.query.mockResolvedValueOnce({ rows: [{ id: 99 }] });

    const res = await request(app)
      .post(`/api/mobile/trips/${TRIP_ID}/location`)
      .set(AUTH)
      .send({ lat: 13.756, lng: 100.502 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, locationId: "99" });
    expect(getDistance).not.toHaveBeenCalled();
  });

  test("201 -- calls getDistance when trip has destination", async () => {
    db.one.mockResolvedValueOnce({ id: TRIP_ID, dest_lat: 18.796, dest_lng: 98.993 });
    db.query.mockResolvedValueOnce({ rows: [{ id: 100 }] });

    const res = await request(app)
      .post(`/api/mobile/trips/${TRIP_ID}/location`)
      .set(AUTH)
      .send({ lat: 13.756, lng: 100.502 });

    expect(res.status).toBe(201);
    expect(getDistance).toHaveBeenCalledWith(13.756, 100.502, 18.796, 98.993);
    expect(res.body.locationId).toBe("100");
  });

  test("400 -- lat and lng missing", async () => {
    const res = await request(app)
      .post(`/api/mobile/trips/${TRIP_ID}/location`)
      .set(AUTH)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_lat_lng" });
  });

  test("400 -- lat out of range", async () => {
    const res = await request(app)
      .post(`/api/mobile/trips/${TRIP_ID}/location`)
      .set(AUTH)
      .send({ lat: 200, lng: 100 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_lat_lng" });
  });

  test("404 -- trip not found", async () => {
    db.one.mockResolvedValueOnce(null);
    const res = await request(app)
      .post(`/api/mobile/trips/${TRIP_ID}/location`)
      .set(AUTH)
      .send({ lat: 13.756, lng: 100.502 });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "trip_not_found" });
  });

  test("403 -- user not a member (INSERT...SELECT returns 0 rows)", async () => {
    db.one.mockResolvedValueOnce({ id: TRIP_ID, dest_lat: null, dest_lng: null });
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post(`/api/mobile/trips/${TRIP_ID}/location`)
      .set(AUTH)
      .send({ lat: 13.756, lng: 100.502 });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "forbidden" });
  });

  test("201 -- accuracy_m populated when client sends accuracy field", async () => {
    db.one.mockResolvedValueOnce({ id: TRIP_ID, dest_lat: null, dest_lng: null });
    db.query.mockResolvedValueOnce({ rows: [{ id: 101 }] });

    const res = await request(app)
      .post(`/api/mobile/trips/${TRIP_ID}/location`)
      .set(AUTH)
      .send({ lat: 13.756, lng: 100.502, accuracy: 12.5 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, locationId: "101" });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("accuracy_m"),
      expect.arrayContaining([12.5]),
    );
  });
});

// ---- POST /api/mobile/trips/:id/stop ---------------------------------------

describe("POST /api/mobile/trips/:id/stop", () => {
  test("200 -- archives trip and returns stoppedAt", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: TRIP_ID, status: "archived", ended_at: new Date().toISOString() }] });

    const res = await request(app).post(`/api/mobile/trips/${TRIP_ID}/stop`).set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.trip).toMatchObject({ id: String(TRIP_ID), status: "archived" });
    expect(typeof res.body.trip.stoppedAt).toBe("string");
  });

  test("403 -- trip is active but user is not its leader", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    db.one.mockResolvedValueOnce({ id: TRIP_ID, status: "active" });

    const res = await request(app).post(`/api/mobile/trips/${TRIP_ID}/stop`).set(AUTH);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "not_leader" });
  });

  test("404 -- trip does not exist", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    db.one.mockResolvedValueOnce(null);

    const res = await request(app).post(`/api/mobile/trips/${TRIP_ID}/stop`).set(AUTH);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "trip_not_found" });
  });

  test("409 -- trip is already archived", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    db.one.mockResolvedValueOnce({ id: TRIP_ID, status: "archived" });

    const res = await request(app).post(`/api/mobile/trips/${TRIP_ID}/stop`).set(AUTH);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "already_archived" });
  });

  test("400 -- non-numeric trip id", async () => {
    const res = await request(app).post("/api/mobile/trips/abc/stop").set(AUTH);
    expect(res.status).toBe(400);
  });
});

// ---- GET /api/mobile/trips/:id — Phase 5.4 enhanced fields ------------------

describe("GET /api/mobile/trips/:id — enhanced fields (Phase 5.4)", () => {
  const makeTripRow = (overrides = {}) => ({
    id: 42,
    name: "Test Trip",
    status: "active",
    dest_lat: null,
    dest_lng: null,
    dest_name: null,
    created_at: new Date(Date.now() - 3600 * 1000).toISOString(),
    all_arrived_at: null,
    ended_at: null,
    ...overrides,
  });

  const makeLeaderRow = (overrides = {}) => ({
    id: 101,
    line_user_id: "Uleader0001",
    display_name: "ปอ",
    picture_url: null,
    is_leader: true,
    arrived_at: null,
    joined_at: new Date(Date.now() - 3600 * 1000).toISOString(),
    latitude: 13.7563,
    longitude: 100.5018,
    distance_km: 2.1,
    accuracy_m: 12.5,
    location_at: new Date(Date.now() - 60 * 1000).toISOString(),
    ...overrides,
  });

  const makeMemberRow = (overrides = {}) => ({
    id: 102,
    line_user_id: "Umember0002",
    display_name: "มี",
    picture_url: null,
    is_leader: false,
    arrived_at: null,
    joined_at: new Date(Date.now() - 3540 * 1000).toISOString(),
    latitude: 13.7720,
    longitude: 100.5050,
    distance_km: 1.8,
    accuracy_m: 20.0,
    location_at: new Date(Date.now() - 90 * 1000).toISOString(),
    ...overrides,
  });

  function setupGetTrip({ tripOverrides = {}, memberRows, leaderLocs = [] } = {}) {
    db.one
      .mockResolvedValueOnce({ id: 99 })
      .mockResolvedValueOnce(makeTripRow(tripOverrides));
    db.many
      .mockResolvedValueOnce(memberRows)
      .mockResolvedValueOnce(leaderLocs);
  }

  it("returns durationSeconds as a positive integer for active trip", async () => {
    setupGetTrip({ memberRows: [makeLeaderRow()] });
    const res = await request(app).get("/api/mobile/trips/42").set(AUTH);
    expect(res.status).toBe(200);
    expect(typeof res.body.trip.durationSeconds).toBe("number");
    expect(res.body.trip.durationSeconds).toBeGreaterThan(0);
  });

  it("returns totalDistanceKm null when leader has fewer than 2 location points", async () => {
    setupGetTrip({ memberRows: [makeLeaderRow()], leaderLocs: [{ latitude: 13.7563, longitude: 100.5018 }] });
    const res = await request(app).get("/api/mobile/trips/42").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.trip.totalDistanceKm).toBeNull();
  });

  it("returns totalDistanceKm null when leader has no location points", async () => {
    setupGetTrip({ memberRows: [makeLeaderRow()], leaderLocs: [] });
    const res = await request(app).get("/api/mobile/trips/42").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.trip.totalDistanceKm).toBeNull();
  });

  it("returns totalDistanceKm as a number when leader has 2+ location points", async () => {
    const leaderLocs = [
      { latitude: 13.7563, longitude: 100.5018 },
      { latitude: 13.7600, longitude: 100.5060 },
    ];
    setupGetTrip({ memberRows: [makeLeaderRow()], leaderLocs });
    const res = await request(app).get("/api/mobile/trips/42").set(AUTH);
    expect(res.status).toBe(200);
    expect(typeof res.body.trip.totalDistanceKm).toBe("number");
    expect(res.body.trip.totalDistanceKm).toBeGreaterThan(0);
  });

  it("returns distanceFromLeaderKm as 0.0 for the leader member", async () => {
    setupGetTrip({ memberRows: [makeLeaderRow()] });
    const res = await request(app).get("/api/mobile/trips/42").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.members[0].isLeader).toBe(true);
    expect(res.body.members[0].lastLocation.distanceFromLeaderKm).toBe(0.0);
  });

  it("returns distanceFromLeaderKm as a number for non-leader when leader has location", async () => {
    setupGetTrip({ memberRows: [makeLeaderRow(), makeMemberRow()] });
    const res = await request(app).get("/api/mobile/trips/42").set(AUTH);
    expect(res.status).toBe(200);
    const nonLeader = res.body.members.find(m => !m.isLeader);
    expect(typeof nonLeader.lastLocation.distanceFromLeaderKm).toBe("number");
    expect(nonLeader.lastLocation.distanceFromLeaderKm).toBeGreaterThanOrEqual(0);
  });

  it("returns distanceFromLeaderKm null for non-leader when leader has no location", async () => {
    const leaderNoLoc = makeLeaderRow({ latitude: null, longitude: null, accuracy_m: null, location_at: null });
    setupGetTrip({ memberRows: [leaderNoLoc, makeMemberRow()] });
    const res = await request(app).get("/api/mobile/trips/42").set(AUTH);
    expect(res.status).toBe(200);
    const nonLeader = res.body.members.find(m => !m.isLeader);
    expect(nonLeader.lastLocation.distanceFromLeaderKm).toBeNull();
  });

  it("returns accuracyM from the latest location row", async () => {
    setupGetTrip({ memberRows: [makeLeaderRow({ accuracy_m: 12.5 })] });
    const res = await request(app).get("/api/mobile/trips/42").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.members[0].lastLocation.accuracyM).toBe(12.5);
  });

  it("returns accuracyM null when accuracy_m is null", async () => {
    setupGetTrip({ memberRows: [makeLeaderRow({ accuracy_m: null })] });
    const res = await request(app).get("/api/mobile/trips/42").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.members[0].lastLocation.accuracyM).toBeNull();
  });

  it("returns joinedAt for each member", async () => {
    const joined = new Date(Date.now() - 3600 * 1000).toISOString();
    setupGetTrip({ memberRows: [makeLeaderRow({ joined_at: joined })] });
    const res = await request(app).get("/api/mobile/trips/42").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.members[0].joinedAt).toBe(joined);
  });

  it("returns endedAt null for active trip", async () => {
    setupGetTrip({ memberRows: [makeLeaderRow()] });
    const res = await request(app).get("/api/mobile/trips/42").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.trip.endedAt).toBeNull();
  });

  it("returns endedAt as ISO string for archived trip", async () => {
    const endedAt = new Date().toISOString();
    setupGetTrip({
      tripOverrides: { status: "archived", ended_at: endedAt },
      memberRows: [makeLeaderRow()],
    });
    const res = await request(app).get("/api/mobile/trips/42").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.trip.endedAt).toBe(endedAt);
    expect(res.body.trip.status).toBe("archived");
  });

  it("lastLocation is null for member with no location", async () => {
    const noLoc = makeLeaderRow({ latitude: null, longitude: null, accuracy_m: null, distance_km: null, location_at: null });
    setupGetTrip({ memberRows: [noLoc] });
    const res = await request(app).get("/api/mobile/trips/42").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.members[0].lastLocation).toBeNull();
  });
});

// ---- POST /api/mobile/trips/:id/stop — Phase 5.4 endedAt field --------------

describe("POST /api/mobile/trips/:id/stop — endedAt field (Phase 5.4)", () => {
  it("returns endedAt matching stoppedAt in response", async () => {
    const endedAt = new Date().toISOString();
    db.query.mockResolvedValueOnce({
      rows: [{ id: 42, status: "archived", ended_at: endedAt }],
    });
    const res = await request(app).post("/api/mobile/trips/42/stop").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.trip.endedAt).toBe(endedAt);
    expect(res.body.trip.stoppedAt).toBe(endedAt);
  });
});

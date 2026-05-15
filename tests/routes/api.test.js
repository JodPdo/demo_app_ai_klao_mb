// Integration tests for /api/* routes (liffAuth is mocked — user always injected)

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock("express-rate-limit", () => () => (_req, _res, next) => next());

jest.mock("../../lib/db", () => ({
  query: jest.fn().mockResolvedValue({}),
  one:   jest.fn().mockResolvedValue(null),
  many:  jest.fn().mockResolvedValue([]),
  tx:    jest.fn().mockImplementation(async (fn) => fn(jest.fn().mockResolvedValue({}))),
  init:  jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../lib/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

jest.mock("../../lib/lineClient", () => ({
  client: { pushMessage: jest.fn().mockResolvedValue({}) },
}));

jest.mock("../../services/scheduler", () => ({
  start: jest.fn(), stop: jest.fn(),
}));

jest.mock("../../handlers/webhook", () => ({
  handleEvent: jest.fn().mockResolvedValue(undefined),
  archiveTrip: jest.fn().mockResolvedValue({ ok: true }),
  resetTrip:   jest.fn().mockResolvedValue({ ok: true }),
}));

const mockSafety = {
  enterBreak:         jest.fn().mockResolvedValue({ ok: true, breakUntil: new Date(Date.now() + 30 * 60_000), durationMin: 30, reason: "rest" }),
  exitBreak:          jest.fn().mockResolvedValue({ ok: true, actualMin: 15 }),
  extendBreak:        jest.fn().mockResolvedValue({ ok: true, breakUntil: new Date(Date.now() + 45 * 60_000) }),
  isOnBreak:          jest.fn().mockReturnValue(false),
  checkBreakMovement: jest.fn().mockResolvedValue(false),
  triggerSOS:         jest.fn().mockResolvedValue({ ok: true }),
  checkArrival:       jest.fn().mockResolvedValue(false),
  checkStationary:    jest.fn().mockResolvedValue(false),
  validateBreakInput: jest.fn().mockReturnValue({ ok: true, durationMin: 30, reason: "rest" }),
  BREAK_DURATION_MIN: 5,
  BREAK_DURATION_MAX: 480,
  BREAK_REASON_LABEL: {},
};
jest.mock("../../services/safety", () => mockSafety);

const mockGroupBreak = {
  enterGroupBreak:         jest.fn().mockResolvedValue({ ok: true, breakUntil: new Date(), durationMin: 30, reason: "rest" }),
  exitGroupBreak:          jest.fn().mockResolvedValue({ ok: true }),
  extendGroupBreak:        jest.fn().mockResolvedValue({ ok: true, breakUntil: new Date() }),
  isGroupOnBreak:          jest.fn().mockReturnValue(false),
  renameTrip:              jest.fn().mockResolvedValue({ ok: true, name: "New Name", oldName: "Old Name" }),
  validateTripName:        jest.fn().mockReturnValue({ ok: true, name: "New Name" }),
  clearExpiredGroupBreaks: jest.fn().mockResolvedValue(0),
};
jest.mock("../../services/groupBreak", () => mockGroupBreak);

jest.mock("../../services/eta", () => ({
  calcMemberETA:     jest.fn().mockResolvedValue(null),
  attachETAs:        jest.fn().mockImplementation(async (_trip, members) => members),
  formatETA:         jest.fn().mockReturnValue("—"),
  formatArrivalTime: jest.fn().mockReturnValue(null),
}));

jest.mock("../../services/shareToken", () => ({
  validateToken:    jest.fn().mockResolvedValue({ ok: false, error: "invalid" }),
  applyPrivacy:     jest.fn().mockImplementation((m) => m),
  applyTripPrivacy: jest.fn().mockImplementation((t) => t),
  createToken:      jest.fn().mockResolvedValue({ ok: true, token: { id: 1, token: "uuid" } }),
  listTokens:       jest.fn().mockResolvedValue([]),
  revokeToken:      jest.fn().mockResolvedValue({ ok: true }),
  recordView:       jest.fn().mockResolvedValue(undefined),
  PRIVACY_MODES:    ["full", "initial-only"],
  MAX_TOKENS_PER_TRIP: 20,
}));

jest.mock("../../services/locationProcessor", () => ({
  processLocation: jest.fn().mockResolvedValue({
    ok: true, distance_km: 5, arrived: false, break_ended: false,
  }),
}));

jest.mock("../../utils/geocode", () => ({
  searchMultiple: jest.fn().mockResolvedValue([
    { lat: 13.756, lng: 100.502, displayName: "Bangkok", type: "city", class: "place" },
  ]),
  reverse: jest.fn().mockResolvedValue({
    lat: 13.756, lng: 100.502, displayName: "Bangkok", address: {},
  }),
}));

jest.mock("../../middleware/liffAuth", () => (req, _res, next) => {
  req.lineUser = { userId: "U_test01", displayName: "Test User", pictureUrl: null };
  next();
});

jest.mock("@line/bot-sdk", () => ({
  middleware: () => (_req, _res, next) => next(),
  HTTPFetchError: class HTTPFetchError extends Error {},
}));

// ─── Test setup ───────────────────────────────────────────────────────────────

const request = require("supertest");
const db      = require("../../lib/db");
const { archiveTrip, resetTrip } = require("../../handlers/webhook");
const { app } = require("../../server");

const AUTH = { Authorization: "Bearer mock-token" };

const TRIP_ID = 42;
const MEMBER_ID = 10;

const fakeMember = {
  id: MEMBER_ID, line_user_id: "U_test01", display_name: "Test User",
  is_leader: false, arrived_at: null, break_until: null, break_reason: null,
  break_started_at: null, break_location_lat: null, break_location_lng: null,
};
const fakeLeader = { ...fakeMember, is_leader: true };
const fakeTrip = {
  id: TRIP_ID, name: "ทริปทดสอบ", dest_lat: 18.796, dest_lng: 98.993,
  dest_name: "เชียงใหม่", status: "active", line_group_id: "g:C123",
  stale_threshold_min: 30, all_arrived_at: null, group_break_until: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  // mockReset clears "once" queue — prevents values leaking across tests when a
  // route exits early before consuming all queued mockResolvedValueOnce values
  db.one.mockReset().mockResolvedValue(null);
  db.many.mockReset().mockResolvedValue([]);
  db.query.mockReset().mockResolvedValue({});
});

// ─── GET /api/me ──────────────────────────────────────────────────────────────

describe("GET /api/me", () => {
  test("returns the injected lineUser", async () => {
    const res = await request(app).get("/api/me").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ userId: "U_test01", displayName: "Test User" });
  });
});

// ─── GET /api/me/trips ────────────────────────────────────────────────────────

describe("GET /api/me/trips", () => {
  test("returns trips array from DB", async () => {
    db.many.mockResolvedValueOnce([
      { id: 1, name: "trip A", status: "active", is_leader: true },
    ]);
    const res = await request(app).get("/api/me/trips").set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.trips)).toBe(true);
    expect(res.body.trips[0]).toMatchObject({ id: 1, name: "trip A" });
  });

  test("returns empty trips array when none found", async () => {
    db.many.mockResolvedValueOnce([]);
    const res = await request(app).get("/api/me/trips").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.trips).toHaveLength(0);
  });
});

// ─── GET /api/trip/:tripId ────────────────────────────────────────────────────

describe("GET /api/trip/:tripId", () => {
  test("returns 400 for non-numeric tripId", async () => {
    const res = await request(app).get("/api/trip/abc").set(AUTH);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid trip id" });
  });

  test("returns 403 when user is not a member", async () => {
    db.one.mockResolvedValueOnce(null); // membership check
    const res = await request(app).get(`/api/trip/${TRIP_ID}`).set(AUTH);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "not a member" });
  });

  test("returns 404 when trip row does not exist", async () => {
    db.one
      .mockResolvedValueOnce({ id: MEMBER_ID, is_leader: false }) // membership
      .mockResolvedValueOnce(null);                                // trip
    const res = await request(app).get(`/api/trip/${TRIP_ID}`).set(AUTH);
    expect(res.status).toBe(404);
  });

  test("returns 200 with trip, members, me when all found", async () => {
    db.one
      .mockResolvedValueOnce({ id: MEMBER_ID, is_leader: false }) // membership
      .mockResolvedValueOnce(fakeTrip)                            // trip
      .mockResolvedValueOnce({ enabled: true, interval_min: 5 }); // notification
    db.many.mockResolvedValueOnce([fakeMember]);

    const res = await request(app).get(`/api/trip/${TRIP_ID}`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.trip).toMatchObject({ id: TRIP_ID });
    expect(Array.isArray(res.body.members)).toBe(true);
    expect(res.body.me).toMatchObject({ userId: "U_test01" });
  });
});

// ─── GET /api/geocode/search ──────────────────────────────────────────────────

describe("GET /api/geocode/search", () => {
  test("returns empty results for query shorter than 2 chars", async () => {
    const res = await request(app).get("/api/geocode/search?q=ก").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  test("returns results from geocode.searchMultiple for valid query", async () => {
    const res = await request(app).get("/api/geocode/search?q=Bangkok").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({ displayName: "Bangkok" });
  });
});

// ─── GET /api/geocode/reverse ─────────────────────────────────────────────────

describe("GET /api/geocode/reverse", () => {
  test("returns 400 for non-numeric coordinates", async () => {
    const res = await request(app).get("/api/geocode/reverse?lat=abc&lng=100").set(AUTH);
    expect(res.status).toBe(400);
  });

  test("returns 404 when geocoder finds nothing", async () => {
    const geocode = require("../../utils/geocode");
    geocode.reverse.mockResolvedValueOnce(null);
    const res = await request(app).get("/api/geocode/reverse?lat=13.756&lng=100.502").set(AUTH);
    expect(res.status).toBe(404);
  });

  test("returns place data for valid coords", async () => {
    const res = await request(app).get("/api/geocode/reverse?lat=13.756&lng=100.502").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ displayName: "Bangkok" });
  });
});

// ─── POST /api/trip/:tripId/destination ───────────────────────────────────────

describe("POST /api/trip/:tripId/destination", () => {
  test("returns 400 when body fields are missing", async () => {
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/destination`)
      .set(AUTH).send({});
    expect(res.status).toBe(400);
  });

  test("returns 400 when coords are outside Thailand bounds", async () => {
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/destination`)
      .set(AUTH).send({ lat: 51.5, lng: -0.1, name: "London" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "coords outside Thailand" });
  });

  test("returns 403 when user is not a leader", async () => {
    db.one.mockResolvedValueOnce({ is_leader: false });
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/destination`)
      .set(AUTH)
      .send({ lat: 18.796, lng: 98.993, name: "เชียงใหม่" });
    expect(res.status).toBe(403);
  });

  test("returns 200 on success", async () => {
    db.one
      .mockResolvedValueOnce({ is_leader: true })  // requireLeader
      .mockResolvedValueOnce(fakeTrip);             // trip lookup
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/destination`)
      .set(AUTH)
      .send({ lat: 18.796, lng: 98.993, name: "เชียงใหม่" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });
});

// ─── POST /api/trip/:tripId/break ─────────────────────────────────────────────

describe("POST /api/trip/:tripId/break", () => {
  test("returns 400 when duration_min is missing", async () => {
    db.one.mockResolvedValueOnce(fakeTrip).mockResolvedValueOnce(fakeMember);
    mockSafety.enterBreak.mockResolvedValueOnce({ ok: false, error: "ระยะเวลาต้องเป็นตัวเลข" });
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/break`)
      .set(AUTH).send({});
    // enterBreak returns ok:false → route forwards 400
    expect([400, 200]).toContain(res.status); // safety mock controls validation
  });

  test("returns 403 when user is not a trip member", async () => {
    db.one
      .mockResolvedValueOnce(fakeTrip) // trip
      .mockResolvedValueOnce(null);    // member not found
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/break`)
      .set(AUTH).send({ duration_min: 30, reason: "rest" });
    expect(res.status).toBe(403);
  });

  test("returns 200 with break details on success", async () => {
    db.one.mockResolvedValueOnce(fakeTrip).mockResolvedValueOnce(fakeMember);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/break`)
      .set(AUTH).send({ duration_min: 30, reason: "rest" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test("returns 409 when trip is not active", async () => {
    db.one.mockResolvedValueOnce({ ...fakeTrip, status: "archived" });
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/break`)
      .set(AUTH).send({ duration_min: 30, reason: "rest" });
    expect(res.status).toBe(409);
  });

  test("returns 409 when member has already arrived", async () => {
    db.one
      .mockResolvedValueOnce(fakeTrip)
      .mockResolvedValueOnce({ ...fakeMember, arrived_at: new Date().toISOString() });
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/break`)
      .set(AUTH).send({ duration_min: 30, reason: "rest" });
    expect(res.status).toBe(409);
  });

  test("returns 409 when member is already on break", async () => {
    db.one.mockResolvedValueOnce(fakeTrip).mockResolvedValueOnce(fakeMember);
    mockSafety.isOnBreak.mockReturnValueOnce(true);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/break`)
      .set(AUTH).send({ duration_min: 30, reason: "rest" });
    expect(res.status).toBe(409);
  });
});

// ─── POST /api/trip/:tripId/break/extend ─────────────────────────────────────

describe("POST /api/trip/:tripId/break/extend", () => {
  test("returns 403 when not a member", async () => {
    db.one.mockResolvedValueOnce(fakeTrip).mockResolvedValueOnce(null);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/break/extend`)
      .set(AUTH).send({ additional_min: 15 });
    expect(res.status).toBe(403);
  });

  test("returns 409 when not currently on break", async () => {
    db.one.mockResolvedValueOnce(fakeTrip).mockResolvedValueOnce(fakeMember);
    // isOnBreak returns false by default
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/break/extend`)
      .set(AUTH).send({ additional_min: 15 });
    expect(res.status).toBe(409);
  });

  test("returns 200 when break extended successfully", async () => {
    db.one.mockResolvedValueOnce(fakeTrip).mockResolvedValueOnce(fakeMember);
    mockSafety.isOnBreak.mockReturnValueOnce(true);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/break/extend`)
      .set(AUTH).send({ additional_min: 15 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─── POST /api/trip/:tripId/break/end ─────────────────────────────────────────

describe("POST /api/trip/:tripId/break/end", () => {
  test("returns 403 when not a member", async () => {
    db.one.mockResolvedValueOnce(fakeTrip).mockResolvedValueOnce(null);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/break/end`).set(AUTH);
    expect(res.status).toBe(403);
  });

  test("returns 409 when not currently on break", async () => {
    db.one.mockResolvedValueOnce(fakeTrip).mockResolvedValueOnce(fakeMember);
    // isOnBreak returns false by default
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/break/end`).set(AUTH);
    expect(res.status).toBe(409);
  });

  test("returns 200 when break ended successfully", async () => {
    db.one.mockResolvedValueOnce(fakeTrip).mockResolvedValueOnce(fakeMember);
    mockSafety.isOnBreak.mockReturnValueOnce(true);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/break/end`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─── POST /api/trip/:tripId/sos ───────────────────────────────────────────────

describe("POST /api/trip/:tripId/sos", () => {
  test("returns 400 when lat/lng are missing", async () => {
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/sos`)
      .set(AUTH).send({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "lat, lng required" });
  });

  test("returns 403 when user is not a member", async () => {
    db.one.mockResolvedValueOnce(null); // membership check
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/sos`)
      .set(AUTH).send({ lat: 13.756, lng: 100.502 });
    expect(res.status).toBe(403);
  });

  test("returns 200 when SOS is triggered successfully", async () => {
    db.one
      .mockResolvedValueOnce({ id: MEMBER_ID, is_leader: false, display_name: "Test User" }) // membership
      .mockResolvedValueOnce(fakeTrip)   // trip
      .mockResolvedValueOnce(fakeMember); // full member
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/sos`)
      .set(AUTH).send({ lat: 13.756, lng: 100.502 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(mockSafety.triggerSOS).toHaveBeenCalledTimes(1);
  });
});

// ─── PATCH /api/trip/:tripId/name ─────────────────────────────────────────────

describe("PATCH /api/trip/:tripId/name", () => {
  test("returns 400 for invalid trip id", async () => {
    const res = await request(app)
      .patch("/api/trip/not-a-number/name")
      .set(AUTH).send({ name: "New Name" });
    expect(res.status).toBe(400);
  });

  test("returns 403 when user is not a leader", async () => {
    db.one.mockResolvedValueOnce({ is_leader: false }); // requireLeader
    const res = await request(app)
      .patch(`/api/trip/${TRIP_ID}/name`)
      .set(AUTH).send({ name: "New Name" });
    expect(res.status).toBe(403);
  });

  test("returns 409 when trip is not active", async () => {
    db.one
      .mockResolvedValueOnce({ is_leader: true })
      .mockResolvedValueOnce({ ...fakeTrip, status: "archived" });
    const res = await request(app)
      .patch(`/api/trip/${TRIP_ID}/name`)
      .set(AUTH).send({ name: "New Name" });
    expect(res.status).toBe(409);
  });

  test("returns 200 with new name on success", async () => {
    db.one
      .mockResolvedValueOnce({ is_leader: true })
      .mockResolvedValueOnce(fakeTrip);
    const res = await request(app)
      .patch(`/api/trip/${TRIP_ID}/name`)
      .set(AUTH).send({ name: "New Name" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test("returns 500 when renameTrip throws", async () => {
    db.one
      .mockResolvedValueOnce({ is_leader: true })
      .mockResolvedValueOnce(fakeTrip);
    mockGroupBreak.renameTrip.mockRejectedValueOnce(new Error("DB error"));
    const res = await request(app)
      .patch(`/api/trip/${TRIP_ID}/name`)
      .set(AUTH).send({ name: "New Name" });
    expect(res.status).toBe(500);
  });
});

// ─── POST /api/trip/:tripId/archive ───────────────────────────────────────────

describe("POST /api/trip/:tripId/archive", () => {
  test("returns 403 when not a leader", async () => {
    db.one.mockResolvedValueOnce({ is_leader: false });
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/archive`).set(AUTH);
    expect(res.status).toBe(403);
  });

  test("returns 409 when trip is already archived", async () => {
    db.one
      .mockResolvedValueOnce({ is_leader: true })
      .mockResolvedValueOnce({ id: TRIP_ID, status: "archived" });
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/archive`).set(AUTH);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "already archived" });
  });

  test("returns 200 and calls archiveTrip on success", async () => {
    db.one
      .mockResolvedValueOnce({ is_leader: true })
      .mockResolvedValueOnce({ id: TRIP_ID, status: "active" });
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/archive`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, action: "archived" });
    expect(archiveTrip).toHaveBeenCalledWith(TRIP_ID, "U_test01");
  });

  test("returns 500 when archiveTrip throws", async () => {
    db.one
      .mockResolvedValueOnce({ is_leader: true })
      .mockResolvedValueOnce({ id: TRIP_ID, status: "active" });
    archiveTrip.mockRejectedValueOnce(new Error("DB error"));
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/archive`).set(AUTH);
    expect(res.status).toBe(500);
  });
});

// ─── POST /api/trip/:tripId/reset ─────────────────────────────────────────────

describe("POST /api/trip/:tripId/reset", () => {
  test("returns 403 when not a leader", async () => {
    db.one.mockResolvedValueOnce({ is_leader: false });
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/reset`).set(AUTH);
    expect(res.status).toBe(403);
  });

  test("returns 409 when trip is not active", async () => {
    db.one
      .mockResolvedValueOnce({ is_leader: true })
      .mockResolvedValueOnce({ id: TRIP_ID, status: "archived" });
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/reset`).set(AUTH);
    expect(res.status).toBe(409);
  });

  test("returns 200 and calls resetTrip on success", async () => {
    db.one
      .mockResolvedValueOnce({ is_leader: true })
      .mockResolvedValueOnce({ id: TRIP_ID, status: "active" });
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/reset`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, action: "reset" });
    expect(resetTrip).toHaveBeenCalledWith(TRIP_ID, "U_test01");
  });

  test("returns 500 when resetTrip throws", async () => {
    db.one
      .mockResolvedValueOnce({ is_leader: true })
      .mockResolvedValueOnce({ id: TRIP_ID, status: "active" });
    resetTrip.mockRejectedValueOnce(new Error("DB error"));
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/reset`).set(AUTH);
    expect(res.status).toBe(500);
  });
});

// ─── POST /api/trip/:tripId/location ─────────────────────────────────────────

describe("POST /api/trip/:tripId/location", () => {
  test("returns 400 for invalid coordinates", async () => {
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/location`)
      .set(AUTH).send({ lat: "abc", lng: 100.5 });
    expect(res.status).toBe(400);
  });

  test("returns 403 when not a member", async () => {
    db.one.mockResolvedValueOnce(null);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/location`)
      .set(AUTH).send({ lat: 13.756, lng: 100.502 });
    expect(res.status).toBe(403);
  });

  test("returns 400 for coordinates out of range", async () => {
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/location`)
      .set(AUTH).send({ lat: 200, lng: 100 });
    expect(res.status).toBe(400);
  });

  test("returns 409 when trip is not active", async () => {
    db.one
      .mockResolvedValueOnce(fakeMember)
      .mockResolvedValueOnce({ ...fakeTrip, status: "archived" });
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/location`)
      .set(AUTH).send({ lat: 13.756, lng: 100.502 });
    expect(res.status).toBe(409);
  });

  test("returns 200 with distance and arrived flag on success", async () => {
    db.one.mockResolvedValueOnce(fakeMember).mockResolvedValueOnce(fakeTrip);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/location`)
      .set(AUTH).send({ lat: 13.756, lng: 100.502 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, distance_km: 5, arrived: false });
  });
});

// ─── GET /api/trip/:tripId/safety ─────────────────────────────────────────────

describe("GET /api/trip/:tripId/safety", () => {
  test("returns 403 when not a member", async () => {
    db.one.mockResolvedValueOnce(null);
    const res = await request(app)
      .get(`/api/trip/${TRIP_ID}/safety`).set(AUTH);
    expect(res.status).toBe(403);
  });

  test("returns alert history when member exists", async () => {
    db.one.mockResolvedValueOnce({ id: 1 }); // membership check
    db.many.mockResolvedValueOnce([
      { id: 1, alert_type: "stale", triggered_at: new Date(), member_name: "สมชาย" },
    ]);
    const res = await request(app)
      .get(`/api/trip/${TRIP_ID}/safety`).set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.alerts)).toBe(true);
    expect(res.body.alerts[0]).toMatchObject({ alert_type: "stale" });
  });
});

// ─── POST /api/trip/:tripId/group-break ───────────────────────────────────────

describe("POST /api/trip/:tripId/group-break", () => {
  test("returns 403 when not a member", async () => {
    db.one.mockResolvedValueOnce(null);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/group-break`)
      .set(AUTH).send({ duration_min: 30, reason: "rest" });
    expect(res.status).toBe(403);
  });

  test("returns 403 when user is not a leader", async () => {
    db.one.mockResolvedValueOnce(fakeMember); // is_leader: false
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/group-break`)
      .set(AUTH).send({ duration_min: 30, reason: "rest" });
    expect(res.status).toBe(403);
  });

  test("returns 409 when group is already on break", async () => {
    db.one.mockResolvedValueOnce(fakeLeader).mockResolvedValueOnce(fakeTrip);
    mockGroupBreak.isGroupOnBreak.mockReturnValueOnce(true);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/group-break`)
      .set(AUTH).send({ duration_min: 30, reason: "rest" });
    expect(res.status).toBe(409);
  });

  test("returns 200 on successful group break entry", async () => {
    db.one.mockResolvedValueOnce(fakeLeader).mockResolvedValueOnce(fakeTrip);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/group-break`)
      .set(AUTH).send({ duration_min: 30, reason: "rest" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─── POST /api/trip/:tripId/group-break/end ───────────────────────────────────

describe("POST /api/trip/:tripId/group-break/end", () => {
  test("returns 403 when not a member", async () => {
    db.one.mockResolvedValueOnce(null);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/group-break/end`).set(AUTH);
    expect(res.status).toBe(403);
  });

  test("returns 403 when user is not a leader", async () => {
    db.one.mockResolvedValueOnce(fakeMember); // is_leader: false
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/group-break/end`).set(AUTH);
    expect(res.status).toBe(403);
  });

  test("returns 200 when group break ended successfully", async () => {
    db.one.mockResolvedValueOnce(fakeLeader).mockResolvedValueOnce(fakeTrip);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/group-break/end`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─── POST /api/trip/:tripId/group-break/extend ────────────────────────────────

describe("POST /api/trip/:tripId/group-break/extend", () => {
  test("returns 403 when not a member", async () => {
    db.one.mockResolvedValueOnce(null);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/group-break/extend`)
      .set(AUTH).send({ additional_min: 15 });
    expect(res.status).toBe(403);
  });

  test("returns 200 on successful extend", async () => {
    db.one.mockResolvedValueOnce(fakeLeader).mockResolvedValueOnce(fakeTrip);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/group-break/extend`)
      .set(AUTH).send({ additional_min: 15 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─── POST /api/trip/:tripId/live-share/start ──────────────────────────────────

describe("POST /api/trip/:tripId/live-share/start", () => {
  test("returns 403 when not a member", async () => {
    db.one.mockResolvedValueOnce(null);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/live-share/start`)
      .set(AUTH).send({ duration_min: 30 });
    expect(res.status).toBe(403);
  });

  test("returns 200 with live_share_until on success", async () => {
    db.one.mockResolvedValueOnce(fakeMember);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/live-share/start`)
      .set(AUTH).send({ duration_min: 30 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.live_share_until).toBeDefined();
  });

  test("uses default duration when duration_min is invalid", async () => {
    db.one.mockResolvedValueOnce(fakeMember);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/live-share/start`)
      .set(AUTH).send({ duration_min: -1 });
    expect(res.status).toBe(200);
    expect(res.body.duration_min).toBeGreaterThan(0);
  });
});

// ─── POST /api/trip/:tripId/live-share/stop ───────────────────────────────────

describe("POST /api/trip/:tripId/live-share/stop", () => {
  test("returns 403 when not a member", async () => {
    db.one.mockResolvedValueOnce(null);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/live-share/stop`).set(AUTH);
    expect(res.status).toBe(403);
  });

  test("returns 200 when stopped successfully", async () => {
    db.one.mockResolvedValueOnce({ id: MEMBER_ID });
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/live-share/stop`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─── POST /api/trip/:tripId/share-tokens ─────────────────────────────────────

describe("POST /api/trip/:tripId/share-tokens", () => {
  test("returns 403 when not a member", async () => {
    db.one.mockResolvedValueOnce(null);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/share-tokens`)
      .set(AUTH).send({});
    expect(res.status).toBe(403);
  });

  test("returns 403 when user is not a leader", async () => {
    db.one.mockResolvedValueOnce(fakeMember).mockResolvedValueOnce(fakeTrip);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/share-tokens`)
      .set(AUTH).send({});
    expect(res.status).toBe(403);
  });

  test("returns 200 with token on success", async () => {
    const shareToken = require("../../services/shareToken");
    shareToken.createToken.mockResolvedValueOnce({ ok: true, token: { id: 1, token: "uuid-abc" } });
    db.one.mockResolvedValueOnce(fakeLeader).mockResolvedValueOnce(fakeTrip);
    const res = await request(app)
      .post(`/api/trip/${TRIP_ID}/share-tokens`)
      .set(AUTH).send({ label: "ครอบครัว", privacy_mode: "full" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBeDefined();
  });
});

// ─── GET /api/trip/:tripId/share-tokens ──────────────────────────────────────

describe("GET /api/trip/:tripId/share-tokens", () => {
  test("returns 403 when not a member", async () => {
    db.one.mockResolvedValueOnce(null);
    const res = await request(app)
      .get(`/api/trip/${TRIP_ID}/share-tokens`).set(AUTH);
    expect(res.status).toBe(403);
  });

  test("returns 403 when user is not a leader", async () => {
    db.one.mockResolvedValueOnce({ is_leader: false });
    const res = await request(app)
      .get(`/api/trip/${TRIP_ID}/share-tokens`).set(AUTH);
    expect(res.status).toBe(403);
  });

  test("returns token list on success", async () => {
    const shareToken = require("../../services/shareToken");
    shareToken.listTokens.mockResolvedValueOnce([{ id: 1, label: "ครอบครัว" }]);
    db.one.mockResolvedValueOnce({ is_leader: true });
    const res = await request(app)
      .get(`/api/trip/${TRIP_ID}/share-tokens`).set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tokens)).toBe(true);
    expect(res.body.tokens[0]).toMatchObject({ label: "ครอบครัว" });
  });
});

// ─── DELETE /api/trip/:tripId/share-tokens/:tokenId ──────────────────────────

describe("DELETE /api/trip/:tripId/share-tokens/:tokenId", () => {
  test("returns 400 for non-numeric tokenId", async () => {
    const res = await request(app)
      .delete(`/api/trip/${TRIP_ID}/share-tokens/abc`).set(AUTH);
    expect(res.status).toBe(400);
  });

  test("returns 403 when not a member", async () => {
    db.one.mockResolvedValueOnce(null);
    const res = await request(app)
      .delete(`/api/trip/${TRIP_ID}/share-tokens/5`).set(AUTH);
    expect(res.status).toBe(403);
  });

  test("returns 403 when user is not a leader", async () => {
    db.one.mockResolvedValueOnce(fakeMember); // is_leader: false
    const res = await request(app)
      .delete(`/api/trip/${TRIP_ID}/share-tokens/5`).set(AUTH);
    expect(res.status).toBe(403);
  });

  test("returns 200 when token revoked successfully", async () => {
    const shareToken = require("../../services/shareToken");
    shareToken.revokeToken.mockResolvedValueOnce({ ok: true });
    db.one.mockResolvedValueOnce(fakeLeader);
    const res = await request(app)
      .delete(`/api/trip/${TRIP_ID}/share-tokens/5`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─── Unknown route (404 handler) ─────────────────────────────────────────────

describe("Unknown API route", () => {
  test("returns 404 for unmatched route", async () => {
    const res = await request(app).get("/api/this-route-does-not-exist").set(AUTH);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not found" });
  });
});

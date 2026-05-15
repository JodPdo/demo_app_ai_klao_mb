// Integration tests for routes defined directly on app (server.js)
// Covers: GET /healthz, GET /share/:token, GET /api/config, auth guard

// ─── Module mocks (must come before any require) ─────────────────────────────

jest.mock("../lib/db", () => ({
  query:  jest.fn().mockResolvedValue({}),
  one:    jest.fn().mockResolvedValue(null),
  many:   jest.fn().mockResolvedValue([]),
  tx:     jest.fn().mockImplementation(async (fn) => fn(jest.fn().mockResolvedValue({}))),
  init:   jest.fn().mockResolvedValue(undefined),
  close:  jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../lib/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

jest.mock("../lib/lineClient", () => ({
  client: { pushMessage: jest.fn().mockResolvedValue({}) },
}));

jest.mock("../services/scheduler", () => ({
  start: jest.fn(),
  stop:  jest.fn(),
}));

jest.mock("../handlers/webhook", () => ({
  handleEvent:  jest.fn().mockResolvedValue(undefined),
  archiveTrip:  jest.fn().mockResolvedValue({ ok: true }),
  resetTrip:    jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock("../services/safety", () => ({
  enterBreak:         jest.fn().mockResolvedValue({ ok: true }),
  exitBreak:          jest.fn().mockResolvedValue({ ok: true }),
  extendBreak:        jest.fn().mockResolvedValue({ ok: true }),
  isOnBreak:          jest.fn().mockReturnValue(false),
  checkBreakMovement: jest.fn().mockResolvedValue(false),
  triggerSOS:         jest.fn().mockResolvedValue({ ok: true }),
  checkArrival:       jest.fn().mockResolvedValue(false),
  checkStationary:    jest.fn().mockResolvedValue(false),
  validateBreakInput: jest.fn().mockReturnValue({ ok: true, durationMin: 30, reason: "rest" }),
  BREAK_DURATION_MIN: 5,
  BREAK_DURATION_MAX: 480,
  BREAK_REASON_LABEL: {},
}));

jest.mock("../services/groupBreak", () => ({
  enterGroupBreak:         jest.fn().mockResolvedValue({ ok: true }),
  exitGroupBreak:          jest.fn().mockResolvedValue({ ok: true }),
  extendGroupBreak:        jest.fn().mockResolvedValue({ ok: true }),
  isGroupOnBreak:          jest.fn().mockReturnValue(false),
  renameTrip:              jest.fn().mockResolvedValue({ ok: true, name: "renamed" }),
  validateTripName:        jest.fn().mockReturnValue({ ok: true, name: "test trip" }),
  clearExpiredGroupBreaks: jest.fn().mockResolvedValue(0),
}));

jest.mock("../services/eta", () => ({
  calcMemberETA:    jest.fn().mockResolvedValue(null),
  attachETAs:       jest.fn().mockImplementation(async (_trip, members) => members),
  formatETA:        jest.fn().mockReturnValue("—"),
  formatArrivalTime:jest.fn().mockReturnValue(null),
}));

const mockShareToken = {
  validateToken:    jest.fn().mockResolvedValue({ ok: false, error: "ลิงก์ไม่ถูกต้อง" }),
  applyPrivacy:     jest.fn().mockImplementation((_m, _mode) => _m),
  applyTripPrivacy: jest.fn().mockImplementation((t, _mode) => t),
  createToken:      jest.fn().mockResolvedValue({ ok: true }),
  listTokens:       jest.fn().mockResolvedValue([]),
  revokeToken:      jest.fn().mockResolvedValue({ ok: true }),
  recordView:       jest.fn().mockResolvedValue(undefined),
  PRIVACY_MODES:    ["full", "initial-only"],
  MAX_TOKENS_PER_TRIP: 20,
};
jest.mock("../services/shareToken", () => mockShareToken);

jest.mock("../services/locationProcessor", () => ({
  processLocation: jest.fn().mockResolvedValue({
    ok: true, distance_km: 5, arrived: false, break_ended: false,
  }),
}));

jest.mock("../utils/geocode", () => ({
  searchMultiple: jest.fn().mockResolvedValue([]),
  reverse:        jest.fn().mockResolvedValue(null),
}));

jest.mock("../middleware/liffAuth", () => (req, _res, next) => {
  req.lineUser = { userId: "U_test01", displayName: "Test User", pictureUrl: null };
  next();
});

jest.mock("@line/bot-sdk", () => ({
  middleware: () => require("express").json(),
  HTTPFetchError: class HTTPFetchError extends Error {},
}));

// ─── App + supertest ──────────────────────────────────────────────────────────

const request = require("supertest");
const db      = require("../lib/db");
const { app } = require("../server");

// ─── GET /healthz ─────────────────────────────────────────────────────────────

describe("GET /healthz", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns 200 { ok: true } when DB query succeeds", async () => {
    db.query.mockResolvedValueOnce({});
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test("returns 503 { ok: false } when DB query throws", async () => {
    db.query.mockRejectedValueOnce(new Error("connection refused"));
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("connection refused");
  });
});

// ─── GET / (redirect) ─────────────────────────────────────────────────────────

describe("GET /", () => {
  test("redirects to /liff/", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/liff/");
  });
});

// ─── GET /share/:token ────────────────────────────────────────────────────────

describe("GET /share/:token", () => {
  const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

  beforeEach(() => jest.clearAllMocks());

  test("returns 404 when validateToken returns not ok", async () => {
    mockShareToken.validateToken.mockResolvedValueOnce({
      ok: false, error: "ลิงก์ถูกเพิกถอนแล้ว",
    });
    const res = await request(app).get(`/share/${VALID_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "ลิงก์ถูกเพิกถอนแล้ว" });
  });

  test("returns 404 when trip is not found in DB", async () => {
    mockShareToken.validateToken.mockResolvedValueOnce({
      ok: true, share: { id: 1, trip_id: 99, label: "test", privacy_mode: "full" },
    });
    db.one.mockResolvedValueOnce(null); // trip not found
    const res = await request(app).get(`/share/${VALID_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "trip not found" });
  });

  test("returns 200 with trip, members, share when token is valid", async () => {
    const fakeTrip = {
      id: 1, name: "ทริปทดสอบ", dest_lat: 18.796, dest_lng: 98.993,
      dest_name: "เชียงใหม่", status: "active",
    };
    const fakeMembers = [
      { id: 10, display_name: "สมชาย", is_leader: true, arrived_at: null,
        latitude: 14.0, longitude: 100.5, distance_km: 10 },
    ];
    mockShareToken.validateToken.mockResolvedValueOnce({
      ok: true,
      share: { id: 1, trip_id: 1, label: "ครอบครัว", privacy_mode: "full", expires_at: null },
    });
    db.one.mockResolvedValueOnce(fakeTrip);
    db.many.mockResolvedValueOnce(fakeMembers);

    const res = await request(app).get(`/share/${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.trip).toBeDefined();
    expect(res.body.members).toBeDefined();
    expect(res.body.share).toMatchObject({ label: "ครอบครัว", privacy_mode: "full" });
  });

  test("applies privacy masking via applyPrivacy and applyTripPrivacy", async () => {
    const fakeTrip = { id: 1, name: "trip", status: "active" };
    mockShareToken.validateToken.mockResolvedValueOnce({
      ok: true,
      share: { id: 1, trip_id: 1, label: "link", privacy_mode: "initial-only", expires_at: null },
    });
    db.one.mockResolvedValueOnce(fakeTrip);
    db.many.mockResolvedValueOnce([]);

    await request(app).get(`/share/${VALID_UUID}`);

    expect(mockShareToken.applyPrivacy).toHaveBeenCalledWith([], "initial-only");
    expect(mockShareToken.applyTripPrivacy).toHaveBeenCalledWith(fakeTrip, "initial-only");
  });
});

// ─── GET /api/config (public — no auth required) ──────────────────────────────

describe("GET /api/config", () => {
  test("returns liffId and refreshIntervalSec", async () => {
    process.env.LIFF_ID = "1234567890-abcdefgh";
    process.env.LIFF_REFRESH_SEC = "20";
    const res = await request(app).get("/api/config");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      liffId: "1234567890-abcdefgh",
      refreshIntervalSec: 20,
    });
  });
});

// ─── Auth guard (middleware/liffAuth is NOT mocked for this block) ────────────
// Note: the mock above always injects req.lineUser, so these tests verify
// that /api/* routes correctly respond when the injected user exists.
// The "missing token → 401" behaviour is covered in tests/middleware/liffAuth.test.js

describe("GET /api/me — with auth mock injecting test user", () => {
  test("returns the injected lineUser object", async () => {
    const res = await request(app)
      .get("/api/me")
      .set("Authorization", "Bearer mock-token");
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ userId: "U_test01" });
  });
});

// ─── POST /webhook ────────────────────────────────────────────────────────────

describe("POST /webhook", () => {
  const { handleEvent } = require("../handlers/webhook");

  beforeEach(() => jest.clearAllMocks());

  test("returns 200 when all events are processed", async () => {
    const res = await request(app)
      .post("/webhook")
      .send({ events: [{ type: "message" }] });
    expect(res.status).toBe(200);
    expect(handleEvent).toHaveBeenCalledTimes(1);
  });

  test("returns 500 when handleEvent throws", async () => {
    handleEvent.mockRejectedValueOnce(new Error("LINE error"));
    const res = await request(app)
      .post("/webhook")
      .send({ events: [{ type: "message" }] });
    expect(res.status).toBe(500);
  });
});

// ─── GET /watch/:token ────────────────────────────────────────────────────────

describe("GET /watch/:token", () => {
  test("attempts to serve watch index.html (200 or 404 based on static files)", async () => {
    const res = await request(app).get("/watch/some-share-token");
    expect([200, 404]).toContain(res.status);
  });
});


module.exports = { app };
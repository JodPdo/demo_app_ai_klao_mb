// tests/routes/mobileInvite.test.js
// Tests for POST /trips/:id/invite, GET /public/invite/:token, POST /invite/:token/join

// ---- Mocks (before require) ------------------------------------------------

process.env.LIFF_ID = "2009959343-X901PDCO";

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

// Conditional auth mocks: 401 when no Authorization header (lets us test 401),
// else inject a user. jwtAuth → leader; dualAuth → a different joiner.
jest.mock("../../middleware/jwtAuth", () => (req, res, next) => {
  if (!req.get("authorization")) return res.status(401).json({ error: "missing_token" });
  req.user = { id: "1", lineUserId: "Uleader", displayName: "Leader", source: "mobile" };
  next();
});
jest.mock("../../middleware/dualAuth", () => (req, res, next) => {
  if (!req.get("authorization")) return res.status(401).json({ error: "missing_token" });
  req.user = { id: "2", lineUserId: "Ujoiner", displayName: "Joiner", source: "mobile" };
  next();
});

// ---- App + supertest -------------------------------------------------------

const request = require("supertest");
const db      = require("../../lib/db");
const { app } = require("../../server");

const AUTH    = { Authorization: "Bearer mock-token" };
const TRIP_ID = 7;
const future  = new Date(Date.now() + 86_400_000);  // +1 day
const past    = new Date(Date.now() - 86_400_000);  // -1 day

beforeEach(() => {
  jest.clearAllMocks();
  db.one.mockReset().mockResolvedValue(null);
  db.many.mockReset().mockResolvedValue([]);
  db.query.mockReset().mockResolvedValue({ rows: [] });
  db.tx.mockReset().mockImplementation(async (fn) => fn(jest.fn().mockResolvedValue({ rows: [] })));
});

// ---- POST /api/mobile/trips/:id/invite -------------------------------------

describe("POST /api/mobile/trips/:id/invite", () => {
  test("401 -- no JWT", async () => {
    const res = await request(app).post(`/api/mobile/trips/${TRIP_ID}/invite`);
    expect(res.status).toBe(401);
  });

  test("403 -- non-member", async () => {
    db.one.mockResolvedValueOnce(null); // membership lookup
    const res = await request(app).post(`/api/mobile/trips/${TRIP_ID}/invite`).set(AUTH);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_member");
  });

  test("403 -- member but not leader", async () => {
    db.one.mockResolvedValueOnce({ id: 10, is_leader: false });
    const res = await request(app).post(`/api/mobile/trips/${TRIP_ID}/invite`).set(AUTH);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_leader");
  });

  test("200 -- leader, no existing invite → new token", async () => {
    db.one
      .mockResolvedValueOnce({ id: 10, is_leader: true })                 // membership
      .mockResolvedValueOnce({ id: TRIP_ID, status: "active" })           // trip
      .mockResolvedValueOnce(null)                                        // no active invite
      .mockResolvedValueOnce({ id: 5, token: "X7KD9M2Q", expires_at: future, redeemed_count: 0 }); // insert

    const res = await request(app).post(`/api/mobile/trips/${TRIP_ID}/invite`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBe("X7KD9M2Q");
    expect(res.body.code).toBe(res.body.token);          // code === token (V1)
    expect(res.body.link).toMatch(/liff\.line\.me/);     // LIFF deep link
    expect(res.body.link).toContain("invite=X7KD9M2Q");
    expect(res.body.redeemed_count).toBe(0);
  });

  test("200 -- reuse existing active invite (same token)", async () => {
    db.one
      .mockResolvedValueOnce({ id: 10, is_leader: true })                 // membership
      .mockResolvedValueOnce({ id: TRIP_ID, status: "active" })           // trip
      .mockResolvedValueOnce({ id: 5, token: "EXIST123", expires_at: future, redeemed_count: 3 }); // existing

    const res = await request(app).post(`/api/mobile/trips/${TRIP_ID}/invite`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.token).toBe("EXIST123");
    expect(res.body.redeemed_count).toBe(3);
  });

  test("410 -- trip not active", async () => {
    db.one
      .mockResolvedValueOnce({ id: 10, is_leader: true })
      .mockResolvedValueOnce({ id: TRIP_ID, status: "archived" });
    const res = await request(app).post(`/api/mobile/trips/${TRIP_ID}/invite`).set(AUTH);
    expect(res.status).toBe(410);
  });
});

// ---- GET /api/public/invite/:token -----------------------------------------

describe("GET /api/public/invite/:token", () => {
  test("200 -- valid=true", async () => {
    db.one.mockResolvedValueOnce({
      expires_at: future, trip_id: TRIP_ID, name: "Chiang Mai Run",
      status: "active", dest_name: "เชียงใหม่", member_count: 3,
    });
    const res = await request(app).get("/api/public/invite/X7KD9M2Q");
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.expired).toBe(false);
    expect(res.body.trip).toMatchObject({ id: String(TRIP_ID), name: "Chiang Mai Run", member_count: 3 });
  });

  test("200 -- valid=false expired=true", async () => {
    db.one.mockResolvedValueOnce({
      expires_at: past, trip_id: TRIP_ID, name: "Old", status: "active", dest_name: null, member_count: 1,
    });
    const res = await request(app).get("/api/public/invite/EXPIRED1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false, expired: true, trip: null });
  });

  test("200 -- valid=false expired=false (invalid token)", async () => {
    db.one.mockResolvedValueOnce(null);
    const res = await request(app).get("/api/public/invite/NOPENOPE");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false, expired: false, trip: null });
  });

  test("200 -- valid=false (archived trip)", async () => {
    db.one.mockResolvedValueOnce({
      expires_at: future, trip_id: TRIP_ID, name: "Done", status: "archived", dest_name: null, member_count: 2,
    });
    const res = await request(app).get("/api/public/invite/ARCHVD12");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false, expired: false, trip: null });
  });
});

// ---- POST /api/mobile/invite/:token/join -----------------------------------

describe("POST /api/mobile/invite/:token/join", () => {
  test("401 -- no auth", async () => {
    const res = await request(app).post("/api/mobile/invite/X7KD9M2Q/join");
    expect(res.status).toBe(401);
  });

  test("200 -- first join (was_already_member=false)", async () => {
    db.one
      .mockResolvedValueOnce({ trip_id: TRIP_ID, expires_at: future, trip_name: "Trip", status: "active" }) // invite
      .mockResolvedValueOnce(null);                                                                         // not yet member
    db.tx.mockResolvedValueOnce({ memberId: 99 });

    const res = await request(app).post("/api/mobile/invite/X7KD9M2Q/join").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true, trip_id: String(TRIP_ID), member_id: "99", trip_name: "Trip", was_already_member: false,
    });
  });

  test("200 -- re-join (was_already_member=true, idempotent)", async () => {
    db.one
      .mockResolvedValueOnce({ trip_id: TRIP_ID, expires_at: future, trip_name: "Trip", status: "active" }) // invite
      .mockResolvedValueOnce({ id: 20 });                                                                   // already member
    const res = await request(app).post("/api/mobile/invite/X7KD9M2Q/join").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, member_id: "20", was_already_member: true });
  });

  test("410 -- expired", async () => {
    db.one.mockResolvedValueOnce({ trip_id: TRIP_ID, expires_at: past, trip_name: "Trip", status: "active" });
    const res = await request(app).post("/api/mobile/invite/EXPIRED1/join").set(AUTH);
    expect(res.status).toBe(410);
    expect(res.body.error).toBe("invite expired");
  });

  test("410 -- archived trip", async () => {
    db.one.mockResolvedValueOnce({ trip_id: TRIP_ID, expires_at: future, trip_name: "Trip", status: "archived" });
    const res = await request(app).post("/api/mobile/invite/X7KD9M2Q/join").set(AUTH);
    expect(res.status).toBe(410);
    expect(res.body.error).toBe("trip not active");
  });

  test("404 -- invalid token", async () => {
    db.one.mockResolvedValueOnce(null);
    const res = await request(app).post("/api/mobile/invite/NOPENOPE/join").set(AUTH);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("invite not found");
  });
});

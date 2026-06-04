// tests/routes/liffInit.test.js
// Tests for POST /api/liff/init — LIFF token exchange flow.

// ---- Mocks (before require) ------------------------------------------------

jest.mock("express-rate-limit", () => () => (_req, _res, next) => next());
jest.mock("pino-http", () => () => (req, _res, next) => {
  req.id = "test-req-id";
  next();
});

jest.mock("../../lib/db", () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  one:   jest.fn().mockResolvedValue(null),
  many:  jest.fn().mockResolvedValue([]),
  oneOrNone: jest.fn().mockResolvedValue(null),
  tx:    jest.fn().mockImplementation(async (fn) => fn(jest.fn().mockResolvedValue({ rows: [] }))),
  init:  jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../lib/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

// Mock global fetch for LINE profile API
global.fetch = jest.fn();

// ---- App + supertest -------------------------------------------------------

const request = require("supertest");
const db      = require("../../lib/db");
const { app } = require("../../server");

describe("POST /api/liff/init", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch.mockClear();
  });

  it("400 — missing accessToken", async () => {
    const res = await request(app)
      .post("/api/liff/init")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_access_token");
  });

  it("401 — LINE rejects token (fetch returns ok: false)", async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 401 });
    const res = await request(app)
      .post("/api/liff/init")
      .send({ accessToken: "invalid-token" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_liff_token");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.line.me/v2/profile",
      { headers: { Authorization: "Bearer invalid-token" } }
    );
  });

  it("200 — happy path creates session + sets cookie", async () => {
    const lineProfile = { userId: "Uabc123", displayName: "Test User" };
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => lineProfile,
    });

    const res = await request(app)
      .post("/api/liff/init")
      .send({ accessToken: "valid-token" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.lineUserId).toBe("Uabc123");
    expect(res.body.displayName).toBe("Test User");

    // Verify db.query was called to cleanup and insert session
    expect(db.query).toHaveBeenCalledTimes(2);
    const firstCall = db.query.mock.calls[0];
    expect(firstCall[0]).toContain("DELETE FROM aiklao_liff_sessions");

    // Verify Set-Cookie header
    expect(res.headers["set-cookie"]).toBeDefined();
    const cookieHeader = res.headers["set-cookie"][0];
    expect(cookieHeader).toMatch(/aiklao_liff_session=/);
    expect(cookieHeader).toMatch(/HttpOnly/);
    expect(cookieHeader).toMatch(/SameSite=None/);
    expect(cookieHeader).toMatch(/Secure/);
  });

  it("500 — LINE API throws network error", async () => {
    global.fetch.mockRejectedValueOnce(new Error("network error"));
    const res = await request(app)
      .post("/api/liff/init")
      .send({ accessToken: "any-token" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("liff_init_failed");
  });
});

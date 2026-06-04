// tests/routes/lineNotify.test.js
// Tests for POST /api/internal/line-notify — LINE Bot Push trigger.

// ---- Mocks (before require) -----------------------------------------

jest.mock("express-rate-limit", () => () => (_req, _res, next) => next());
jest.mock("pino-http", () => () => (req, _res, next) => {
  req.id = "test-req-id";
  next();
});

jest.mock("../../lib/db", () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  one: jest.fn(),
  many: jest.fn(),
  oneOrNone: jest.fn(),
  tx: jest.fn(),
  init: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../lib/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

// Mock global fetch for LINE Push API
global.fetch = jest.fn();

// Set required env vars BEFORE app require
process.env.INTERNAL_SECRET = "test-internal-secret";
process.env.CHANNEL_ACCESS_TOKEN = "test-channel-access-token";
process.env.LIFF_ID = "2009959343-X901PDCO";

const request = require("supertest");
const { app } = require("../../server");

const ENDPOINT = "/api/internal/line-notify";
const validBody = {
  lineUserId: "Uabc123",
  tripId: "42",
  tripName: "Test Trip",
};

describe("POST /api/internal/line-notify", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch.mockClear();
  });

  it("401 — missing X-Internal-Secret header", async () => {
    const res = await request(app).post(ENDPOINT).send(validBody);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_internal_secret");
  });

  it("401 — wrong X-Internal-Secret value", async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set("X-Internal-Secret", "wrong-secret")
      .send(validBody);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_internal_secret");
  });

  it("400 — missing lineUserId", async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set("X-Internal-Secret", "test-internal-secret")
      .send({ tripId: "42", tripName: "Test" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_line_user_id");
  });

  it("502 — LINE Push API rejects", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => '{"message":"Invalid recipient"}',
    });
    const res = await request(app)
      .post(ENDPOINT)
      .set("X-Internal-Secret", "test-internal-secret")
      .send(validBody);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("line_push_failed");
    expect(res.body.upstream_status).toBe(400);
  });

  it("200 — happy path pushes Flex Message", async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    const res = await request(app)
      .post(ENDPOINT)
      .set("X-Internal-Secret", "test-internal-secret")
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.lineUserId).toBe("Uabc123");
    expect(res.body.tripId).toBe("42");

    // Verify LINE Push API was called correctly
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.line.me/v2/bot/message/push");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer test-channel-access-token");
    const payload = JSON.parse(opts.body);
    expect(payload.to).toBe("Uabc123");
    expect(payload.messages[0].type).toBe("flex");
    expect(payload.messages[0].altText).toContain("Test Trip");
    expect(payload.messages[0].contents.footer.contents).toHaveLength(1);
    expect(payload.messages[0].contents.footer.contents[0].action.uri).toMatch(/liff.line.me/);
  });
});

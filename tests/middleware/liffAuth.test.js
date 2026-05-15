jest.mock("../../lib/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const liffAuth = require("../../middleware/liffAuth");

// Helper: create a minimal Express-like req/res/next triple
function makeCtx(headers = {}) {
  const req = { headers };
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body)  { this._body = body; return this; },
  };
  const next = jest.fn();
  return { req, res, next };
}

// ─── No token ────────────────────────────────────────────────────────────────

describe("liffAuth — missing token", () => {
  test("returns 401 when Authorization header is absent", async () => {
    const { req, res, next } = makeCtx();
    await liffAuth(req, res, next);
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: "missing access token" });
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 401 when Authorization is not Bearer scheme", async () => {
    const { req, res, next } = makeCtx({ authorization: "Basic abc123" });
    await liffAuth(req, res, next);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 401 when Bearer token is empty string", async () => {
    const { req, res, next } = makeCtx({ authorization: "Bearer " });
    await liffAuth(req, res, next);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// ─── Token verify flow (mocked fetch) ────────────────────────────────────────

describe("liffAuth — token verification via fetch", () => {
  const VALID_TOKEN = "valid-test-token-xyz";
  const TEST_USER = {
    userId: "Uabc123",
    displayName: "สมชาย",
    pictureUrl: "https://example.com/pic.jpg",
  };

  beforeEach(() => {
    global.fetch = jest.fn();
    jest.clearAllMocks();
    // Bust the liffAuth module-level cache between tests
    jest.resetModules();
  });

  afterEach(() => {
    delete global.fetch;
  });

  test("returns 401 when LINE verify endpoint returns non-ok", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false });

    const freshLiffAuth = jest.requireActual("../../middleware/liffAuth");
    const { req, res, next } = makeCtx({ authorization: `Bearer ${VALID_TOKEN}` });
    await freshLiffAuth(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: "invalid token" });
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 401 when token is expired (expires_in ≤ 0)", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ expires_in: 0, client_id: "test-channel" }),
    });

    const freshLiffAuth = jest.requireActual("../../middleware/liffAuth");
    const { req, res, next } = makeCtx({ authorization: `Bearer ${VALID_TOKEN}` });
    await freshLiffAuth(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: "token expired" });
  });

  test("returns 401 when profile fetch fails", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ expires_in: 3600, client_id: "test-channel" }),
      })
      .mockResolvedValueOnce({ ok: false });

    const freshLiffAuth = jest.requireActual("../../middleware/liffAuth");
    const { req, res, next } = makeCtx({ authorization: `Bearer ${VALID_TOKEN}` });
    await freshLiffAuth(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: "profile fetch failed" });
  });

  test("calls next() and attaches lineUser when both verify + profile succeed", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ expires_in: 3600, client_id: "test-channel" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => TEST_USER,
      });

    const freshLiffAuth = jest.requireActual("../../middleware/liffAuth");
    const { req, res, next } = makeCtx({ authorization: `Bearer ${VALID_TOKEN}` });
    await freshLiffAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.lineUser).toMatchObject({
      userId: TEST_USER.userId,
      displayName: TEST_USER.displayName,
    });
  });

  test("returns 500 when fetch throws an unexpected error", async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error("network error"));

    const freshLiffAuth = jest.requireActual("../../middleware/liffAuth");
    const { req, res, next } = makeCtx({ authorization: `Bearer ${VALID_TOKEN}` });
    await freshLiffAuth(req, res, next);

    expect(res._status).toBe(500);
    expect(res._body).toMatchObject({ error: "auth error" });
  });

  test("serves cached lineUser on second call with the same token", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ expires_in: 3600, client_id: "ch" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => TEST_USER });

    const freshLiffAuth = jest.requireActual("../../middleware/liffAuth");

    // First call — populates cache
    const ctx1 = makeCtx({ authorization: `Bearer ${VALID_TOKEN}` });
    await freshLiffAuth(ctx1.req, ctx1.res, ctx1.next);
    expect(ctx1.next).toHaveBeenCalledTimes(1);

    // Second call — should use cache (no extra fetch)
    const ctx2 = makeCtx({ authorization: `Bearer ${VALID_TOKEN}` });
    await freshLiffAuth(ctx2.req, ctx2.res, ctx2.next);
    expect(ctx2.next).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2); // only the first request fetched
    expect(ctx2.req.lineUser).toMatchObject({ userId: TEST_USER.userId });
  });

  test("returns 401 when LINE_LOGIN_CHANNEL_ID is set and client_id does not match", async () => {
    process.env.LINE_LOGIN_CHANNEL_ID = "expected-channel-id";
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ expires_in: 3600, client_id: "wrong-channel-id" }),
    });

    const freshLiffAuth = jest.requireActual("../../middleware/liffAuth");
    const { req, res, next } = makeCtx({ authorization: `Bearer ${VALID_TOKEN}` });
    await freshLiffAuth(req, res, next);

    delete process.env.LINE_LOGIN_CHANNEL_ID;
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: "channel mismatch" });
    expect(next).not.toHaveBeenCalled();
  });
});

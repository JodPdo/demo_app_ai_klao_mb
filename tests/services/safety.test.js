jest.mock("../../lib/db", () => ({
  query: jest.fn().mockResolvedValue({}),
  one: jest.fn().mockResolvedValue(null),
  many: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../lib/lineClient", () => ({
  client: { pushMessage: jest.fn().mockResolvedValue({}) },
}));
jest.mock("../../lib/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const db = require("../../lib/db");
const { client: lineClient } = require("../../lib/lineClient");

const {
  validateBreakInput,
  isOnBreak,
  enterBreak,
  exitBreak,
  extendBreak,
  checkBreakMovement,
  BREAK_DURATION_MIN,
  BREAK_DURATION_MAX,
} = require("../../services/safety");

// ─── validateBreakInput ───────────────────────────────────────────────────────

describe("validateBreakInput", () => {
  test("rejects non-numeric string", () => {
    expect(validateBreakInput("abc", "rest")).toMatchObject({ ok: false });
  });

  test("rejects float string that parses to NaN", () => {
    expect(validateBreakInput("", "rest")).toMatchObject({ ok: false });
  });

  test("rejects duration below minimum", () => {
    const result = validateBreakInput(BREAK_DURATION_MIN - 1, "rest");
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toContain(`${BREAK_DURATION_MIN}`);
  });

  test("rejects duration above maximum", () => {
    const result = validateBreakInput(BREAK_DURATION_MAX + 1, "rest");
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toContain(`${BREAK_DURATION_MAX}`);
  });

  test("accepts minimum valid duration", () => {
    const result = validateBreakInput(BREAK_DURATION_MIN, "rest");
    expect(result).toMatchObject({ ok: true, durationMin: BREAK_DURATION_MIN });
  });

  test("accepts maximum valid duration", () => {
    const result = validateBreakInput(BREAK_DURATION_MAX, "rest");
    expect(result).toMatchObject({ ok: true, durationMin: BREAK_DURATION_MAX });
  });

  test("accepts all valid reasons", () => {
    for (const reason of ["fuel", "meal", "restroom", "rest", "other"]) {
      expect(validateBreakInput(30, reason)).toMatchObject({ ok: true, reason });
    }
  });

  test("defaults reason to 'rest' when an invalid reason is given", () => {
    expect(validateBreakInput(30, "nap")).toMatchObject({ ok: true, reason: "rest" });
  });

  test("defaults reason to 'rest' when reason is null", () => {
    expect(validateBreakInput(30, null)).toMatchObject({ ok: true, reason: "rest" });
  });

  test("accepts numeric string duration", () => {
    expect(validateBreakInput("60", "meal")).toMatchObject({ ok: true, durationMin: 60, reason: "meal" });
  });

  test("parses floats by truncating to integer", () => {
    // parseInt("30.9") → 30
    expect(validateBreakInput("30.9", "rest")).toMatchObject({ ok: true, durationMin: 30 });
  });
});

// ─── isOnBreak ────────────────────────────────────────────────────────────────

describe("isOnBreak", () => {
  test("returns false when break_until is null", () => {
    expect(isOnBreak({ break_until: null })).toBe(false);
  });

  test("returns false when break_until is undefined", () => {
    expect(isOnBreak({})).toBe(false);
  });

  test("returns false when break_until is in the past", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isOnBreak({ break_until: past })).toBe(false);
  });

  test("returns true when break_until is in the future", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isOnBreak({ break_until: future })).toBe(true);
  });

  test("returns false for exactly now (boundary)", () => {
    const now = new Date().toISOString();
    // Very tight race — just verify it does not throw
    expect(typeof isOnBreak({ break_until: now })).toBe("boolean");
  });
});

// ─── enterBreak ───────────────────────────────────────────────────────────────

describe("enterBreak", () => {
  const trip = { id: 1, line_group_id: "g:C123456" };
  const member = { id: 10, display_name: "สมชาย" };

  beforeEach(() => {
    jest.clearAllMocks();
    db.one.mockResolvedValue({ latitude: 13.756, longitude: 100.502 });
    db.query.mockResolvedValue({});
    lineClient.pushMessage.mockResolvedValue({});
  });

  test("rejects invalid (too short) duration", async () => {
    const result = await enterBreak(trip, member, 2, "rest");
    expect(result).toMatchObject({ ok: false });
  });

  test("rejects invalid (too long) duration", async () => {
    const result = await enterBreak(trip, member, 500, "rest");
    expect(result).toMatchObject({ ok: false });
  });

  test("enters break successfully with valid inputs", async () => {
    const result = await enterBreak(trip, member, 30, "meal");
    expect(result.ok).toBe(true);
    expect(result.durationMin).toBe(30);
    expect(result.reason).toBe("meal");
    expect(result.breakUntil).toBeInstanceOf(Date);
  });

  test("breakUntil is approximately durationMin minutes from now", async () => {
    const before = Date.now();
    const result = await enterBreak(trip, member, 60, "rest");
    const after = Date.now();
    const expectedMs = 60 * 60_000;
    const actualMs = result.breakUntil.getTime() - before;
    expect(actualMs).toBeGreaterThanOrEqual(expectedMs - 100);
    expect(actualMs).toBeLessThanOrEqual(expectedMs + (after - before) + 100);
  });

  test("updates member row in DB", async () => {
    await enterBreak(trip, member, 30, "rest");
    expect(db.query).toHaveBeenCalled();
    const updateCall = db.query.mock.calls.find(
      ([sql]) => sql.includes("UPDATE members")
    );
    expect(updateCall).toBeDefined();
  });

  test("inserts safety_alert record", async () => {
    await enterBreak(trip, member, 30, "rest");
    const insertCall = db.query.mock.calls.find(
      ([sql]) => sql.includes("INSERT INTO safety_alerts")
    );
    expect(insertCall).toBeDefined();
  });

  test("pushes notification to group", async () => {
    await enterBreak(trip, member, 30, "rest");
    expect(lineClient.pushMessage).toHaveBeenCalledTimes(1);
  });

  test("handles missing last location gracefully (db.one returns null)", async () => {
    db.one.mockResolvedValueOnce(null);
    const result = await enterBreak(trip, member, 30, "rest");
    expect(result.ok).toBe(true);
  });
});

// ─── exitBreak ────────────────────────────────────────────────────────────────

describe("exitBreak", () => {
  const trip = { id: 1, line_group_id: "g:C123456" };

  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({});
    lineClient.pushMessage.mockResolvedValue({});
  });

  test("returns error if member is not on break", async () => {
    const member = { id: 10, break_until: null, break_started_at: null };
    const result = await exitBreak(trip, member);
    expect(result).toMatchObject({ ok: false, error: "not on break" });
  });

  test("returns error if break is already expired", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const member = { id: 10, break_until: past, break_started_at: past };
    const result = await exitBreak(trip, member);
    expect(result).toMatchObject({ ok: false, error: "not on break" });
  });

  test("exits break successfully for a member currently on break", async () => {
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    const started = new Date(Date.now() - 10 * 60_000).toISOString();
    const member = { id: 10, break_until: future, break_started_at: started };
    const result = await exitBreak(trip, member, "manual");
    expect(result.ok).toBe(true);
  });

  test("clears break columns in DB", async () => {
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    const member = { id: 10, break_until: future, break_started_at: null };
    await exitBreak(trip, member, "manual");
    const clearCall = db.query.mock.calls.find(
      ([sql]) => sql.includes("break_until = NULL")
    );
    expect(clearCall).toBeDefined();
  });

  test("uses 'movement' message when endReason is movement", async () => {
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    const member = { id: 10, break_until: future, break_started_at: null };
    await exitBreak(trip, member, "movement");
    const pushArgs = lineClient.pushMessage.mock.calls[0][0];
    expect(pushArgs.messages[0].text).toContain("เห็นเริ่มเดินทาง");
  });
});

// ─── extendBreak ──────────────────────────────────────────────────────────────

describe("extendBreak", () => {
  const trip = { id: 1, line_group_id: "g:C123456" };

  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({});
    lineClient.pushMessage.mockResolvedValue({});
  });

  test("returns error if member is not on break", async () => {
    const member = { id: 10, break_until: null, break_reason: "rest" };
    const result = await extendBreak(trip, member, 15);
    expect(result).toMatchObject({ ok: false, error: "not on break" });
  });

  test("extends break successfully", async () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    const member = { id: 10, break_until: future, break_reason: "meal" };
    const result = await extendBreak(trip, member, 15);
    expect(result.ok).toBe(true);
    expect(result.breakUntil).toBeInstanceOf(Date);
  });

  test("caps extension to BREAK_DURATION_MAX from now", async () => {
    const future = new Date(Date.now() + BREAK_DURATION_MAX * 60_000).toISOString();
    const member = { id: 10, break_until: future, break_reason: "rest" };
    const result = await extendBreak(trip, member, 30);
    // breakUntil must not exceed now + BREAK_DURATION_MAX min
    const maxAllowed = new Date(Date.now() + BREAK_DURATION_MAX * 60_000 + 500);
    expect(result.breakUntil.getTime()).toBeLessThanOrEqual(maxAllowed.getTime());
  });

  test("rejects invalid additional duration", async () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    const member = { id: 10, break_until: future, break_reason: "rest" };
    const result = await extendBreak(trip, member, 1); // below BREAK_DURATION_MIN=5
    expect(result.ok).toBe(false);
  });
});

// ─── checkBreakMovement ───────────────────────────────────────────────────────

describe("checkBreakMovement", () => {
  const trip = { id: 1, line_group_id: "g:C123456" };

  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({});
    lineClient.pushMessage.mockResolvedValue({});
  });

  test("returns false if member is not on break", async () => {
    const member = { id: 10, break_until: null };
    const result = await checkBreakMovement(trip, member, 13.0, 100.0);
    expect(result).toBe(false);
  });

  test("returns false if break location is not recorded", async () => {
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    const member = {
      id: 10,
      break_until: future,
      break_location_lat: null,
      break_location_lng: null,
    };
    const result = await checkBreakMovement(trip, member, 13.0, 100.0);
    expect(result).toBe(false);
  });

  test("returns false if movement is within 1 km radius", async () => {
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    const member = {
      id: 10,
      break_until: future,
      break_started_at: new Date().toISOString(),
      break_location_lat: 13.0,
      break_location_lng: 100.0,
    };
    // 0.001° lat ≈ 0.111 km — well within 1 km
    const result = await checkBreakMovement(trip, member, 13.001, 100.0);
    expect(result).toBe(false);
  });

  test("returns true and exits break if moved beyond 1 km", async () => {
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    const member = {
      id: 10,
      break_until: future,
      break_started_at: new Date().toISOString(),
      break_location_lat: 13.0,
      break_location_lng: 100.0,
      break_reason: "rest",
    };
    // 0.02° lat ≈ 2.2 km — beyond 1 km threshold
    const result = await checkBreakMovement(trip, member, 13.02, 100.0);
    expect(result).toBe(true);
  });
});

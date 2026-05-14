jest.mock("../../lib/db", () => ({
  query: jest.fn().mockResolvedValue({}),
  one: jest.fn().mockResolvedValue(null),
  many: jest.fn().mockResolvedValue([]),
  tx: jest.fn().mockImplementation(async (fn) => {
    await fn(jest.fn().mockResolvedValue({}));
  }),
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
  isGroupOnBreak,
  validateTripName,
  enterGroupBreak,
  exitGroupBreak,
  extendGroupBreak,
  clearExpiredGroupBreaks,
  renameTrip,
  TRIP_NAME_MIN,
  TRIP_NAME_MAX,
} = require("../../services/groupBreak");

// ─── isGroupOnBreak ───────────────────────────────────────────────────────────

describe("isGroupOnBreak", () => {
  test("returns false when group_break_until is null", () => {
    expect(isGroupOnBreak({ group_break_until: null })).toBe(false);
  });

  test("returns false when group_break_until is undefined", () => {
    expect(isGroupOnBreak({})).toBe(false);
  });

  test("returns false when group break is in the past", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isGroupOnBreak({ group_break_until: past })).toBe(false);
  });

  test("returns true when group break is in the future", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isGroupOnBreak({ group_break_until: future })).toBe(true);
  });
});

// ─── validateTripName ─────────────────────────────────────────────────────────

describe("validateTripName", () => {
  test("rejects non-string input (number)", () => {
    expect(validateTripName(123)).toMatchObject({ ok: false });
  });

  test("rejects null", () => {
    expect(validateTripName(null)).toMatchObject({ ok: false });
  });

  test("rejects empty string", () => {
    expect(validateTripName("")).toMatchObject({ ok: false });
  });

  test("rejects whitespace-only string", () => {
    expect(validateTripName("   ")).toMatchObject({ ok: false });
  });

  test("rejects name exceeding maximum length", () => {
    const longName = "ก".repeat(TRIP_NAME_MAX + 1);
    expect(validateTripName(longName)).toMatchObject({ ok: false });
    expect(validateTripName(longName).error).toContain(`${TRIP_NAME_MAX}`);
  });

  test("accepts a normal trip name", () => {
    expect(validateTripName("ทริปเหนือ")).toMatchObject({ ok: true, name: "ทริปเหนือ" });
  });

  test("trims leading and trailing whitespace", () => {
    const result = validateTripName("  ทริปเหนือ  ");
    expect(result).toMatchObject({ ok: true, name: "ทริปเหนือ" });
  });

  test("accepts exactly TRIP_NAME_MAX characters", () => {
    const maxName = "ก".repeat(TRIP_NAME_MAX);
    expect(validateTripName(maxName)).toMatchObject({ ok: true });
  });

  test("accepts a single character (minimum)", () => {
    expect(validateTripName("ก")).toMatchObject({ ok: true, name: "ก" });
  });

  test("rejects names with newline character", () => {
    expect(validateTripName("ทริป\nเหนือ")).toMatchObject({ ok: false });
  });

  test("rejects names with tab character", () => {
    expect(validateTripName("ทริป\tเหนือ")).toMatchObject({ ok: false });
  });

  test("rejects names with null byte", () => {
    expect(validateTripName("ทริป\x00เหนือ")).toMatchObject({ ok: false });
  });

  test("accepts names with Latin characters", () => {
    expect(validateTripName("Trip 2025")).toMatchObject({ ok: true, name: "Trip 2025" });
  });
});

// ─── enterGroupBreak ─────────────────────────────────────────────────────────

describe("enterGroupBreak", () => {
  const trip = { id: 1, line_group_id: "g:C123456" };
  const leader = { id: 10, is_leader: true, line_user_id: "U123", display_name: "ผู้นำ" };
  const member = { id: 11, is_leader: false, line_user_id: "U456" };

  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({});
    lineClient.pushMessage.mockResolvedValue({});
  });

  test("rejects non-leader", async () => {
    const result = await enterGroupBreak(trip, member, 30, "rest");
    expect(result).toMatchObject({ ok: false, error: "leader only" });
  });

  test("rejects invalid duration", async () => {
    const result = await enterGroupBreak(trip, leader, 2, "rest"); // < BREAK_DURATION_MIN=5
    expect(result).toMatchObject({ ok: false });
  });

  test("enters group break successfully", async () => {
    const result = await enterGroupBreak(trip, leader, 30, "meal");
    expect(result.ok).toBe(true);
    expect(result.durationMin).toBe(30);
    expect(result.reason).toBe("meal");
    expect(result.breakUntil).toBeInstanceOf(Date);
  });

  test("calls db.tx for atomic update", async () => {
    await enterGroupBreak(trip, leader, 30, "rest");
    expect(db.tx).toHaveBeenCalledTimes(1);
  });

  test("pushes one group notification", async () => {
    await enterGroupBreak(trip, leader, 30, "rest");
    expect(lineClient.pushMessage).toHaveBeenCalledTimes(1);
  });

  test("notification mentions leader display_name", async () => {
    await enterGroupBreak(trip, leader, 30, "rest");
    const pushArgs = lineClient.pushMessage.mock.calls[0][0];
    expect(pushArgs.messages[0].text).toContain("ผู้นำ");
  });
});

// ─── exitGroupBreak ───────────────────────────────────────────────────────────

describe("exitGroupBreak", () => {
  const leader = { id: 10, is_leader: true, line_user_id: "U123", display_name: "ผู้นำ" };
  const member = { id: 11, is_leader: false };

  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({});
    lineClient.pushMessage.mockResolvedValue({});
  });

  test("rejects non-leader", async () => {
    const trip = { id: 1, group_break_until: new Date(Date.now() + 60_000).toISOString() };
    const result = await exitGroupBreak(trip, member);
    expect(result).toMatchObject({ ok: false, error: "leader only" });
  });

  test("rejects when group is not on break", async () => {
    const trip = { id: 1, group_break_until: null };
    const result = await exitGroupBreak(trip, leader);
    expect(result).toMatchObject({ ok: false });
  });

  test("exits group break successfully", async () => {
    const trip = {
      id: 1,
      line_group_id: "g:C123456",
      group_break_until: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
    const result = await exitGroupBreak(trip, leader);
    expect(result.ok).toBe(true);
  });

  test("calls db.tx for atomic update", async () => {
    const trip = {
      id: 1,
      line_group_id: "g:C123456",
      group_break_until: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
    await exitGroupBreak(trip, leader);
    expect(db.tx).toHaveBeenCalledTimes(1);
  });
});

// ─── extendGroupBreak ─────────────────────────────────────────────────────────

describe("extendGroupBreak", () => {
  const leader = { id: 10, is_leader: true, line_user_id: "U123", display_name: "ผู้นำ" };
  const member = { id: 11, is_leader: false };

  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({});
    lineClient.pushMessage.mockResolvedValue({});
  });

  test("rejects non-leader", async () => {
    const trip = { id: 1, group_break_until: new Date(Date.now() + 60_000).toISOString() };
    const result = await extendGroupBreak(trip, member, 15);
    expect(result).toMatchObject({ ok: false, error: "leader only" });
  });

  test("rejects when group is not on break", async () => {
    const trip = { id: 1, group_break_until: null };
    const result = await extendGroupBreak(trip, leader, 15);
    expect(result).toMatchObject({ ok: false });
  });

  test("rejects invalid extension duration", async () => {
    const trip = {
      id: 1,
      line_group_id: "g:C123456",
      group_break_until: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    const result = await extendGroupBreak(trip, leader, 1); // < BREAK_DURATION_MIN=5
    expect(result).toMatchObject({ ok: false });
  });

  test("extends group break successfully", async () => {
    const trip = {
      id: 1,
      line_group_id: "g:C123456",
      group_break_until: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    const result = await extendGroupBreak(trip, leader, 15);
    expect(result.ok).toBe(true);
    expect(result.breakUntil).toBeInstanceOf(Date);
  });

  test("new breakUntil is further than the original", async () => {
    const original = new Date(Date.now() + 10 * 60_000);
    const trip = {
      id: 1,
      line_group_id: "g:C123456",
      group_break_until: original.toISOString(),
    };
    const result = await extendGroupBreak(trip, leader, 15);
    expect(result.breakUntil.getTime()).toBeGreaterThan(original.getTime());
  });
});

// ─── clearExpiredGroupBreaks ──────────────────────────────────────────────────

describe("clearExpiredGroupBreaks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({});
    db.many.mockResolvedValue([]);
  });

  test("returns 0 when no trips have expired group breaks", async () => {
    db.many.mockResolvedValueOnce([]);
    const count = await clearExpiredGroupBreaks();
    expect(count).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });

  test("clears expired trips and returns count", async () => {
    db.many.mockResolvedValueOnce([
      { id: 10, line_group_id: "g:C111" },
      { id: 11, line_group_id: null },
    ]);
    const count = await clearExpiredGroupBreaks();
    expect(count).toBe(2);
    // 2 trips × (UPDATE trips + INSERT alert) = 4 query calls
    expect(db.query.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── renameTrip ───────────────────────────────────────────────────────────────

describe("renameTrip", () => {
  const trip = { id: 1, name: "ชื่อเดิม", line_group_id: "g:C123456" };
  const leader = { id: 10, is_leader: true, line_user_id: "U123", display_name: "ผู้นำ" };
  const nonLeader = { id: 11, is_leader: false };

  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({});
    lineClient.pushMessage.mockResolvedValue({});
  });

  test("rejects non-leader", async () => {
    const result = await renameTrip(trip, nonLeader, "ชื่อใหม่");
    expect(result).toMatchObject({ ok: false, error: "leader only" });
  });

  test("rejects invalid name (empty string)", async () => {
    const result = await renameTrip(trip, leader, "");
    expect(result).toMatchObject({ ok: false });
  });

  test("rejects same name as current", async () => {
    const result = await renameTrip(trip, leader, "ชื่อเดิม");
    expect(result).toMatchObject({ ok: false, error: "ชื่อเดิมอยู่แล้ว" });
  });

  test("renames successfully, runs 2 DB queries, and sends LINE push", async () => {
    const result = await renameTrip(trip, leader, "ชื่อใหม่");
    expect(result.ok).toBe(true);
    expect(result.name).toBe("ชื่อใหม่");
    expect(result.oldName).toBe("ชื่อเดิม");
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(lineClient.pushMessage).toHaveBeenCalledTimes(1);
  });

  test("skips LINE push when trip has no line_group_id", async () => {
    const tripNoGroup = { ...trip, line_group_id: null };
    const result = await renameTrip(tripNoGroup, leader, "ชื่อใหม่");
    expect(result.ok).toBe(true);
    expect(lineClient.pushMessage).not.toHaveBeenCalled();
  });
});

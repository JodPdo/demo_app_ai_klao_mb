jest.mock("../../lib/db", () => ({
  query: jest.fn().mockResolvedValue({}),
  one: jest.fn().mockResolvedValue(null),
  many: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../lib/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const db = require("../../lib/db");
const {
  validateToken,
  applyPrivacy,
  applyTripPrivacy,
  PRIVACY_MODES,
  MAX_TOKENS_PER_TRIP,
} = require("../../services/shareToken");

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

// ─── constants ────────────────────────────────────────────────────────────────

describe("PRIVACY_MODES", () => {
  test("contains 'full'", () => {
    expect(PRIVACY_MODES).toContain("full");
  });

  test("contains 'initial-only'", () => {
    expect(PRIVACY_MODES).toContain("initial-only");
  });

  test("has exactly 2 modes", () => {
    expect(PRIVACY_MODES).toHaveLength(2);
  });
});

describe("MAX_TOKENS_PER_TRIP", () => {
  test("is a positive number", () => {
    expect(MAX_TOKENS_PER_TRIP).toBeGreaterThan(0);
  });
});

// ─── validateToken ────────────────────────────────────────────────────────────

describe("validateToken — format validation (no DB)", () => {
  test("returns error for null", async () => {
    await expect(validateToken(null)).resolves.toMatchObject({
      ok: false,
      error: "missing token",
    });
  });

  test("returns error for undefined", async () => {
    await expect(validateToken(undefined)).resolves.toMatchObject({
      ok: false,
      error: "missing token",
    });
  });

  test("returns error for empty string", async () => {
    await expect(validateToken("")).resolves.toMatchObject({
      ok: false,
      error: "missing token",
    });
  });

  test("returns error for non-string (number)", async () => {
    await expect(validateToken(123)).resolves.toMatchObject({
      ok: false,
      error: "missing token",
    });
  });

  test("returns error for invalid UUID format (too short)", async () => {
    await expect(validateToken("not-a-uuid")).resolves.toMatchObject({
      ok: false,
      error: "invalid token format",
    });
  });

  test("returns error for UUID with non-hex characters", async () => {
    await expect(
      validateToken("550e8400-e29b-41d4-a716-44665544000Z")
    ).resolves.toMatchObject({ ok: false, error: "invalid token format" });
  });

  test("returns error for UUID without dashes", async () => {
    await expect(
      validateToken("550e8400e29b41d4a716446655440000")
    ).resolves.toMatchObject({ ok: false, error: "invalid token format" });
  });
});

describe("validateToken — DB-dependent cases", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns error when token not found (DB returns null)", async () => {
    db.one.mockResolvedValueOnce(null);
    const result = await validateToken(VALID_UUID);
    expect(result).toMatchObject({ ok: false, error: "ลิงก์ไม่ถูกต้อง" });
  });

  test("returns error for revoked token", async () => {
    db.one.mockResolvedValueOnce({
      id: 1,
      trip_id: 1,
      label: "test",
      privacy_mode: "full",
      expires_at: null,
      revoked_at: new Date().toISOString(),
      trip_status: "active",
    });
    const result = await validateToken(VALID_UUID);
    expect(result).toMatchObject({ ok: false, error: "ลิงก์ถูกเพิกถอนแล้ว" });
  });

  test("returns error when trip is archived", async () => {
    db.one.mockResolvedValueOnce({
      id: 1,
      trip_id: 1,
      label: "test",
      privacy_mode: "full",
      expires_at: null,
      revoked_at: null,
      trip_status: "archived",
    });
    const result = await validateToken(VALID_UUID);
    expect(result).toMatchObject({ ok: false, error: "ทริปจบแล้ว" });
  });

  test("returns error for expired token", async () => {
    db.one.mockResolvedValueOnce({
      id: 1,
      trip_id: 1,
      label: "test",
      privacy_mode: "full",
      expires_at: new Date(Date.now() - 3600_000).toISOString(), // 1 hour ago
      revoked_at: null,
      trip_status: "active",
    });
    const result = await validateToken(VALID_UUID);
    expect(result).toMatchObject({ ok: false, error: "ลิงก์หมดอายุแล้ว" });
  });

  test("returns ok for a valid, active, non-expired token", async () => {
    const share = {
      id: 1,
      trip_id: 1,
      label: "ครอบครัว",
      privacy_mode: "full",
      expires_at: new Date(Date.now() + 3600_000).toISOString(), // 1 hour from now
      revoked_at: null,
      trip_status: "active",
    };
    db.one.mockResolvedValueOnce(share);
    const result = await validateToken(VALID_UUID);
    expect(result).toMatchObject({ ok: true, share });
  });

  test("returns ok for a token with no expiry (null expires_at)", async () => {
    const share = {
      id: 2,
      trip_id: 1,
      label: "ลิงก์แชร์",
      privacy_mode: "initial-only",
      expires_at: null,
      revoked_at: null,
      trip_status: "active",
    };
    db.one.mockResolvedValueOnce(share);
    const result = await validateToken(VALID_UUID);
    expect(result).toMatchObject({ ok: true, share });
  });
});

// ─── applyPrivacy ─────────────────────────────────────────────────────────────

const sampleMembers = [
  {
    id: 1,
    display_name: "สมชาย",
    picture_url: "https://example.com/pic.jpg",
    is_leader: true,
    arrived_at: null,
    latitude: 13.756,
    longitude: 100.502,
    distance_km: 10,
    location_at: "2025-01-01T12:00:00Z",
    minutes_ago: 2,
    eta_min: 30,
    avg_speed_kmh: 60,
    live_share_until: null,
    break_until: null,
    break_reason: "fuel",
  },
  {
    id: 2,
    display_name: "มาลี",
    picture_url: null,
    is_leader: false,
    arrived_at: "2025-01-01T13:00:00Z",
    latitude: 13.8,
    longitude: 100.6,
    distance_km: 0,
    location_at: "2025-01-01T13:00:00Z",
    minutes_ago: 0,
    eta_min: null,
    avg_speed_kmh: null,
    live_share_until: null,
    break_until: null,
    break_reason: null,
  },
];

describe("applyPrivacy", () => {
  test("returns empty array for null members", () => {
    expect(applyPrivacy(null, "full")).toEqual([]);
  });

  test("returns empty array for empty array", () => {
    expect(applyPrivacy([], "full")).toEqual([]);
  });

  describe("full mode", () => {
    let result;
    beforeAll(() => { result = applyPrivacy(sampleMembers, "full"); });

    test("preserves display_name", () => {
      expect(result[0].display_name).toBe("สมชาย");
    });

    test("preserves picture_url", () => {
      expect(result[0].picture_url).toBe("https://example.com/pic.jpg");
    });

    test("preserves break_reason", () => {
      expect(result[0].break_reason).toBe("fuel");
    });

    test("preserves latitude and longitude", () => {
      expect(result[0].latitude).toBe(13.756);
      expect(result[0].longitude).toBe(100.502);
    });

    test("preserves is_leader flag", () => {
      expect(result[0].is_leader).toBe(true);
    });
  });

  describe("initial-only mode", () => {
    let result;
    beforeAll(() => { result = applyPrivacy(sampleMembers, "initial-only"); });

    test("masks display_name to first character (uppercase)", () => {
      expect(result[0].display_name).toBe("ส");
    });

    test("hides picture_url (null)", () => {
      expect(result[0].picture_url).toBeNull();
    });

    test("hides break_reason (null)", () => {
      expect(result[0].break_reason).toBeNull();
    });

    test("keeps latitude and longitude", () => {
      expect(result[0].latitude).toBe(13.756);
      expect(result[0].longitude).toBe(100.502);
    });

    test("keeps distance_km and eta_min", () => {
      expect(result[0].distance_km).toBe(10);
      expect(result[0].eta_min).toBe(30);
    });

    test("keeps is_leader flag", () => {
      expect(result[0].is_leader).toBe(true);
    });

    test("handles member with '?' as display_name", () => {
      const m = applyPrivacy([{ ...sampleMembers[0], display_name: "" }], "initial-only");
      expect(m[0].display_name).toBe("?");
    });
  });
});

// ─── applyTripPrivacy ─────────────────────────────────────────────────────────

const sampleTrip = {
  id: 1,
  name: "ทริปเหนือ",
  dest_name: "เชียงใหม่",
  dest_lat: 18.796,
  dest_lng: 98.993,
  line_group_id: "g:C1234567890",
  cancelled_by: "leader",
  status: "active",
};

describe("applyTripPrivacy", () => {
  test("full mode returns the same trip object", () => {
    const result = applyTripPrivacy(sampleTrip, "full");
    expect(result).toEqual(sampleTrip);
  });

  test("initial-only mode removes line_group_id", () => {
    const result = applyTripPrivacy(sampleTrip, "initial-only");
    expect(result.line_group_id).toBeUndefined();
  });

  test("initial-only mode removes cancelled_by", () => {
    const result = applyTripPrivacy(sampleTrip, "initial-only");
    expect(result.cancelled_by).toBeUndefined();
  });

  test("initial-only mode preserves non-sensitive fields", () => {
    const result = applyTripPrivacy(sampleTrip, "initial-only");
    expect(result.name).toBe("ทริปเหนือ");
    expect(result.dest_name).toBe("เชียงใหม่");
    expect(result.dest_lat).toBe(18.796);
    expect(result.status).toBe("active");
  });

  test("does not mutate the original trip object", () => {
    applyTripPrivacy(sampleTrip, "initial-only");
    expect(sampleTrip.line_group_id).toBe("g:C1234567890");
  });
});

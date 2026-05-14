jest.mock("../../lib/db", () => ({
  query: jest.fn().mockResolvedValue({}),
  one: jest.fn().mockResolvedValue(null),
  many: jest.fn().mockResolvedValue([]),
}));

const db = require("../../lib/db");
const { calcAvgSpeed, formatETA, formatArrivalTime, calcMemberETA, attachETAs, MIN_AVG_SPEED_KMH, MAX_AVG_SPEED_KMH } = require("../../services/eta");

describe("calcAvgSpeed", () => {
  test("returns null for null input", () => {
    expect(calcAvgSpeed(null)).toBeNull();
  });

  test("returns null for empty array", () => {
    expect(calcAvgSpeed([])).toBeNull();
  });

  test("returns null for single point", () => {
    expect(calcAvgSpeed([{ lat: 13.0, lng: 100.0, ts: Date.now() }])).toBeNull();
  });

  test("returns null when all segment gaps are < 30 s", () => {
    const now = Date.now();
    const points = [
      { lat: 13.0, lng: 100.0, ts: now },
      { lat: 13.001, lng: 100.0, ts: now + 10_000 }, // 10 s gap — skipped
    ];
    expect(calcAvgSpeed(points)).toBeNull();
  });

  test("calculates speed for two points 60 s apart", () => {
    const now = Date.now();
    // 0.001° lat ≈ 0.111 km, in 60 s → ~6.67 km/h (above MIN_AVG_SPEED_KMH=5)
    const points = [
      { lat: 13.0, lng: 100.0, ts: now },
      { lat: 13.001, lng: 100.0, ts: now + 60_000 },
    ];
    const speed = calcAvgSpeed(points);
    expect(speed).not.toBeNull();
    expect(speed).toBeGreaterThan(5);
    expect(speed).toBeLessThan(10);
  });

  test("calculates ~60 km/h for 1 km in 60 s", () => {
    const now = Date.now();
    // 0.009° lat ≈ 1 km
    const points = [
      { lat: 13.0, lng: 100.0, ts: now },
      { lat: 13.009, lng: 100.0, ts: now + 60_000 },
    ];
    const speed = calcAvgSpeed(points);
    expect(speed).not.toBeNull();
    expect(speed).toBeGreaterThan(55);
    expect(speed).toBeLessThan(65);
  });

  test("accumulates multiple valid segments", () => {
    const now = Date.now();
    const points = [
      { lat: 13.0, lng: 100.0, ts: now },
      { lat: 13.009, lng: 100.0, ts: now + 60_000 },
      { lat: 13.018, lng: 100.0, ts: now + 120_000 },
    ];
    const speed = calcAvgSpeed(points);
    expect(speed).not.toBeNull();
    expect(speed).toBeGreaterThan(55);
  });

  test("skips segments shorter than 30 s but uses valid ones", () => {
    const now = Date.now();
    const points = [
      { lat: 13.0, lng: 100.0, ts: now },
      { lat: 13.0, lng: 100.0, ts: now + 5_000 },   // 5 s — skipped
      { lat: 13.009, lng: 100.0, ts: now + 65_000 }, // 60 s — used
    ];
    const speed = calcAvgSpeed(points);
    expect(speed).not.toBeNull();
  });
});

describe("formatETA", () => {
  test("returns em-dash for null", () => {
    expect(formatETA(null)).toBe("—");
  });

  test("returns em-dash for undefined", () => {
    expect(formatETA(undefined)).toBe("—");
  });

  test("returns minutes for values under 60", () => {
    expect(formatETA(45)).toBe("45 นาที");
    expect(formatETA(1)).toBe("1 นาที");
  });

  test("returns 0 นาที for 0", () => {
    expect(formatETA(0)).toBe("0 นาที");
  });

  test("returns hours only when no minute remainder", () => {
    expect(formatETA(60)).toBe("1 ชม.");
    expect(formatETA(120)).toBe("2 ชม.");
    expect(formatETA(180)).toBe("3 ชม.");
  });

  test("returns hours and minutes when remainder exists", () => {
    expect(formatETA(72)).toBe("1 ชม. 12 นาที");
    expect(formatETA(90)).toBe("1 ชม. 30 นาที");
    expect(formatETA(130)).toBe("2 ชม. 10 นาที");
  });
});

describe("formatArrivalTime", () => {
  test("returns null for null etaMin", () => {
    expect(formatArrivalTime(null)).toBeNull();
  });

  test("returns null for undefined etaMin", () => {
    expect(formatArrivalTime(undefined)).toBeNull();
  });

  test("returns a non-empty string for valid etaMin", () => {
    const result = formatArrivalTime(60);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("returns a string for etaMin = 0 (now)", () => {
    const result = formatArrivalTime(0);
    expect(typeof result).toBe("string");
  });

  test("returns different strings for different durations", () => {
    const t1 = formatArrivalTime(0);
    const t2 = formatArrivalTime(60);
    // 60 minutes apart should differ in at least the hour digit
    expect(t1).not.toBe(t2);
  });
});

// ─── calcMemberETA ────────────────────────────────────────────────────────────

describe("calcMemberETA", () => {
  const trip = { dest_lat: 18.796, dest_lng: 98.993 };
  const now = Date.now();

  beforeEach(() => {
    jest.clearAllMocks();
    db.many.mockResolvedValue([]);
  });

  test("returns null when trip has no destination", async () => {
    const result = await calcMemberETA({ dest_lat: null, dest_lng: null }, { arrived_at: null });
    expect(result).toBeNull();
  });

  test("returns null when member already arrived", async () => {
    const result = await calcMemberETA(trip, { arrived_at: new Date().toISOString() });
    expect(result).toBeNull();
  });

  test("returns null when member is on break", async () => {
    const future = new Date(now + 30 * 60_000).toISOString();
    const result = await calcMemberETA(trip, { arrived_at: null, break_until: future, distance_km: 10, id: 10 });
    expect(result).toBeNull();
  });

  test("returns null when distance_km is null", async () => {
    const result = await calcMemberETA(trip, { arrived_at: null, break_until: null, distance_km: null, id: 10 });
    expect(result).toBeNull();
  });

  test("returns null when distance_km < 0.1 (effectively arrived)", async () => {
    const result = await calcMemberETA(trip, { arrived_at: null, break_until: null, distance_km: 0.05, id: 10 });
    expect(result).toBeNull();
  });

  test("returns null when fewer than 2 location points in DB", async () => {
    db.many.mockResolvedValueOnce([{ latitude: "13.0", longitude: "100.0", ts: now }]);
    const result = await calcMemberETA(trip, { arrived_at: null, break_until: null, distance_km: 5, id: 10 });
    expect(result).toBeNull();
  });

  test("returns null when avg speed is below minimum (< 5 km/h)", async () => {
    // 0.001° lat ≈ 0.111 km in 300 s ≈ 1.3 km/h
    db.many.mockResolvedValueOnce([
      { latitude: "13.000", longitude: "100.0", ts: now - 300_000 },
      { latitude: "13.001", longitude: "100.0", ts: now },
    ]);
    const result = await calcMemberETA(trip, { arrived_at: null, break_until: null, distance_km: 5, id: 10 });
    expect(result).toBeNull();
  });

  test("returns eta_min and avg_speed_kmh for normal driving speed", async () => {
    // 0.009° lat ≈ 1 km in 60 s → ~60 km/h
    db.many.mockResolvedValueOnce([
      { latitude: "13.000", longitude: "100.0", ts: now - 60_000 },
      { latitude: "13.009", longitude: "100.0", ts: now },
    ]);
    const result = await calcMemberETA(trip, { arrived_at: null, break_until: null, distance_km: 5, id: 10 });
    expect(result).not.toBeNull();
    expect(result.eta_min).toBeGreaterThan(0);
    expect(result.avg_speed_kmh).toBeGreaterThan(0);
  });

  test("caps speed to 80 km/h (FALLBACK) when GPS reports > 200 km/h", async () => {
    // 0.09° lat ≈ 10 km in 31 s ≈ 1161 km/h → capped to 80
    db.many.mockResolvedValueOnce([
      { latitude: "13.000", longitude: "100.0", ts: now - 31_000 },
      { latitude: "13.090", longitude: "100.0", ts: now },
    ]);
    const result = await calcMemberETA(trip, { arrived_at: null, break_until: null, distance_km: 5, id: 10 });
    expect(result).not.toBeNull();
    expect(result.avg_speed_kmh).toBe(80);
  });
});

// ─── attachETAs ───────────────────────────────────────────────────────────────

describe("attachETAs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.many.mockResolvedValue([]);
  });

  test("returns members unchanged when trip has no destination", async () => {
    const members = [{ id: 1, arrived_at: null, break_until: null, distance_km: 5 }];
    const result = await attachETAs({ dest_lat: null, dest_lng: null }, members);
    expect(result).toBe(members);
  });

  test("attaches eta_min and avg_speed_kmh (null when no location data)", async () => {
    const trip = { dest_lat: 18.796, dest_lng: 98.993 };
    const members = [{ id: 10, arrived_at: null, break_until: null, distance_km: 5 }];
    const result = await attachETAs(trip, members);
    expect(result[0]).toHaveProperty("eta_min", null);
    expect(result[0]).toHaveProperty("avg_speed_kmh", null);
  });

  test("handles multiple members in parallel", async () => {
    const trip = { dest_lat: 18.796, dest_lng: 98.993 };
    const members = [
      { id: 10, arrived_at: null, break_until: null, distance_km: 5 },
      { id: 11, arrived_at: new Date().toISOString(), break_until: null, distance_km: 0 },
    ];
    const result = await attachETAs(trip, members);
    expect(result).toHaveLength(2);
    expect(result[1].eta_min).toBeNull();
  });
});

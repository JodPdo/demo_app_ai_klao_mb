const { getDistance } = require("../../utils/distance");

describe("getDistance (Haversine)", () => {
  test("same point returns 0", () => {
    expect(getDistance(13.756, 100.502, 13.756, 100.502)).toBe(0);
  });

  test("is symmetric", () => {
    const a = getDistance(13.756, 100.502, 18.796, 98.993);
    const b = getDistance(18.796, 98.993, 13.756, 100.502);
    expect(Math.abs(a - b)).toBeLessThan(0.0001);
  });

  test("Bangkok to Chiang Mai is approximately 583 km", () => {
    // Bangkok: 13.7563, 100.5018 / Chiang Mai: 18.7961, 98.9921
    const dist = getDistance(13.7563, 100.5018, 18.7961, 98.9921);
    expect(dist).toBeGreaterThan(575);
    expect(dist).toBeLessThan(600);
  });

  test("~100 m apart gives roughly 0.1 km", () => {
    // 0.001° latitude ≈ 111 m
    const dist = getDistance(13.0, 100.0, 13.001, 100.0);
    expect(dist).toBeGreaterThan(0.10);
    expect(dist).toBeLessThan(0.12);
  });

  test("returns positive value for any two different points", () => {
    expect(getDistance(0, 0, 1, 1)).toBeGreaterThan(0);
  });

  test("equator points are calculated correctly", () => {
    // 1° longitude at equator ≈ 111.32 km
    const dist = getDistance(0, 0, 0, 1);
    expect(dist).toBeGreaterThan(110);
    expect(dist).toBeLessThan(113);
  });
});

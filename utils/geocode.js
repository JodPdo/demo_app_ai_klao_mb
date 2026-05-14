// Nominatim wrapper — forward + reverse + multi-result search
// ใช้ผ่าน backend proxy เพื่อไม่ให้ browser โดน rate limit ตรงๆ

const logger = require("../lib/logger");
const TIMEOUT_MS = 8000;

/**
 * single result — ใช้ใน webhookHandler "ตั้งปลายทาง <ชื่อ>"
 */
async function geocode(query) {
  const results = await searchMultiple(query, 1);
  return results[0] || null;
}

/**
 * 🆕 v3.3 — multiple results สำหรับ search autocomplete
 */
async function searchMultiple(query, limit = 5) {
  if (!query || query.trim().length < 2) return [];

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("countrycodes", "th");
  url.searchParams.set("accept-language", "th");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      headers: { "User-Agent": "AiKlaoBot/3.0 (LINE trip tracker)" },
      signal: ctrl.signal
    });
    if (!response.ok) {
      logger.error({ status: response.status, query }, "Nominatim non-OK");
      return [];
    }
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    return data.map((r) => ({
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      displayName: r.display_name,
      type: r.type,
      class: r.class
    }));
  } catch (err) {
    if (err.name === "AbortError") {
      logger.warn({ query }, "Geocode timed out");
    } else {
      logger.error({ err: err.message, query }, "Geocode error");
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 🆕 v3.3 — reverse geocode (lat/lng → ชื่อสถานที่)
 */
async function reverse(lat, lng) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "json");
  url.searchParams.set("accept-language", "th");
  url.searchParams.set("zoom", "16"); // city/road level

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      headers: { "User-Agent": "AiKlaoBot/3.0 (LINE trip tracker)" },
      signal: ctrl.signal
    });
    if (!response.ok) {
      logger.error({ status: response.status, lat, lng }, "Nominatim reverse non-OK");
      return null;
    }
    const data = await response.json();
    if (!data || !data.display_name) return null;
    return {
      lat: parseFloat(data.lat),
      lng: parseFloat(data.lon),
      displayName: data.display_name,
      address: data.address || {}
    };
  } catch (err) {
    if (err.name === "AbortError") {
      logger.warn({ lat, lng }, "Reverse timed out");
    } else {
      logger.error({ err: err.message, lat, lng }, "Reverse error");
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { geocode, searchMultiple, reverse };
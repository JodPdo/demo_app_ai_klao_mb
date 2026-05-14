/* AiKlao Watch — Public read-only viewer v4.0
   - No LIFF SDK
   - No auth — just token in URL
   - Auto-refresh every 30s
   - Privacy filtered (server-side)
*/

const $ = (id) => document.getElementById(id);
const REFRESH_SEC = 30;

const state = {
  token: null,
  map: null,
  markers: new Map(),
  destMarker: null,
  pollTimer: null,
  data: null
};

/* HELPERS */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function initial(name) { return ((name || "?").trim()[0] || "?").toUpperCase(); }
function distanceClass(km, isStale) {
  if (km == null) return "stale";
  if (isStale) return "stale";
  if (km < 3) return "near";
  if (km < 15) return "mid";
  if (km < 50) return "far";
  return "vfar";
}
function formatDistance(km) {
  if (km == null) return null;
  const n = Number(km);
  if (!Number.isFinite(n)) return null;
  if (n < 1) return Math.round(n * 1000) + " m";
  if (n < 10) return n.toFixed(1) + " km";
  return Math.round(n) + " km";
}
function formatTimeAgo(iso) {
  if (!iso) return "ไม่มีข้อมูล";
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "เมื่อกี้";
  if (min < 60) return min + " นาที";
  const h = Math.floor(min / 60);
  if (h < 24) return h + " ชม.";
  return Math.floor(h / 24) + " วัน";
}
function isStale(min) { return min != null && min > 60; }
function isOnBreak(m) { return !!(m.break_until && new Date(m.break_until) > new Date()); }
function isLive(m) { return !!(m.live_share_until && new Date(m.live_share_until) > new Date()); }
function formatETA(min) {
  if (min == null) return null;
  if (min < 60) return min + " นาที";
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r === 0 ? h + " ชม." : h + " ชม. " + r + " นาที";
}
function formatArrivalTime(min) {
  if (min == null) return null;
  const at = new Date(Date.now() + min * 60000);
  return at.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

/* MAP */
function initMap() {
  state.map = L.map("map", { zoomControl: true, attributionControl: true, zoomSnap: 0.5 })
    .setView([13.7563, 100.5018], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OSM"
  }).addTo(state.map);
}

function memberIcon(m) {
  const stale = isStale(m.minutes_ago);
  const onBreak = isOnBreak(m);
  const live = isLive(m);
  let cls;
  if (m.arrived_at) cls = "arrived near";
  else if (onBreak) cls = "break";
  else cls = distanceClass(m.distance_km, stale);
  if (live) cls += " live";
  if (m.is_leader) cls += " leader";

  let inner;
  if (onBreak) inner = "☕";
  else if (m.picture_url) inner = `<img src="${escapeHtml(m.picture_url)}" />`;
  else inner = escapeHtml(initial(m.display_name));

  let dist = formatDistance(m.distance_km);
  let distHtml;
  if (m.arrived_at) distHtml = `<div class="marker-distance arrived">ถึงแล้ว</div>`;
  else if (onBreak) distHtml = `<div class="marker-distance break">พัก</div>`;
  else if (dist) distHtml = `<div class="marker-distance">${dist}</div>`;
  else distHtml = "";

  return L.divIcon({
    html: `<div class="marker-wrap">
      <div class="marker-circle ${cls}">${inner}</div>
      <div class="marker-pin"></div>
      ${distHtml}
    </div>`,
    className: "",
    iconSize: [44, 60], iconAnchor: [22, 52], popupAnchor: [0, -52]
  });
}

function destIcon() {
  return L.divIcon({
    html: `<div class="marker-wrap"><div class="marker-circle dest">🎯</div><div class="marker-pin"></div></div>`,
    className: "", iconSize: [44, 60], iconAnchor: [22, 52], popupAnchor: [0, -52]
  });
}

function memberPopup(m) {
  const dist = formatDistance(m.distance_km);
  const arrivedLine = m.arrived_at ? `<div class="popup-meta" style="color:#10b981;font-weight:600">✅ ถึงปลายทางแล้ว</div>` : "";
  const breakLine = isOnBreak(m) ? `<div class="popup-meta" style="color:#854F0B;font-weight:600">☕ กำลังพัก</div>` : "";
  const etaLine = m.eta_min != null
    ? `<div class="popup-meta eta">🕐 ถึงประมาณ ${formatArrivalTime(m.eta_min)} (${formatETA(m.eta_min)})</div>`
    : "";
  const liveLine = isLive(m) ? `<div class="popup-meta" style="color:#dc2626;font-weight:600">🔴 LIVE</div>` : "";
  return `<div class="popup">
    <div class="popup-name">${m.is_leader ? '<span class="crown">👑</span>' : ""}${escapeHtml(m.display_name)}</div>
    ${arrivedLine}${breakLine}
    ${(!m.arrived_at && !isOnBreak(m) && dist) ? `<div class="popup-meta">📏 เหลือ ${dist}</div>` : ""}
    ${etaLine}${liveLine}
    <div class="popup-meta">⏱ ${formatTimeAgo(m.location_at)} ที่แล้ว</div>
  </div>`;
}

/* RENDER */
function renderHeader(data) {
  const labelTrip = data.share?.label
    ? `${data.share.label} — ${data.trip.name}`
    : data.trip.name;
  $("tripName").textContent = labelTrip;
  $("destName").textContent = data.trip.dest_name ? `🎯 ${data.trip.dest_name}` : "ยังไม่ได้ตั้งปลายทาง";
}

function renderStats(data) {
  const total = data.members.length;
  const active = data.members.filter((m) => m.latitude != null).length;
  const arrived = data.members.filter((m) => m.arrived_at).length;
  const liveCount = data.members.filter(isLive).length;
  $("memberCount").textContent = total;
  $("activeCount").textContent = active;
  $("arrivedCount").textContent = arrived;
  $("liveCount").textContent = liveCount;
  $("liveStatBadge").hidden = liveCount === 0;
  $("statsRow").hidden = false;
}

function clearMarkers() {
  state.markers.forEach((m) => state.map.removeLayer(m));
  state.markers.clear();
  if (state.destMarker) {
    state.map.removeLayer(state.destMarker);
    state.destMarker = null;
  }
}

function renderMarkers(data) {
  clearMarkers();
  const points = [];
  data.members.forEach((m) => {
    if (m.latitude == null) return;
    const lat = Number(m.latitude), lng = Number(m.longitude);
    const marker = L.marker([lat, lng], { icon: memberIcon(m) })
      .bindPopup(memberPopup(m))
      .addTo(state.map);
    state.markers.set(m.id, marker);
    points.push([lat, lng]);
  });
  if (data.trip.dest_lat != null && data.trip.dest_lng != null) {
    const lat = Number(data.trip.dest_lat), lng = Number(data.trip.dest_lng);
    state.destMarker = L.marker([lat, lng], { icon: destIcon() })
      .bindPopup(`🎯 ${escapeHtml(data.trip.dest_name || "ปลายทาง")}`)
      .addTo(state.map);
    points.push([lat, lng]);
  }
  if (points.length > 0) {
    if (points.length === 1) state.map.setView(points[0], 13);
    else state.map.fitBounds(points, { padding: [50, 50], maxZoom: 14 });
    $("emptyState").hidden = true;
  } else {
    $("emptyState").hidden = false;
  }
}

function renderLeaderboard(data) {
  const list = $("memberList");
  list.innerHTML = "";
  $("sheetCount").textContent = data.members.length;

  const sorted = [...data.members].sort((a, b) => {
    if (a.arrived_at && !b.arrived_at) return -1;
    if (!a.arrived_at && b.arrived_at) return 1;
    if (isOnBreak(a) && !isOnBreak(b)) return 1;
    if (!isOnBreak(a) && isOnBreak(b)) return -1;
    if (a.distance_km == null && b.distance_km != null) return 1;
    if (a.distance_km != null && b.distance_km == null) return -1;
    return (a.distance_km || 0) - (b.distance_km || 0);
  });

  sorted.forEach((m) => {
    const dist = formatDistance(m.distance_km);
    const onBreak = isOnBreak(m);
    const stale = isStale(m.minutes_ago);
    let distCls = distanceClass(m.distance_km, stale);
    if (m.arrived_at) distCls = "arrived";
    if (onBreak) distCls = "break";

    const row = document.createElement("li");
    row.className = "member-row" + (onBreak ? " break" : "");
    row.innerHTML = `
      <div class="member-avatar ${onBreak ? "break" : ""}">${
        onBreak ? "☕" :
        m.picture_url ? `<img src="${escapeHtml(m.picture_url)}" />` :
        escapeHtml(initial(m.display_name))
      }</div>
      <div class="member-info">
        <div class="member-name">${m.is_leader ? "👑 " : ""}${escapeHtml(m.display_name)}${isLive(m) ? ' <span style="color:#dc2626;font-size:10px">🔴</span>' : ""}</div>
        <div class="member-meta">⏱ ${formatTimeAgo(m.location_at)}${m.eta_min != null ? ` · 🕐 ${formatETA(m.eta_min)}` : ""}</div>
      </div>
      <div class="member-distance ${distCls}">${
        m.arrived_at ? "ถึงแล้ว" : onBreak ? "พัก" : (dist || "—")
      }</div>
    `;
    list.appendChild(row);
  });
}

/* DATA FETCH */
async function fetchData() {
  try {
    const res = await fetch(`/share/${state.token}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    throw err;
  }
}

async function refresh() {
  try {
    const data = await fetchData();
    state.data = data;
    renderHeader(data);
    renderStats(data);
    renderMarkers(data);
    renderLeaderboard(data);
    const now = new Date();
    $("lastUpdate").textContent = `อัพเดต ${now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    hideLoading();
    return true;
  } catch (err) {
    console.error("[watch] refresh failed", err);
    showError(err.message || "เกิดข้อผิดพลาด");
    return false;
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(refresh, REFRESH_SEC * 1000);
}
function stopPolling() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

/* OVERLAYS */
function hideLoading() {
  const lo = $("loadingOverlay");
  lo.classList.add("hidden");
  setTimeout(() => (lo.style.display = "none"), 300);
}
function showError(msg) {
  hideLoading();
  $("errorMsg").textContent = msg;
  $("errorOverlay").hidden = false;
}

/* SHEET */
function toggleSheet() {
  $("sheet").classList.toggle("expanded");
}

/* INIT */
function getTokenFromURL() {
  // /watch/<token> → return token
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "watch" && parts[1]) return parts[1];
  return null;
}

async function init() {
  state.token = getTokenFromURL();
  if (!state.token) {
    showError("URL ไม่ถูกต้อง — ต้องมี token");
    return;
  }
  $("refreshSec").textContent = REFRESH_SEC;
  initMap();
  const ok = await refresh();
  if (ok) startPolling();
}

document.addEventListener("DOMContentLoaded", () => {
  $("sheetHandle").addEventListener("click", toggleSheet);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPolling();
    else if (state.token) { refresh(); startPolling(); }
  });
  init();
});
/* AiKlao LIFF Map — v3.4.2 (Break Mode + Speed Dial) */

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "aiklao.lastTripId";
const DEFAULT_REFRESH_SEC = 15;

const REASON_LABEL = {
  fuel: "⛽ เติมน้ำมัน",
  meal: "🍽 กินข้าว",
  restroom: "🚻 ห้องน้ำ",
  rest: "😴 พักผ่อน",
  other: "☕ พัก"
};

const state = {
  liffId: null,
  refreshSec: DEFAULT_REFRESH_SEC,
  accessToken: null,
  tripId: null,
  tripsCache: [],
  currentTripData: null,
  map: null,
  markers: new Map(),
  destMarker: null,
  pollTimer: null,
  countdownTimer: null,
  countdownLeft: 0,
  isLoading: false,
  sosLocation: null,
  // break state
  breakReason: "rest",
  breakDuration: 30,
  breakCustomDuration: null,
  breakMode: "individual",
  // speed dial
  dialOpen: false,
  // v3.6 live share state
  liveShare: { active: false, watcherId: null, intervalId: null, until: null, wakeLock: null, lastSent: 0, mode: null },
  share: { privacy: "full", expiryHours: null }
};

// v3.6.2: auto-track config — same as live share but ออก่ของจังเ้, mode = "auto"

function isLiveSharing(m) {
  return !!(m && m.live_share_until && new Date(m.live_share_until) > new Date());
}
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

function isGroupOnBreak(trip) {
  return !!(trip && trip.group_break_until && new Date(trip.group_break_until) > new Date());
}
function groupBreakMinLeft(trip) {
  if (!isGroupOnBreak(trip)) return 0;
  return Math.max(0, Math.round((new Date(trip.group_break_until).getTime() - Date.now()) / 60_000));
}

function showToast(msg, type = "default", ms = 2400) {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast show";
  if (type) el.classList.add(type);
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("show"), ms);
}
function hideLoading() {
  const el = $("loadingOverlay");
  el.classList.add("hidden");
  setTimeout(() => (el.style.display = "none"), 300);
}
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
  if (n < 1) return `${Math.round(n * 1000)} m`;
  if (n < 10) return `${n.toFixed(1)} km`;
  return `${Math.round(n)} km`;
}
function formatTimeAgo(iso) {
  if (!iso) return "ไม่มีข้อมูล";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "เมื่อกี้";
  if (minutes < 60) return `${minutes} นาที`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชม.`;
  return `${Math.floor(hours / 24)} วัน`;
}
function isStale(minutesAgo) { return minutesAgo != null && minutesAgo > 60; }
function isOnBreak(member) {
  return !!(member.break_until && new Date(member.break_until) > new Date());
}
function breakMinutesLeft(member) {
  if (!isOnBreak(member)) return 0;
  return Math.max(0, Math.round((new Date(member.break_until).getTime() - Date.now()) / 60_000));
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${state.accessToken}`,
      ...(opts.body && !opts.headers?.["Content-Type"] ? { "Content-Type": "application/json" } : {})
    }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
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
  const live = isLiveSharing(m);
  let cls;
  if (m.arrived_at) cls = "arrived near";
  else if (onBreak) cls = "break";
  else cls = distanceClass(m.distance_km, stale);
  if (live) cls += " live";

  const distLabel = formatDistance(m.distance_km);
  const leaderCls = m.is_leader ? "leader" : "";
  const arrivedCls = m.arrived_at ? "arrived" : "";
  const breakCls = onBreak ? "break" : "";

  let inner;
  if (onBreak) {
    inner = "☕";
  } else {
    inner = m.picture_url
      ? `<img src="${escapeHtml(m.picture_url)}" onerror="this.replaceWith(document.createTextNode('${escapeHtml(initial(m.display_name))}'))" />`
      : escapeHtml(initial(m.display_name));
  }

  let distHtml;
  if (m.arrived_at) distHtml = `<div class="marker-distance arrived">ถึงแล้ว</div>`;
  else if (onBreak) distHtml = `<div class="marker-distance break">${breakMinutesLeft(m)} นาที</div>`;
  else if (distLabel) distHtml = `<div class="marker-distance">${distLabel}</div>`;
  else distHtml = "";

  return L.divIcon({
    html: `
      <div class="marker-wrap">
        <div class="marker-circle ${cls} ${leaderCls} ${arrivedCls} ${breakCls}">${inner}</div>
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
  let arrivedLine = m.arrived_at
    ? `<div class="popup-meta" style="color: var(--color-arrived); font-weight: 600;">✅ ถึงปลายทางแล้ว</div>`
    : "";
  let breakLine = "";
  if (isOnBreak(m)) {
    const reasonLabel = REASON_LABEL[m.break_reason] || REASON_LABEL.other;
    breakLine = `<div class="popup-meta" style="color: var(--color-break-text); font-weight: 600;">☕ พัก ${reasonLabel} — เหลือ ${breakMinutesLeft(m)} นาที</div>`;
  }
  return `
    <div class="popup">
      <div class="popup-name">
        ${m.is_leader ? '<span class="crown">👑</span>' : ""}
        ${escapeHtml(m.display_name)}
      </div>
      ${arrivedLine}
      ${breakLine}
      ${!m.arrived_at && !isOnBreak(m) && dist ? `<div class="popup-meta">📏 เหลือ ${dist}</div>` : ""}
      ${m.eta_min != null ? `<div class="popup-meta eta">🕐 ถึงประมาณ ${formatArrivalTime(m.eta_min)} (${formatETA(m.eta_min)})</div>` : ""}
      ${isLiveSharing(m) ? `<div class="popup-meta" style="color:#dc2626;font-weight:600">🔴 LIVE</div>` : ""}
      <div class="popup-meta">⏱ ${formatTimeAgo(m.location_at)} ที่แล้ว</div>
    </div>`;
}

function clearMarkers() {
  state.markers.forEach((m) => state.map.removeLayer(m));
  state.markers.clear();
  if (state.destMarker) {
    state.map.removeLayer(state.destMarker);
    state.destMarker = null;
  }
}

/* RENDER */
function renderHeader(data) {
  $("tripName").textContent = data.trip.name;
  $("destName").textContent = data.trip.dest_name ? `🎯 ${data.trip.dest_name}` : "ยังไม่ได้ตั้งปลายทาง";
  $("leaderBadge").hidden = !data.me?.isLeader;
  $("moreBtn").hidden = !data.me?.isLeader;

  // v3.5: group break banner + leader-only group break dial button
  const groupOn = isGroupOnBreak(data.trip);
  const banner = $("groupBreakBanner");
  if (banner) {
    if (groupOn) {
      banner.hidden = false;
      const minLeft = groupBreakMinLeft(data.trip);
      const reason = data.trip.group_break_reason
        ? (REASON_LABEL[data.trip.group_break_reason] || REASON_LABEL.other)
        : "";
      $("groupBreakMeta").textContent = `${reason} • เหลือ ${minLeft} นาที`;
      const endBtn = $("groupBreakEndBtn");
      if (endBtn) endBtn.hidden = !data.me?.isLeader;
    } else {
      banner.hidden = true;
    }
  }
  const dialGB = $("dialGroupBreak");
  if (dialGB) dialGB.hidden = !data.me?.isLeader || groupOn;
  const ctn = $("currentTripName");
  if (ctn) ctn.textContent = data.trip.name || "(ไม่มีชื่อ)";
}

function renderStats(data) {
  const total = data.members.length;
  const active = data.members.filter((m) => m.latitude != null).length;
  const arrived = data.members.filter((m) => m.arrived_at).length;
  const breaks = data.members.filter(isOnBreak).length;
  const liveCount = data.members.filter(isLiveSharing).length;
  const latest = data.members
    .filter((m) => m.location_at)
    .sort((a, b) => new Date(b.location_at) - new Date(a.location_at))[0];

  $("memberCount").textContent = total;
  $("activeCount").textContent = active;
  $("arrivedCount").textContent = arrived;
  $("breakCount").textContent = breaks;
  $("breakStatBadge").hidden = breaks === 0;
  if ($("liveCount")) $("liveCount").textContent = liveCount;
  if ($("liveStatBadge")) $("liveStatBadge").hidden = liveCount === 0;
  $("statsRow").hidden = false;
}

function renderMarkers(data) {
  clearMarkers();
  const bounds = [];

  if (data.trip.dest_lat != null && data.trip.dest_lng != null) {
    const dlat = Number(data.trip.dest_lat);
    const dlng = Number(data.trip.dest_lng);
    if (Number.isFinite(dlat) && Number.isFinite(dlng)) {
      state.destMarker = L.marker([dlat, dlng], { icon: destIcon() })
        .bindPopup(`<div class="popup"><div class="popup-name">🎯 ${escapeHtml(data.trip.dest_name)}</div></div>`)
        .addTo(state.map);
      bounds.push([dlat, dlng]);
    }
  }

  data.members.forEach((m) => {
    let lat, lng;
    if (isOnBreak(m) && m.latitude == null && m.break_location_lat != null) {
      lat = Number(m.break_location_lat);
      lng = Number(m.break_location_lng);
    } else {
      if (m.latitude == null || m.longitude == null) return;
      lat = Number(m.latitude); lng = Number(m.longitude);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const marker = L.marker([lat, lng], { icon: memberIcon(m) })
      .bindPopup(memberPopup(m))
      .addTo(state.map);
    state.markers.set(m.id, marker);
    bounds.push([lat, lng]);
  });

  if (bounds.length === 0) {
    $("emptyState").hidden = false;
    if (data.trip.dest_lat == null) {
      $("emptyTitle").textContent = "ยังไม่ได้ตั้งปลายทาง";
      $("emptyMsg").textContent = data.me?.isLeader
        ? 'พิมพ์ในกลุ่ม LINE: "ตั้งปลายทาง <ชื่อสถานที่>"'
        : "รอหัวหน้าตั้งปลายทาง";
    } else {
      $("emptyTitle").textContent = "ยังไม่มีตำแหน่ง";
      $("emptyMsg").textContent = "รอให้สมาชิกในทริปกดส่ง 📍 ตำแหน่งใน LINE";
    }
  } else {
    $("emptyState").hidden = true;
    if (bounds.length > 1) state.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    else state.map.setView(bounds[0], 13);
  }
}

function renderLeaderboard(data) {
  const list = $("memberList");
  list.innerHTML = "";

  const total = data.members.length;
  const active = data.members.filter((m) => m.latitude != null).length;
  const arrived = data.members.filter((m) => m.arrived_at).length;
  const breaks = data.members.filter(isOnBreak).length;
  const liveCount = data.members.filter(isLiveSharing).length;

  let countParts = `${active}/${total}`;
  if (arrived > 0) countParts = `${arrived}✅/` + countParts;
  if (breaks > 0) countParts += ` · ☕${breaks}`;
  $("sheetCount").textContent = countParts;
  $("sheetTitle").textContent = data.trip.name;

  data.members.forEach((m, i) => {
    const stale = isStale(m.minutes_ago);
    const isArrived = !!m.arrived_at;
    const onBreak = isOnBreak(m);
    let cls;
    if (isArrived) cls = "arrived";
    else if (onBreak) cls = "break";
    else cls = distanceClass(m.distance_km, stale);

    const dist = formatDistance(m.distance_km);

    const li = document.createElement("li");
    li.className = "member-row" + (isArrived ? " arrived" : onBreak ? " break" : "");
    li.dataset.memberId = m.id;

    let avatarInner;
    if (onBreak) avatarInner = "☕";
    else avatarInner = m.picture_url
      ? `<img src="${escapeHtml(m.picture_url)}" alt="" onerror="this.replaceWith(document.createTextNode('${escapeHtml(initial(m.display_name))}'))" />`
      : escapeHtml(initial(m.display_name));

    let distHtml;
    if (isArrived) distHtml = `<div class="member-distance arrived">✅ ถึงแล้ว</div>`;
    else if (onBreak) {
      const min = breakMinutesLeft(m);
      distHtml = `<div class="member-distance break">☕ ${min} นาที</div>`;
    } else if (dist == null) distHtml = `<div class="member-distance no-data">ยังไม่ส่ง location</div>`;
    else {
      const isFirst = i === 0 && active > 1 && !isArrived && !onBreak;
      const isLast = i === active - 1 && active > 1 && !isArrived && !onBreak;
      distHtml = `<div class="member-distance">${dist}${isFirst ? '<span class="badge">✨</span>' : ""}${isLast ? '<span class="badge">🐢</span>' : ""}</div>`;
    }

    let timeRow;
    if (onBreak) {
      const reasonLabel = REASON_LABEL[m.break_reason] || REASON_LABEL.other;
      timeRow = `<div class="member-time break-time">☕ ${reasonLabel}</div>`;
    } else if (m.location_at) {
      timeRow = `<div class="member-time">📍 ${formatTimeAgo(m.location_at)}ที่แล้ว${m.arrived_at ? ` · ✅ ${formatTimeAgo(m.arrived_at)}ที่แล้ว` : ""}</div>`;
    } else {
      timeRow = `<div class="member-time">ยังไม่ส่ง</div>`;
    }

    li.innerHTML = `
      <div class="member-rank">${i + 1}</div>
      <div class="member-avatar ${cls}">${avatarInner}</div>
      <div class="member-info">
        <div class="member-name">
          ${m.is_leader ? '<span class="crown">👑</span>' : ""}
          ${escapeHtml(m.display_name)}
        </div>
        ${timeRow}
      </div>
      ${distHtml}
    `;

    li.addEventListener("click", () => focusMember(m.id));
    list.appendChild(li);
  });
}

function focusMember(memberId) {
  const marker = state.markers.get(memberId);
  if (!marker) { showToast("สมาชิกคนนี้ยังไม่ส่งตำแหน่ง"); return; }
  state.map.flyTo(marker.getLatLng(), 14, { duration: 0.6 });
  marker.openPopup();
  $("sheet").classList.add("collapsed");
}

function toggleSheet() { $("sheet").classList.toggle("collapsed"); }

function fitAll() {
  const bounds = [];
  state.markers.forEach((m) => bounds.push(m.getLatLng()));
  if (state.destMarker) bounds.push(state.destMarker.getLatLng());
  if (bounds.length === 0) { showToast("ยังไม่มีตำแหน่งให้แสดง"); return; }
  if (bounds.length === 1) state.map.flyTo(bounds[0], 14, { duration: 0.5 });
  else state.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15, animate: true });
}

/* SPEED DIAL */
function openDial() {
  state.dialOpen = true;
  $("speedDial").classList.add("open");
  $("speedDialActions").hidden = false;
  $("dialBackdrop").hidden = false;
}
function closeDial() {
  state.dialOpen = false;
  $("speedDial").classList.remove("open");
  $("speedDialActions").hidden = true;
  $("dialBackdrop").hidden = true;
}
function toggleDial() { state.dialOpen ? closeDial() : openDial(); }

/* POLLING */
// v3.6.2: ตรวจเงื่อนไข auto-start watchPosition
//   - มี trip + ปลายทาง
//   - user เป็น member + ส่ง location แล้ว (มี location ใน DB)
//   - ยังไม่ arrived
//   - ไม่ on break (รายตัว หรือ group)
//   - ยังไม่ active live share อยู่แล้ว
function shouldAutoTrack(data) {
  if (!data || !data.trip || !data.me) return false;
  if (data.trip.status !== "active") return false;
  if (!data.trip.dest_lat || !data.trip.dest_lng) return false;
  const myMember = data.members.find(m => m.id === data.me.memberId);
  if (!myMember) return false;
  if (myMember.arrived_at) return false;
  if (isOnBreak(myMember)) return false;
  if (data.trip.group_break_until && new Date(data.trip.group_break_until) > new Date()) return false;
  if (myMember.latitude == null) return false; // ยังไม่ส่ง location เลย
  return true;
}

function maybeAutoStartTracking(data) {
  if (state.liveShare.active) return; // มี active อยู่แล้ว — manual หรือ auto
  if (!shouldAutoTrack(data)) return;
  console.log("[auto-track] starting...");
  startLiveShare("auto");
}

function updateAutoTrackBanner() {
  const banner = document.getElementById("autoTrackBanner");
  if (!banner) return;
  const isAuto = state.liveShare.active && state.liveShare.mode === "auto";
  banner.hidden = !isAuto;
}

function maybeAutoStopTracking(data) {
  if (!state.liveShare.active) return;
  if (state.liveShare.mode !== "auto") return; // manual = user สั่ง — ไม่แตะ
  if (shouldAutoTrack(data)) return; // ยังควรทำงาน
  console.log("[auto-track] stopping (condition changed)");
  stopLiveShare(true);
}

async function refresh(silent = false) {
  if (!state.tripId || state.isLoading) return;
  state.isLoading = true;
  try {
    const data = await api(`/api/trip/${state.tripId}`);
    state.currentTripData = data;
    renderHeader(data); renderStats(data); renderMarkers(data); renderLeaderboard(data);
    // v3.6.2: auto-track gate
    maybeAutoStartTracking(data);
    maybeAutoStopTracking(data);
    state.countdownLeft = state.refreshSec;
  } catch (err) {
    console.error("refresh failed", err);
    if (!silent) showToast(`โหลดไม่สำเร็จ: ${err.message}`, "error");
  } finally {
    state.isLoading = false;
    hideLoading();
  }
}
function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(() => refresh(true), state.refreshSec * 1000);
  state.countdownLeft = state.refreshSec;
  state.countdownTimer = setInterval(() => {
    state.countdownLeft = Math.max(0, state.countdownLeft - 1);
    $("refreshTimer").textContent = state.countdownLeft;
  }, 1000);
}
function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  state.pollTimer = state.countdownTimer = null;
}

/* TRIP SELECTOR */
function showTripModal(trips) {
  const list = $("tripList");
  list.innerHTML = "";
  trips.forEach((t) => {
    const li = document.createElement("li");
    li.className = "trip-item";
    li.innerHTML = `
      <div class="trip-icon">${t.is_leader ? "👑" : "🚗"}</div>
      <div class="trip-text">
        <div class="trip-title">${escapeHtml(t.name)}${t.is_leader ? '<span class="crown">👑</span>' : ""}</div>
        <div class="trip-sub">
          ${t.dest_name ? `🎯 ${escapeHtml(t.dest_name)}` : "ยังไม่ตั้งปลายทาง"}
          · 👥 ${t.member_count} คน · 📍 ${t.active_count} ส่งแล้ว
        </div>
      </div>`;
    li.addEventListener("click", () => {
      $("tripModal").hidden = true;
      switchToTrip(t.id);
    });
    list.appendChild(li);
  });
  $("tripModal").hidden = false;
}
async function switchToTrip(tripId) {
  state.tripId = tripId;
  localStorage.setItem(STORAGE_KEY, String(tripId));
  await refresh();
  startPolling();
}
async function pickInitialTrip() {
  const data = await api("/api/me/trips");
  state.tripsCache = data.trips;
  if (!data.trips.length) {
    $("emptyState").hidden = false;
    $("emptyTitle").textContent = "คุณยังไม่ได้อยู่ในทริปไหน";
    $("emptyMsg").textContent = "เพิ่ม bot อ้ายคล้าวเข้ากลุ่ม LINE ก่อน";
    $("tripName").textContent = "ไม่มีทริป";
    hideLoading();
    return null;
  }
  const urlTrip = new URLSearchParams(location.search).get("trip");
  if (urlTrip && data.trips.some((t) => String(t.id) === urlTrip)) return parseInt(urlTrip, 10);
  const last = localStorage.getItem(STORAGE_KEY);
  if (last && data.trips.some((t) => String(t.id) === last)) return parseInt(last, 10);
  if (data.trips.length === 1) return data.trips[0].id;
  showTripModal(data.trips);
  return null;
}

/* MORE menu */
function showMoreSheet() { $("moreSheet").hidden = false; }
function hideMoreSheet() { $("moreSheet").hidden = true; }
function showConfirm({ icon, title, msg, okText = "ยืนยัน", danger = true, onOk }) {
  $("confirmIcon").textContent = icon;
  $("confirmTitle").textContent = title;
  $("confirmMsg").textContent = msg;
  $("confirmOk").textContent = okText;
  $("confirmOk").className = danger ? "btn-danger" : "btn-primary";
  $("confirmModal").hidden = false;
  const okBtn = $("confirmOk"); const cancelBtn = $("confirmCancel");
  const close = () => { $("confirmModal").hidden = true; okBtn.onclick = null; cancelBtn.onclick = null; };
  okBtn.onclick = async () => { close(); await onOk(); };
  cancelBtn.onclick = close;
}
async function doArchive() {
  showToast("⏳ กำลังยกเลิก...");
  try {
    await api(`/api/trip/${state.tripId}/archive`, { method: "POST" });
    showToast("🗑️ ยกเลิกทริปเรียบร้อย", "success");
    stopPolling();
    localStorage.removeItem(STORAGE_KEY);
    setTimeout(async () => {
      state.tripId = null;
      const tripId = await pickInitialTrip();
      if (tripId) await switchToTrip(tripId);
    }, 1000);
  } catch (err) { showToast(`❌ ${err.message}`, "error", 4000); }
}
async function doReset() {
  showToast("⏳ กำลังรีเซ็ต...");
  try {
    await api(`/api/trip/${state.tripId}/reset`, { method: "POST" });
    showToast("♻️ รีเซ็ตทริปเรียบร้อย", "success");
    await refresh();
  } catch (err) { showToast(`❌ ${err.message}`, "error", 4000); }
}
/* v3.5: Trip rename */
function openNameModal() {
  const modal = $("nameModal");
  if (!modal) return;
  const cur = state.currentTripData?.trip?.name || "";
  $("nameInput").value = cur;
  $("nameHint").textContent = "1-50 ตัวอักษร";
  $("nameHint").className = "name-hint";
  modal.hidden = false;
  setTimeout(() => $("nameInput").focus(), 100);
}
function closeNameModal() {
  const modal = $("nameModal");
  if (modal) modal.hidden = true;
}
async function saveTripName() {
  const name = ($("nameInput").value || "").trim();
  if (name.length < 1) {
    $("nameHint").textContent = "ชื่อทริปห้ามว่าง";
    $("nameHint").className = "name-hint error";
    return;
  }
  if (name.length > 50) {
    $("nameHint").textContent = "ยาวเกิน 50 ตัวอักษร";
    $("nameHint").className = "name-hint error";
    return;
  }
  try {
    const result = await api(`/api/trip/${state.tripId}/name`, {
      method: "PATCH",
      body: JSON.stringify({ name })
    });
    closeNameModal();
    showToast(`📝 เปลี่ยนชื่อเป็น "${result.name}"`, "success");
    await refresh();
  } catch (err) {
    $("nameHint").textContent = err.message;
    $("nameHint").className = "name-hint error";
  }
}

/* v3.5: Group break — leader uses break modal but POSTs to /group-break */
async function startGroupBreak() {
  const n = state.breakCustomDuration || state.breakDuration;
  if (!Number.isFinite(n) || n < 5 || n > 480) {
    showToast("ระบุเวลา 5-480 นาที", "error");
    return;
  }
  try {
    await api(`/api/trip/${state.tripId}/group-break`, {
      method: "POST",
      body: JSON.stringify({ duration_min: n, reason: state.breakReason })
    });
    closeBreakModal();
    showToast(`👥 ประกาศพักทั้งกลุ่ม ${n} นาที`, "break", 3000);
    await refresh();
  } catch (err) {
    showToast(`❌ ${err.message}`, "error", 4000);
  }
}
async function endGroupBreak() {
  try {
    await api(`/api/trip/${state.tripId}/group-break/end`, { method: "POST" });
    showToast("🚗 ออกจากพักกลุ่ม — เริ่มเดินทางต่อ", "success");
    await refresh();
  } catch (err) {
    showToast(`❌ ${err.message}`, "error", 4000);
  }
}

/* v3.6: Live Share — HTML5 watchPosition */
const LIVE_DURATION_MIN = 60;        // 1 ชั่วโมง max
const LIVE_POST_INTERVAL_MS = 30000; // ส่งทุก 30 วินาที
let _liveLastPos = null;             // cache ตำแหน่งล่าสุด

async function startLiveShare(mode = "manual") {
  if (state.liveShare.active) return;
  state.liveShare.mode = mode;
  if (!navigator.geolocation) {
    showToast("เบราว์เซอร์ไม่รองรับ geolocation", "error", 4000);
    return;
  }
  if (!state.tripId) { showToast("ไม่พบทริป", "error"); return; }

  // ขออนุญาตจาก server ก่อน
  let untilDate;
  try {
    const r = await api(`/api/trip/${state.tripId}/live-share/start`, {
      method: "POST", body: JSON.stringify({ duration_min: LIVE_DURATION_MIN })
    });
    untilDate = new Date(r.live_share_until);
  } catch (err) {
    showToast(`❌ ${err.message}`, "error", 4000);
    return;
  }

  // wake lock (กันจอดับ — Chrome/Edge รองรับ, Safari iOS 16.4+)
  try {
    if ("wakeLock" in navigator) {
      state.liveShare.wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch {}

  // start watchPosition
  state.liveShare.watcherId = navigator.geolocation.watchPosition(
    (pos) => {
      _liveLastPos = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };
    },
    (err) => { console.warn("[live] watch error", err); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );

  // post every 30 sec (debounce ผ่าน lastSent)
  state.liveShare.intervalId = setInterval(() => {
    if (!_liveLastPos) return;
    if (Date.now() - state.liveShare.lastSent < LIVE_POST_INTERVAL_MS - 1000) return;
    if (state.liveShare.until && new Date() > state.liveShare.until) {
      stopLiveShare(true);
      return;
    }
    sendLivePosition(_liveLastPos);
  }, 5000);

  state.liveShare.active = true;
  state.liveShare.until = untilDate;
  state.liveShare.lastSent = 0;
  updateAutoTrackBanner();

  const dial = $("dialLiveShare");
  if (dial) dial.dataset.active = "true";
  const lbl = $("dialLiveLabel");
  if (lbl) lbl.textContent = "หยุดแชร์สด";

  showToast(`🔴 แชร์สด ${LIVE_DURATION_MIN} นาที`, "success", 3000);
}

async function sendLivePosition(pos) {
  try {
    state.liveShare.lastSent = Date.now();
    await api(`/api/trip/${state.tripId}/location`, {
      method: "POST",
      body: JSON.stringify({ lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy })
    });
  } catch (err) {
    if (err.message && err.message.includes("too fast")) return; // rate limit ignore
    console.warn("[live] post failed", err);
  }
}

async function stopLiveShare(silent = false) {
  if (state.liveShare.watcherId != null) {
    navigator.geolocation.clearWatch(state.liveShare.watcherId);
  }
  if (state.liveShare.intervalId != null) {
    clearInterval(state.liveShare.intervalId);
  }
  if (state.liveShare.wakeLock) {
    try { state.liveShare.wakeLock.release(); } catch {}
  }
  state.liveShare = { active: false, watcherId: null, intervalId: null, until: null, wakeLock: null, lastSent: 0, mode: null };
  updateAutoTrackBanner();
  _liveLastPos = null;

  try {
    await api(`/api/trip/${state.tripId}/live-share/stop`, { method: "POST" });
  } catch {}

  const dial = $("dialLiveShare");
  if (dial) dial.dataset.active = "false";
  const lbl = $("dialLiveLabel");
  if (lbl) lbl.textContent = "แชร์สด 1ชม.";

  if (!silent) showToast("⏹ หยุดแชร์สด", "default", 2000);
  await refresh();
}

function toggleLiveShare() {
  closeDial();
  if (state.liveShare.active) {
    showConfirm({
      icon: "⏹", title: "หยุดแชร์สด?",
      msg: "จะหยุดส่งตำแหน่งสดให้กลุ่ม",
      okText: "หยุด", danger: false, onOk: () => stopLiveShare()
    });
  } else {
    showConfirm({
      icon: "🔴", title: "แชร์ตำแหน่งสด 1 ชั่วโมง?",
      msg: "ส่งตำแหน่งให้กลุ่มทุก 30 วินาที\nกินแบตขึ้นเล็กน้อย\nเปิดหน้าจอนี้ค้างไว้",
      okText: "🔴 เริ่มแชร์", danger: false, onOk: startLiveShare
    });
  }
}

/* v4.0: Share Token Management */
async function loadShareTokens() {
  const list = $("shareList");
  if (!list) return;
  list.innerHTML = '<li style="text-align:center;color:var(--text-muted);padding:10px">กำลังโหลด...</li>';
  try {
    const r = await api(`/api/trip/${state.tripId}/share-tokens`);
    renderShareList(r.tokens || []);
  } catch (err) {
    list.innerHTML = `<li style="color:var(--color-danger);padding:10px">โหลดไม่สำเร็จ: ${err.message}</li>`;
  }
}

function renderShareList(tokens) {
  const list = $("shareList");
  list.innerHTML = "";
  const active = tokens.filter(t => !t.revoked_at);
  if (active.length === 0) {
    list.innerHTML = '<li style="text-align:center;color:var(--text-muted);padding:10px">ยังไม่มีลิงก์</li>';
    return;
  }
  active.forEach((t) => {
    const url = `${window.location.origin}/watch/${t.token}`;
    const expired = t.expires_at && new Date(t.expires_at) < new Date();
    const li = document.createElement("li");
    li.className = "share-item";
    li.innerHTML = `
      <div class="share-item-row">
        <div class="share-item-label">${escapeHtml(t.label || "ลิงก์")}</div>
        <span class="share-item-meta">${t.privacy_mode === "initial-only" ? "🕶" : "👤"} · ${t.view_count} views</span>
      </div>
      <div class="share-item-url">${url}</div>
      <div class="share-item-meta">
        ${t.expires_at ? (expired ? "⌛ หมดอายุ" : "หมด " + new Date(t.expires_at).toLocaleString("th-TH")) : "ไม่หมดอายุ"}
      </div>
      <div class="share-actions">
        <button class="share-action-copy" data-url="${url}">📋 Copy</button>
        <button class="share-action-revoke" data-tid="${t.id}">🚫 เพิกถอน</button>
      </div>
    `;
    list.appendChild(li);
  });
  list.querySelectorAll(".share-action-copy").forEach(b => {
    b.addEventListener("click", () => {
      const url = b.dataset.url;
      navigator.clipboard.writeText(url).then(() => showToast("📋 คัดลอกแล้ว", "success", 1500))
        .catch(() => prompt("คัดลอกลิงก์:", url));
    });
  });
  list.querySelectorAll(".share-action-revoke").forEach(b => {
    b.addEventListener("click", () => {
      showConfirm({
        icon: "🚫", title: "เพิกถอนลิงก์นี้?",
        msg: "คนที่มีลิงก์จะเข้าดูไม่ได้อีก", okText: "เพิกถอน", danger: true,
        onOk: () => revokeShareToken(parseInt(b.dataset.tid, 10))
      });
    });
  });
}

async function revokeShareToken(tokenId) {
  try {
    await api(`/api/trip/${state.tripId}/share-tokens/${tokenId}`, { method: "DELETE" });
    showToast("🚫 เพิกถอนแล้ว", "success");
    await loadShareTokens();
  } catch (err) {
    showToast(`❌ ${err.message}`, "error");
  }
}

async function createShareToken() {
  const label = ($("shareLabel").value || "").trim();
  try {
    await api(`/api/trip/${state.tripId}/share-tokens`, {
      method: "POST",
      body: JSON.stringify({
        label: label || undefined,
        privacy_mode: state.share.privacy,
        expires_in_hours: state.share.expiryHours
      })
    });
    $("shareLabel").value = "";
    showToast("✨ สร้างลิงก์ใหม่แล้ว", "success");
    await loadShareTokens();
  } catch (err) {
    showToast(`❌ ${err.message}`, "error", 4000);
  }
}

function openShareModal() {
  hideMoreSheet();
  state.share = { privacy: "full", expiryHours: null };
  document.querySelectorAll(".share-privacy").forEach(b =>
    b.classList.toggle("selected", b.dataset.privacy === "full"));
  document.querySelectorAll(".share-expiry").forEach(b =>
    b.classList.toggle("selected", b.dataset.expiry === ""));
  $("shareLabel").value = "";
  $("shareModal").hidden = false;
  loadShareTokens();
}
function closeShareModal() {
  $("shareModal").hidden = true;
}

function handleMenuAction(action) {
  hideMoreSheet();
  if (action === "rename") { openNameModal(); return; }
  if (action === "share") { openShareModal(); return; }
  if (action === "archive") {
    showConfirm({
      icon: "🗑️", title: "ยกเลิกทริปนี้?",
      msg: "ทริปจะถูก archive\nสมาชิกพิมพ์อะไรในกลุ่มต่อไป → trip ใหม่",
      okText: "ยืนยันยกเลิก", danger: true, onOk: doArchive
    });
  } else if (action === "reset") {
    showConfirm({
      icon: "♻️", title: "รีเซ็ตทริปนี้?",
      msg: "• ลบประวัติ location\n• เคลียร์ปลายทาง\n• ปิดแจ้งเตือน\n• ลบสถานะพักทั้งหมด",
      okText: "ยืนยันรีเซ็ต", danger: true, onOk: doReset
    });
  }
}

/* SOS */
function openSosModal() {
  closeDial();
  state.sosLocation = null;
  $("sosLocStatus").textContent = "📍 กำลังหาพิกัด...";
  $("sosLocStatus").className = "sos-loc-status";
  $("sosConfirm").disabled = true;
  $("sosModal").hidden = false;
  if (!navigator.geolocation) {
    $("sosLocStatus").textContent = "⚠️ เบราว์เซอร์ไม่รองรับ geolocation";
    $("sosLocStatus").className = "sos-loc-status error";
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.sosLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      $("sosLocStatus").textContent = `✅ ได้พิกัดแล้ว: ${state.sosLocation.lat.toFixed(5)}, ${state.sosLocation.lng.toFixed(5)}`;
      $("sosLocStatus").className = "sos-loc-status ok";
      $("sosConfirm").disabled = false;
    },
    (err) => {
      console.error(err);
      $("sosLocStatus").textContent = "❌ ขออนุญาต GPS แล้วลองใหม่";
      $("sosLocStatus").className = "sos-loc-status error";
    },
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }
  );
}
function closeSosModal() { $("sosModal").hidden = true; state.sosLocation = null; }
async function confirmSos() {
  if (!state.sosLocation) return;
  if (!state.tripId) { showToast("ไม่พบทริป", "error"); return; }
  $("sosConfirm").disabled = true;
  $("sosConfirm").textContent = "กำลังส่ง...";
  try {
    await api(`/api/trip/${state.tripId}/sos`, {
      method: "POST", body: JSON.stringify(state.sosLocation)
    });
    closeSosModal();
    showToast("🆘 ส่ง SOS แล้ว — รอความช่วยเหลือ", "success", 5000);
  } catch (err) {
    showToast(`❌ ${err.message}`, "error", 4000);
    $("sosConfirm").disabled = false;
    $("sosConfirm").textContent = "🆘 ส่ง SOS";
  }
}

/* 🆕 BREAK */
function getMyMember() {
  if (!state.currentTripData) return null;
  return state.currentTripData.members.find((m) => m.id === state.currentTripData.me?.memberId);
}

function openBreakModal(mode = "individual") {
  closeDial();
  state.breakMode = mode;
  const me = getMyMember();
  if (!me) { showToast("กรุณารอข้อมูลโหลดเสร็จ", "error"); return; }

  if (mode === "individual" && isOnBreak(me)) {
    // active break view
    $("breakModalTitle").textContent = "คุณกำลังพักอยู่";
    $("breakActiveSection").hidden = false;
    $("breakNewSection").hidden = true;
    $("breakActiveCountdown").textContent = `เหลืออีก ${breakMinutesLeft(me)} นาที`;
    $("breakActiveReason").textContent = REASON_LABEL[me.break_reason] || REASON_LABEL.other;
  } else {
    $("breakModalTitle").textContent = state.breakMode === "group" ? "👥 พักทั้งกลุ่ม" : "ตั้งพักรถ";
    $("breakActiveSection").hidden = true;
    $("breakNewSection").hidden = false;
    state.breakReason = "rest";
    state.breakDuration = 30;
    state.breakCustomDuration = null;
    $("breakCustomInput").value = "";
    $("breakNewBtnDuration").textContent = "30";
    document.querySelectorAll(".break-reason").forEach((b) => {
      b.classList.toggle("selected", b.dataset.reason === "rest");
    });
    document.querySelectorAll(".break-duration").forEach((b) => {
      b.classList.toggle("selected", b.dataset.duration === "30");
    });
  }
  $("breakModal").hidden = false;
}
function closeBreakModal() { $("breakModal").hidden = true; }

async function startBreak() {
  const duration = state.breakCustomDuration || state.breakDuration;
  const n = parseInt(duration, 10);
  if (!Number.isFinite(n) || n < 5 || n > 480) {
    showToast("ระบุเวลา 5-480 นาที", "error");
    return;
  }
  try {
    await api(`/api/trip/${state.tripId}/break`, {
      method: "POST",
      body: JSON.stringify({ duration_min: n, reason: state.breakReason })
    });
    closeBreakModal();
    showToast(`☕ เริ่มพัก ${n} นาที`, "break", 3000);
    await refresh();
  } catch (err) {
    showToast(`❌ ${err.message}`, "error", 4000);
  }
}

async function extendCurrentBreak(min) {
  try {
    await api(`/api/trip/${state.tripId}/break/extend`, {
      method: "POST",
      body: JSON.stringify({ additional_min: min })
    });
    closeBreakModal();
    showToast(`➕ พักต่ออีก ${min} นาที`, "break");
    await refresh();
  } catch (err) {
    showToast(`❌ ${err.message}`, "error", 4000);
  }
}

async function endCurrentBreak() {
  try {
    await api(`/api/trip/${state.tripId}/break/end`, { method: "POST" });
    closeBreakModal();
    showToast("🚗 ออกจากพักแล้ว — เริ่มเดินทาง", "success");
    await refresh();
  } catch (err) {
    showToast(`❌ ${err.message}`, "error", 4000);
  }
}

/* INIT */
async function init() {
  try {
    const cfg = await fetch("/api/config").then((r) => r.json());
    if (!cfg.liffId) {
      $("tripName").textContent = "⚠️ ยังไม่ตั้ง LIFF_ID";
      hideLoading();
      return;
    }
    state.liffId = cfg.liffId;
    state.refreshSec = cfg.refreshIntervalSec || DEFAULT_REFRESH_SEC;
    await liff.init({ liffId: state.liffId });
    if (!liff.isLoggedIn()) { liff.login(); return; }
    state.accessToken = liff.getAccessToken();
    initMap();
    const tripId = await pickInitialTrip();
    if (tripId) await switchToTrip(tripId);
  } catch (err) {
    console.error("init failed", err);
    $("tripName").textContent = "❌ เกิดข้อผิดพลาด";
    $("destName").textContent = err.message;
    hideLoading();
    showToast(`Init failed: ${err.message}`, "error", 4000);
  }
}

/* WIRE UP — defensive: ถ้า element หาย ให้ skip + log แทนที่จะ crash ทั้งหน้า */
function on(id, ev, handler) {
  const el = $(id);
  if (!el) { console.warn(`[wire] missing #${id}`); return; }
  el.addEventListener(ev, handler);
}
function onAll(sel, ev, handler) {
  const list = document.querySelectorAll(sel);
  if (list.length === 0) console.warn(`[wire] no elements for ${sel}`);
  list.forEach((el) => el.addEventListener(ev, (e) => handler(el, e)));
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    // Speed dial
    on("dialToggle", "click", toggleDial);
    on("dialBackdrop", "click", closeDial);
    onAll(".dial-action", "click", (btn) => {
      const action = btn.dataset.action;
      closeDial();
      if (action === "break") openBreakModal("individual");
      else if (action === "group-break") openBreakModal("group");
      else if (action === "live-share") toggleLiveShare();
      else if (action === "locate") fitAll();
      else if (action === "refresh") {
        refresh();
        state.countdownLeft = state.refreshSec;
        showToast("รีเฟรชแล้ว", "success", 1200);
      }
    });

    // SOS
    on("sosBtn", "click", openSosModal);
    on("sosCancel", "click", closeSosModal);
    on("sosConfirm", "click", confirmSos);
    on("sosModal", "click", (e) => { if (e.target.id === "sosModal") closeSosModal(); });

    // Break modal — reason buttons
    onAll(".break-reason", "click", (b) => {
      state.breakReason = b.dataset.reason;
      document.querySelectorAll(".break-reason").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
    });
    // Break modal — duration buttons
    onAll(".break-duration", "click", (b) => {
      state.breakDuration = parseInt(b.dataset.duration, 10);
      state.breakCustomDuration = null;
      const ci = $("breakCustomInput"); if (ci) ci.value = "";
      const bd = $("breakNewBtnDuration"); if (bd) bd.textContent = state.breakDuration;
      document.querySelectorAll(".break-duration").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
    });
    on("breakCustomInput", "input", (e) => {
      const v = parseInt(e.target.value, 10);
      if (Number.isFinite(v)) {
        state.breakCustomDuration = v;
        const bd = $("breakNewBtnDuration"); if (bd) bd.textContent = v;
        document.querySelectorAll(".break-duration").forEach((x) => x.classList.remove("selected"));
      }
    });
    on("breakNewConfirm", "click", () => {
      if (state.breakMode === "group") startGroupBreak();
      else startBreak();
    });
    on("shareCreateBtn", "click", createShareToken);
    on("shareClose", "click", closeShareModal);
    on("shareModal", "click", (e) => { if (e.target.id === "shareModal") closeShareModal(); });
    onAll(".share-privacy", "click", (b) => {
      state.share.privacy = b.dataset.privacy;
      document.querySelectorAll(".share-privacy").forEach(x => x.classList.remove("selected"));
      b.classList.add("selected");
    });
    onAll(".share-expiry", "click", (b) => {
      state.share.expiryHours = b.dataset.expiry ? parseInt(b.dataset.expiry, 10) : null;
      document.querySelectorAll(".share-expiry").forEach(x => x.classList.remove("selected"));
      b.classList.add("selected");
    });
    on("nameSave", "click", saveTripName);
    on("nameCancel", "click", closeNameModal);
    on("nameModal", "click", (e) => { if (e.target.id === "nameModal") closeNameModal(); });
    on("nameInput", "keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); saveTripName(); }
      else if (e.key === "Escape") closeNameModal();
    });
    on("autoTrackStop", "click", () => stopLiveShare());
    on("groupBreakEndBtn", "click", () => {
      showConfirm({
        icon: "🚗", title: "ออกจากพักกลุ่ม?",
        msg: "ทุกคนจะกลับมา track ปกติ", okText: "ออกจากพักกลุ่ม",
        danger: false, onOk: endGroupBreak
      });
    });
    on("breakNewCancel", "click", closeBreakModal);
    on("breakActiveCancel", "click", closeBreakModal);
    onAll(".break-extend-btn", "click", (b) => extendCurrentBreak(parseInt(b.dataset.extend, 10)));
    on("breakEndBtn", "click", endCurrentBreak);
    on("breakModal", "click", (e) => { if (e.target.id === "breakModal") closeBreakModal(); });

    // Top bar
    on("sheetHandle", "click", toggleSheet);
    on("menuBtn", "click", () => {
      if (state.tripsCache.length > 1) showTripModal(state.tripsCache);
      else showToast("คุณอยู่ในทริปเดียว");
    });
    on("tripModal", "click", (e) => { if (e.target.id === "tripModal") $("tripModal").hidden = true; });
    on("moreBtn", "click", showMoreSheet);
    on("moreSheet", "click", (e) => {
      if (e.target.id === "moreSheet" || e.target.dataset.close !== undefined) { hideMoreSheet(); return; }
      const item = e.target.closest(".menu-item");
      if (item?.dataset.action) handleMenuAction(item.dataset.action);
    });
    on("confirmModal", "click", (e) => { if (e.target.id === "confirmModal") $("confirmModal").hidden = true; });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopPolling();
      else if (state.tripId) { refresh(); startPolling(); }
    });
  } catch (err) {
    console.error("[wire] failed", err);
    // ไม่ throw ต่อ — init() ต้องรันให้ได้
  }

  // หน้าขาวเปล่า fallback: ถ้า init ไม่จบใน 30s บังคับซ่อน loadingOverlay
  setTimeout(() => {
    const lo = $("loadingOverlay");
    if (lo && !lo.classList.contains("hidden")) {
      hideLoading();
      const tn = $("tripName"); if (tn) tn.textContent = "Init timeout (30s)";
      showToast("Init timeout - check server / network", "error", 5000);
    }
  }, 30000);

  init();
});

/* =====================================================================
   AiKlao LIFF — Destination Picker
   - Map + center pin + reverse geocode (Nominatim ผ่าน backend proxy)
   - Search box + autocomplete
   - "ตำแหน่งฉัน" button (LIFF + browser geolocation fallback)
   - Confirm → POST /api/trip/:id/destination → close LIFF
   ===================================================================== */

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "aiklao.lastTripId";
const REVERSE_DEBOUNCE_MS = 400;
const SEARCH_DEBOUNCE_MS = 350;

const state = {
  liffId: null,
  accessToken: null,
  tripId: null,
  tripData: null,           // /api/trip/:id response
  map: null,
  selected: { lat: null, lng: null, name: null },
  reverseTimer: null,
  searchTimer: null,
  isSubmitting: false
};

/* ----- helpers ----- */

function showToast(msg, type = "default", ms = 2200) {
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
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function shortName(fullName) {
  // Nominatim display_name มักยาว เช่น "เขาใหญ่, อำเภอ..., จังหวัด..., 30130, ประเทศไทย"
  // ตัดเอา 2 ส่วนแรกพอ
  if (!fullName) return "";
  const parts = fullName.split(",").map((s) => s.trim());
  if (parts.length <= 2) return fullName;
  return parts.slice(0, 2).join(", ");
}

function closeWindow() {
  if (window.liff && liff.isInClient && liff.isInClient()) {
    liff.closeWindow();
  } else {
    window.close();
    history.back();
  }
}

/* ----- API ----- */

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${state.accessToken}`,
      ...(opts.body && !opts.headers?.["Content-Type"]
        ? { "Content-Type": "application/json" }
        : {})
    }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/* ----- Map ----- */

function initMap() {
  // เริ่มที่กรุงเทพ ถ้า trip มี dest อยู่แล้ว จะ flyTo ที่นั่นภายหลัง
  state.map = L.map("map", {
    zoomControl: true,
    attributionControl: true,
    zoomSnap: 0.5
  }).setView([13.7563, 100.5018], 11);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OSM"
  }).addTo(state.map);

  // เมื่อขยับแผนที่ → ดึงพิกัดกลางจอ → reverse geocode
  state.map.on("movestart", () => {
    $("centerPin").classList.add("dragging");
  });
  state.map.on("moveend", () => {
    $("centerPin").classList.remove("dragging");
    onCenterChanged();
  });
}

function onCenterChanged() {
  const c = state.map.getCenter();
  state.selected.lat = c.lat;
  state.selected.lng = c.lng;
  state.selected.name = null;

  $("selectedName").textContent = "กำลังหาชื่อสถานที่...";
  $("selectedName").classList.add("selected-loading");
  $("selectedCoords").textContent = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
  $("confirmBtn").disabled = true;

  clearTimeout(state.reverseTimer);
  state.reverseTimer = setTimeout(() => doReverseGeocode(c.lat, c.lng), REVERSE_DEBOUNCE_MS);
}

async function doReverseGeocode(lat, lng) {
  try {
    const data = await api(`/api/geocode/reverse?lat=${lat}&lng=${lng}`);
    if (Math.abs(state.map.getCenter().lat - lat) > 0.0001) return; // changed since
    if (!data || !data.displayName) {
      $("selectedName").textContent = "ตำแหน่งที่เลือก (ไม่พบชื่อ)";
      $("selectedName").classList.remove("selected-loading");
      state.selected.name = `พิกัด ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      $("confirmBtn").disabled = false;
      return;
    }
    state.selected.name = data.displayName;
    $("selectedName").textContent = shortName(data.displayName);
    $("selectedName").classList.remove("selected-loading");
    $("confirmBtn").disabled = false;
  } catch (err) {
    console.error("reverse failed", err);
    $("selectedName").textContent = "ตำแหน่งที่เลือก";
    $("selectedName").classList.remove("selected-loading");
    state.selected.name = `พิกัด ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    $("confirmBtn").disabled = false;
  }
}

/* ----- Search ----- */

function onSearchInput(e) {
  const q = e.target.value.trim();
  $("clearBtn").hidden = q.length === 0;

  clearTimeout(state.searchTimer);
  if (q.length < 2) {
    $("searchResults").hidden = true;
    return;
  }
  state.searchTimer = setTimeout(() => doSearch(q), SEARCH_DEBOUNCE_MS);
}

async function doSearch(q) {
  const box = $("searchResults");
  box.hidden = false;
  box.innerHTML = '<div class="search-loading">กำลังค้น…</div>';

  try {
    const data = await api(`/api/geocode/search?q=${encodeURIComponent(q)}`);
    if (!data.results || data.results.length === 0) {
      box.innerHTML = '<div class="search-empty">ไม่พบสถานที่ — ลองคำอื่น</div>';
      return;
    }
    box.innerHTML = "";
    data.results.forEach((r) => {
      const row = document.createElement("div");
      row.className = "result-row";
      row.innerHTML = `
        <div class="result-icon">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/>
          </svg>
        </div>
        <div class="result-text">
          <div class="result-name">${escapeHtml(shortName(r.displayName))}</div>
          <div class="result-sub">${escapeHtml(r.displayName)}</div>
        </div>`;
      row.addEventListener("click", () => selectResult(r));
      box.appendChild(row);
    });
  } catch (err) {
    box.innerHTML = `<div class="search-empty">❌ ${escapeHtml(err.message)}</div>`;
  }
}

function selectResult(r) {
  $("searchResults").hidden = true;
  $("searchInput").value = shortName(r.displayName);
  $("clearBtn").hidden = false;
  state.selected = { lat: r.lat, lng: r.lng, name: r.displayName };
  state.map.flyTo([r.lat, r.lng], 15, { duration: 0.6 });
  // moveend จะ trigger reverse แต่เราตั้งชื่อล่วงหน้าเลย
  setTimeout(() => {
    state.selected.name = r.displayName;
    $("selectedName").textContent = shortName(r.displayName);
    $("selectedName").classList.remove("selected-loading");
    $("confirmBtn").disabled = false;
  }, 700);
}

/* ----- My location ----- */

async function flyToMyLocation() {
  const btn = $("myLocationBtn");
  btn.classList.add("active");

  // ลอง LIFF getUserProfile + LINE getProfile ไม่ได้ตำแหน่ง — ต้องใช้ browser geolocation
  if (!navigator.geolocation) {
    showToast("เบราว์เซอร์ไม่รองรับ geolocation", "error");
    btn.classList.remove("active");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.map.flyTo([pos.coords.latitude, pos.coords.longitude], 15, { duration: 0.6 });
      btn.classList.remove("active");
    },
    (err) => {
      console.error(err);
      showToast("เปิด GPS หรืออนุญาตตำแหน่งก่อน", "error");
      btn.classList.remove("active");
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 }
  );
}

/* ----- Confirm ----- */

async function confirmDestination() {
  if (state.isSubmitting) return;
  if (state.selected.lat == null || state.selected.lng == null) {
    showToast("เลือกตำแหน่งก่อน", "error");
    return;
  }
  state.isSubmitting = true;
  $("confirmBtn").textContent = "กำลังบันทึก...";
  $("confirmBtn").disabled = true;

  try {
    await api(`/api/trip/${state.tripId}/destination`, {
      method: "POST",
      body: JSON.stringify({
        lat: state.selected.lat,
        lng: state.selected.lng,
        name: state.selected.name || `พิกัด ${state.selected.lat.toFixed(4)}, ${state.selected.lng.toFixed(4)}`
      })
    });
    showToast("✅ ตั้งปลายทางเรียบร้อย", "success");
    setTimeout(closeWindow, 800);
  } catch (err) {
    console.error("confirm failed", err);
    showToast(`❌ ${err.message}`, "error", 4000);
    state.isSubmitting = false;
    $("confirmBtn").textContent = "ตั้งเป็นปลายทาง";
    $("confirmBtn").disabled = false;
  }
}

/* ----- Trip resolution ----- */

async function resolveTripId() {
  // 1) ?trip=N
  const urlTrip = new URLSearchParams(location.search).get("trip");
  if (urlTrip) return parseInt(urlTrip, 10);

  // 2) localStorage จาก map view
  const last = localStorage.getItem(STORAGE_KEY);
  if (last) return parseInt(last, 10);

  // 3) /api/me/trips → ใช้ทริปแรก (ทริปล่าสุด)
  const data = await api("/api/me/trips");
  if (!data.trips || data.trips.length === 0) {
    throw new Error("คุณยังไม่ได้อยู่ในทริปไหน");
  }
  return data.trips[0].id;
}

async function loadTrip(tripId) {
  const data = await api(`/api/trip/${tripId}`);
  state.tripData = data;

  if (!data.me?.isLeader) {
    $("loadingOverlay").style.display = "none";
    $("errorState").hidden = false;
    document.querySelector(".search-box").hidden = true;
    document.querySelector("#map").hidden = true;
    document.querySelector(".bottom-panel").hidden = true;
    return false;
  }

  // ถ้ามี dest อยู่แล้ว → flyTo ตำแหน่งเดิม
  if (data.trip.dest_lat != null && data.trip.dest_lng != null) {
    state.map.setView([Number(data.trip.dest_lat), Number(data.trip.dest_lng)], 14);
    state.selected = {
      lat: Number(data.trip.dest_lat),
      lng: Number(data.trip.dest_lng),
      name: data.trip.dest_name
    };
    $("selectedName").textContent = shortName(data.trip.dest_name) || "ปลายทางปัจจุบัน";
    $("selectedName").classList.remove("selected-loading");
    $("selectedCoords").textContent =
      `${Number(data.trip.dest_lat).toFixed(5)}, ${Number(data.trip.dest_lng).toFixed(5)}`;
    $("confirmBtn").disabled = false;
  }

  $("bottomPanel").hidden = false;
  $("myLocationBtn").hidden = false;
  return true;
}

/* ----- Init ----- */

async function init() {
  try {
    const cfg = await fetch("/api/config").then((r) => r.json());
    if (!cfg.liffId) {
      $("errorTitle").textContent = "⚠️ ยังไม่ตั้ง LIFF_ID";
      $("errorMsg").textContent = "ตั้งค่า env LIFF_ID ใน server";
      $("errorState").hidden = false;
      hideLoading();
      return;
    }
    state.liffId = cfg.liffId;

    await liff.init({ liffId: state.liffId });
    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }
    state.accessToken = liff.getAccessToken();

    initMap();

    state.tripId = await resolveTripId();
    const ok = await loadTrip(state.tripId);
    hideLoading();

    if (!ok) return; // not leader, error UI shown

    // wire up events
    $("backBtn").addEventListener("click", closeWindow);
    $("errorClose").addEventListener("click", closeWindow);
    $("searchInput").addEventListener("input", onSearchInput);
    $("clearBtn").addEventListener("click", () => {
      $("searchInput").value = "";
      $("clearBtn").hidden = true;
      $("searchResults").hidden = true;
    });
    $("myLocationBtn").addEventListener("click", flyToMyLocation);
    $("confirmBtn").addEventListener("click", confirmDestination);

    // ปิด search dropdown เมื่อแตะนอก
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".search-box")) {
        $("searchResults").hidden = true;
      }
    });
  } catch (err) {
    console.error("init failed", err);
    $("errorTitle").textContent = "❌ เกิดข้อผิดพลาด";
    $("errorMsg").textContent = err.message;
    $("errorState").hidden = false;
    hideLoading();
  }
}

init();
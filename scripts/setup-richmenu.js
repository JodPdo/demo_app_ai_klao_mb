// Upload richmenu.png + register tap areas + set as default
// รัน: npm run richmenu:setup
//
// 🆕 v3.4-patch: tile (1,1) "ตั้งปลายทาง" เปลี่ยนจาก URI → message
//   - ผู้กดส่ง text "ตั้งปลายทาง" → bot auto-register + promote เป็น leader (ถ้าไม่มี)
//   - bot ตอบกลับพร้อมลิงก์ picker

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const LIFF_URL = process.env.LIFF_URL || "https://liff.line.me/";

if (!TOKEN) {
  console.error("❌ CHANNEL_ACCESS_TOKEN ไม่อยู่ใน .env");
  process.exit(1);
}

const PNG_PATH = path.join(__dirname, "..", "richmenu", "richmenu.png");
if (!fs.existsSync(PNG_PATH)) {
  console.error(`❌ ไม่พบ ${PNG_PATH} — รัน 'npm run richmenu:build' ก่อน`);
  process.exit(1);
}

const richMenu = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: "AiKlao Main Menu",
  chatBarText: "เปิดเมนู",
  areas: [
    // Big tile (left, full height) — แผนที่
    {
      bounds: { x: 0, y: 0, width: 1000, height: 1686 },
      action: { type: "uri", label: "แผนที่", uri: LIFF_URL }
    },
    // (1,0) ส่งตำแหน่ง
    {
      bounds: { x: 1000, y: 0, width: 500, height: 843 },
      action: { type: "message", label: "ส่งตำแหน่ง", text: "ส่งตำแหน่ง" }
    },
    // (2,0) สถานะ
    {
      bounds: { x: 1500, y: 0, width: 500, height: 843 },
      action: { type: "message", label: "สถานะ", text: "สถานะ" }
    },
    // (3,0) ระยะของฉัน
    {
      bounds: { x: 2000, y: 0, width: 500, height: 843 },
      action: { type: "message", label: "ระยะ", text: "ระยะ" }
    },
    // 🆕 (1,1) ตั้งปลายทาง — message type → bot auto-register/promote ผู้กด
    {
      bounds: { x: 1000, y: 843, width: 500, height: 843 },
      action: { type: "message", label: "ตั้งปลายทาง", text: "ตั้งปลายทาง" }
    },
    // (2,1) แจ้งเตือน
    {
      bounds: { x: 1500, y: 843, width: 500, height: 843 },
      action: { type: "message", label: "แจ้งเตือน", text: "เปิดแจ้งเตือน" }
    },
    // (3,1) ยกเลิกทริป
    {
      bounds: { x: 2000, y: 843, width: 500, height: 843 },
      action: { type: "message", label: "ยกเลิกทริป", text: "ยกเลิกทริป" }
    }
  ]
};

async function api(path, opts = {}) {
  const url = `https://api.line.me${path}`;
  const headers = { Authorization: `Bearer ${TOKEN}`, ...(opts.headers || {}) };
  const res = await fetch(url, { ...opts, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

async function uploadImage(richMenuId) {
  const url = `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`;
  const buf = fs.readFileSync(PNG_PATH);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "image/png" },
    body: buf
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`upload image → ${res.status}: ${text}`);
  }
}

(async () => {
  console.log("🧹 ลบ rich menu เก่า (ถ้ามี)...");
  try {
    const list = await api("/v2/bot/richmenu/list");
    for (const m of list.richmenus || []) {
      console.log(`  - ${m.richMenuId} (${m.name})`);
      await api(`/v2/bot/richmenu/${m.richMenuId}`, { method: "DELETE" });
    }
  } catch (err) {
    console.log("  (ข้าม:", err.message, ")");
  }

  console.log("📤 สร้าง rich menu ใหม่...");
  const created = await api("/v2/bot/richmenu", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(richMenu)
  });
  const richMenuId = created.richMenuId;
  console.log(`  ✅ richMenuId = ${richMenuId}`);

  console.log("🖼️  Upload PNG...");
  await uploadImage(richMenuId);
  console.log("  ✅ uploaded");

  console.log("📌 Set as default for all users...");
  await api(`/v2/bot/user/all/richmenu/${richMenuId}`, { method: "POST" });
  console.log("  ✅ done");

  console.log("\n🎉 เสร็จสิ้น — ปิด-เปิด LINE chat ใหม่จะเห็น rich menu ใหม่");
})().catch((err) => {
  console.error("❌ setup failed:", err.message);
  process.exit(1);
});
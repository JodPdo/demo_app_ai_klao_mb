// ลบ rich menu ทั้งหมด — เผื่อต้องการ reset
// รัน: npm run richmenu:teardown

require("dotenv").config();

const TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("❌ CHANNEL_ACCESS_TOKEN ไม่อยู่ใน .env");
  process.exit(1);
}

async function api(path, opts = {}) {
  const url = `https://api.line.me${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(opts.headers || {}) }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

(async () => {
  console.log("🧹 Unset default rich menu...");
  try {
    await api(`/v2/bot/user/all/richmenu`, { method: "DELETE" });
    console.log("  ✅ unset");
  } catch (err) {
    console.log("  (ข้าม:", err.message, ")");
  }

  console.log("🗑️  ลบ rich menu ทั้งหมด...");
  const list = await api("/v2/bot/richmenu/list");
  for (const m of list.richmenus || []) {
    console.log(`  - ${m.richMenuId} (${m.name})`);
    await api(`/v2/bot/richmenu/${m.richMenuId}`, { method: "DELETE" });
  }
  console.log("\n✅ เสร็จสิ้น");
})().catch((err) => {
  console.error("❌ teardown failed:", err.message);
  process.exit(1);
});
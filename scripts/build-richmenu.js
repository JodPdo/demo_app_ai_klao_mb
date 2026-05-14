// Build richmenu.png from richmenu/source.svg using sharp
// รัน: npm run richmenu:build
//
// ต้องการ: เครื่องคุณมี Thai font ติดตั้ง (Sarabun, Tahoma, Noto Sans Thai)
// macOS/Windows มักมี Thai font ในระบบอยู่แล้ว
// Linux: sudo apt install fonts-thai-tlwg

const fs = require("fs");
const path = require("path");

(async () => {
  let sharp;
  try {
    sharp = require("sharp");
  } catch (err) {
    console.error("❌ sharp ไม่ติดตั้ง — รัน: npm install sharp");
    process.exit(1);
  }

  const svgPath = path.join(__dirname, "..", "richmenu", "source.svg");
  const outPath = path.join(__dirname, "..", "richmenu", "richmenu.png");

  if (!fs.existsSync(svgPath)) {
    console.error(`❌ ไม่พบ ${svgPath}`);
    process.exit(1);
  }

  const svg = fs.readFileSync(svgPath);

  console.log("🎨 Rendering 2500×1686 PNG...");
  await sharp(svg, { density: 150 })
    .resize(2500, 1686, { fit: "fill" })
    .png({ compressionLevel: 9, quality: 90 })
    .toFile(outPath);

  const stat = fs.statSync(outPath);
  console.log(`✅ ${outPath} (${(stat.size / 1024).toFixed(1)} KB)`);

  if (stat.size > 1024 * 1024) {
    console.warn("⚠️ ไฟล์ใหญ่เกิน 1MB อาจ upload ไม่สำเร็จ — ลองลด quality ใน build script");
  }
})().catch((err) => {
  console.error("❌ build failed:", err.message);
  process.exit(1);
});
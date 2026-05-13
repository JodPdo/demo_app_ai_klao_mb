// Format leaderboard text สำหรับ scheduler push

const STALE_THRESHOLD_MIN = 60;

/**
 * @param {object} trip - row จาก trips table
 * @param {Array} rows - results จาก getTripLeaderboard()
 * @param {number} intervalMin - interval ปัจจุบันของ trip
 */
function formatLeaderboard(trip, rows, intervalMin) {
  let txt = `🚦 อัพเดททริป (อัตโนมัติ)\n🎯 ${trip.dest_name}\n\n`;

  // หา index ของคนที่มี location จริง (ไม่ใช่ null)
  const haveDistance = rows.filter(r => r.distance_km != null);
  const closestId = haveDistance[0]?.member_id;
  const farthestId = haveDistance[haveDistance.length - 1]?.member_id;

  rows.forEach((r, i) => {
    const crown = r.is_leader ? " 👑" : "";

    if (r.distance_km == null) {
      txt += `${i + 1}. ${r.display_name}${crown} — ยังไม่ส่ง location ⚠️\n`;
      return;
    }

    let badge = "";
    if (r.member_id === closestId && haveDistance.length > 1) badge = " ✨ ใกล้สุด";
    if (r.member_id === farthestId && haveDistance.length > 1) badge = " 🐢 ห่างสุด";

    const stale = r.minutes_ago > STALE_THRESHOLD_MIN
      ? ` ⏱️ (${Math.floor(r.minutes_ago)} นาทีที่แล้ว)`
      : "";

    txt += `${i + 1}. ${r.display_name}${crown} — ${r.distance_km.toFixed(1)} km${badge}${stale}\n`;
  });

  txt += `\n⏰ แจ้งเตือนทุก ${intervalMin} นาที`;
  txt += `\n💡 พิมพ์ "ปิดแจ้งเตือน" เพื่อหยุด`;

  return txt;
}

module.exports = { formatLeaderboard, STALE_THRESHOLD_MIN };
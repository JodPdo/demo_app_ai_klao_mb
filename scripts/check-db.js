// ดูข้อมูลใน DB ทุกตาราง
// รัน: npm run check

const db = require("../lib/db");

console.log("\n🎯 TRIPS:");
console.table(
  db.prepare(`
    SELECT id, name, line_group_id, dest_name, status, created_at
    FROM trips
    ORDER BY created_at DESC
  `).all()
);

console.log("\n👥 MEMBERS:");
console.table(
  db.prepare(`
    SELECT id, trip_id, display_name, is_leader, line_user_id, joined_at
    FROM members
    ORDER BY trip_id, is_leader DESC
  `).all()
);

console.log("\n📍 LOCATIONS (ล่าสุด 10):");
console.table(
  db.prepare(`
    SELECT l.id, l.trip_id, m.display_name, l.distance_km, l.created_at
    FROM locations l
    JOIN members m ON m.id = l.member_id
    ORDER BY l.created_at DESC
    LIMIT 10
  `).all()
);

console.log("\n🔔 NOTIFICATION SETTINGS:");
console.table(
  db.prepare(`
    SELECT trip_id, enabled, interval_min, last_pushed_at
    FROM notification_settings
    ORDER BY trip_id
  `).all()
);

console.log("\n📤 PUSH LOG (ล่าสุด 10):");
console.table(
  db.prepare(`
    SELECT id, trip_id, status, error_message, pushed_at
    FROM push_log
    ORDER BY pushed_at DESC
    LIMIT 10
  `).all()
);

console.log("\n📊 QUOTA COUNTER:");
console.table(
  db.prepare(`SELECT ym, count FROM quota_counter ORDER BY ym DESC`).all()
);
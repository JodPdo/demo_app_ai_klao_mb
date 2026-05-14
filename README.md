# AiKlao Bot — LINE Group Trip Tracker

บอทติดตามการเดินทางแบบกลุ่มบน LINE แบบ real-time  
สมาชิกในกลุ่มเห็นตำแหน่ง, ระยะทางที่เหลือ, ETA และสถานะพักของกันและกัน — ทั้งหมดผ่าน LINE โดยไม่ต้องติดตั้งแอปเพิ่ม

**Version:** 0.1.9 | **Runtime:** Node.js 20+ / Express 5 | **DB:** PostgreSQL 15

> "เพื่อนอยู่ไหน ใกล้ถึงยัง — รู้ได้ทันที"

---

## Features

- **Real-time location tracking** — ส่งตำแหน่งผ่าน LINE location message หรือ LIFF auto-track (v3.6)
- **ETA คำนวณอัตโนมัติ** — ใช้ประวัติ 5 จุดล่าสุด + Haversine formula, speed clamp 5–80 km/h
- **Personal & Group Break** — หัวหน้าประกาศพักกลุ่ม หรือสมาชิกพักเองได้ พร้อมออกจากพักอัตโนมัติเมื่อขยับ > 1 km
- **Safety Alerts** — แจ้งเตือน stale member, SOS, stationary
- **Share Token v4.0** — ลิงก์สาธารณะสำหรับครอบครัวนอกกลุ่ม LINE พร้อม privacy mode (`full` / `initial-only`)
- **Push Notifications** — แจ้งสรุปทริปตามช่วงเวลา เคารพโควตา LINE free tier
- **LIFF Web App** — แผนที่และสถานะสมาชิก ภายใน LINE

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 LTS |
| Framework | Express 5.2 |
| Database | PostgreSQL 15 + pg (node-postgres) |
| LINE SDK | @line/bot-sdk |
| Scheduler | node-cron (ทุก 5 นาที, 4 tasks) |
| Logging | Pino (JSON in prod, pretty in dev) |
| Security | Helmet, express-rate-limit, HMAC-SHA256 |
| Testing | Jest + Supertest (80.2% statement coverage) |
| Process Mgmt | PM2 |
| CI/CD | GitHub Actions → SSH deploy to VPS |

---

## Project Structure

```
aiklao_be/
├── server.js                  # Entry point, Express setup, graceful shutdown
├── routes/
│   └── api.js                 # REST endpoints (/api/*) — 24 routes
├── handlers/
│   └── webhook.js             # LINE event handler & command parser
├── services/
│   ├── safety.js              # Stale / stationary / SOS / break logic
│   ├── groupBreak.js          # Group break management
│   ├── eta.js                 # ETA calculation
│   ├── locationProcessor.js   # Unified location storage + checks
│   ├── scheduler.js           # node-cron background tasks
│   └── shareToken.js          # Share Token v4.0
├── lib/
│   ├── db.js                  # pg pool + query helpers + migration runner
│   ├── lineClient.js          # LINE MessagingApiClient
│   └── logger.js              # Pino logger
├── middleware/
│   └── liffAuth.js            # LIFF token verify + 5-min cache
├── utils/
│   ├── distance.js            # Haversine formula
│   ├── geocode.js             # Nominatim OSM wrapper
│   ├── lineTarget.js          # Parse LINE group/room ID
│   └── pushFormatter.js       # Format push notification text
├── migrations/
│   ├── 001_initial.sql ~ 007_phase36.sql
│   └── 008_share_token.sql    # Share Token v4.0
├── tests/
│   └── server.test.js         # Integration tests (Jest + Supertest)
├── scripts/
│   ├── check-db.js            # Debug: แสดงข้อมูลใน DB
│   ├── build-richmenu.js
│   ├── setup-richmenu.js
│   └── teardown-richmenu.js
├── ecosystem.config.js        # PM2 config
└── .github/workflows/
    └── deploy.yml             # GitHub Actions CI/CD
```

---

## Setup (Development)

### Prerequisites

- Node.js >= 18.0.0 (แนะนำ 20 LTS)
- PostgreSQL 15
- LINE Developer Account (Messaging API channel + LIFF app)

### 1. Clone & Install

```bash
git clone https://github.com/torpeerapolthi/demo_app_ai_klao_be.git
cd demo_app_ai_klao_be
npm install
```

### 2. Environment Variables

สร้างไฟล์ `.env` ที่ root:

```env
# LINE Messaging API
CHANNEL_SECRET=your_line_channel_secret
CHANNEL_ACCESS_TOKEN=your_line_channel_access_token
LINE_LOGIN_CHANNEL_ID=your_liff_channel_id

# LIFF
LIFF_ID=your_liff_app_id
LIFF_REFRESH_SEC=15

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/aiklao_db
PG_POOL_MAX=10
PG_SSL=false

# Server
PORT=3001
NODE_ENV=development

# Optional overrides
MONTHLY_PUSH_LIMIT=200
SCHEDULER_TICK=*/5 * * * *
SLOW_QUERY_MS=300
ALLOWED_ORIGINS=https://your-liff-domain.com
```

### 3. Create Database

```bash
createdb aiklao_db
```

> Migration รันอัตโนมัติตอน server start — ไม่ต้องรันแยก

### 4. Start Dev Server

```bash
npm run dev
```

Server เริ่มที่ `http://localhost:3001`

### 5. Expose Webhook (ngrok)

```bash
ngrok http 3001
```

เอา URL ไปตั้งใน LINE Developer Console → Webhook URL:

```
https://xxxx.ngrok-free.app/webhook
```

---

## API Endpoints (28)

| Group | Method | Path | Auth |
|---|---|---|---|
| System | GET | `/healthz` | None |
| System | GET | `/api/config` | None |
| Webhook | POST | `/webhook` | LINE Signature |
| Share Token | GET | `/share/:token` | None (public) |
| LIFF Watch | GET | `/watch/:token` | None (public) |
| Auth | GET | `/api/me` | LIFF Token |
| Auth | GET | `/api/me/trips` | LIFF Token |
| Trip | GET/PATCH/POST | `/api/trip/:tripId` | LIFF Token |
| Destination | POST | `/api/trip/:tripId/destination` | LIFF Token (leader) |
| Location | POST | `/api/trip/:tripId/location` | LIFF Token |
| Break | POST | `/api/trip/:tripId/break` | LIFF Token |
| Break | POST | `/api/trip/:tripId/break/extend` | LIFF Token |
| Break | POST | `/api/trip/:tripId/break/end` | LIFF Token |
| Group Break | POST | `/api/trip/:tripId/group-break` | LIFF Token (leader) |
| Group Break | POST | `/api/trip/:tripId/group-break/extend` | LIFF Token (leader) |
| Group Break | POST | `/api/trip/:tripId/group-break/end` | LIFF Token (leader) |
| Live Share | POST | `/api/trip/:tripId/live-share/start` | LIFF Token |
| Live Share | POST | `/api/trip/:tripId/live-share/stop` | LIFF Token |
| Safety | POST | `/api/trip/:tripId/sos` | LIFF Token |
| Safety | GET | `/api/trip/:tripId/safety` | LIFF Token |
| Geocoding | GET | `/api/geocode/search?q=` | LIFF Token |
| Geocoding | GET | `/api/geocode/reverse?lat=&lng=` | LIFF Token |
| Share Token | POST | `/api/trip/:tripId/share-tokens` | LIFF Token (leader) |
| Share Token | GET | `/api/trip/:tripId/share-tokens` | LIFF Token (leader) |
| Share Token | DELETE | `/api/trip/:tripId/share-tokens/:tokenId` | LIFF Token (leader) |

**Rate limits:** 100 req / 15 min per IP (global) · 12 s minimum between location updates per member

---

## Database (8 Tables)

```
trips ──< members ──< locations
  │           │
  │           └──< safety_alerts
  │
  ├── notification_settings (1:1)
  ├──< push_log
  └──< share_tokens    ← v4.0

quota_counter  (standalone — monthly push count)
```

17 indexes รวม partial indexes สำหรับ scheduler queries

---

## LINE Bot Commands

| คำสั่ง | บทบาท | ความหมาย |
|---|---|---|
| ส่งตำแหน่ง | ทุกคน | แชร์ GPS location |
| สถานะ / status | ทุกคน | ดูสถานะสมาชิกทุกคน |
| ระยะ / distance | ทุกคน | ดูระยะทางของตัวเอง |
| พัก [นาที] | ทุกคน | เริ่มช่วงพักส่วนตัว |
| ออกจากพัก | ทุกคน | สิ้นสุดพัก |
| ช่วย / help | ทุกคน | แสดงคำสั่งทั้งหมด |
| ตั้งปลายทาง [ชื่อ] | หัวหน้า | กำหนด destination |
| พักกลุ่ม [นาที] | หัวหน้า | ประกาศพักทั้งกลุ่ม |
| จบทริป | หัวหน้า | Archive trip |

---

## Testing

```bash
npm test                # รัน tests ทั้งหมด
npm run test:coverage   # พร้อม coverage report
```

**Coverage (v0.1.9):**

| Module | Statements | Functions | Status |
|---|---|---|---|
| utils/distance.js | 100% | 100% | ✅ |
| utils/lineTarget.js | 100% | 100% | ✅ |
| services/shareToken.js | 95.0% | 100% | ✅ |
| utils/eta.js | 95.9% | 100% | ✅ |
| services/safety.js | 85.5% | 85.7% | ✅ |
| auth/liffAuth.js | 80.0% | 50.0% | ⚠️ |
| routes/api.js | 76.2% | 89.3% | 📋 |
| services/groupBreak.js | 74.0% | 80.0% | ⚠️ |
| server.js | 63.2% | 21.4% | 🚨 |
| **TOTAL** | **80.2%** | **79.3%** | |

---

## Production (VPS + PM2)

### GitHub Actions Auto Deploy

Push ไปที่ `main` → GitHub Actions SSH เข้า VPS รัน deploy script อัตโนมัติ

GitHub Secrets ที่ต้องตั้ง:

| Secret | ค่า |
|---|---|
| `VPS_HOST` | IP หรือ domain ของ VPS |
| `VPS_USER` | SSH username |
| `VPS_PORT` | SSH port |
| `VPS_SSH_KEY` | Private key สำหรับ SSH |

### PM2 Commands

```bash
pm2 start ecosystem.config.js   # Start
pm2 reload aiklao_be            # Reload (zero-downtime)
pm2 restart aiklao_be --update-env  # Restart + อัป env
pm2 logs aiklao_be              # ดู logs
pm2 status                      # ดู process status
```

Logs: `/root/.pm2/logs/aiklao-be-out.log` และ `aiklao-be-error.log`

### Health Check

```bash
curl https://your-domain.com/healthz
# {"ok":true}
```

---

## Share Token (v4.0)

ครอบครัวหรือคนที่อยู่นอกกลุ่ม LINE ดูสถานะทริปได้ผ่านลิงก์สาธารณะ

```
GET /share/:token
```

| Privacy Mode | ข้อมูลที่เห็น |
|---|---|
| `full` | ชื่อเต็ม, รูปโปรไฟล์, ตำแหน่ง, ETA |
| `initial-only` | ตัวอักษรตัวแรกของชื่อเท่านั้น ไม่เห็นรูป |

หัวหน้าสร้าง token ได้สูงสุด **20 tokens ต่อทริป** ผ่าน LIFF app

---

## Debug Scripts

```bash
npm run check              # ดูข้อมูลใน DB
npm run richmenu:build     # Build Rich Menu assets
npm run richmenu:setup     # Upload Rich Menu ไป LINE
npm run richmenu:teardown  # ลบ Rich Menu
```

---

## Known Issues (Sprint 2)

- `server.js` function coverage 21.4% — อยู่ใน Sprint 2 backlog
- `liffAuth.js` function coverage 50% — อยู่ใน Sprint 2 backlog
- Nominatim geocoding ไม่มี LRU cache — external call ทุกครั้ง
- Scheduler ไม่มี PG advisory lock — อาจซ้ำกันถ้าขยายเป็นหลาย instance

---

## Author

Jod (Backend Developer) — AiKlao Team

# RUNBOOK.md — AiKlao Mobile Backend (aiklao_mb)

คู่มือ troubleshooting สำหรับ on-call / devops
เมื่อระบบมีปัญหาให้ดูที่นี่ก่อน

> **This runbook is for the Node mobile-API service (`aiklao_mb`, port 3002,
> `/api/mobile/*` + `/api/liff/*`) only.** The LINE bot webhook, safety/scheduler
> jobs, and SOS admin tooling live in the sibling Java Spring Boot service
> (`demo_app_ai_klao_be`, PM2 process `aiklao_be`, port 3000) — that service has
> its own runbook. Don't restart the wrong process by name.

---

## Quick Reference

```bash
# Health check
curl https://your-domain.com/healthz

# PM2 status
pm2 status

# Tail logs
pm2 logs aiklao_mb

# Restart (กรณีฉุกเฉิน)
pm2 restart aiklao_mb --update-env
```

---

## Incident 1 — Service Down / 502 Bad Gateway

**อาการ:** Mobile app login ไม่ได้ (`/api/mobile/auth` ไม่ตอบ), LIFF page โหลด trip ไม่ขึ้น, Nginx แสดง 502

**ตรวจสอบ:**

```bash
# ดู PM2 status
pm2 status
# ถ้า status = errored หรือ stopped → restart

pm2 restart aiklao_mb --update-env
pm2 logs aiklao_mb --lines 50
```

**สาเหตุที่พบบ่อย:**

| สาเหตุ | วิธีแก้ |
|---|---|
| Memory เกิน 512MB (PM2 auto-restart loop) | `pm2 logs` ดูว่า leak ที่ไหน, restart ก่อน |
| PORT conflict | `lsof -i :3002` ดูว่ามี process อื่นใช้ port นี้ไหม (Java backend ใช้ 3000, อย่าไปชนกัน) |
| Crash ตอน startup (env ผิด) | ตรวจ `.env` ว่าครบและถูกต้อง — โดยเฉพาะ `DATABASE_URL`, `MOBILE_JWT_SECRET`, `MOBILE_LINE_CHANNEL_ID` (ขาดอันไหนแล้ว auth จะพังทั้งหมด แต่ server ยังบูตขึ้น) |
| DB connection ล้มเหลว | ดู Incident 2 |

---

## Incident 2 — Database Connection Failed

**อาการ:** `/healthz` ตอบ `{"ok":false}`, log แสดง `ECONNREFUSED` หรือ `pg error`

**ตรวจสอบ:**

```bash
# ดู PostgreSQL status
systemctl status postgresql

# ทดสอบ connection
psql "$DATABASE_URL" -c "SELECT 1;"

# ดู active connections (อาจเต็ม pool)
psql -U aiklao_user -d aiklao_db -c "
  SELECT count(*), state
  FROM pg_stat_activity
  WHERE datname = 'aiklao_db'
  GROUP BY state;"
```

**วิธีแก้:**

```bash
# PostgreSQL หยุดทำงาน
systemctl restart postgresql

# Connection pool เต็ม — kill idle connections
psql -U postgres -c "
  SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE datname = 'aiklao_db'
    AND state = 'idle'
    AND query_start < now() - interval '5 minutes';"

# Restart app หลังแก้ DB
pm2 restart aiklao_mb --update-env
```

---

## Incident 3 — LINE Webhook ไม่รับ Events

**⚠️ ไม่ใช่ service นี้.** `aiklao_mb` (repo นี้) ไม่มี `/webhook` route เลย — ไม่มี
`handlers/webhook.js`, ไม่มี LINE webhook handler ในโค้ดนี้อีกต่อไป. Webhook events
ทั้งหมดถูกรับโดย Java backend (`demo_app_ai_klao_be`, PM2 process `aiklao_be`, port
3000) — ถ้า bot ไม่ตอบใน LINE ให้ไปดู runbook ของ service นั้นแทน, ไม่ใช่ที่นี่.

---

## Incident 4 — Push Notification ไม่ส่ง

**อาการ:** ไม่มี push notification เลย ทั้งที่เปิดอยู่ (SOS alert / arrival notice /
invite push จาก mobile app)

**หมายเหตุ:** `push_log` และ `quota_counter` (ตารางที่ query ด้านล่าง) เป็นตารางเก่า
จาก schema เดิม (`migrations/001_initial.sql`) — โค้ดปัจจุบันใน repo นี้
(`routes/mobileTrips.js`, `routes/lineNotify.js`) **ไม่ได้เขียนลงตารางเหล่านี้เลย**
และไม่มี quota/`MONTHLY_PUSH_LIMIT` check ใดๆ ในโค้ดนี้ — ถ้าตารางนี้ยังถูกเขียนอยู่จริง
แปลว่าเป็นฝั่ง Java backend ที่เขียน (shared DB). สำหรับ push ที่ยิงจาก `aiklao_mb`
เอง ให้ดู log ของ service นี้โดยตรงแทน:

```bash
pm2 logs aiklao_mb | grep -i "\[sos\]\|\[arrival\]\|\[line-notify\]\|\[mobile-trips\]"
```

`pushFlexToLine()` (`routes/mobileTrips.js`) และ `/api/internal/line-notify`
(`routes/lineNotify.js`) ทั้งคู่ timeout ที่ 5s และ log ผ่าน `logger.warn`/`logger.error`
เมื่อ push ล้มเหลว — ไม่มี retry, ไม่มี quota, best-effort เท่านั้น.

**สาเหตุที่พบบ่อย:**

| สาเหตุ | วิธีแก้ |
|---|---|
| `CHANNEL_ACCESS_TOKEN` ไม่ได้ตั้งใน env | route จะ throw/503 ทันที — ตรวจ `.env` แล้ว `pm2 restart aiklao_mb --update-env` |
| LINE API 429 | rate limit, รอสักครู่ |
| LINE API 401 | `CHANNEL_ACCESS_TOKEN` หมดอายุหรือผิด |
| Recipient ไม่มี `line_user_id` | ไม่ได้ push ให้คนนั้น (query กรอง `line_user_id IS NOT NULL`) — ตรวจสอบข้อมูล `members` |

---

## Incident 5 — Scheduler หยุดทำงาน

**⚠️ ไม่ใช่ service นี้.** `aiklao_mb` (repo นี้) ไม่มี scheduler/cron ใดๆ — ไม่มี
`services/scheduler.js`, ไม่มี `node-cron` dependency ใน `package.json`, ไม่มี
`SCHEDULER_TICK` env var ที่โค้ดนี้อ่าน. Stale-member alert และ break-expiry logic
อยู่ที่ Java backend (`demo_app_ai_klao_be`) เท่านั้น — ถ้า stale alert หรือ break ไม่
หมดอายุอัตโนมัติ ให้ไปดู runbook ของ service นั้นแทน.

---

## Incident 6 — Memory Leak / CPU สูง

**ตรวจสอบ:**

```bash
# ดู memory และ CPU
pm2 monit

# ดู top processes
top -p $(pm2 pid aiklao_mb)
```

**วิธีแก้:**

```bash
# Restart ฉุกเฉิน (zero-downtime)
pm2 reload aiklao_mb

# ถ้า reload ไม่ได้
pm2 restart aiklao_mb --update-env
```

PM2 จะ auto-restart เมื่อ memory เกิน 512MB อยู่แล้ว ถ้า restart บ่อยผิดปกติ
ให้ดู log ว่ามี error อะไรก่อน restart

---

## Incident 7 — Deploy ล้มเหลว

**อาการ:** push to main แล้ว GitHub Actions fail

**ตรวจสอบ:**

1. ไปที่ GitHub → Actions → ดู workflow run ที่ fail
2. ดู error message ใน step ที่ fail

**สาเหตุที่พบบ่อย:**

| สาเหตุ | วิธีแก้ |
|---|---|
| SSH secret ผิด/หมดอายุ | อัป GitHub Secrets: VPS_HOST, VPS_USER, VPS_PORT, VPS_SSH_KEY |
| VPS disk เต็ม | `df -h` บน VPS, ล้าง old logs หรือ node_modules เก่า |
| npm install fail | ดู error ใน GitHub Actions log |
| PM2 reload fail | SSH เข้า VPS แล้วรัน deploy.sh ด้วยตัวเอง |

**Manual deploy (กรณีฉุกเฉิน):**

```bash
ssh user@your-vps-ip
/var/www/aiklao_mb/deploy.sh
```

---

## Rollback

```bash
cd /var/www/aiklao_mb/demo_app_ai_klao_mb

# ดู commit ล่าสุด
git log --oneline -5

# rollback ไป commit ก่อนหน้า
git checkout <commit-hash>
npm install --production
pm2 reload aiklao_mb --update-env

# ตรวจสอบ
curl https://your-domain.com/healthz
```

---

## Useful Queries

```bash
# สมาชิกที่ active ในช่วง 1 ชั่วโมงที่ผ่านมา
psql "$DATABASE_URL" -c "
  SELECT m.display_name, max(l.created_at) as last_seen
  FROM members m
  JOIN locations l ON l.member_id = m.id
  WHERE l.created_at > now() - interval '1 hour'
  GROUP BY m.display_name
  ORDER BY last_seen DESC;"

# Share token ที่ active อยู่
psql "$DATABASE_URL" -c "
  SELECT label, privacy_mode, view_count, created_at, expires_at
  FROM share_tokens
  WHERE revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY created_at DESC;"

# Push quota เดือนนี้ (ตารางนี้ shared กับ Java backend — aiklao_mb เองไม่เขียน/เช็ค quota นี้)
psql "$DATABASE_URL" -c "
  SELECT ym, count, 200 - count as remaining
  FROM quota_counter
  WHERE ym = to_char(now(), 'YYYY-MM');"
```

---

## Contacts

| บทบาท | ติดต่อ |
|---|---|
| Backend Developer | Jod — LINE: @jod |
| LINE Developer Console | https://developers.line.biz |
| VPS Provider | ดูใน team password manager |

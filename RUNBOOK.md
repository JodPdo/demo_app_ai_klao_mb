# RUNBOOK.md — AiKlao Bot

คู่มือ troubleshooting สำหรับ on-call / devops
เมื่อระบบมีปัญหาให้ดูที่นี่ก่อน

---

## Quick Reference

```bash
# Health check
curl https://your-domain.com/healthz

# PM2 status
pm2 status

# Tail logs
pm2 logs aiklao_be

# Restart (กรณีฉุกเฉิน)
pm2 restart aiklao_be --update-env
```

---

## Incident 1 — Service Down / 502 Bad Gateway

**อาการ:** LIFF ไม่โหลด, LINE webhook ตอบไม่ได้, Nginx แสดง 502

**ตรวจสอบ:**

```bash
# ดู PM2 status
pm2 status
# ถ้า status = errored หรือ stopped → restart

pm2 restart aiklao_be --update-env
pm2 logs aiklao_be --lines 50
```

**สาเหตุที่พบบ่อย:**

| สาเหตุ | วิธีแก้ |
|---|---|
| Memory เกิน 512MB (PM2 auto-restart loop) | `pm2 logs` ดูว่า leak ที่ไหน, restart ก่อน |
| PORT conflict | `lsof -i :3001` ดูว่ามี process อื่นใช้ port นี้ไหม |
| Crash ตอน startup (env ผิด) | ตรวจ `.env` ว่าครบและถูกต้อง |
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
pm2 restart aiklao_be --update-env
```

---

## Incident 3 — LINE Webhook ไม่รับ Events

**อาการ:** bot ไม่ตอบใน LINE, log ไม่มี webhook request เข้ามาเลย

**ตรวจสอบ:**

```bash
# ทดสอบ webhook endpoint ตรงๆ
curl -X POST https://your-domain.com/webhook \
  -H "Content-Type: application/json" \
  -H "X-Line-Signature: test" \
  -d '{"events":[],"destination":"Uxxxx"}'
# ต้องได้ 200 เสมอ (LINE requires this)

# ดู Nginx log
tail -f /var/log/nginx/access.log | grep webhook
```

**สาเหตุที่พบบ่อย:**

| สาเหตุ | วิธีแก้ |
|---|---|
| SSL cert หมดอายุ | `certbot renew` |
| Webhook URL ผิดใน LINE Console | ตรวจสอบและแก้ใน LINE Developer Console |
| `CHANNEL_SECRET` ผิด | อัป `.env` และ `pm2 restart --update-env` |
| Server ไม่มี public IP | ตรวจ DNS หรือ firewall rule |

---

## Incident 4 — Push Notification ไม่ส่ง

**อาการ:** ไม่มี push notification เลย ทั้งที่เปิดอยู่

**ตรวจสอบ:**

```bash
# ดู push log ใน DB
psql "$DATABASE_URL" -c "
  SELECT status, count(*), max(pushed_at)
  FROM push_log
  WHERE pushed_at > now() - interval '24 hours'
  GROUP BY status
  ORDER BY count DESC;"
```

**ถ้า status = `skipped_stale`:**

```bash
# ตรวจโควตาเดือนนี้
psql "$DATABASE_URL" -c "
  SELECT ym, count
  FROM quota_counter
  WHERE ym = to_char(now(), 'YYYY-MM');"
```

โควตาหมด (≥ 200 ต่อเดือน) → รอเดือนหน้า หรือเพิ่ม `MONTHLY_PUSH_LIMIT` ใน `.env`

**ถ้า status = `failed`:**

```bash
# ดู error message
psql "$DATABASE_URL" -c "
  SELECT error_message, count(*)
  FROM push_log
  WHERE status = 'failed'
    AND pushed_at > now() - interval '24 hours'
  GROUP BY error_message;"
```

LINE API 429 → rate limit, รอสักครู่  
LINE API 401 → `CHANNEL_ACCESS_TOKEN` หมดอายุหรือผิด

---

## Incident 5 — Scheduler หยุดทำงาน

**อาการ:** stale alert ไม่ส่ง, break ไม่หมดอายุอัตโนมัติ

**ตรวจสอบ:**

```bash
# ดูว่า scheduler เริ่มทำงานไหม (ดูจาก log ตอน startup)
pm2 logs aiklao_be | grep -i "scheduler\|cron"

# ดู log ในช่วงที่ควรทำงาน (ทุก 5 นาที)
pm2 logs aiklao_be --lines 200 | grep "checkStale\|checkBreak\|pushTrip"
```

**วิธีแก้:**

```bash
# Restart เพื่อให้ scheduler เริ่มใหม่
pm2 restart aiklao_be --update-env

# ตรวจว่า SCHEDULER_TICK ถูกต้อง
grep SCHEDULER_TICK .env
# ค่าเริ่มต้น: */5 * * * *
```

---

## Incident 6 — Memory Leak / CPU สูง

**ตรวจสอบ:**

```bash
# ดู memory และ CPU
pm2 monit

# ดู top processes
top -p $(pm2 pid aiklao_be)
```

**วิธีแก้:**

```bash
# Restart ฉุกเฉิน (zero-downtime)
pm2 reload aiklao_be

# ถ้า reload ไม่ได้
pm2 restart aiklao_be --update-env
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
/var/www/aiklao_be/deploy.sh
```

---

## Rollback

```bash
cd /var/www/aiklao_be/demo_app_ai_klao_be

# ดู commit ล่าสุด
git log --oneline -5

# rollback ไป commit ก่อนหน้า
git checkout <commit-hash>
npm install --production
pm2 reload aiklao_be --update-env

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

# Push quota เดือนนี้
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

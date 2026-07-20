# DEPLOYMENT.md — AiKlao Mobile Backend (aiklao_mb)

คู่มือ deploy สำหรับ Production บน VPS + PM2 + GitHub Actions

> This covers only the Node mobile-API service (`aiklao_mb`, port 3002). The
> sibling Java Spring Boot service (`demo_app_ai_klao_be`, PM2 process
> `aiklao_be`, port 3000 — LINE webhook, safety/scheduler, SOS admin) shares
> the same Postgres DB but is deployed separately; it is not covered here.

---

## Overview

```
Developer pushes to main
        ↓
GitHub Actions (.github/workflows/deploy.yml)
        ↓
SSH into VPS → run /var/www/aiklao_mb/deploy.sh
        ↓
PM2 reload aiklao_mb (zero-downtime)
```

---

## Prerequisites (VPS)

- Ubuntu 22.04 LTS
- Node.js 20 LTS (`nvm install 20`)
- PostgreSQL 15
- PM2 (`npm install -g pm2`)
- Nginx (reverse proxy + SSL)

---

## First-Time VPS Setup

### 1. Clone Repository

```bash
mkdir -p /var/www/aiklao_mb
cd /var/www/aiklao_mb
git clone git@github.com:JodPdo/demo_app_ai_klao_mb.git demo_app_ai_klao_mb
cd demo_app_ai_klao_mb
npm install --production
```

### 2. Create PostgreSQL Database

```bash
sudo -u postgres psql
CREATE DATABASE aiklao_db;
CREATE USER aiklao_user WITH PASSWORD 'your-strong-password';
GRANT ALL PRIVILEGES ON DATABASE aiklao_db TO aiklao_user;
\q
```

### 3. Environment Variables

```bash
cp .env.example .env   # ถ้ามี
nano .env
```

ใส่ค่าทั้งหมด (รายการเต็มดู `CLAUDE.md` → Environment Variables; ตัวแปรที่จำเป็นต่อ auth/push):

```env
DATABASE_URL=postgresql://aiklao_user:your-strong-password@localhost:5432/aiklao_db
MOBILE_JWT_SECRET=...
MOBILE_LINE_CHANNEL_ID=...
CHANNEL_ACCESS_TOKEN=...
INTERNAL_SECRET=...
LINE_LOGIN_CHANNEL_ID=...
LIFF_ID=...
PORT=3002
NODE_ENV=production
PG_SSL=false
ALLOWED_ORIGINS=https://mb.aiklaotrip.com
```

> **สำคัญ:** ไม่ commit `.env` เข้า git เด็ดขาด — มีใน .gitignore แล้ว. ถ้าลืมตั้ง
> `MOBILE_JWT_SECRET` หรือ `MOBILE_LINE_CHANNEL_ID` server จะยังบูตขึ้นได้ปกติ แต่ทุก
> mobile-auth request จะ 500 (`server_misconfigured`) — เช็ค `pm2 logs aiklao_mb`
> หลัง deploy ทุกครั้งว่าไม่มี warning `MOBILE_JWT_SECRET not set`.

### 4. Start with PM2

```bash
pm2 start ecosystem.config.js
pm2 save                      # บันทึก process list
pm2 startup                   # auto-start เมื่อ VPS reboot
```

ตรวจสอบ:

```bash
pm2 status
curl http://localhost:3002/healthz
# {"ok":true,"service":"aiklao_mb","version":"0.1.28"}
```

### 5. Nginx Reverse Proxy

สร้างไฟล์ `/etc/nginx/sites-available/aiklao_mb`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/aiklao_mb /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### 6. SSL (Let's Encrypt)

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

Certbot จะ auto-renew ทุก 90 วัน

### 7. Create Deploy Script

สร้างไฟล์ `/var/www/aiklao_mb/deploy.sh` (path นี้ตรงกับที่ `.github/workflows/deploy.yml`
เรียกจริง):

```bash
#!/bin/bash
set -e

APP_DIR="/var/www/aiklao_mb/demo_app_ai_klao_mb"

echo "=== AiKlao MB Deploy $(date) ==="
cd "$APP_DIR"

git pull origin main
npm install --production
pm2 reload aiklao_mb --update-env

echo "=== Deploy complete ==="
pm2 status aiklao_mb
```

```bash
chmod +x /var/www/aiklao_mb/deploy.sh
```

---

## GitHub Actions Setup

### Secrets ที่ต้องตั้งใน GitHub Repository

ไปที่ Settings → Secrets and variables → Actions → New repository secret:

| Secret | ค่า | ตัวอย่าง |
|---|---|---|
| `VPS_HOST` | IP หรือ domain | `123.456.789.0` |
| `VPS_USER` | SSH username | `root` |
| `VPS_PORT` | SSH port | `22` |
| `VPS_SSH_KEY` | Private SSH key | `-----BEGIN OPENSSH PRIVATE KEY-----...` |

### สร้าง SSH Key (ถ้ายังไม่มี)

```bash
# บน local machine
ssh-keygen -t ed25519 -C "github-actions-aiklao" -f ~/.ssh/aiklao_deploy

# copy public key ไปใส่ VPS
ssh-copy-id -i ~/.ssh/aiklao_deploy.pub user@your-vps-ip

# copy private key ใส่ GitHub Secret VPS_SSH_KEY
cat ~/.ssh/aiklao_deploy
```

---

## Routine Operations

### Deploy ใหม่

```bash
# Auto: push to main branch
git push origin main

# Manual (บน VPS):
/var/www/aiklao_mb/deploy.sh
```

### PM2 Commands

```bash
pm2 status                          # ดู process ทั้งหมด
pm2 logs aiklao_mb                  # ดู logs แบบ tail
pm2 logs aiklao_mb --lines 100      # ดู 100 บรรทัดล่าสุด
pm2 reload aiklao_mb                # reload (zero-downtime)
pm2 restart aiklao_mb --update-env  # restart + อัป env vars
pm2 stop aiklao_mb                  # หยุด
pm2 delete aiklao_mb                # ลบออกจาก PM2
```

### Log Files

```
/root/.pm2/logs/aiklao-mb-out.log    # stdout
/root/.pm2/logs/aiklao-mb-error.log  # stderr
```

```bash
# ดู error ล่าสุด
tail -f /root/.pm2/logs/aiklao-mb-error.log

# ดู logs ของวันนี้
grep "$(date +%Y-%m-%d)" /root/.pm2/logs/aiklao-mb-out.log
```

---

## Rollback

ถ้า deploy แล้วมีปัญหา:

```bash
cd /var/www/aiklao_mb/demo_app_ai_klao_mb

# ดู commit history
git log --oneline -10

# rollback ไป commit ก่อนหน้า
git checkout <previous-commit-hash>
npm install --production
pm2 reload aiklao_mb --update-env
```

---

## Environment Variables Update

ถ้าต้องเปลี่ยน env var บน production:

```bash
nano /var/www/aiklao_mb/demo_app_ai_klao_mb/.env
# แก้ไขค่าที่ต้องการ

pm2 restart aiklao_mb --update-env
```

---

## Database Maintenance

```bash
# Backup
pg_dump aiklao_db > backup_$(date +%Y%m%d).sql

# Restore
psql aiklao_db < backup_20260513.sql

# ดู active connections
psql -U aiklao_user -d aiklao_db -c "SELECT count(*) FROM pg_stat_activity;"

# ดู slow queries
psql -U aiklao_user -d aiklao_db -c "
  SELECT query, mean_exec_time, calls
  FROM pg_stat_statements
  ORDER BY mean_exec_time DESC
  LIMIT 10;"
```

---

## Health Check Monitoring

```bash
# Quick check
curl https://your-domain.com/healthz

# Cron-based uptime monitor (ใส่ใน crontab)
*/5 * * * * curl -sf https://your-domain.com/healthz || \
  echo "AiKlao DOWN $(date)" | mail -s "AiKlao Alert" your@email.com
```

---

## LINE Webhook Config

**⚠️ Not applicable to `aiklao_mb`.** This service has no `/webhook` route — there is
no LINE webhook handler in this repo (`routes/` only exposes `/api/mobile/*`,
`/api/liff/*`, `/api/public/*`, and `/api/internal/line-notify`). The LINE webhook
is configured against the Java backend (`demo_app_ai_klao_be`, port 3000) — see
that service's own deployment doc for its webhook URL / signature verification.

After deploying `aiklao_mb`, the equivalent smoke test is the health check and a
login round-trip:

```bash
curl https://your-domain.com/healthz
# {"ok":true,"service":"aiklao_mb","version":"0.1.28"}

# POST /api/mobile/auth with a real LINE id_token should return a JWT;
# with a missing/invalid one it should 400/401, never 500 ("server_misconfigured"
# means MOBILE_JWT_SECRET or MOBILE_LINE_CHANNEL_ID is missing from env).
```

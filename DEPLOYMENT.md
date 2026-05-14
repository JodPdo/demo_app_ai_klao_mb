# DEPLOYMENT.md — AiKlao Bot

คู่มือ deploy สำหรับ Production บน VPS + PM2 + GitHub Actions

---

## Overview

```
Developer pushes to main
        ↓
GitHub Actions (.github/workflows/deploy.yml)
        ↓
SSH into VPS → run /var/www/aiklao_be/deploy.sh
        ↓
PM2 reload aiklao_be (zero-downtime)
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
mkdir -p /var/www/aiklao_be
cd /var/www/aiklao_be
git clone https://github.com/torpeerapolthi/demo_app_ai_klao_be.git demo_app_ai_klao_be
cd demo_app_ai_klao_be
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

ใส่ค่าทั้งหมด (ดูรายการใน README.md):

```env
DATABASE_URL=postgresql://aiklao_user:your-strong-password@localhost:5432/aiklao_db
CHANNEL_SECRET=...
CHANNEL_ACCESS_TOKEN=...
LINE_LOGIN_CHANNEL_ID=...
LIFF_ID=...
PORT=3001
NODE_ENV=production
PG_SSL=false
MONTHLY_PUSH_LIMIT=200
```

> **สำคัญ:** ไม่ commit `.env` เข้า git เด็ดขาด — มีใน .gitignore แล้ว

### 4. Start with PM2

```bash
pm2 start ecosystem.config.js
pm2 save                      # บันทึก process list
pm2 startup                   # auto-start เมื่อ VPS reboot
```

ตรวจสอบ:

```bash
pm2 status
curl http://localhost:3001/healthz
# {"ok":true}
```

### 5. Nginx Reverse Proxy

สร้างไฟล์ `/etc/nginx/sites-available/aiklao_be`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3001;
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
ln -s /etc/nginx/sites-available/aiklao_be /etc/nginx/sites-enabled/
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

สร้างไฟล์ `/var/www/aiklao_be/deploy.sh`:

```bash
#!/bin/bash
set -e

APP_DIR="/var/www/aiklao_be/demo_app_ai_klao_be"

echo "=== AiKlao Deploy $(date) ==="
cd "$APP_DIR"

git pull origin main
npm install --production
pm2 reload aiklao_be --update-env

echo "=== Deploy complete ==="
pm2 status aiklao_be
```

```bash
chmod +x /var/www/aiklao_be/deploy.sh
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
/var/www/aiklao_be/deploy.sh
```

### PM2 Commands

```bash
pm2 status                          # ดู process ทั้งหมด
pm2 logs aiklao_be                  # ดู logs แบบ tail
pm2 logs aiklao_be --lines 100      # ดู 100 บรรทัดล่าสุด
pm2 reload aiklao_be                # reload (zero-downtime)
pm2 restart aiklao_be --update-env  # restart + อัป env vars
pm2 stop aiklao_be                  # หยุด
pm2 delete aiklao_be                # ลบออกจาก PM2
```

### Log Files

```
/root/.pm2/logs/aiklao-be-out.log    # stdout
/root/.pm2/logs/aiklao-be-error.log  # stderr
```

```bash
# ดู error ล่าสุด
tail -f /root/.pm2/logs/aiklao-be-error.log

# ดู logs ของวันนี้
grep "$(date +%Y-%m-%d)" /root/.pm2/logs/aiklao-be-out.log
```

---

## Rollback

ถ้า deploy แล้วมีปัญหา:

```bash
cd /var/www/aiklao_be/demo_app_ai_klao_be

# ดู commit history
git log --oneline -10

# rollback ไป commit ก่อนหน้า
git checkout <previous-commit-hash>
npm install --production
pm2 reload aiklao_be --update-env
```

---

## Environment Variables Update

ถ้าต้องเปลี่ยน env var บน production:

```bash
nano /var/www/aiklao_be/demo_app_ai_klao_be/.env
# แก้ไขค่าที่ต้องการ

pm2 restart aiklao_be --update-env
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

หลัง deploy ให้ตรวจสอบว่า webhook URL ถูกตั้งใน LINE Developer Console:

```
https://your-domain.com/webhook
```

ทดสอบ:

```bash
# ตรวจ signature verification
curl -X POST https://your-domain.com/webhook \
  -H "Content-Type: application/json" \
  -H "X-Line-Signature: invalid" \
  -d '{"events":[]}'
# ควรได้ 200 (LINE requires 200 always)
```

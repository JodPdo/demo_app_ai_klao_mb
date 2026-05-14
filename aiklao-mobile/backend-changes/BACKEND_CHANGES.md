# Backend Changes — Phase 5.1

เพิ่ม mobile authentication endpoint ใน backend ปัจจุบัน (aiklao-bot-be)

---

## 📁 Files

| File | Purpose |
|------|---------|
| `migrations/009_users_mobile.sql` | สร้าง `users` table |
| `routes/mobileAuth.js` | `POST /api/mobile/auth` endpoint |
| `middleware/jwtAuth.js` | JWT verification for protected mobile routes |

---

## 1. Install Dependencies

```bash
cd ~/Desktop/aiklao-bot-be
npm install jsonwebtoken
```

ไม่ต้องลง LINE SDK เพิ่ม — เราใช้ LINE's HTTP verify endpoint ผ่าน fetch (built-in Node 22)

---

## 2. Run Migration

```bash
# Local dev
psql $DATABASE_URL -f migrations/009_users_mobile.sql

# Production (via SSH)
ssh root@162.141.142.154
cd /var/www/aiklao_be/demo_app_ai_klao_be
psql $DATABASE_URL -f migrations/009_users_mobile.sql
```

---

## 3. Environment Variables

เพิ่มใน `.env` ทั้ง local + production:

```bash
# LINE Login channel (สร้างใหม่ที่ LINE Developers Console)
LINE_LOGIN_CHANNEL_ID=1234567890

# JWT secret — random 64+ chars
MOBILE_JWT_SECRET=$(openssl rand -hex 32)
```

⚠️ **สำคัญ:** `LINE_LOGIN_CHANNEL_ID` คนละตัวกับ `LINE_CHANNEL_ID` ที่ใช้ใน Messaging API
ต้องสร้าง **LINE Login channel** แยกที่ LINE Developers Console

---

## 4. Wire ใน server.js

```js
// server.js — เพิ่มหลังจากที่ wire other routes
const mobileAuth = require("./routes/mobileAuth");
const jwtAuth = require("./middleware/jwtAuth");

// Public — login endpoint
app.use("/api/mobile/auth", mobileAuth);

// Protected — all other mobile endpoints (Phase 5.2+)
// app.use("/api/mobile", jwtAuth, mobileRoutes);
```

---

## 5. LINE Developers Console Setup

1. ไป https://developers.line.biz/console/
2. เลือก Provider ของคุณ (ที่มี Messaging API channel เดิม)
3. คลิก **Create Channel** → เลือก **LINE Login**
4. กรอกข้อมูล:
   - Channel name: `AiKlao Mobile`
   - App types: ✅ Native app (Android + iOS)
5. หลังสร้างเสร็จ:
   - ไปแท็บ **LINE Login** → เพิ่ม Callback URL:
     ```
     aiklao://auth/callback
     exp://127.0.0.1:8081/--/auth/callback   (สำหรับ dev บน Expo Go)
     ```
   - เปิด `OpenID Connect` ✅
6. Copy **Channel ID** ไปใส่:
   - Backend `.env` → `LINE_LOGIN_CHANNEL_ID`
   - Mobile `app.json` → `extra.lineChannelId`

---

## 6. Test

### Test backend ตรง (ไม่ผ่าน app)

```bash
# Get a real id_token ก่อน (จากการ login จริงใน app หรือ Postman OAuth flow)
# แล้ว:
curl -X POST https://api.aiklaotrip.com/api/mobile/auth \
  -H "Content-Type: application/json" \
  -d '{"idToken":"<paste-id-token-here>"}'

# Expected response:
# {
#   "token": "eyJ...",
#   "expiresIn": 2592000,
#   "user": {
#     "id": "1",
#     "lineUserId": "U1234...",
#     "displayName": "Name",
#     "pictureUrl": "https://..."
#   }
# }
```

### Test JWT middleware

```bash
# Without token → 401
curl https://api.aiklaotrip.com/api/mobile/me

# With token → 200
curl -H "Authorization: Bearer <jwt-from-login>" \
  https://api.aiklaotrip.com/api/mobile/me
```

---

## 7. Add Unit Tests (Optional)

```js
// tests/routes/mobileAuth.test.js
const request = require("supertest");
const app = require("../../server");

describe("POST /api/mobile/auth", () => {
  it("rejects missing id_token", async () => {
    const res = await request(app).post("/api/mobile/auth").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_id_token");
  });

  it("rejects invalid id_token", async () => {
    const res = await request(app)
      .post("/api/mobile/auth")
      .send({ idToken: "invalid.jwt.here" });
    expect(res.status).toBe(401);
  });
});
```

---

## 🔒 Security Notes

- ✅ id_token signature verified โดย LINE's verify endpoint
- ✅ `aud` claim ตรวจกับ channel ID
- ✅ JWT มี `iss` + `aud` claims (เพิ่ม attack surface)
- ✅ JWT ttl 30 วัน — refresh token จะทำใน Phase 5.x ถัดไป
- ⚠️ MOBILE_JWT_SECRET ต้องเก็บใน env เท่านั้น ห้าม commit
- ⚠️ Rate limit `/api/mobile/auth` (ใช้ existing express-rate-limit)

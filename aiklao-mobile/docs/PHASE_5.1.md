# Phase 5.1 — LINE Login Authentication

**Goal:** Login ด้วย LINE → backend ออก JWT → app store token → auto-login on restart

---

## 🎯 Deliverables

| Item | Status |
|------|--------|
| LINE OAuth 2.0 flow (expo-auth-session) | ✅ |
| Token exchange — id_token → backend JWT | ✅ |
| SecureStore wrapper (JWT, refresh, user) | ✅ |
| AuthContext + useAuth hook | ✅ |
| Auto-login on app start | ✅ |
| Logout flow | ✅ |
| 401 → auto-logout interceptor | ✅ |
| Backend `POST /api/mobile/auth` endpoint | ✅ |
| Backend `jwtAuth` middleware | ✅ |
| `users` table migration | ✅ |

---

## 🔐 Auth Flow Diagram

```
┌──────────┐                                                  ┌──────────┐
│  Mobile  │                                                  │  Backend │
└────┬─────┘                                                  └────┬─────┘
     │                                                             │
     │  1. กดปุ่ม "เข้าสู่ระบบด้วย LINE"                              │
     │                                                             │
     │     ┌──────────────────────────────┐                        │
     │ ──> │  LINE OAuth (web browser)    │                        │
     │     │  • PKCE + state + nonce      │                        │
     │     │  • User login                │                        │
     │     │  • Redirect aiklao://auth/.. │                        │
     │     └──────────────────────────────┘                        │
     │                                                             │
     │  2. POST LINE token endpoint                                │
     │     → ได้ id_token (signed by LINE)                          │
     │                                                             │
     │  3. POST /api/mobile/auth { idToken }    ──────────────────>│
     │                                                             │
     │                                                ┌────────────│
     │                                                │ 4. Verify  │
     │                                                │  id_token  │
     │                                                │  ผ่าน LINE │
     │                                                │  /verify   │
     │                                                └─────>      │
     │                                                             │
     │                                                ┌────────────│
     │                                                │ 5. Upsert  │
     │                                                │  user      │
     │                                                │  in users  │
     │                                                │  table     │
     │                                                └─────>      │
     │                                                             │
     │                                                ┌────────────│
     │                                                │ 6. Sign    │
     │                                                │  JWT       │
     │                                                │  (30 day)  │
     │                                                └─────>      │
     │                                                             │
     │  7. { token, user }                       <─────────────────│
     │                                                             │
     │  8. SecureStore.set(jwt, user)                              │
     │                                                             │
     │  9. setStatus('authenticated') → Navigate → Home            │
     │                                                             │
```

---

## 🛠️ Setup Steps

### 1. LINE Developers Console

ที่ https://developers.line.biz/console/

**สร้าง LINE Login Channel แยกจาก Messaging API:**

1. Provider เดิม → **Create Channel** → **LINE Login**
2. กรอก:
   - Channel name: `AiKlao Mobile`
   - Region: Thailand
   - App types: ✅ Native app
3. หลังสร้าง → ไปแท็บ **LINE Login**:
   - **Callback URL** (กดเพิ่มทั้งหมด):
     ```
     aiklao://auth/callback
     exp://127.0.0.1:8081/--/auth/callback
     exp://192.168.x.x:8081/--/auth/callback   (IP ของเครื่อง dev)
     ```
   - **OpenID Connect:** ✅ Enable
   - **Email permission:** ❌ (ไม่ต้อง)
4. Copy:
   - **Channel ID** (10 digits)
   - **Channel secret** (สำหรับ backend ในอนาคต — ตอนนี้ใช้แค่ verify ผ่าน HTTP)

### 2. Backend

ดู [`backend-changes/BACKEND_CHANGES.md`](../backend-changes/BACKEND_CHANGES.md) — ทำตามทุก step

ที่สำคัญ: ต้องมี env vars เหล่านี้บน production:
```bash
LINE_LOGIN_CHANNEL_ID=1234567890
MOBILE_JWT_SECRET=<random-64-hex>
```

### 3. Mobile

```bash
cd aiklao-mobile
```

**แก้ `app.json`:**
```json
{
  "expo": {
    "extra": {
      "apiBaseUrl": "https://api.aiklaotrip.com",
      "lineChannelId": "1234567890"
    }
  }
}
```

---

## 🧪 Manual Test Plan

### Happy path
1. `npm start`
2. แสกน QR ด้วย Expo Go (มือถือจริง)
3. เห็นหน้า Login → กดปุ่ม
4. เปิด in-app browser → login ด้วย LINE
5. กลับมา app อัตโนมัติ
6. เห็น Home + ชื่อ user
7. Ctrl+R reload app
8. **ไม่ต้อง login อีก** — เข้า Home ทันที (auto-login จาก SecureStore)

### Logout
1. ไปแท็บ Settings → กด "ออกจากระบบ" → confirm
2. กลับหน้า Login
3. ปิด-เปิดแอป → ยังต้อง login

### Token expiry / invalid token
1. ใน Settings dev tools → ลบ JWT จาก SecureStore (หรือรอ 30 วัน)
2. ส่ง request → backend ตอบ 401
3. `unauthorizedHandler` ทำงาน → auto-logout → กลับหน้า Login

### Error cases
- กดปุ่ม login แล้วยกเลิก browser → ต้องไม่ crash, แค่กลับหน้า Login เฉย ๆ
- เน็ตไม่มี → Alert message ขึ้น
- Backend down → Alert message ขึ้น

---

## 🐛 Known Gotchas

### 1. LINE Login state mismatch
ถ้า user เปิด login ทิ้งไว้นานแล้วกลับมา → state ไม่ match → throw error
**Fix:** Catch error → reset state → ให้ user กดใหม่

### 2. Expo Go vs Standalone build
- Expo Go ใช้ redirect URL `exp://...` (LINE Console ต้องเพิ่มไว้)
- Standalone build ใช้ `aiklao://` scheme (จาก app.json)
- Build dev client (`eas build --profile development`) → ใช้ `aiklao://` ได้

### 3. id_token verify ที่ backend
LINE's `/verify` endpoint จะตรวจให้ทั้ง signature + exp + aud
ไม่ต้องทำ JWKS เอง (เร็วและง่ายกว่า)

### 4. iOS Universal Links (ต่อ)
ใน Phase 5.1 ยังไม่ใช้ universal links — ใช้ custom scheme พอ
ถ้าต้องการ "เปิด app จาก link ใน LINE chat" จะต้องตั้ง universal links + apple-app-site-association ที่ backend (ทำใน Phase 5.4+ )

---

## 🔒 Security Checklist

- ✅ PKCE code_verifier ป้องกัน auth code interception
- ✅ `state` ป้องกัน CSRF
- ✅ `nonce` ป้องกัน replay attack
- ✅ id_token verified server-side (ไม่ trust client-decoded)
- ✅ JWT secret 64-char hex (`openssl rand -hex 32`)
- ✅ JWT มี `iss`, `aud`, `exp` claims
- ✅ Refresh token เก็บใน SecureStore (Keychain/Encrypted Prefs)
- ⚠️ Rate limit `/api/mobile/auth` (ทำเพิ่มถ้ายังไม่มี)

---

## 📊 What's Next — Phase 5.2

**Foreground Location + Map** (1-2 สัปดาห์)
- `expo-location` permission flow
- Map view (`react-native-maps`)
- "Start Trip" button → start `watchPosition` → POST locations to backend
- Trip detail screen with live marker

ตอน Phase 5.2 จะใช้ JWT ที่ออกใน 5.1 นี้สำหรับเรียก `/api/mobile/trips/*`

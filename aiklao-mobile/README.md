# AiKlao Mobile

React Native + Expo mobile app for AiKlao trip tracking.

**Status:** Phase 5.1 — Authentication ✅

---

## 🚀 Quick Start

```bash
# Install deps
npm install

# Start Expo dev server
npm start

# จากนั้น:
# - กด 'a' เพื่อเปิดบน Android emulator
# - กด 'i' เพื่อเปิดบน iOS simulator
# - แสกน QR code ด้วย Expo Go app (มือถือจริง)
```

---

## 📁 Project Structure

```
aiklao-mobile/
├── App.tsx                       # Entry point
├── app.json                      # Expo config
├── eas.json                      # EAS Build config
├── package.json
├── tsconfig.json
├── babel.config.js
│
├── src/
│   ├── api/
│   │   └── client.ts             # axios + JWT interceptor
│   ├── auth/
│   │   ├── AuthContext.tsx       # React Context for auth state
│   │   ├── lineLogin.ts          # LINE OAuth 2.0 flow
│   │   └── tokenStorage.ts       # SecureStore wrapper
│   ├── components/
│   │   ├── Button.tsx
│   │   └── Screen.tsx
│   ├── navigation/
│   │   ├── RootNavigator.tsx     # Auth gate
│   │   ├── AuthNavigator.tsx     # Login stack
│   │   └── AppNavigator.tsx      # Tabs (Home/Trips/Settings)
│   ├── screens/
│   │   ├── auth/LoginScreen.tsx
│   │   ├── home/HomeScreen.tsx
│   │   ├── trips/TripsScreen.tsx
│   │   └── settings/SettingsScreen.tsx
│   └── theme/
│       ├── colors.ts
│       ├── typography.ts
│       ├── spacing.ts
│       └── index.ts
│
├── backend-changes/              # Code ที่ต้องเพิ่มใน aiklao-bot-be
│   ├── migrations/009_users_mobile.sql
│   ├── routes/mobileAuth.js
│   ├── middleware/jwtAuth.js
│   └── BACKEND_CHANGES.md
│
└── docs/
    ├── PHASE_5.0.md              # Setup + UI shell
    └── PHASE_5.1.md              # LINE Login auth
```

---

## 🔧 Setup Checklist

### 1. Backend (aiklao-bot-be)
- [ ] Run migration `009_users_mobile.sql`
- [ ] Copy `routes/mobileAuth.js` + `middleware/jwtAuth.js`
- [ ] Set env: `LINE_LOGIN_CHANNEL_ID`, `MOBILE_JWT_SECRET`
- [ ] Wire route ใน `server.js`: `app.use("/api/mobile/auth", mobileAuth);`
- [ ] Deploy (`task patch-release` → `task push-release`)

### 2. LINE Developers Console
- [ ] Create **LINE Login channel** (คนละตัวกับ Messaging API)
- [ ] Enable OpenID Connect
- [ ] Add Callback URLs: `aiklao://auth/callback` + dev URL
- [ ] Copy Channel ID

### 3. Mobile app
- [ ] `npm install`
- [ ] Edit `app.json` → set `extra.lineChannelId`
- [ ] Edit `app.json` → set `extra.apiBaseUrl` (ถ้าไม่ใช่ production)
- [ ] `npm start`

### 4. EAS (สำหรับ build production)
- [ ] `npx eas-cli login`
- [ ] `npx eas-cli init` → จะ generate projectId อัตโนมัติ
- [ ] Update `app.json` → `extra.eas.projectId`

---

## 📱 Test Flow (Phase 5.1)

1. เปิดแอป → เห็นหน้า Login
2. กด "เข้าสู่ระบบด้วย LINE" → เปิด browser ไป LINE
3. Login ด้วย LINE account
4. Browser redirect กลับ app → exchange code → backend JWT → store
5. เห็นหน้า Home + ชื่อ user
6. ไปแท็บ Settings → กด "ออกจากระบบ" → กลับหน้า Login
7. ปิด-เปิดแอป → ถ้ายัง login → เข้า Home ทันที (auto-login)

---

## 🛠️ Build for Distribution

```bash
# Preview build (internal testing, install ผ่าน QR)
npx eas-cli build --profile preview --platform android
npx eas-cli build --profile preview --platform ios

# Production build (ส่ง store)
npx eas-cli build --profile production --platform all
```

---

## 📚 Docs

- [Phase 5.0 — Setup + UI Shell](./docs/PHASE_5.0.md)
- [Phase 5.1 — LINE Login Authentication](./docs/PHASE_5.1.md)
- [Backend Changes](./backend-changes/BACKEND_CHANGES.md)

---

## 🚦 Next Phase

**Phase 5.2 — Foreground Location + Map** (สัปดาห์ 3-4)
- expo-location integration
- Map view (react-native-maps)
- Start/Stop trip button
- Wire กับ backend trips endpoint

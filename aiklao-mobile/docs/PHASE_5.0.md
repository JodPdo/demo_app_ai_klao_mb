# Phase 5.0 — Foundation + UI Shell

**Goal:** เปิดแอปได้ มี navigation มี theme — ยังไม่มี auth จริง

---

## 🎯 Deliverables

| Item | Status | Notes |
|------|--------|-------|
| Expo project (TypeScript) | ✅ | Expo SDK 51 + RN 0.74 |
| React Navigation | ✅ | Tabs + Stack |
| Theme system | ✅ | colors / typography / spacing |
| Base components | ✅ | `Screen`, `Button` |
| 4 placeholder screens | ✅ | Login, Home, Trips, Settings |
| Splash screen config | ✅ | กำหนดใน app.json |
| App icon placeholder | ⬜ | ต้องสร้างไฟล์จริงใน `assets/` |

---

## 📦 Tech Stack Decisions

| Choice | Rationale |
|--------|-----------|
| **Expo Managed Workflow** | เร็วในการ MVP, EAS Build cloud, ไม่ต้องแตะ native code |
| **TypeScript** | safety + auto-complete; project ใหญ่ขึ้นจะคุ้ม |
| **React Navigation (not Expo Router)** | mature, doc เยอะ, type-safe params |
| **Bottom tabs + native stack** | UX มาตรฐาน iOS/Android |
| **expo-secure-store (not AsyncStorage)** | JWT เก็บใน Keychain/Encrypted Prefs |

---

## 🎨 Design System

### Colors
- **Primary:** `#0E7C66` (forest green) — สื่อถึงการเดินทาง + ธรรมชาติ
- **Semantic:** success, warning, danger, info
- **Neutrals:** 11-step gray scale

### Typography (8pt grid)
- h1: 32 / h2: 24 / h3: 20
- bodyLarge: 17 / body: 15 / bodySmall: 13
- caption: 12 / button: 15

### Spacing (4pt grid)
- xs: 4 / sm: 8 / md: 12 / lg: 16 / xl: 24 / 2xl: 32 / 3xl: 48 / 4xl: 64

---

## 📐 Navigation Architecture

```
RootNavigator (decides based on auth status)
├── if 'loading'         → ActivityIndicator
├── if 'unauthenticated' → AuthNavigator
│                           └── LoginScreen
└── if 'authenticated'   → AppNavigator (Tabs)
                            ├── HomeScreen
                            ├── TripsScreen
                            └── SettingsScreen
```

**Key insight:** Root นี้คือ "auth gate" — แตก stack 2 ฝั่งไม่ต้องเช็คในทุกหน้า

---

## ✅ Verification

### Local dev
```bash
cd aiklao-mobile
npm install
npm start
```

**ต้อง:**
1. ✅ Expo CLI start ได้ ไม่มี error
2. ✅ เปิดบน Expo Go (มือถือจริง) → เห็นหน้า Login
3. ✅ Tab navigation: Home/Trips/Settings — สลับได้ทุกแท็บ
4. ✅ Theme colors แสดงถูกต้อง
5. ✅ `npm run typecheck` ผ่าน

### Known limitations
- ❌ ยังไม่มี app icon จริง (ใช้ default Expo icon)
- ❌ ยังไม่มี splash screen artwork
- ❌ "เริ่มทริปใหม่" button ยังไม่ทำอะไร (Phase 5.2)
- ❌ Trips list ยังว่าง (Phase 5.2)

---

## 🚧 Assets ที่ต้องเตรียม (สำหรับ release จริง)

วางไฟล์เหล่านี้ใน `assets/`:

| File | Size | Purpose |
|------|------|---------|
| `icon.png` | 1024x1024 | App icon |
| `splash.png` | 1284x2778 | Splash screen (iPhone Pro Max) |
| `adaptive-icon.png` | 1024x1024 | Android adaptive icon foreground |

แนะนำใช้ Figma + plugin "Mobile App Icon Generator" → export ครบทุกขนาด

---

## 🔄 Next: Phase 5.1

ต่อ Phase 5.1 — LINE Login Authentication

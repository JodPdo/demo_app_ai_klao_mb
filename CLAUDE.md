# AiKlao Bot — Claude Code Context

## Project Overview

LINE Bot + REST API for real-time group trip tracking built on Node.js 20 / Express 5 / PostgreSQL 15.
Members share GPS location inside LINE; the bot calculates distance remaining, ETA, break status, and safety alerts.

**Version:** 0.1.9 | **Language:** JavaScript (CommonJS) | **No TypeScript**

---

## Architecture

```
LINE Platform
  ├── POST /webhook          → handlers/webhook.js  (LINE events, command parser)
  └── LIFF Web App           → routes/api.js         (24 REST endpoints, Bearer auth)

App-level routes (bypass /api/* auth)
  ├── GET  /share/:token     → services/shareToken.js (public watch link, v4.0)
  └── GET  /watch/*          → static (LIFF watch page)

services/
  ├── safety.js              stale alert, SOS, break logic
  ├── groupBreak.js          group break management
  ├── eta.js                 ETA from 5-point location history, speed clamp 5–80 km/h
  ├── locationProcessor.js   unified location write + trigger all checks
  ├── scheduler.js           node-cron every 5 min — 4 tasks (checkStaleMembers, checkBreakExpiry,
  │                          clearExpiredGroupBreaks, pushTripUpdate)
  └── shareToken.js          UUID token via pgcrypto, privacy_mode: full | initial-only

lib/
  ├── db.js                  pg pool, query/one/many/tx helpers, idempotent migration runner
  ├── lineClient.js          @line/bot-sdk MessagingApiClient singleton
  └── logger.js              Pino — JSON in prod, pretty in dev

middleware/
  └── liffAuth.js            LIFF Bearer token verify + 5-min in-process Map cache
```

---

## Database — 8 Tables

```
trips ──< members ──< locations
  │           └──< safety_alerts
  ├── notification_settings (1:1)
  ├──< push_log
  └──< share_tokens    ← v4.0 (UUID, privacy_mode, view_count, revoked_at)

quota_counter  (standalone — monthly push count key: YYYY-MM)
```

Migrations run automatically on startup via `lib/db.init()`. Files: `migrations/001_initial.sql` … `008_share_token.sql`.
All idempotent (IF NOT EXISTS / IF EXISTS guards). Never use DROP or destructive DDL.

---

## Key Business Rules

- **Leader** = first member to join the trip. Only leader can set destination, rename trip, start group break, archive trip.
- **Rate limit** = 12 s minimum between location updates per member (checked via DB timestamp, not in-memory).
- **ETA** = computed on read (GET /trip/:tripId), not stored. Uses last 5 location rows per member.
- **Stale alert cooldown** = 30 min per member (last_stale_alert_at column). Scheduler must not double-fire.
- **Push quota** = checked against quota_counter before every push. Skipped with status='skipped_stale' when count ≥ MONTHLY_PUSH_LIMIT.
- **Share Token** = UUID from pgcrypto gen_random_uuid(). Max 20 per trip. Privacy 'initial-only' strips pictureUrl and truncates displayName to first char.
- **Webhook must always return HTTP 200** — LINE retries on non-200. Catch all errors inside webhook handler.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `CHANNEL_SECRET` | Yes | — | LINE channel secret (webhook HMAC) |
| `CHANNEL_ACCESS_TOKEN` | Yes | — | LINE Messaging API token |
| `LINE_LOGIN_CHANNEL_ID` | Yes | — | LIFF channel ID for token verify |
| `LIFF_ID` | Yes | — | LIFF app ID (returned by GET /api/config) |
| `PORT` | No | 3001 | HTTP listen port |
| `NODE_ENV` | No | development | Controls log format (pretty vs JSON) |
| `PG_POOL_MAX` | No | 10 | pg connection pool size |
| `PG_SSL` | No | false | Set 'true' for SSL DB connections |
| `MONTHLY_PUSH_LIMIT` | No | 200 | LINE free tier push quota |
| `SCHEDULER_TICK` | No | `*/5 * * * *` | Cron expression for scheduler |
| `SLOW_QUERY_MS` | No | 300 | Log warning threshold for slow queries |
| `ALLOWED_ORIGINS` | No | * | CORS allowed origins (comma-separated) |
| `LIFF_REFRESH_SEC` | No | 15 | LIFF map refresh interval |

---

## npm Scripts

```bash
npm run dev              # NODE_ENV=development node server.js
npm start                # node server.js (production)
npm test                 # jest
npm run test:coverage    # jest --coverage
npm run check            # scripts/check-db.js — debug DB contents
npm run richmenu:build   # build LINE Rich Menu
npm run richmenu:setup   # upload Rich Menu to LINE
```

---

## Testing

**Framework:** Jest + Supertest | **Config:** `testMatch: ["**/tests/**/*.test.js"]`

### Mocking Pattern (follow this exactly)

All external dependencies are mocked at the top of each test file before any `require`:

```js
jest.mock("../lib/db", () => ({
  query: jest.fn().mockResolvedValue({}),
  one:   jest.fn().mockResolvedValue(null),
  many:  jest.fn().mockResolvedValue([]),
  tx:    jest.fn().mockImplementation(async (fn) => fn(jest.fn().mockResolvedValue({}))),
  init:  jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../lib/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

jest.mock("../lib/lineClient", () => ({
  client: { pushMessage: jest.fn().mockResolvedValue({}) },
}));
```

Always mock scheduler to prevent cron from starting during tests:
```js
jest.mock("../services/scheduler", () => ({ start: jest.fn(), stop: jest.fn() }));
```

### Current Coverage (v0.1.9)

| Module | Statements | Functions | Branch |
|---|---|---|---|
| utils/distance.js | 100% | 100% | 100% |
| utils/lineTarget.js | 100% | 100% | 100% |
| services/shareToken.js | 95.0% | 100% | 92% |
| utils/eta.js | 95.9% | 100% | 91% |
| services/safety.js | 85.5% | 85.7% | 82% |
| auth/liffAuth.js | 80.0% | **50.0% ⚠️** | 74% |
| routes/api.js | 76.2% | 89.3% | 71% |
| services/groupBreak.js | 74.0% | 80.0% | 68% |
| **server.js** | 63.2% | **21.4% 🚨** | 58% |
| **TOTAL** | **80.2%** | **79.3%** | **76.3%** |

### Tests That Need to Be Written (Priority Order)

**P1 — Missing entirely:**
- `tests/webhook.test.js` — LINE event parsing: join, leave, location message, text commands (สถานะ/พัก/จบทริป)
- `tests/scheduler.test.js` — checkStaleMembers cooldown logic, checkBreakExpiry 5-min reminder, pushTripUpdate quota skip
- `tests/server.test.js` additions — SIGTERM/SIGINT graceful shutdown, trust proxy header, CSP disabled for LIFF routes

**P2 — Improve coverage:**
- `tests/liffAuth.test.js` — token expired, LINE API timeout, cache eviction, missing Authorization header
- `tests/groupBreak.test.js` — leader-only guard (403 for non-leader), group break sync across all members
- `tests/api.test.js` — location rate limit 429, destination bounds validation (lat 5–21, lng 95–106)

**P3 — New modules:**
- `tests/geocode.test.js` — Nominatim error handling, timeout, result formatting
- `tests/shareToken.test.js` — privacy mode strips fields correctly, max 20 tokens enforced, revoked token rejected

### Test File Template

```js
// tests/example.test.js

// ─── Mocks (before require) ───────────────────────────────────────
jest.mock("../lib/db", () => ({ /* see pattern above */ }));
jest.mock("../lib/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../services/scheduler", () => ({ start: jest.fn(), stop: jest.fn() }));

const request = require("supertest");
const { app } = require("../server");

// ─── Reset mocks between tests ────────────────────────────────────
afterEach(() => jest.clearAllMocks());

describe("Feature Name", () => {
  describe("happy path", () => {
    it("should do X when Y", async () => {
      const { db } = require("../lib/db");
      db.one.mockResolvedValueOnce({ id: 1, name: "test" });

      const res = await request(app)
        .get("/api/trip/1")
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ trip: { id: 1 } });
    });
  });

  describe("error cases", () => {
    it("should return 401 when no token", async () => {
      const res = await request(app).get("/api/trip/1");
      expect(res.status).toBe(401);
    });
  });
});
```

---

## Code Conventions

- **CommonJS only** — use `require()` / `module.exports`. No ESM import/export.
- **Async/await** everywhere. Express 5 handles unhandled rejections automatically.
- **No ORM** — raw SQL with parameterized queries (`$1, $2, …`) via `lib/db.js` helpers.
- **Error response format:** `{ error: "human-readable message" }` with appropriate HTTP status.
- **Success response format:** `{ ok: true, ...updatedFields }` for write operations.
- **Logging:** use `logger.info/warn/error/debug` from `lib/logger.js` — never `console.log`.
- **DB helpers:**
  - `db.query(sql, params)` — for INSERT/UPDATE/DELETE or multi-row SELECT
  - `db.one(sql, params)` — SELECT expecting exactly 1 row (throws if not found)
  - `db.many(sql, params)` — SELECT expecting 0+ rows
  - `db.tx(async (client) => { ... })` — transaction with auto-rollback on error
- **Always validate coordinates:** lat 5–21, lng 95–106 (Thailand bounds).
- **Never hardcode LINE tokens** — always from process.env.

---

## Deployment

- **CI/CD:** Push to `main` → GitHub Actions → SSH into VPS → run `/var/www/aiklao_be/deploy.sh`
- **Process manager:** PM2 (`ecosystem.config.js`), single instance, fork mode, max_memory 512MB
- **Logs:** `/root/.pm2/logs/aiklao-be-out.log` and `aiklao-be-error.log`
- **Health check:** `GET /healthz` → runs `SELECT 1` against DB → `{ ok: true }` (200) or `{ ok: false }` (503)

---

## Known Issues (Sprint 2 Backlog)

1. `server.js` function coverage 21.4% — need SIGTERM/SIGINT handler tests
2. `liffAuth.js` function coverage 50% — need edge case tests
3. `utils/geocode.js` — no LRU cache, every destination lookup hits Nominatim API
4. `services/scheduler.js` — no PG advisory lock, unsafe if scaled to multiple instances
5. No OpenAPI/Swagger spec — planned for Sprint 2

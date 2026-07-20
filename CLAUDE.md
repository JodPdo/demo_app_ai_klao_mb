# AiKlao Mobile Backend (aiklao_mb) — Claude Code Context

> # ⚠️ ARCHIVED / SUPERSEDED — do not develop here
> **Superseded by `demo_app_ai_klao_be` v0.2.19, cutover 2026-07-20, kept for reference.**
> The entire `/api/mobile/*` surface was ported byte-for-byte to the Java backend (Track A2) and the
> A4 nginx cutover moved live traffic `:3002 → :3000` on 2026-07-20. This process is `pm2 stop`ped
> (kept only as a rollback lever). **All new mobile-API work happens on the Java backend, not here.**
> This repo is retained as reference for the original Node implementation and its git history; the CI
> deploy workflow has been removed so a push to `main` cannot redeploy it. The description below
> documents the service *as it was* while live — treat it as historical.

## Project Overview

Mobile-API-only REST backend for AiKlao's real-time group trip tracking, built on Node.js 20 / Express 5 / PostgreSQL.
It serves the React Native mobile app and the LIFF WebView over `/api/mobile/*`, `/api/liff/*`, and `/api/public/*`.

This service does **not** run the LINE bot webhook, and has no safety/scheduler/group-break services of its own.
Those live in the sibling Java Spring Boot backend **`demo_app_ai_klao_be`** (port 3000), which shares this exact
same PostgreSQL database. This repo's only LINE-facing responsibilities are: (1) verifying a LINE `id_token`
(login) or LIFF `accessToken` (session), and (2) best-effort LINE Flex Message pushes for SOS/arrival events
triggered from the mobile app.

**Version:** 0.1.28 | **Language:** JavaScript (CommonJS) | **No TypeScript**

---

## Architecture

```
Mobile app (React Native) ──┐
                             ├──> Express app (server.js, port 3002 via PORT env)
LIFF WebView ────────────────┘

server.js
  helmet → cors (explicit allow-list) → pino-http → express.json({limit:"10kb"}) → cookie-parser
  → rate-limit (60 req/min per IP, global) → route mounts → 404 → error handler

routes/
  ├── mobileAuth.js     POST /api/mobile/auth              — LINE id_token → verify → upsert users → sign app JWT (30d)
  ├── oauthCallback.js  GET  /api/mobile/oauth/callback     — LINE OAuth code → HTML/JS redirect to aiklao:// deep link
  ├── mobileMe.js       GET  /api/mobile/me                 — current user profile (mounted with jwtAuth in server.js)
  ├── mobileTrips.js    /api/mobile/trips/*                 — start, list, get, location, stop, sos, sos/cancel
  ├── mobileInvite.js   POST /api/mobile/trips/:id/invite   — leader creates/reuses a 7-day invite (jwtAuth)
  │                     POST /api/mobile/invite/:token/join — redeem invite, become member (dualAuth)
  │                     GET  /api/public/invite/:token      — public trip preview, no auth
  ├── liffInit.js       POST /api/mobile/init, /api/liff/init — LIFF accessToken → aiklao_liff_session cookie
  ├── liffConfig.js     GET  /api/liff/config               — public LIFF config (liffId, lineChannelId), no auth
  └── lineNotify.js     POST /api/internal/line-notify       — internal only, X-Internal-Secret header (timingSafeEqual)

middleware/
  ├── jwtAuth.js        Bearer JWT only (HS256, issuer 'aiklao', audience 'aiklao-mobile') — required on all
  │                     mutating trip/invite endpoints (start/location/stop/sos/invite-create)
  └── dualAuth.js        Bearer JWT OR aiklao_liff_session cookie — used on GET/join routes shared by mobile + LIFF

lib/
  ├── db.js             pg Pool, query/one/many/tx helpers, runs migrations/*.sql on every startup (idempotent)
  ├── token.js          8-char read-safe invite token generator (crypto.randomBytes, custom alphabet)
  └── logger.js         Pino — pretty-printed in dev, JSON in production (NODE_ENV=production)

utils/
  ├── distance.js       Haversine distance in km
  └── flexMessage.js    LINE Flex Message builders: trip detail, SOS alert, arrival notice

scripts/
  ├── check-db.js               debug DB contents
  ├── delete-user.js            PDPA "delete on request" CLI — dry-run by default, needs --confirm
  ├── build-richmenu.js / setup-richmenu.js / teardown-richmenu.js  — LINE Rich Menu asset management
```

There is no `routes/api.js`, no `handlers/webhook.js`, and no `services/` directory in this repo — those names
belong to an older, now-retired Node monolith and to the current Java backend, not to this codebase.

---

## Database

This repo's `migrations/001_initial.sql` … `014_drop_duplicate_location_index.sql` own these tables:

```
trips ──< members ──< locations
  │           ├──< safety_alerts
  │           └──< sos_events
  ├── notification_settings (1:1)
  ├──< push_log
  ├──< share_tokens        (UUID, privacy_mode, view_count, revoked_at)
  └──< trip_invites        (read-safe token, 7-day expiry, redeemed_count)

users                       (line_user_id, mobile login — Phase 5.2)
aiklao_liff_sessions        (session_id cookie, 4h TTL — LIFF login)
quota_counter               (standalone — monthly LINE push count, key: YYYY-MM)
```

Migrations run automatically on every startup via `lib/db.js`'s `init()` (reads `migrations/*.sql` in filename
order, applies each with a plain `pool.query`). All migrations are idempotent (`IF NOT EXISTS` / `IF EXISTS`
guards) — never use `DROP` or other destructive DDL here.

**Shared-DB tables owned by the Java backend's own migrations** (referenced read/write by this repo, e.g. in
`scripts/delete-user.js`, but not created by anything under this repo's `migrations/`): `user_roles`,
`admin_sessions`, `audit_log`, `content_sections`. Treat their schema as external — coordinate schema changes
with `demo_app_ai_klao_be` before touching them here.

---

## Key Business Rules

- **Leader** = the member who created the trip (`POST /api/mobile/trips/start` inserts them with `is_leader=true`).
  Only the leader can stop/archive a trip (`mobileTrips.js` `/​:id/stop`) or create an invite link (`mobileInvite.js`
  `/trips/:id/invite`).
- **Arrival detection** (`routes/mobileTrips.js`, `checkArrival`, run inside the `POST /:id/location` transaction):
  within `ARRIVAL_RADIUS_M` (100 m) of `trips.dest_lat/dest_lng`, skipped if GPS `accuracy_m` is null or worse than
  `MAX_ACCURACY_M` (50 m). Race-safe: only the request that flips `members.arrived_at` from `NULL` to `now()` wins
  and fires the "arrived" push; it also auto-cancels that user's open `sos_events` row for the trip.
  **This mirrors arrival-detection logic that also exists in the Java backend's `SafetyService.checkArrival`**
  (triggered from LINE-side location updates) — both write `members.arrived_at`. Node checks the `UPDATE`'s row
  count before acting (`race_loss` otherwise); verify the Java side does the same before assuming no duplicate
  pushes/alerts can fire. **Node never sets `trips.all_arrived_at`** — that column is written by the Java side only.
- **SOS**: at most one active (uncancelled) SOS per `(trip_id, user_id)`. Enforced twice — an app-level
  `SELECT ... FOR UPDATE` dedupe inside the insert transaction, *and* a DB-level unique partial index
  (`idx_sos_one_active_per_user`, `migrations/012_sos_events.sql`) as defense-in-depth against the READ COMMITTED
  race where two concurrent "first" SOS attempts both pass the app-level check. Only the sender can cancel their
  own SOS.
- **Invite links**: 8-character read-safe token (`lib/token.js`, alphabet excludes `I/L/O/0/1`), 7-day expiry.
  Creating an invite reuses the newest still-active one for that trip (route-enforced, no DB uniqueness
  constraint) instead of minting a new token every call.
- **LINE pushes** (SOS, arrival, trip-detail) are always best-effort: `AbortSignal.timeout(5000)`, sent via
  `Promise.allSettled` so one failed recipient doesn't fail the others, and — for arrival — fired via
  `setImmediate` *after* the HTTP response so a slow/failed push never delays a location POST.
- **JWT**: HS256 only (`algorithms: ['HS256']` explicitly pinned, no `alg:none`/RS256 confusion), issuer `aiklao`,
  audience `aiklao-mobile`, 30-day TTL, subject = `users.id`.
- **LIFF session cookie** (`aiklao_liff_session`): 4-hour TTL, `httpOnly + secure + sameSite=none` (cross-origin
  LIFF → API).
- **CORS**: explicit allow-list only — `https://liff.line.me`, `https://mb.aiklaotrip.com`, plus whatever is in
  `ALLOWED_ORIGINS` (comma-separated). Not a wildcard.
- **Rate limiting**: a single global limiter (60 req/min per IP) covers the entire app — there is currently no
  per-route tuning (see Known Issues).
- There is **no LINE webhook in this repo** — no "must always return 200" constraint applies here; that rule
  belongs to the Java backend's webhook handler.

---

## Environment Variables

| Variable | Required | Default | Used by |
|---|---|---|---|
| `DATABASE_URL` | Yes | — (throws at import if unset) | `lib/db.js` — shared Postgres, same DB as the Java backend |
| `MOBILE_JWT_SECRET` | Yes | — | `middleware/jwtAuth.js`, `middleware/dualAuth.js`, `routes/mobileAuth.js` — HS256 signing/verify key |
| `MOBILE_LINE_CHANNEL_ID` | Yes | — | `routes/mobileAuth.js` — audience for LINE `id_token` verification |
| `CHANNEL_ACCESS_TOKEN` | Yes (for pushes) | — | `routes/mobileTrips.js`, `routes/lineNotify.js` — LINE Messaging API push token |
| `INTERNAL_SECRET` | Yes (for internal route) | — | `routes/lineNotify.js` — shared secret for `X-Internal-Secret`, compared with `crypto.timingSafeEqual` |
| `LIFF_ID` | Yes | — | `routes/mobileInvite.js`, `routes/liffConfig.js`, `utils/flexMessage.js` — LIFF deep links |
| `LINE_LOGIN_CHANNEL_ID` | Yes | — | `routes/liffConfig.js` — exposed to the LIFF page config |
| `PORT` | No | `3002` | `server.js` |
| `NODE_ENV` | No | `development` | `lib/logger.js` — pretty vs JSON logs |
| `LOG_LEVEL` | No | `debug` (dev) / `info` (prod) | `lib/logger.js` |
| `PG_POOL_MAX` | No | `10` | `lib/db.js` |
| `PG_SSL` | No | `false` | `lib/db.js` — `"true"` sets `{ rejectUnauthorized: false }` |
| `SLOW_QUERY_MS` | No | `300` | `lib/db.js` — logs a warning above this threshold |
| `ALLOWED_ORIGINS` | No | *(none — falls back to the hardcoded LIFF/mb origins only)* | `server.js` CORS, comma-separated |
| `LIFF_URL` | No | — | `scripts/setup-richmenu.js` only (Rich Menu tooling, not the running server) |

There is no `CHANNEL_SECRET` or `SCHEDULER_TICK` or `MONTHLY_PUSH_LIMIT` in this repo's code — those belong to the
Java backend / the retired Node monolith.

---

## npm Scripts

```bash
npm run dev              # NODE_ENV=development node server.js
npm start                # node server.js (production)
npm test                 # jest
npm run test:coverage    # jest --coverage
npm run check            # scripts/check-db.js — debug DB contents
npm run delete-user       # scripts/delete-user.js — PDPA deletion CLI (dry-run unless --confirm)
npm run richmenu:build    # build LINE Rich Menu
npm run richmenu:setup    # upload Rich Menu to LINE
npm run richmenu:teardown # remove Rich Menu from LINE
```

---

## Testing

**Framework:** Jest + Supertest | **Config:** `testMatch: ["**/tests/**/*.test.js"]`

### Mocking Pattern (follow this exactly)

All external dependencies are mocked at the top of each test file before any `require`:

```js
jest.mock("express-rate-limit", () => () => (_req, _res, next) => next());
jest.mock("pino-http", () => () => (_req, _res, next) => next());

jest.mock("../../lib/db", () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  one:   jest.fn().mockResolvedValue(null),
  many:  jest.fn().mockResolvedValue([]),
  tx:    jest.fn().mockImplementation(async (fn) => fn(jest.fn().mockResolvedValue({ rows: [] }))),
  init:  jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../lib/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

// Auth middleware is mocked per-route where jwtAuth/dualAuth would otherwise reject:
jest.mock("../../middleware/jwtAuth", () => (req, _res, next) => {
  req.user = { id: "1", lineUserId: "Utest01", displayName: "Test User", source: "mobile" };
  next();
});
```

### Current test files

```
tests/routes/liffInit.test.js
tests/routes/lineNotify.test.js
tests/routes/mobileInvite.test.js
tests/routes/mobileTrips.test.js
tests/utils/distance.test.js
```

91 tests, all passing (`npm test`). **Every one of these mocks `lib/db` completely — none of them run against a
real Postgres instance.** See Known Issues for the coverage gaps this leaves.

### Test File Template

```js
// tests/routes/example.test.js
jest.mock("../../lib/db", () => ({ /* see pattern above */ }));
jest.mock("../../lib/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../../middleware/jwtAuth", () => (req, _res, next) => {
  req.user = { id: "1", lineUserId: "Utest01", displayName: "Test User" };
  next();
});

const request = require("supertest");
const { app } = require("../../server");

afterEach(() => jest.clearAllMocks());

describe("Feature Name", () => {
  it("should do X when Y", async () => {
    const db = require("../../lib/db");
    db.one.mockResolvedValueOnce({ id: 1, name: "test" });

    const res = await request(app).get("/api/mobile/trips/1");
    expect(res.status).toBe(200);
  });
});
```

---

## Code Conventions

- **CommonJS only** — use `require()` / `module.exports`. No ESM import/export.
- **Async/await** everywhere. Express 5 forwards unhandled rejections in async handlers to the error middleware
  automatically.
- **No ORM** — raw SQL with parameterized queries (`$1, $2, …`) via `lib/db.js` helpers. Never string-concatenate
  user input into SQL.
- **Error response format:** `{ error: "short_snake_case_code" }` with the appropriate HTTP status (see any
  route in `routes/mobileTrips.js` for the pattern).
- **Success response format:** `{ ok: true, ... }` for write operations that need a simple ack (e.g. SOS,
  invite join); routes returning a resource use `{ trip: {...} }` / `{ user: {...} }` shaped bodies instead.
- **Logging:** use `logger.info/warn/error/debug` from `lib/logger.js` — never `console.log` in request-handling
  code (`scripts/*.js` CLIs are the exception — they print to stdout/console by design for operator output).
- **DB helpers (`lib/db.js`):**
  - `db.query(sql, params)` — for INSERT/UPDATE/DELETE or multi-row SELECT, returns the full `pg` result
  - `db.one(sql, params)` — SELECT expecting 0 or 1 row, returns `rows[0] || null` (does **not** throw if not found — callers must check for `null`)
  - `db.many(sql, params)` — SELECT expecting 0+ rows, returns `rows`
  - `db.oneOrNone(sql, params)` — alias for `db.one` (kept for older call sites)
  - `db.tx(async (q) => { ... })` — transaction with auto-rollback on any thrown error; `q` is a `(sql, params) => client.query(...)` bound to the transaction's client
- **Coordinate validation:** routes validate world-wide bounds (`lat -90..90`, `lng -180..180`) — there is no
  Thailand-specific bounding box in this repo's code.
- **Never hardcode LINE tokens or DB credentials** — always from `process.env`, and never as an in-code fallback
  default. `lib/db.js` did this once historically (a real password as the silent default); the working-tree copy
  is fixed, but the value is still recoverable from old git history until the credential itself is rotated.

---

## Deployment

- **CI/CD:** `.github/workflows/deploy.yml` — push to `main` → GitHub Actions → SSH into the VPS → runs
  `/var/www/aiklao_mb/deploy.sh`.
- **Process manager:** PM2 via `ecosystem.config.js` — app name **`aiklao_mb`**, `cwd: /var/www/aiklao_mb/demo_app_ai_klao_mb`,
  single instance, fork mode, `max_memory_restart: 512M`, `PORT=3002` set explicitly in the PM2 `env` block
  (must not collide with the Java backend on port 3000).
- **Logs:** `/root/.pm2/logs/aiklao-mb-out.log` and `/root/.pm2/logs/aiklao-mb-error.log`.
- **Health check:** `GET /healthz` → runs `SELECT 1` against the DB → `{ ok: true, service: "aiklao_mb", version }`
  (200) or `{ ok: false, error }` (503).
- `Dockerfile`/`docker-compose.yml` (port 3002, real required env vars) are kept in sync with this section but
  are not what production actually runs — the PM2 path above is authoritative.

---

## Known Issues

1. **No test coverage for `routes/mobileAuth.js`** — the route that verifies a LINE `id_token` and issues the
   app's JWT has zero tests (`tests/routes/` has no `mobileAuth.test.js`). This is the single most
   security-sensitive endpoint in the repo and currently the least verified.
2. **No integration tests against a real Postgres instance** — every test file under `tests/` fully mocks
   `lib/db`, so a query that no longer matches the actual migrated schema (wrong column name, broken join, etc.)
   would pass `npm test` and only surface in production.
3. **Cross-backend arrival-detection duplication risk** — `routes/mobileTrips.js`'s `checkArrival` and the Java
   backend's `SafetyService.checkArrival` both race to write `members.arrived_at` for the same row; confirm the
   Java side checks its own `UPDATE`'s affected-row-count (the way this repo does) before sending a push or
   writing `safety_alerts`, or duplicate "arrived" notifications are possible.
4. **Global rate limiter has no per-route tuning** (`server.js`) — the same 60 req/min-per-IP budget covers
   high-frequency GPS location posts (`POST /:id/location`) and the LINE-verification-backed login endpoint
   alike; multiple trip members behind the same NAT/carrier IP can be throttled during normal use.

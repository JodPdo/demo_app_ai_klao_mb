# KNOWN ISSUES — AiKlao Bot

> Bugs, risks, security exposure, and technical debt as of 2026-05-19.
> Severity: P0 (critical) > P1 (high) > P2 (medium) > P3 (low).

---

## P0 — Critical (address before production launch)

### P0-1. Secrets exposed during development
During Phase 5.1 debugging, full `.env` contents were pasted into chat 6+ times. The following secrets are considered compromised and **must be rotated before any real production launch**:

| Secret | Where to rotate |
|--------|-----------------|
| `CHANNEL_SECRET` (Messaging API) | LINE Developers Console → AiKlao channel → Basic settings → re-issue |
| `CHANNEL_ACCESS_TOKEN` (Messaging API) | LINE Console → AiKlao → Messaging API tab → issue new token |
| LIFF channel secret | LINE Console → AiKlao LIFF → Basic settings → re-issue |
| `MOBILE_LINE_CHANNEL_SECRET` | LINE Console → AiKlao Mobile → Basic settings → re-issue |
| `MOBILE_JWT_SECRET` | `openssl rand -hex 32` → update `aiklao_mb/.env` |
| `DATABASE_URL` password (`aiklao_user`) | `ALTER USER aiklao_user PASSWORD '...'` → update all `.env` files |

After rotating, restart all PM2 processes. **Note:** the developer chose to defer rotation until the whole project is complete — this is an accepted risk only because the app is not yet publicly launched. It MUST be done before launch.

### P0-2. SSH access was password-based
Root SSH password was also exposed in chat. Action: ensure SSH key-only auth is enforced (`PasswordAuthentication no` in `/etc/ssh/sshd_config`), change the root password, and verify key login works.

---

## P1 — High

### P1-1. `aiklao_mb` was a duplicate of `aiklao_be` — RESOLVED 2026-05-26 (Path A)
`/var/www/aiklao_mb/demo_app_ai_klao_mb/` previously contained a full copy of the `aiklao_be` codebase patched with mobile routes, running on port 3002.

**Resolution:** A clean lightweight scaffold that the developer had authored earlier (commit `5cdb439` "feat(mobile): add /me endpoint") existed on `main` but had never been deployed. During the IMM-3 release cycle the develop→main merge surfaced this — Path A was chosen to adopt the scaffold as the production end state. The reverse-resolved merge (`52a1282`) took main's scaffold for `server.js`, `routes/oauthCallback.js`, and `routes/mobileMe.js`. `routes/mobileAuth.js` and `middleware/jwtAuth.js` were already byte-identical on both branches so no Phase 5.1 auth fixes were lost. Final release at commit `71aeab9` (v0.1.14) is live in production.

**Side effect:** the repo still tracks dead v3.0 files (`handlers/webhook.js`, `services/scheduler.js`, `routes/api.js`, `services/safety.js`, etc.) and unused deps (`@line/bot-sdk`, `node-cron`). Zero execution impact but noise — future cleanup.

### P1-2. Local ↔ server code desync — RESOLVED 2026-05-26
Multiple files were created directly on the server via SSH heredocs (`routes/oauthCallback.js`, `routes/mobileMe.js`, `server.js` patches, `.env` edits) and never committed back to git.

**Resolution:** Code files (`routes/oauthCallback.js`, `routes/mobileMe.js`, `server.js` change) committed to `develop` at `d7b14b4` and pushed to origin on 2026-05-26. Server, origin, and local clone now sync. Recovery used `git format-patch` from server → `git am` on local → push → server `git fetch && git reset --hard origin/develop` (necessary because server deploy key is read-only by design). See `TODO_ROADMAP.md` Session log 2026-05-26 for full details.

**Note:** `.env` edits made on the server are NOT covered by this resolution — those secrets were never on local, will need explicit reconciliation if/when `.env` management is formalized (see P2-5 and P0-1).

### P1-3. `ecosystem.config.js` has no `aiklao_mb` entry — RESOLVED 2026-05-26
`/var/www/aiklao_mb/demo_app_ai_klao_mb/ecosystem.config.js` was previously a verbatim copy of aiklao_be's, so `pm2 start ecosystem.config.js` from that directory would have created or restarted a process named `aiklao_be` instead.

**Resolution:** rewrote the file with a correct `aiklao_mb` app entry (name, cwd, `PORT: 3002`, restart policy, log paths). Also fixed two related bugs discovered in the same cycle: `/var/www/aiklao_mb/deploy.sh` had `pm2 restart aiklao_be` (wrong service — fixed in-place via `sed`); `.github/workflows/deploy.yml` had `name: Deploy aiklao_be` and pointed at `/var/www/aiklao_be/deploy.sh` (fixed in repo). After deploy, manual `pm2 delete && pm2 start ecosystem.config.js && pm2 save` was required to break out of PM2's "waiting restart" state (`max_restarts: 10` hit during the brief pino-http-missing crash loop). `pm2 save` was run so the dump survives reboot.

**Pending verification:** `pm2 kill && pm2 resurrect` round-trip not yet tested — IMM-3's "survives reboot" promise is currently unverified end-to-end. See TODO_ROADMAP.md "Pending verification".

### P1-4. Git remote confusion (`torpeerapolthi` vs `JodPdo`)
The developer owns two GitHub accounts. The server's `git remote` once pointed to `torpeerapolthi/...` while pushes went to `JodPdo/...`, so "successful" deploys pulled stale code. Currently aligned to `JodPdo`, but this must be re-verified after any infra change. Always run `git remote -v` on both local and server.

---

## P2 — Medium

### P2-1. Dead mobile code in `aiklao_be`
`aiklao_be/server.js` still mounts `mobileAuth` (and the route order comment). Because nginx routes `/api/mobile/*` to port 3002, this code is unreachable dead code. It should be removed (Phase F cleanup) so the two services have clean separation.

### P2-2. nginx `default` site conflict
nginx logs warnings about a conflicting `server_name` (`api.aiklaotrip.com` / `dev.aiklaotrip.com`) from `/etc/nginx/sites-enabled/default`. Remove the stale `default` site.

### P2-3. Migrations run on every startup
`lib/db.init()` re-applies all migration files on every process boot. Idempotent (`IF NOT EXISTS`) but noisy and slows startup. Consider a migrations table that records applied versions.

### P2-4. No staging environment
Mobile app and LIFF both point at the single production API. There is no separate dev/staging DB or API. A bad migration or deploy affects production immediately.

### P2-5. `.env` not consistently managed
`.env` files were edited ad hoc on the server; `MOBILE_*` vars disappeared at least once (suspected deploy script behavior or manual error). There is no `.env` template/secret-management process. Consider a documented `.env.example` per service and a secrets manager (Doppler, SOPS, or at minimum `chmod 600` + immutable flag).

### P2-7. PROJECT_MEMORY.md infrastructure claims are stale (discovered 2026-05-26)
`PROJECT_MEMORY.md` says "3 PM2 services: aiklao_be (3000), aiklao_fe (3001), aiklao_mb (3002)" and "138 tests". Reality:

- Only **2 PM2 services** run: `aiklao_be:3000` and `aiklao_mb:3002`. `aiklao_fe` is **not** a PM2 process. `/var/www/aiklao_fe/demo_app_ai_klao_fe/` exists with its own `ecosystem.config.js` but has never been started in PM2. LIFF UI is served from `aiklao_be` itself (or never separated).
- Port `:3001` is occupied by a **Docker container** for the developer's friend's `dev.aiklaotrip.com` site — unrelated to AiKlao. nginx routing for that subdomain is not in `/etc/nginx/sites-enabled/` (handled by some other mechanism, possibly a separate nginx vhost or Caddy/Traefik).
- Jest tests are actually **236** (9 suites), not 138 — the suite grew since the doc snapshot.

Action: when convenient, rewrite the affected sections of `PROJECT_MEMORY.md` (this is IMM-1.5 in `TODO_ROADMAP.md`). Until then, treat `PROJECT_MEMORY.md`'s infrastructure section with skepticism.

**Security note for launch readiness:** The friend's Docker container shares the production VPS. Before public launch (P0 milestone), review whether continuing to share infrastructure with a third party is acceptable for a service that will store user location data, or whether `dev.aiklaotrip.com` should be moved to a separate host.

### P2-6. Backup cron not confirmed
`scripts/setup-cron.sh` (daily DB backup, hourly health check) was written in Phase 4.2 but it is unconfirmed whether it was actually run on the server. Verify `crontab -l` and check `/var/backups/aiklao/`.

---

## P3 — Low / future

### P3-1. Rate limiting is per-IP only
`express-rate-limit` keys on IP. A single abusive LINE user behind a shared IP, or distributed abuse, is not specifically limited. Consider per-LINE-userId limiting.

### P3-2. Expo SDK / dependency drift
The mobile app was scaffolded for SDK 51, then force-upgraded to SDK 54 via `expo install --fix`. Node 24 is used locally vs Node 22 on the server. Pin and document supported versions.

### P3-3. Webhook command parsing is fragile
`handlers/webhook.js` matches Thai-language command strings. Any wording change breaks commands. Has already required 4 patch iterations. Consider a command registry / structured postback actions.

### P3-4. Single VPS, single DB — no redundancy
All three services + PostgreSQL run on one VPS. No failover, no read replica. Fine for MVP; a scaling risk later.

### P3-5. JWT has no refresh-token rotation
Mobile JWT is a 30-day bearer token with no refresh/rotation flow. `tokenStorage` reserves a `refresh` key but it is unused. Acceptable for MVP; revisit for production.

### P3-6. OAuth callback page trusts query params
`routes/oauthCallback.js` reflects `code`/`state`/`error` into an HTML page and an `aiklao://` URL. Values are placed into a `URLSearchParams` and JSON-encoded into a script string, which mitigates injection, but the page should be reviewed for XSS hardening before launch (e.g. strict allow-listing of param shapes).

---

## Resolved during development (kept for history)

- Expo SDK 51 + Metro mismatch (`metro/src/lib/TerminalReporter` not found) → upgraded to SDK 54.
- ENV name mismatch `LINE_LOGIN_CHANNEL_ID` vs `MOBILE_LINE_CHANNEL_ID` → code reads `MOBILE_LINE_CHANNEL_ID`.
- server.js route order (`/api` before `/api/mobile/auth`) → reordered.
- LINE Console Android URL scheme `aiklaomobile` → corrected to `aiklao`.
- Wrong `MOBILE_LINE_CHANNEL_ID` (`2009933302` Messaging) → corrected to `2010079833` (Mobile Login).
- LINE rejects custom-scheme `redirect_uri`; Expo proxy deprecated → built HTTPS OAuth callback bridge.
- nginx had no `/api/mobile/` location → added (before `/`).
- `aiklao_mb` ran on port 3000 (clash) → `.env` `PORT=3002`.
- `server.js` missing `const oauthCallback = require(...)` → added.
- `isGroupOnBreak` null-pointer crash → null guard added (caught by unit tests).
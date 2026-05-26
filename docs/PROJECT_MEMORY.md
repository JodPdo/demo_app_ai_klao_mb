# PROJECT MEMORY — AiKlao Bot

> Concise knowledge-base summary for a Claude Project. Paste this into Project Knowledge.
> Companion full docs: MASTER_PROJECT_SUMMARY, SYSTEM_ARCHITECTURE, SERVER_SETUP, API_REFERENCE, DATABASE_SCHEMA, TODO_ROADMAP, KNOWN_ISSUES.
> Snapshot date: 2026-05-26.

---

## What it is
**AiKlao Bot** — a real-time group trip location-tracking system for Thailand. Three faces: (1) a LINE chat bot, (2) a LIFF web app with a live Leaflet map, (3) a React Native + Expo mobile app (in progress). Plus a public read-only Share View. No AI/ML — "AiKlao" is a Thai phonetic name.

## Current status
Backend + LIFF + Share View + tests/CI are production-stable. Mobile app: UI shell done, LINE Login auth done and verified end-to-end. Next is Phase 5.2 (foreground location + map). The developer (GitHub `JodPdo`) is a solo learner-developer.

## Production
- API: `https://api.aiklaotrip.com`
- VPS: `162.141.142.154`, Ubuntu 24.04, SSH user `root`.
- 2 PM2 services: `aiklao_be` (3000), `aiklao_mb` (3002). `aiklao_fe` is not running — `/var/www/aiklao_fe/demo_app_ai_klao_fe/` exists on disk but has never been started in PM2. Port `:3001` is occupied by an unrelated Docker container (`dev.aiklaotrip.com`, developer's friend's site).
- nginx 1.24 + Let's Encrypt. PostgreSQL 16, DB `aiklao_db`, user `aiklao_user`.

## Architecture
nginx routes `/api/mobile/*` → `aiklao_mb` (3002); everything else (`/webhook`, `/api/*`, `/liff`, `/share`, `/healthz`) → `aiklao_be` (3000). All services share one PostgreSQL DB. The mobile app is installed on phones and calls `api.aiklaotrip.com` over HTTPS.

## Repos (all under GitHub `JodPdo`)
- `demo_app_ai_klao_be` → `/var/www/aiklao_be/demo_app_ai_klao_be`
- `demo_app_ai_klao_fe` → `/var/www/aiklao_fe/demo_app_ai_klao_fe`
- `demo_app_ai_klao_mb` → `/var/www/aiklao_mb/demo_app_ai_klao_mb`
- `aiklao-mobile` — React Native app, local only, builds via EAS.

## Tech stack
Backend: Node.js 22, Express, @line/bot-sdk v11, pg, pino, node-cron, jsonwebtoken, helmet, cors, express-rate-limit. Mobile: React Native 0.81, Expo SDK 54, TypeScript, React Navigation v6, expo-auth-session/web-browser/crypto/secure-store, axios. Infra: PM2, nginx, Let's Encrypt, GitHub Actions, Task (taskfile.dev), git-cliff, Jest (236 tests, 9 suites).

## LINE channels (3)
- Messaging API: `2009933302`
- LIFF (LINE Login): `2009959343` (LIFF_ID `2009959343-X901PDCO`)
- Mobile Login: `2010079833` ← used by the mobile app; `MOBILE_LINE_CHANNEL_ID` on the server and `extra.lineChannelId` in `app.json` must both equal this.

## Database (aiklao_db)
Tables: `trips`, `members`, `locations`, `share_tokens`, `users`. Migrations `001`–`009` run from files on every startup (`009` = `users` table for mobile auth). `users` and `members` both carry `line_user_id` but have no FK link yet.

## Mobile authentication flow (canonical)
1. App opens browser to LINE OAuth, `redirect_uri = https://api.aiklaotrip.com/api/mobile/oauth/callback` (HTTPS — LINE rejects custom schemes as redirect_uri), with PKCE + state + nonce.
2. LINE redirects to that backend callback.
3. `aiklao_mb` `routes/oauthCallback.js` returns an HTML page that redirects to `aiklao://auth/callback?code=...`.
4. The app's custom scheme `aiklao` opens the app; `WebBrowser.openAuthSessionAsync` captures the return URL.
5. App exchanges `code` at LINE's token endpoint (with PKCE verifier) → `id_token`.
6. App `POST /api/mobile/auth { idToken }`.
7. `aiklao_mb` verifies `id_token` via LINE's verify endpoint, upserts `users`, signs an app JWT (HS256, `iss=aiklao`, `aud=aiklao-mobile`, 30-day TTL).
8. App stores JWT in `expo-secure-store`; subsequent calls send `Authorization: Bearer <jwt>`.

## Deploy flow
Backend: commit → `task patch-release` (bump+changelog) → `task push-release` (merge develop→main, push) → GitHub Actions SSHes into the VPS and runs `/var/www/<svc>/deploy.sh` (`git reset --hard origin/main` → `npm ci` → `pm2 reload`). Mobile: Metro for dev; `eas build` for distributable APK/IPA.

The server's git remote uses a read-only SSH deploy key (alias `github-jodpdo:JodPdo/…`). The server can pull from origin but cannot push. All commits must originate from the local workstation — never commit directly on the server.

## Key architecture decisions
- Separate `aiklao_mb` microservice — isolate mobile API; also a learning exercise.
- HTTPS OAuth callback bridge — because LINE rejects custom-scheme redirect_uri and the Expo auth proxy is deprecated.
- JWT (stateless) for mobile, 30-day TTL.
- Shared PostgreSQL DB across services (MVP simplicity).
- Dev build (not Expo Go) — Expo Go can't register the `aiklao://` scheme.

## Critical known issues (see KNOWN_ISSUES.md)
- **P0:** 6+ secrets exposed in chat (CHANNEL_SECRET, CHANNEL_ACCESS_TOKEN, MOBILE_JWT_SECRET, MOBILE_LINE_CHANNEL_SECRET, LIFF channel secret, DB password) — rotation deferred until project completion but MANDATORY before public launch. SSH was password-based — move to key-only.
- **P1 (RESOLVED 2026-05-26):** `aiklao_mb` v3.0-copy issue + `ecosystem.config.js` misconfig + drift all closed. Production runs main's lightweight scaffold at commit `71aeab9` (v0.1.14). Adopted via Path A reverse-merge — see KNOWN_ISSUES P1-1 / P1-3. Pending only: `pm2 kill && pm2 resurrect` simulation (Step H) to verify reboot survival end-to-end.
- **P2:** dead mobile code still in `aiklao_be`; nginx `default` site conflict; migrations re-run every boot; no staging environment; friend's Docker container (`dev.aiklaotrip.com`) co-hosted on the production VPS — sharing infrastructure with a third party while storing user location data must be reviewed before public launch.

## Immediate priorities (before Phase 5.2)
✅ Sync local↔server (done 2026-05-26, commit `d7b14b4`); ✅ adopt lightweight scaffold for `aiklao_mb` (done 2026-05-26 via Path A merge `52a1282`); ✅ `aiklao_mb` in `ecosystem.config.js` + `deploy.sh` + `deploy.yml` fixed (done 2026-05-26, live at `71aeab9` v0.1.14); remove dead mobile code from `aiklao_be` (IMM-4 — still open); create a deploy checklist; verify backup cron; **Step H** — run `pm2 kill && pm2 resurrect` to verify reboot survival.

## Next phase — 5.2 (Foreground Location + Map)
Mobile: `react-native-maps` (native, not WebView) + `expo-location`; permission flow; MapScreen; Start/Stop trip; `watchPosition` loop; live marker. Backend (`aiklao_mb`, JWT-protected): `POST /trips/start`, `GET /trips`, `GET /trips/:id`, `POST /trips/:id/location`, `POST /trips/:id/stop`. Build the stable flow `Open → Allow → Start → Send → Render → Stop` before attempting background tracking (5.3).

## Development timeline (chronological)
1. **Phase 3.x** — LINE bot + LIFF: trip lifecycle, destination picker, Rich Menu.
2. **Phase 3.4 / 3.4.2** — Safety (stale/arrival/SOS/stationary) + Break mode.
3. **Phase 3.5** — Group break + trip naming.
4. **Phase 3.6 / 3.6.2** — ETA + live location + auto-track on LIFF open.
5. **Phase 4.0** — Public Parent Share View (share tokens, privacy modes).
6. **Phase 4.2** — Jest tests (138, grew to 236 by 2026-05), GitHub Actions CI/CD, structured logs, request IDs, DB backup scripts. Also a Taskfile release-workflow audit (fixed 4 bugs).
7. **Phase 5.0** — Mobile UI shell: Expo (SDK 51→54), React Navigation, theme, 4 screens.
8. **Phase 5.1** — Mobile LINE Login auth. First attempted as a monolith addition to `aiklao_be`; pivoted to a separate `aiklao_mb` microservice. Heavy debugging: env-name mismatch, route order, git-remote desync, wrong channel ID, custom-scheme rejection, Expo-proxy deprecation. Resolved with an HTTPS OAuth callback bridge. Verified end-to-end (user "Biggeorge" logged in, `users` row created, app reached Home screen).
9. **Now** — Cleanup phase before Phase 5.2.

## Hard-won lessons
- "Every layer correct ≠ all layers connected correctly" — integration is its own surface.
- A `401`/`400` can be a *success* signal (auth middleware working) — read the response body.
- Old PM2 logs mislead; `pm2 flush` and check timestamps.
- Verify `git remote` on BOTH local and server — desync produced "successful" deploys of stale code.
- Use `pm2 delete && pm2 start` (not `restart`) when `.env` changes.
- Each service needs a unique port; `.env` `PORT` collisions cause crash loops.
- Never paste `.env`/secrets into chat.
- `git reset --hard origin/<branch>` silently drops any local-only commit AND deletes files that existed only in that commit — no warning given. Always confirm origin already contains everything you want to preserve before resetting.
- When the server deploy key is read-only: drift recovery path is `git format-patch origin/<branch>..HEAD --stdout > /tmp/x.patch` on the server → scp to local → `git am` → push → server `git fetch && git reset --hard origin/<branch>`.
- Orphaned commits survive in `git reflog` for ~30–90 days after a destructive reset — recoverable with `git reset --hard <orphan-hash>` before the reflog expires.
- `package.json` deps can silently drift after a merge if both branches modified deps on different lines. Git auto-merges line-by-line, but the result may be missing transitive deps that one side's code requires. Before deploying, run a "do all top-level `require()`s resolve" check across `server.js` + every file it loads.
- `pm2 reload` does NOT revive a process that has hit `max_restarts` (i.e. status "waiting restart"). The only way back is `pm2 delete <name> && pm2 start <ecosystem.config.js> && pm2 save`.
- CI workflows can be silently misconfigured for unknown duration. The `aiklao_mb` GitHub Actions workflow had been pointing at `aiklao_be`'s deploy script — every push to `aiklao_mb` main was restarting the wrong service. Always read `.github/workflows/*.yml` and the on-server `deploy.sh` end-to-end when commissioning a service.

## Working conventions
- Branch model: `main` + `develop`. Release via Taskfile.
- Conventional commits; `git-cliff` changelog.
- git is the source of truth; the server mirrors git via deploy.sh, never the other way round. Never create or edit files directly on the server — always commit locally, push, then let deploy.sh pull.
- After every deploy: `curl /healthz` (200), `curl /api/mobile/auth` empty (400), `curl /api/mobile/oauth/callback?code=t` (200 text/html), `pm2 list`, send a LINE message.
# TODO & ROADMAP — AiKlao Bot

> Prioritized work plan as of 2026-05-19.
> Last completed milestone: Phase 5.1 (Mobile LINE Login auth) — verified end-to-end.

---

## Session log

**2026-05-26 — IMM-1, IMM-1.5, IMM-2, and IMM-3 all completed in one extended session.** Production now runs main's lightweight scaffold at v0.1.14 (commit `71aeab9`). Four of five cleanup items done; only IMM-4 remains.

Resume point: **IMM-4** (remove dead mobile code from `aiklao_be`) — ~20 min, low risk. Plus optional **Step H** (resurrect simulation to verify `pm2 save` survives real reboot) — see "Pending verification" below.

### Phase 1: IMM-1 — drift recovery
Files `oauthCallback.js`, `mobileMe.js`, and the `server.js` mount-line patch were created directly on the server during Phase 5.1 debugging and never committed. Recovery used `git format-patch` from server → `git am` on local → push → server `git fetch && git reset --hard origin/develop` (necessary because the server's deploy key is read-only by design). All three locations (server, origin, local clone) synced at `d7b14b4` on `develop`. Production never went down — PM2 did not restart.

### Phase 2: IMM-1.5 — corrected PROJECT_MEMORY.md
Found and fixed several stale infrastructure claims. See `KNOWN_ISSUES.md` P2-7.

### Phase 3: IMM-3 + IMM-2 combined (Path A)
What started as a 15-minute task (add `aiklao_mb` to `ecosystem.config.js`) expanded into a full IMM-2 + IMM-3 release because of pre-existing main-side work nobody had tracked. Final commits on `main`:

- `52a1282` — release merge (resolved 3 conflicts with `--ours` to take main's lightweight scaffold)
- `54149eb` — `module.exports = { app }` for test compatibility
- `71aeab9` — added missing `pino-http` dependency

What happened, in order:
1. Local IMM-3 work on `develop`: corrected `ecosystem.config.js`, fixed `.github/workflows/deploy.yml` (was pointing at `/var/www/aiklao_be/deploy.sh` instead of `/var/www/aiklao_mb/deploy.sh`), `task patch-release` to v0.1.14.
2. Server-side fix in same session: `/var/www/aiklao_mb/deploy.sh` had `pm2 restart aiklao_be --update-env` (wrong service) — fixed in-place via `sed` to `pm2 reload aiklao_mb --update-env`. This file is not in any git repo; it lives only on the server, so editing in place is the only option.
3. `task push-release` failed at `git merge develop → main` with three add/add and content conflicts.
4. Investigation revealed that `main` already contained an independent lightweight `aiklao_mb` scaffold (commit `5cdb439`, "feat(mobile): add /me endpoint", authored before Phase 5.1) that had never been deployed to the server. Phase 5.1 debugging produced ad-hoc patches on the v3.0-copy code that `develop` ended up with; these were what IMM-1 committed.
5. Strategic decision: adopt main's lightweight scaffold as the end state (Path A). This effectively completed IMM-2 in the same release cycle.
6. Reverse-resolved the merge with `--ours` on `server.js`, `routes/oauthCallback.js`, `routes/mobileMe.js` — all three take main's scaffold versions. The five auto-merged files (`ecosystem.config.js`, `deploy.yml`, `package.json`, `package-lock.json`, `CHANGELOG.md`) preserve IMM-3's work.
7. Verified the scaffold is Phase 5.1 complete: `routes/mobileAuth.js` and `middleware/jwtAuth.js` were byte-identical on both branches, so no Phase 5.1 auth fixes were lost.
8. Added `module.exports = { app }` change so existing `tests/server.test.js` keeps working with main's scaffold.
9. Pushed to main → GitHub Actions deployed → 502 Bad Gateway on `/api/mobile/*`.
10. Diagnosis: `pino-http` was missing from `package.json` deps. Main's scaffold required it but the merged `package.json` (which took develop's deps + main's added entries) somehow didn't have it. PM2 hit `max_restarts: 10` and gave up.
11. Fix: `npm install pino-http --save` on local, commit, push. GitHub Actions redeployed.
12. PM2 was still in "waiting restart" state after the dep fix — manual `pm2 delete && pm2 start ecosystem.config.js && pm2 save` was needed to revive it. `pm2 reload` does not reset a process that has hit `max_restarts`.
13. Verified end-to-end: `/api/mobile/auth` returns 400 `missing_id_token` (correct), `/api/mobile/oauth/callback?code=test` returns 200, `/healthz` returns 200. All clean. PM2 instance 4 running with restart count 0.

### Lessons captured (added to `PROJECT_MEMORY.md` Hard-won lessons)
- A `git merge` between branches that independently added the same files can produce add/add conflicts even when content is functionally equivalent. Use `git diff` to compare hashes before resolution.
- `package.json` deps can silently drift after a merge if both branches modified deps in different lines — git auto-merges line-by-line but the combined result may be missing transitive deps required by code from the other side. Always run a "do all `require()`s resolve" check before deploying.
- `pm2 reload` does NOT revive a process that has hit `max_restarts`. Use `pm2 delete && pm2 start <ecosystem>` to fully reset, then `pm2 save`.
- The aiklao_mb GitHub Actions workflow was authored pointing at aiklao_be's deploy script — silent misconfig that had been running for an unknown duration, restarting the wrong service on every aiklao_mb push.

### Pending verification (do NOT skip indefinitely)
**Step H — Resurrect simulation.** `pm2 save` was run, `pm2-root.service` systemd is installed, but the round-trip of `pm2 kill && pm2 resurrect` was not run as a final verification. Without this, the IMM-3 promise of "survives reboot" is theoretical. Cost: ~5–15 s downtime for both `aiklao_be` and `aiklao_mb`. Schedule for a low-traffic window (Thailand early morning) or do now while the engineer is alert.

### Open follow-ups (not blocking, smaller than IMM-4)
- `aiklao_mb` repo still tracks dead v3.0 files (`handlers/webhook.js`, `services/scheduler.js`, `routes/api.js`, `services/safety.js`, etc.). They are no longer `require()`-d by main's `server.js` and have zero execution impact, but they are noise in the repo. Delete in a future cleanup.
- `aiklao_mb` `package.json` still lists `@line/bot-sdk` and `node-cron` — leftover deps from the v3.0 copy that the lightweight scaffold does not use. Harmless but unnecessary. Remove with `npm uninstall @line/bot-sdk node-cron` in a future cleanup.
- `aiklao-mobile/.expo/devices.json` keeps showing as modified in the `aiklao_mb` clone. Proper fix: `git rm --cached aiklao-mobile/.expo/devices.json` + add to `.gitignore`.
- `docs/CLEANUP_PROMPT*.md` files appear as untracked in the `aiklao_mb` local clone — they were copied for reference, do not belong in this repo. Either move to the Claude project docs folder or add `docs/` to `aiklao_mb`'s `.gitignore`.

Key findings during this session (also reflected in `KNOWN_ISSUES.md`):

- Only **2 PM2 services** run in production: `aiklao_be:3000` and `aiklao_mb:3002`. There is **no `aiklao_fe` PM2 process**. The folder `/var/www/aiklao_fe/demo_app_ai_klao_fe/` exists with its own `ecosystem.config.js` but the service has never been started. `PROJECT_MEMORY.md` claim of "3 PM2 services" is wrong.
- Port `:3001` is occupied by a **Docker container** hosting the user's friend's `dev.aiklaotrip.com` site — not part of AiKlao infrastructure. nginx routing for it is not in `sites-enabled/` (handled elsewhere).
- Jest test count is actually **236** (9 suites), not 138 as `PROJECT_MEMORY.md` claims.
- Server git uses SSH alias `github-jodpdo:JodPdo/...`; **deploy key is intentionally read-only** — commits must originate from the local workstation, not the server. Going forward, the canonical workflow is: edit on local → push → server pulls via `deploy.sh`.
- Local clone path of `demo_app_ai_klao_mb`: `C:\Users\claw\Desktop\clone-form-git-Project\aiklao_mb_local`.

Lessons recorded (for future drift recovery):

- `git reset --hard origin/develop` is destructive when local has a commit not in origin. It silently drops the commit AND removes any files introduced only in that commit. Always confirm `origin/develop` already contains the change you want preserved before resetting.
- When a server's deploy key is read-only (which is the right default), the recovery path for drift is: `git format-patch origin/develop..HEAD --stdout > /tmp/x.patch` → scp to local → `git am` on local → push → server `git fetch && git reset --hard origin/develop` (safe at this point because origin and server now have identical content).
- The orphan commit hash survives in `git reflog` for ~30–90 days even after a destructive reset — `git reset --hard <orphan-hash>` recovers everything.

Minor follow-ups discovered (not blocking):

- `aiklao-mobile/.expo/devices.json` repeatedly shows as modified in local clone — should be in `.gitignore`.
- `docs/CLEANUP_PROMPT.md` is sitting untracked in the local clone — that file belongs in the Claude project folder, not in this repo. Either move it or add to the repo's `.gitignore`.

---

## 1. Immediate Priorities (do BEFORE Phase 5.2)

These stabilize the base. Skipping them makes every later bug 3x harder to diagnose.

### IMM-1. Sync local ↔ server (P1) — ~30 min
Files were created directly on the server and are not in git. The next `deploy.sh` will wipe them.
```
[ ] On server: snapshot /var/www/aiklao_mb/demo_app_ai_klao_mb (git status, file list)
[ ] On local:  snapshot the aiklao_mb clone
[ ] Diff; copy server-only files into the local clone
[ ] Commit + push so git = source of truth
[ ] Re-run deploy.sh; verify nothing breaks
```

### IMM-2. Decide & fix the `aiklao_mb` microservice (P1) — ~1 hr
Choose one:
- **(a) Keep duplicate** — quick: just remove `scheduler.start()` and the webhook route from the `aiklao_mb` copy so it doesn't double-run jobs.
- **(b) True microservice** — replace `aiklao_mb` codebase with the lightweight scaffold (only mobile routes, no scheduler/webhook/LIFF). Recommended.

### IMM-3. Add `aiklao_mb` to PM2 config (P1) — ~15 min
Add an `aiklao_mb` app entry to an `ecosystem.config.js` (name, cwd, `env.PORT=3002`) so it survives reboot / `deploy.sh`.

### IMM-4. Remove dead mobile code from `aiklao_be` (P2) — ~20 min
Delete `routes/mobileAuth.js` references, the `mobileAuth` require, and the `/api/mobile/auth` mount from `aiklao_be/server.js`. Keep `migrations/009_users_mobile.sql` (shared table).

### IMM-5. Create a deploy checklist (P2) — ~20 min
A short repeatable checklist (see §6 below) to prevent human error.

### IMM-6. Verify backup cron (P2) — ~10 min
`ssh` in, `crontab -l`, check `/var/backups/aiklao/`. Run `scripts/setup-cron.sh` if missing.

### IMM-7. Write docs (P2) — ~45 min
Commit `PHASE_5.0.md` and `PHASE_5.1.md` into the repos (architecture, OAuth flow, troubleshooting). These migration docs can seed them.

---

## 2. Phase 5.2 — Foreground Location + Map (1–2 weeks)

**Goal:** the app shows a live map and can record a trip while the app is open.

### Mobile
```
[ ] npx expo install react-native-maps expo-location
[ ] Location permission request flow (foreground / "When in Use")
[ ] MapScreen — replaces the Home placeholder; react-native-maps (NOT WebView — native perf)
[ ] Start/Stop trip buttons
[ ] watchPosition loop — send a location point every X seconds
[ ] Live position marker; trip history list (basic)
```

### Backend (`aiklao_mb`, JWT-protected)
```
[ ] POST /api/mobile/trips/start
[ ] GET  /api/mobile/trips
[ ] GET  /api/mobile/trips/:id
[ ] POST /api/mobile/trips/:id/location
[ ] POST /api/mobile/trips/:id/stop
```
Reuse the existing `trips` / `locations` tables.

**Recommended stable flow to build first:**
`Open app → Allow location → Start trip → Send location every X sec → Render marker → Stop trip`.
Get this rock-solid before touching background tracking.

**Watch out for:** map performance on old devices; GPS noise indoors; battery drain even in foreground; iOS "When in Use" vs "Always" permission (affects 5.3).

---

## 3. Later Phases

### Phase 5.3 — Background Tracking (2 weeks) — the core reason the native app exists
- `expo-task-manager` + `expo-location` background mode.
- iOS `UIBackgroundModes: location`; Android foreground service + persistent notification.
- Battery tuning; test against Android OEM background restrictions (Samsung, Xiaomi, Huawei).

### Phase 5.4 — Push Notifications (1 week)
- Expo Push (or FCM/APNS direct). Register push token → backend. Deep links from notifications.
- Backend: `POST /api/mobile/push-token` + a push-sending service.

### Phase 5.5 — Offline Queue + Sync (1–2 weeks)
- `expo-sqlite` offline queue for location points; retry with backoff; network detection; sync indicator.
- Backend: `POST /api/mobile/trips/:id/location/batch`.

### Phase 5.6 — Polish + Store Launch (2–3 weeks)
- Loading/error states, app icon, splash, onboarding, crash reporting (Sentry).
- TestFlight + Google Play Internal Testing beta.
- Store listing (TH + EN), privacy policy, store review.

---

## 4. Recommended Refactors

| Refactor | Why | Effort |
|----------|-----|--------|
| `aiklao_mb` → true lightweight microservice | Remove duplicate scheduler/webhook; clean separation | 1 hr |
| Migration tracking table | Stop re-running all migrations on every boot | 2 hr |
| Command registry for webhook | Replace fragile Thai string matching | 1 day |
| Shared lib package | If keeping two services, extract `db`/`logger` to a shared module | 0.5 day |
| `.env.example` per service + secrets manager | Stop ad-hoc `.env` edits | 0.5 day |

---

## 5. Security Improvements

```
[ ] P0 — Rotate all 6 exposed secrets (see KNOWN_ISSUES.md P0-1)
[ ] P0 — Enforce SSH key-only auth; change root password
[ ] P1 — Add aiklao_mb to ecosystem.config.js (resilience)
[ ] P2 — Harden routes/oauthCallback.js against XSS (strict param validation)
[ ] P2 — chmod 600 + immutable flag on .env files, or move to secrets manager
[ ] P3 — Per-LINE-userId rate limiting (currently per-IP only)
[ ] P3 — JWT refresh-token rotation flow
```

---

## 6. Deployment Improvements

### Suggested deploy checklist (use every deploy)
```
PRE:
[ ] git status clean on local
[ ] git remote -v correct (JodPdo)
[ ] on develop branch; tests pass (npm test)
[ ] task patch-release ran (version bumped)

DEPLOY:
[ ] task push-release (merge develop -> main, push)
[ ] GitHub Actions: test job green, deploy job green

POST:
[ ] curl https://api.aiklaotrip.com/healthz  -> 200
[ ] curl .../api/mobile/auth (empty body)    -> 400
[ ] curl .../api/mobile/oauth/callback?code=t -> 200 text/html
[ ] pm2 list — all 3 processes online, restart count stable
[ ] send a LINE message — bot replies
```

### Other improvements
- Verify `git remote` on the server matches `JodPdo` before relying on auto-deploy.
- Make `deploy.sh` NOT touch `.env` (confirm it doesn't).
- Add an `aiklao_mb` GitHub Actions test job.
- Consider a staging environment (separate DB + subdomain) before scaling.

---

## 7. Scalability Improvements (future)

- Read replica or managed PostgreSQL when trip/location volume grows.
- Move location ingestion to a queue (server-side) if write volume spikes.
- Separate the VPS into app + DB hosts.
- CDN for LIFF static assets.
- Horizontal scale `aiklao_mb` behind nginx upstream if mobile traffic dominates.

---

## 8. Suggested Future Features (post-5.6)

- Trip replay / history playback.
- Geofence alerts (notify when a member enters/leaves an area).
- ETA sharing to non-members via the Share View.
- Multi-language UI (TH/EN) in the mobile app.
- Admin dashboard (`aiklao_admin`) for support.
- Analytics on trip patterns.

---

## 9. Current Task Board (snapshot)

| ID | Task | Priority | Status |
|----|------|----------|--------|
| IMM-1 | Sync local ↔ server | P1 | **DONE 2026-05-26** (commit `d7b14b4` on develop) |
| IMM-2 | Fix aiklao_mb microservice | P1 | **DONE 2026-05-26** (Path A — adopted main's scaffold via merge `52a1282`) |
| IMM-3 | aiklao_mb in PM2 config | P1 | **DONE 2026-05-26** (ecosystem.config.js + deploy.yml + deploy.sh + pino-http; v0.1.14 live at `71aeab9`) |
| IMM-4 | Remove dead mobile code from aiklao_be | P2 | TODO |
| IMM-5 | Deploy checklist | P2 | TODO |
| IMM-6 | Verify backup cron | P2 | TODO |
| IMM-7 | Write phase docs | P2 | TODO |
| P0-1 | Rotate secrets | P0 | DEFERRED (before launch) |
| P0-2 | SSH key-only | P0 | TODO |
| 5.2 | Foreground location + map | — | NEXT PHASE |
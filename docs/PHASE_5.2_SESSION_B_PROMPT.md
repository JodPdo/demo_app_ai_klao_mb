# Phase 5.2 Session B — Backend Implementation Prompt

> Implement the 5 mobile trip endpoints in `aiklao_mb`, with tests, then deploy via the Taskfile release flow.
> Plan-Verify-Execute discipline. STOP after plan; wait for review before any code.

---

You are continuing as the senior production engineer for AiKlao Bot.

## Current state

Cleanup phase fully completed earlier today (2026-05-26):

- ✅ IMM-1: Sync local ↔ server
- ✅ IMM-1.5: Update PROJECT_MEMORY.md
- ✅ IMM-2: Lightweight scaffold for `aiklao_mb`
- ✅ IMM-3: `ecosystem.config.js` + deploy automation (live at `71aeab9` v0.1.14)
- ✅ Step H: resurrect verified
- ✅ IMM-4: no-op (already clean)

Phase 5.2 Session A also done — design doc shipped:
`C:\Users\claw\Documents\Claude\Projects\aiklao\PHASE_5.2_DESIGN.md`

This Session B implements the **backend half** of Phase 5.2 — 5 new endpoints in `aiklao_mb`.

## Pre-reads (mandatory, in this order)

1. `C:\Users\claw\Documents\Claude\Projects\aiklao\PHASE_5.2_DESIGN.md` — **canonical spec for this session**. All 5 endpoints have request/response/error/SQL drafted. Do not deviate without explicit user approval.
2. `C:\Users\claw\Documents\Claude\Projects\aiklao\API_REFERENCE.md` — existing endpoint patterns (especially `/api/mobile/auth`, `/api/mobile/me`, and `/api/trip/...` LIFF endpoints) to mirror style.
3. `C:\Users\claw\Documents\Claude\Projects\aiklao\DATABASE_SCHEMA.md` — table reference for `trips`, `members`, `locations`, `users`.
4. `C:\Users\claw\Documents\Claude\Projects\aiklao\PROJECT_MEMORY.md` — current infrastructure truth (verified 2026-05-26).
5. `C:\Users\claw\Documents\Claude\Projects\aiklao\KNOWN_ISSUES.md` — context.
6. `C:\Users\claw\Documents\Claude\Projects\aiklao\TODO_ROADMAP.md` — Session log 2026-05-26 (lots of context from today's cleanup).

## Pre-investigation (server + local clone)

You do NOT have shell access. Request the user to run these and paste output:

### Server-side (ssh `root@162.141.142.154`)
```bash
echo "=== aiklao_mb routes structure ===" && \
ls -la /var/www/aiklao_mb/demo_app_ai_klao_mb/routes/ && \
echo "=== aiklao_mb middleware ===" && \
ls -la /var/www/aiklao_mb/demo_app_ai_klao_mb/middleware/ && \
echo "=== aiklao_mb lib ===" && \
ls -la /var/www/aiklao_mb/demo_app_ai_klao_mb/lib/ && \
echo "=== aiklao_mb tests ===" && \
ls -la /var/www/aiklao_mb/demo_app_ai_klao_mb/tests/ 2>/dev/null || echo "no tests dir on server" && \
echo "=== server.js mount points ===" && \
grep -nE "app\\.use|app\\.(get|post|put|delete|patch)" /var/www/aiklao_mb/demo_app_ai_klao_mb/server.js && \
echo "=== verify trips table schema ===" && \
sudo -u postgres psql -d aiklao_db -c "\\d trips" && \
echo "=== verify members table schema ===" && \
sudo -u postgres psql -d aiklao_db -c "\\d members" && \
echo "=== verify locations table schema ===" && \
sudo -u postgres psql -d aiklao_db -c "\\d locations" && \
echo "=== current pm2 + commit ===" && \
pm2 list --no-color && \
cd /var/www/aiklao_mb/demo_app_ai_klao_mb && git log --oneline -3
```

This confirms `trips.status` actually exists (design doc inferred from queries — need empirical confirmation), and surfaces any other schema gaps before we write SQL.

### Local-side (Git Bash on local clone)
```bash
cd ~/Desktop/clone-form-git-Project/aiklao_mb_local
git status
git branch --show-current
git log --oneline -3
git remote -v
```

Should be: clean tree, on `main` (or `develop` if switched), JodPdo remote.

### Distance utility check
```bash
# Does aiklao_be have a Haversine util we should copy/reuse?
grep -rln "haversine\|toRadians\|distance_km" /var/www/aiklao_be/demo_app_ai_klao_be/utils/ /var/www/aiklao_be/demo_app_ai_klao_be/lib/ /var/www/aiklao_be/demo_app_ai_klao_be/services/ 2>/dev/null | head -5
```

If yes, we'll copy the function into `aiklao_mb/utils/distance.js` (small, ~20 lines, no need to extract a shared package yet).

## Critical constraints

1. **Read-only deploy key on server** — all commits originate from local clone at `C:\Users\claw\Desktop\clone-form-git-Project\aiklao_mb_local`. Never commit on server.

2. **Branch flow** — work on `develop`, then `task patch-release` → `task push-release` to merge to `main`. GitHub Actions deploys via `deploy.yml` → `deploy.sh` → `pm2 reload aiklao_mb`. This flow is now correct (verified 2026-05-26).

3. **Production blip during deploy** — `pm2 reload aiklao_mb` causes ~5-10s mobile auth blip. LINE bot (aiklao_be) is unaffected. Acceptable for low-traffic mobile use.

4. **Apply hard-won lessons from IMM-3:**
   - Before push: verify every external `require()` resolves against `package.json` dependencies. Missing `pino-http` cost us a 502 outage.
   - If you add any new `require("some-pkg")`, run `node -e "require('some-pkg')"` to confirm it's installable before commit.
   - `pm2 reload` does NOT revive a process in "waiting restart" state — if deploy breaks aiklao_mb badly, `git revert HEAD && git push origin main` is the rollback path (Level 2).

5. **JWT context** — every new endpoint must use the existing `jwtAuth` middleware. `req.user = { id, lineUserId, displayName }` is what the routes see.

6. **Tests are gating** — Taskfile's `is-branch-clean` and `npm test` MUST pass before push-release. Current test count baseline: 236 tests across 9 suites. New tests for `mobileTrips.js` should bring it up to ~250+.

## Your task (in order, STOP after step 6)

### Step 1: Inspect & confirm
- Wait for the user to paste the pre-investigation output
- Confirm `trips.status` column exists with `text` type
- Confirm `members.is_leader` and `members.line_user_id` exist
- Confirm `locations.member_id` is the FK (not user_id)
- Confirm `routes/` contents in aiklao_mb (should be `mobileAuth.js`, `mobileMe.js`, `oauthCallback.js`)
- Confirm aiklao_be has a Haversine util to reuse OR plan to write one fresh (~20 lines)

If any DB column is missing or differs from PHASE_5.2_DESIGN.md, STOP and report — do not silently work around it.

### Step 2: Propose the new files (full content)
Return the FULL content of:
- `routes/mobileTrips.js` (the 5 endpoints)
- `utils/distance.js` (Haversine helper)
- `tests/routes/mobileTrips.test.js` (Jest tests)
- The DIFF of `server.js` showing the new `app.use("/api/mobile/trips", jwtAuth, mobileTripsRoutes);` mount and the `const mobileTrips = require("./routes/mobileTrips");` require

No partial snippets. Whole files only.

For each endpoint, explain in 1-2 sentences:
- Which SQL pattern from the design doc you used
- Any deviation from the design doc and why (or "no deviation")
- Error paths covered

### Step 3: Propose tests strategy
- What does each test verify?
- How are DB interactions mocked (or do tests use a real test DB)?
- What baseline test pattern from `aiklao_mb` are you following? (Read `tests/server.test.js` and any existing route test for the style.)

Goal: tests must pass `npm test` cleanly AND meaningfully cover happy path + auth + forbidden + 400/404 cases for each new endpoint.

### Step 4: Propose deployment sequence
Each step needs: Goal | Exact commands | Expected output | Rollback | Verification.

The sequence:
- (a) Snapshot — `pm2 save` on server, tar the existing routes/ files
- (b) Local edit + commit on `develop` + push
- (c) Local `npm test` — confirm all green (existing 236 + new ones)
- (d) `task patch-release` (bumps to v0.1.15)
- (e) `task push-release` (merges develop→main, push, GH Actions fires)
- (f) Wait ~90 seconds for deploy
- (g) Server verification — `pm2 list`, `pm2 logs aiklao_mb --lines 30 --nostream`, 5 new curl checks (one per endpoint)
- (h) Database verification — `SELECT * FROM trips WHERE id = <new id>` after a curl `POST /trips/start`

### Step 5: Risk flags
- New `require()`s added — list them and confirm they're in `package.json`
- Any change to existing endpoints (should be NONE — pure addition)
- Any test that might be flaky (timing, network)
- Confirm `distance_km` calculation handles `dest_lat/lng = NULL` (when destination is omitted in `POST /trips/start`) — should default to `NULL` in the INSERT, not crash

### Step 6: STOP
Present the plan. Wait for user review and approval before executing.

## Scope (strict)

- Modify ONLY the `aiklao_mb` repo (server.js + new files)
- DO NOT touch `aiklao_be` or `aiklao_fe` configs or code
- DO NOT modify database schema — design doc confirms no migration 010 needed for MVP
- DO NOT add new top-level dependencies unless absolutely necessary (Haversine fits in ~20 lines; don't `npm install` a distance package)
- DO NOT modify existing endpoint behavior (`/api/mobile/auth`, `/api/mobile/me`, `/api/mobile/oauth/callback`) — pure addition only
- DO NOT change JWT contract, env var names, or ecosystem.config.js
- DO NOT modify `tests/server.test.js` (the existing one) unless a new test ALSO needs the export pattern to change

## Rules

- Follow the design doc contracts EXACTLY for request/response/error shapes. If you think the doc is wrong, flag separately — do not unilaterally "improve" it.
- Use the existing logger pattern (`logger.info({ reqId, ... }, "msg")`) consistently with other aiklao_mb routes.
- DB queries: use parameterized queries via `db.query("... $1 ...", [val])`. NEVER string-concat user input into SQL.
- Transactions for `POST /trips/start` (multi-statement). Use `BEGIN; ... COMMIT;` or the existing pool transaction helper if one exists.
- Error responses: consistent JSON `{ "error": "<machine_readable_code>" }` shape. Match the existing aiklao_mb pattern (see `routes/mobileAuth.js` for reference).
- HTTP status codes per design doc — 200/201/204 as appropriate, 400/401/403/404/409/500 with the documented `error` codes.
- For `POST /trips/start` defaults from design doc: destination optional, trip name defaults to "My Trip YYYY-MM-DD" (Asia/Bangkok timezone). User can override either at execution time.
- For `POST /trips/:id/location`: compute `distance_km` only if `trips.dest_lat/lng` is non-null; otherwise insert NULL.
- For `POST /trips/:id/stop`: distinguish 403 not_leader vs 404 trip_not_found vs 409 already_archived with a follow-up SELECT (don't ambiguously return 403 for all "no rows updated" cases).

## Expected deliverable

A single response containing:

1. Inspection confirmation (or surface any schema gap)
2. Full content of `routes/mobileTrips.js`
3. Full content of `utils/distance.js`
4. Full content of `tests/routes/mobileTrips.test.js`
5. Diff of `server.js` (just the require + mount lines)
6. Test strategy summary
7. Deployment sequence (Steps a-h above) with rollback per step
8. Risk flags
9. Effort estimate

Then STOP and wait for review. Do not write any files or run any commands beyond the read-only inspection until approved.
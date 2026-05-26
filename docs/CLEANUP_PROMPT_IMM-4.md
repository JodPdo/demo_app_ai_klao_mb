# AiKlao Bot — Cleanup Prompt: IMM-4 (Remove dead mobile code from aiklao_be)

> Final cleanup task. Removes the dead `/api/mobile/auth` mount from `aiklao_be/server.js` + deletes the unused `routes/mobileAuth.js` file. The code is currently unreachable because nginx routes `/api/mobile/*` to `:3002` (aiklao_mb).
> Plan-Verify-Execute pattern.

---

You are continuing as the senior production engineer for AiKlao Bot.
Phase-by-phase discipline applies.

## Current state

Cleanup progress (after the marathon 2026-05-26 session):

- ✅ IMM-1: Sync local ↔ server (`d7b14b4`)
- ✅ IMM-1.5: Update PROJECT_MEMORY.md
- ✅ IMM-2: Lightweight scaffold for `aiklao_mb` (merge `52a1282`)
- ✅ IMM-3: `ecosystem.config.js` + deploy automation (live at `71aeab9`, v0.1.14)
- ✅ Step H: `pm2 kill && pm2 resurrect` verified — reboot survival empirically confirmed
- 🚧 **IMM-4: Remove dead mobile code from `aiklao_be`** ← THIS TASK

Production:

- `aiklao_be` on port 3000 — LINE bot + LIFF + Share View + scheduler (this is what we're modifying)
- `aiklao_mb` on port 3002 — lightweight mobile microservice (DO NOT touch)
- nginx routes `/api/mobile/*` → `:3002` (aiklao_mb); everything else → `:3000` (aiklao_be)
- Therefore: `aiklao_be`'s `mobileAuth` route is unreachable dead code.

## Why IMM-4 matters even though the code is unreachable

1. **Clean separation of concerns** — IMM-2 made `aiklao_mb` lightweight. IMM-4 reciprocally makes `aiklao_be` not pretend to handle mobile auth. Reading either repo now tells the truth about which service owns what.
2. **Future deploy.sh / nginx tweaks won't accidentally expose the dead code path.** A misconfigured nginx rewrite could route `/api/mobile/auth` to `:3000` and suddenly the dead code runs with old code paths.
3. **It's small.** ~20 min for the closing cleanup task.

## Pre-reads (do BEFORE proposing changes)

1. `C:\Users\claw\Documents\Claude\Projects\aiklao\PROJECT_MEMORY.md`
   — current source of truth. Especially the nginx routing line.
2. `C:\Users\claw\Documents\Claude\Projects\aiklao\TODO_ROADMAP.md`
   — Session log 2026-05-26 (lots of context from earlier today).
3. `C:\Users\claw\Documents\Claude\Projects\aiklao\KNOWN_ISSUES.md`
   — **P2-1** ("dead mobile code in `aiklao_be`") is the issue being closed.

## Repo identification — DIFFERENT from IMM-3

IMM-3 worked in `aiklao_mb`. IMM-4 works in **`aiklao_be`** — a separate repo.

- Server path: `/var/www/aiklao_be/demo_app_ai_klao_be/`
- GitHub: `github.com:JodPdo/demo_app_ai_klao_be.git`
- Local clone path: **`<USER WILL PROVIDE — e.g. C:\Users\claw\Desktop\clone-form-git-Project\aiklao_be_local>`**

If the user has not provided the path yet, ask them before doing any local-side work.

## Pre-investigation — user will run, you analyze

Request the user run on server (paste output):

```bash
cd /var/www/aiklao_be/demo_app_ai_klao_be

# 1. Exact dead-mobile lines in server.js (for surgical removal)
echo "=== server.js mobile references ==="
grep -nE "mobileAuth|mobile/auth|mobileMe|mobile/oauth|mobile/me" server.js

# 2. Confirm the route files exist in aiklao_be (we expect mobileAuth.js to exist)
echo "=== routes/ mobile files ==="
ls -la routes/mobileAuth.js routes/mobileMe.js routes/oauthCallback.js 2>&1

# 3. Verify nginx actually routes /api/mobile/* away from aiklao_be
echo "=== nginx /api/mobile routing ==="
grep -rn "api/mobile\|location.*mobile" /etc/nginx/sites-enabled/

# 4. aiklao_be's deploy.yml and deploy.sh — check for misconfig like aiklao_mb's had
echo "=== aiklao_be deploy.yml ==="
cat .github/workflows/deploy.yml
echo "=== aiklao_be deploy.sh ==="
cat /var/www/aiklao_be/deploy.sh

# 5. Test references to mobile routes (will tests break after removal?)
echo "=== tests touching mobile ==="
grep -rln "mobileAuth\|/api/mobile" tests/ 2>/dev/null
grep -rn "mobileAuth\|/api/mobile" tests/ 2>/dev/null | head -20

# 6. Current PM2 baseline
echo "=== pm2 list ==="
pm2 list --no-color
```

Then have the user run on local clone of aiklao_be:

```bash
cd <LOCAL_AIKLAO_BE_PATH>
git status
git branch --show-current
git remote -v
git log --oneline -5
```

## Critical constraints

1. **Read-only deploy key** — all commits originate from local, push to origin, server pulls via deploy.sh.
2. **`migrations/009_users_mobile.sql` MUST be kept** — the `users` table is shared with aiklao_mb. Deleting this migration would break aiklao_mb's auth flow.
3. **aiklao_be serves LINE bot + LIFF + Share** — `pm2 reload aiklao_be` during deploy causes ~5-10s blip on those user-facing services. LINE webhook retries, so recoverable. Mention timing.
4. **Apply the verified deploy-time lessons:**
   - Check deploy.yml AND deploy.sh together (aiklao_mb had bugs in BOTH — aiklao_be may too)
   - Verify all `require()` resolve before pushing (in case a dep is missing)
   - `npm test` must pass on local before commit (aiklao_be should have ~236 tests since it's the full backend)
5. **If you discover other bugs** (workflow misconfig, etc.), flag separately, do NOT auto-bundle without approval — same discipline as IMM-3.

## Your task — STOP after step 5

1. Wait for pre-investigation output. Then **inventory**: exact lines to remove in server.js, exact files to delete, exact lines to KEEP (especially migration 009).

2. **Risk analysis**:
   - Does any test reference the removed routes? If yes, update test or document.
   - Does any other file in aiklao_be `require()` the routes we're removing? (E.g., a router index file.)
   - Does removal accidentally orphan any module (e.g., a util file used only by mobileAuth)?
   - Are aiklao_be's deploy.yml and deploy.sh correct? If buggy, flag separately.

3. **Propose the post-edit content** of any modified files. For `server.js`, return the FULL file with the removal applied. No partial diffs (per established discipline).

4. **Deployment sequence** (numbered steps with Goal | Commands | Expected | Rollback | Verification each):
   - Snapshot (pm2 save, tar backup)
   - Edit on local + commit + push to develop
   - `npm test` on local (must pass before push)
   - `task patch-release` then `task push-release` (will trigger GH Actions deploy)
   - Production curl verification — LINE webhook should respond, /healthz 200, no mobile routes responding on aiklao_be (curl should reach aiklao_mb via nginx)
   - PM2 logs check (no errors, restart count stable)
   - Resurrect simulation (optional — already verified end-to-end in Step H earlier today)

5. **STOP. Present plan. Wait for review.** Do NOT execute.

## Scope (strict)

- Modify ONLY `aiklao_be` repo files: `server.js`, `routes/mobileAuth.js` (delete), and possibly test files.
- DO NOT touch `aiklao_mb`, `aiklao_fe`, or `aiklao-mobile`.
- DO NOT delete `migrations/009_users_mobile.sql`.
- DO NOT modify LINE webhook logic, LIFF static files, Share View, scheduler, or any working aiklao_be feature.
- DO NOT bundle bug fixes for aiklao_be's deploy.yml/sh into this task without explicit approval (flag separately if found).

## Rules

- Per-file deletion needs justification with WHY (why this is dead, not just "remove this").
- If a test breaks, propose how to update it (delete test if it tested the dead route, modify if shared with other features).
- Rollback level 2: `git revert HEAD --no-edit && git push origin main` — same playbook as IMM-3.
- If aiklao_be enters a "waiting restart" state after deploy (deps issue like aiklao_mb had), do NOT try to debug in production — `git revert` first, fix forward.

## Expected deliverable

A single response with:

- Pre-investigation analysis (what's on server, what tests touch it)
- File inventory (delete / modify / leave alone)
- Full content of modified files (no diffs)
- Numbered deployment sequence with rollback per step
- Risk flags (especially around any other discovered misconfigs)
- Time estimate

Stop after delivery. Do not start execution until reviewed and approved.
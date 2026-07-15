#!/usr/bin/env node
"use strict";

/**
 * scripts/delete-user.js — PDPA "delete on request" tool (admin-run CLI).
 *
 * Removes ALL of one person's identity + personal data from the shared
 * PostgreSQL database used by BOTH backends (aiklao_mb_local + demo_app_ai_klao_be).
 * There is intentionally NO public/HTTP endpoint for this — it is a manual,
 * id-gated, dry-run-by-default script that an operator runs after verifying a
 * request and backing up the DB.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * DELETION POLICY (matches the privacy policy §6/§8)
 * ──────────────────────────────────────────────────────────────────────────
 * A person is identified by their LINE user id (members + sessions key off the
 * TEXT `line_user_id`) and, if they ever signed into the mobile app, by their
 * numeric `users.id`. We accept either and resolve the other.
 *
 * DELETE (their identity + personal data):
 *   - users            (the account row;       by users.id)
 *   - members          (their trip memberships; by line_user_id)
 *       └─ locations, safety_alerts            cascade via members.id FK
 *   - sos_events       (events they triggered;  by user_id)
 *   - aiklao_liff_sessions (web-login sessions; by line_user_id)
 *   - trip_invites they created (see note below; by created_by_member_id)
 *
 * NULL-OUT (references that should survive, anonymised):
 *   - sos_events.cancelled_by   (FK→users, RESTRICT, nullable)  → explicit NULL
 *   - user_roles.granted_by     (FK→users, RESTRICT, nullable)  → explicit NULL
 *   - share_tokens.created_by   (FK→members ON DELETE SET NULL) → automatic
 *   - audit_log.user_id         (FK→users   ON DELETE SET NULL) → automatic
 *   - content_sections.published_by / updated_by
 *                               (FK→users   ON DELETE SET NULL) → automatic
 *   - user_roles (own) / admin_sessions
 *                               (FK→users   ON DELETE CASCADE)  → automatic
 *
 * TRIPS: a trip is shared data. We NEVER delete a trip that still has OTHER
 * members. After removing this person's membership, any trip left with ZERO
 * members is an orphan and is deleted (its remaining trip-scoped rows cascade:
 * notification_settings, share_tokens, sos_events, trip_invites; push_log SET NULL).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * FK MAP verified against migrations (Node 001–013 + Java V011/V013/V014/V012).
 * Two spots required deviating from a naive "just NULL it" approach:
 *   • trip_invites.created_by_member_id → members(id) is NO ACTION (RESTRICT) and
 *     NOT NULL — it CANNOT be nulled. We DELETE the invites this person created.
 *   • sos_events.user_id → users(id) is RESTRICT and NOT NULL — cannot be nulled,
 *     so we DELETE the person's own sos_events before deleting the users row.
 * Everything blocking is handled explicitly, in FK-safe order, inside one tx.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * USAGE
 *   node scripts/delete-user.js --lineUserId=U1234...        # DRY RUN (default)
 *   node scripts/delete-user.js --userId=42                  # DRY RUN
 *   node scripts/delete-user.js --lineUserId=U1234... --confirm   # EXECUTE
 *
 * Default mode is a DRY RUN: it prints what WOULD change and the trip keep/delete
 * list, and writes NOTHING. Pass --confirm to actually execute (single tx,
 * rolls back on any error). Refuses to run with no id.
 */

const SELF = "scripts/delete-user.js";

function parseArgs(argv) {
  const out = { confirm: false, help: false };
  for (const a of argv) {
    if (a === "--confirm") out.confirm = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--lineUserId=")) out.lineUserId = a.slice(13).trim();
    else if (a.startsWith("--userId=")) out.userId = a.slice(9).trim();
  }
  return out;
}

function usage() {
  console.log(
    `\nDelete a user's data (PDPA request). DRY RUN unless --confirm is given.\n\n` +
      `  node ${SELF} --lineUserId=<LINE id> [--confirm]\n` +
      `  node ${SELF} --userId=<numeric users.id> [--confirm]\n`
  );
}

async function count(db, sql, params) {
  const r = await db.one(sql, params);
  return Number(r ? r.n : 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    usage();
    process.exit(0);
  }

  // Refuse to run without an explicit id — never operate on "everyone".
  if (!args.lineUserId && !args.userId) {
    console.error("❌ Refusing to run: provide --lineUserId=<id> or --userId=<n>.");
    usage();
    process.exit(1);
  }
  if (args.userId && !/^\d+$/.test(args.userId)) {
    console.error(`❌ --userId must be a positive integer (got "${args.userId}").`);
    process.exit(1);
  }

  // Require db only AFTER arg validation (require() throws if DATABASE_URL unset).
  const db = require("../lib/db");
  const logger = require("../lib/logger");

  const mode = args.confirm ? "EXECUTE" : "DRY RUN";
  console.log(`\n🔐 AiKlao data-deletion — mode: ${mode}`);

  try {
    // ── Resolve the subject: definitive lineUserId + optional numeric users.id ──
    let userRow = null;
    if (args.userId) {
      userRow = await db.one(
        `SELECT id, line_user_id, display_name, is_admin FROM users WHERE id = $1`,
        [args.userId]
      );
      if (!userRow) {
        console.error(`❌ No users row with id=${args.userId}. Nothing resolved.`);
        process.exit(1);
      }
    } else {
      userRow = await db.one(
        `SELECT id, line_user_id, display_name, is_admin FROM users WHERE line_user_id = $1`,
        [args.lineUserId]
      );
    }

    const lineUserId = args.lineUserId || (userRow && userRow.line_user_id);
    const userId = userRow ? Number(userRow.id) : null; // may be null: LIFF/group-only person

    if (!lineUserId) {
      console.error("❌ Could not resolve a line_user_id. Aborting.");
      process.exit(1);
    }

    console.log(`   line_user_id : ${lineUserId}`);
    console.log(`   users.id     : ${userId ?? "(none — no mobile account row)"}`);
    if (userRow) {
      console.log(`   display_name : ${userRow.display_name}`);
      console.log(`   is_admin     : ${userRow.is_admin}`);
    }

    // ── Gather the person's members + affected trips (drives cascade + orphan calc) ──
    const members = await db.many(
      `SELECT id, trip_id, display_name FROM members WHERE line_user_id = $1 ORDER BY trip_id`,
      [lineUserId]
    );
    const memberIds = members.map((m) => Number(m.id));
    const affectedTripIds = [...new Set(members.map((m) => Number(m.trip_id)))];

    // ── Trip keep/delete classification (computed from current data; safe pre-tx) ──
    const affectedTrips = affectedTripIds.length
      ? await db.many(
          `SELECT t.id, t.name, t.status,
                  (SELECT count(*) FROM members m WHERE m.trip_id = t.id)                     AS total_members,
                  (SELECT count(*) FROM members m WHERE m.trip_id = t.id AND m.line_user_id <> $1) AS other_members
             FROM trips t
            WHERE t.id = ANY($2::bigint[])
            ORDER BY t.id`,
          [lineUserId, affectedTripIds]
        )
      : [];
    const orphanTrips = affectedTrips.filter((t) => Number(t.other_members) === 0);
    const keptTrips = affectedTrips.filter((t) => Number(t.other_members) > 0);

    // ── Count what WOULD change, per table ──
    const memberScope = `member_id = ANY($1::bigint[])`;
    const c = {
      "users (delete)": userId ? 1 : 0,
      "members (delete)": members.length,
      "locations (cascade ← members)": memberIds.length
        ? await count(db, `SELECT count(*)::int AS n FROM locations WHERE ${memberScope}`, [memberIds])
        : 0,
      "safety_alerts (cascade ← members)": memberIds.length
        ? await count(db, `SELECT count(*)::int AS n FROM safety_alerts WHERE ${memberScope}`, [memberIds])
        : 0,
      "trip_invites they created (delete)": memberIds.length
        ? await count(db, `SELECT count(*)::int AS n FROM trip_invites WHERE created_by_member_id = ANY($1::bigint[])`, [memberIds])
        : 0,
      "share_tokens.created_by (→ NULL, auto)": memberIds.length
        ? await count(db, `SELECT count(*)::int AS n FROM share_tokens WHERE created_by = ANY($1::bigint[])`, [memberIds])
        : 0,
      "aiklao_liff_sessions (delete)": await count(
        db,
        `SELECT count(*)::int AS n FROM aiklao_liff_sessions WHERE line_user_id = $1`,
        [lineUserId]
      ),
      "sos_events own (delete)": userId
        ? await count(db, `SELECT count(*)::int AS n FROM sos_events WHERE user_id = $1`, [userId])
        : 0,
      "sos_events.cancelled_by (→ NULL)": userId
        ? await count(db, `SELECT count(*)::int AS n FROM sos_events WHERE cancelled_by = $1`, [userId])
        : 0,
      "user_roles own (cascade, auto)": userId
        ? await count(db, `SELECT count(*)::int AS n FROM user_roles WHERE user_id = $1`, [userId])
        : 0,
      "user_roles.granted_by (→ NULL)": userId
        ? await count(db, `SELECT count(*)::int AS n FROM user_roles WHERE granted_by = $1`, [userId])
        : 0,
      "admin_sessions (cascade, auto)": userId
        ? await count(db, `SELECT count(*)::int AS n FROM admin_sessions WHERE user_id = $1`, [userId])
        : 0,
      "audit_log.user_id (→ NULL, auto)": userId
        ? await count(db, `SELECT count(*)::int AS n FROM audit_log WHERE user_id = $1`, [userId])
        : 0,
      "content_sections.published_by (→ NULL, auto)": userId
        ? await count(db, `SELECT count(*)::int AS n FROM content_sections WHERE published_by = $1`, [userId])
        : 0,
      "content_sections.updated_by (→ NULL, auto)": userId
        ? await count(db, `SELECT count(*)::int AS n FROM content_sections WHERE updated_by = $1`, [userId])
        : 0,
    };

    console.log("\n📋 Rows that would be DELETED / NULLED:");
    console.table(c);

    console.log("\n🚗 Affected trips:");
    if (affectedTrips.length === 0) {
      console.log("   (none — user has no memberships)");
    } else {
      console.table(
        affectedTrips.map((t) => ({
          trip_id: Number(t.id),
          name: t.name,
          status: t.status,
          total_members: Number(t.total_members),
          other_members: Number(t.other_members),
          action: Number(t.other_members) === 0 ? "🗑  ORPHAN → DELETE" : "✅ GROUP → KEEP",
        }))
      );
    }
    console.log(`   group-kept: ${keptTrips.length} · orphan-deleted: ${orphanTrips.length}`);

    if (c["members (delete)"] === 0 && c["aiklao_liff_sessions (delete)"] === 0 && !userId) {
      console.log("\nℹ️  No data found for this id. Nothing to do.");
      await db.close();
      process.exit(0);
    }

    // ── DRY RUN: stop here, change nothing ──
    if (!args.confirm) {
      console.log("\n🟡 DRY RUN — no changes made. Re-run with --confirm to execute.");
      await db.close();
      process.exit(0);
    }

    // ── EXECUTE: single transaction, FK-safe order, rollback on any error ──
    console.log("\n🔴 EXECUTING deletion in a single transaction…");
    const result = await db.tx(async (q) => {
      const out = {};

      // 1. Unblock member deletion: trip_invites.created_by_member_id is RESTRICT + NOT NULL.
      if (memberIds.length) {
        out.trip_invites_deleted = (
          await q(`DELETE FROM trip_invites WHERE created_by_member_id = ANY($1::bigint[])`, [memberIds])
        ).rowCount;
        logger.info({ n: out.trip_invites_deleted, lineUserId }, "[delete-user] trip_invites deleted");
      }

      // 2. Unblock users deletion: sos_events.user_id RESTRICT+NOT NULL; cancelled_by/granted_by RESTRICT.
      if (userId) {
        out.sos_events_deleted = (await q(`DELETE FROM sos_events WHERE user_id = $1`, [userId])).rowCount;
        out.sos_cancelled_by_nulled = (
          await q(`UPDATE sos_events SET cancelled_by = NULL WHERE cancelled_by = $1`, [userId])
        ).rowCount;
        out.user_roles_granted_by_nulled = (
          await q(`UPDATE user_roles SET granted_by = NULL WHERE granted_by = $1`, [userId])
        ).rowCount;
        logger.info(
          {
            sos: out.sos_events_deleted,
            cancelledBy: out.sos_cancelled_by_nulled,
            grantedBy: out.user_roles_granted_by_nulled,
          },
          "[delete-user] user-id references cleared"
        );
      }

      // 3. Delete memberships → cascades locations + safety_alerts; SET NULL share_tokens.created_by.
      out.members_deleted = (await q(`DELETE FROM members WHERE line_user_id = $1`, [lineUserId])).rowCount;
      logger.info({ n: out.members_deleted, lineUserId }, "[delete-user] members deleted (locations/safety_alerts cascaded)");

      // 4. Delete orphaned trips ONLY — guarded so a trip with any remaining member is never touched.
      if (affectedTripIds.length) {
        out.trips_deleted = (
          await q(
            `DELETE FROM trips
               WHERE id = ANY($1::bigint[])
                 AND NOT EXISTS (SELECT 1 FROM members m WHERE m.trip_id = trips.id)`,
            [affectedTripIds]
          )
        ).rowCount;
        logger.info({ n: out.trips_deleted }, "[delete-user] orphaned trips deleted");
      }

      // 5. Delete web-login sessions.
      out.liff_sessions_deleted = (
        await q(`DELETE FROM aiklao_liff_sessions WHERE line_user_id = $1`, [lineUserId])
      ).rowCount;

      // 6. Delete the account row → cascades user_roles + admin_sessions; SET NULL audit_log + content_sections.
      if (userId) {
        out.users_deleted = (await q(`DELETE FROM users WHERE id = $1`, [userId])).rowCount;
        logger.info({ userId }, "[delete-user] users row deleted (roles/sessions cascaded, audit anonymised)");
      }

      return out;
    });

    console.log("\n✅ Deletion committed:");
    console.table(result);
    console.log(
      `   trips: ${orphanTrips.length} orphan-deleted, ${keptTrips.length} group-kept (other members preserved).`
    );

    await db.close();
    process.exit(0);
  } catch (err) {
    logger.error({ err: err.message }, "[delete-user] FAILED — transaction rolled back");
    console.error(`\n❌ FAILED (rolled back): ${err.message}`);
    try {
      await db.close();
    } catch (_) {
      /* ignore */
    }
    process.exit(1);
  }
}

main();

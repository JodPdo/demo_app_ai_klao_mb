// PostgreSQL pool + thin async helpers
// v3.2: เพิ่ม tx() helper สำหรับ atomic operations (reset trip ต้องใช้ transaction)

require("dotenv").config();

const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const logger = require("./logger");

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    "postgresql://aiklao_user:kPsUmHMwc5EXbEZ45tYg@localhost:5432/aiklao_db";
  logger.warn("DATABASE_URL not set — using local default");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.PG_POOL_MAX || "10", 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl:
    process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

pool.on("error", (err) => {
  logger.error({ err: err.message }, "🔥 unexpected pg pool error");
});

const SLOW_QUERY_MS = parseInt(process.env.SLOW_QUERY_MS || "300", 10);

async function query(sql, params = []) {
  const start = Date.now();
  try {
    const result = await pool.query(sql, params);
    const ms = Date.now() - start;
    if (ms > SLOW_QUERY_MS) {
      logger.warn(
        { ms, sql: sql.slice(0, 120).replace(/\s+/g, " ") },
        "slow query"
      );
    }
    return result;
  } catch (err) {
    logger.error(
      { err: err.message, sql: sql.slice(0, 200).replace(/\s+/g, " ") },
      "query failed"
    );
    throw err;
  }
}

async function one(sql, params = []) {
  const r = await query(sql, params);
  return r.rows[0] || null;
}

async function many(sql, params = []) {
  const r = await query(sql, params);
  return r.rows;
}

// alias สำหรับโค้ดเก่าที่อ้าง oneOrNone
async function oneOrNone(sql, params = []) {
  return one(sql, params);
}

/**
 * 🔥 v3.2: Transaction helper
 * ใช้สำหรับ operation ที่ต้อง atomic เช่น resetTrip:
 *   await db.tx(async (q) => {
 *     await q('DELETE FROM locations WHERE trip_id = $1', [tripId]);
 *     await q('UPDATE trips SET dest_lat = NULL WHERE id = $1', [tripId]);
 *   });
 */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const q = (sql, params = []) => client.query(sql, params);
    const result = await fn(q);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err: err.message }, "tx rolled back");
    throw err;
  } finally {
    client.release();
  }
}

async function init() {
  const migrationsDir = path.join(__dirname, "../migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    await pool.query(sql);
    logger.info({ file }, "✅ migration applied");
  }
}

async function close() {
  await pool.end();
}

module.exports = { query, one, many, oneOrNone, tx, init, close, pool };
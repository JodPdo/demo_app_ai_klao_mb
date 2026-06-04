// middleware/dualAuth.js
// Accepts JWT bearer (mobile app) OR aiklao_liff_session cookie (LIFF WebView).
// Used on GET endpoints that both mobile and LIFF can read.
// POST endpoints (location, start, stop) MUST keep jwtAuth — Pattern A discipline.

const jwt = require('jsonwebtoken');
const db = require('../lib/db');

const JWT_SECRET = process.env.MOBILE_JWT_SECRET;

async function dualAuth(req, res, next) {
  // 1. Try JWT Bearer (mobile app — unchanged behavior)
  const header = req.get('authorization') || '';
  const match  = header.match(/^Bearer\s+(.+)$/i);
  if (match) {
    try {
      const payload = jwt.verify(match[1], JWT_SECRET, {
        issuer: 'aiklao',
        audience: 'aiklao-mobile',
      });
      req.user = {
        id: payload.sub,
        lineUserId: payload.lineUserId,
        displayName: payload.displayName,
        source: 'mobile',
      };
      return next();
    } catch (_) { /* fall through to cookie path */ }
  }

  // 2. Try LIFF session cookie
  const sessionId = req.cookies?.aiklao_liff_session;
  if (sessionId) {
    try {
      const session = await db.oneOrNone(
        `SELECT line_user_id, display_name
           FROM aiklao_liff_sessions
          WHERE session_id = $1 AND expires_at > now()`,
        [sessionId]
      );
      if (session) {
        req.user = {
          id: null,
          lineUserId: session.line_user_id,
          displayName: session.display_name,
          source: 'liff',
        };
        return next();
      }
    } catch (_) { /* db error — treat as no session */ }
  }

  return res.status(401).json({ error: 'missing_token' });
}

module.exports = dualAuth;

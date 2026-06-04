// routes/liffInit.js
// POST /api/liff/init — exchanges LIFF accessToken for an aiklao_liff_session cookie.
// Verifies the token against LINE profile API to confirm the LINE user identity.

const express = require('express');
const crypto = require('crypto');
const db = require('../lib/db');
const logger = require('../lib/logger');

const router = express.Router();

const LINE_PROFILE_URL = 'https://api.line.me/v2/profile';
const SESSION_TTL_HOURS = 4;

router.post('/init', async (req, res) => {
  const { accessToken } = req.body || {};
  if (!accessToken || typeof accessToken !== 'string') {
    return res.status(400).json({ error: 'missing_access_token' });
  }

  try {
    // Lazy cleanup of expired sessions
    await db.query(`DELETE FROM aiklao_liff_sessions WHERE expires_at < now()`);

    // Verify accessToken against LINE profile API
    const profileRes = await fetch(LINE_PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) {
      return res.status(401).json({ error: 'invalid_liff_token' });
    }
    const profile = await profileRes.json();
    const lineUserId = profile.userId;
    const displayName = profile.displayName || null;

    if (!lineUserId) {
      return res.status(401).json({ error: 'invalid_liff_profile' });
    }

    // Create new session
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

    await db.query(
      `INSERT INTO aiklao_liff_sessions (session_id, line_user_id, display_name, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, lineUserId, displayName, expiresAt]
    );

    // Set cookie — SameSite=None + Secure required for cross-origin LIFF → API
    res.cookie('aiklao_liff_session', sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: SESSION_TTL_HOURS * 60 * 60 * 1000,
    });

    return res.json({
      ok: true,
      lineUserId,
      displayName,
    });
  } catch (err) {
    logger.error({ reqId: req.id, err: err.message }, '[liff-init] failed');
    return res.status(500).json({ error: 'liff_init_failed' });
  }
});

module.exports = router;

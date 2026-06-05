// routes/lineNotify.js
// Server-internal endpoint to trigger LINE Bot Push notifications.
// Protected by INTERNAL_SECRET shared secret header.
// Uses LINE Messaging API Push (not webhook) — avoids conflict with aiklao_be.

const express = require('express');
const crypto = require('crypto');
const logger = require('../lib/logger');
const { buildTripDetailFlex } = require('../utils/flexMessage');

const router = express.Router();

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

router.post('/line-notify', async (req, res) => {
  // Auth — constant-time shared secret comparison (SEC-003)
  if (!INTERNAL_SECRET) {
    logger.error('[line-notify] INTERNAL_SECRET not configured');
    return res.status(503).json({ error: 'internal_endpoint_disabled' });
  }

  const provided = req.get('x-internal-secret') || '';

  // GUARD: confirm INTERNAL_SECRET is a non-empty string BEFORE Buffer.from
  // (Buffer.from(undefined, 'utf8') throws at runtime)
  if (typeof INTERNAL_SECRET !== 'string' || INTERNAL_SECRET.length === 0) {
    logger.error('[line-notify] INTERNAL_SECRET invalid type or empty');
    return res.status(503).json({ error: 'internal_endpoint_disabled' });
  }

  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(INTERNAL_SECRET, 'utf8');

  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return res.status(401).json({ error: 'invalid_internal_secret' });
  }

  // Validate body
  const { lineUserId, tripId, tripName } = req.body || {};
  if (!lineUserId || typeof lineUserId !== 'string') {
    return res.status(400).json({ error: 'missing_line_user_id' });
  }
  if (!tripId || typeof tripId !== 'string') {
    return res.status(400).json({ error: 'missing_trip_id' });
  }
  if (!tripName || typeof tripName !== 'string') {
    return res.status(400).json({ error: 'missing_trip_name' });
  }

  // Channel access token check
  if (!CHANNEL_ACCESS_TOKEN) {
    logger.error('CHANNEL_ACCESS_TOKEN not set — cannot push to LINE');
    return res.status(503).json({ error: 'channel_token_missing' });
  }

  // Build and push
  try {
    const flexMessage = buildTripDetailFlex({ tripId, tripName });
    const body = {
      to: lineUserId,
      messages: [flexMessage],
    };

    const pushRes = await fetch(LINE_PUSH_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),   // SEC-004 — 5s timeout
    });

    if (!pushRes.ok) {
      const errorText = await pushRes.text().catch(() => '');
      logger.error(
        { reqId: req.id, status: pushRes.status, body: errorText },
        '[line-notify] LINE Push API failed'
      );
      return res.status(502).json({
        error: 'line_push_failed',
        upstream_status: pushRes.status,
      });
    }

    logger.info({ reqId: req.id, lineUserId, tripId }, '[line-notify] push sent');
    return res.json({ ok: true, lineUserId, tripId });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      logger.warn({ reqId: req.id }, '[line-notify] LINE push timeout (5s)');
      return res.status(504).json({ error: 'line_push_timeout' });
    }
    logger.error({ reqId: req.id, err: err.message }, '[line-notify] failed');
    return res.status(500).json({ error: 'line_notify_failed' });
  }
});

module.exports = router;

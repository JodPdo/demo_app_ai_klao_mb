// routes/liffConfig.js
// GET /api/liff/config — returns public LIFF config for the LIFF page to initialize.
// No auth required — values are public-facing.

const express = require('express');
const router = express.Router();

router.get('/config', (req, res) => {
  res.json({
    liffId: process.env.LIFF_ID,
    lineChannelId: process.env.LINE_LOGIN_CHANNEL_ID,
    appName: 'AiKlao Trip Detail',
  });
});

module.exports = router;

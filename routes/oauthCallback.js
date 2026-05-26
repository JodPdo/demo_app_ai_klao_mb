// routes/oauthCallback.js
// LINE OAuth callback handler — receives code from LINE,
// redirects to app via aiklao:// custom scheme

const express = require("express");
const logger = require("../lib/logger");

const router = express.Router();

router.get("/callback", (req, res) => {
  const { code, state, error, error_description } = req.query;

  logger.info(
    { hasCode: !!code, hasError: !!error, reqId: req.id },
    "[oauth-callback] LINE redirect received"
  );

  const params = new URLSearchParams();
  if (code) params.set("code", code);
  if (state) params.set("state", state);
  if (error) params.set("error", error);
  if (error_description) params.set("error_description", error_description);

  const appUrl = `aiklao://auth/callback?${params.toString()}`;

  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "no-store");
  res.send(`<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0;url=${appUrl}">
  <title>กำลังกลับสู่แอป AiKlao...</title>
  <style>
    body { font-family: -apple-system, sans-serif; margin: 0; min-height: 100vh;
      display: flex; align-items: center; justify-content: center; padding: 24px;
      background: linear-gradient(135deg, #0E7C66, #3DA88F); color: #fff; }
    .card { background: #fff; color: #0F1419; border-radius: 16px;
      padding: 40px 32px; max-width: 360px; width: 100%; text-align: center; }
    .spinner { width: 48px; height: 48px; margin: 0 auto 16px;
      border: 4px solid #E8ECEF; border-top-color: #0E7C66; border-radius: 50%;
      animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    h1 { font-size: 20px; color: #0E7C66; margin: 0 0 8px; }
    p { color: #6B7480; font-size: 14px; }
    a { display: inline-block; margin-top: 16px; padding: 12px 24px;
      background: #0E7C66; color: #fff; text-decoration: none;
      border-radius: 8px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h1>กำลังกลับสู่แอป</h1>
    <p>กรุณารอสักครู่...</p>
    <a href="${appUrl}">เปิดแอป AiKlao</a>
  </div>
  <script>window.location.replace(${JSON.stringify(appUrl)});</script>
</body>
</html>`);
});

module.exports = router;

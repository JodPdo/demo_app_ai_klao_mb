// routes/oauthCallback.js
// LINE OAuth callback handler
//
// Flow:
//   1. Mobile app opens browser to LINE OAuth with redirect_uri = THIS endpoint
//   2. User logs in via LINE
//   3. LINE redirects browser here: GET /api/mobile/oauth/callback?code=...&state=...
//   4. We return HTML that triggers aiklao://auth/callback?code=...&state=...
//   5. Browser opens the app via custom scheme
//   6. App parses code from deep link → exchanges for id_token

const express = require("express");
const logger = require("../lib/logger");

const router = express.Router();

// GET /api/mobile/oauth/callback
router.get("/callback", (req, res) => {
  const { code, state, error, error_description } = req.query;

  // Log (no sensitive data — code is short-lived single-use)
  logger.info(
    {
      hasCode: !!code,
      hasError: !!error,
      reqId: req.id,
    },
    "[oauth-callback] LINE redirect received"
  );

  // Build deep link URL preserving all query params
  const params = new URLSearchParams();
  if (code) params.set("code", code);
  if (state) params.set("state", state);
  if (error) params.set("error", error);
  if (error_description) params.set("error_description", error_description);

  const appUrl = `aiklao://auth/callback?${params.toString()}`;

  // HTML page that auto-redirects to the app via custom scheme
  // 302 redirect doesn't trigger custom URI schemes — need meta refresh + JS
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "no-store");
  res.send(`<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta http-equiv="refresh" content="0;url=${appUrl}">
  <title>กำลังกลับสู่แอป AiKlao...</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif;
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: linear-gradient(135deg, #0E7C66 0%, #3DA88F 100%);
      color: #fff;
    }
    .card {
      background: #fff;
      color: #0F1419;
      border-radius: 16px;
      padding: 40px 32px;
      max-width: 360px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0,0,0,0.15);
    }
    .spinner {
      width: 48px;
      height: 48px;
      margin: 0 auto 16px;
      border: 4px solid #E8ECEF;
      border-top-color: #0E7C66;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h1 { font-size: 20px; color: #0E7C66; margin: 0 0 8px; }
    p { color: #6B7480; font-size: 14px; margin: 8px 0; }
    a.btn {
      display: inline-block;
      margin-top: 16px;
      padding: 12px 24px;
      background: #0E7C66;
      color: #fff;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 15px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h1>กำลังกลับสู่แอป</h1>
    <p>กรุณารอสักครู่...</p>
    <p>ถ้าไม่กลับอัตโนมัติภายใน 3 วินาที</p>
    <a class="btn" href="${appUrl}">เปิดแอป AiKlao</a>
  </div>
  <script>
    // Trigger custom scheme as soon as JS loads (faster than meta refresh)
    (function () {
      var url = ${JSON.stringify(appUrl)};
      window.location.replace(url);
    })();
  </script>
</body>
</html>`);
});

module.exports = router;

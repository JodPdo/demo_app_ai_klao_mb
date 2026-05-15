// middleware/jwtAuth.js
// Verifies JWT issued by /api/mobile/auth on protected mobile API routes
//
// Usage in server.js:
//   const jwtAuth = require("./middleware/jwtAuth");
//   app.use("/api/mobile", jwtAuth, mobileRoutes);
//
// Adds req.user = { id, lineUserId, displayName }

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.MOBILE_JWT_SECRET;
if (!JWT_SECRET) {
  // Don't crash at import — let server.js boot; just reject all requests if missing
  console.warn("[jwtAuth] MOBILE_JWT_SECRET not set — all mobile auth will fail");
}

function jwtAuth(req, res, next) {
  if (!JWT_SECRET) {
    return res.status(500).json({ error: "server_misconfigured" });
  }

  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: "missing_token" });
  }

  try {
    const payload = jwt.verify(match[1], JWT_SECRET, {
      issuer: "aiklao",
      audience: "aiklao-mobile",
    });
    req.user = {
      id: payload.sub,
      lineUserId: payload.lineUserId,
      displayName: payload.displayName,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "invalid_token", reason: err.message });
  }
}

module.exports = jwtAuth;

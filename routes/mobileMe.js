// routes/mobileMe.js
// GET /api/mobile/me — return current user profile
// JWT-protected (jwtAuth middleware adds req.user)

const express = require("express");
const db = require("../lib/db");
const logger = require("../lib/logger");

const router = express.Router();

router.get("/me", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, line_user_id, display_name, picture_url,
              created_at, last_login_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "user_not_found" });
    }

    const user = result.rows[0];
    res.json({
      user: {
        id: String(user.id),
        lineUserId: user.line_user_id,
        displayName: user.display_name,
        pictureUrl: user.picture_url,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
      },
    });
  } catch (err) {
    logger.error(
      { reqId: req.id, err: err.message },
      "[mobile-me] query failed"
    );
    res.status(500).json({ error: "db_error" });
  }
});

module.exports = router;
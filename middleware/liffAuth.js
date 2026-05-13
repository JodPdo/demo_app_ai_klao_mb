// LIFF auth middleware
//
// ตรวจ LINE access token ที่ LIFF SDK ส่งมาใน Authorization: Bearer <token>
// 1) verify token ผ่าน https://api.line.me/oauth2/v2.1/verify (ตรว​จ channel + expiry)
// 2) ดึง profile จาก https://api.line.me/v2/profile (ได้ userId)
// 3) cache 5 นาที (กัน rate limit จาก LINE)

const logger = require("../lib/logger");

const VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const PROFILE_URL = "https://api.line.me/v2/profile";
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map();

// ลบ cache entry ที่หมดอายุทุก 10 นาที
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.exp < now) cache.delete(k);
  }
}, 10 * 60 * 1000).unref();

async function liffAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "missing access token" });

  // cache hit
  const cached = cache.get(token);
  if (cached && cached.exp > Date.now()) {
    req.lineUser = cached.user;
    return next();
  }

  try {
    // 1) verify
    const verifyRes = await fetch(`${VERIFY_URL}?access_token=${encodeURIComponent(token)}`);
    if (!verifyRes.ok) {
      return res.status(401).json({ error: "invalid token" });
    }
    const verifyData = await verifyRes.json();

    // expires_in = วินาทีที่เหลือ
    if (!verifyData.expires_in || verifyData.expires_in <= 0) {
      return res.status(401).json({ error: "token expired" });
    }

    // ตรวจ client_id ตรงกับ LIFF channel ของเรา (optional แต่ควรทำ)
    const expectedClient = process.env.LINE_LOGIN_CHANNEL_ID;
    if (expectedClient && verifyData.client_id !== expectedClient) {
      logger.warn(
        { got: verifyData.client_id, expected: expectedClient },
        "LIFF token client_id mismatch"
      );
      return res.status(401).json({ error: "channel mismatch" });
    }

    // 2) fetch profile
    const profileRes = await fetch(PROFILE_URL, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!profileRes.ok) {
      return res.status(401).json({ error: "profile fetch failed" });
    }
    const profile = await profileRes.json();

    req.lineUser = {
      userId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl
    };

    // cache สั้นกว่า expires_in กับ 5 นาที (เลือกตัวที่น้อยกว่า)
    const expMs = Math.min(
      Date.now() + CACHE_TTL_MS,
      Date.now() + verifyData.expires_in * 1000 - 30_000
    );
    cache.set(token, { user: req.lineUser, exp: expMs });

    next();
  } catch (err) {
    logger.error({ err: err.message }, "liff auth error");
    res.status(500).json({ error: "auth error" });
  }
}

module.exports = liffAuth;
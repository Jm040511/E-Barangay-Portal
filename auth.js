// Admin auth for the barangay-staff side of the app.
// One shared admin account for now — a future version could give each
// official their own account, but the mechanism (session cookie +
// middleware gate on staff-only routes) is the same either way.

const crypto = require("crypto");

const isProduction = process.env.NODE_ENV === "production";

if (isProduction && (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET)) {
  console.error(
    "Refusing to start: ADMIN_PASSWORD and SESSION_SECRET must both be set " +
    "as environment variables in production. Set them and restart, e.g.\n" +
    "  ADMIN_USERNAME=youradmin ADMIN_PASSWORD=your-strong-password SESSION_SECRET=$(openssl rand -hex 32) NODE_ENV=production npm start"
  );
  process.exit(1);
}

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
// Local/dev only — set the ADMIN_PASSWORD environment variable for any
// real deployment. The startup check above refuses to boot without it
// once NODE_ENV=production.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "barangay2026";

const SALT = "ebarangay-salt-v1"; // fine for a single shared account; use a per-user random salt if this moves to per-official logins
function hash(password) {
  return crypto.scryptSync(password, SALT, 64).toString("hex");
}
const ADMIN_PASSWORD_HASH = hash(ADMIN_PASSWORD);

function verifyCredentials(username, password) {
  if (username !== ADMIN_USERNAME) return false;
  const attempt = hash(password || "");
  const stored = ADMIN_PASSWORD_HASH;
  // timingSafeEqual requires equal-length buffers
  return attempt.length === stored.length && crypto.timingSafeEqual(Buffer.from(attempt), Buffer.from(stored));
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: "Admin login required." });
}

module.exports = { ADMIN_USERNAME, verifyCredentials, requireAdmin };

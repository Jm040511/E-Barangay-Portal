const express = require("express");
const router = express.Router();
const { verifyCredentials } = require("../auth");
const rateLimit = require("../rateLimit");

// 10 attempts per 15 minutes per IP — generous for a staff member who
// fat-fingers a password, tight enough to make brute-forcing impractical.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts. Please wait a few minutes and try again."
});

// POST /api/admin/login — { username, password }
router.post("/login", loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!verifyCredentials(username, password)) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }
  req.session.isAdmin = true;
  req.session.username = username;
  res.json({ ok: true, username });
});

// POST /api/admin/logout
router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// GET /api/admin/me — used by admin.html to check if a session is already active
router.get("/me", (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin), username: req.session ? req.session.username : null });
});

module.exports = router;

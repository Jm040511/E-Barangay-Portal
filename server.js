const express = require("express");
const cors = require("cors");
const session = require("express-session");
const path = require("path");

const announcementsRouter = require("./routes/announcements");
const complaintsRouter = require("./routes/complaints");
const forumRouter = require("./routes/forum");
const miscRouter = require("./routes/misc");
const adminRouter = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
// Raised from Express's 100kb default so a compressed complaint photo
// (base64, downsized client-side before upload) fits comfortably.
app.use(express.json({ limit: "6mb" }));
// auth.js already refuses to boot in production without SESSION_SECRET
// set — this fallback only ever applies to local development.
app.use(session({
  secret: process.env.SESSION_SECRET || "ebarangay-dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 4, // 4 hour admin session
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax"
  }
}));
require("./auth"); // runs the production credential check at startup

// API routes
app.use("/api/announcements", announcementsRouter);
app.use("/api/complaints", complaintsRouter);
app.use("/api/forum", forumRouter);
app.use("/api/admin", adminRouter);
app.use("/api", miscRouter);

// Serve the existing frontend pages as-is
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`E-Barangay Portal running at http://localhost:${PORT}`);
});

const express = require("express");
const router = express.Router();
const db = require("../db");
const { requireAdmin } = require("../auth");

// GET /api/announcements — list all, newest first
router.get("/", (req, res) => {
  const { announcements } = db.read();
  const sorted = [...announcements].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(sorted);
});

// POST /api/announcements — barangay staff posts a new announcement (admin only)
router.post("/", requireAdmin, async (req, res) => {
  const { category, title, body, image } = req.body;
  if (!category || !title || !body) {
    return res.status(400).json({ error: "category, title, and body are required." });
  }

  let imageData = null;
  if (image) {
    if (typeof image !== "string" || !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(image)) {
      return res.status(400).json({ error: "Attached image must be a valid image (PNG, JPG, GIF, or WEBP)." });
    }
    // client compresses before sending, so anything still this big is unexpected
    if (image.length > 4 * 1024 * 1024) {
      return res.status(400).json({ error: "Attached image is too large — please pick a smaller image." });
    }
    imageData = image;
  }

  const created = await db.update((data) => {
    const nextId = data.announcements.length
      ? Math.max(...data.announcements.map((a) => a.id)) + 1
      : 1;
    const item = { id: nextId, category, title, body, image: imageData, createdAt: new Date().toISOString() };
    data.announcements.push(item);
    return item;
  });
  res.status(201).json(created);
});

// DELETE /api/announcements/:id — admin only, removes an announcement for good
router.delete("/:id", requireAdmin, async (req, res) => {
  const result = await db.update((data) => {
    const idx = data.announcements.findIndex((a) => a.id === Number(req.params.id));
    if (idx === -1) return { notFound: true };
    const [removed] = data.announcements.splice(idx, 1);
    return { removed };
  });
  if (result.notFound) return res.status(404).json({ error: "Announcement not found." });
  res.json({ id: result.removed.id, status: "deleted" });
});

module.exports = router;

const express = require("express");
const router = express.Router();
const db = require("../db");

// GET /api/emergency-contacts
router.get("/emergency-contacts", (req, res) => {
  const { emergencyContacts } = db.read();
  res.json(emergencyContacts);
});

// GET /api/faqs
router.get("/faqs", (req, res) => {
  const { faqs } = db.read();
  res.json(faqs);
});

module.exports = router;

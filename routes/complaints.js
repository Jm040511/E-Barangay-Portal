const express = require("express");
const router = express.Router();
const db = require("../db");
const { requireAdmin } = require("../auth");
const rateLimit = require("../rateLimit");

// Filing: generous, but caps scripted spam-filing.
const fileLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: "Too many complaints filed from this connection. Please try again later." });
// Lookup: references are random tokens now (not sequential), but this
// keeps a brute-force guessing script from getting anywhere either.
const lookupLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, message: "Too many lookups. Please wait a few minutes and try again." });

const VALID_CATEGORIES = ["Noise", "Sanitation", "Peace & Order", "Infrastructure", "Animal Concern", "Other"];
const STATUS_FLOW = ["Filed", "Under Review", "Resolved"];

function buildTimeline(complaint) {
  const timeline = [{ status: "Filed", at: complaint.createdAt, note: `Reference ${complaint.reference} logged.` }];
  if (complaint.status === "Under Review" || complaint.status === "Resolved") {
    timeline.push({
      status: "Under Review",
      at: complaint.reviewedAt || complaint.createdAt,
      note: complaint.assignedTo ? `Assigned to ${complaint.assignedTo}.` : "Assigned to a barangay official."
    });
  }
  if (complaint.status === "Resolved") {
    timeline.push({ status: "Resolved", at: complaint.resolvedAt, note: complaint.resolutionNote || "Marked resolved by barangay staff." });
  }
  return timeline;
}

// POST /api/complaints — file a new complaint. Returns a reference number
// regardless of whether it was filed anonymously.
router.post("/", fileLimiter, async (req, res) => {
  const { category, location, datetime, description, anonymous, fullname, contact, photo } = req.body;

  if (!category || !VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: "A valid category is required." });
  }
  if (!location || !location.trim()) {
    return res.status(400).json({ error: "Location is required." });
  }
  if (!description || !description.trim()) {
    return res.status(400).json({ error: "Description is required." });
  }

  let photoData = null;
  if (photo) {
    if (typeof photo !== "string" || !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(photo)) {
      return res.status(400).json({ error: "Attached photo must be a valid image (PNG, JPG, GIF, or WEBP)." });
    }
    // client compresses before sending, so anything still this big is unexpected
    if (photo.length > 4 * 1024 * 1024) {
      return res.status(400).json({ error: "Attached photo is too large — please pick a smaller image." });
    }
    photoData = photo;
  }

  const isAnonymous = !!anonymous;

  const created = await db.update((data) => {
    const reference = db.generateReference(data.complaints);
    const complaint = {
      reference,
      category,
      location: location.trim(),
      datetime: datetime || null,
      description: description.trim(),
      photo: photoData,
      anonymous: isAnonymous,
      fullname: isAnonymous ? null : (fullname || null),
      contact: isAnonymous ? null : (contact || null),
      status: "Filed",
      assignedTo: null,
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      resolvedAt: null,
      resolutionNote: null
    };
    data.complaints.push(complaint);
    return complaint;
  });

  res.status(201).json({
    reference: created.reference,
    status: created.status,
    message: "Complaint submitted. Save your reference number to track its status."
  });
});

// GET /api/complaints/:reference — track status by reference number.
// This is what makes anonymous filing still trackable: the reference
// number is the only thing linking a person back to their own report.
router.get("/:reference", lookupLimiter, (req, res) => {
  const { complaints } = db.read();
  const reference = req.params.reference.toUpperCase();
  const complaint = complaints.find((c) => c.reference.toUpperCase() === reference);

  if (!complaint) {
    return res.status(404).json({ error: "No complaint found with that reference number." });
  }

  // Note: the photo is deliberately left out of this public response.
  // Anyone can guess/brute-force reference numbers within the rate limit,
  // so returning the photo here would let a stranger view a resident's
  // attached image just by trying random codes. Photos are visible to
  // barangay staff only, via the admin dashboard.
  res.json({
    reference: complaint.reference,
    category: complaint.category,
    location: complaint.location,
    status: complaint.status,
    anonymous: complaint.anonymous,
    createdAt: complaint.createdAt,
    timeline: buildTimeline(complaint)
  });
});

// GET /api/complaints — admin/staff view of all complaints (admin only —
// this list includes contact info for non-anonymous complaints)
router.get("/", requireAdmin, (req, res) => {
  const { complaints } = db.read();
  const summary = complaints
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((c) => ({
      reference: c.reference,
      category: c.category,
      location: c.location,
      datetime: c.datetime,
      description: c.description,
      photo: c.photo,
      status: c.status,
      anonymous: c.anonymous,
      fullname: c.fullname,
      contact: c.contact,
      createdAt: c.createdAt
    }));
  res.json(summary);
});

// PATCH /api/complaints/:reference — barangay staff updates status (admin only).
// Body: { status: "Under Review" | "Resolved", assignedTo?, resolutionNote? }
router.patch("/:reference", requireAdmin, async (req, res) => {
  const { status, assignedTo, resolutionNote } = req.body;
  if (!STATUS_FLOW.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUS_FLOW.join(", ")}` });
  }

  const result = await db.update((data) => {
    const complaint = data.complaints.find((c) => c.reference.toUpperCase() === req.params.reference.toUpperCase());
    if (!complaint) return { notFound: true };

    complaint.status = status;
    if (status === "Under Review") {
      complaint.reviewedAt = new Date().toISOString();
      if (assignedTo) complaint.assignedTo = assignedTo;
    }
    if (status === "Resolved") {
      complaint.resolvedAt = new Date().toISOString();
      if (resolutionNote) complaint.resolutionNote = resolutionNote;
    }
    return { complaint };
  });

  if (result.notFound) return res.status(404).json({ error: "No complaint found with that reference number." });
  res.json({ reference: result.complaint.reference, status: result.complaint.status });
});

module.exports = router;

const express = require("express");
const router = express.Router();
const db = require("../db");
const { requireAdmin } = require("../auth");
const rateLimit = require("../rateLimit");

const postLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 15, message: "Too many posts from this connection. Please try again later." });
const voteLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: "Too many votes in a short time. Please slow down." });

// Residents can start a feedback or suggestion thread. "survey" is deliberately
// excluded here — surveys are only created by staff via POST /threads/survey,
// which attaches the options/voterChoices a survey needs to function.
const CREATABLE_CATEGORIES = ["feedback", "suggestion"];

// Surveys store how long they stay open as a single durationMinutes value
// (set from separate days/hours/minutes fields in the admin composer, so
// staff can post something as short as "30 minutes" or as long as
// "1 day 30 minutes" — not just whole days). Older surveys created before
// this existed only have closesInDays, so we fall back to that.
function getSurveyDurationMinutes(survey) {
  if (!survey) return null;
  if (typeof survey.durationMinutes === "number") return survey.durationMinutes;
  if (typeof survey.closesInDays === "number") return survey.closesInDays * 1440; // legacy surveys
  return 7 * 1440;
}

// A survey is "closed" once its duration has elapsed. This is computed on
// the fly (not stored) so nothing needs to be manually deleted or flipped
// when the clock runs out.
function isSurveyClosed(thread) {
  if (!thread.survey) return false;
  const durationMinutes = getSurveyDurationMinutes(thread.survey);
  const closesAt = new Date(thread.createdAt).getTime() + durationMinutes * 60000;
  return Date.now() >= closesAt;
}

// "185" minutes -> "3 hours 5 minutes", used for the admin's closed-surveys list.
function formatDuration(totalMinutes) {
  const mins = Math.max(0, Math.round(totalMinutes));
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const minutes = mins % 60;
  const parts = [];
  if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes || parts.length === 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  return parts.join(" ");
}

// GET /api/forum/threads?category=feedback&sort=top
// Public feed — only approved, non-archived posts show up here. Surveys
// that have reached their closing day drop off the live feed too; they
// still exist and are viewable by staff under the "Closed Surveys" panel.
router.get("/threads", (req, res) => {
  const { threads } = db.read();
  const { category, sort } = req.query;

  let list = threads.filter((t) => t.status === "approved" && !t.archived && !isSurveyClosed(t));
  if (category && category !== "all") {
    list = list.filter((t) => t.category === category);
  }
  if (sort === "top") {
    list.sort((a, b) => b.votes - a.votes);
  } else {
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  res.json(list);
});

// GET /api/forum/threads/pending — admin only, posts awaiting approval
router.get("/threads/pending", requireAdmin, (req, res) => {
  const { threads } = db.read();
  const pending = threads
    .filter((t) => t.status === "pending")
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); // oldest first
  res.json(pending);
});

// GET /api/forum/threads/approved — admin only, every approved post
// (including archived ones) so staff can manage the full forum in one
// place instead of losing track of posts once they're approved.
router.get("/threads/approved", requireAdmin, (req, res) => {
  const { threads } = db.read();
  const approved = threads
    .filter((t) => t.status === "approved")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(approved);
});

// GET /api/forum/threads/surveys/closed — admin only, surveys whose
// closing day has passed (so they no longer show on the public forum)
// along with their final results.
router.get("/threads/surveys/closed", requireAdmin, (req, res) => {
  const { threads } = db.read();
  const closed = threads
    .filter((t) => t.category === "survey" && t.status === "approved" && isSurveyClosed(t))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((t) => {
      const total = t.survey.options.reduce((s, o) => s + o.votes, 0);
      const durationMinutes = getSurveyDurationMinutes(t.survey);
      return {
        id: t.id,
        title: t.title,
        body: t.body,
        createdAt: t.createdAt,
        durationMinutes,
        durationLabel: formatDuration(durationMinutes),
        options: t.survey.options.map((o) => ({ label: o.label, votes: o.votes, pct: total ? Math.round((o.votes / total) * 100) : 0 }))
      };
    });
  res.json(closed);
});

// GET /api/forum/threads/:id — single thread detail (approved only, unless admin)
router.get("/threads/:id", (req, res) => {
  const { threads } = db.read();
  const thread = threads.find((t) => t.id === Number(req.params.id));
  if (!thread) return res.status(404).json({ error: "Thread not found." });
  if (thread.status !== "approved" && !(req.session && req.session.isAdmin)) {
    return res.status(404).json({ error: "Thread not found." });
  }
  res.json(thread);
});

// POST /api/forum/threads — start a new thread. Goes to "pending" until a
// barangay staff member approves it from the admin dashboard.
// Body: { category, title, body, anonymous, author? }
router.post("/threads", postLimiter, async (req, res) => {
  const { category, title, body, anonymous, author, location } = req.body;
  if (!CREATABLE_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${CREATABLE_CATEGORIES.join(", ")}` });
  }
  if (!title || !title.trim() || !body || !body.trim()) {
    return res.status(400).json({ error: "title and body are required." });
  }

  const isAnonymous = !!anonymous;
  if (!isAnonymous && (!author || !author.trim())) {
    return res.status(400).json({ error: "Please add your name, or choose to post anonymously." });
  }

  const created = await db.update((data) => {
    const thread = {
      id: data.nextThreadId++,
      category,
      title: title.trim(),
      body: body.trim(),
      author: isAnonymous ? "Anonymous Resident" : author.trim(),
      anonymous: isAnonymous,
      location: location || "",
      createdAt: new Date().toISOString(),
      status: "pending",
      archived: false,
      votes: 0,
      votedBy: [],
      survey: null,
      implementing: false,
      implementNote: null,
      comments: []
    };
    data.threads.unshift(thread);
    return thread;
  });

  res.status(201).json({ ...created, message: "Submitted for review. It'll appear on the forum once a barangay staff member approves it." });
});

// POST /api/forum/threads/survey — admin only. Creates a survey thread that's
// immediately approved (no review needed since a staff member is authoring it).
// Body: { title, body, days, hours, minutes, options: [{ label }] }
// days/hours/minutes combine into one duration — e.g. { days: 1, minutes: 30 }
// for "1 day 30 minutes" open, or just { minutes: 30 } for a 30-minute survey.
router.post("/threads/survey", requireAdmin, async (req, res) => {
  const { title, body, options } = req.body;
  if (!title || !title.trim() || !body || !body.trim()) {
    return res.status(400).json({ error: "title and body are required." });
  }
  if (!Array.isArray(options) || options.filter((o) => o && o.label && o.label.trim()).length < 2) {
    return res.status(400).json({ error: "Provide at least two survey options." });
  }

  // Each field is optional and independently clamped to a non-negative
  // whole number, so a blank field just contributes 0 instead of NaN.
  const toNonNegInt = (v) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const days = toNonNegInt(req.body.days);
  const hours = toNonNegInt(req.body.hours);
  const minutes = toNonNegInt(req.body.minutes);
  const durationMinutes = days * 1440 + hours * 60 + minutes;

  if (durationMinutes < 1) {
    return res.status(400).json({ error: "Set how long the survey stays open (days, hours, and/or minutes) — at least 1 minute." });
  }

  const created = await db.update((data) => {
    const thread = {
      id: data.nextThreadId++,
      category: "survey",
      title: title.trim(),
      body: body.trim(),
      author: "Barangay Office",
      anonymous: false,
      location: "",
      createdAt: new Date().toISOString(),
      status: "approved",
      archived: false,
      votes: 0,
      votedBy: [],
      implementing: false,
      implementNote: null,
      survey: {
        durationMinutes,
        options: options.filter((o) => o && o.label && o.label.trim()).map((o) => ({ label: o.label.trim(), votes: 0 })),
        voterChoices: {}
      },
      comments: []
    };
    data.threads.unshift(thread);
    return thread;
  });

  res.status(201).json(created);
});

// POST /api/forum/threads/:id/approve — admin only
router.post("/threads/:id/approve", requireAdmin, async (req, res) => {
  const result = await db.update((data) => {
    const thread = data.threads.find((t) => t.id === Number(req.params.id));
    if (!thread) return { notFound: true };
    thread.status = "approved";
    return { thread };
  });
  if (result.notFound) return res.status(404).json({ error: "Thread not found." });
  res.json({ id: result.thread.id, status: result.thread.status });
});

// POST /api/forum/threads/:id/reject — admin only, removes a pending post entirely
router.post("/threads/:id/reject", requireAdmin, async (req, res) => {
  const result = await db.update((data) => {
    const idx = data.threads.findIndex((t) => t.id === Number(req.params.id));
    if (idx === -1) return { notFound: true };
    const [removed] = data.threads.splice(idx, 1);
    return { removed };
  });
  if (result.notFound) return res.status(404).json({ error: "Thread not found." });
  res.json({ id: result.removed.id, status: "rejected" });
});

// DELETE /api/forum/threads/:id — admin only, permanently removes an
// already-approved post from the forum (as opposed to archiving, which
// just hides it from residents while keeping it around for staff).
router.delete("/threads/:id", requireAdmin, async (req, res) => {
  const result = await db.update((data) => {
    const idx = data.threads.findIndex((t) => t.id === Number(req.params.id));
    if (idx === -1) return { notFound: true };
    const [removed] = data.threads.splice(idx, 1);
    return { removed };
  });
  if (result.notFound) return res.status(404).json({ error: "Thread not found." });
  res.json({ id: result.removed.id, status: "deleted" });
});

// POST /api/forum/threads/:id/archive — admin only. Archiving hides a post
// from the public forum without deleting it; unarchiving brings it back.
// Body: { archived: true|false }
router.post("/threads/:id/archive", requireAdmin, async (req, res) => {
  const { archived } = req.body;
  const result = await db.update((data) => {
    const thread = data.threads.find((t) => t.id === Number(req.params.id));
    if (!thread) return { notFound: true };
    thread.archived = !!archived;
    return { thread };
  });
  if (result.notFound) return res.status(404).json({ error: "Thread not found." });
  res.json({ id: result.thread.id, archived: result.thread.archived });
});

// POST /api/forum/threads/:id/implement — admin only. Marks a suggestion as
// something the barangay is going ahead with, which shows a badge on the
// public forum. Body: { implementing: true|false, note? }
router.post("/threads/:id/implement", requireAdmin, async (req, res) => {
  const { implementing, note } = req.body;
  const result = await db.update((data) => {
    const thread = data.threads.find((t) => t.id === Number(req.params.id));
    if (!thread) return { notFound: true };
    thread.implementing = !!implementing;
    thread.implementNote = implementing ? (note || null) : null;
    return { thread };
  });
  if (result.notFound) return res.status(404).json({ error: "Thread not found." });
  res.json({ id: result.thread.id, implementing: result.thread.implementing, implementNote: result.thread.implementNote });
});

// POST /api/forum/threads/:id/vote — toggle an upvote.
// Body: { voterId: "some-stable-client-id" } — a simple way to prevent the
// same visitor from stacking votes without requiring full user accounts.
router.post("/threads/:id/vote", voteLimiter, async (req, res) => {
  const { voterId } = req.body;
  if (!voterId) return res.status(400).json({ error: "voterId is required." });

  const result = await db.update((data) => {
    const thread = data.threads.find((t) => t.id === Number(req.params.id));
    if (!thread) return { notFound: true };

    const idx = thread.votedBy.indexOf(voterId);
    if (idx === -1) {
      thread.votedBy.push(voterId);
      thread.votes += 1;
    } else {
      thread.votedBy.splice(idx, 1);
      thread.votes -= 1;
    }
    return { votes: thread.votes, voted: idx === -1 };
  });

  if (result.notFound) return res.status(404).json({ error: "Thread not found." });
  res.json(result);
});

// POST /api/forum/threads/:id/survey/vote — cast a vote on a survey option.
// Tapping the option you already picked retracts your vote; tapping a
// different option moves it. Body: { optionIndex, voterId }
router.post("/threads/:id/survey/vote", voteLimiter, async (req, res) => {
  const { optionIndex, voterId } = req.body;
  if (!voterId) return res.status(400).json({ error: "voterId is required." });

  const idx = Number(optionIndex);
  if (!Number.isInteger(idx) || idx < 0) {
    return res.status(400).json({ error: "optionIndex is required." });
  }

  const result = await db.update((data) => {
    const thread = data.threads.find((t) => t.id === Number(req.params.id));
    if (!thread) return { notFound: true };
    if (!thread.survey) return { noSurvey: true };

    const { options } = thread.survey;
    if (idx >= options.length) return { badOption: true };
    if (!thread.survey.voterChoices) thread.survey.voterChoices = {};
    const choices = thread.survey.voterChoices;

    const previous = choices[voterId];
    if (previous === idx) {
      // tapping the same option again retracts the vote
      options[idx].votes = Math.max(0, options[idx].votes - 1);
      delete choices[voterId];
    } else {
      if (previous !== undefined && options[previous]) {
        options[previous].votes = Math.max(0, options[previous].votes - 1);
      }
      options[idx].votes += 1;
      choices[voterId] = idx;
    }

    const total = options.reduce((sum, o) => sum + o.votes, 0);
    return {
      options: options.map((o) => ({ label: o.label, votes: o.votes, pct: total ? Math.round((o.votes / total) * 100) : 0 })),
      selected: choices[voterId] !== undefined ? choices[voterId] : null
    };
  });

  if (result.notFound) return res.status(404).json({ error: "Thread not found." });
  if (result.noSurvey) return res.status(400).json({ error: "This thread has no survey attached." });
  if (result.badOption) return res.status(400).json({ error: "Invalid survey option." });
  res.json(result);
});

// GET /api/forum/threads/:id/comments — public
router.get("/threads/:id/comments", (req, res) => {
  const { threads } = db.read();
  const thread = threads.find((t) => t.id === Number(req.params.id));
  if (!thread) return res.status(404).json({ error: "Thread not found." });
  res.json(thread.comments || []);
});

// POST /api/forum/threads/:id/comments — add a comment.
// Body: { anonymous, author?, body }
router.post("/threads/:id/comments", postLimiter, async (req, res) => {
  const { anonymous, author, body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: "Comment can't be empty." });

  const isAnonymous = !!anonymous;
  if (!isAnonymous && (!author || !author.trim())) {
    return res.status(400).json({ error: "Please add your name, or choose to comment anonymously." });
  }

  const result = await db.update((data) => {
    const thread = data.threads.find((t) => t.id === Number(req.params.id));
    if (!thread) return { notFound: true };
    if (!thread.comments) thread.comments = [];
    const comment = {
      id: thread.comments.length + 1,
      author: isAnonymous ? "Anonymous Resident" : author.trim(),
      anonymous: isAnonymous,
      body: body.trim(),
      createdAt: new Date().toISOString()
    };
    thread.comments.push(comment);
    return { comment };
  });

  if (result.notFound) return res.status(404).json({ error: "Thread not found." });
  res.status(201).json(result.comment);
});

// GET /api/forum/threads/:id/survey — survey results
router.get("/threads/:id/survey", (req, res) => {
  const { threads } = db.read();
  const thread = threads.find((t) => t.id === Number(req.params.id));
  if (!thread || !thread.survey) return res.status(404).json({ error: "No survey attached to this thread." });

  const total = thread.survey.options.reduce((sum, o) => sum + o.votes, 0);
  const withPct = thread.survey.options.map((o) => ({
    label: o.label,
    votes: o.votes,
    pct: total ? Math.round((o.votes / total) * 100) : 0
  }));
  const voterId = req.query.voterId;
  const choices = thread.survey.voterChoices || {};
  const selected = voterId && choices[voterId] !== undefined ? choices[voterId] : null;
  const durationMinutes = getSurveyDurationMinutes(thread.survey);
  const closesAt = new Date(new Date(thread.createdAt).getTime() + durationMinutes * 60000).toISOString();
  res.json({ durationMinutes, closesAt, options: withPct, selected });
});

module.exports = router;

# Link: 
https://e-barangay-portal.onrender.com/

# E-Barangay Portal

A working system for the barangay: complaints are saved and
trackable by reference number, forum votes and posts persist, and
announcements/emergency contacts/FAQs are served from real data instead of
being hardcoded in the HTML.

## Staff / admin login

`admin.html` is a dashboard for barangay staff: it lists all complaints
with a dropdown to move each through Filed → Under Review → Resolved, and
a form to post new announcements. It's linked from the "Staff Login" link
in the footer of every resident-facing page.

Credentials are set via environment variables — **do not use the fallback
defaults for a real deployment**:

```bash
ADMIN_USERNAME=youradmin ADMIN_PASSWORD=yourpassword SESSION_SECRET=$(openssl rand -hex 32) NODE_ENV=production npm start
```

With `NODE_ENV=production` set, the server refuses to start at all unless
`ADMIN_PASSWORD` and `SESSION_SECRET` are both set — this prevents
accidentally going live on the local-dev defaults. See "Deploying for
real" below for the full checklist.

Behind the scenes this uses a real session cookie (`express-session`), and
the following endpoints require a logged-in admin session — trying to
call them while logged out returns `401 Unauthorized`:

- `PATCH /api/complaints/:reference` (update status)
- `GET /api/complaints` (the full list — it includes contact info for
  non-anonymous complaints, so it's staff-only)
- `POST /api/announcements`

Everything residents use — filing a complaint, tracking one by reference
number, browsing/posting on the forum, viewing announcements — stays
open, no account needed, on purpose: the anonymous complaint feature only
means something if filing doesn't require identifying yourself.

This is currently one shared admin account for all staff. Fine to start
with, but it means there's no way to tell which staff member made a given
change — worth moving to individual per-official logins if the office
grows past a couple of people managing it.

## Forum post approval

Every new forum post starts as `status: "pending"` and does **not** show
up on the public forum yet. It only appears once a logged-in admin
approves it from the "Pending Forum Posts" panel in `admin.html`.
Rejecting a post removes it permanently.

- `GET /api/forum/threads` (the public feed) only ever returns posts with
  `status: "approved"` — pending and rejected posts never leak through.
- `GET /api/forum/threads/pending` — admin only, lists what's waiting.
- `POST /api/forum/threads/:id/approve` — admin only.
- `POST /api/forum/threads/:id/reject` — admin only, deletes the post.

The seed threads that ship out of the box are pre-approved so the forum
doesn't look empty on first run — delete or edit them from `admin.html`
once you have real resident posts.

## Named or anonymous — for both complaints and forum posts

Residents choose per-post, same as complaints: a toggle for "post with
your name" vs "post anonymously." If posting with a name, a name is
required; if anonymous, the author is stored as "Anonymous Resident" and
no name is attached. This applies to both starting a new thread and
adding a comment.

## Comments

Every forum thread (except surveys) has a real comment section now:

- `GET /api/forum/threads/:id/comments` — list comments (comments are
  also included directly on each thread object from the main feed).
- `POST /api/forum/threads/:id/comments` — add one. Same
  named/anonymous choice as starting a thread.

Comments don't need admin approval — they go live immediately. Only new
*threads* go through the pending-approval step.

## Admin-posted surveys

Staff can post a survey directly from `admin.html` — title, description,
how many days it stays open, and a list of options (add as many as
needed). Unlike resident posts, staff-authored surveys skip the pending
queue and appear on the forum immediately.

- `POST /api/forum/threads/survey` — admin only. Body:
  ```json
  { "title": "...", "body": "...", "closesInDays": 7, "options": [{ "label": "Health Center" }, { "label": "Roads" }] }
  ```

Residents vote by tapping an option on the forum page. One vote per
`voterId` per survey — tapping your current pick again retracts it,
tapping a different option moves it. Voting is disabled once the
survey passes its `closesInDays` window.

- `POST /api/forum/threads/:id/survey/vote` — `{ optionIndex, voterId }`,
  returns the updated `options` (with `pct`) and the caller's `selected` index.

## Marking a suggestion as "being implemented"

From the admin dashboard's "Manage Suggestions" panel, staff can flag an
approved suggestion as something the barangay is actually going ahead
with. It shows a green badge on the public forum post (with an optional
note, e.g. "Included in next quarter's budget"), so residents can see
their idea was heard and acted on.

- `POST /api/forum/threads/:id/implement` — admin only. Body:
  ```json
  { "implementing": true, "note": "Included in next quarter's budget" }
  ```
  Send `implementing: false` to remove the badge.

## Running it

You need [Node.js](https://nodejs.org) installed (v18 or newer).

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser. That's it — one
server serves both the website and the API, so there's nothing else to
configure.

The first time you run it, a `data/db.json` file is created automatically
with starter content (sample announcements, forum threads, etc.). Every
complaint filed, vote cast, or thread posted afterward is saved into that
file and will still be there the next time you start the server. To reset
everything back to the original starter content, delete `data/db.json`
and restart — **do this before going live with real residents**, so old
sample posts don't ship as if they were real.

## Project structure

```
server.js              — starts Express, wires up routes + static files
db.js                   — tiny JSON-file "database" with seed data
routes/
  announcements.js      — GET/POST /api/announcements
  complaints.js         — POST/GET/PATCH /api/complaints
  forum.js              — threads, voting, surveys
  misc.js               — emergency contacts + FAQs
public/
  index.html            — homepage
  complaint.html         — complaint form + status tracker (now live)
  forum.html             — forum (now live: real posts + real votes)
  styles.css             — shared design system
```

## API reference

### Announcements
- `GET /api/announcements` — list all, newest first
- `POST /api/announcements` — `{ category, title, body }`

### Complaints
- `POST /api/complaints` — file a complaint, returns a reference number
  ```json
  { "category": "Noise", "location": "Purok 2", "description": "...", "anonymous": true, "photo": "data:image/jpeg;base64,..." }
  ```
  `photo` is optional — a base64 data URI (PNG/JPG/GIF/WEBP). The complaint
  form downsizes the image client-side before sending it, and the server
  validates the MIME type and rejects anything over ~4MB.
- `GET /api/complaints/:reference` — check status + timeline (e.g. `BC-1000`), includes `photo` if one was attached
- `GET /api/complaints` — full list for the staff dashboard (admin only — includes `photo`, `description`, and contact info); clicking a row in `admin.html` opens the full complaint, photo included, since the table itself only shows a short preview
- `PATCH /api/complaints/:reference` — update status, e.g.
  ```json
  { "status": "Under Review", "assignedTo": "Kagawad Reyes" }
  ```

### Forum
- `GET /api/forum/threads?category=feedback&sort=top`
- `POST /api/forum/threads` — `{ category, title, body, author? }`
- `POST /api/forum/threads/:id/vote` — `{ voterId }` toggles an upvote
- `POST /api/forum/threads/:id/survey/vote` — `{ optionIndex, voterId }` casts/changes/retracts a survey vote
- `GET /api/forum/threads/:id/survey?voterId=...` — survey results with percentages (and the caller's `selected` option, if any)

### Other
- `GET /api/emergency-contacts`
- `GET /api/faqs`

## Deploying for real

Checklist before this goes live for actual residents:

- [ ] Set `ADMIN_USERNAME`, `ADMIN_PASSWORD` (strong, unique), and
      `SESSION_SECRET` (`openssl rand -hex 32`) as environment variables,
      and run with `NODE_ENV=production` — the server won't boot without
      the first two set once `NODE_ENV=production` is set.
- [ ] Terminate HTTPS in front of this app (e.g. via your host or a
      reverse proxy like Caddy/Nginx) — session cookies and resident
      contact info shouldn't travel over plain HTTP.
- [ ] Back up `data/db.json` on a schedule. It's the only copy of every
      complaint, forum post, and vote — losing the file loses everything.
- [ ] Review the Data Privacy Act (RA 10173) obligations for handling
      resident names, contact numbers, and complaint photos — this
      includes having a retention/deletion policy, since nothing in this
      app currently expires old records automatically.
- [ ] If you expect meaningful concurrent traffic, plan a move off the
      single JSON file to a real database (SQLite is the easiest next
      step, Postgres beyond that) — `db.js` is written so this mostly
      means changing that one file, not the routes.

## Notes on the design

- **Anonymous complaints stay trackable** because the reference number,
  not the person's identity, is the lookup key — see
  `routes/complaints.js`. References are random unguessable tokens
  (`db.generateReference`), not sequential, specifically so no one can
  enumerate every complaint filed by walking through reference numbers.
- Staff-facing endpoints (`PATCH /api/complaints/:reference`,
  `POST /api/announcements`, etc.) require a logged-in admin session —
  see `auth.js` and `requireAdmin`.
- Public write/lookup endpoints (filing a complaint, checking a
  reference, posting or voting on the forum, admin login) are rate
  limited per IP (`rateLimit.js`) to blunt scripted abuse — no external
  dependency needed, since it's a small in-memory limiter suited to a
  single-instance deployment.
- The database is a single JSON file rather than PostgreSQL/MySQL to keep
  setup to `npm install && npm start` with nothing else to install. The
  routes are written so swapping in a real database later mostly means
  changing `db.js`, not the route files.

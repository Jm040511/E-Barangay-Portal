// Lightweight file-based "database" — no external DB engine needed.
// Good enough for a class demo; swap for Postgres/MySQL later without
// changing the route files much, since everything goes through this module.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "data", "db.json");

// Unguessable reference numbers. Complaints are looked up publicly by
// reference (that's how anonymous filing stays trackable), so the
// reference itself must not be enumerable — a sequential BC-1000,
// BC-1001... counter would let anyone script through every complaint
// ever filed, photos included. 6 base32 chars (Crockford alphabet, no
// look-alike letters) = ~30 bits of entropy, plenty for this use case,
// and still short enough for a resident to write down.
const REF_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no 0/O/1/I/L
function generateReference(existingComplaints) {
  const taken = new Set(existingComplaints.map((c) => c.reference));
  let ref;
  do {
    let code = "";
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) code += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
    ref = `BC-${code}`;
  } while (taken.has(ref));
  return ref;
}

function seedData() {
  return {
    announcements: [
      { id: 1, category: "Emergency Alert", title: "Flood advisory — Purok 3 to 5", body: "Water levels are rising near the creek. Residents in low-lying areas should prepare to evacuate if advised by officials.", image: null, createdAt: daysAgo(0, 2) },
      { id: 2, category: "Weather Forecast", title: "Cloudy, 60% rain chance tomorrow", body: "Expect scattered rain showers in the afternoon. Bring an umbrella if you're heading out.", image: null, createdAt: daysAgo(0, 4) },
      { id: 3, category: "Job Opening", title: "Barangay Health Worker — 2 slots open", body: "Looking for residents interested in community health work. Apply at the barangay hall before Friday.", image: null, createdAt: daysAgo(1) },
      { id: 4, category: "Public Advisory", title: "Water interruption, July 28, 9am–3pm", body: "Scheduled maintenance will interrupt water service in Puroks 1–4.", image: null, createdAt: daysAgo(1) },
      { id: 5, category: "Upcoming Event", title: "Basketball league finals this weekend", body: "Finals start Saturday 3pm at the covered court. Everyone's welcome.", image: null, createdAt: daysAgo(2) }
    ],

    threads: [
      {
        id: 1, category: "feedback", title: "Streetlight repair on Rizal St. — how's it holding up?",
        author: "Marites A.", anonymous: false, location: "Purok 4", createdAt: daysAgo(2), status: "approved", archived: false,
        body: "The new LED lights near the corner store have made a real difference at night. One post near the basketball court is still flickering though — worth a follow-up check.",
        votes: 34, votedBy: [], survey: null, implementing: false, implementNote: null,
        comments: [
          { id: 1, author: "Kagawad Reyes", anonymous: false, body: "Thanks for the heads-up — sending someone to check that post this week.", createdAt: daysAgo(1) },
          { id: 2, author: "Anonymous Resident", anonymous: true, body: "Same here, noticed it flickering around 9pm most nights.", createdAt: daysAgo(1) }
        ]
      },
      {
        id: 2, category: "suggestion", title: "Suggestion: covered court for the plaza",
        author: "Rico D.", anonymous: false, location: "Purok 1", createdAt: daysAgo(4), status: "approved", archived: false,
        body: "During the rainy season the plaza events keep getting cancelled. A simple roof structure over the existing court would let basketball league games and assemblies continue year-round.",
        votes: 61, votedBy: [], survey: null, implementing: true, implementNote: "Included in next quarter's infrastructure budget.",
        comments: [
          { id: 1, author: "Anonymous Resident", anonymous: true, body: "This would be amazing, please make it happen!", createdAt: daysAgo(3) }
        ]
      },
      {
        id: 3, category: "survey", title: "Q3 Satisfaction Survey — rate our barangay services",
        author: "Barangay Office", anonymous: false, location: "", createdAt: daysAgo(0), status: "approved", archived: false,
        body: "Quick 4-question pulse on health center service, waste collection, road maintenance, and response time. Results are shared publicly once closed.",
        votes: 0, votedBy: [], implementing: false, implementNote: null,
        survey: {
          durationMinutes: 3 * 1440, // 3 days
          options: [
            { label: "Health Ctr", votes: 88 },
            { label: "Waste", votes: 72 },
            { label: "Roads", votes: 64 }
          ],
          voterChoices: {}
        },
        comments: []
      },
      {
        id: 4, category: "feedback", title: "Waste segregation bins — mixed results so far",
        author: "Leah S.", anonymous: false, location: "Purok 2", createdAt: daysAgo(6), status: "approved", archived: false,
        body: "The new color-coded bins are a good idea but pickup schedules haven't caught up — biodegradable bin overflowed twice this week before collection day.",
        votes: 19, votedBy: [], survey: null, implementing: false, implementNote: null,
        comments: []
      },
      {
        id: 5, category: "suggestion", title: "Add a night market once a month near the plaza",
        author: "Bimbo T.", anonymous: false, location: "Purok 5", createdAt: daysAgo(7), status: "approved", archived: false,
        body: "Could help small sari-sari and food vendors get more foot traffic, and give the community something to look forward to on weekends.",
        votes: 42, votedBy: [], survey: null, implementing: false, implementNote: null,
        comments: []
      }
    ],

    complaints: [],
    nextThreadId: 6,

    emergencyContacts: [
      { name: "Barangay Hall", number: "(02) 8-372-1122", tel: "+6328721122", icon: "hall" },
      { name: "Police Station", number: "117 · (02) 8-372-3341", tel: "117", icon: "police" },
      { name: "Fire Station", number: "(02) 8-372-7788", tel: "+6328727788", icon: "fire" },
      { name: "Health Center", number: "(02) 8-372-4090", tel: "+6328724090", icon: "health" }
    ],

    faqs: [
      { id: 1, question: "How do I share feedback or a suggestion with the barangay?", answer: "Head to the Community Forum, choose Feedback or Suggestion, and post — it goes live once a barangay staff member approves it." },
      { id: 2, question: "Can I file a complaint anonymously?", answer: "Yes — toggle \"submit anonymously\" in the Complaint Center before sending your report." },
      { id: 3, question: "How do I track my complaint's status?", answer: "Every complaint gets a reference number you can check anytime under Complaint Center → Track Status." }
    ]
  };
}

function daysAgo(d, h) {
  const date = new Date();
  date.setDate(date.getDate() - d);
  if (h) date.setHours(date.getHours() - h);
  return date.toISOString();
}

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(seedData(), null, 2));
  }
}

function read() {
  ensureDb();
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
}

function write(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Simple in-process write queue so concurrent requests don't clobber each other.
let writeChain = Promise.resolve();
function update(mutator) {
  writeChain = writeChain.then(() => {
    const data = read();
    const result = mutator(data);
    write(data);
    return result;
  });
  return writeChain;
}

module.exports = { read, write, update, generateReference };

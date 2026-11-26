// iSkill World — Vercel Serverless Functions, shared helpers.
// Data lives in Vercel Blob as JSON:
// { categories, courses, orders, users, admin, settings }.
// If BLOB_READ_WRITE_TOKEN is not set (Blob store not linked yet),
// data falls back to in-memory seed data so the storefront still works.
import crypto from "node:crypto";
async function blobApi(){ try { return await import("@vercel/blob"); } catch { return null; } }

export const DATA_KEY = "data.json";
// Versioned Blob keys: EVERY save writes a NEW key (data-<time>-<rand>.json)
// and loads always pick the newest key from `blob.list`.
// Why: overwriting the same "data.json" key does NOT invalidate Vercel's
// edge cache — reads kept returning the OLD data.json for a minute or more
// after a write. That one bug caused the whole chain of "second phone login
// fails", duplicate order codes and "deleted account still logs in": every
// handler does load -> mutate -> save, so a stale read silently dropped the
// previous write. A fresh key has never been cached, so a fresh read always
// sees the latest write. Old versions accumulate (each ~15 KB); the seller
// can prune them from the Vercel dashboard — we never auto-delete, because
// two near-simultaneous saves could otherwise delete each other's key.
const DATA_PREFIX = "data";
const VERSIONED_KEY = /^data-[0-9a-z]+-[0-9a-f]+\.json$/;
let memoryData = null;

export const CATEGORIES = ["Programming","Design","Digital Marketing","Business","Data Science","Language","Music","Photography"];

export function seedData() {
  const c = (id, title, category, price, oldPrice, rating, students, duration, lessons, level, instructor, description, includes, free = false) => ({
    id, title, category, price, oldPrice, rating, students, duration, lessons,
    level, instructor, description, includes, free,
    cover: "", coverKind: "gradient", driveUrl: "", telegramChannel: "", createdAt: new Date().toISOString(),
  });
  return {
    version: 1,
    categories: [...CATEGORIES],
    courses: [
      c("python-bootcamp", "Complete Python Bootcamp — From Zero to Hero", "Programming", 499, 1999, null, 0, "32 hours", 185, "Beginner", "iSkill World", "Learn Python from scratch — basics, OOP, file handling and real projects, in simple English.", ["185 video lessons", "12 hands-on projects", "Certificate of completion", "Lifetime access"]),
      c("fullstack-web-dev", "Full-Stack Web Development", "Programming", 999, 3999, null, 0, "26 hours", 132, "Intermediate", "iSkill World", "HTML, CSS, JavaScript, Node.js and databases — build and deploy complete websites.", ["132 video lessons", "8 portfolio projects", "Certificate of completion", "Lifetime access"]),
      c("uiux-figma", "UI/UX Design Masterclass", "Design", 799, 2499, null, 0, "14 hours", 74, "All Levels", "iSkill World", "Design beautiful apps and websites in Figma — wireframes, prototypes and design systems.", ["74 video lessons", "6 design projects", "Certificate of completion", "Lifetime access"]),
      c("digital-marketing", "Digital Marketing Pro", "Digital Marketing", 599, 1999, null, 0, "12 hours", 68, "Beginner", "iSkill World", "SEO, Instagram ads, funnels and analytics — grow any business online.", ["68 video lessons", "Real ad account walkthroughs", "Certificate of completion", "Lifetime access"]),
      c("stock-trading", "Stock Market and Trading", "Business", 899, 2999, null, 0, "16 hours", 82, "Beginner", "iSkill World", "Understand the stock market, technical analysis, risk management and trading psychology.", ["82 video lessons", "Live chart examples", "Certificate of completion", "Lifetime access"]),
      c("data-science-ml", "Data Science and Machine Learning", "Data Science", 1299, 4999, null, 0, "30 hours", 148, "Intermediate", "iSkill World", "Python for data, Pandas, visualisation and your first machine learning models.", ["148 video lessons", "10 datasets + projects", "Certificate of completion", "Lifetime access"]),
      c("spoken-english", "Spoken English Fluency Course", "Language", 0, 999, null, 0, "8 hours", 45, "Beginner", "iSkill World", "Speak English confidently — daily speaking practice, grammar made simple and common conversations.", ["45 video lessons", "Speaking practice sheets", "Certificate of completion", "Lifetime access"], true),
      c("photography", "Photography Basics", "Photography", 699, 1999, null, 0, "10 hours", 56, "All Levels", "iSkill World", "Camera settings, composition, lighting and mobile + DSLR editing — from beginner to pro.", ["56 video lessons", "Photo assignments", "Certificate of completion", "Lifetime access"]),
    ],
    orders: [],
    ratings: [],
    users: [],
    admin: { pin: null, session: null },
    settings: { telegramUrl: "https://t.me/+jUiC3D_slQI3ZjY1", tagline: "Skills that make you dangerously good.", featuredCourseId: "" },
  };
}

// Older data.json files have no users array yet — fill it in, never crash.
export function ensureData(data) {
  if (!data) return data;
  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.orders)) data.orders = [];
  if (!Array.isArray(data.ratings)) data.ratings = [];
  if (data._seq == null) data._seq = 0;
  if (!Array.isArray(data.courses)) data.courses = [];
  // Fake seeded ratings / student counts are never shown any more: wipe
  // them from stored courses so only real numbers can ever appear.
  data.courses.forEach((c) => { c.rating = null; c.students = 0; });
  if (!Array.isArray(data.categories)) data.categories = [...CATEGORIES];
  if (!data.admin) data.admin = { pin: null, session: null };
  if (!data.settings) data.settings = { telegramUrl: "https://t.me/+jUiC3D_slQI3ZjY1", featuredCourseId: "" };
  return data;
}

// REAL stats, computed from real data — never stored/faked:
// students = buyers whose order for this course is approved;
// rating = average of real buyer ratings only (null when nobody rated).
export function courseStats(data, courseId) {
  const students = (data.orders || []).filter((o) => String(o.courseId) === String(courseId) && String(o.status || "").toLowerCase() === "approved").length;
  const rs = (data.ratings || []).filter((r) => String(r.courseId) === String(courseId));
  const ratingAvg = rs.length ? rs.reduce((a, r) => a + Number(r.stars || 0), 0) / rs.length : null;
  return { students, ratingAvg, ratingCount: rs.length };
}

export async function loadData(opts) {
  opts = opts || {};
  if (!opts.forceFresh && memoryData && Array.isArray(memoryData.courses)) {
    // In-memory is authoritative within one warm instance; Blob is the
    // persistent copy. Re-read Blob when a token exists so a redeploy
    // (cold start) picks up saved data.
    if (!process.env.BLOB_READ_WRITE_TOKEN) return memoryData;
  }
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    // Vercel Blob reads can lag a fresh write by a moment (list/get are
    // eventually consistent across instances). A login right after a
    // signup on another phone/instance used to read the OLD data.json and
    // fail with "Wrong login details" — so retry the read a few times
    // before giving up. NEVER seed-overwrite here: if the list comes back
    // empty transiently, wiping Blob with a fresh seed would delete the
    // PIN, users, courses and orders.
    //
    // Two extra guards (live-proven 2026-11-27: rapid writes forked the
    // data — a rating vanished, a hide flag read back false, a deleted
    // account's order survived — because reads flapped between keys):
    // 1. Newest-first is by (uploadedAt, KEY NAME). The key name embeds
    //    a millisecond timestamp, so it orders reliably even when
    //    uploadedAt is missing or ties — sorting by uploadedAt alone
    //    made reads flap between divergent keys.
    // 2. opts.settle (mutating handlers): list a few times with gaps and
    //    only proceed once the newest key is stable, so a save is never
    //    based on a list that has not seen the previous write yet.
    // 3. A _seq marker on the data: if this warm instance last saved a
    //    NEWER seq than the key we just fetched, the fetch is stale and
    //    the in-memory copy wins.
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const blob = await blobApi(); if (!blob) throw new Error("no blob package");
        const settleRounds = opts.settle ? 3 : 1;
        let candidates = [];
        let prevTop = "";
        for (let round = 0; round < settleRounds; round++) {
          const { blobs } = await blob.list({ prefix: DATA_PREFIX, limit: 100 });
          const list = blobs || [];
          const versioned = list.filter((b) => VERSIONED_KEY.test(b.pathname || ""));
          versioned.sort((a, b) => {
            const t = new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0);
            if (t) return t;
            return String(b.pathname || "").localeCompare(String(a.pathname || ""));
          });
          const legacy = list.find((b) => (b.pathname || "") === DATA_KEY);
          const roundCands = versioned.length ? versioned.slice(0, 5) : (legacy ? [legacy] : []);
          const seen = new Set(candidates.map((c) => c.pathname));
          roundCands.forEach((c) => { if (!seen.has(c.pathname)) { candidates.push(c); seen.add(c.pathname); } });
          candidates.sort((a, b) => {
            const t = new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0);
            if (t) return t;
            return String(b.pathname || "").localeCompare(String(a.pathname || ""));
          });
          if (!opts.settle) break;
          const top = candidates.length ? candidates[0].pathname : "";
          if (round > 0 && top === prevTop) break;
          prevTop = top;
          if (round < settleRounds - 1) await new Promise((res) => setTimeout(res, 700));
        }
        let loaded = null;
        for (const cand of candidates) {
          try {
            const r = await fetch(cand.url + (cand.url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
            const data = await r.json();
            if (data && Array.isArray(data.courses)) { loaded = data; break; }
          } catch (e) { /* try the next candidate */ }
        }
        if (loaded) {
          if (memoryData && Array.isArray(memoryData.courses) && (Number(memoryData._seq) || 0) > (Number(loaded._seq) || 0)) {
            return ensureData(memoryData);
          }
          memoryData = ensureData(loaded); return memoryData;
        }
        lastErr = new Error(candidates.length ? "bad data in blob" : "data.json not listed yet");
      } catch (e) { lastErr = e; }
      if (attempt < 2) await new Promise((res) => setTimeout(res, attempt === 0 ? 500 : 1200));
    }
    // Blob read failed (transient): serve in-memory only if we have it.
    if (memoryData && Array.isArray(memoryData.courses)) return ensureData(memoryData);
    if (lastErr && String(lastErr.message || "").indexOf("not listed") === -1) {
      // Blob exists but is unreadable right now — serve a throwaway seed
      // WITHOUT saving it, so a later good read is not wiped out.
      const seed = seedData();
      memoryData = seed;
      return seed;
    }
    // Truly first run (no blob after retries, no memory): seed and save.
    const seed = seedData();
    memoryData = seed;
    await saveData(seed);
    return seed;
  }
  const seed = seedData();
  memoryData = seed;
  return seed;
}

// Re-read Blob from scratch, ignoring the warm instance's memory copy.
// Used by login/signup so a user created a moment ago on another
// instance/phone is found even while Blob is still propagating.
export async function reloadFresh() {
  memoryData = null;
  return loadData({ forceFresh: true, settle: true });
}

export async function saveData(data) {
  // Monotonic marker: lets a warm instance tell a stale Blob read from a
  // fresh one (see loadData guard 3).
  data._seq = (Number(data._seq) || 0) + 1;
  data._savedAt = Date.now();
  memoryData = data;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const blob = await blobApi(); if (!blob) return false;
      // New unique key per save — never overwrite the same key (see note
      // at the top: the edge cache serves stale overwrites for minutes).
      const key = "data-" + Date.now().toString(36) + "-" + crypto.randomBytes(3).toString("hex") + ".json";
      await blob.put(key, JSON.stringify(data), { access: "public", addRandomSuffix: false });
      return true;
    }
    catch (e) { return false; /* in-memory copy still works for this instance, but the caller must know it did NOT persist */ }
  }
  return true;
}

export function parseDriveId(link) {
  if (!link) return null;
  const m1 = String(link).match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = String(link).match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m2 ? m2[1] : null;
}
export function driveThumbnail(link) {
  const id = parseDriveId(link);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w800` : null;
}
export function driveViewUrl(link) {
  const id = parseDriveId(link);
  return id ? `https://drive.google.com/file/d/${id}/view?usp=sharing` : String(link || "");
}
function scryptHash(pin, salt) { return crypto.scryptSync(String(pin), salt, 64).toString("hex"); }
export function makePinRecord(pin) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: scryptHash(pin, salt) };
}
export function checkPin(pin, record) {
  if (!record || !record.salt || !record.hash) return false;
  const a = Buffer.from(scryptHash(pin, record.salt), "hex");
  const b = Buffer.from(record.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function makeSession() {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, record: { hash, expiresAt: Date.now() + 7 * 24 * 3600 * 1000 } };
}
// Stateless admin token: HMAC over (expiry + pin hash). No session record
// needs to survive in Blob, so a stale Blob read can never log the admin out.
export function makeAdminToken(pinRecord) {
  const expiresAt = Date.now() + 7 * 24 * 3600 * 1000;
  const sig = crypto.createHmac("sha256", String(pinRecord.salt) + ":" + String(pinRecord.hash)).update(String(expiresAt)).digest("hex");
  return expiresAt + "." + sig;
}
export function checkAdminToken(token, pinRecord) {
  if (!token || !pinRecord || !pinRecord.salt || !pinRecord.hash) return false;
  const parts = String(token).split(".");
  if (parts.length !== 2) return false;
  const expiresAt = Number(parts[0]);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
  const sig = crypto.createHmac("sha256", String(pinRecord.salt) + ":" + String(pinRecord.hash)).update(String(expiresAt)).digest("hex");
  const a = Buffer.from(sig, "hex"); const b = Buffer.from(parts[1], "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// ---- user accounts: salted scrypt password, stateless HMAC session token ----
// Same pattern as the admin token: no session record is stored in Blob, so a
// stale Blob read can never log a user out (that was the old "Session expired" bug).
export function normalizeContact(v) {
  var d = String(v || "").toLowerCase().replace(/[^a-z0-9@._-]/g, "");
  if (/^\d+$/.test(d)) {
    if (d.length === 12 && d.indexOf("91") === 0) d = d.slice(2);
    else if (d.length === 11 && d.indexOf("0") === 0) d = d.slice(1);
  }
  return d;
}
export function makePasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: scryptHash(password, salt) };
}
export function checkPassword(password, record) {
  if (!record || !record.salt || !record.hash) return false;
  const a = Buffer.from(scryptHash(password, record.salt), "hex");
  const b = Buffer.from(record.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function makeUserToken(user) {
  const expiresAt = Date.now() + 7 * 24 * 3600 * 1000;
  const sig = crypto.createHmac("sha256", String(user.pass.salt) + ":" + String(user.pass.hash)).update(String(user.id) + ":" + String(expiresAt)).digest("hex");
  return user.id + "." + expiresAt + "." + sig;
}
export function checkUserToken(token, users) {
  if (!token || !Array.isArray(users)) return null;
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  const user = users.find((u) => String(u.id) === String(parts[0]));
  if (!user || !user.pass || !user.pass.salt || !user.pass.hash) return null;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  const sig = crypto.createHmac("sha256", String(user.pass.salt) + ":" + String(user.pass.hash)).update(String(user.id) + ":" + String(expiresAt)).digest("hex");
  let a, b;
  try { a = Buffer.from(sig, "hex"); b = Buffer.from(parts[2], "hex"); } catch { return null; }
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return user;
}
export function publicUser(u) { return { id: u.id, name: u.name, contact: u.contact, mobile: u.mobile || "", telegram: u.telegram || "", createdAt: u.createdAt }; }
export function checkToken(token, session) {
  if (!token || !session || !session.hash) return false;
  if (Date.now() > session.expiresAt) return false;
  const hash = crypto.createHash("sha256").update(String(token)).digest("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(session.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function bearerToken(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
export function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}
export function sendJson(res, data, status = 200) { res.status(status).json(data); }
export function sendErr(res, message, status = 400) { res.status(status).json({ ok: false, error: message }); }
export function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body;
}
export function publicCourse(c, data) {
  const { driveUrl, telegramChannel, ...rest } = c;
  // Always show REAL numbers: students + rating come from real orders and
  // real buyer ratings, never from any stored rating/students field.
  if (data) {
    const s = courseStats(data, c.id);
    rest.students = s.students; rest.ratingAvg = s.ratingAvg; rest.ratingCount = s.ratingCount;
  } else {
    rest.students = 0; rest.ratingAvg = null; rest.ratingCount = 0;
  }
  delete rest.rating;
  return rest;
}
export function publicSettings(data) { return (data && data.settings) || { telegramUrl: "https://t.me/+jUiC3D_slQI3ZjY1" }; }
export function newId(prefix) { return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`; }

// /api/admin — PIN/token gated seller actions.
import { loadData, saveData, seedData, ensureData, makePinRecord, checkPin, makeAdminToken, checkAdminToken, bearerToken, parseDriveId, driveThumbnail, driveViewUrl, cors, sendJson, sendErr, readBody, newId } from "./shared.js";
function needAuth(data, req) { return checkAdminToken(bearerToken(req), data.admin.pin); }
function cleanCourse(input, existing) {
  const price = Number(input.price);
  const course = { ...(existing || {}), id: (existing && existing.id) || newId("crs"),
    title: String(input.title || "").trim(), category: String(input.category || "Programming").trim(),
    price: Number.isFinite(price) && price >= 0 ? price : 0, oldPrice: Number(input.oldPrice) || 0,
    // Ratings / student counts are NEVER set by the seller — they are
    // computed from real orders and real buyer ratings only.
    rating: null, students: 0,
    duration: String(input.duration || "10 hours"), lessons: Number(input.lessons) || 10,
    level: String(input.level || "Beginner"), instructor: String(input.instructor || "iSkill World"),
    description: String(input.description || ""),
    includes: Array.isArray(input.includes) ? input.includes.map(String) : String(input.includes || "").split("\n").map((s) => s.trim()).filter(Boolean),
    free: Number(input.price) === 0 || input.free === true,
    cover: String(input.cover || (existing && existing.cover) || ""),
    coverKind: input.cover ? "image" : ((existing && existing.coverKind) || "gradient"),
    driveUrl: String(input.driveUrl || (existing && existing.driveUrl) || ""),
    telegramChannel: String(input.telegramChannel || (existing && existing.telegramChannel) || ""),
    demoVideo: String(input.demoVideo || (existing && existing.demoVideo) || "").trim(),
    demoTelegram: String(input.demoTelegram || (existing && existing.demoTelegram) || "").trim(),
    createdAt: (existing && existing.createdAt) || new Date().toISOString() };
  if (!course.title) throw new Error("Course title is required");
  if (course.cover && course.cover.length > 2000000) throw new Error("Cover image is too large (max ~1.5 MB after upload)");
  return course;
}
export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const data = ensureData(await loadData({ settle: true }));
    if (req.method === "GET") {
      if (req.query && req.query.action === "status") return sendJson(res, { ok: true, pinSet: !!data.admin.pin });
      return sendErr(res, "Use POST for admin actions", 405);
    }
    if (req.method !== "POST") return sendErr(res, "Method not allowed", 405);
    const body = readBody(req);
    const action = body.action;
    if (action === "setPin") {
      const pin = String(body.pin || "");
      if (pin.length < 4 || pin.length > 12) return sendErr(res, "PIN must be 4–12 characters");
      if (data.admin.pin && !needAuth(data, req)) return sendErr(res, "Enter your current PIN first (verify, then change it)", 401);
      data.admin.pin = makePinRecord(pin); data.admin.session = null;
      await saveData(data);
      return sendJson(res, { ok: true, message: "PIN saved. Verify it to open the panel." });
    }
    if (action === "verifyPin") {
      if (!data.admin.pin) return sendErr(res, "No PIN set yet — create one first", 400);
      if (!checkPin(body.pin, data.admin.pin)) return sendErr(res, "Wrong PIN", 401);
      const token = makeAdminToken(data.admin.pin);
      return sendJson(res, { ok: true, token });
    }
    if (!needAuth(data, req)) return sendErr(res, "Admin is locked — verify your PIN", 401);
    if (action === "lock") { data.admin.session = null; await saveData(data); return sendJson(res, { ok: true }); }
    if (action === "list") return sendJson(res, { ok: true, categories: data.categories, courses: data.courses, orders: data.orders, ratings: data.ratings || [], users: (data.users || []).map((u) => ({ id: u.id, name: u.name, contact: u.contact, createdAt: u.createdAt })), settings: data.settings || {} });
    if (action === "saveSettings") {
      const s = body.settings || {};
      data.settings = { ...(data.settings || {}), telegramUrl: String(s.telegramUrl || data.settings?.telegramUrl || "https://t.me/+jUiC3D_slQI3ZjY1"), tagline: String(s.tagline || data.settings?.tagline || ""), featuredCourseId: String(s.featuredCourseId || data.settings?.featuredCourseId || "") };
      await saveData(data);
      return sendJson(res, { ok: true, settings: data.settings });
    }
    if (action === "createCourse") {
      const course = cleanCourse(body.course || {});
      if (!data.categories.includes(course.category)) data.categories.push(course.category);
      data.courses.unshift(course); await saveData(data);
      return sendJson(res, { ok: true, course });
    }
    if (action === "updateCourse") {
      const i = data.courses.findIndex((c) => c.id === body.id);
      if (i < 0) return sendErr(res, "Course not found", 404);
      const course = cleanCourse(body.course || {}, data.courses[i]);
      if (!data.categories.includes(course.category)) data.categories.push(course.category);
      data.courses[i] = course; await saveData(data);
      return sendJson(res, { ok: true, course });
    }
    if (action === "deleteCourse") {
      const before = data.courses.length;
      data.courses = data.courses.filter((c) => c.id !== body.id);
      if (data.courses.length === before) return sendErr(res, "Course not found", 404);
      const removedOrders = data.orders.filter((o) => o.courseId === body.id).length;
      data.orders = data.orders.filter((o) => o.courseId !== body.id);
      await saveData(data);
      return sendJson(res, { ok: true, removedOrders });
    }
    if (action === "clearAllCourses") {
      // Fresh start: removes ALL courses from the catalog ONLY.
      // Orders, users, ratings, the admin PIN and settings are untouched.
      // Use "Restore sample courses" afterwards to bring the 8 samples back.
      const cleared = data.courses.length;
      data.courses = [];
      await saveData(data);
      return sendJson(res, { ok: true, cleared });
    }
    if (action === "removeOrder") {
      // Admin only: permanently removes ONE order record (e.g. a test or
      // bogus order). If it was approved, the buyer's access to that
      // course ends too, and their rating for that course is removed.
      // Nothing else is touched. This is the ONLY way an order record
      // is deleted — buyers can only hide history, never delete.
      const i = data.orders.findIndex((x) => String(x.id) === String(body.id));
      if (i < 0) return sendErr(res, "Order not found", 404);
      const o = data.orders[i];
      data.orders.splice(i, 1);
      data.ratings = (data.ratings || []).filter((r) => !(String(r.courseId) === String(o.courseId) && String(r.userId) === String(o.userId)));
      await saveData(data);
      return sendJson(res, { ok: true, removed: o.code || o.id });
    }
    if (action === "driveImport") {
      const driveUrl = String(body.driveUrl || "");
      const id = parseDriveId(driveUrl);
      if (!id) return sendErr(res, "That does not look like a Google Drive file link");
      const course = cleanCourse({ title: String(body.title || "Drive Course").trim(), category: String(body.category || "Programming"), price: Number(body.price) || 0, description: "Imported from Google Drive.", includes: ["Drive video / material", "Lifetime access"], driveUrl: driveViewUrl(driveUrl), cover: driveThumbnail(driveUrl) || "" });
      if (!data.categories.includes(course.category)) data.categories.push(course.category);
      data.courses.unshift(course); await saveData(data);
      return sendJson(res, { ok: true, course });
    }
    if (action === "listOrders") return sendJson(res, { ok: true, orders: data.orders });
    // Admin history clearing: hides an order from the ADMIN's list only.
    // It never deletes the order, never cancels it and never removes the
    // buyer's course access — the order is still in the data and can be
    // shown again with unhideOrder. Approve / Reject / Cancel keep
    // working on hidden orders too (via the cleared-history view).
    if (action === "hideOrder" || action === "unhideOrder" || action === "hideAllOrders") {
      if (action === "hideAllOrders") {
        data.orders.forEach((o) => { o.hiddenByAdmin = true; });
      } else {
        const o = data.orders.find((x) => String(x.id) === String(body.id));
        if (!o) return sendErr(res, "Order not found", 404);
        o.hiddenByAdmin = action === "hideOrder";
      }
      await saveData(data);
      return sendJson(res, { ok: true });
    }
    if (action === "approveOrder" || action === "rejectOrder" || action === "cancelOrder") {
      const o = data.orders.find((x) => x.id === body.id);
      if (!o) return sendErr(res, "Order not found", 404);
      o.status = action === "approveOrder" ? "approved" : (action === "cancelOrder" ? "cancelled" : "rejected");
      const course = data.courses.find((c) => c.id === o.courseId);
      if (course) { o.driveUrl = course.driveUrl || ""; o.telegramChannel = course.telegramChannel || ""; }
      await saveData(data);
      return sendJson(res, { ok: true, order: o });
    }
    return sendErr(res, "Unknown admin action: " + action, 400);
  } catch (e) { return sendErr(res, "Admin failed: " + e.message, 500); }
}

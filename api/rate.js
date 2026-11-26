// /api/rate — buyer ratings. Only a buyer who OWNS the course (approved
// order) can rate it. One rating per buyer per course: rating again
// updates the old one, never duplicates. Averages are computed from
// real ratings only — there is no fake rating anywhere.
import { loadData, saveData, ensureData, checkUserToken, bearerToken, newId, cors, sendJson, sendErr, readBody, courseStats } from "./shared.js";
export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const data = ensureData(await loadData({ settle: true }));
    if (req.method === "GET") {
      const courseId = (req.query && req.query.courseId) || "";
      const course = data.courses.find((c) => String(c.id) === String(courseId));
      if (!course) return sendErr(res, "Course not found", 404);
      const s = courseStats(data, courseId);
      const user = checkUserToken(bearerToken(req), data.users);
      const mine = user ? (data.ratings || []).find((r) => String(r.courseId) === String(courseId) && String(r.userId) === String(user.id)) : null;
      const list = (data.ratings || []).filter((r) => String(r.courseId) === String(courseId)).map((r) => ({ userName: r.userName || "Buyer", stars: r.stars, text: r.text || "", createdAt: r.createdAt })).slice(-20).reverse();
      return sendJson(res, { ok: true, ratingAvg: s.ratingAvg, ratingCount: s.ratingCount, students: s.students, myRating: mine ? { stars: mine.stars, text: mine.text || "" } : null, ratings: list });
    }
    if (req.method !== "POST") return sendErr(res, "Method not allowed", 405);
    const user = checkUserToken(bearerToken(req), data.users);
    if (!user) return sendErr(res, "Please login to rate this course.", 401);
    const body = readBody(req);
    const course = data.courses.find((c) => String(c.id) === String(body.courseId));
    if (!course) return sendErr(res, "Course not found", 404);
    const owns = (data.orders || []).find((o) => String(o.userId) === String(user.id) && String(o.courseId) === String(course.id) && String(o.status || "").toLowerCase() === "approved");
    if (!owns) return sendErr(res, "Only buyers who own this course can rate it.", 403);
    const stars = Number(body.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return sendErr(res, "Please choose 1 to 5 stars.");
    const text = String(body.text || "").trim().slice(0, 500);
    const ex = (data.ratings || []).find((r) => String(r.courseId) === String(course.id) && String(r.userId) === String(user.id));
    if (ex) { ex.stars = stars; ex.text = text; ex.updatedAt = new Date().toISOString(); }
    else data.ratings.push({ id: newId("rat"), courseId: course.id, userId: user.id, userName: user.name || "Buyer", stars, text, createdAt: new Date().toISOString() });
    const saved = await saveData(data);
    if (!saved) return sendErr(res, "Could not save your rating right now — please try again.", 500);
    const s = courseStats(data, course.id);
    return sendJson(res, { ok: true, ratingAvg: s.ratingAvg, ratingCount: s.ratingCount, students: s.students, myRating: { stars, text } });
  } catch (e) { return sendErr(res, "Rating failed: " + e.message, 500); }
}

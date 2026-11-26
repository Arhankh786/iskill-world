// GET /api/catalog — public storefront data. Optional ?id=<courseId>.
import { loadData, publicCourse, publicSettings, cors, sendJson, sendErr } from "./shared.js";
export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const data = await loadData();
    const id = req.query && req.query.id;
    if (id) {
      const course = data.courses.find((c) => c.id === id);
      if (!course) return sendErr(res, "Course not found", 404);
      return sendJson(res, { ok: true, course: publicCourse(course, data), settings: publicSettings(data) });
    }
    return sendJson(res, { ok: true, categories: data.categories, courses: data.courses.map((c) => publicCourse(c, data)), settings: publicSettings(data), counts: { courses: data.courses.length, categories: data.categories.length } });
  } catch (e) { return sendErr(res, "Catalog failed: " + e.message, 500); }
}

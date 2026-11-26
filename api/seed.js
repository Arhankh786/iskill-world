// GET /api/seed — check seed. POST { force:true } (admin token) re-seeds.
import { loadData, saveData, seedData, cors, sendJson, sendErr, readBody, bearerToken, checkAdminToken } from "./shared.js";
export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const data = await loadData({ settle: true });
    if (req.method === "GET") return sendJson(res, { ok: true, seeded: true, courses: data.courses.length, categories: data.categories.length, orders: data.orders.length });
    if (req.method === "POST") {
      const body = readBody(req);
      if (!body.force) return sendErr(res, "Pass { force:true } to re-seed");
      if (!checkAdminToken(bearerToken(req), data.admin.pin)) return sendErr(res, "Admin is locked — verify your PIN", 401);
      const seed = seedData(); data.categories = seed.categories; data.courses = seed.courses;
      await saveData(data);
      return sendJson(res, { ok: true, courses: data.courses.length, categories: data.categories.length });
    }
    return sendErr(res, "Method not allowed", 405);
  } catch (e) { return sendErr(res, "Seed failed: " + e.message, 500); }
}

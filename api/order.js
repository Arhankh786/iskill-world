// /api/order — user-token gated. A user can ONLY see / place their own orders.
// No public lookup by contact/number any more (that was the privacy hole).
import { loadData, saveData, ensureData, checkUserToken, bearerToken, newId, cors, sendJson, sendErr, readBody } from "./shared.js";
function mineView(o) {
  return { id: o.id, code: o.code, courseId: o.courseId, courseTitle: o.courseTitle, status: o.status, createdAt: o.createdAt, amount: o.amount || 0, driveUrl: o.status === "approved" ? o.driveUrl : "", telegramChannel: o.status === "approved" ? (o.telegramChannel || "") : "" };
}
export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const data = ensureData(await loadData());
    const user = checkUserToken(bearerToken(req), data.users);
    if (!user) return sendErr(res, "Please login to continue.", 401);
    if (req.method === "GET") {
      const mine = data.orders.filter((o) => String(o.userId) === String(user.id)).map(mineView);
      return sendJson(res, { ok: true, orders: mine });
    }
    if (req.method !== "POST") return sendErr(res, "Method not allowed", 405);
    const body = readBody(req);
    const course = data.courses.find((c) => c.id === body.courseId);
    if (!course) return sendErr(res, "Course not found", 404);
    // No re-purchase: an approved buyer never buys the same course again.
    if (data.orders.find((o) => String(o.userId) === String(user.id) && String(o.courseId) === String(course.id) && o.status === "approved"))
      return sendErr(res, "You already own this course", 409);
    const name = String(body.name || user.name || "").trim();
    if (name.length < 2) return sendErr(res, "Name is required");
    const order = { id: newId("ord"), code: "ORD-" + String(1000 + data.orders.length + 1), courseId: course.id, courseTitle: course.title, userId: user.id, name, contact: user.contact, email: user.contact.indexOf("@") > 0 ? user.contact : (body.email || ""), amount: Number(course.price) || 0, status: course.free ? "approved" : "pending", driveUrl: course.driveUrl || "", telegramChannel: course.telegramChannel || "", createdAt: new Date().toISOString() };
    data.orders.push(order);
    await saveData(data);
    return sendJson(res, { ok: true, order: mineView(order) });
  } catch (e) { return sendErr(res, "Order failed: " + e.message, 500); }
}

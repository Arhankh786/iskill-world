// /api/order — user-token gated. A user can ONLY see / place their own orders.
// No public lookup by contact/number any more (that was the privacy hole).
import { loadData, saveData, ensureData, checkUserToken, bearerToken, newId, cors, sendJson, sendErr, readBody, publicUser } from "./shared.js";
function mineView(o) {
  // hiddenByBuyer is a per-buyer history flag only: hiding an order never
  // cancels it and never removes the course from My Courses — the admin
  // still sees the order and can approve/reject it.
  return { id: o.id, code: o.code, courseId: o.courseId, courseTitle: o.courseTitle, status: o.status, createdAt: o.createdAt, amount: o.amount || 0, driveUrl: o.status === "approved" ? o.driveUrl : "", telegramChannel: o.status === "approved" ? (o.telegramChannel || "") : "", name: o.name || "", mobile: o.mobile || "", telegram: o.telegram || "", email: o.email || "", paymentInitiated: !!o.paymentInitiated, paymentInitiatedAt: o.paymentInitiatedAt || "", hiddenByBuyer: !!o.hiddenByBuyer };
}
export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const data = ensureData(await loadData({ settle: true }));
    const user = checkUserToken(bearerToken(req), data.users);
    if (!user) return sendErr(res, "Please login to continue.", 401);
    if (req.method === "GET") {
      const mine = data.orders.filter((o) => String(o.userId) === String(user.id)).map(mineView);
      return sendJson(res, { ok: true, orders: mine, hiddenCount: mine.filter((o) => o.hiddenByBuyer).length });
    }
    if (req.method !== "POST") return sendErr(res, "Method not allowed", 405);
    const body = readBody(req);
    // History clearing: hides an order from THIS buyer's list only.
    // It never cancels the order, never touches the admin's copy and
    // never removes an approved course from My Courses.
    if (body.action === "hide" || body.action === "unhide" || body.action === "hideAll") {
      if (body.action === "hideAll") {
        data.orders.forEach((o) => { if (String(o.userId) === String(user.id)) o.hiddenByBuyer = true; });
      } else {
        const o = data.orders.find((x) => String(x.id) === String(body.id) && String(x.userId) === String(user.id));
        if (!o) return sendErr(res, "Order not found", 404);
        o.hiddenByBuyer = body.action === "hide";
      }
      await saveData(data);
      return sendJson(res, { ok: true });
    }
    // Buyer tapped "Pay on Telegram": record that payment was started
    // (with a timestamp) so the admin can see it on the order. This
    // does NOT change the order status — it stays Pending until the
    // admin approves or rejects it.
    if (body.action === "paymentInitiated") {
      const o = data.orders.find((x) => String(x.id) === String(body.id) && String(x.userId) === String(user.id));
      if (!o) return sendErr(res, "Order not found", 404);
      o.paymentInitiated = true;
      o.paymentInitiatedAt = new Date().toISOString();
      await saveData(data);
      return sendJson(res, { ok: true, order: mineView(o) });
    }
    const course = data.courses.find((c) => c.id === body.courseId);
    if (!course) return sendErr(res, "Course not found", 404);
    // No re-purchase: an approved buyer never buys the same course again.
    if (data.orders.find((o) => String(o.userId) === String(user.id) && String(o.courseId) === String(course.id) && o.status === "approved"))
      return sendErr(res, "You already own this course", 409);
    const name = String(body.name || user.name || "").trim();
    if (name.length < 2) return sendErr(res, "Name is required");
    // Mobile and Telegram are both offered; at least ONE is required,
    // the other is optional. No email is asked at checkout any more —
    // the buyer's email comes from their logged-in account.
    const mobile = String(body.mobile || "").trim();
    const telegram = String(body.telegram || "").trim().replace(/^@+/, "");
    const mobileDigits = mobile.replace(/\D/g, "");
    if (mobileDigits.length < 10 && telegram.length < 3)
      return sendErr(res, "Enter your Telegram ID or Mobile number — either one is required, the other is optional.");
    // A half-typed mobile number is ignored when a valid Telegram ID is given.
    const mobileOk = mobileDigits.length >= 10 ? mobile : "";
    // Remember the buyer's contact on their account so the next checkout
    // can prefill it.
    if (mobileOk) user.mobile = mobileOk;
    if (telegram) user.telegram = telegram;
    const accountEmail = String(user.contact || "").indexOf("@") > 0 ? user.contact : (user.email || "");
    // Order code must stay unique even after orders are removed (e.g. when
    // a course or a buyer account is deleted) — fall back to a
    // timestamp code if the sequential one is already taken.
    let code = "ORD-" + String(1000 + data.orders.length + 1);
    if (data.orders.find((o) => o.code === code)) code = "ORD-" + Date.now().toString(36).toUpperCase();
    const order = { id: newId("ord"), code, courseId: course.id, courseTitle: course.title, userId: user.id, name, contact: mobileOk || (telegram ? "@" + telegram : user.contact), mobile: mobileOk, telegram, email: accountEmail, amount: Number(course.price) || 0, status: course.free ? "approved" : "pending", driveUrl: course.driveUrl || "", telegramChannel: course.telegramChannel || "", paymentInitiated: false, paymentInitiatedAt: "", createdAt: new Date().toISOString() };
    data.orders.push(order);
    await saveData(data);
    return sendJson(res, { ok: true, order: mineView(order), user: publicUser(user) });
  } catch (e) { return sendErr(res, "Order failed: " + e.message, 500); }
}

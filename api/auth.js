// /api/auth — user signup / login / me. Stateless HMAC user tokens (see shared.js).
// Passwords are stored only as salted scrypt hashes, never in plain text.
import { loadData, saveData, ensureData, normalizeContact, makePasswordRecord, checkPassword, makeUserToken, checkUserToken, publicUser, newId, cors, sendJson, sendErr, readBody, bearerToken } from "./shared.js";
function validContact(c) {
  if (!c) return false;
  if (c.indexOf("@") > 0 && c.indexOf(".") > c.indexOf("@")) return true;
  return /^\d{10}$/.test(c);
}
export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const data = ensureData(await loadData());
    if (req.method === "GET") {
      if (req.query && req.query.action === "me") {
        const user = checkUserToken(bearerToken(req), data.users);
        if (!user) return sendErr(res, "Please login again.", 401);
        return sendJson(res, { ok: true, user: publicUser(user) });
      }
      return sendErr(res, "Use POST for signup / login", 405);
    }
    if (req.method !== "POST") return sendErr(res, "Method not allowed", 405);
    const body = readBody(req);
    const action = body.action;
    if (action === "signup") {
      const name = String(body.name || "").trim();
      const contact = normalizeContact(body.contact || "");
      const password = String(body.password || "");
      if (name.length < 2) return sendErr(res, "Please enter your name");
      if (!validContact(contact)) return sendErr(res, "Enter a valid mobile number (10 digits) or email");
      if (password.length < 4 || password.length > 12) return sendErr(res, "Password must be 4–12 characters");
      if (data.users.find((u) => normalizeContact(u.contact) === contact))
        return sendErr(res, "An account already exists with this contact. Try logging in.", 409);
      const user = { id: newId("usr"), name, contact, pass: makePasswordRecord(password), createdAt: new Date().toISOString() };
      data.users.push(user);
      // Link any older guest orders placed with the same contact to this account.
      let linked = 0;
      data.orders.forEach((o) => {
        if (!o.userId && (normalizeContact(o.contact) === contact || String(o.email || "").toLowerCase() === contact)) { o.userId = user.id; linked++; }
      });
      await saveData(data);
      return sendJson(res, { ok: true, token: makeUserToken(user), user: publicUser(user), linkedOrders: linked });
    }
    if (action === "login") {
      const contact = normalizeContact(body.contact || "");
      const password = String(body.password || "");
      const user = data.users.find((u) => normalizeContact(u.contact) === contact);
      if (!user || !checkPassword(password, user.pass))
        return sendErr(res, "Wrong login details. Try again.", 401);
      return sendJson(res, { ok: true, token: makeUserToken(user), user: publicUser(user) });
    }
    return sendErr(res, "Unknown auth action: " + action, 400);
  } catch (e) { return sendErr(res, "Login failed: " + e.message, 500); }
}

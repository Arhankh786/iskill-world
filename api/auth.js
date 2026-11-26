// /api/auth — user signup / login / me. Stateless HMAC user tokens (see shared.js).
// Passwords are stored only as salted scrypt hashes, never in plain text.
import { loadData, saveData, reloadFresh, ensureData, normalizeContact, makePasswordRecord, checkPassword, makeUserToken, checkUserToken, publicUser, newId, cors, sendJson, sendErr, readBody, bearerToken } from "./shared.js";
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
      // Never hand out a token for an account that did not persist: if the
      // Blob write fails, the account would vanish on the next cold start
      // and login from another phone would fail. Fail loudly instead.
      const saved = await saveData(data);
      if (!saved) return sendErr(res, "Could not save your account right now — please try again.", 500);
      return sendJson(res, { ok: true, token: makeUserToken(user), user: publicUser(user), linkedOrders: linked });
    }
    if (action === "login") {
      const contact = normalizeContact(body.contact || "");
      const password = String(body.password || "");
      let data2 = data;
      let user = data2.users.find((u) => normalizeContact(u.contact) === contact);
      // Right after a signup on another phone/instance, Blob reads can
      // lag the write by a few seconds and return the OLD data.json, so a
      // correct login was rejected as "Wrong login details". Re-read Blob
      // fresh with growing gaps (up to ~5s total) before failing.
      let tries = 0;
      while ((!user || !checkPassword(password, user.pass)) && tries < 3) {
        tries++;
        await new Promise((res) => setTimeout(res, 1200 * tries));
        data2 = ensureData(await reloadFresh());
        user = data2.users.find((u) => normalizeContact(u.contact) === contact);
      }
      if (!user || !checkPassword(password, user.pass))
        return sendErr(res, "Wrong login details. Try again.", 401);
      return sendJson(res, { ok: true, token: makeUserToken(user), user: publicUser(user) });
    }
    if (action === "delete") {
      // Delete my own account: password-verified. Removes the user and
      // ALL of their orders (purchased access ends with the account).
      // The admin PIN, courses, settings and other buyers are untouched.
      const user = checkUserToken(bearerToken(req), data.users);
      if (!user) return sendErr(res, "Please login again.", 401);
      const password = String(body.password || "");
      if (!checkPassword(password, user.pass))
        return sendErr(res, "Wrong password — your account was not deleted.", 401);
      data.users = data.users.filter((u) => String(u.id) !== String(user.id));
      data.orders = (data.orders || []).filter((o) => String(o.userId) !== String(user.id));
      const saved = await saveData(data);
      if (!saved) return sendErr(res, "Could not delete your account right now — please try again.", 500);
      return sendJson(res, { ok: true, message: "Account deleted." });
    }
    return sendErr(res, "Unknown auth action: " + action, 400);
  } catch (e) { return sendErr(res, "Login failed: " + e.message, 500); }
}

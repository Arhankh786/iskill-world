iSKILL WORLD 🎀 — Vercel website WITH a real backend
=====================================================
iSkill World — course selling website for the new customer. the earlier site's files
were NOT changed — this is a separate folder/site.

WHAT IS NEW in iSkill World
---------------------------
- Name/logo/hero: iSkill World 🎀, pink/violet theme (was black/orange).
- UI enhanced: softer light theme, pink/violet accents, gradient hero.
- Admin enhanced: Dashboard now shows Courses Live, Total Orders,
  Pending, Approved AND Revenue (approved orders). My Courses has a
  search box. Orders has an All/Pending/Approved/Rejected filter.
- Telegram: the new channel link is set:
  https://t.me/+jUiC3D_slQI3ZjY1 — change it in /admin >
  Settings > Telegram channel link — it goes live instantly, no code
  change. The real channel link is still needed from the user.
- Backend moved Netlify Functions + Blobs -> Vercel Serverless
  Functions (api/) + Vercel Blob (data.json). Frontend calls /api/<name>.

HOW THE BACKEND WORKS
---------------------
- api/catalog.js (public list), api/order.js (place order / my orders),
  api/admin.js (PIN set/verify, courses, Drive import, approve/reject,
  saveSettings), api/seed.js (re-seed samples).
- All data in ONE Blob key "data.json": categories, courses, orders,
  admin PIN (salted scrypt hash only) + session token hash, settings
  (telegramUrl, tagline).
- If the Blob store is NOT linked yet (no BLOB_READ_WRITE_TOKEN),
  the site still shows the 8 sample courses from in-memory seed data,
  but admin changes will NOT persist across redeploys/cold starts.
  Link the Blob store (step 3 below) to make it permanent.

VERCEL IS FREE — AND NO LOGO
----------------------------
Vercel Hobby plan is FREE. No Vercel logo/badge is shown on your site.
Free limits are plenty for a small course store (100 GB-hours of
function execution/month on Hobby). Drag-and-drop on vercel.com does
NOT deploy functions — use the CLI (Option A) or Git import (Option B).

DEPLOY — OPTION A: VERCEL CLI (recommended, Termux, ~5 minutes)
---------------------------------------------------------------
1. Termux me is folder me jao:
       cd ~/iskill-world-vercel
       npm install
       npm install -g vercel
2. Login + deploy:
       vercel login
       vercel --prod
   Pehli baar poochhega: project name -> iskill-world, framework -> Other.
3. BLOB STORE LINK KARO (warna data save nahi hoga):
   Vercel dashboard (vercel.com) > apna project > Storage > Create >
   Blob > naam do (iskill-blob) > Create. Phir "Connect Project" se
   iskill-world choose karo — BLOB_READ_WRITE_TOKEN khud set ho jayega.
   Phir ek baar redeploy karo:  vercel --prod
4. Site name: dashboard > project > Settings > Domains — ya CLI me
   project name iskill-world rakho, to site hogi:
   https://iskill-world.vercel.app  (agar naam free hai to)
   Admin: https://iskill-world.vercel.app/admin

DEPLOY — OPTION B: GIT (no CLI after setup)
-------------------------------------------
1. Is folder ko GitHub repo me upload karo.
2. Vercel dashboard > Add New > Project > repo choose karo.
   Framework: Other. Build command: (blank). Output directory: .
   Deploy karo. Phir step 3 (Blob store) upar wala karo.

FIRST STEPS AFTER DEPLOY
------------------------
1. Site kholo — 8 sample courses dikhne chahiye, "Demo mode" notice
   NAHI aana chahiye. Agar notice aaye, to functions deploy nahi hue —
   CLI se dobara deploy karo.
2. /admin kholo — PIN banao (4-12 characters).
3. /admin > Settings me ASLI Telegram channel link daalo
   (abhi yehi link set hai).
4. Course add karo (Add Course / Drive Import). Dusri tab me store
   kholo — course turant dikhega, dobara upload nahi karna.

FILES IN THIS FOLDER
--------------------
index.html        Storefront + admin (single file, pink/violet theme)
vercel.json       /admin -> /index.html rewrite
package.json      @vercel/blob dependency
api/shared.js     Blob store, seed data, PIN/token, Drive parsing
api/catalog.js    Public course list (no Drive links exposed)
api/order.js      Place order / buyer's orders
api/admin.js      PIN + all seller actions + saveSettings
api/seed.js       Seed / re-seed the 8 sample courses

HONEST LIMITS
-------------
- Payment gateway is NOT built yet — orders are "pending" until the
  seller approves them after confirming payment on Telegram.
- Blob is one JSON document; fine for a small store, not for thousands
  of concurrent orders. If two admins edit at the exact same second,
  the last write wins.
- Cover images are downscaled in the browser (max 800px JPEG).

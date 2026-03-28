# Production deployment checklist

This document matches the work done in the codebase and what you must do in hosting accounts (GitHub, Firebase, Vercel, Railway, Lemon Squeezy, DNS).

## Go live on a public domain (order of operations)

You need **two deployed URLs** plus **DNS**:

| Piece | Example | Role |
|--------|---------|------|
| **Frontend** | `https://www.yourdomain.com` | Static React app (Vite `dist`) |
| **Backend API** | `https://api.yourdomain.com` | Express (`server.js`), `/api/*`, webhooks |

1. **Buy a domain** (Cloudflare Registrar, Namecheap, Google Domains, etc.). You will add DNS records in that provider (or move DNS to Cloudflare and point from there).

2. **Push this project to GitHub** (see §1). Hosts deploy from git.

3. **Deploy the backend** to something like [Railway](https://railway.app), [Render](https://render.com), or [Fly.io](https://fly.io). Use the Dockerfile from the repo root **after** `npm install && npm run build` (see §3). Set production env vars: `FIREBASE_SERVICE_ACCOUNT_JSON`, `PUBLIC_BACKEND_URL=https://api.yourdomain.com`, `CORS_ORIGINS=https://www.yourdomain.com,https://yourdomain.com`, `NODE_ENV=production`, secrets from `backend/.env.example`. In the host’s UI, attach custom hostname **`api.yourdomain.com`** and note the DNS target they give you (usually a **CNAME**).

4. **Deploy the frontend** on [Vercel](https://vercel.com), [Netlify](https://netlify.com), or [Cloudflare Pages](https://pages.cloudflare.com): connect the repo, build command **`npm run build`**, output directory **`dist`**, environment variable **`VITE_API_URL=https://api.yourdomain.com`** (no trailing slash). Add custom domain **`www.yourdomain.com`** (and/or apex `yourdomain.com` per host docs).

5. **DNS at your registrar** (values come from Vercel + Railway—use what each dashboard shows):
   - **`api`** → CNAME to your API host’s target (e.g. `xxx.up.railway.app` or similar).
   - **`www`** → CNAME to Vercel/Netlify/Cloudflare (e.g. `cname.vercel-dns.com`).
   - **Apex** `@` → often an **A** record or **ALIAS** to your frontend host (Vercel/Cloudflare explain this).

   Wait for SSL to provision (often automatic after DNS propagates, can take minutes to hours).

6. **Align config**: Backend `CORS_ORIGINS` must list your real site origins. Rebuild/redeploy the frontend if you change `VITE_API_URL`. Deploy Firestore rules (`firebase deploy --only firestore:rules`) if you use Firebase.

7. **Payments**: When Lemon Squeezy approves you, set webhook `https://api.yourdomain.com/api/webhooks/lemonsqueezy` and `LEMONSQUEEZY_WEBHOOK_SECRET` (§3).

That’s the full path from “localhost” to **www + api on your domain**. Details below are the same steps with more context.

## What the code already does

- **CORS**: Set `CORS_ORIGINS` to your frontend URL(s). If unset, all origins are allowed (dev-friendly only).
- **Rate limiting**: Global `/api` limit + stricter limits on `/api/analyze` and `/api/unlock-potential`.
- **Uploads**: Unique filenames under `backend/uploads/`, JPEG/PNG/WebP only, size limit via `UPLOAD_MAX_BYTES`.
- **Optional Firebase Storage**: Set `UPLOAD_TO_FIREBASE_STORAGE=true` to upload each processed image to the default bucket and delete the local file (requires Storage API enabled and rules that allow Admin SDK writes).
- **Admin analytics**: Stored in Firestore document `system/adminStore` when Firebase is configured; falls back to `admin-data.json` if Firestore is unavailable or `ADMIN_DATA_SOURCE=file`.
- **Firebase Admin**: Supports `FIREBASE_SERVICE_ACCOUNT_JSON` (full JSON string) for production hosts.
- **Python**: Uses `PYTHON_PATH` if set; otherwise Windows `venv\Scripts\python.exe` or Linux `venv/bin/python3`.
- **Public API URL**: Set `PUBLIC_BACKEND_URL` so `videoUrl` in analyze responses points at your real API (not localhost).
- **Loading video URL**: Optional `LOADING_VIDEO_URL` (full URL to the MP4). If unset, the API uses `PUBLIC_BACKEND_URL` + `/loading_scan.mp4`.
- **Health**: `GET /api/health` and `GET /health` return JSON with `ok`, `service`, `uptimeMs`, `timestamp`.
- **Readiness**: `GET /api/ready` checks Firestore (`system/adminStore`); returns **503** if Firestore is unreachable (use for orchestration probes).
- **Debug endpoint**: In `NODE_ENV=production`, `/api/debug-log` returns 404 unless `DEBUG_LOG_TOKEN` is set; requests must send header `x-debug-token: <token>`.

## 1. GitHub (repo already exists)

The project is meant to live in a GitHub repo you already use. **Do not commit** `backend/.env` (it is in `.gitignore`).

Push updates from your machine:

```powershell
cd "C:\Users\Laith abu amsheh\Desktop\website-code"
git add .
git commit -m "Describe your change"
git push origin main
```

If you are setting up a **new** remote for the first time only: `git remote add origin https://github.com/consistentlyimpressive-cloud/website-code.git` then `git push -u origin main`.

Quick production steps (domain + GitHub already in place): **[.github/WEBSITE.md](.github/WEBSITE.md)**.

## 2. Firebase

1. **Service account**: Firebase Console → Project settings → Service accounts → Generate new private key.  
2. On the backend host, set env var `FIREBASE_SERVICE_ACCOUNT_JSON` to the **entire JSON** as one line (or use secret file mounting per host docs).  
3. **Firestore rules**: The repo includes `firestore.rules` (users can read their own doc; `system/**` is server-only). From the repo root, with [Firebase CLI](https://firebase.google.com/docs/cli) and `firebase login`:

   ```bash
   firebase deploy --only firestore:rules
   ```

   Ensure `firebase.json` points at `firestore.rules` (already in this repo).

4. **Storage** (only if using `UPLOAD_TO_FIREBASE_STORAGE=true`): Enable Storage; Admin SDK bypasses client rules, but ensure the bucket exists (`FIREBASE_STORAGE_BUCKET` if not default).

## 3. Backend hosting (Railway / Render / Fly / VPS)

1. Build Docker image from repo root **after** building the frontend:

   ```bash
   npm install
   npm run build
   docker build -t ascend-backend .
   ```

2. Set all variables from `backend/.env.example` (real secrets on the host, not in git).

3. **Lemon Squeezy (when your vendor account is approved)**: In the Lemon Squeezy dashboard, set the webhook URL to  
   `https://YOUR_API_HOST/api/webhooks/lemonsqueezy`  
   and set `LEMONSQUEEZY_WEBHOOK_SECRET` on the backend to match the signing secret they provide. Until then, subscriptions and webhook-driven plan updates will not run in production.

4. **Loading video**: Ship `loading_scan.mp4` with the container (next to `server.js` in the image) **or** host the MP4 on a CDN and set `LOADING_VIDEO_URL` (full URL). You can also rely on `PUBLIC_BACKEND_URL` + `/loading_scan.mp4` when the file is served from the API host. The file may be gitignored locally.

5. **Probes**: Point uptime monitors at `GET /api/health`; use `GET /api/ready` only if you want Firestore included in the check (may return 503 during outages or misconfiguration).

## 4. Frontend hosting (Vercel / Netlify / Cloudflare Pages)

1. Connect the GitHub repo.  
2. Build command: `npm run build`  
3. Output directory: `dist`  
4. Set **`VITE_API_URL`** to your public API origin, e.g. `https://api.yourdomain.com` (no trailing slash).

## 5. DNS (optional)

- Frontend: `www` / apex → Vercel (or your host).  
- API: `api.yourdomain.com` → backend host.  
- Update `CORS_ORIGINS` and `VITE_API_URL` accordingly.

## 6. Security reminders

- Change `ADMIN_PASSWORD` from any default.  
- Rotate API keys if they were ever exposed.  
- Keep `FIREBASE_SERVICE_ACCOUNT_JSON` and webhook secret only in hosting env vars.

## 7. Local development

- Backend: `cd backend && npm start` (uses `backend/.env`).  
- Frontend: `npm run dev -- --port 5173` with `VITE_API_URL=http://localhost:3001` in `.env.local` if needed.

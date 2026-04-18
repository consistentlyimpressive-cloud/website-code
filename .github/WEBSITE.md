# Website (production)

Assumes this repo is **already on GitHub** and you **already have a domain**. Edit the placeholders below to match yours. Also set **`homepage`**, **`repository`**, and **`bugs`** in root **`package.json`** to your real site and GitHub URLs (they currently use `example.com` / `example/example` as placeholders).

| | Your value |
|---|------------|
| **GitHub repo** | `https://github.com/consistentlyimpressive-cloud/website-code` |
| **Public site** | `https://www.<your-domain>` (or apex `https://<your-domain>`) |
| **API** | `https://api.<your-domain>` |

## 1. Frontend (Vercel, Netlify, or Cloudflare Pages)

1. Import **this repository** from GitHub.
2. Build: **`npm run build`** · Output directory: **`dist`**
3. Environment: **`VITE_API_URL=https://api.<your-domain>`** (no trailing slash)
4. Add your **`www`** (and/or apex) custom domain in the host’s settings and complete DNS as they instruct.

## 2. Backend API (Railway, Render, Fly, etc.)

1. Deploy from the **same repo** (see root **Dockerfile** / `DEPLOYMENT.md` §3 — run `npm install && npm run build` before the image build).
2. Set production env vars from **`backend/.env.example`**, especially:
   - **`PUBLIC_BACKEND_URL=https://api.<your-domain>`**
   - **`CORS_ORIGINS=https://www.<your-domain>,https://<your-domain>`**
   - **`FIREBASE_SERVICE_ACCOUNT_JSON`** (full service account JSON)
  - **`NODE_ENV=production`**, **`ADMIN_PASSWORD`**, **`PADDLE_WEBHOOK_SECRET`** when applicable
3. Attach custom hostname **`api.<your-domain>`** and add the **CNAME** they give you at your DNS provider.

## 3. DNS

At your registrar (or Cloudflare DNS): point **`www`** and **`api`** to the hostnames your frontend and API providers show. Wait for SSL (usually automatic).

## 4. Ship updates

```bash
git add .
git commit -m "Your message"
git push origin main
```

Connected hosts redeploy on push (if you enabled that).

## More detail

- Full checklist: **[DEPLOYMENT.md](../DEPLOYMENT.md)**  
- Paddle webhook: `https://api.<your-domain>/api/webhooks/paddle`

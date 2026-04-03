# Ascend (React + Vite)

## Run locally

1. **Install dependencies** (once), from this folder (`website-code`):

   ```bash
   npm install
   npm --prefix backend install
   ```

2. **Env files** (once): copy examples and adjust if needed.

   ```bash
   npm run setup:local
   ```

   This creates `.env.local` (frontend → `VITE_API_URL=http://localhost:3001`) and `backend/.env` from the examples when those files are missing. Set `ADMIN_PASSWORD` and Firebase in `backend/.env` when you use auth or the API beyond defaults.

3. **Start API + frontend together** (required for scans — the UI calls the local API):

   ```bash
   npm run dev
   ```

   - Site: **http://localhost:5174** (Vite)
   - API: **http://localhost:3001** (Express)

   Frontend only (no scans): `npm run dev:web`. API only: `npm run dev:api`.

4. **Production** (you already have GitHub + a domain): **[.github/WEBSITE.md](.github/WEBSITE.md)** — full reference **[DEPLOYMENT.md](./DEPLOYMENT.md)**.

---

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

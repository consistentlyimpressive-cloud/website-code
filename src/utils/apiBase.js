/**
 * Base URL for API requests (no trailing slash).
 *
 * Local dev: always talk to the Express API on 127.0.0.1:3001 (no reliance on Vite /api proxy).
 * Set VITE_API_URL=https://….trycloudflare.com in .env.local only when you want the local UI to hit a remote tunnel.
 * Production (Vercel): set VITE_API_URL to your public https API URL.
 */
const LOCAL_API = 'http://127.0.0.1:3001';

export function getApiBase() {
  const raw = import.meta.env.VITE_API_URL;
  const trimmed = typeof raw === 'string' ? raw.trim().replace(/\/$/, '') : '';

  if (import.meta.env.DEV) {
    const isLocalUrl =
      !trimmed ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(trimmed);
    if (isLocalUrl) {
      return LOCAL_API;
    }
    return trimmed;
  }

  if (trimmed) return trimmed;
  return LOCAL_API;
}

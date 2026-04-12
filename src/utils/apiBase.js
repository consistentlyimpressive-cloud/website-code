/**
 * Base URL for API requests (no trailing slash).
 *
 * Local dev: always talk to the Express API on 127.0.0.1:3001 (no reliance on Vite /api proxy).
 * Set VITE_API_URL=https://api.mogcheck.net in .env.local only when you want the local UI to hit the public API.
 * Production (Vercel): set VITE_API_URL to your public https API URL.
 */
const LOCAL_API = 'http://127.0.0.1:3001';
const MOGCHECK_PROD_API = 'https://api.mogcheck.net';

function normalizeApiBase(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);

    // Guard against accidentally pasting health/ready endpoints into Vercel env vars.
    url.pathname = url.pathname
      .replace(/\/+$/, '')
      .replace(/\/api\/(health|ready)$/i, '')
      .replace(/\/+$/, '');
    url.search = '';
    url.hash = '';

    return url.toString().replace(/\/$/, '');
  } catch {
    return trimmed.replace(/\/$/, '');
  }
}

export function getApiBase() {
  const trimmed = normalizeApiBase(import.meta.env.VITE_API_URL);

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

  if (typeof window !== 'undefined') {
    const host = String(window.location.hostname || '').toLowerCase();
    if (host === 'mogcheck.net' || host === 'www.mogcheck.net') {
      return MOGCHECK_PROD_API;
    }
  }

  return LOCAL_API;
}

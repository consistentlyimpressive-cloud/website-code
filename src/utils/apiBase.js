/**
 * Base URL for API requests (no trailing slash).
 *
 * - Vite dev: if VITE_API_URL is unset or points at localhost, returns '' so requests use
 *   same-origin `/api/...` and the Vite proxy forwards to the backend (fixes many "Failed to fetch" cases).
 * - Dev with VITE_API_URL=https://….trycloudflare.com: uses that URL (test production API from local UI).
 * - Production: must set VITE_API_URL (e.g. https tunnel or real API host).
 */
export function getApiBase() {
  const raw = import.meta.env.VITE_API_URL;
  const trimmed = typeof raw === 'string' ? raw.trim().replace(/\/$/, '') : '';

  if (import.meta.env.DEV) {
    if (!trimmed || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(trimmed)) {
      return '';
    }
    return trimmed;
  }

  if (trimmed) return trimmed;
  return 'http://localhost:3001';
}

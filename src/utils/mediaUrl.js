import { getApiBase } from './apiBase';

export function resolveMediaUrl(value) {
  if (typeof value !== 'string') return value || null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (/^\/uploads\//i.test(url.pathname)) {
        return `${getApiBase()}${url.pathname}${url.search}`;
      }
    } catch {
      return trimmed;
    }
    return trimmed;
  }

  if (/^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith('/uploads/')) {
    return `${getApiBase()}${trimmed}`;
  }

  return trimmed;
}

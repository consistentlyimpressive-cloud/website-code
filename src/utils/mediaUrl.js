import { getApiBase } from './apiBase';

export function resolveMediaUrl(value) {
  if (typeof value !== 'string') return value || null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed) || /^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith('/uploads/')) {
    return `${getApiBase()}${trimmed}`;
  }

  return trimmed;
}

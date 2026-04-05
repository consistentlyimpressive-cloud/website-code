/** How many videos to show per rotation window */
export const YOUTUBE_BATCH_SIZE = 8;

/** Batch advances every N ms (10 minutes) */
export const YOUTUBE_ROTATION_MS = 10 * 60 * 1000;

/**
 * If RSS provides duration (seconds) and it's at or below this, treat as YouTube Shorts and skip.
 * (Shorts are vertical & capped; long-form is almost always longer.)
 */
export const SHORTS_MAX_DURATION_SEC = 180;

const MRSS_NS = 'http://search.yahoo.com/mrss/';

/**
 * Curated pool: facial aesthetics, looksmaxxing, PSL-adjacent, male beauty, hormones / looks science.
 * Add or remove `channelId`s here to steer what “trending” pulls from.
 */
export const YOUTUBE_CHANNELS = [
  { channelId: 'UCk8JzO451QvD1pU21m0A3rQ', author: 'QOVES Studio' },
  { channelId: 'UC4LgBfA1P_g21eC1Yx21Q9w', author: 'Wheat Waffles' },
  { channelId: 'UC17tS-xT2i4X7L2B_bO7yQw', author: 'Dillon Latham' },
  { channelId: 'UCoR7CHkMETs3ByOv74OAbFw', author: 'More Plates More Dates' },
  { channelId: 'UCLqH-U2TXzj1h7lyYQZLNQQ', author: 'Greg Doucette' },
  { channelId: 'UCB2wtYpfbCpYDc5TeTwuqFA', author: 'Will Tennyson' },
  { channelId: 'UC1KbedtKa3d5dleFR6OjQMg', author: 'alpha m.' },
];

const RSS_TEMPLATE = (channelId) =>
  `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

/** Public CORS proxy or our backend */
function proxied(url) {
  // Use our backend instead of corsproxy.io to avoid blocks in production
  const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
  return `${apiBase}/api/proxy-rss?url=${encodeURIComponent(url)}`;
}

function getDurationSecondsFromEntry(entry) {
  const contents = entry.getElementsByTagNameNS(MRSS_NS, 'content');
  let maxD = 0;
  for (let i = 0; i < contents.length; i++) {
    const raw = contents[i].getAttribute('duration');
    if (raw) {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n) && n > maxD) maxD = n;
    }
  }
  return maxD > 0 ? maxD : null;
}

/** Drop YouTube Shorts: /shorts/ links, #shorts tags, or short duration when RSS exposes it. */
function isYouTubeShort(href, title, durationSec) {
  if (href.includes('/shorts/')) return true;
  if (/#\s*shorts\b/i.test(title)) return true;
  if (durationSec != null && durationSec > 0 && durationSec <= SHORTS_MAX_DURATION_SEC) return true;
  return false;
}

function parseEntry(entry) {
  const titleEl = entry.querySelector('title');
  const title = titleEl?.textContent?.trim() || 'Video';
  const published =
    entry.querySelector('published')?.textContent ||
    entry.querySelector('updated')?.textContent ||
    new Date().toISOString();
  const linkEl =
    entry.querySelector('link[rel="alternate"]') || entry.querySelector('link');
  const href = linkEl?.getAttribute('href') || '';
  const durationSec = getDurationSecondsFromEntry(entry);
  if (isYouTubeShort(href, title, durationSec)) return null;

  const m = href.match(/[?&]v=([^&]+)/);
  let videoId = m?.[1];
  if (!videoId) {
    const idTag = entry.getElementsByTagNameNS('http://www.youtube.com/xml/schemas/2015', 'videoId')[0];
    videoId = idTag?.textContent?.trim();
  }
  if (!videoId) return null;
  return {
    type: 'video',
    title,
    author: '', // filled by caller per channel
    pubDate: new Date(published).toISOString(),
    link: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    videoId,
    durationSec,
  };
}

function parseFeedXml(xmlText, authorLabel) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) return [];
  const entries = doc.querySelectorAll('entry');
  const out = [];
  entries.forEach((entry) => {
    const row = parseEntry(entry);
    if (row) {
      row.author = authorLabel;
      out.push(row);
    }
  });
  return out;
}

/**
 * Fetch latest videos from all configured channels (Atom RSS).
 */
export async function fetchYouTubeFeedFromChannels() {
  const results = await Promise.all(
    YOUTUBE_CHANNELS.map(async ({ channelId, author }) => {
      const url = RSS_TEMPLATE(channelId);
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 25_000);
        const res = await fetch(proxied(url), { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(String(res.status));
        const xml = await res.text();
        return parseFeedXml(xml, author);
      } catch {
        return [];
      }
    })
  );
  const flat = results.flat();
  const byId = new Map();
  flat.forEach((v) => {
    if (!byId.has(v.videoId)) byId.set(v.videoId, v);
  });
  const merged = [...byId.values()];
  merged.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return merged;
}

/**
 * Pick up to `batchSize` **unique** videos for the current window (no duplicate tiles).
 * Rotates start index every `rotationMs`. If the pool has fewer unique videos than `batchSize`, returns fewer.
 */
export function pickVideoBatch(videos, batchSize, rotationMs, now = Date.now()) {
  if (!videos?.length) return [];
  const batchIndex = Math.floor(now / rotationMs);
  const n = videos.length;
  const start = (batchIndex * batchSize) % n;
  const out = [];
  const seen = new Set();
  let i = 0;
  const maxSteps = n * batchSize;
  while (out.length < batchSize && i < maxSteps) {
    const v = videos[(start + i) % n];
    if (!seen.has(v.videoId)) {
      seen.add(v.videoId);
      out.push({ ...v });
    }
    i += 1;
    if (seen.size === n) break;
  }
  return out;
}

/** Last-resort list if RSS / proxy fails (still rotates in 8-slot batches). */
export const STATIC_VIDEO_FALLBACK = [
  {
    type: 'video',
    title: 'Finding Your Perfect Hairstyle Is Surprisingly Easy',
    author: 'QOVES Studio',
    pubDate: '2023-05-14T00:00:00.000Z',
    thumbnail: 'https://i.ytimg.com/vi/yfk0c18xPcE/maxresdefault.jpg',
    link: 'https://www.youtube.com/watch?v=yfk0c18xPcE',
    videoId: 'yfk0c18xPcE',
  },
  {
    type: 'video',
    title: 'What Type Of Eyes Do You Have?',
    author: 'QOVES Studio',
    pubDate: '2023-08-20T00:00:00.000Z',
    thumbnail: 'https://i.ytimg.com/vi/1wUjJjMMVaI/maxresdefault.jpg',
    link: 'https://www.youtube.com/watch?v=1wUjJjMMVaI',
    videoId: '1wUjJjMMVaI',
  },
  {
    type: 'video',
    title: 'The Jawline - Analysing the Perfect Male Face (Part 1/4)',
    author: 'Wheat Waffles',
    pubDate: '2022-02-05T00:00:00.000Z',
    thumbnail: 'https://i.ytimg.com/vi/ZhEuWSXxu5k/maxresdefault.jpg',
    link: 'https://www.youtube.com/watch?v=ZhEuWSXxu5k',
    videoId: 'ZhEuWSXxu5k',
  },
  {
    type: 'video',
    title: 'Midface and Nose - Analysing the Perfect Male Face (Part 2/4)',
    author: 'Wheat Waffles',
    pubDate: '2022-03-02T00:00:00.000Z',
    thumbnail: 'https://i.ytimg.com/vi/qwbGW9jeDeo/maxresdefault.jpg',
    link: 'https://www.youtube.com/watch?v=qwbGW9jeDeo',
    videoId: 'qwbGW9jeDeo',
  },
  {
    type: 'video',
    title: 'How To Get Rid Of Acne Scars 😲',
    author: 'Dillon Latham',
    pubDate: '2024-01-11T00:00:00.000Z',
    thumbnail: 'https://i.ytimg.com/vi/mS2x9kKh8xY/maxresdefault.jpg',
    link: 'https://www.youtube.com/watch?v=mS2x9kKh8xY',
    videoId: 'mS2x9kKh8xY',
  },
  {
    type: 'video',
    title: 'How to find your hair porosity 😲',
    author: 'Dillon Latham',
    pubDate: '2024-02-15T00:00:00.000Z',
    thumbnail: 'https://i.ytimg.com/vi/LnHeZ2XmMkU/maxresdefault.jpg',
    link: 'https://www.youtube.com/watch?v=LnHeZ2XmMkU',
    videoId: 'LnHeZ2XmMkU',
  },
];

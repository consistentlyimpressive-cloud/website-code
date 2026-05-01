import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Play,
  ExternalLink,
  Loader2,
  Clock,
  Youtube,
  Newspaper,
  Rss,
} from 'lucide-react';
import {
  fetchYouTubeFeedFromChannels,
  STATIC_VIDEO_FALLBACK,
  YOUTUBE_ROTATION_MS,
} from '../utils/youtubeFeed';
import { getApiBase } from '../utils/apiBase';

const API_BASE = getApiBase();

/**
 * Editorial picks. Live RSS items are merged in below, but the visible reads rail stays capped
 * so the page does not turn into a giant news dump.
 */
const HARDCODED_ARTICLES = [
  {
    id: 'guardian-clavicular-opinion-2026',
    title:
      "Behind the rise of Clavicular and 'looksmaxxing' there are insecure young men who feel they don't measure up",
    source: 'The Guardian',
    pubDate: '2026-03-24T03:00:00.000Z',
    link: 'https://www.theguardian.com/society/commentisfree/2026/mar/24/clavicular-insecure-young-men-looksmaxxing',
  },
  {
    id: 'guardian-clavicular-arrest-2026',
    title: 'Social media influencer Clavicular arrested in Florida on battery charges',
    source: 'The Guardian',
    pubDate: '2026-03-27T17:09:00.000Z',
    link: 'https://www.theguardian.com/us-news/2026/mar/27/clavicular-arrested-florida-battery-charges',
  },
  {
    id: 'bbc-culture-looksmaxxing-2024',
    title: 'Inside looksmaxxing, the extreme cosmetic social media trend',
    source: 'BBC Culture',
    pubDate: '2024-03-26T00:00:00.000Z',
    link: 'https://www.bbc.com/culture/article/20240326-inside-looksmaxxing-the-extreme-cosmetic-social-media-trend',
  },
  {
    id: 'bbc-news-looksmaxxing-2026',
    title: 'Sculpting jaws, giving scores: Inside the world of looksmaxxing',
    source: 'BBC News',
    pubDate: '2026-03-15T12:00:00.000Z',
    link: 'https://www.bbc.com/news/articles/cx28z4zypkno',
  },
];

/** Distinct placeholders only while OG image is resolving (not the article photo). */
const NEWS_PLACEHOLDER = {
  'guardian-clavicular-opinion-2026':
    'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=1200&q=80&auto=format&fit=crop',
  'guardian-clavicular-arrest-2026':
    'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?w=1200&q=80&auto=format&fit=crop',
  'bbc-culture-looksmaxxing-2024':
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=1200&q=80&auto=format&fit=crop',
  'bbc-news-looksmaxxing-2026':
    'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=1200&q=80&auto=format&fit=crop',
};

const CARD_BASE =
  'group flex h-full flex-col bg-[#0c0d0e] border border-zinc-800 rounded-2xl overflow-hidden transition-all duration-300 hover:border-cyan-500/35 hover:shadow-[0_0_28px_rgba(34,211,238,0.08)] hover:-translate-y-0.5';

const FALLBACK_IMG =
  'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&q=80&w=1200&h=675';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'video', label: 'Watch' },
  { id: 'news', label: 'Read' },
];
const VIDEO_VISIBLE_LIMIT = 30;
const VIDEO_SCROLL_LIMIT = 100;
const NEWS_VISIBLE_LIMIT = 4;

const NEWS_RSS_FEEDS = [
  {
    source: 'Google News',
    url: 'https://news.google.com/rss/search?q=Clavicular%20looksmaxxing%20OR%20facial%20aesthetics%20OR%20blackpill&hl=en-US&gl=US&ceid=US:en',
  },
  {
    source: 'Google News',
    url: 'https://news.google.com/rss/search?q=%22looksmaxxing%22%20OR%20%22facial%20aesthetics%22%20OR%20%22QOVES%22&hl=en-US&gl=US&ceid=US:en',
  },
  {
    source: 'Google News',
    url: 'https://news.google.com/rss/search?q=%22male%20beauty%22%20%22facial%20aesthetics%22%20OR%20%22jawline%22%20%22social%20media%22&hl=en-US&gl=US&ceid=US:en',
  },
];

const NEWS_TOPIC_KEYWORDS = [
  'blackpill',
  'clavicular',
  'facial aesthetics',
  'jawline',
  'looksmax',
  'looksmaxxing',
  'male beauty',
  'qoves',
];

const LIVE_ARTICLE_OVERRIDES = [
  {
    match: /clavicular.*(?:nightclub|club).*appearance|club appearance.*clavicular/i,
    source: 'Us Weekly',
    link: 'https://www.usmagazine.com/celebrity-news/news/clavicular-teases-club-appearance-1-day-after-hospitalization/',
    image:
      'https://www.usmagazine.com/wp-content/uploads/2026/04/Clavicular-Confirms-Club-Appearance-.jpg?w=1200&h=630&crop=1&quality=70&strip=all',
  },
  {
    match: /clavicular.*(?:hospitalized|overdose|seizure).*livestream|looksmaxxing influencer clavicular.*hospitalized/i,
    source: 'National Today',
    link: 'https://nationaltoday.com/us/fl/miami/news/2026/04/15/looksmaxxing-influencer-clavicular-suffers-overdose-seizure-during-livestream/',
    image: 'https://nationaltoday.com/wp-content/uploads/not-wordpress/2026/04/69df6d29e9852.jpg',
  },
  {
    match: /clavicular.*(?:that was brutal|posts update).*suspected overdose/i,
    source: 'National Today',
    link: 'https://nationaltoday.com/us/fl/miami/news/2026/04/15/clavicular-posts-update-after-suspected-overdose-that-was-brutal/',
    image: 'https://nationaltoday.com/wp-content/uploads/not-wordpress/2026/04/69df8946416e3.jpg',
  },
  {
    match: /clavicular.*home from hospital|i'?m ok after suspected od/i,
    source: 'TMZ',
    link: 'https://www.tmz.com/2026/04/15/clavicular-home-from-hospital-after-suspected-overdose/',
  },
];

function applyLiveArticleOverride(item) {
  const haystack = `${item?.title || ''} ${item?.source || ''}`;
  const override = LIVE_ARTICLE_OVERRIDES.find((entry) => entry.match.test(haystack));
  if (!override) return item;
  return {
    ...item,
    source: override.source || item.source,
    link: override.link || item.link,
    imageUrl: override.image || item.imageUrl,
  };
}

function isGoogleNewsImage(url) {
  return /(?:googleusercontent\.com\/.*gnews|gstatic\.com\/gnews|google_news|J6_coFbogxhRI9iM864NL_liGXvsQp2AupsKei7z0cNNfDvGUmWUy20nuUhkREQyrpY4bEeIBuc)/i.test(
    String(url || '')
  );
}

async function fetchArticleOgImage(articleUrl) {
  try {
    const res = await fetch(
      `https://api.microlink.io/?url=${encodeURIComponent(articleUrl)}`
    );
    if (!res.ok) return null;
    const json = await res.json();
    const url = json?.data?.image?.url || json?.data?.logo?.url;
    return typeof url === 'string' && url.startsWith('http') && !isGoogleNewsImage(url) ? url : null;
  } catch {
    return null;
  }
}

function proxiedNewsFeed(url) {
  return `${API_BASE}/api/proxy-rss?url=${encodeURIComponent(url)}`;
}

function decodeNewsText(value) {
  if (!value) return '';
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(value);
  return textarea.value
    .replace(/\s+-\s+Google News$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanGoogleNewsUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const nested = url.searchParams.get('url');
    return nested || raw;
  } catch {
    return raw;
  }
}

function isRelevantNewsItem(item) {
  const haystack = `${item?.title || ''} ${item?.source || ''}`.toLowerCase();
  return NEWS_TOPIC_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

async function fetchNewsFeedItems() {
  const results = await Promise.all(
    NEWS_RSS_FEEDS.map(async ({ source, url }) => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 18_000);
        const res = await fetch(proxiedNewsFeed(url), { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(String(res.status));
        const xml = await res.text();
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        if (doc.querySelector('parsererror')) return [];
        return Array.from(doc.querySelectorAll('item')).map((item, index) => {
          const title = decodeNewsText(item.querySelector('title')?.textContent || 'News');
          const link = cleanGoogleNewsUrl(item.querySelector('link')?.textContent || '');
          const pubDate = item.querySelector('pubDate')?.textContent || new Date().toISOString();
          const sourceLabel = decodeNewsText(item.querySelector('source')?.textContent || source);
          return applyLiveArticleOverride({
            id: `rss-${sourceLabel}-${index}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 120),
            type: 'news',
            title,
            source: sourceLabel,
            pubDate: new Date(pubDate).toISOString(),
            link,
          });
        }).filter((item) => item.link && isRelevantNewsItem(item));
      } catch {
        return [];
      }
    })
  );

  const byLink = new Map();
  [...results.flat(), ...HARDCODED_ARTICLES.map((n) => ({ ...n, type: 'news' }))].forEach((item) => {
    const key = item.link || item.id;
    if (!byLink.has(key)) byLink.set(key, item);
  });
  return [...byLink.values()].sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate)).slice(0, NEWS_VISIBLE_LIMIT);
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function itemKey(item, idx) {
  if (item.type === 'video' && item.videoId) return `v-${item.videoId}-${idx}`;
  return item.id || item.link || String(idx);
}

export default function NewsPage() {
  const [activeTab, setActiveTab] = useState('all');
  const [youtubePool, setYoutubePool] = useState([]);
  const [liveNewsPool, setLiveNewsPool] = useState([]);
  const [youtubeReady, setYoutubeReady] = useState(false);
  const [newsImagesById, setNewsImagesById] = useState({});

  const [lastFetchAt, setLastFetchAt] = useState(null);

  const loadYoutubePool = useCallback(async () => {
    const merged = await fetchYouTubeFeedFromChannels();
    setYoutubePool(merged.length ? merged : STATIC_VIDEO_FALLBACK);
    setYoutubeReady(true);
    setLastFetchAt(Date.now());
  }, []);

  const loadNewsPool = useCallback(async () => {
    const merged = await fetchNewsFeedItems();
    setLiveNewsPool(
      merged.length
        ? merged.slice(0, NEWS_VISIBLE_LIMIT)
        : HARDCODED_ARTICLES.map((n) => ({ ...n, type: 'news' })).slice(0, NEWS_VISIBLE_LIMIT)
    );
  }, []);

  useEffect(() => {
    loadNewsPool();
    const refresh = setInterval(loadNewsPool, YOUTUBE_ROTATION_MS);
    return () => clearInterval(refresh);
  }, [loadNewsPool]);

  useEffect(() => {
    loadYoutubePool();
    const refresh = setInterval(loadYoutubePool, YOUTUBE_ROTATION_MS);
    return () => clearInterval(refresh);
  }, [loadYoutubePool]);

  /** Refetch when the tab wakes after a long idle (works on mogcheck.net + local). */
  useEffect(() => {
    let hiddenAt = null;
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt != null && Date.now() - hiddenAt > YOUTUBE_ROTATION_MS) {
        loadYoutubePool();
      }
      hiddenAt = null;
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [loadYoutubePool]);

  const allVideoItems = useMemo(() => {
    const pool = youtubePool.length ? youtubePool : STATIC_VIDEO_FALLBACK;
    return pool
      .slice()
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
      .slice(0, VIDEO_SCROLL_LIMIT);
  }, [youtubePool]);

  const videoItems = useMemo(() => allVideoItems.slice(0, VIDEO_VISIBLE_LIMIT), [allVideoItems]);

  const newsItems = useMemo(
    () =>
      (liveNewsPool.length ? liveNewsPool : HARDCODED_ARTICLES.map((n) => ({ ...n, type: 'news' }))).slice(
        0,
        NEWS_VISIBLE_LIMIT
      ),
    [liveNewsPool]
  );

  const feedItems = useMemo(() => {
    const combined = [...videoItems, ...newsItems];
    combined.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    return combined;
  }, [videoItems, newsItems]);

  const loading = !youtubeReady;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        newsItems.map(async (a) => {
          const og = a.imageUrl || (await fetchArticleOgImage(a.link));
          return [a.id, og];
        })
      );
      if (cancelled) return;
      const next = {};
      for (const [id, url] of entries) {
        if (url) next[id] = url;
      }
      setNewsImagesById(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [newsItems]);

  const filtered = useMemo(() => {
    if (activeTab === 'all') return feedItems;
    if (activeTab === 'video') return allVideoItems;
    return newsItems;
  }, [activeTab, feedItems, allVideoItems, newsItems]);

  const tabCounts = useMemo(() => {
    const c = { all: feedItems.length, video: allVideoItems.length, news: newsItems.length };
    return c;
  }, [feedItems, allVideoItems, newsItems]);

  const newsThumbSrc = (item) =>
    newsImagesById[item.id] || NEWS_PLACEHOLDER[item.id] || FALLBACK_IMG;

  /**
   * @param {{ compact?: boolean; denseVideo?: boolean }} opts - denseVideo: smaller type in grid
   */
  const renderCard = (item, idx, opts = {}) => {
    const { compact = false, denseVideo = false } = opts;
    const k = itemKey(item, idx);
    const pad = compact ? 'p-4' : 'p-5';
    const titleCls = compact
      ? denseVideo
        ? 'text-sm font-bold leading-snug line-clamp-2'
        : 'text-base font-bold'
      : 'text-lg font-bold';

    if (item.type === 'video') {
      return (
        <a key={k} href={item.link} target="_blank" rel="noopener noreferrer" className={`${CARD_BASE} w-full`}>
          <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-zinc-950">
            <img loading="lazy" decoding="async"
              src={item.thumbnail}
              alt=""
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.target.src = FALLBACK_IMG;
              }}
              className="h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.02]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-hover:bg-black/25">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500 text-black shadow-[0_0_20px_rgba(34,211,238,0.45)]">
                <Play fill="currentColor" size={20} className="ml-0.5" />
              </div>
            </div>
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-md border border-white/10 bg-black/55 px-2 py-1 backdrop-blur-sm">
              <Youtube size={12} className="text-cyan-400" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-white">Video</span>
            </div>
            <span className="absolute bottom-2 right-2 rounded bg-black/65 px-2 py-0.5 text-[10px] font-mono text-zinc-300">
              {formatDate(item.pubDate)}
            </span>
          </div>
          <div className={`${pad} flex min-h-0 flex-col gap-2`}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-500/90">{item.author}</p>
            <h3 className={`text-zinc-50 ${titleCls} transition-colors group-hover:text-cyan-100`}>{item.title}</h3>
            <ExternalLink
              size={14}
              className="mt-auto text-zinc-600 transition-colors group-hover:text-cyan-400"
            />
          </div>
        </a>
      );
    }

    if (item.type === 'news') {
      const thumbUrl = newsThumbSrc(item);
      return (
        <a key={k} href={item.link} target="_blank" rel="noopener noreferrer" className={`${CARD_BASE} w-full`}>
          <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden bg-zinc-950">
            <img loading="lazy" decoding="async"
              key={thumbUrl}
              src={thumbUrl}
              alt=""
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.src = NEWS_PLACEHOLDER[item.id] || FALLBACK_IMG;
              }}
              className="h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.02]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0c0d0e] via-[#0c0d0e]/35 to-transparent" />
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-md border border-cyan-500/25 bg-black/50 px-2.5 py-1 backdrop-blur-sm">
              <Newspaper size={12} className="text-cyan-400" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-white">{item.source}</span>
            </div>
          </div>
          <div className={`${pad} flex flex-col gap-3`}>
            <h3 className={`leading-snug text-zinc-100 ${titleCls} transition-colors group-hover:text-cyan-300`}>
              {item.title}
            </h3>
            <div className="mt-auto flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              <span className="flex items-center gap-1.5">
                <Clock size={12} /> {formatDate(item.pubDate)}
              </span>
              <ExternalLink size={14} className="text-zinc-600 transition-colors group-hover:text-cyan-400" />
            </div>
          </div>
        </a>
      );
    }

    return null;
  };

  const sectionTitle = (label) => (
    <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[0.28em] text-zinc-500">{label}</h2>
  );

  return (
    <div className="relative w-full min-h-screen bg-[#0a0a0b] pb-24 pt-28">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-[420px] w-[min(100%,900px)] -translate-x-1/2 rounded-full bg-cyan-500/[0.06] blur-[100px]" />
      </div>

      <div className="relative z-10 mx-auto flex max-w-6xl flex-col gap-14 px-4 sm:px-6">
        <header className="border-b border-zinc-800/90 pb-10">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/5 px-3 py-1">
            <Rss size={14} className="text-cyan-400" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400/90">Feed</span>
          </div>
          <h1 className="text-4xl font-black uppercase italic tracking-tighter text-white sm:text-5xl md:text-6xl">
            News &amp; media
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Videos now prioritize facial-aesthetics and blackpill-adjacent channels like QOVES and Creating Attractive.
            Articles refresh from live search feeds so breaking looksmaxxing and creator stories can surface faster.
          </p>
          {lastFetchAt && (
            <p className="mt-2 text-[10px] font-mono uppercase tracking-widest text-zinc-600">
              Feed refreshed ~every 10 min · last sync{' '}
              {new Date(lastFetchAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}

          <div className="mt-10 flex flex-wrap gap-2">
            {TABS.map((tab) => {
              const count = tabCounts[tab.id] ?? 0;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-full border px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest transition-all ${
                    active
                      ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.12)]'
                      : 'border-zinc-800 bg-zinc-900/40 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                  }`}
                >
                  {tab.label}
                  <span className={`ml-1.5 tabular-nums ${active ? 'text-cyan-200/80' : 'text-zinc-600'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </header>

        {loading ? (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-zinc-500">
            <Loader2 className="animate-spin text-cyan-500" size={36} />
            <span className="text-xs font-mono uppercase tracking-widest">Loading…</span>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-zinc-500">Nothing in this category yet.</p>
        ) : activeTab === 'all' ? (
          <div className="flex flex-col gap-16">
            <section>
              {sectionTitle('Latest videos')}
              <div className="mog-scroll grid max-h-[980px] grid-cols-1 gap-5 overflow-y-auto pr-2 sm:grid-cols-2 xl:grid-cols-4">
                {videoItems.map((item, idx) => (
                  <div key={itemKey(item, idx)}>{renderCard(item, idx, { denseVideo: true })}</div>
                ))}
              </div>
            </section>
            <section className="border-t border-zinc-800/80 pt-16">
              {sectionTitle('Latest reads')}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {newsItems.map((item, idx) => (
                  <div key={itemKey(item, idx)}>{renderCard(item, idx)}</div>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <section>
            {activeTab === 'video' && sectionTitle('Videos')}
            {activeTab === 'news' && sectionTitle('Articles')}
            <div
              className={`grid gap-5 ${
                activeTab === 'video'
                  ? 'mog-scroll max-h-[1200px] grid-cols-1 overflow-y-auto pr-2 sm:grid-cols-2 xl:grid-cols-4'
                  : 'grid-cols-1 md:grid-cols-2'
              }`}
            >
              {filtered.map((item, idx) => (
                <div key={itemKey(item, idx)}>
                  {renderCard(item, idx, { denseVideo: activeTab === 'video' })}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

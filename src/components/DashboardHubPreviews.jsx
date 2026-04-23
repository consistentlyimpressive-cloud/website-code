import React, { useEffect, useMemo, useState } from 'react';
import { Newspaper, Swords, Users, ChevronRight } from 'lucide-react';
import { COMMUNITY_SCANS } from '../data/communityScans';
import { getApiBase } from '../utils/apiBase';
import { resolveMediaUrl } from '../utils/mediaUrl';

const API_BASE = getApiBase();
const NEWS_FEED_URL =
  'https://news.google.com/rss/search?q=looksmaxxing%20OR%20facial%20aesthetics%20OR%20blackpill%20OR%20QOVES&hl=en-US&gl=US&ceid=US:en';

function getScanImage(scan) {
  return resolveMediaUrl(
    scan?.dashboardData?.frontImage ||
    scan?.frontImageUrl ||
    scan?.frontImage ||
    scan?.payload?.frontImage ||
    scan?.imageUrl ||
    ''
  );
}

function getBattleImage(fighter) {
  return resolveMediaUrl(fighter?.frontImage || fighter?.imgSrc || fighter?.image || fighter?.photo || '');
}

function decodeText(value) {
  if (!value) return '';
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(value);
  return textarea.value.replace(/\s+/g, ' ').trim();
}

async function fetchLatestNews() {
  const res = await fetch(`${API_BASE}/api/proxy-rss?url=${encodeURIComponent(NEWS_FEED_URL)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch news');
  const xml = await res.text();
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) return [];
  return Array.from(doc.querySelectorAll('item')).slice(0, 2).map((item, index) => {
    const title = decodeText(item.querySelector('title')?.textContent || 'Latest read').replace(/\s+-\s+Google News$/i, '');
    const source = decodeText(item.querySelector('source')?.textContent || 'News');
    const link = item.querySelector('link')?.textContent || '';
    return { id: `${source}-${index}-${title}`, title, source, link };
  });
}

/**
 * Compact explore strip for the dashboard. It polls the same public endpoints used by
 * the full community/news pages so previews stay fresh without a full page refresh.
 */
export function DashboardHubPreviewsCompact({ setCurrentPage, hideCommunity = false, onOpenCommunityScan = null }) {
  const [latestScans, setLatestScans] = useState([]);
  const [latestBattles, setLatestBattles] = useState([]);
  const [latestNews, setLatestNews] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const loadLatest = async () => {
      const [scansResult, battlesResult, newsResult] = await Promise.allSettled([
        fetch(`${API_BASE}/api/community-scans?limit=3`, { cache: 'no-store' }).then((res) =>
          res.ok ? res.json() : Promise.reject(new Error('community scans failed'))
        ),
        fetch(`${API_BASE}/api/mog-battle/community`, { cache: 'no-store' }).then((res) =>
          res.ok ? res.json() : Promise.reject(new Error('mog battles failed'))
        ),
        fetchLatestNews(),
      ]);

      if (cancelled) return;
      if (scansResult.status === 'fulfilled') {
        setLatestScans(Array.isArray(scansResult.value?.scans) ? scansResult.value.scans.slice(0, 3) : []);
      }
      if (battlesResult.status === 'fulfilled') {
        setLatestBattles(Array.isArray(battlesResult.value?.battles) ? battlesResult.value.battles.slice(0, 2) : []);
      }
      if (newsResult.status === 'fulfilled') {
        setLatestNews(Array.isArray(newsResult.value) ? newsResult.value.slice(0, 2) : []);
      }
    };

    loadLatest();
    const interval = setInterval(loadLatest, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const previewScans = useMemo(
    () => (latestScans.length ? latestScans : COMMUNITY_SCANS.slice(0, 3)),
    [latestScans]
  );

  return (
    <div className="mt-12 pt-10 border-t border-zinc-800/80">
      <h3 className="text-sm font-black uppercase tracking-widest text-zinc-500 mb-6">Explore MogCheck</h3>
      <div className={hideCommunity ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'grid grid-cols-1 md:grid-cols-3 gap-4'}>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase tracking-widest">
            <Swords size={14} /> Mog Battles
          </div>
          {latestBattles.length ? (
            <div className="space-y-2">
              {latestBattles.map((battle) => {
                const fighterA = battle.fighterA || {};
                const fighterB = battle.fighterB || {};
                return (
                  <div key={battle.id} className="flex items-center gap-2 rounded-xl border border-zinc-800/80 bg-black/20 p-2">
                    <div className="flex -space-x-2">
                      {[getBattleImage(fighterA), getBattleImage(fighterB)].map((img, index) => (
                        <div key={index} className="h-9 w-9 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950">
                          {img ? <img src={img} alt="" className="h-full w-full object-cover object-top" /> : null}
                        </div>
                      ))}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[10px] font-black uppercase tracking-widest text-zinc-300">
                        {fighterA.name || fighterA.displayName || 'Scan'} vs {fighterB.name || fighterB.displayName || 'Scan'}
                      </p>
                      <p className="text-[9px] font-sans uppercase tracking-[0.2em] text-zinc-600">
                        {Number(battle.votesA || 0) + Number(battle.votesB || 0)} votes
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-zinc-500 text-[11px] font-sans leading-relaxed">No live battles yet. Start one and it will appear here.</p>
          )}
          <button
            type="button"
            onClick={() => setCurrentPage('mog-battles')}
            className="mt-auto flex items-center justify-center gap-2 py-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-[10px] font-bold uppercase tracking-widest hover:bg-cyan-500/20 transition-colors"
          >
            Go to Mog Battles <ChevronRight size={14} />
          </button>
        </div>
        {!hideCommunity && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-emerald-400/90 text-xs font-bold uppercase tracking-widest">
              <Users size={14} /> Community Scans
            </div>
            <div className="flex gap-1">
              {previewScans.map((scan) => (
                <button
                  key={scan.id}
                  type="button"
                  onClick={() => (onOpenCommunityScan ? onOpenCommunityScan(scan) : setCurrentPage('celebrity'))}
                  className="group relative flex-1 aspect-[3/4] rounded-lg overflow-hidden border border-zinc-700/50 text-left hover:border-emerald-400/40 transition-colors"
                >
                  {getScanImage(scan) ? (
                    <img src={getScanImage(scan)} alt="" className="w-full h-full object-cover object-top" />
                  ) : (
                    <div className="h-full w-full bg-zinc-950" />
                  )}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setCurrentPage('celebrity')}
              className="mt-auto flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-500/15 transition-colors"
            >
              Go to Community Scans <ChevronRight size={14} />
            </button>
          </div>
        )}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-violet-400 text-xs font-bold uppercase tracking-widest">
            <Newspaper size={14} /> News &amp; Media
          </div>
          {latestNews.length ? (
            <div className="space-y-2">
              {latestNews.map((item) => (
                <a
                  key={item.id}
                  href={item.link}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl border border-zinc-800/80 bg-black/20 p-2 transition-colors hover:border-violet-400/30"
                >
                  <p className="line-clamp-2 text-[11px] font-bold leading-snug text-zinc-300">{item.title}</p>
                  <p className="mt-1 text-[9px] font-sans uppercase tracking-[0.2em] text-violet-300/70">{item.source}</p>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-zinc-500 text-[11px] font-sans leading-relaxed">No latest reads loaded yet.</p>
          )}
          <button
            type="button"
            onClick={() => setCurrentPage('news')}
            className="mt-auto flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-500/10 border border-violet-500/25 text-violet-300 text-[10px] font-bold uppercase tracking-widest hover:bg-violet-500/20 transition-colors"
          >
            Go to News &amp; Media <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

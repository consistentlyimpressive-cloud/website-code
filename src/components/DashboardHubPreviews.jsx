import React, { useEffect, useMemo, useState } from 'react';
import { Newspaper, Swords, Users, ChevronRight, Plus } from 'lucide-react';
import { COMMUNITY_SCANS } from '../data/communityScans';
import { celebrityData } from '../data/celebrityData';
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

function getScanRating(scan) {
  const value = scan?.finalRating ?? scan?.dashboardData?.finalRating ?? scan?.payload?.finalRating ?? scan?.rating;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getScanTier(scan) {
  const direct = scan?.tier || scan?.dashboardData?.tier || scan?.payload?.tier;
  if (direct) return direct;
  const rating = getScanRating(scan);
  if (rating == null) return '-';
  if (rating >= 90) return 'S+ TIER';
  if (rating >= 80) return 'S-TIER';
  if (rating >= 70) return 'A-TIER';
  if (rating >= 60) return 'B-TIER';
  if (rating >= 50) return 'C-TIER';
  return 'D-TIER';
}

const slugifyScanName = (value) =>
  String(value || 'scan')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'scan';

const timestampToMillis = (value) => {
  if (!value) return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return value < 100000000000 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) return numeric < 100000000000 ? numeric * 1000 : numeric;
    const parsed = new Date(trimmed).getTime();
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds > 0 ? value.seconds * 1000 : 0;
  if (typeof value?._seconds === 'number') return value._seconds > 0 ? value._seconds * 1000 : 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const timestampToIso = (value) => {
  const millis = timestampToMillis(value);
  return millis ? new Date(millis).toISOString() : new Date().toISOString();
};

const tierFromRating = (rating) => {
  const score = Number(rating) || 0;
  if (score >= 85) return 'S-TIER';
  if (score >= 75) return 'A-TIER';
  if (score >= 65) return 'B-TIER';
  if (score >= 50) return 'C-TIER';
  return 'D-TIER';
};

const officialCelebrityCommunityScans = celebrityData.map((celeb, index) => {
  const rating = Number(celeb?.rating) || 0;
  const scanId = `official-${slugifyScanName(celeb?.name)}-${index}`;
  const dashboardData = {
    scanId,
    profileId: scanId,
    profileName: 'Official Scan',
    selectedModel: 'official',
    finalRating: rating,
    sideRating: rating,
    sex: celeb?.sex || null,
    technicalSummary: celeb?.technicalSummary || '',
    appealAssessment: celeb?.technicalSummary || '',
    biometrics: Array.isArray(celeb?.stats) ? celeb.stats : [],
    frontImage: celeb?.imgSrc || '',
    sideImage: celeb?.imgSrc || '',
  };
  return {
    id: scanId,
    scanId,
    officialScan: true,
    official: true,
    tier: celeb?.tier || '',
    finalRating: rating,
    sideRating: rating,
    model: 'official',
    dashboardData,
    timestamp: `2099-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
  };
});

const communityScanToDashboardCard = (scan, index = 0) => {
  if (!scan) return null;
  const payload = scan.payload && typeof scan.payload === 'object' ? scan.payload : {};
  const dashboardData = {
    ...payload,
    scanId: scan.scanId || scan.id || payload.scanId || `community-${index}`,
    profileId: scan.profileId || payload.profileId || null,
    profileName: scan.profileName || payload.profileName || 'Community Scan',
    selectedModel: String(scan.model || payload.selectedModel || (scan.officialScan || scan.official ? 'official' : '1')),
    frontImage: resolveMediaUrl(scan.frontImageUrl || scan.frontImage || payload.frontImage || payload.imgSrc || null),
    sideImage: resolveMediaUrl(scan.sideImageUrl || scan.sideImage || payload.sideImage || null),
    debugAnchorsImage: resolveMediaUrl(scan.debugAnchorsImageUrl || scan.debugAnchorsImage || payload.debugAnchorsImage || payload.debugAnchorsImageUrl || null),
    debugAnchorsImageUrl: resolveMediaUrl(scan.debugAnchorsImageUrl || scan.debugAnchorsImage || payload.debugAnchorsImageUrl || payload.debugAnchorsImage || null),
    debugRatiosImage: resolveMediaUrl(scan.debugRatiosImageUrl || scan.debugRatiosImage || payload.debugRatiosImage || payload.debugRatiosImageUrl || null),
    debugRatiosImageUrl: resolveMediaUrl(scan.debugRatiosImageUrl || scan.debugRatiosImage || payload.debugRatiosImageUrl || payload.debugRatiosImage || null),
    finalRating: Number(scan.finalRating ?? payload.finalRating ?? payload.rating) || 0,
    sideRating: Number(scan.sideRating ?? payload.sideRating) || 0,
    sex: scan.sex || payload.sex || payload.gender || '',
    scannedAt: timestampToIso(scan.timestamp || scan.scannedAt || payload.scannedAt),
  };

  if (!dashboardData.frontImage) return null;

  return {
    id: scan.id || dashboardData.scanId || `community-${index}`,
    tier: scan.tier || tierFromRating(dashboardData.finalRating),
    dashboardData,
    officialScan: Boolean(scan.officialScan || scan.official),
    official: Boolean(scan.officialScan || scan.official),
    ownerUid: scan.ownerUid || null,
    scanId: dashboardData.scanId,
    timestamp: scan.timestamp || scan.scannedAt || payload.scannedAt || null,
  };
};

const buildSectionCommunityScans = (scans = []) => {
  const publicScans = (Array.isArray(scans) ? scans : [])
    .map(communityScanToDashboardCard)
    .filter(Boolean);
  const byId = new Map();
  [...officialCelebrityCommunityScans, ...publicScans].forEach((scan, idx) => {
    const card = scan.dashboardData ? scan : communityScanToDashboardCard(scan, idx);
    if (!card) return;
    byId.set(card.scanId || card.id || `scan-${idx}`, card);
  });
  return Array.from(byId.values()).sort((a, b) => {
    if (Boolean(a.officialScan) !== Boolean(b.officialScan)) return a.officialScan ? -1 : 1;
    return timestampToMillis(b.dashboardData?.scannedAt || b.timestamp) - timestampToMillis(a.dashboardData?.scannedAt || a.timestamp);
  });
};

const modelLabel = (model) => ({
  '1': 'Premium Model',
  '2': 'Backup Model',
  '6': 'Premium Model',
  '7': 'Premium Model',
  '8': 'Premium Model',
  '9': 'Premium Model',
  '3': 'Free Optic',
  '4': 'Free Core',
  '5': 'Free Geneva',
  official: 'Official Scan',
}[String(model || '').trim()] || 'Unknown AI');

function getCommunityRatingTone(score) {
  const n = Number(score) || 0;
  if (n >= 90) return { text: 'text-emerald-200', border: 'border-emerald-300/70 hover:border-emerald-200', glow: 'shadow-[0_0_36px_rgba(16,185,129,0.18)]' };
  if (n >= 80) return { text: 'text-emerald-300', border: 'border-emerald-400/60 hover:border-emerald-300', glow: 'shadow-[0_0_30px_rgba(16,185,129,0.14)]' };
  if (n >= 70) return { text: 'text-cyan-300', border: 'border-cyan-400/55 hover:border-cyan-300', glow: 'shadow-[0_0_26px_rgba(34,211,238,0.13)]' };
  if (n >= 60) return { text: 'text-yellow-300', border: 'border-yellow-500/45 hover:border-yellow-400', glow: 'shadow-[0_0_24px_rgba(234,179,8,0.10)]' };
  if (n >= 50) return { text: 'text-orange-400', border: 'border-orange-500/50 hover:border-orange-400', glow: 'shadow-[0_0_24px_rgba(249,115,22,0.12)]' };
  return { text: 'text-rose-400', border: 'border-rose-500/55 hover:border-rose-400', glow: 'shadow-[0_0_24px_rgba(244,63,94,0.12)]' };
}

function getCommunityTierBadgeClass(scanTier) {
  const tierUpper = String(scanTier || '').toUpperCase();
  if (tierUpper.includes('S') && tierUpper.includes('TIER')) {
    return 'bg-red-500/20 text-red-500 border-red-500/30 shadow-[0_0_8px_rgba(239,68,68,0.6)]';
  }
  if (tierUpper.includes('A') && tierUpper.includes('TIER')) {
    return 'bg-orange-500/20 text-orange-400 border-orange-500/30 shadow-[0_0_8px_rgba(249,115,22,0.6)]';
  }
  return 'bg-zinc-700/40 text-zinc-300 border-zinc-600/50';
}

function DashboardHubCommunityScanCard({ scan, compact = false, onOpen }) {
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
  const [isHovered, setIsHovered] = useState(false);
  const dd = scan?.dashboardData || {};
  const rating = Number(getScanRating(scan) ?? 0);
  const ratingTone = getCommunityRatingTone(rating);
  const tierBadgeClass = getCommunityTierBadgeClass(getScanTier(scan));
  const scanImage = getScanImage(scan);
  const rotateY = (mousePos.x - 50) * 0.22;
  const rotateX = (50 - mousePos.y) * 0.18;

  const handleMouseMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMousePos({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen?.();
      }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setMousePos({ x: 50, y: 50 });
      }}
      className="group relative cursor-pointer text-left [perspective:950px] outline-none"
    >
      <div
        className={`relative overflow-hidden rounded-[30px] border bg-zinc-900/40 transition-[transform,box-shadow,border-color] duration-500 ease-out [transform-style:preserve-3d] ${ratingTone.border} ${ratingTone.glow}`}
        style={{
          transform: isHovered
            ? `rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-12px) scale(1.025)`
            : 'rotateX(0deg) rotateY(0deg) translateY(0) scale(1)',
        }}
      >
        <div className="relative overflow-hidden rounded-[30px] bg-zinc-950">
          {scanImage ? (
            <img loading="lazy" decoding="async"
              src={scanImage}
              className="w-full aspect-[3/4] object-cover object-top transition-transform duration-700 ease-out group-hover:scale-[1.065]"
              alt="Community Scan"
            />
          ) : (
            <div className="flex aspect-[3/4] w-full items-center justify-center text-zinc-700 opacity-50">
              <Users size={48} />
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent opacity-95" />
          <div
            className="pointer-events-none absolute inset-0 opacity-0 mix-blend-screen transition-opacity duration-300 group-hover:opacity-100"
            style={{
              background: `radial-gradient(190px circle at ${mousePos.x}% ${mousePos.y}%, rgba(255,255,255,0.18), rgba(255,255,255,0.04) 36%, transparent 68%)`,
            }}
          />
          <div className="absolute left-3 top-3 z-20 [transform:translateZ(42px)]">
            <span className={`rounded border px-2 py-0.5 text-[8px] font-black uppercase tracking-widest ${tierBadgeClass}`}>
              {getScanTier(scan)}
            </span>
          </div>

          <div className={`absolute bottom-0 inset-x-0 z-20 bg-gradient-to-t from-black via-black/80 to-transparent ${compact ? 'p-3' : 'p-4'} flex flex-col items-start [transform:translateZ(32px)]`}>
            <div className="mb-2 flex items-baseline gap-1">
              <span className={`${compact ? 'text-2xl' : 'text-3xl'} font-black italic tabular-nums ${ratingTone.text}`}>
                {rating.toFixed(1)}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">/100</span>
            </div>
            <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-zinc-500">
              Community Scan - {modelLabel(dd?.selectedModel || scan?.model)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
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
export function DashboardHubPreviewsCompact({ setCurrentPage, hideCommunity = false, onOpenCommunityScan = null, variant = 'compact', onAddScan = null }) {
  const [latestScans, setLatestScans] = useState([]);
  const [latestBattles, setLatestBattles] = useState([]);
  const [latestNews, setLatestNews] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const loadLatest = async () => {
      const [scansResult, battlesResult, newsResult] = await Promise.allSettled([
        fetch(`${API_BASE}/api/community-scans?limit=${variant === 'sections' ? 12 : 3}`, { cache: 'no-store' }).then((res) =>
          res.ok ? res.json() : Promise.reject(new Error('community scans failed'))
        ),
        fetch(`${API_BASE}/api/mog-battle/community`, { cache: 'no-store' }).then((res) =>
          res.ok ? res.json() : Promise.reject(new Error('mog battles failed'))
        ),
        fetchLatestNews(),
      ]);

      if (cancelled) return;
      if (scansResult.status === 'fulfilled') {
        const scans = Array.isArray(scansResult.value?.scans) ? scansResult.value.scans : [];
        setLatestScans(variant === 'sections'
          ? buildSectionCommunityScans(scans)
          : scans.slice(0, 3)
        );
      } else if (variant === 'sections') {
        setLatestScans(officialCelebrityCommunityScans);
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
  }, [variant]);

  const previewScans = useMemo(
    () => {
      if (latestScans.length) return latestScans;
      return variant === 'sections' ? officialCelebrityCommunityScans : COMMUNITY_SCANS.slice(0, 3);
    },
    [latestScans, variant]
  );
  const previewBattles = useMemo(
    () => latestBattles.slice(0, 3),
    [latestBattles]
  );
  const previewNews = useMemo(
    () => latestNews.slice(0, 3),
    [latestNews]
  );

  if (variant === 'sections') {
    return (
      <div className="mt-12 space-y-8 border-t border-zinc-800/80 pt-10">
        <section className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-6">
          <h3 className="mb-2 flex items-center gap-2 text-lg font-black uppercase tracking-widest text-cyan-400">
            <Swords size={20} /> Mog Battles
          </h3>
          <p className="mb-6 text-sm font-sans text-zinc-500">Preview of recent matchups. Cast votes and climb the leaderboard on the full page.</p>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {previewBattles.length ? (
              previewBattles.map((battle) => {
                const fighterA = battle.fighterA || {};
                const fighterB = battle.fighterB || {};
                return (
                  <div key={battle.id} className="relative aspect-[4/3] overflow-hidden rounded-xl border border-zinc-800 bg-black/40">
                    <div className="absolute inset-0 flex">
                      {[fighterA, fighterB].map((fighter, index) => (
                        <div key={index} className="relative flex-1">
                          {getBattleImage(fighter) ? (
                            <img loading="lazy" decoding="async" src={getBattleImage(fighter)} alt="" className="absolute inset-0 h-full w-full object-cover object-top grayscale-[35%]" />
                          ) : (
                            <div className="absolute inset-0 bg-zinc-950" />
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 to-transparent p-2 text-center text-[10px] font-bold uppercase tracking-widest text-white">
                      VS
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="col-span-full text-sm text-zinc-600">Loading battles...</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCurrentPage('mog-battles')}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-6 py-3 text-xs font-bold uppercase tracking-widest text-cyan-300 transition-colors hover:bg-cyan-500/25"
          >
            Go to Mog Battles <ChevronRight size={16} />
          </button>
        </section>

        {!hideCommunity && (
          <section className="border-t border-zinc-900 pt-8">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-2xl font-black uppercase tracking-tighter italic text-white">Community Scans</h3>
                <p className="mt-2 text-sm font-sans uppercase tracking-widest text-zinc-400">Official scans are pinned first. Add your own public scan from history or start fresh.</p>
              </div>
              <button
                type="button"
                onClick={() => (onAddScan ? onAddScan() : setCurrentPage('photo-guide'))}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-300 transition-colors hover:bg-cyan-500/20"
              >
                <Plus size={16} /> Add Scan
              </button>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {previewScans.map((scan) => (
                <DashboardHubCommunityScanCard
                  key={scan.id}
                  scan={scan}
                  onOpen={() => (onOpenCommunityScan ? onOpenCommunityScan(scan) : setCurrentPage('celebrity'))}
                />
              ))}
            </div>
          </section>
        )}

        <section className="border-t border-zinc-900 pt-8">
          <div className="max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900/25 p-8">
            <div className="mb-4 flex items-center gap-3 text-violet-400">
              <Newspaper size={22} />
              <h3 className="text-xl font-black uppercase tracking-widest italic">News &amp; Media</h3>
            </div>
            <p className="mb-6 text-sm font-sans leading-relaxed text-zinc-400">
              Full feed: YouTube updates, articles, and MogCheck announcements - open the dedicated page for the live experience.
            </p>
            <button
              type="button"
              onClick={() => setCurrentPage('news')}
              className="inline-flex items-center gap-2 rounded-xl border border-violet-500/35 bg-violet-500/15 px-6 py-3 text-xs font-bold uppercase tracking-widest text-violet-200 transition-colors hover:bg-violet-500/25"
            >
              Go to News &amp; Media <ChevronRight size={16} />
            </button>
          </div>
        </section>
      </div>
    );
  }

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
                          {img ? <img loading="lazy" decoding="async" src={img} alt="" className="h-full w-full object-cover object-top" /> : null}
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
                    <img loading="lazy" decoding="async" src={getScanImage(scan)} alt="" className="w-full h-full object-cover object-top" />
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

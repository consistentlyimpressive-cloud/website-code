import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Users, ArrowLeft, Share2, Trash2, Plus, ChevronRight, X, History } from 'lucide-react';
import { getApiBase } from '../utils/apiBase';
import { resolveMediaUrl } from '../utils/mediaUrl';
import { COMMUNITY_SCANS } from '../data/communityScans';
import { celebrityData } from '../data/celebrityData';

const API_BASE = getApiBase();
const COMMUNITY_IMAGE_PLACEHOLDER = 'https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png';

// --- Helpers ---
function findCommunityScanTemplate(scan) {
  if (!scan) return null;
  const idCandidates = [scan.id, scan.scanId, scan.profileId, scan.userId, scan.displayName, scan.name]
    .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
    .filter(Boolean);
  const imageCandidates = [
    scan.frontImage, scan.frontImageUrl, scan.sideImage, scan.sideImageUrl,
    scan.dashboardData?.frontImage, scan.dashboardData?.sideImage
  ].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);

  return COMMUNITY_SCANS.find((t) => {
    if (t.id && idCandidates.includes(String(t.id).toLowerCase())) return true;
    if (t.scanId && idCandidates.includes(String(t.scanId).toLowerCase())) return true;
    if (t.frontImage && imageCandidates.includes(t.frontImage)) return true;
    return false;
  });
}

const celebrityToOfficialCommunityScan = (celeb, index) => {
  const rating = Number(celeb?.rating) || 0;
  const scanId = `official-${celeb?.name?.toLowerCase().replace(/\s+/g, '-')}-${index}`;
  return {
    id: scanId,
    scanId,
    officialScan: true,
    official: true,
    tier: celeb?.tier || '',
    finalRating: rating,
    dashboardData: {
      scanId,
      profileName: 'Official Scan',
      finalRating: rating,
      frontImage: celeb?.imgSrc || '',
      biometrics: Array.isArray(celeb?.stats) ? celeb.stats : [],
    },
    frontImage: celeb?.imgSrc || '',
    timestamp: `2099-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
  };
};

const OFFICIAL_CELEBRITY_COMMUNITY_SCANS = celebrityData.map(celebrityToOfficialCommunityScan);

export function hydrateCommunityScanEntry(scan, index = 0) {
  const template = findCommunityScanTemplate(scan);
  const isOfficialScan = Boolean(scan?.officialScan || scan?.official || template?.officialScan || template?.official);
  const rating = Number(scan?.finalRating ?? scan?.dashboardData?.finalRating ?? scan?.payload?.finalRating ?? template?.finalRating ?? 0);
  const imageFallbacks = [
    scan?.frontImageUrl,
    scan?.payload?.frontImageUrl,
    scan?.dashboardData?.frontImageUrl,
    scan?.frontImage,
    scan?.dashboardData?.frontImage,
    scan?.payload?.frontImage,
    template?.frontImage,
  ].map(resolveMediaUrl).filter(Boolean);
  const frontImg = resolveMediaUrl(
    imageFallbacks[0] || ''
  );
  const dashboardData = scan?.dashboardData || scan?.payload || template?.dashboardData || null;

  return {
    ...scan,
    id: scan?.id || scan?.scanId || `community-${index}`,
    scanId: scan?.scanId || scan?.id || `community-${index}`,
    officialScan: isOfficialScan,
    finalRating: rating,
    frontImage: frontImg || COMMUNITY_IMAGE_PLACEHOLDER,
    frontImageFallbacks: [...new Set([...imageFallbacks, COMMUNITY_IMAGE_PLACEHOLDER])],
    dashboardData,
    tier: scan?.tier || template?.tier || (rating >= 85 ? 'S-TIER' : rating >= 75 ? 'A-TIER' : rating >= 65 ? 'B-TIER' : 'C-TIER'),
  };
}

const timestampToMillis = (v) => {
  if (!v) return 0;
  if (typeof v === 'number') return v < 1e11 ? v * 1000 : v;
  const d = new Date(v).getTime();
  return Number.isFinite(d) ? d : 0;
};

export function getRatingToneClasses(score) {
  const n = Number(score) || 0;
  if (n >= 90) return { text: 'text-emerald-200', stroke: '#10b981', border: 'border-emerald-300/70 hover:border-emerald-200', glow: 'shadow-[0_0_36px_rgba(16,185,129,0.18)]' };
  if (n >= 80) return { text: 'text-emerald-300', stroke: '#34d399', border: 'border-emerald-400/60 hover:border-emerald-300', glow: 'shadow-[0_0_30px_rgba(16,185,129,0.14)]' };
  if (n >= 70) return { text: 'text-cyan-300', stroke: '#22d3ee', border: 'border-cyan-400/55 hover:border-cyan-300', glow: 'shadow-[0_0_26px_rgba(34,211,238,0.13)]' };
  if (n >= 60) return { text: 'text-yellow-300', stroke: '#eab308', border: 'border-yellow-500/45 hover:border-yellow-400', glow: 'shadow-[0_0_24px_rgba(234,179,8,0.10)]' };
  if (n >= 50) return { text: 'text-orange-400', stroke: '#f97316', border: 'border-orange-500/50 hover:border-orange-400', glow: 'shadow-[0_0_24px_rgba(249,115,22,0.12)]' };
  return { text: 'text-rose-400', stroke: '#f43f5e', border: 'border-rose-500/55 hover:border-rose-400', glow: 'shadow-[0_0_24px_rgba(244,63,94,0.12)]' };
}

function getAnalysisModelLabel(model) {
  const m = String(model || '').trim();
  if (m === '1' || m === '6' || m === '7' || m === '8' || m === '9') return 'Premium Analysis';
  if (m === '3') return 'Optic (Free)';
  if (m === '4') return 'Core (Free)';
  if (m === '5') return 'Geneva (Free)';
  if (m === 'official') return 'Official Scan';
  return 'Standard Analysis';
}

// --- Components ---

const CustomSelectDropdown = ({ value, onChange, options, className }) => {
  const [isOpen, setIsOpen] = useState(false);
  const label = options.find(o => o.value === value)?.label || 'Select';
  return (
    <div className="relative z-[60]">
      <button onClick={() => setIsOpen(!isOpen)} className={className}>{label}</button>
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-48 rounded-2xl border border-zinc-800 bg-[#0c0d0e] p-2 shadow-2xl">
          {options.map(o => (
            <button key={o.value} onClick={() => { onChange(o.value); setIsOpen(false); }} className={`block w-full rounded-xl px-4 py-2 text-left text-[10px] font-black uppercase tracking-widest ${value === o.value ? 'bg-cyan-500/10 text-cyan-300' : 'text-zinc-500 hover:bg-white/5 hover:text-white'}`}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const CommunityScanCard = ({ scan, rating, ratingTone, tierBadgeClass, scanTier, isOwnedCommunityScan, isAdmin, communityMenuId, onOpen, onRemove, onToggleMenu, onMarkOfficial, onShare, compact = false }) => {
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
  const [isHovered, setIsHovered] = useState(false);
  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePos({ x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 });
  };
  const rotateY = (mousePos.x - 50) * 0.22;
  const rotateX = (50 - mousePos.y) * 0.18;
  const modelLabel = scan.officialScan ? '' : getAnalysisModelLabel(scan.dashboardData?.selectedModel || scan.model);
  const imageFallbacks = useMemo(
    () => [...new Set([scan.frontImage, ...(scan.frontImageFallbacks || []), COMMUNITY_IMAGE_PLACEHOLDER].map(resolveMediaUrl).filter(Boolean))],
    [scan.frontImage, scan.frontImageFallbacks]
  );
  const [imageSrc, setImageSrc] = useState(imageFallbacks[0] || COMMUNITY_IMAGE_PLACEHOLDER);

  useEffect(() => {
    setImageSrc(imageFallbacks[0] || COMMUNITY_IMAGE_PLACEHOLDER);
  }, [imageFallbacks]);

  return (
    <div role="button" tabIndex={0} onClick={onOpen} onMouseMove={handleMouseMove} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => { setIsHovered(false); setMousePos({ x: 50, y: 50 }); }} className="group relative cursor-pointer text-left [perspective:950px] outline-none">
      <div className={`relative overflow-hidden ${compact ? 'rounded-[20px]' : 'rounded-[30px]'} border bg-zinc-900/40 transition-[transform,box-shadow,border-color] duration-500 ease-out [transform-style:preserve-3d] ${ratingTone.border} ${ratingTone.glow}`} style={{ transform: isHovered ? `rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-12px) scale(1.025)` : 'rotateX(0deg) rotateY(0deg) translateY(0) scale(1)' }}>
        <div className={`relative overflow-hidden ${compact ? 'rounded-[20px]' : 'rounded-[30px]'} bg-zinc-950`}>
          <img
            src={imageSrc}
            onError={() => {
              const currentIndex = imageFallbacks.indexOf(imageSrc);
              setImageSrc(imageFallbacks[currentIndex + 1] || COMMUNITY_IMAGE_PLACEHOLDER);
            }}
            className={`w-full ${compact ? 'aspect-[4/5]' : 'aspect-[3/4]'} object-cover object-top transition-transform duration-700 ease-out group-hover:scale-[1.065]`}
            alt="Community Scan"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent opacity-95" />
          <div className="pointer-events-none absolute inset-0 opacity-0 mix-blend-screen transition-opacity duration-300 group-hover:opacity-100" style={{ background: `radial-gradient(190px circle at ${mousePos.x}% ${mousePos.y}%, rgba(255,255,255,0.18), rgba(255,255,255,0.04) 36%, transparent 68%)` }} />
        </div>
        <div className="absolute top-3 left-3 z-20">
          <span className={`border text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded backdrop-blur-md ${tierBadgeClass}`}>{scanTier}</span>
        </div>
        {onShare && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onShare(); }} className="absolute right-3 top-3 z-30 inline-flex h-8 w-8 items-center justify-center rounded-full border border-cyan-500/30 bg-black/70 text-cyan-200 backdrop-blur hover:text-white"><Share2 size={13} /></button>
        )}
        {isOwnedCommunityScan && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} className={`absolute ${onShare ? 'right-12' : 'right-3'} top-3 z-30 inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-500/30 bg-black/70 text-red-300 backdrop-blur hover:text-red-200`}><Trash2 size={14} /></button>
        )}
        <div className={`absolute bottom-0 inset-x-0 z-20 bg-gradient-to-t from-black via-black/80 to-transparent ${compact ? 'p-3' : 'p-4'} flex flex-col items-start [transform:translateZ(32px)]`}>
          <div className="flex items-baseline gap-1 mb-1.5">
            <span className={`${compact ? 'text-2xl' : 'text-3xl'} font-black italic tabular-nums`} style={{ background: `linear-gradient(to bottom, #ffffff 40%, ${ratingTone.stroke || '#22d3ee'})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', filter: 'saturate(0.85)' }}>{rating.toFixed(1)}</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">/100</span>
          </div>
          <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-zinc-500">Community Scan {modelLabel && `- ${modelLabel}`}</span>
        </div>
      </div>
    </div>
  );
};

export function CommunityScansSection({ user, setCurrentPage, onOpenScan, hideTitle = false, showFilters = true, showAddScan = false, filterMode: initialFilterMode = 'all' }) {
  const [communityScans, setCommunityScans] = useState([]);
  const [filterMode, setFilterMode] = useState(initialFilterMode);
  const [communitySort, setCommunitySort] = useState('latest');
  const [communityMenuId, setCommunityMenuId] = useState(null);
  const [notice, setNotice] = useState('');

  const [allScans, setAllScans] = useState([]);
  const [communityAddOpen, setCommunityAddOpen] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const isAdmin = Boolean(user?.email && (user.email === 'laithbu07@gmail.com' || user.email === 'admin@looksmaxxing.com'));

  useEffect(() => {
    setFilterMode(initialFilterMode);
  }, [initialFilterMode]);

  const communityScanIds = useMemo(
    () => new Set(communityScans.map((s) => String(s.scanId || s.id || '').trim())),
    [communityScans]
  );

  const fetchCommunity = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/community-scans?limit=60`, { cache: 'no-store' });
      const body = await res.json();
      let loaded = (body.scans || []).map((s, i) => hydrateCommunityScanEntry(s, i)).filter(s => s.dashboardData && s.frontImage);
      if (loaded.length === 0) {
        loaded = COMMUNITY_SCANS.map((s, i) => hydrateCommunityScanEntry({ ...s, name: `User ${i+1}`, isCommunity: true, profileId: `mock-${i}` }, i));
      }
      const merged = new Map();
      [...OFFICIAL_CELEBRITY_COMMUNITY_SCANS, ...loaded].forEach((s, idx) => {
        const key = s.scanId || s.id || `${s.frontImage}-${idx}`;
        if (!merged.has(key)) merged.set(key, s);
      });
      setCommunityScans(Array.from(merged.values()));
    } catch (e) {
      console.error(e);
      setCommunityScans(OFFICIAL_CELEBRITY_COMMUNITY_SCANS);
    }
  }, []);

  useEffect(() => {
    fetchCommunity();
  }, [fetchCommunity]);

  useEffect(() => {
    if (showAddScan && user && communityAddOpen) {
      const fetchHistory = async () => {
        setLoadingHistory(true);
        try {
          const token = await user.getIdToken();
          const res = await fetch(`${API_BASE}/api/user/scans`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            const finished = (data.scans || []).filter(s => s.state !== 'running' && s.payload?.status !== 'running');
            setAllScans(finished);
          }
        } catch (e) {
          console.error(e);
        } finally {
          setLoadingHistory(false);
        }
      };
      fetchHistory();
    }
  }, [showAddScan, user, communityAddOpen]);

  const publishScanToCommunity = async (scan) => {
    const scanId = String(scan.id || scan.scanId || '').trim();
    if (!scanId || !user) return;

    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/scans/${encodeURIComponent(scanId)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ visibility: 'community' }),
      });

      if (res.ok) {
        setNotice('Scan published to community!');
        setCommunityAddOpen(false);
        fetchCommunity();
      } else {
        const body = await res.json().catch(() => ({}));
        setNotice(body.error || 'Failed to publish scan');
      }
    } catch (err) {
      setNotice(err.message || 'Failed to publish scan');
    }
    setTimeout(() => setNotice(''), 3000);
  };

  const filteredScans = useMemo(() => {
    let scans = communityScans.filter(s => s.dashboardData && s.frontImage);
    if (filterMode === 'verified') scans = scans.filter(s => s.officialScan);
    else if (filterMode === 'community') scans = scans.filter(s => !s.officialScan);
    return scans.sort((a, b) => {
      if (communitySort === 'highest') return (b.finalRating || 0) - (a.finalRating || 0);
      return timestampToMillis(b.timestamp || b.scannedAt) - timestampToMillis(a.timestamp || a.scannedAt);
    });
  }, [communityScans, filterMode, communitySort]);

  const handleShare = (scan) => {
    const url = `${window.location.origin}/scan/${encodeURIComponent(scan.ownerUid || 'guest')}/${encodeURIComponent(scan.scanId)}`;
    navigator.clipboard.writeText(url).then(() => {
      setNotice('Link copied!');
      setTimeout(() => setNotice(''), 2000);
    });
  };

  return (
    <div className="w-full max-w-[1400px] mx-auto flex flex-col items-center text-center">
      {!hideTitle && (
        <>
          <h2 className="text-3xl font-black italic uppercase tracking-tighter text-white mb-2">Scans</h2>
          <p className="text-zinc-500 uppercase tracking-widest text-xs mb-8">Verified scans and live community scans with shareable links.</p>
        </>
      )}

      {showFilters && (
        <div className="flex flex-col md:flex-row items-center gap-6 mb-10 w-full justify-between max-w-2xl bg-black/40 border border-white/5 p-4 rounded-[28px] shadow-[0_10px_40px_rgba(0,0,0,0.3)] backdrop-blur-md z-10 relative">
          <div className="flex bg-zinc-900/50 p-1 rounded-full border border-white/5 w-full md:w-auto">
            {['all', 'verified', 'community'].map(mode => (
              <button key={mode} onClick={() => setFilterMode(mode)} className={`flex-1 md:flex-none px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.18em] transition-all ${filterMode === mode ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/30' : 'text-zinc-500 hover:text-white'}`}>{mode}</button>
            ))}
          </div>
          <div className="flex items-center gap-4 w-full md:w-auto">
            <CustomSelectDropdown value={communitySort} onChange={setCommunitySort} options={[{ value: 'latest', label: 'Latest' }, { value: 'highest', label: 'Highest' }]} className="appearance-none rounded-full border border-cyan-400/20 bg-cyan-400/[0.06] px-5 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100" />
            {showAddScan && user && (
              <button
                onClick={() => setCommunityAddOpen(true)}
                className="flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-5 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300 transition-all hover:bg-emerald-500/20"
              >
                <Plus size={14} /> Publish Scan
              </button>
            )}
          </div>
        </div>
      )}

      {communityAddOpen && (
        <div className="fixed inset-0 z-[240] flex items-center justify-center px-4 bg-black/90 backdrop-blur-xl">
          <div className="w-full max-w-2xl rounded-[32px] border border-white/10 bg-black/40 shadow-[0_0_80px_rgba(16,185,129,0.08)] relative animate-[mogBattle2NoticeIn__0.4s_cubic-bezier(0.16,1,0.3,1)] overflow-hidden flex flex-col max-h-[90vh]">

            {/* Modal Header */}
            <div className="px-8 py-7 flex justify-between items-center shrink-0 border-b border-white/5 relative">
              <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" />
              <div>
                <h2 className="text-xl font-black uppercase tracking-[0.2em] bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-500 mb-1">
                  Publish to Community
                </h2>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-400/80">
                  Pick a scan from your history
                </p>
              </div>
              <button
                onClick={() => setCommunityAddOpen(false)}
                className="text-zinc-500 hover:text-white transition-all duration-300 p-2.5 rounded-full hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-8 overflow-y-auto flex-1 space-y-6">
              <div>
                <p className="mb-4 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 flex items-center gap-2">
                  <History size={12} /> Your Scan History
                </p>
                <div className="space-y-3">
                  {loadingHistory && (
                    <div className="py-12 flex flex-col items-center justify-center gap-3">
                      <div className="w-6 h-6 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
                      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Fetching scans...</p>
                    </div>
                  )}
                  {!loadingHistory && allScans.length === 0 && (
                    <div className="rounded-[24px] border border-zinc-800/50 bg-white/[0.02] p-10 text-center">
                      <p className="text-sm text-zinc-500 font-medium">No saved scans found in your history.</p>
                    </div>
                  )}
                  {allScans.map((scan) => {
                    const sId = String(scan.id || scan.scanId || '');
                    const model = String(scan.model || scan.payload?.selectedModel || '').trim();
                    const isFree = ['3', '4', '5'].includes(model);
                    const isPublic = communityScanIds.has(sId) || (scan.visibility === 'community' || scan.payload?.visibility === 'community');

                    return (
                      <div
                        key={sId || scan.frontImageUrl}
                        className={`group flex items-center gap-4 rounded-[24px] border transition-all duration-300 p-4 ${isPublic || isFree ? 'border-zinc-800/30 bg-zinc-900/20 opacity-60' : 'border-zinc-800 bg-white/[0.02] hover:bg-white/[0.04] hover:border-emerald-500/30'}`}
                      >
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-zinc-950 border border-white/5">
                          {resolveMediaUrl(scan.frontImageUrl || scan.payload?.frontImage) ? (
                            <img loading="lazy" decoding="async" src={resolveMediaUrl(scan.frontImageUrl || scan.payload?.frontImage)} alt="" className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-110" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-zinc-700 bg-zinc-900"><Users size={20} /></div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-black uppercase tracking-[0.16em] text-white mb-1">{scan.profileName || scan.profileId || 'Saved Scan'}</p>
                          <div className="flex items-center gap-2">
                             <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400/80">
                               {getAnalysisModelLabel(scan.model || scan.payload?.selectedModel)}
                             </span>
                             <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">•</span>
                             <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                               {scan.finalRating != null ? `${Number(scan.finalRating).toFixed(1)}/100` : 'Scan'}
                             </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={isPublic || isFree}
                          onClick={() => publishScanToCommunity(scan)}
                          className={`rounded-xl px-5 py-2.5 text-[9px] font-black uppercase tracking-[0.2em] transition-all duration-300 ${isPublic || isFree ? 'cursor-not-allowed text-zinc-600' : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/40'}`}
                        >
                          {isPublic ? 'Public' : isFree ? 'Premium Only' : 'Publish'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 px-8 border-t border-white/5 bg-black/20">
              <button
                onClick={() => setCommunityAddOpen(false)}
                className="w-full py-3.5 rounded-2xl border border-zinc-800 text-zinc-400 text-[10px] font-black uppercase tracking-[0.2em] hover:bg-white/5 hover:text-white transition-all duration-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] bg-cyan-500 text-black px-6 py-2 rounded-full font-black text-xs uppercase tracking-widest animate-bounce">{notice}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6 w-full text-left">
        {filteredScans.map((scan, idx) => {
          const rating = Number(scan.finalRating || 0);
          const tone = getRatingToneClasses(rating);
          const tierUpper = String(scan.tier || '').toUpperCase();
          const tbc = tierUpper.includes('S') ? 'bg-red-500/20 text-red-500 border-red-500/30' : tierUpper.includes('A') ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' : 'bg-zinc-700/40 text-zinc-300 border-zinc-600/50';
          return (
            <CommunityScanCard
              key={scan.id || idx}
              scan={scan}
              rating={rating}
              ratingTone={tone}
              tierBadgeClass={tbc}
              scanTier={scan.tier}
              isOwnedCommunityScan={user?.uid === scan.ownerUid}
              isAdmin={isAdmin}
              communityMenuId={communityMenuId}
              onOpen={() => onOpenScan(scan)}
              onShare={() => handleShare(scan)}
              onToggleMenu={() => setCommunityMenuId(communityMenuId === scan.id ? null : scan.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

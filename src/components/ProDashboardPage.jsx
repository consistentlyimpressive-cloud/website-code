import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Target, Newspaper, Swords, Users, Crown, ChevronRight, Plus, Trash2, Edit2, Activity, Flame, Sparkles, Lock, ArrowLeft, TrendingUp } from 'lucide-react';
import { getApiBase } from '../utils/apiBase';
import { COMMUNITY_SCANS } from '../data/communityScans';
import { celebrityData } from '../data/celebrityData';
import { DashboardHubPreviewsCompact } from './DashboardHubPreviews';
import { getAllFeaturedBattles } from '../data/mogBattles';
import { fetchCommunityBattles, fetchCommunityScans } from '../api/mogBattleVotes';
import { ConfirmDialog, SiteModal } from './ui/SiteModal';

const API_BASE = getApiBase();

const clampTextStyle = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const modelLabel = (model) => ({
  '1': 'Premium Ultra',
  '2': 'Fun Mode',
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

function DashboardCommunityScanCard({
  scan,
  compact = false,
  isAdminUser,
  communityMenuId,
  onOpen,
  onToggleMenu,
  onToggleOfficial,
}) {
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
  const [isHovered, setIsHovered] = useState(false);
  const dd = scan?.dashboardData || {};
  const rating = Number(scan?.finalRating ?? dd?.finalRating ?? 0);
  const ratingTone = getCommunityRatingTone(rating);
  const tierBadgeClass = getCommunityTierBadgeClass(scan?.tier);
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
          {dd?.frontImage ? (
            <img
              src={dd.frontImage}
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
              {scan?.tier || '-'}
            </span>
          </div>

          {isAdminUser && (
            <div className="absolute right-3 top-3 z-40 [transform:translateZ(46px)]">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleMenu?.();
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-black/70 text-zinc-300 backdrop-blur transition-colors hover:border-zinc-400 hover:text-white"
              >
                <span className="text-lg leading-none">...</span>
              </button>
              {communityMenuId === scan?.id && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleOfficial?.(!scan?.officialScan);
                  }}
                  className="absolute right-0 top-10 w-52 rounded-2xl border border-zinc-700 bg-[#090a0b] px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-zinc-200 shadow-[0_20px_50px_rgba(0,0,0,0.5)] hover:bg-white/5"
                >
                  {scan?.officialScan ? 'Turn into community scan' : 'Turn into official scan'}
                </button>
              )}
            </div>
          )}

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

const slugifyScanName = (value) =>
  String(value || 'scan')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'scan';

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

const timestampToMillis = (value) => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const timestampToIso = (value) => {
  const millis = timestampToMillis(value);
  return millis ? new Date(millis).toISOString() : new Date().toISOString();
};

const modelUsesProDashboard = (model) => {
  const normalized = String(model || '').trim();
  return normalized === '1' || normalized === '2';
};

const hydrateScanForDashboard = (scan) => {
  if (!scan) return null;
  const payload = scan.payload && typeof scan.payload === 'object' ? scan.payload : {};
  return {
    ...payload,
    scanId: scan.id,
    profileId: scan.profileId || null,
    visibility: scan.visibility || payload.visibility || 'private',
    frontImage: scan.frontImageUrl || payload.frontImage || null,
    sideImage: scan.sideImageUrl || payload.sideImage || null,
    finalRating: typeof scan.finalRating === 'number' ? scan.finalRating : payload.finalRating,
    sideRating: typeof scan.sideRating === 'number' ? scan.sideRating : payload.sideRating,
    selectedModel: String(scan.model || payload.selectedModel || '').trim(),
    scannedAt: timestampToIso(scan.timestamp || scan.scannedAt),
  };
};

const normalizeVisibility = (value) => {
  const normalized = String(value || 'private').trim().toLowerCase();
  return normalized === 'public' ? 'community' : normalized;
};

const tierFromRating = (rating) => {
  const score = Number(rating) || 0;
  if (score >= 85) return 'S-TIER';
  if (score >= 75) return 'A-TIER';
  if (score >= 65) return 'B-TIER';
  if (score >= 50) return 'C-TIER';
  return 'D-TIER';
};

const communityScanToDashboardCard = (scan, index = 0) => {
  if (!scan) return null;
  const payload = scan.payload && typeof scan.payload === 'object' ? scan.payload : {};
  const dashboardData = {
    ...payload,
    scanId: scan.scanId || scan.id || payload.scanId || `community-${index}`,
    profileId: scan.profileId || payload.profileId || null,
    profileName: scan.profileName || payload.profileName || 'Community Scan',
    selectedModel: String(scan.model || payload.selectedModel || (scan.officialScan || scan.official ? 'official' : '1')),
    cohesiveFrontSide: Boolean(scan.cohesiveFrontSide || payload.cohesiveFrontSide),
    frontImage: scan.frontImageUrl || scan.frontImage || payload.frontImage || payload.imgSrc || null,
    sideImage: scan.sideImageUrl || scan.sideImage || payload.sideImage || null,
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
  };
};

const mergeProfileHistory = (history, snapshot) => {
  const items = Array.isArray(history) ? [...history] : [];
  if (!snapshot) return items;

  const snapshotKey = snapshot.scanId || snapshot.scannedAt || `${snapshot.frontImage || ''}-${snapshot.finalRating || ''}`;
  const existingIndex = items.findIndex((item) => {
    const itemKey = item?.scanId || item?.scannedAt || `${item?.frontImage || ''}-${item?.finalRating || ''}`;
    return itemKey && itemKey === snapshotKey;
  });

  if (existingIndex >= 0) {
    items[existingIndex] = {
      ...items[existingIndex],
      ...snapshot,
      frontImage: snapshot.frontImage || items[existingIndex].frontImage || null,
      sideImage: snapshot.sideImage || items[existingIndex].sideImage || null,
    };
    return items;
  }

  return [...items, snapshot];
};

const ProDashboardPage = ({ dashboardData, setCurrentPage, userPlan, user, onSignOut, setPendingUploadModel, setPendingUploadProfileId, analysisContent = null, hasActiveAnalysis = false, setDashboardData, renderCommunityDashboard = null }) => {
  const [profiles, setProfiles] = useState([]);
  const [allScans, setAllScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openingProfileId, setOpeningProfileId] = useState(null);
  const [activeSection, setActiveSection] = useState(hasActiveAnalysis ? 'overview' : 'profiles');
  const [mogPreviewBattles, setMogPreviewBattles] = useState([]);
  const [dashboardCommunityScans, setDashboardCommunityScans] = useState([]);
  const [communityPeek, setCommunityPeek] = useState(null);
  const [renameDraft, setRenameDraft] = useState({ id: null, name: '' });
  const [deleteProfileId, setDeleteProfileId] = useState(null);
  const [profileVisibilityIntent, setProfileVisibilityIntent] = useState(null);
  const [scanVisibilityIntent, setScanVisibilityIntent] = useState(null);
  const [communityAddOpen, setCommunityAddOpen] = useState(false);
  const [communityNotice, setCommunityNotice] = useState('');
  const [communityMenuId, setCommunityMenuId] = useState(null);
  const overviewRef = useRef(null);
  const analysisRef = useRef(null);
  const profilesRef = useRef(null);
  const newsRef = useRef(null);
  const mogBattlesRef = useRef(null);
  const communityRef = useRef(null);

  useEffect(() => {
    setActiveSection(hasActiveAnalysis ? 'overview' : 'profiles');
  }, [hasActiveAnalysis]);

  useEffect(() => {
    if (!communityPeek) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [communityPeek]);

  const loadMogPreviews = useCallback(async () => {
    try {
      const featured = getAllFeaturedBattles().filter((b) => b && b.fighterA && b.fighterB).slice(0, 2);
      let community = [];
      try {
        const res = await fetchCommunityBattles();
        const list = (res.battles || []).filter((b) => b && b.fighterA && b.fighterB).slice(0, 2);
        community = list;
      } catch {
        /* ignore */
      }
      try {
        const scansRes = await fetchCommunityScans(12);
        const publicScans = (scansRes.scans || scansRes.items || [])
          .map(communityScanToDashboardCard)
          .filter(Boolean);
        const byId = new Map();
        [...officialCelebrityCommunityScans, ...publicScans].forEach((scan, idx) => {
          const card = scan.dashboardData ? scan : communityScanToDashboardCard(scan, idx);
          if (!card) return;
          byId.set(card.scanId || card.id || `scan-${idx}`, card);
        });
        setDashboardCommunityScans(Array.from(byId.values()).sort((a, b) => {
          if (Boolean(a.officialScan) !== Boolean(b.officialScan)) return a.officialScan ? -1 : 1;
          return timestampToMillis(b.dashboardData?.scannedAt || b.timestamp) - timestampToMillis(a.dashboardData?.scannedAt || a.timestamp);
        }));
      } catch {
        setDashboardCommunityScans(officialCelebrityCommunityScans);
      }
      const merged = [];
      let i = 0;
      let j = 0;
      while (merged.length < 3 && (i < featured.length || j < community.length)) {
        if (i < featured.length) merged.push(featured[i++]);
        if (merged.length >= 3) break;
        if (j < community.length) merged.push(community[j++]);
      }
      setMogPreviewBattles(merged);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadMogPreviews();
  }, [loadMogPreviews]);

  useEffect(() => {
    const fetchProfiles = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        const token = await user.getIdToken();
        const headers = { Authorization: `Bearer ${token}` };
        const [profilesRes, scansRes] = await Promise.all([
          fetch(`${API_BASE}/api/user/profiles`, { headers }),
          fetch(`${API_BASE}/api/user/scans`, { headers }),
        ]);
        if (profilesRes.ok) {
          const data = await profilesRes.json();
          setProfiles(data.profiles || []);
        }
        if (scansRes.ok) {
          const data = await scansRes.json();
          setAllScans(data.scans || []);
        }
      } catch (e) {
        console.error('Failed to fetch profiles', e);
      } finally {
        setLoading(false);
      }
    };
    fetchProfiles();
  }, [user]);

  const handleCreateProfileAndScan = (model) => {
    if (setPendingUploadModel) setPendingUploadModel(model);
    if (setPendingUploadProfileId) {
      setPendingUploadProfileId(dashboardData?.profileId || null);
    }
    if (model === '1' || model === '2') {
      setCurrentPage('upload-ultra');
    } else {
      setCurrentPage('upload-photo');
    }
  };

  const handleRenameProfile = async (id, name) => {
    if (!name?.trim()) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/profiles/${id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) {
        setProfiles(profiles.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)));
        setRenameDraft({ id: null, name: '' });
      } else {
        const errBody = await res.json().catch(() => ({}));
        window.console.error(errBody.error || `Could not rename profile (${res.status})`);
      }
    } catch (err) {
      window.console.error(err.message);
    }
  };

  const handleUpdateProfileVisibility = async (id, visibility) => {
    if (!id || !visibility || !user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/profiles/${id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ visibility }),
      });
      if (res.ok) {
        setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, visibility } : p)));
      } else {
        const errBody = await res.json().catch(() => ({}));
        window.console.error(errBody.error || `Could not update profile visibility (${res.status})`);
      }
    } catch (err) {
      window.console.error(err.message);
    } finally {
      setProfileVisibilityIntent(null);
    }
  };

  const handleUpdateActiveScanVisibility = async (scanId, visibility) => {
    if (!scanId || !visibility || !user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/scans/${encodeURIComponent(scanId)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ visibility }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Could not update scan visibility (${res.status})`);

      setDashboardData?.((prev) => {
        const nextHistory = Array.isArray(prev?.scanHistory)
          ? prev.scanHistory.map((item) => (item.scanId === scanId ? { ...item, visibility } : item))
          : prev?.scanHistory;
        return {
          ...(prev || {}),
          ...(prev?.scanId === scanId ? { visibility } : {}),
          scanHistory: nextHistory,
        };
      });
      setAllScans((prev) => prev.map((scan) => (scan.id === scanId ? { ...scan, visibility } : scan)));
      setDashboardCommunityScans((prev) => {
        if (visibility === 'community') return prev;
        return prev.filter((scan) => String(scan?.scanId || scan?.dashboardData?.scanId || scan?.id || '') !== scanId);
      });
      await loadMogPreviews();
    } catch (err) {
      window.console.error(err.message || 'Could not update scan visibility');
    } finally {
      setScanVisibilityIntent(null);
    }
  };

  const communityScanIds = useMemo(
    () => new Set(
      (dashboardCommunityScans || [])
        .map((scan) => String(scan?.scanId || scan?.dashboardData?.scanId || scan?.id || '').trim())
        .filter(Boolean)
    ),
    [dashboardCommunityScans]
  );

  const publishScanToCommunity = async (scan) => {
    if (!scan?.id || !user) return;
    const scanId = String(scan.id);
    if (communityScanIds.has(scanId) || normalizeVisibility(scan.visibility) === 'community') {
      setCommunityNotice('That scan is already in Community Scans.');
      return;
    }
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
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Could not publish scan (${res.status})`);
      setAllScans((prev) => prev.map((item) => (item.id === scanId ? { ...item, visibility: 'community' } : item)));
      setDashboardData?.((prev) => {
        if (!prev) return prev;
        const nextHistory = Array.isArray(prev.scanHistory)
          ? prev.scanHistory.map((item) => (
              item.scanId === scanId || item.id === scanId ? { ...item, visibility: 'community' } : item
            ))
          : prev.scanHistory;
        return {
          ...prev,
          ...(prev.scanId === scanId ? { visibility: 'community' } : {}),
          scanHistory: nextHistory,
        };
      });
      setCommunityAddOpen(false);
      setCommunityNotice('Scan added to Community Scans.');
      await loadMogPreviews();
    } catch (err) {
      setCommunityNotice(err.message || 'Could not add this scan to Community Scans.');
    }
  };

  const isAdminUser = Boolean(user?.email && (
    user.email === 'laithbu07@gmail.com' ||
    user.email === 'admin@looksmaxxing.com' ||
    user.email === 'serenity.eyb@gmail.com' ||
    user.email.endsWith('@looksmaxxing.com')
  ));

  const markCommunityScanOfficial = async (scan, official = true) => {
    const password = window.localStorage.getItem('mogcheck_admin_pw') || '';
    if (!password || !scan?.id) {
      setCommunityNotice('Admin password is required. Log into the admin panel once, then try again.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/admin/community-scans/${encodeURIComponent(scan.id)}/official`, {
        method: 'POST',
        headers: {
          'x-admin-password': password,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ official }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to update official status');
      setDashboardCommunityScans((prev) => prev.map((item) => (item.id === scan.id ? { ...item, officialScan: official, official } : item)));
      setCommunityNotice(official ? 'Scan marked as official.' : 'Scan turned back into a normal community scan.');
    } catch (err) {
      setCommunityNotice(err.message || 'Failed to update official status.');
    } finally {
      setCommunityMenuId(null);
    }
  };

  const handleDeleteProfile = async (id) => {
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/profiles/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setProfiles(profiles.filter((p) => p.id !== id));
        setAllScans((prev) => prev.filter((scan) => scan.profileId !== id));
        setDeleteProfileId(null);
      } else {
        const errBody = await res.json().catch(() => ({}));
        window.console.error(errBody.error || `Could not delete profile (${res.status})`);
      }
    } catch (err) {
      window.console.error(err.message);
    }
  };

  const scansByProfile = useMemo(() => {
    const grouped = new Map();
    allScans.forEach((scan) => {
      const profileId = scan?.profileId || 'default';
      if (!grouped.has(profileId)) grouped.set(profileId, []);
      grouped.get(profileId).push(scan);
    });
    grouped.forEach((items, key) => {
      grouped.set(
        key,
        [...items].sort((a, b) => timestampToMillis(a.timestamp || a.scannedAt) - timestampToMillis(b.timestamp || b.scannedAt))
      );
    });
    return grouped;
  }, [allScans]);

  const profilesWithMeta = useMemo(() => (
    profiles.map((profile) => {
      const scans = scansByProfile.get(profile.id) || [];
      const latestScan = scans[scans.length - 1] || null;
      return {
        ...profile,
        scanCount: scans.length,
        latestScan,
        latestScanAt: latestScan ? timestampToMillis(latestScan.timestamp || latestScan.scannedAt) : 0,
      };
    })
  ), [profiles, scansByProfile]);

  const username = user?.email?.split('@')[0] || 'User';
  const hasFullProSubscription = userPlan?.plan === 'pro';
  const isFreeModelScan = !modelUsesProDashboard(dashboardData?.selectedModel);
  const finalRating = Number(dashboardData?.finalRating) || 0;
  const categorySignals = useMemo(() => {
    const cats = dashboardData?.categories || {};
    return [
      { label: 'Harmony', value: cats.Harmony },
      { label: 'Dimorphism', value: cats.Dimorphism },
      { label: 'Skin', value: cats.Skin },
      { label: 'Symmetry', value: cats.Symmetry },
    ]
      .filter((item) => typeof item.value === 'number' && !Number.isNaN(item.value))
      .map((item) => ({
        ...item,
        display: item.value > 10 ? (item.value / 10).toFixed(1) : item.value.toFixed(1),
      }));
  }, [dashboardData]);
  const protocolPreview = (dashboardData?.protocols || []).slice(0, 3);
  const scanHistory = dashboardData?.scanHistory || [];
  const historyCards = useMemo(() => {
    const items = Array.isArray(scanHistory) ? [...scanHistory] : [];
    const currentSnapshot = dashboardData?.frontImage || dashboardData?.finalRating != null
      ? {
          ...dashboardData,
          scannedAt: dashboardData?.scannedAt || new Date().toISOString(),
        }
      : null;

    if (currentSnapshot) {
      const alreadyPresent = items.some((item) =>
        item?.frontImage === currentSnapshot.frontImage &&
        item?.sideImage === currentSnapshot.sideImage &&
        item?.finalRating === currentSnapshot.finalRating
      );
      if (!alreadyPresent) items.push(currentSnapshot);
    }

    return items
      .filter((item) => item && (item.frontImage || item.finalRating != null))
      .slice(-4)
      .reverse();
  }, [dashboardData, scanHistory]);

  const trajectoryScans = useMemo(
    () =>
      historyCards
        .slice()
        .reverse()
        .filter((scan) => Number.isFinite(Number(scan?.finalRating))),
    [historyCards]
  );

  const trajectoryGraph = useMemo(() => {
    const values = trajectoryScans.map((scan) => Number(scan.finalRating));
    if (!values.length) return { points: [], polyline: '', fill: '', current: null, delta: null };

    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(max - min, 8);
    const points = trajectoryScans.map((scan, index) => {
      const x = values.length === 1 ? 50 : 6 + (index / (values.length - 1)) * 88;
      const y = 42 - ((Number(scan.finalRating) - min) / span) * 32;
      return { x, y, scan, value: Number(scan.finalRating) };
    });
    const polyline = points.map((point) => `${point.x},${point.y}`).join(' ');
    const fill = points.length > 1 ? `6,46 ${polyline} 94,46` : '';
    const current = values[values.length - 1];
    const previous = values.length > 1 ? values[values.length - 2] : null;
    const delta = previous == null ? null : current - previous;
    return { points, polyline, fill, current, delta };
  }, [trajectoryScans]);

  const tierLabel = useMemo(() => {
    if (finalRating >= 90) return 'S+ TIER';
    if (finalRating >= 80) return 'S-TIER';
    if (finalRating >= 70) return 'A-TIER';
    if (finalRating >= 60) return 'B-TIER';
    return 'C-TIER';
  }, [finalRating]);

  const latestScanAcrossProfiles = useMemo(() => {
    if (!allScans.length) return null;
    return [...allScans]
      .sort((a, b) => timestampToMillis(b.timestamp || b.scannedAt) - timestampToMillis(a.timestamp || a.scannedAt))[0] || null;
  }, [allScans]);

  const latestScanProfile = useMemo(() => {
    if (!latestScanAcrossProfiles) return null;
    return profiles.find((profile) => profile.id === latestScanAcrossProfiles.profileId) || null;
  }, [latestScanAcrossProfiles, profiles]);
  const dashboardScanOptions = [
    {
      id: '1',
      label: 'Ultra Scan (Pro)',
      description: 'Highest-quality premium scan with the deepest structural pass.',
      buttonClass: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20',
    },
    {
      id: '2',
      label: 'Fun Mode',
      description: 'Fast premium scan for lighter, quicker entertainment-focused output.',
      buttonClass: 'bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20',
    },
    {
      id: '3',
      label: 'Basic Scan (Free)',
      description: 'Free scan tuned for a lighter dashboard with fewer premium-only sections.',
      buttonClass: 'bg-zinc-800/50 border-zinc-700 text-zinc-300 hover:bg-zinc-800',
    },
  ];

  const scrollToSection = (id) => {
    setActiveSection(id);
    const map = {
      overview: overviewRef,
      analysis: analysisRef,
      profiles: profilesRef,
      news: newsRef,
      'mog-battles': mogBattlesRef,
      community: communityRef,
    };
    const ref = map[id];
    if (ref?.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
  };

  const handleSelectScan = (scan) => {
    if (!scan || !setDashboardData) return;
    setDashboardData((prev) => ({
      ...(prev || {}),
      ...scan,
      scanHistory: Array.isArray(prev?.scanHistory) ? prev.scanHistory : historyCards.slice().reverse(),
      ratingHistory: Array.isArray(prev?.ratingHistory) ? prev.ratingHistory : [],
    }));
    setActiveSection('analysis');
    if (analysisRef.current) {
      analysisRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const openCommunityScan = useCallback((scan) => {
    if (!scan?.dashboardData) return;
    setCommunityPeek({
      id: scan.id,
      tier: scan.tier || null,
      data: {
        ...scan.dashboardData,
        selectedModel: String(scan.dashboardData?.selectedModel || '1'),
      },
    });
  }, []);

  const openProfile = async (profile) => {
    if (!profile?.id || !setDashboardData) return;
    setOpeningProfileId(profile.id);
    try {
      let scans = scansByProfile.get(profile.id) || [];
      if (scans.length === 0 && user) {
        const token = await user.getIdToken();
        const res = await fetch(`${API_BASE}/api/user/scans`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const fetchedScans = data.scans || [];
          setAllScans(fetchedScans);
          scans = fetchedScans
            .filter((scan) => (scan?.profileId || 'default') === profile.id)
            .sort((a, b) => timestampToMillis(a.timestamp || a.scannedAt) - timestampToMillis(b.timestamp || b.scannedAt));
        }
      }

      if (scans.length === 0) return;

      let history = scans.map(hydrateScanForDashboard).filter(Boolean);
      const currentSnapshot =
        dashboardData?.profileId === profile.id && (dashboardData?.frontImage || dashboardData?.finalRating != null)
          ? {
              ...dashboardData,
              scannedAt: dashboardData?.scannedAt || new Date().toISOString(),
            }
          : null;
      history = mergeProfileHistory(history, currentSnapshot);
      history.sort((a, b) => timestampToMillis(a?.scannedAt) - timestampToMillis(b?.scannedAt));
      const latestScan = history[history.length - 1];
      const ratingHistory = history
        .map((scan) => scan.finalRating)
        .filter((rating) => typeof rating === 'number' && !Number.isNaN(rating));

      setDashboardData({
        ...latestScan,
        profileId: profile.id,
        profileName: profile.name,
        scanHistory: history,
        ratingHistory,
      });
      setCurrentPage('dashboard');
      setActiveSection('analysis');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      console.error('Failed to open profile scans', e);
      window.console.error(e.message || 'Failed to open profile');
    } finally {
      setOpeningProfileId(null);
    }
  };

  const handleBackToProfiles = () => {
    if (!setDashboardData) return;
    setDashboardData({});
    setActiveSection('profiles');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navTabs = hasActiveAnalysis
    ? [
        { id: 'overview', label: 'Overview', icon: <Activity size={16} /> },
        { id: 'analysis', label: 'Analysis', icon: <Target size={16} /> },
        { id: 'mog-battles', label: 'Mog Battles', icon: <Swords size={16} /> },
        { id: 'community', label: 'Community Scans', icon: <Users size={16} /> },
        { id: 'news', label: 'News & Updates', icon: <Newspaper size={16} /> },
      ]
    : [
        { id: 'profiles', label: 'Profiles', icon: <Users size={16} /> },
        { id: 'news', label: 'News & Updates', icon: <Newspaper size={16} /> },
        { id: 'mog-battles', label: 'Mog Battles', icon: <Swords size={16} /> },
        { id: 'community', label: 'Community Scans', icon: <Users size={16} /> },
      ];

  const communityPreview = (dashboardCommunityScans.length ? dashboardCommunityScans : COMMUNITY_SCANS).slice(0, 4);
  const communityGallery = dashboardCommunityScans.length ? dashboardCommunityScans : COMMUNITY_SCANS;
  const showAnalysisShell = hasActiveAnalysis;

  useEffect(() => {
    if (!hasActiveAnalysis) return undefined;
    const sections = [
      { id: 'overview', ref: overviewRef },
      { id: 'analysis', ref: analysisRef },
      { id: 'mog-battles', ref: mogBattlesRef },
      { id: 'community', ref: communityRef },
      { id: 'news', ref: newsRef },
    ].filter((section) => section.ref.current);

    if (!sections.length) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (!visible.length) return;
        const match = sections.find((section) => section.ref.current === visible[0].target);
        if (match) setActiveSection(match.id);
      },
      {
        threshold: [0.2, 0.35, 0.5, 0.7],
        rootMargin: '-18% 0px -45% 0px',
      }
    );

    sections.forEach((section) => observer.observe(section.ref.current));
    return () => observer.disconnect();
  }, [hasActiveAnalysis]);

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#0a0a0b]">
      {communityPeek && renderCommunityDashboard && (
        <div
          className="fixed inset-0 z-[220] flex flex-col bg-[#0a0a0b] overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pro-community-scan-title"
        >
          <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-zinc-800 bg-[#0a0a0b]/95 px-4 py-3 backdrop-blur-md md:px-8">
            <button
              type="button"
              onClick={() => setCommunityPeek(null)}
              className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-2 font-sans text-xs font-bold uppercase tracking-widest text-zinc-200 hover:border-cyan-500/50 hover:text-cyan-300 transition-colors"
            >
              <ArrowLeft size={16} />
              Community Scans
            </button>
            <div className="min-w-0 flex-1">
              <p className="font-sans text-[10px] uppercase tracking-[0.35em] text-zinc-500">
                Community scan{communityPeek?.tier ? ` - ${communityPeek.tier}` : ''}
              </p>
              <h2 id="pro-community-scan-title" className="truncate font-black uppercase italic tracking-tight text-white">
                Community Scan
              </h2>
            </div>
          </header>
          <div className="flex-1 px-4 pb-16 pt-6 md:px-8">
            {renderCommunityDashboard(communityPeek.data)}
          </div>
        </div>
      )}
      <aside className="w-64 border-r border-zinc-900 hidden md:flex flex-col bg-[#0a0a0b] h-[calc(100vh-5rem)] sticky top-20 shrink-0 z-40">
        <div className="p-6 border-b border-zinc-900">
          <p className="text-zinc-500 font-sans text-[10px] uppercase tracking-widest">Dashboard</p>
        </div>

        <div className="p-6">
          <p className="text-zinc-500 font-sans text-[10px] uppercase tracking-widest mb-4">Navigate</p>
          <nav className="flex flex-col gap-2">
            {navTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => scrollToSection(tab.id)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl font-sans text-xs uppercase tracking-widest transition-all ${
                  activeSection === tab.id
                    ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50 border border-transparent'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-auto p-6 border-t border-zinc-900 flex flex-col gap-4">
          {!hasFullProSubscription && (
            <button
              type="button"
              onClick={() => setCurrentPage('plans')}
              className="flex items-center justify-between px-4 py-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 transition-all font-sans text-xs uppercase tracking-widest group"
            >
              <span className="flex items-center gap-2">
                <Crown size={14} /> Upgrade
              </span>
              <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
            </button>
          )}

          <div className="flex items-center justify-between">
            <div className="flex flex-col min-w-0">
              <span className="text-white font-bold text-sm uppercase truncate">{username}</span>
              <span className="text-zinc-500 text-[10px] font-sans uppercase tracking-widest">
                {isFreeModelScan ? 'Free member' : 'Pro Member'}
              </span>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 px-6 pb-10 pt-24 md:px-10 md:pb-10 md:pt-32 max-w-[1200px] w-full mx-auto">
        {hasActiveAnalysis && (
          <button
            type="button"
            onClick={handleBackToProfiles}
            className="mb-6 inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-2 text-xs font-bold uppercase tracking-widest text-zinc-300 transition-colors hover:border-cyan-500/30 hover:text-cyan-300"
          >
            <ArrowLeft size={15} />
            Previous Page
          </button>
        )}
        <h1 className="hidden text-3xl md:text-5xl font-black uppercase tracking-tighter italic text-white mb-2">
          Welcome Back, {username}
        </h1>
        <p className="hidden text-zinc-400 font-sans text-sm uppercase tracking-widest mb-12">
          {hasActiveAnalysis
                    ? 'Check your progress.'
            : activeSection === 'profiles'
            ? 'Select a profile to view analysis and trajectory.'
                    : 'Preview - use the buttons below to open the full page.'}
        </p>

        {showAnalysisShell && (
          <div className="flex flex-col gap-8 mb-10">
            <section ref={overviewRef} className="scroll-mt-28">
              <div className="rounded-3xl border border-cyan-500/20 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_40%),linear-gradient(180deg,rgba(7,16,20,0.98),rgba(10,10,11,0.98))] p-6 md:p-8 shadow-[0_0_40px_rgba(34,211,238,0.08)]">
                <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-end gap-4">
                    <div>
                      <p className="text-[10px] font-sans uppercase tracking-[0.35em] text-cyan-400/80 mb-3">Overall Aesthetic Score</p>
                      <div className="flex items-end gap-4">
                        <span className="text-5xl md:text-6xl font-black italic tracking-tight text-cyan-300 drop-shadow-[0_0_18px_rgba(103,232,249,0.2)]">
                {finalRating ? finalRating.toFixed(1) : '-'}
                        </span>
                        <span className="mb-2 inline-flex items-center gap-2 rounded-full border border-yellow-500/25 bg-yellow-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.25em] text-yellow-300">
                          <Crown size={12} /> {tierLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="md:max-w-xs md:border-l md:border-zinc-800 md:pl-8">
                    <p className="text-[10px] font-sans uppercase tracking-[0.3em] text-zinc-500 mb-2">Last Scan</p>
                    <p className="text-sm font-sans text-zinc-300 leading-relaxed">
                      {scanHistory.length > 0 ? 'Your latest scan is loaded below.' : 'Complete an analysis to date your profile.'}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {categorySignals.length > 0 && (
              <section className="scroll-mt-28">
                <p className="mb-4 text-[10px] font-sans uppercase tracking-[0.35em] text-zinc-500">Category Signals</p>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {categorySignals.map((signal) => (
                    <div key={signal.label} className="rounded-2xl border border-zinc-800 bg-zinc-900/45 px-4 py-3">
                      <p className="text-[10px] font-sans uppercase tracking-[0.28em] text-zinc-500">{signal.label}</p>
                      <p className="mt-2 text-xl font-black italic text-cyan-300">{signal.display}<span className="ml-1 text-[10px] text-zinc-500">/10</span></p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-orange-500/20 bg-orange-500/5 p-5">
                <div className="mb-4 flex items-center gap-3 text-orange-300">
                  <Flame size={18} />
                  <p className="text-[10px] font-sans uppercase tracking-[0.28em]">Protocol Streak</p>
                </div>
                <p className="text-3xl font-black italic text-white">{protocolPreview.length || 0} days</p>
                <p className="mt-2 text-sm font-sans leading-relaxed text-zinc-500" style={{ ...clampTextStyle, WebkitLineClamp: 3 }}>
                  Lock in the routine and use your next scan to measure progress.
                </p>
              </div>
              <div className="rounded-3xl border border-cyan-500/20 bg-cyan-500/5 p-5">
                <div className="mb-4 flex items-center gap-3 text-cyan-300">
                  <Sparkles size={18} />
                  <p className="text-[10px] font-sans uppercase tracking-[0.28em]">Insight</p>
                </div>
                <p className="text-sm font-sans leading-relaxed text-zinc-300" style={{ ...clampTextStyle, WebkitLineClamp: 6 }}>
                  {dashboardData?.technicalSummary || 'Run a scan to surface your strongest traits and biggest improvement opportunities.'}
                </p>
              </div>
              <div className="rounded-3xl border border-zinc-800 bg-zinc-900/45 p-5">
                <div className="mb-4 flex items-center gap-3 text-zinc-300">
                  <Newspaper size={18} />
                  <p className="text-[10px] font-sans uppercase tracking-[0.28em]">News & Updates</p>
                </div>
                <p className="text-sm font-sans leading-relaxed text-zinc-400" style={{ ...clampTextStyle, WebkitLineClamp: 4 }}>
                  Patch notes, research drops, and product updates stay one click away.
                </p>
                <button type="button" onClick={() => setCurrentPage('news')} className="mt-4 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.28em] text-cyan-300 hover:text-cyan-200 transition-colors">
                  Open News <ChevronRight size={14} />
                </button>
              </div>
            </div>

            <section ref={analysisRef} className="scroll-mt-28">
              <div className="mb-4">
                <h2 className="text-2xl font-black uppercase tracking-[0.25em] text-white">Face Analysis</h2>
                <p className="mt-1 text-sm font-sans text-zinc-500">Snapshot of your latest scan, trajectory, and quick signals.</p>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {historyCards.map((scan, index) => {
                  const isActive =
                    scan?.frontImage === dashboardData?.frontImage &&
                    scan?.sideImage === dashboardData?.sideImage &&
                    scan?.finalRating === dashboardData?.finalRating;
                  return (
                    <button
                      key={`${scan.frontImage || 'scan'}-${scan.finalRating || index}-${index}`}
                      type="button"
                      onClick={() => handleSelectScan(scan)}
                      className={`relative flex h-24 w-48 shrink-0 overflow-hidden rounded-2xl border bg-[#0c0d0e] text-left transition-all ${isActive ? 'border-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.18)]' : 'border-zinc-800 hover:border-zinc-700'}`}
                    >
                      <div className="absolute left-2 top-2 z-10 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">
                          {typeof scan.finalRating === 'number' ? scan.finalRating.toFixed(1) : '-'}
                      </div>
                      <div className="relative flex-1 border-r border-zinc-900">
                        <img src={scan.frontImage || 'https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png'} alt="Front profile" className="h-full w-full object-cover" />
                      </div>
                      <div className="relative flex-1">
                        <img src={scan.sideImage || scan.frontImage || 'https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png'} alt="Side profile" className="h-full w-full object-cover object-top" />
                      </div>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => handleCreateProfileAndScan(dashboardData?.selectedModel || '1')}
                  className="flex h-24 w-20 shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-[#0c0d0e] text-zinc-500 hover:border-zinc-700 hover:text-white transition-colors"
                >
                  <Plus size={18} />
                </button>
                {Array.from({ length: Math.max(0, 3 - historyCards.length) }).map((_, slot) => (
                  <div key={slot} className="flex h-24 w-32 shrink-0 items-center justify-center rounded-2xl border border-zinc-800/60 bg-[#090a0b] opacity-40">
                    <Lock size={16} className="text-zinc-700" />
                  </div>
                ))}
              </div>
            </section>

            <div className="border-t border-zinc-900 pt-8">
              {analysisContent}
            </div>

            {trajectoryScans.length > 0 && (
              <section className="scroll-mt-28 space-y-4 border-t border-zinc-900 pt-8">
                <div>
                  <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-[0.22em] text-white">
                    <Target size={18} className="text-cyan-300" /> Trajectory &amp; Goals
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm font-sans leading-relaxed text-zinc-500">
                    Track score movement across scans. Click any plotted point to jump back to that scan.
                  </p>
                </div>
                <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-3xl border border-zinc-800 bg-[#0c0d0e] p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <p className="text-[10px] font-sans uppercase tracking-[0.3em] text-zinc-500">Overall Score - Last {trajectoryScans.length} Points</p>
                      <p className="text-[10px] font-sans uppercase tracking-[0.3em] text-cyan-300">Current {trajectoryGraph.current?.toFixed?.(1) || '-'}</p>
                    </div>
                    <svg viewBox="0 0 100 52" className="h-44 w-full overflow-visible">
                      <defs>
                        <linearGradient id="trajectoryFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="rgba(34,211,238,0.28)" />
                          <stop offset="100%" stopColor="rgba(34,211,238,0)" />
                        </linearGradient>
                      </defs>
                      <line x1="6" y1="12" x2="94" y2="12" stroke="rgba(255,255,255,0.06)" strokeWidth="0.4" />
                      <line x1="6" y1="28" x2="94" y2="28" stroke="rgba(255,255,255,0.06)" strokeWidth="0.4" />
                      <line x1="6" y1="44" x2="94" y2="44" stroke="rgba(255,255,255,0.06)" strokeWidth="0.4" />
                      {trajectoryGraph.fill && <polygon points={trajectoryGraph.fill} fill="url(#trajectoryFill)" />}
                      {trajectoryGraph.polyline && (
                        <polyline
                          points={trajectoryGraph.polyline}
                          fill="none"
                          stroke="rgb(34,211,238)"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="drop-shadow-[0_0_10px_rgba(34,211,238,0.65)]"
                        />
                      )}
                      {trajectoryGraph.points.map((point, index) => (
                        <g
                          key={`${point.scan?.scanId || point.scan?.scannedAt || index}-${point.value}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleSelectScan(point.scan)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleSelectScan(point.scan);
                            }
                          }}
                          className="cursor-pointer outline-none"
                        >
                          <circle cx={point.x} cy={point.y} r="2.6" fill="rgba(34,211,238,0.2)" />
                          <circle cx={point.x} cy={point.y} r="1.35" fill="rgb(34,211,238)" />
                          <text x={point.x} y={point.y - 4.5} textAnchor="middle" className="fill-cyan-100 text-[4px] font-black">
                            {point.value.toFixed(0)}
                          </text>
                        </g>
                      ))}
                    </svg>
                  </div>
                  <div className="rounded-3xl border border-zinc-800 bg-[#0c0d0e] p-6">
                    <div className="mb-5 flex items-center gap-3 text-cyan-300">
                      <TrendingUp size={18} />
                      <p className="text-[10px] font-sans uppercase tracking-[0.28em]">Since Last Point</p>
                    </div>
                    <p className={`text-4xl font-black italic ${trajectoryGraph.delta == null ? 'text-zinc-400' : trajectoryGraph.delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {trajectoryGraph.delta == null ? '0.0' : `${trajectoryGraph.delta >= 0 ? '+' : ''}${trajectoryGraph.delta.toFixed(1)}`}
                    </p>
                    <p className="mt-3 text-sm font-sans leading-relaxed text-zinc-500">
                      {trajectoryGraph.delta == null
                        ? 'Run another saved scan on this profile to unlock live category gains and dips.'
                        : trajectoryGraph.delta >= 0
                          ? 'Your latest point is above the prior scan.'
                          : 'Your latest point is below the prior scan.'}
                    </p>
                  </div>
                </div>
              </section>
            )}

            <section ref={mogBattlesRef} className="scroll-mt-28 space-y-6 border-t border-zinc-900 pt-8">
              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-6">
                <h2 className="text-lg font-black uppercase tracking-widest text-cyan-400 mb-2 flex items-center gap-2">
                  <Swords size={20} /> Mog Battles
                </h2>
                <p className="text-zinc-500 text-sm font-sans mb-6">Preview of recent matchups. Cast votes and climb the leaderboard on the full page.</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  {mogPreviewBattles.length === 0 ? (
                  <p className="text-zinc-600 text-sm col-span-full">Loading battles...</p>
                  ) : (
                    mogPreviewBattles.map((b) => (
                      <div key={b.id} className="rounded-xl overflow-hidden border border-zinc-800 bg-black/40 aspect-[4/3] relative">
                        <div className="absolute inset-0 flex">
                          <div className="flex-1 relative">
                            <img
                              src={b.fighterA?.frontImage || b.fighterA?.imgSrc}
                              alt=""
                              className="absolute inset-0 w-full h-full object-cover object-top"
                            />
                          </div>
                          <div className="w-px bg-zinc-800" />
                          <div className="flex-1 relative">
                            <img
                              src={b.fighterB?.frontImage || b.fighterB?.imgSrc}
                              alt=""
                              className="absolute inset-0 w-full h-full object-cover object-top"
                            />
                          </div>
                        </div>
                        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 to-transparent p-2 text-[10px] font-bold text-white uppercase tracking-widest text-center">
                          VS
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setCurrentPage('mog-battles')}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 text-xs font-bold uppercase tracking-widest hover:bg-cyan-500/25 transition-colors"
                >
                  Go to Mog Battles <ChevronRight size={16} />
                </button>
              </div>
              {dashboardData?.scanId && user && (
                <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-zinc-500">Post settings</p>
                      <p className="mt-1 text-xs font-sans text-zinc-400">Visibility is now per scan, not per profile.</p>
                    </div>
                    <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">
                      {String(dashboardData.visibility || 'private') === 'community' ? 'public' : String(dashboardData.visibility || 'private')}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {['private', 'unlisted', 'community'].map((visibility) => {
                      const active = String(dashboardData.visibility || 'private') === visibility;
                      const label = visibility === 'community' ? 'public' : visibility;
                      return (
                        <button
                          key={visibility}
                          type="button"
                          onClick={() => {
                            if (active) return;
                            if (visibility === 'community') {
                              setScanVisibilityIntent({ scanId: dashboardData.scanId, visibility });
                            } else {
                              handleUpdateActiveScanVisibility(dashboardData.scanId, visibility);
                            }
                          }}
                          className={`rounded-full border px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] transition-colors ${active ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300' : 'border-zinc-800 bg-black/40 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'}`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <section ref={communityRef} className="scroll-mt-28 border-t border-zinc-900 pt-8">
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-2xl font-black uppercase tracking-tighter italic text-white mb-2">Community Scans</h2>
                    <p className="text-zinc-400 font-sans text-sm uppercase tracking-widest">Official scans are pinned first. Add your own public scan from history or start fresh.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCommunityAddOpen(true)}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-300 transition-colors hover:bg-cyan-500/20"
                  >
                    <Plus size={16} /> Add Scan
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {communityGallery.map((scan) => {
                    return (
                      <DashboardCommunityScanCard
                        key={scan.id}
                        scan={scan}
                        isAdminUser={isAdminUser}
                        communityMenuId={communityMenuId}
                        onOpen={() => openCommunityScan(scan)}
                        onToggleMenu={() => setCommunityMenuId((prev) => (prev === scan.id ? null : scan.id))}
                        onToggleOfficial={(official) => markCommunityScanOfficial(scan, official)}
                      />
                    );
                  })}
                </div>
              </div>
            </section>

            <section ref={newsRef} className="scroll-mt-28 border-t border-zinc-900 pt-8">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/25 p-8 max-w-2xl">
                <div className="flex items-center gap-3 text-violet-400 mb-4">
                  <Newspaper size={22} />
                  <h2 className="text-xl font-black uppercase tracking-widest italic">News &amp; Media</h2>
                </div>
                <p className="text-zinc-400 font-sans text-sm leading-relaxed mb-6">
                    Full feed: YouTube updates, articles, and MogCheck announcements - open the dedicated page for the live experience.
                </p>
                <button
                  type="button"
                  onClick={() => setCurrentPage('news')}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-500/15 border border-violet-500/35 text-violet-200 text-xs font-bold uppercase tracking-widest hover:bg-violet-500/25 transition-colors"
                >
                  Go to News &amp; Media <ChevronRight size={16} />
                </button>
              </div>
            </section>
          </div>
        )}

        {activeSection === 'profiles' && (
          <div ref={profilesRef} className="flex flex-col gap-6">
            {latestScanAcrossProfiles && (
              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-6">
                <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-[10px] font-sans uppercase tracking-[0.3em] text-cyan-400/80">Latest Scan</p>
                    <h3 className="mt-2 text-2xl font-black uppercase tracking-tight text-white">
                      {latestScanProfile?.name || 'Latest profile activity'}
                    </h3>
                    <p className="mt-2 text-sm font-sans text-zinc-400">
                      {latestScanAcrossProfiles?.model ? `Model ${latestScanAcrossProfiles.model}` : 'Saved scan'} - {new Date(timestampToMillis(latestScanAcrossProfiles.timestamp || latestScanAcrossProfiles.scannedAt)).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-black/30">
                      <img
                        src={latestScanAcrossProfiles.frontImageUrl || latestScanAcrossProfiles.payload?.frontImage || 'https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png'}
                        alt=""
                        className="h-24 w-24 object-cover"
                      />
                    </div>
                    <div className="text-right">
                      <p className="text-4xl font-black italic text-cyan-300">
                        {Number(latestScanAcrossProfiles.finalRating || 0).toFixed(1)}
                      </p>
                      <button
                        type="button"
                        onClick={() => latestScanProfile && openProfile(latestScanProfile)}
                        className="mt-2 inline-flex items-center gap-2 rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300 transition-colors hover:bg-cyan-500/20"
                      >
                        Open Scan <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-b border-zinc-900 pb-4">
              <h2 className="text-xl font-bold uppercase tracking-widest text-cyan-400">Your Profiles</h2>
            </div>

            {loading ? (
              <p className="text-zinc-500">Loading profiles...</p>
            ) : profiles.length === 0 ? (
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-8 text-center">
                <p className="text-zinc-400 mb-4">You don&apos;t have any profiles yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {profilesWithMeta.map((p) => (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openProfile(p)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openProfile(p);
                      }
                    }}
                    className="bg-zinc-900/40 border border-zinc-800 hover:border-cyan-500/50 rounded-2xl p-6 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-[0_0_20px_rgba(34,211,238,0.1)] group flex flex-col"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <h3 className="text-xl font-black italic text-white group-hover:text-cyan-400 transition-colors">{p.name}</h3>
                      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button type="button" onClick={(e) => { e.stopPropagation(); setRenameDraft({ id: p.id, name: p.name }); }} className="p-1 text-zinc-400 hover:text-white">
                          <Edit2 size={16} />
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setDeleteProfileId(p.id); }} className="p-1 text-red-400 hover:text-red-300">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-auto">
                      <p className="text-xs text-zinc-400 uppercase tracking-widest">Scans: {p.scanCount}</p>
                      <p className="text-xs text-zinc-500 uppercase tracking-widest mt-1">
                        Dashboard: {p.latestScan ? (modelUsesProDashboard(p.latestScan.model) ? 'Pro' : 'Free') : 'No scans yet'}
                      </p>
                      <p className="text-xs text-zinc-500 uppercase tracking-widest mt-1">
                    Created: {p.createdAt?.seconds ? new Date(p.createdAt.seconds * 1000).toLocaleDateString() : '-'}
                      </p>
                      <p className="text-xs text-zinc-500 uppercase tracking-widest mt-1">
                        {openingProfileId === p.id ? 'Opening profile...' : p.latestScanAt ? `Last scan: ${new Date(p.latestScanAt).toLocaleDateString()}` : 'Last scan: -'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-8 border border-zinc-800 bg-zinc-900/20 rounded-2xl p-6">
              <h3 className="text-lg font-bold uppercase tracking-widest text-white mb-4">Run a New Scan</h3>
              <div className="flex flex-wrap gap-4">
                {dashboardScanOptions.map((option) => (
                  <div key={option.id} className="min-w-[220px] flex-1 max-w-sm">
                    <button
                      type="button"
                      onClick={() => handleCreateProfileAndScan(option.id)}
                      className={`flex w-full items-center gap-2 px-6 py-3 rounded-xl border transition-all uppercase tracking-widest text-sm font-bold ${option.buttonClass}`}
                    >
                      <Plus size={18} /> {option.label}
                    </button>
                    <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">{option.description}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-zinc-500 mt-4">The correct AI model is pre-selected on the upload page. You can still change it there before analyzing.</p>
            </div>

            <DashboardHubPreviewsCompact setCurrentPage={setCurrentPage} onOpenCommunityScan={openCommunityScan} />
          </div>
        )}

        {!hasActiveAnalysis && activeSection === 'news' && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/25 p-8 max-w-2xl">
            <div className="flex items-center gap-3 text-violet-400 mb-4">
              <Newspaper size={22} />
              <h2 className="text-xl font-black uppercase tracking-widest italic">News &amp; Media</h2>
            </div>
            <p className="text-zinc-400 font-sans text-sm leading-relaxed mb-6">
                    Full feed: YouTube updates, articles, and MogCheck announcements - open the dedicated page for the live experience.
            </p>
            <button
              type="button"
              onClick={() => setCurrentPage('news')}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-500/15 border border-violet-500/35 text-violet-200 text-xs font-bold uppercase tracking-widest hover:bg-violet-500/25 transition-colors"
            >
              Go to News &amp; Media <ChevronRight size={16} />
            </button>
          </div>
        )}

        {!hasActiveAnalysis && activeSection === 'mog-battles' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-6">
              <h2 className="text-lg font-black uppercase tracking-widest text-cyan-400 mb-2 flex items-center gap-2">
                <Swords size={20} /> Mog Battles
              </h2>
              <p className="text-zinc-500 text-sm font-sans mb-6">Preview of recent matchups. Cast votes and climb the leaderboard on the full page.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                {mogPreviewBattles.length === 0 ? (
                  <p className="text-zinc-600 text-sm col-span-full">Loading battles...</p>
                ) : (
                  mogPreviewBattles.map((b) => (
                    <div key={b.id} className="rounded-xl overflow-hidden border border-zinc-800 bg-black/40 aspect-[4/3] relative">
                      <div className="absolute inset-0 flex">
                        <div className="flex-1 relative">
                          <img
                            src={b.fighterA?.frontImage || b.fighterA?.imgSrc}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover object-top"
                          />
                        </div>
                        <div className="w-px bg-zinc-800" />
                        <div className="flex-1 relative">
                          <img
                            src={b.fighterB?.frontImage || b.fighterB?.imgSrc}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover object-top"
                          />
                        </div>
                      </div>
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 to-transparent p-2 text-[10px] font-bold text-white uppercase tracking-widest text-center">
                        VS
                      </div>
                    </div>
                  ))
                )}
              </div>
              <button
                type="button"
                onClick={() => setCurrentPage('mog-battles')}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 text-xs font-bold uppercase tracking-widest hover:bg-cyan-500/25 transition-colors"
              >
                Go to Mog Battles <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {!hasActiveAnalysis && activeSection === 'community' && (
          <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-6">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-black uppercase tracking-widest text-emerald-400/90 mb-2 flex items-center gap-2">
                  <Users size={20} /> Community Scans
                </h2>
                <p className="text-zinc-500 text-sm font-sans">A sample of official and community-rated scans.</p>
              </div>
              <button
                type="button"
                onClick={() => setCommunityAddOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-emerald-300 transition-colors hover:bg-emerald-500/20"
              >
                <Plus size={14} /> Add Scan
              </button>
            </div>
            <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {communityPreview.map((scan) => (
                <DashboardCommunityScanCard
                  key={scan.id}
                  scan={scan}
                  compact
                  isAdminUser={isAdminUser}
                  communityMenuId={communityMenuId}
                  onOpen={() => openCommunityScan(scan)}
                  onToggleMenu={() => setCommunityMenuId((prev) => (prev === scan.id ? null : scan.id))}
                  onToggleOfficial={(official) => markCommunityScanOfficial(scan, official)}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setCurrentPage('celebrity')}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-bold uppercase tracking-widest hover:bg-emerald-500/20 transition-colors"
            >
              Go to Community Scans <ChevronRight size={16} />
            </button>
          </div>
        )}

        {renameDraft.id && (
          <SiteModal
            title="Rename Profile"
            subtitle="Update profile name"
            onClose={() => setRenameDraft({ id: null, name: '' })}
            maxWidth="max-w-lg"
          >
            <div className="space-y-4">
              <input
                value={renameDraft.name}
                onChange={(e) => setRenameDraft((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-cyan-500/50"
                placeholder="Profile name"
              />
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setRenameDraft({ id: null, name: '' })}
                  className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleRenameProfile(renameDraft.id, renameDraft.name)}
                  className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-300 transition-colors hover:bg-cyan-500/20"
                >
                  Save Name
                </button>
              </div>
            </div>
          </SiteModal>
        )}

        {communityAddOpen && (
          <SiteModal
            title="Add Community Scan"
            subtitle="Pick a saved scan or start a fresh scan"
            onClose={() => setCommunityAddOpen(false)}
            maxWidth="max-w-3xl"
          >
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setCommunityAddOpen(false);
                    handleCreateProfileAndScan('3');
                  }}
                  className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 p-4 text-left transition-colors hover:bg-cyan-500/15"
                >
                  <span className="block text-sm font-black uppercase tracking-[0.2em] text-cyan-300">Start New Scan</span>
                  <span className="mt-2 block text-xs leading-relaxed text-zinc-400">Upload a new scan first. You can publish it from the scan post settings after the result saves.</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage('celebrity')}
                  className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-left transition-colors hover:border-zinc-700"
                >
                  <span className="block text-sm font-black uppercase tracking-[0.2em] text-white">Browse Community</span>
                  <span className="mt-2 block text-xs leading-relaxed text-zinc-400">Open the full synced community gallery with official scans pinned to the top.</span>
                </button>
              </div>
              <div>
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.24em] text-zinc-500">Your scan history</p>
                <div className="max-h-[42vh] space-y-3 overflow-y-auto pr-1">
                  {allScans.length === 0 && (
                    <p className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-500">No saved scans yet.</p>
                  )}
                  {allScans.map((scan) => {
                    const scanId = String(scan.id || scan.scanId || '');
                    const alreadyPublic = communityScanIds.has(scanId) || normalizeVisibility(scan.visibility) === 'community';
                    return (
                      <div key={scanId || scan.frontImageUrl} className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-zinc-900">
                          {scan.frontImageUrl || scan.payload?.frontImage ? (
                            <img src={scan.frontImageUrl || scan.payload?.frontImage} alt="" className="h-full w-full object-cover object-top" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-zinc-700"><Users size={18} /></div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-black uppercase tracking-[0.14em] text-white">{scan.profileName || scan.profileId || 'Saved scan'}</p>
                          <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                            {modelLabel(scan.model || scan.payload?.selectedModel)} - {scan.finalRating != null ? `${scan.finalRating}/100` : 'descriptive'}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={alreadyPublic}
                          onClick={() => publishScanToCommunity(scan)}
                          className={`rounded-xl border px-3 py-2 text-[9px] font-bold uppercase tracking-[0.18em] transition-colors ${alreadyPublic ? 'cursor-not-allowed border-zinc-800 bg-zinc-900 text-zinc-600' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'}`}
                        >
                          {alreadyPublic ? 'Already Public' : 'Add'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </SiteModal>
        )}

        {communityNotice && (
          <SiteModal title="Community Scan" onClose={() => setCommunityNotice('')} maxWidth="max-w-lg">
            <p className="text-sm leading-relaxed text-zinc-300">{communityNotice}</p>
          </SiteModal>
        )}

        {deleteProfileId && (
          <ConfirmDialog
            title="Delete Profile?"
            body="Are you sure you want to delete this profile and all of its scans?"
            confirmLabel="Delete Profile"
            tone="danger"
            onClose={() => setDeleteProfileId(null)}
            onConfirm={() => handleDeleteProfile(deleteProfileId)}
          />
        )}
        {scanVisibilityIntent && (
          <ConfirmDialog
            title="Make Scan Public?"
            body="Are you sure? Making your scan public will add it to the community scans."
            confirmLabel="Make Public"
            onClose={() => setScanVisibilityIntent(null)}
            onConfirm={() => handleUpdateActiveScanVisibility(scanVisibilityIntent.scanId, scanVisibilityIntent.visibility)}
          />
        )}
      </main>
    </div>
  );
};

export default ProDashboardPage;

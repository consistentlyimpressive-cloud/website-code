import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Target, Newspaper, Swords, Users, Crown, ChevronRight, Plus, Trash2, Edit2, Activity, Flame, Sparkles, Lock, ArrowLeft, TrendingUp, TrendingDown, CheckCircle2 } from 'lucide-react';
import { getApiBase } from '../utils/apiBase';
import { COMMUNITY_SCANS } from '../data/communityScans';
import { DashboardHubPreviewsCompact } from './DashboardHubPreviews';
import { getAllFeaturedBattles } from '../data/mogBattles';
import { fetchCommunityBattles } from '../api/mogBattleVotes';

const API_BASE = getApiBase();

const clampTextStyle = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const communityCardRadiusClass = 'rounded-[28px]';

const slugifyProfileName = (value) => {
  const slug = String(value || 'profile')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'profile';
};

const buildProfileDashboardPath = (profile) => `/dashboard/${slugifyProfileName(profile?.name)}/${encodeURIComponent(profile?.id || '')}`;

const normalizeMarkedText = (value) =>
  String(value || '')
    .replace(/\*\*([\s\S]*?)\*\*/g, '*$1*')
    .replace(/\r\n/g, '\n');

const renderMarkedText = (value, boldClassName = 'font-semibold text-white') => {
  const text = normalizeMarkedText(value);
  if (!text) return null;

  const nodes = [];
  const pattern = /\*([^*]+)\*/g;
  let cursor = 0;
  let key = 0;

  const pushPlain = (chunk) => {
    if (!chunk) return;
    const parts = chunk.split('\n');
    parts.forEach((part, index) => {
      if (part) nodes.push(part);
      if (index < parts.length - 1) nodes.push(<br key={`br-${key++}`} />);
    });
  };

  let match;
  while ((match = pattern.exec(text)) !== null) {
    pushPlain(text.slice(cursor, match.index));
    nodes.push(
      <strong key={`bold-${key++}`} className={boldClassName}>
        {match[1]}
      </strong>
    );
    cursor = pattern.lastIndex;
  }

  pushPlain(text.slice(cursor));
  return nodes.length ? nodes : text;
};

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

const buildSparklinePath = (values, w = 120, h = 44) => {
  if (!values?.length) return { line: '', last: null, pts: [] };
  const pad = 4;
  const nums = values.map((v) => Number(v)).filter((v) => !Number.isNaN(v));
  if (!nums.length) return { line: '', last: null, pts: [] };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 0.01;
  const n = nums.length;
  const pts = nums.map((v, i) => {
    const x = pad + (n === 1 ? (w - 2 * pad) / 2 : (i / (n - 1)) * (w - 2 * pad));
    const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
    return [x, y];
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  const last = pts[pts.length - 1];
  return { line, last, pts };
};

const getScanMatchKey = (scan) => {
  if (!scan) return '';
  return [
    scan.scanId || '',
    scan.scannedAt || '',
    scan.frontImage || '',
    scan.sideImage || '',
    scan.finalRating ?? '',
  ].join('|');
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
    frontImage: scan.frontImageUrl || payload.frontImage || null,
    sideImage: scan.sideImageUrl || payload.sideImage || null,
    finalRating: typeof scan.finalRating === 'number' ? scan.finalRating : payload.finalRating,
    sideRating: typeof scan.sideRating === 'number' ? scan.sideRating : payload.sideRating,
    selectedModel: String(scan.model || payload.selectedModel || '').trim(),
    scannedAt: timestampToIso(scan.timestamp || scan.scannedAt),
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

const ProDashboardPage = ({ dashboardData, setCurrentPage, userPlan, user, onSignOut, setPendingUploadModel, setPendingUploadProfileId, analysisContent = null, hasActiveAnalysis = false, setDashboardData, renderCommunityDashboard = null, initialDashboardProfileId = null }) => {
  const [profiles, setProfiles] = useState([]);
  const [allScans, setAllScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openingProfileId, setOpeningProfileId] = useState(null);
  const [activeSection, setActiveSection] = useState(hasActiveAnalysis ? 'overview' : 'profiles');
  const [mogPreviewBattles, setMogPreviewBattles] = useState([]);
  const [communityPeek, setCommunityPeek] = useState(null);
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
      if (!user) return;
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

  const handleRenameProfile = async (e, id, currentName) => {
    e.stopPropagation();
    const name = prompt('Enter new profile name:', currentName);
    if (!name) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/profiles/${id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setProfiles(profiles.map((p) => (p.id === id ? { ...p, name } : p)));
      } else {
        const errBody = await res.json().catch(() => ({}));
        alert(errBody.error || `Could not rename profile (${res.status})`);
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteProfile = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this profile and ALL its scans?')) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/profiles/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setProfiles(profiles.filter((p) => p.id !== id));
        setAllScans((prev) => prev.filter((scan) => scan.profileId !== id));
      } else {
        const errBody = await res.json().catch(() => ({}));
        alert(errBody.error || `Could not delete profile (${res.status})`);
      }
    } catch (err) {
      alert(err.message);
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
  const overviewRating = useMemo(() => {
    const v = dashboardData?.finalRating;
    if (v == null || Number.isNaN(Number(v))) return null;
    return Number(v);
  }, [dashboardData?.finalRating]);
  const categoryDeltaStats = useMemo(() => {
    const curr = dashboardData?.categories;
    const prev = dashboardData?.previousCategories;
    if (!curr || typeof curr !== 'object' || !prev || typeof prev !== 'object') {
      return { hasPrev: false, best: null, worst: null };
    }
    const keys = ['Harmony', 'Dimorphism', 'Skin', 'Symmetry', 'Bone'];
    let best = { key: '', delta: -Infinity };
    let worst = { key: '', delta: Infinity };
    for (const k of keys) {
      const c = curr[k];
      const p = prev[k];
      if (typeof c !== 'number' || typeof p !== 'number') continue;
      const d = c - p;
      if (d > best.delta) best = { key: k, delta: d };
      if (d < worst.delta) worst = { key: k, delta: d };
    }
    if (best.delta === -Infinity) return { hasPrev: false, best: null, worst: null };
    return { hasPrev: true, best, worst };
  }, [dashboardData?.categories, dashboardData?.previousCategories]);
  const goalMilestonesBase = useMemo(() => {
    const protocols = Array.isArray(dashboardData?.protocols) ? dashboardData.protocols : [];
    const p0 = protocols[0];
    const p1 = protocols[1];
    return [
      { id: 'g1', label: 'Baseline facial scan', description: 'Initial metrics captured' },
      {
        id: 'g2',
        label: p0?.name || 'Primary protocol block',
        description: p0?.description ? `${String(p0.description).slice(0, 72)}${String(p0.description).length > 72 ? '...' : ''}` : 'Execute your highest-impact protocol',
      },
      { id: 'g3', label: 'Mid-point check-in', description: 'Log progress around week 4-6' },
      {
        id: 'g4',
        label: p1?.name || 'Secondary focus',
        description: p1?.description ? `${String(p1.description).slice(0, 60)}${String(p1.description).length > 60 ? '...' : ''}` : 'Tackle the next ranked flaw',
      },
      { id: 'g5', label: 'Re-scan & compare', description: 'New front + side captures for trajectory' },
      { id: 'g6', label: 'Goal review', description: 'Full metric comparison vs. baseline' },
    ];
  }, [dashboardData?.protocols]);
  const ladderScopeKey =
    dashboardData?.scanId ||
    dashboardData?.scannedAt ||
    dashboardData?.profileId ||
    dashboardData?.frontImage ||
    'default';
  const ladderStorageKey = `mogcheck-goal-ladder:${user?.uid || 'local'}:${ladderScopeKey}`;
  const [completedLadderCount, setCompletedLadderCount] = useState(0);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ladderStorageKey);
      if (raw != null) {
        const n = parseInt(raw, 10);
        if (!Number.isNaN(n)) {
          setCompletedLadderCount(Math.max(0, Math.min(n, goalMilestonesBase.length)));
          return;
        }
      }
      setCompletedLadderCount(0);
    } catch {
      setCompletedLadderCount(0);
    }
  }, [ladderStorageKey, goalMilestonesBase.length]);
  useEffect(() => {
    try {
      localStorage.setItem(ladderStorageKey, String(completedLadderCount));
    } catch {
      /* ignore */
    }
  }, [completedLadderCount, ladderStorageKey]);
  const goalMilestones = useMemo(
    () =>
      goalMilestonesBase.map((m, i) => ({
        ...m,
        status:
          i < completedLadderCount
            ? 'completed'
            : i === completedLadderCount && completedLadderCount < goalMilestonesBase.length
              ? 'current'
              : 'locked',
      })),
    [goalMilestonesBase, completedLadderCount]
  );
  const canMoveGoalBackward = completedLadderCount > 0;
  const canMoveGoalForward = completedLadderCount < goalMilestonesBase.length;
  const stepGoalBackward = useCallback(() => {
    setCompletedLadderCount((count) => Math.max(count - 1, 0));
  }, []);
  const stepGoalForward = useCallback(() => {
    setCompletedLadderCount((count) => Math.min(count + 1, goalMilestonesBase.length));
  }, [goalMilestonesBase.length]);
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

  const trajectoryPoints = useMemo(() => (
    historyCards
      .map((scan) => ({
        key: getScanMatchKey(scan),
        rating: Number(scan?.finalRating),
      }))
      .filter((item) => !Number.isNaN(item.rating))
  ), [historyCards]);

  const selectedTrajectoryIndex = useMemo(() => {
    if (!trajectoryPoints.length) return -1;
    const currentKey = getScanMatchKey(dashboardData);
    const matchIndex = trajectoryPoints.findIndex((item) => item.key === currentKey);
    if (matchIndex >= 0) return matchIndex;
    return 0;
  }, [dashboardData, trajectoryPoints]);

  const scoreHistory = useMemo(() => {
    if (trajectoryPoints.length) return trajectoryPoints.map((item) => item.rating);
    const cur = overviewRating;
    if (cur != null && !Number.isNaN(Number(cur))) return [Number(cur)];
    return [];
  }, [overviewRating, trajectoryPoints]);

  const sparkline = useMemo(() => buildSparklinePath(scoreHistory, 140, 48), [scoreHistory]);

  const deltaSinceLastScan = useMemo(() => {
    if (selectedTrajectoryIndex < 0 || selectedTrajectoryIndex >= scoreHistory.length - 1) return null;
    const current = scoreHistory[selectedTrajectoryIndex];
    const nextPoint = scoreHistory[selectedTrajectoryIndex + 1];
    if (typeof current !== 'number' || typeof nextPoint !== 'number') return null;
    return Number((nextPoint - current).toFixed(2));
  }, [scoreHistory, selectedTrajectoryIndex]);

  const tierLabel = useMemo(() => {
    if (finalRating >= 90) return 'S+ TIER';
    if (finalRating >= 80) return 'S-TIER';
    if (finalRating >= 70) return 'A-TIER';
    if (finalRating >= 60) return 'B-TIER';
    return 'C-TIER';
  }, [finalRating]);

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

  const scrollToStructuralOverview = () => {
    setActiveSection('analysis');
    analysisRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const tryScroll = () => {
      const node = document.getElementById('dashboard-structural-overview');
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
      }
      return false;
    };

    if (!tryScroll()) {
      window.setTimeout(tryScroll, 240);
      window.setTimeout(tryScroll, 650);
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

  const openProfile = useCallback(async (profile) => {
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
      setCurrentPage('dashboard', buildProfileDashboardPath(profile));
      setActiveSection('analysis');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      console.error('Failed to open profile scans', e);
      alert(e.message || 'Failed to open profile');
    } finally {
      setOpeningProfileId(null);
    }
  }, [dashboardData, scansByProfile, setCurrentPage, setDashboardData, user]);

  const handleBackToProfiles = () => {
    if (!setDashboardData) return;
    setDashboardData({});
    setCurrentPage('dashboard');
    setActiveSection('profiles');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    if (!initialDashboardProfileId || loading || openingProfileId) return;
    if (dashboardData?.profileId === initialDashboardProfileId && hasActiveAnalysis) return;

    const targetProfile = profilesWithMeta.find((profile) => profile.id === initialDashboardProfileId);
    if (targetProfile) {
      openProfile(targetProfile);
    }
  }, [
    dashboardData?.profileId,
    hasActiveAnalysis,
    initialDashboardProfileId,
    loading,
    openProfile,
    openingProfileId,
    profilesWithMeta,
  ]);

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

  const communityPreview = COMMUNITY_SCANS.slice(0, 4);
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
                Community scan{communityPeek?.tier ? ` · ${communityPeek.tier}` : ''}
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
            ? 'Let’s check your progress.'
            : activeSection === 'profiles'
            ? 'Select a profile to view analysis and trajectory.'
            : 'Preview — use the buttons below to open the full page.'}
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
                          {finalRating ? finalRating.toFixed(1) : '—'}
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
              <button
                type="button"
                onClick={scrollToStructuralOverview}
                className="rounded-3xl border border-cyan-500/20 bg-cyan-500/5 p-5 text-left transition-all hover:border-cyan-400/35 hover:bg-cyan-500/10 hover:shadow-[0_0_24px_rgba(34,211,238,0.12)]"
              >
                <div className="mb-4 flex items-center gap-3 text-cyan-300">
                  <Sparkles size={18} />
                  <p className="text-[10px] font-sans uppercase tracking-[0.28em]">Latest Insight</p>
                </div>
                <p className="text-sm font-sans leading-relaxed text-zinc-300" style={{ ...clampTextStyle, WebkitLineClamp: 6 }}>
                  {renderMarkedText(dashboardData?.technicalSummary || 'Run a scan to surface your strongest traits and biggest improvement opportunities.')}
                </p>
              </button>
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
                        {typeof scan.finalRating === 'number' ? scan.finalRating.toFixed(1) : '—'}
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

            {!isFreeModelScan && (
              <section className="border-t border-zinc-900 pt-8">
                <div className="rounded-2xl border border-zinc-800 bg-[#0c0d0e] p-6 md:p-8 relative overflow-hidden shadow-lg group hover:border-zinc-700 transition-colors flex flex-col gap-8">
                  <div className="absolute top-0 left-0 w-64 h-64 bg-cyan-500/5 rounded-full blur-[80px] -translate-y-1/2 -translate-x-1/2 pointer-events-none" />
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between relative z-10">
                    <div>
                      <h3 className="text-zinc-400 font-sans text-xs uppercase tracking-widest flex items-center gap-2">
                        <Target size={14} className="text-zinc-500" /> Trajectory &amp; Goals
                      </h3>
                      <p className="text-zinc-600 font-sans text-[10px] uppercase tracking-widest mt-2 max-w-md">
                        Track score movement across scans and mark off your current improvement ladder.
                      </p>
                    </div>
                    <div className="text-left sm:text-right shrink-0">
                      <span className="font-sans text-[10px] uppercase tracking-widest text-zinc-500 block mb-1">Target goal</span>
                      <span className="text-2xl font-black italic text-white drop-shadow-md tabular-nums">
                        {overviewRating != null ? Math.min(99, Number(overviewRating) + 5).toFixed(1) : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="relative z-10 grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-10">
                    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-4">
                      <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-3">Overall score — last {scoreHistory.length} points</p>
                      <div className="flex items-end gap-4">
                        <svg viewBox="0 0 140 48" className="h-28 w-full max-w-[200px] text-cyan-400" preserveAspectRatio="xMidYMid meet" aria-hidden>
                          <defs>
                            <linearGradient id="sparkFillPro" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="rgb(34,211,238)" stopOpacity="0.25" />
                              <stop offset="100%" stopColor="rgb(34,211,238)" stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          <line x1="4" y1="4" x2="136" y2="4" stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.5" />
                          <line x1="4" y1="24" x2="136" y2="24" stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.5" />
                          <line x1="4" y1="44" x2="136" y2="44" stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.5" />
                          {sparkline.line && sparkline.pts?.length ? (
                            <>
                              <path
                                d={`${sparkline.line} L ${sparkline.pts[sparkline.pts.length - 1][0]} 48 L ${sparkline.pts[0][0]} 48 Z`}
                                fill="url(#sparkFillPro)"
                                className="opacity-90"
                              />
                              <path
                                d={sparkline.line}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="drop-shadow-[0_0_10px_rgba(34,211,238,0.45)]"
                              />
                              {sparkline.pts.map(([x, y], i) => (
                                <circle
                                  key={i}
                                  cx={x}
                                  cy={y}
                                  r={i === selectedTrajectoryIndex ? 3.5 : 2}
                                  fill={i === selectedTrajectoryIndex ? '#22d3ee' : '#64748b'}
                                  className={i === selectedTrajectoryIndex ? 'drop-shadow-[0_0_8px_rgba(34,211,238,0.9)]' : ''}
                                />
                              ))}
                            </>
                          ) : null}
                        </svg>
                        <div className="pb-1">
                          <p className="font-sans text-[10px] uppercase tracking-widest text-zinc-500">Current</p>
                          <p className="text-3xl font-black italic text-white tabular-nums">
                            {overviewRating != null ? overviewRating.toFixed(1) : '—'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-4 flex flex-col justify-center gap-4">
                      <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-zinc-500">Since last point</p>
                      <div className="flex items-center gap-3">
                        {deltaSinceLastScan != null ? (
                          <>
                            {deltaSinceLastScan > 0 ? (
                              <TrendingUp className="text-emerald-400 shrink-0" size={22} />
                            ) : deltaSinceLastScan < 0 ? (
                              <TrendingDown className="text-rose-400 shrink-0" size={22} />
                            ) : (
                              <Activity className="text-zinc-500 shrink-0" size={22} />
                            )}
                            <div>
                              <span className={`text-2xl font-black tabular-nums ${
                                deltaSinceLastScan > 0 ? 'text-emerald-400' : deltaSinceLastScan < 0 ? 'text-rose-400' : 'text-zinc-400'
                              }`}>
                                {deltaSinceLastScan > 0 ? '+' : ''}
                                {deltaSinceLastScan.toFixed(2)}
                              </span>
                              <span className="text-zinc-500 font-sans text-xs ml-2">vs prior</span>
                            </div>
                          </>
                        ) : (
                          <span className="text-zinc-500 font-sans text-sm">
                            {scoreHistory.length >= 2
                              ? 'Select a newer scan card to compare against its prior point.'
                              : 'Run another scan to compare trajectory.'}
                          </span>
                        )}
                      </div>
                      <div className="border-t border-zinc-800/80 pt-4 space-y-3">
                        {categoryDeltaStats.hasPrev && categoryDeltaStats.best && categoryDeltaStats.worst ? (
                          <>
                            <div className="flex justify-between gap-2 text-sm">
                              <span className="text-zinc-500 font-sans">Best category gain</span>
                              <span className="text-emerald-400 font-mono font-bold tabular-nums">
                                {categoryDeltaStats.best.key} {categoryDeltaStats.best.delta > 0 ? '+' : ''}{(categoryDeltaStats.best.delta / 10).toFixed(1)}
                              </span>
                            </div>
                            <div className="flex justify-between gap-2 text-sm">
                              <span className="text-zinc-500 font-sans">Largest dip</span>
                              <span className={`font-mono font-bold tabular-nums ${categoryDeltaStats.worst.delta < 0 ? 'text-rose-400' : 'text-zinc-400'}`}>
                                {categoryDeltaStats.worst.key} {(categoryDeltaStats.worst.delta / 10).toFixed(1)}
                              </span>
                            </div>
                          </>
                        ) : (
                          <p className="text-zinc-500 font-sans text-xs leading-relaxed">
                            Run another saved scan on this profile to unlock live category gains and dips here.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="relative z-10 border-t border-zinc-800/80 pt-6">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="font-sans text-[10px] uppercase tracking-[0.28em] text-zinc-500">Goal ladder</p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={stepGoalBackward}
                          disabled={!canMoveGoalBackward}
                          className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/70 px-3 py-1.5 text-[10px] font-sans uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white disabled:cursor-not-allowed disabled:border-zinc-900 disabled:text-zinc-700"
                        >
                          <ArrowLeft size={12} />
                          Back
                        </button>
                        <button
                          type="button"
                          onClick={stepGoalForward}
                          disabled={!canMoveGoalForward}
                          className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-950/20 px-3 py-1.5 text-[10px] font-sans uppercase tracking-[0.24em] text-cyan-300 transition-colors hover:border-cyan-400/60 hover:text-cyan-200 disabled:cursor-not-allowed disabled:border-zinc-900 disabled:bg-zinc-950/60 disabled:text-zinc-700"
                        >
                          Forward
                          <ChevronRight size={12} />
                        </button>
                      </div>
                    </div>
                    <div className="relative">
                      {goalMilestones.map((m, idx) => {
                        const done = m.status === 'completed';
                        const current = m.status === 'current';
                        const locked = m.status === 'locked';
                        return (
                          <div key={m.id} className="relative flex gap-4 pb-8 last:pb-2">
                            {idx < goalMilestones.length - 1 && (
                              <div className="absolute left-[15px] top-10 bottom-0 w-px bg-gradient-to-b from-zinc-600 to-zinc-800" aria-hidden="true" />
                            )}
                            <div className="relative z-10 shrink-0">
                              {done && (
                                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-500/50 bg-emerald-500/15">
                                  <CheckCircle2 size={16} className="text-emerald-400" />
                                </div>
                              )}
                              {current && (
                                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-cyan-500 bg-cyan-500/20 shadow-[0_0_14px_rgba(34,211,238,0.35)]">
                                  <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)]" />
                                </div>
                              )}
                              {locked && (
                                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/80">
                                  <Lock size={14} className="text-zinc-600" />
                                </div>
                              )}
                            </div>
                            <div
                              role={current ? 'button' : undefined}
                              tabIndex={current ? 0 : undefined}
                              onClick={() => {
                                if (!current) return;
                                stepGoalForward();
                              }}
                              onKeyDown={(e) => {
                                if (!current) return;
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  stepGoalForward();
                                }
                              }}
                              className={`min-w-0 flex-1 rounded-xl border p-4 text-left ${
                                current
                                  ? 'border-cyan-500/35 bg-cyan-950/15 cursor-pointer hover:border-cyan-500/55 hover:bg-cyan-900/20'
                                  : 'border-zinc-800/80 bg-zinc-950/25'
                              }`}
                            >
                              <p className={`font-sans text-[10px] uppercase tracking-widest mb-1 ${done ? 'text-emerald-500' : current ? 'text-cyan-400' : 'text-zinc-600'}`}>
                                {done ? 'Done' : current ? 'Active — click to complete' : 'Locked'}
                              </p>
                              <p className={`text-sm font-bold uppercase tracking-wide leading-snug ${done || current ? 'text-zinc-100' : 'text-zinc-500'}`}>{m.label}</p>
                              <p className={`font-sans text-xs mt-1 leading-relaxed ${done || current ? 'text-zinc-400' : 'text-zinc-600'}`}>{m.description}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
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
            </section>

            <section ref={communityRef} className="scroll-mt-28 border-t border-zinc-900 pt-8">
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="text-2xl font-black uppercase tracking-tighter italic text-white mb-2">Community Scans</h2>
                  <p className="text-zinc-400 font-sans text-sm uppercase tracking-widest">See how others in the community stack up.</p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {COMMUNITY_SCANS.map((scan) => {
                    const dd = scan.dashboardData;
                    const rating = dd?.finalRating ?? 0;
                    const tierUpper = String(scan.tier || '').toUpperCase();
                    const tierBadgeClass =
                      tierUpper.includes('S') && tierUpper.includes('TIER')
                        ? 'bg-red-500/20 text-red-500 border-red-500/30 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                        : tierUpper.includes('A') && tierUpper.includes('TIER')
                          ? 'bg-orange-500/20 text-orange-400 border-orange-500/30 shadow-[0_0_8px_rgba(249,115,22,0.6)]'
                          : 'bg-zinc-700/40 text-zinc-300 border-zinc-600/50';
                    return (
                      <button
                        key={scan.id}
                        type="button"
                        onClick={() => openCommunityScan(scan)}
                        className={`group relative overflow-hidden border border-zinc-800 bg-[#0c0d0e] text-left transition-all hover:border-cyan-500/50 hover:shadow-[0_0_20px_rgba(34,211,238,0.15)] ${communityCardRadiusClass}`}
                      >
                        <div className={`relative aspect-[3/4] overflow-hidden bg-zinc-900 ${communityCardRadiusClass}`}>
                          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0b] via-transparent to-transparent z-10 pointer-events-none" />
                          {dd?.frontImage ? (
                            <img
                              src={dd.frontImage}
                              alt=""
                              className="absolute inset-0 w-full h-full object-cover object-top"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-700 opacity-50">
                              <Users size={48} />
                            </div>
                          )}
                          <div className="absolute top-3 left-3 z-20">
                            <span className={`border text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${tierBadgeClass}`}>
                              {scan.tier || '-'}
                            </span>
                          </div>
                          <div className="absolute bottom-3 left-3 z-20 flex items-baseline gap-1">
                            <span className="text-white font-black italic text-2xl drop-shadow-[0_0_10px_rgba(255,255,255,0.4)] tabular-nums">
                              {Number(rating).toFixed(1)}
                            </span>
                            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">/100</span>
                          </div>
                        </div>
                        <div className="border-t border-zinc-800 bg-[#0a0a0b] px-4 py-3">
                          <span className="block text-zinc-500 font-sans text-[9px] uppercase tracking-[0.25em] mt-1">
                            View results & analysis
                          </span>
                        </div>
                      </button>
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
                        <button type="button" onClick={(e) => handleRenameProfile(e, p.id, p.name)} className="p-1 text-zinc-400 hover:text-white">
                          <Edit2 size={16} />
                        </button>
                        <button type="button" onClick={(e) => handleDeleteProfile(e, p.id)} className="p-1 text-red-400 hover:text-red-300">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-auto">
                      <p className="text-xs text-zinc-400 uppercase tracking-widest">Scans: {p.scanCount}</p>
                      <p className="text-xs text-zinc-500 uppercase tracking-widest mt-1">
                        Dashboard: {p.latestScan ? (modelUsesProDashboard(p.latestScan.model) ? 'Pro' : 'Free') : 'No scans yet'}
                      </p>
                      <p className="text-xs text-zinc-500 uppercase tracking-widest mt-1">Visibility: {p.visibility}</p>
                      <p className="text-xs text-zinc-500 uppercase tracking-widest mt-1">
                        Created: {p.createdAt?.seconds ? new Date(p.createdAt.seconds * 1000).toLocaleDateString() : '—'}
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
                <button
                  type="button"
                  onClick={() => handleCreateProfileAndScan('1')}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 transition-all uppercase tracking-widest text-sm font-bold"
                >
                  <Plus size={18} /> Ultra Scan (Pro)
                </button>
                <button
                  type="button"
                  onClick={() => handleCreateProfileAndScan('2')}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 transition-all uppercase tracking-widest text-sm font-bold"
                >
                  <Plus size={18} /> Fun Mode
                </button>
                <button
                  type="button"
                  onClick={() => handleCreateProfileAndScan('3')}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-all uppercase tracking-widest text-sm font-bold"
                >
                  <Plus size={18} /> Basic Scan (Free)
                </button>
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
              Full feed: YouTube updates, articles, and MogCheck announcements — open the dedicated page for the live experience.
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
                  <p className="text-zinc-600 text-sm col-span-full">Loading battles…</p>
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
            <h2 className="text-lg font-black uppercase tracking-widest text-emerald-400/90 mb-2 flex items-center gap-2">
              <Users size={20} /> Community Scans
            </h2>
            <p className="text-zinc-500 text-sm font-sans mb-6">A sample of community-rated scans. Browse the full gallery on the Scans page.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {communityPreview.map((scan) => (
                <button
                  key={scan.id}
                  type="button"
                  onClick={() => openCommunityScan(scan)}
                  className="group relative aspect-[3/4] rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900 text-left hover:border-emerald-400/40 transition-colors"
                >
                  <img src={scan.dashboardData?.frontImage} alt="" className="w-full h-full object-cover object-top" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 py-3">
                    <span className="block text-[8px] uppercase tracking-[0.2em] text-zinc-400 mt-1">
                      Open analysis
                    </span>
                  </div>
                </button>
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
      </main>
    </div>
  );
};

export default ProDashboardPage;

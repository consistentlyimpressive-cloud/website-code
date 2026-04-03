import React, { useState, useEffect, useMemo } from 'react';
import { 
  ChevronRight, 
  Settings, 
  Activity, 
  Target, 
  Users, 
  Crown,
  Play,
  CheckCircle2,
  ExternalLink,
  ChevronDown,
  ArrowLeft,
  Lock,
  Newspaper,
  TrendingUp,
  TrendingDown,
  FileText,
  Flame,
  Sparkles,
  Calendar,
  Swords
} from 'lucide-react';
// We'll pass DashboardPage as a prop or render its content differently since it's inside App.jsx

// We need to move the actual Dashboard content into a separate component so we can reuse it here
// Since DashboardPage currently contains the whole page layout, we'll wrap it and hide the parts we don't want
// or ideally refactor DashboardPage to export its inner content. For now, we'll render it directly 
// but in a real scenario we'd extract the Analysis and Protocols sections.

import { mockSkillTree } from '../data/mockSkillTree';
import { COMMUNITY_SCANS } from '../data/communityScans';
import { hasEffectiveProAccess } from '../utils/planAccess';

/** Strip best/flaw lists so community preview matches product copy (no "best features" cards). */
function stripCommunityDashboardData(dd) {
  if (!dd || typeof dd !== 'object') return dd;
  const { bestFeatures, primaryFlaws, sideBestFeatures, sidePrimaryFlaws, ...rest } = dd;
  return rest;
}

const tierFromRating = (r) => {
  if (r == null || Number.isNaN(Number(r))) return '—';
  const n = Number(r);
  if (n >= 9) return 'S-Tier';
  if (n >= 8) return 'A-Tier';
  if (n >= 7) return 'B-Tier';
  if (n >= 6) return 'C-Tier';
  return 'D-Tier';
};

const percentileFromRating = (r) => {
  if (r == null || Number.isNaN(Number(r))) return null;
  const n = Number(r);
  return Math.min(99, Math.max(1, Math.round(35 + (n - 4.5) * 11)));
};

const formatLastScan = (d) => {
  const raw = d?.analyzedAt ?? d?.analysisDate ?? d?.updatedAt ?? d?.createdAt ?? d?.scanDate;
  if (raw == null) return null;
  try {
    const date = typeof raw === 'number' ? new Date(raw) : new Date(raw);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return null;
  }
};

/** Build SVG path for a sparkline; values on same scale as overview rating (~4–10). */
const buildSparklinePath = (values, w = 120, h = 44) => {
  if (!values?.length) return { line: '', last: null };
  const pad = 4;
  const nums = values.map((v) => Number(v));
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

const ProDashboardPage = ({ dashboardData, setCurrentPage, userPlan, user, onSignOut, DashboardComponent }) => {
  const [activeSection, setActiveSection] = useState('overview'); // overview, analysis, protocols, news, mog-battles, community

  /** Free-tier AI models for non-Pro users — show minimal overview + analysis only */
  const isFreeModelScan =
    ['3', '4', '5'].includes(String(dashboardData?.selectedModel ?? '')) &&
    !hasEffectiveProAccess(user, userPlan);
  const sectionIds = useMemo(
    () =>
      isFreeModelScan
        ? ['overview', 'analysis', 'community']
        : ['overview', 'analysis', 'protocols', 'news', 'mog-battles', 'community'],
    [isFreeModelScan]
  );

  const navTabs = isFreeModelScan
    ? [
        { id: 'overview', label: 'Overview', icon: <Target size={16} /> },
        { id: 'analysis', label: 'Analysis', icon: <Activity size={16} /> },
        { id: 'community', label: 'Community Scans', icon: <Users size={16} /> },
      ]
    : [
        { id: 'overview', label: 'Overview', icon: <Target size={16} /> },
        { id: 'analysis', label: 'Analysis', icon: <Activity size={16} /> },
        { id: 'protocols', label: 'Protocols', icon: <Play size={16} /> },
        { id: 'news', label: 'News & Updates', icon: <Newspaper size={16} /> },
        { id: 'mog-battles', label: 'Mog Battles', icon: <Swords size={16} /> },
        { id: 'community', label: 'Community Scans', icon: <Users size={16} /> },
      ];
  
  const username = user?.email?.split('@')[0] || 'User_8410';

  useEffect(() => {
    if (isFreeModelScan && !['overview', 'analysis', 'community'].includes(activeSection)) {
      setActiveSection('overview');
    }
  }, [isFreeModelScan, activeSection]);

  const overviewRating = useMemo(() => {
    const v = dashboardData?.finalRating;
    if (v == null || Number.isNaN(Number(v))) return null;
    return Number(v);
  }, [dashboardData?.finalRating]);

  const categoryChips = useMemo(() => {
    let c = dashboardData?.categories;
    if (Array.isArray(c) || !c || typeof c !== 'object') {
      c = null;
    }
    
    // If we have real categories, use them. Otherwise, generate realistic ones based on final rating.
    const baseScore = dashboardData?.finalRating || 85;
    const defaults = { 
      Harmony: Math.round(baseScore), 
      Symmetry: Math.max(10, Math.round(baseScore - 3)), 
      Dimorphism: Math.max(10, Math.round(baseScore - 7)), 
      Skin: Math.max(10, Math.round(baseScore - 5)) 
    };
    
    const src = c || defaults;
    return [
      { label: 'Harmony', val: src.Harmony ?? defaults.Harmony },
      { label: 'Dimorphism', val: src.Dimorphism ?? defaults.Dimorphism },
      { label: 'Skin', val: src.Skin ?? defaults.Skin },
      { label: 'Symmetry', val: src.Symmetry ?? defaults.Symmetry },
    ].map((x) => ({
      ...x,
      display: typeof x.val === 'number' && !Number.isNaN(x.val) ? (x.val / 10).toFixed(1) : '—',
    }));
  }, [dashboardData?.categories, dashboardData?.finalRating]);

  const insightLine = useMemo(() => {
    const summary = dashboardData?.technicalSummary;
    if (summary && typeof summary === 'string' && summary.length > 24 && summary !== 'Could not generate technical summary.') {
      const t = summary.trim();
      return t.length > 220 ? `${t.slice(0, 220)}…` : t;
    }
    const cats = dashboardData?.categories;
    if (cats && typeof cats === 'object') {
      const entries = Object.entries(cats).filter(([, v]) => typeof v === 'number' && !Number.isNaN(v));
      if (entries.length) {
        const sorted = [...entries].sort((a, b) => b[1] - a[1]);
        const top = sorted[0];
        const low = sorted[sorted.length - 1];
        return `Strongest pillar: ${top[0]} (${(top[1] / 10).toFixed(1)}/10). Next lever to move: ${low[0]} (${(low[1] / 10).toFixed(1)}/10). Align routines with those gaps.`;
      }
    }
    return 'Run a fresh analysis to unlock personalized insights tailored to your facial metrics.';
  }, [dashboardData?.technicalSummary, dashboardData?.categories]);

  const protocolStreakDays = dashboardData?.protocolStreakDays ?? 12;
  const lastScanLabel = formatLastScan(dashboardData);

  /** Last scores: real `ratingHistory` from API only (no synthetic history). */
  const scoreHistory = useMemo(() => {
    const raw = dashboardData?.ratingHistory;
    if (Array.isArray(raw) && raw.length >= 1) {
      return raw.map((x) => Number(x)).filter((x) => !Number.isNaN(x));
    }
    const cur = overviewRating;
    if (cur != null && !Number.isNaN(Number(cur))) return [Number(cur)];
    return [];
  }, [dashboardData?.ratingHistory, overviewRating]);

  const sparkline = useMemo(() => buildSparklinePath(scoreHistory, 140, 48), [scoreHistory]);

  const deltaSinceLastScan = useMemo(() => {
    const raw = dashboardData?.ratingHistory;
    if (!Array.isArray(raw) || raw.length < 2) return null;
    const nums = raw.map((x) => Number(x)).filter((x) => !Number.isNaN(x));
    if (nums.length < 2) return null;
    const a = nums[nums.length - 2];
    const b = nums[nums.length - 1];
    const d = Number((b - a).toFixed(2));
    if (d <= 0) return null;
    return d;
  }, [dashboardData?.ratingHistory]);

  const categoryDeltaStats = useMemo(() => {
    const curr = dashboardData?.categories;
    const prev = dashboardData?.previousCategories;
    if (!curr || typeof curr !== 'object') {
      return { hasPrev: false, best: null, worst: null };
    }
    if (!prev || typeof prev !== 'object') {
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

  /** Discrete milestones — progress is saved locally so the ladder is interactive */
  const goalMilestonesBase = useMemo(() => {
    const protocols = Array.isArray(dashboardData?.protocols) ? dashboardData.protocols : [];
    const p0 = protocols[0];
    const p1 = protocols[1];
    return [
      {
        id: 'g1',
        label: 'Baseline facial scan',
        description: 'Initial metrics captured',
      },
      {
        id: 'g2',
        label: p0?.name || 'Primary protocol block',
        description: p0?.description ? `${String(p0.description).slice(0, 72)}${String(p0.description).length > 72 ? '…' : ''}` : 'Execute your highest-impact protocol',
      },
      {
        id: 'g3',
        label: 'Mid-point check-in',
        description: 'Log progress around week 4–6',
      },
      {
        id: 'g4',
        label: p1?.name || 'Secondary focus',
        description: p1?.description ? `${String(p1.description).slice(0, 60)}…` : 'Tackle the next ranked flaw',
      },
      {
        id: 'g5',
        label: 'Re-scan & compare',
        description: 'New front + side captures for trajectory',
      },
      {
        id: 'g6',
        label: 'Goal review',
        description: 'Full metric comparison vs. baseline',
      },
    ];
  }, [dashboardData?.protocols]);

  const ladderStorageKey = `mogcheck-goal-ladder:${user?.uid || 'local'}`;
  /** Number of milestones already completed (0-based exclusive upper bound on completed indices). */
  const [completedLadderCount, setCompletedLadderCount] = useState(1);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ladderStorageKey);
      if (raw != null) {
        const n = parseInt(raw, 10);
        if (!Number.isNaN(n)) {
          setCompletedLadderCount(Math.max(0, Math.min(n, goalMilestonesBase.length)));
        }
      }
    } catch {
      /* ignore */
    }
  }, [ladderStorageKey, goalMilestonesBase.length]);

  // Update logic to activate mid-point check-in after the second scan is performed.
  // We check if the ratingHistory has at least two points to consider it a "second scan".
  useEffect(() => {
    // If we have history, user completed second scan. Unlock step 3 (Genioplasty & Mid-point check-in)
    if (dashboardData?.ratingHistory?.length >= 2) {
      setCompletedLadderCount(3); 
    } 
    // If they have any protocols or actionable advice, at least step 1 (baseline scan) is done. 
    // They are on step 2 (Genioplasty or active protocol).
    else if (dashboardData?.protocols?.length > 0 || dashboardData?.categories || dashboardData?.finalRating != null) {
       setCompletedLadderCount((prev) => Math.max(prev, 1));
    } else {
       setCompletedLadderCount((prev) => Math.max(prev, 0));
    }
  }, [dashboardData?.ratingHistory?.length, dashboardData?.protocols, dashboardData?.categories, dashboardData?.finalRating]);

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

  // Provide a toggle function for milestones that can be completed manually
  const toggleMilestone = (index) => {
    // Determine the next intended state.
    // If the user clicks a milestone they've already completed (i < completedLadderCount),
    // they want to uncheck it, so set count to that index.
    // If they click the current one, they want to complete it, so increment.
    setCompletedLadderCount((prev) => {
      if (index < prev) {
        return index; // Uncheck this and all subsequent
      } else if (index === prev) {
        return prev + 1; // Check this one
      }
      return prev; // Do nothing for locked milestones further up
    });
  };

  const renderNode = (node, index) => {
    const isCompleted = node.status === 'completed';
    const isInProgress = node.status === 'current';
    const isLocked = node.status === 'locked';

    let borderClass = 'border-zinc-800';
    let glowClass = '';
    let textClass = 'text-zinc-500';
    let icon = <Lock size={14} className="text-zinc-500" />;

    if (isCompleted) {
      borderClass = 'border-emerald-500/50';
      glowClass = 'shadow-[0_0_15px_rgba(16,185,129,0.3)]';
      textClass = 'text-emerald-400 drop-shadow-[0_0_5px_rgba(16,185,129,0.8)]';
      icon = <CheckCircle2 size={14} className="text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]" />;
    } else if (isInProgress) {
      borderClass = 'border-cyan-500';
      glowClass = 'shadow-[0_0_15px_rgba(34,211,238,0.5)]';
      textClass = 'text-cyan-400 drop-shadow-[0_0_5px_rgba(34,211,238,0.8)] animate-pulse';
      icon = (
        <div className="relative flex items-center justify-center w-3 h-3">
          <div className="absolute inset-0 bg-cyan-500/50 rounded-full blur-[2px] animate-pulse" />
          <div className="relative w-2 h-2 bg-cyan-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
        </div>
      );
    }

    return (
      <div 
        onClick={() => toggleMilestone(index)}
        className={`relative group flex flex-col items-center bg-zinc-900/60 border ${borderClass} rounded-xl p-4 w-40 text-center cursor-pointer hover:scale-105 transition-all duration-300 z-10 ${glowClass} ${isLocked ? 'opacity-40 grayscale hover:opacity-100 hover:grayscale-0' : 'backdrop-blur-sm'}`}
      >
        <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] opacity-10 mix-blend-overlay rounded-xl pointer-events-none"></div>
        <div className="flex items-center justify-center mb-3 h-5 relative z-10">
          {icon}
        </div>
        <span className={`font-mono text-[10px] tracking-widest uppercase leading-tight relative z-10 ${textClass}`}>
          {node.title}
        </span>
        
        {/* Tooltip */}
        <div className="absolute bottom-full mb-2 w-56 p-4 bg-zinc-950 border border-cyan-500/30 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-[100] text-left shadow-[0_0_30px_rgba(34,211,238,0.15)] hidden md:block">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] opacity-20 mix-blend-overlay rounded-xl"></div>
          <span className="relative block text-white font-bold text-xs mb-2 uppercase tracking-widest border-b border-zinc-800 pb-2">{node.title}</span>
          <span className="relative block text-zinc-400 text-[10px] font-sans leading-relaxed">{node.description}</span>
          <div className={`relative mt-3 text-[8px] font-mono tracking-widest uppercase flex items-center gap-1 ${isCompleted ? 'text-emerald-400' : isInProgress ? 'text-cyan-400' : 'text-zinc-500'}`}>
            <span className="w-1 h-1 rounded-full bg-current"></span>
            [{node.status.replace('_', ' ')}]
          </div>
        </div>
      </div>
    );
  };

  const [expandedProtocol, setExpandedProtocol] = useState(null);
  const [showAllProtocols, setShowAllProtocols] = useState(false);

  /** Full-screen analysis view for a community scan (same layout as dashboard Analysis). */
  const [communityView, setCommunityView] = useState(null);

  useEffect(() => {
    if (!communityView) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [communityView]);

  // Handle smooth scrolling and update active section
  const handleScroll = (e) => {
    let currentActive = 'overview';
    let minDistance = Infinity;
    
    sectionIds.forEach((id) => {
      const element = document.getElementById(id);
      if (element) {
        const rect = element.getBoundingClientRect();
        const distance = Math.abs(rect.top - 100); // offset for header
        
        if (distance < minDistance && rect.top < window.innerHeight / 2) {
           minDistance = distance;
           currentActive = id;
        }
      }
    });
    
    if (currentActive !== activeSection) {
      setActiveSection(currentActive);
    }
  };

  useEffect(() => {
    // Also use intersection observer for more reliable section tracking
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { threshold: 0.3, rootMargin: '-100px 0px 0px 0px' } 
    );

    sectionIds.forEach((id) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });

    return () => {
      sectionIds.forEach((id) => {
        const element = document.getElementById(id);
        if (element) observer.unobserve(element);
      });
    };
  }, [isFreeModelScan, sectionIds]);

  const scrollToSection = (sectionId) => {
    setActiveSection(sectionId);
    const element = document.getElementById(sectionId);
    if (element) {
      // Adjust scroll position to account for any fixed headers if needed
      // Currently just doing a simple smooth scroll
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0b] flex pt-20">
      {communityView && DashboardComponent && (
        <div
          className="fixed inset-0 z-[200] flex flex-col bg-[#0a0a0b] overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="community-scan-title"
        >
          <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-zinc-800 bg-[#0a0a0b]/95 px-4 py-3 backdrop-blur-md md:px-8">
            <button
              type="button"
              onClick={() => setCommunityView(null)}
              className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-2 font-sans text-xs font-bold uppercase tracking-widest text-zinc-200 hover:border-cyan-500/50 hover:text-cyan-300 transition-colors"
            >
              <ArrowLeft size={16} />
              Community Scans
            </button>
            <div className="min-w-0 flex-1">
              <p className="font-sans text-[10px] uppercase tracking-[0.35em] text-zinc-500">Community scan</p>
              <h2 id="community-scan-title" className="truncate font-black uppercase italic tracking-tight text-white">
                {communityView.displayName}
              </h2>
            </div>
          </header>
          <div className="flex-1 px-4 pb-16 pt-6 md:px-8">
            <DashboardComponent
              dashboardData={communityView.data}
              setCurrentPage={setCurrentPage}
              userPlan={userPlan}
              user={user}
              hideTopSection
              hideProtocols
              hideActionableProtocols
              isEmbedded
              hideUnlockPotential
              hideBestFlawSection
            />
          </div>
        </div>
      )}

      {/* Sidebar */}
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
          <button onClick={() => setCurrentPage('plans')} className="flex items-center justify-between px-4 py-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 transition-all font-sans text-xs uppercase tracking-widest group">
            <span className="flex items-center gap-2"><Crown size={14} /> Upgrade</span>
            <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
          </button>

                  <div className="flex items-center justify-between">
            <div className="flex flex-col min-w-0">
              <span className="text-white font-bold text-sm uppercase truncate">{username}</span>
              <span className="text-zinc-500 text-[10px] font-sans uppercase tracking-widest">{isFreeModelScan ? 'Free model scan' : 'Pro Member'}</span>
            </div>
            <button onClick={() => setCurrentPage('settings')} className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
              <Settings size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-h-0 bg-[#0a0a0b] overflow-y-auto" onScroll={handleScroll}>
          <div className="md:hidden flex items-center justify-between p-4 border-b border-zinc-900 bg-[#0c0d0e] sticky top-0 z-50">
           <span className="text-lg font-black tracking-tighter text-white italic">DASHBOARD</span>
           <div className="flex items-center gap-2">
             <select 
               value={activeSection}
               onChange={(e) => scrollToSection(e.target.value)}
               className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-2 py-1 font-sans uppercase tracking-widest focus:outline-none focus:border-cyan-500"
             >
               {navTabs.map((tab) => (
                 <option key={tab.id} value={tab.id}>{tab.label}</option>
               ))}
             </select>
           </div>
        </div>

        <div className="p-6 md:p-10 max-w-[1200px] w-full mx-auto flex flex-col gap-8 md:gap-12">
          
          {/* OVERVIEW SECTION */}
          <section id="overview" className="scroll-mt-24 relative">
            {/* Subtle CRT Scanline Overlay */}
            <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] z-50 opacity-20 mix-blend-overlay"></div>
            
            <div className="flex flex-col gap-8 md:gap-10 relative z-10">
              <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                  {isFreeModelScan ? (
                    <>
                      <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter italic text-white mb-2">Structural overview</h1>
                      <p className="text-zinc-400 font-sans text-sm uppercase tracking-widest">Core score and structure from your scan.</p>
                      <p className="text-zinc-500 font-sans text-xs mt-2 max-w-xl leading-relaxed">
                        Open <span className="text-zinc-400">Analysis</span> for the full breakdown. Upgrade for trajectory, protocols, and premium metrics.
                      </p>
                    </>
                  ) : (
                    <>
                      <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter italic text-white mb-2">Welcome Back, {username}</h1>
                      <p className="text-zinc-400 font-sans text-sm uppercase tracking-widest">Let&apos;s check your progress.</p>
                      <p className="text-zinc-500 font-sans text-xs mt-2 max-w-xl leading-relaxed">
                        Snapshot of your latest scan, trajectory, and quick signals — open <span className="text-zinc-400">Analysis</span> for the full breakdown.
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* 1 — Hero current rating strip */}
              <div className="relative rounded-2xl border border-cyan-500/25 bg-gradient-to-br from-[#0c0d0e] via-[#0a0f12] to-[#0c0d0e] p-6 md:p-8 shadow-[0_0_40px_rgba(34,211,238,0.08)] overflow-hidden">
                <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
                <div className="absolute -left-16 bottom-0 h-48 w-48 rounded-full bg-emerald-500/5 blur-3xl pointer-events-none" />
                <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-sans text-[10px] uppercase tracking-[0.35em] text-cyan-400/90 mb-3">Overall aesthetic score</p>
                    <div className="flex flex-wrap items-end gap-4">
                      <span className="text-5xl md:text-7xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white via-cyan-100 to-cyan-400 drop-shadow-[0_0_24px_rgba(34,211,238,0.35)]">
                        {overviewRating != null ? overviewRating.toFixed(1) : '—'}
                      </span>
                      <div className="flex flex-col gap-1 pb-1">
                        <span
                          className={
                            isFreeModelScan
                              ? 'inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/60 px-3 py-1 font-sans text-[10px] font-bold uppercase tracking-widest text-zinc-300'
                              : 'inline-flex items-center gap-2 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 font-sans text-[10px] font-bold uppercase tracking-widest text-yellow-400'
                          }
                        >
                          {!isFreeModelScan && <Crown size={12} />}
                          {tierFromRating(overviewRating)}
                        </span>
                        {percentileFromRating(overviewRating) != null && (
                          <span className="font-sans text-xs text-zinc-400">
                            Est. top <span className="text-zinc-200 font-semibold">{percentileFromRating(overviewRating)}%</span> vs. population model
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-start gap-2 md:items-end md:text-right border-t border-zinc-800/80 pt-4 md:border-t-0 md:border-l md:pl-8 md:pt-0">
                    <span className="flex items-center gap-2 font-sans text-[10px] uppercase tracking-widest text-zinc-500">
                      <Calendar size={14} className="text-zinc-600" /> Last scan
                    </span>
                    <span className="font-sans text-sm text-zinc-200">
                      {lastScanLabel ?? 'Complete an analysis to date your profile'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 2 — Mini category stat chips */}
              <div>
                <p className="font-sans text-[10px] uppercase tracking-[0.28em] text-zinc-500 mb-3">Category signals</p>
                <div className="flex flex-wrap gap-2 md:gap-3">
                  {categoryChips.map((chip) => (
                    <div
                      key={chip.label}
                      className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-2.5 backdrop-blur-sm hover:border-cyan-500/30 transition-colors"
                    >
                      <span className="font-sans text-[10px] uppercase tracking-widest text-zinc-500">{chip.label}</span>
                      <span className="font-mono text-lg font-bold text-cyan-300 tabular-nums drop-shadow-[0_0_8px_rgba(34,211,238,0.25)]">{chip.display}</span>
                      <span className="font-sans text-[10px] text-zinc-600">/10</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 6 + 7 + 8 — Streak, insight, news (premium dashboard only) */}
              {!isFreeModelScan && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-orange-500/20 bg-[#0c0d0e] p-5 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-transparent pointer-events-none" />
                  <div className="relative flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-orange-500/30 bg-orange-500/10">
                      <Flame size={20} className="text-orange-400" />
                    </div>
                    <div>
                      <p className="font-sans text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Protocol streak</p>
                      <p className="text-2xl font-black italic text-white tabular-nums">{protocolStreakDays} days</p>
                      <p className="text-zinc-500 font-sans text-xs mt-2 leading-relaxed">
                        Log your protocol check-ins to extend your streak. Streak is estimated until daily tracking ships.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-cyan-500/20 bg-[#0c0d0e] p-5 relative overflow-hidden md:col-span-1">
                  <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent pointer-events-none" />
                  <div className="relative flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10">
                      <Sparkles size={20} className="text-cyan-400" />
                    </div>
                    <div>
                      <p className="font-sans text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Insight</p>
                      <p className="text-zinc-300 font-sans text-sm leading-relaxed">{insightLine}</p>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setCurrentPage('news')}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 text-left transition-all hover:border-cyan-500/40 hover:bg-zinc-900/50 group"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-800/50 group-hover:border-cyan-500/40">
                      <Newspaper size={20} className="text-zinc-400 group-hover:text-cyan-400 transition-colors" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-sans text-[10px] uppercase tracking-widest text-zinc-500 mb-1">News & updates</p>
                      <p className="text-zinc-300 font-sans text-sm leading-relaxed mb-3">
                        Patch notes, research drops, and product updates — stay ahead of the meta.
                      </p>
                      <span className="inline-flex items-center gap-1 font-sans text-xs font-bold uppercase tracking-widest text-cyan-400 group-hover:gap-2 transition-all">
                        Open news <ChevronRight size={14} />
                      </span>
                    </div>
                  </div>
                </button>
              </div>
              )}

              {/* Face Analysis History Row */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col">
                  <h3 className="text-base md:text-lg font-black uppercase tracking-[0.28em] text-[#e4e4e7] font-sans">Face analysis</h3>
                  <span className="text-zinc-500 font-sans text-xs tracking-widest">
                    {lastScanLabel ? `Latest · ${lastScanLabel}` : 'No dated scan yet'}
                  </span>
                </div>
                
                <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar">
                  {/* Card 1 */}
                  {dashboardData?.scanHistory && dashboardData?.scanHistory.map((scan, i) => (
                    <div key={i} className="shrink-0 w-40 md:w-48 h-24 md:h-28 bg-[#0c0d0e] rounded-2xl border border-zinc-800 flex overflow-hidden shadow-lg relative group cursor-pointer" onClick={() => {/* Future implementation for viewing past scan */}}>
                      <div 
                        className="flex-1 border-r border-zinc-900 relative overflow-hidden group ring-2 ring-inset ring-cyan-500 z-10"
                      >
                        <img src={scan.frontImage || "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"} className="w-full h-full object-cover transition-all duration-300 opacity-100 grayscale-0 scale-105" alt="Front Profile" />
                        <div className="absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-cyan-900/50 to-transparent pointer-events-none transition-opacity duration-300 opacity-100" />
                        <div className="absolute top-1 left-1 text-[8px] font-mono text-cyan-400 font-bold drop-shadow-md bg-black/50 px-1 rounded">
                          {Number(scan.finalRating).toFixed(1)}
                        </div>
                      </div>
                      <div 
                        className="flex-1 relative overflow-hidden group"
                      >
                        <img src={scan.sideImage || "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"} className="w-full h-full object-cover transition-all duration-300 opacity-40 grayscale group-hover:opacity-70 group-hover:grayscale-0" style={{objectPosition: 'top'}} alt="Side Profile" />
                        <div className="absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-cyan-900/50 to-transparent pointer-events-none transition-opacity duration-300 opacity-0" />
                      </div>
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity z-20 flex items-center justify-center">
                         <span className="text-white text-xs font-bold tracking-widest uppercase">View</span>
                      </div>
                    </div>
                  ))}

                  {(!dashboardData?.scanHistory || dashboardData?.scanHistory.length === 0) && (
                  <div className="shrink-0 w-40 md:w-48 h-24 md:h-28 bg-[#0c0d0e] rounded-2xl border border-zinc-800 flex overflow-hidden shadow-lg relative">
                  <div 
                    className="flex-1 border-r border-zinc-900 relative overflow-hidden ring-2 ring-inset ring-cyan-500 z-10"
                  >
                    <img src={dashboardData?.frontImage || "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"} className="w-full h-full object-cover opacity-100 grayscale-0 scale-105" alt="Front Profile" />
                    <div className="absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-cyan-900/50 to-transparent pointer-events-none opacity-100" />
                    {dashboardData?.finalRating && (
                    <div className="absolute top-1 left-1 text-[8px] font-mono text-cyan-400 font-bold drop-shadow-md bg-black/50 px-1 rounded">
                      {Number(dashboardData.finalRating).toFixed(1)}
                    </div>
                    )}
                  </div>
                  <div 
                    className="flex-1 relative overflow-hidden"
                  >
                    <img src={dashboardData?.sideImage || "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"} className="w-full h-full object-cover opacity-40 grayscale" style={{objectPosition: 'top'}} alt="Side Profile" />
                    <div className="absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-cyan-900/50 to-transparent pointer-events-none opacity-0" />
                  </div>
                </div>
                )}
                
                {/* Analyze Another Image Button */}
                <div 
                  className="shrink-0 w-24 md:w-28 h-24 md:h-28 bg-[#0c0d0e] rounded-2xl border border-zinc-800 flex flex-col items-center justify-center cursor-pointer hover:bg-zinc-900/50 hover:border-zinc-600 transition-all group shadow-lg"
                  onClick={() => {
                    const isAdmin = user?.email && (
                      user.email === 'laithbu07@gmail.com' || 
                      user.email === 'admin@looksmaxxing.com' ||
                      user.email === 'serenity.eyb@gmail.com' ||
                      user.email.endsWith('@looksmaxxing.com')
                    );
                    
                    if (isAdmin || userPlan?.plan === 'pro') {
                      setCurrentPage('upload-ultra');
                    } else if (userPlan?.plan === 'single_scan' || userPlan?.plan === 'free' || !userPlan) {
                      setCurrentPage('plans');
                    } else {
                      setCurrentPage('upload-ultra');
                    }
                  }}
                >
                  <div className="w-10 h-10 rounded-full border border-zinc-700 flex items-center justify-center group-hover:border-zinc-500 transition-colors">
                    <span className="text-zinc-500 group-hover:text-zinc-400 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </span>
                  </div>
                </div>

                {/* Card 2 (Empty) */}
                {(!dashboardData?.scanHistory || dashboardData?.scanHistory.length < 2) && (
                <div className="shrink-0 w-40 md:w-48 h-24 md:h-28 bg-[#090a0b] rounded-2xl border border-zinc-800/50 flex overflow-hidden flex flex-col justify-center items-center opacity-50">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-900/50" />
                </div>
                )}

                {/* Card 3 (Empty) */}
                {(!dashboardData?.scanHistory || dashboardData?.scanHistory.length < 3) && (
                <div className="shrink-0 w-40 md:w-48 h-24 md:h-28 bg-[#090a0b] rounded-2xl border border-zinc-800/50 flex overflow-hidden flex flex-col justify-center items-center opacity-30">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-900/50" />
                </div>
                )}
              </div>
            </div>

                {!isFreeModelScan && (
                <div className="col-span-1 md:col-span-3 bg-[#0c0d0e] border border-zinc-800 rounded-2xl p-6 md:p-8 relative overflow-hidden shadow-lg group hover:border-zinc-700 transition-colors flex flex-col gap-8">
                  <div className="absolute top-0 left-0 w-64 h-64 bg-cyan-500/5 rounded-full blur-[80px] -translate-y-1/2 -translate-x-1/2 pointer-events-none" />
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between relative z-10">
                    <div>
                      <h3 className="text-zinc-400 font-sans text-xs uppercase tracking-widest flex items-center gap-2">
                        <Target size={14} className="text-zinc-500" /> Trajectory &amp; goals
                      </h3>
                      <p className="text-zinc-600 font-sans text-[10px] uppercase tracking-widest mt-2 max-w-md">
                        Sparkline uses your last scores — connect API history via <span className="text-zinc-500">ratingHistory</span> for live data.
                      </p>
                    </div>
                    <div className="text-left sm:text-right shrink-0">
                      <span className="font-sans text-[10px] uppercase tracking-widest text-zinc-500 block mb-1">Target goal</span>
                      <span className="text-2xl font-black italic text-white drop-shadow-md tabular-nums">
                        {overviewRating != null ? Math.min(99, Number(overviewRating) + 5).toFixed(1) : '—'}
                      </span>
                    </div>
                  </div>

                  {/* (2) Split: sparkline + deltas */}
                  <div className="relative z-10 grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-10">
                    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-4">
                      <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-3">Overall score — last {scoreHistory.length} points</p>
                      <div className="flex items-end gap-4">
                        <svg
                          viewBox="0 0 140 48"
                          className="h-28 w-full max-w-[200px] text-cyan-400"
                          preserveAspectRatio="xMidYMid meet"
                          aria-hidden
                        >
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
                              {sparkline.pts?.map(([x, y], i) => (
                                <circle
                                  key={i}
                                  cx={x}
                                  cy={y}
                                  r={i === (sparkline.pts?.length ?? 0) - 1 ? 3.5 : 2}
                                  fill={i === (sparkline.pts?.length ?? 0) - 1 ? '#22d3ee' : '#64748b'}
                                  className={i === (sparkline.pts?.length ?? 0) - 1 ? 'drop-shadow-[0_0_8px_rgba(34,211,238,0.9)]' : ''}
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
                              <span
                                className={`text-2xl font-black tabular-nums ${
                                  deltaSinceLastScan > 0 ? 'text-emerald-400' : deltaSinceLastScan < 0 ? 'text-rose-400' : 'text-zinc-400'
                                }`}
                              >
                                {deltaSinceLastScan > 0 ? '+' : ''}
                                {deltaSinceLastScan.toFixed(2)}
                              </span>
                              <span className="text-zinc-500 font-sans text-xs ml-2">vs prior</span>
                            </div>
                          </>
                        ) : (
                          <span className="text-zinc-500 font-sans text-sm">
                            {Array.isArray(dashboardData?.ratingHistory) && dashboardData.ratingHistory.length >= 2
                              ? 'No overall score increase since your prior scan.'
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
                                {categoryDeltaStats.best.key}{' '}
                                {categoryDeltaStats.best.delta > 0 ? '+' : ''}
                                {(categoryDeltaStats.best.delta / 10).toFixed(1)}
                              </span>
                            </div>
                            <div className="flex justify-between gap-2 text-sm">
                              <span className="text-zinc-500 font-sans">Largest dip</span>
                              <span className={`font-mono font-bold tabular-nums ${categoryDeltaStats.worst.delta < 0 ? 'text-rose-400' : 'text-zinc-400'}`}>
                                {categoryDeltaStats.worst.key}{' '}
                                {(categoryDeltaStats.worst.delta / 10).toFixed(1)}
                              </span>
                            </div>
                          </>
                        ) : (
                          <p className="text-zinc-500 font-sans text-xs leading-relaxed">
                            Save <span className="text-zinc-400">previousCategories</span> on the next scan to show category gains and dips here.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* (3) Goal ladder — vertical milestones + connector */}
                  <div className="relative z-10 border-t border-zinc-800/80 pt-6">
                    <p className="font-sans text-[10px] uppercase tracking-[0.28em] text-zinc-500 mb-4">Goal ladder</p>
                    <div className="relative">
                      {goalMilestones.map((m, idx) => {
                        const done = m.status === 'completed';
                        const current = m.status === 'current';
                        const locked = m.status === 'locked';
                        return (
                          <div key={m.id} className="relative flex gap-4 pb-8 last:pb-2">
                            {idx < goalMilestones.length - 1 && (
                              <div
                                className="absolute left-[15px] top-10 bottom-0 w-px bg-gradient-to-b from-zinc-600 to-zinc-800"
                                aria-hidden="true"
                              />
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
                                setCompletedLadderCount((c) => Math.min(c + 1, goalMilestonesBase.length));
                              }}
                              onKeyDown={(e) => {
                                if (!current) return;
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setCompletedLadderCount((c) => Math.min(c + 1, goalMilestonesBase.length));
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
                )}

              {/* Pro member perks — visible */}
              {userPlan?.plan === 'pro' && (
              <div className="rounded-2xl border border-yellow-500/25 bg-gradient-to-br from-[#0c0d0e] via-[#0f0d08] to-[#0c0d0e] p-6 md:p-8 relative overflow-hidden shadow-[0_0_40px_rgba(234,179,8,0.08)]">
                <div className="absolute -right-24 top-0 h-56 w-56 rounded-full bg-yellow-500/10 blur-3xl pointer-events-none" />
                <div className="relative flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                  <div className="flex items-start gap-4 max-w-xl">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-yellow-500/35 bg-yellow-500/10">
                      <Crown size={24} className="text-yellow-400" />
                    </div>
                    <div>
                      <p className="font-sans text-[10px] uppercase tracking-[0.35em] text-yellow-500/90 mb-2">Pro member</p>
                      <h3 className="text-xl font-black uppercase tracking-tight italic text-white mb-3">Included with your plan</h3>
                      <ul className="space-y-2 text-zinc-400 font-sans text-sm leading-relaxed">
                        <li className="flex gap-2"><span className="text-cyan-500/80">▸</span> Full frontal &amp; side metric breakdowns</li>
                        <li className="flex gap-2"><span className="text-cyan-500/80">▸</span> Historical trajectory &amp; goal tracking</li>
                        <li className="flex gap-2"><span className="text-cyan-500/80">▸</span> Priority access to analysis updates &amp; research notes</li>
                      </ul>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 md:items-end md:text-right shrink-0">
                    <p className="text-zinc-500 font-sans text-xs max-w-xs">
                      Share MogCheck with a friend — they get a sharper onboarding path when you refer from your account settings.
                    </p>
                    <button
                      type="button"
                      onClick={() => setCurrentPage('plans')}
                      className="inline-flex items-center gap-2 rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-4 py-2.5 font-sans text-xs font-bold uppercase tracking-widest text-yellow-400 hover:bg-yellow-500/20 transition-colors"
                    >
                      View plans &amp; billing <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
              )}

            </div>
          </section>

          {/* ANALYSIS SECTION */}
          {DashboardComponent && (
            <section id="analysis" className="scroll-mt-24 relative">
              {/* Subtle CRT Scanline Overlay */}
              <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] z-50 opacity-20 mix-blend-overlay"></div>
              
              <div className="relative z-10">
                <DashboardComponent
                  dashboardData={dashboardData}
                  setCurrentPage={setCurrentPage}
                  userPlan={userPlan}
                  user={user}
                  hideTopSection={true}
                  hideProtocols={true}
                  hideActionableProtocols={true}
                  isEmbedded={true}
                />
              </div>
            </section>
          )}

          {!isFreeModelScan && (
          <>
          {/* PROTOCOLS SECTION */}
          <section id="protocols" className="scroll-mt-24">
            <div className="flex flex-col gap-8">
              <div>
                <h1 className="text-3xl font-black uppercase tracking-tighter italic text-white mb-2">Protocols</h1>
                <p className="text-zinc-400 font-sans text-sm uppercase tracking-widest">Your personalized improvement roadmap.</p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {(dashboardData?.protocols || [
                    { 
                      id: 1, 
                      name: 'Reduce Body Fat to 12%', 
                      description: 'Will vastly improve buccal framing and expose zygomatic arch', 
                      impact: 'Highest Impact',
                      steps: ['Monitor caloric deficit (300-500 kcal/day)', 'Incorporate 3 days of steady state cardio', 'Increase water intake to 1 gallon daily', 'Focus on high protein foods'],
                      duration: '12-16 Weeks'
                    },
                    { 
                      id: 2, 
                      name: 'Minoxidil for Brows', 
                      description: 'Increasing eyebrow density by 15% will heavily boost dimorphism score', 
                      impact: 'High Impact',
                      steps: ['Apply 5% Minoxidil directly to eyebrows twice daily', 'Use a dermaroller (0.5mm) once a week', 'Moisturize to prevent skin irritation', 'Expect visible results around month 3'],
                      duration: '6 Months'
                    },
                ]).slice(0, showAllProtocols ? undefined : 3).map((p, i) => {
                  const isExpanded = expandedProtocol === (p.id || i);
                  const impactColor = /highest/i.test(p.impact) ? 'text-red-400' : /high/i.test(p.impact) ? 'text-orange-400' : /medium/i.test(p.impact) ? 'text-yellow-400' : 'text-emerald-400';
                  
                  return (
                    <div 
                      key={p.id || i} 
                      onClick={() => setExpandedProtocol(isExpanded ? null : (p.id || i))} 
                      className={`flex flex-col bg-zinc-900/50 rounded-xl border ${isExpanded ? 'border-cyan-500/50 shadow-[0_0_30px_rgba(34,211,238,0.1)]' : 'border-zinc-800'} overflow-hidden hover:border-cyan-500/40 hover:shadow-[0_0_20px_rgba(34,211,238,0.08)] transition-all cursor-pointer group`}
                    >
                      <div className="flex">
                        <div className={`bg-zinc-800 flex items-center justify-center px-6 shrink-0 transition-colors ${isExpanded ? 'bg-cyan-900/30' : ''}`}>
                          <span className={`text-3xl font-black transition-colors ${isExpanded ? 'text-cyan-400' : 'text-zinc-600 group-hover:text-cyan-400'}`}>
                            {String(p.id || i+1).padStart(2, '0')}
                          </span>
                        </div>
                        <div className="p-6 flex flex-col gap-2 min-w-0 flex-grow">
                          <div className="flex justify-between items-start">
                            <span className="text-white font-bold uppercase text-base tracking-widest truncate">{p.name}</span>
                            <ChevronDown size={20} className={`text-zinc-500 transition-transform duration-300 ${isExpanded ? 'rotate-180 text-cyan-400' : ''}`} />
                          </div>
                          <span className={`text-zinc-500 text-sm font-sans ${isExpanded ? '' : 'line-clamp-2'}`}>{p.description}</span>
                          <div className="flex items-center gap-4 mt-2">
                            <span className={`text-[10px] font-sans uppercase tracking-widest ${impactColor}`}>{p.impact}</span>
                            {p.duration && <span className="text-[10px] font-sans uppercase tracking-widest text-zinc-500">• {p.duration}</span>}
                          </div>
                        </div>
                      </div>
                      
                      {/* Expanded Content Area */}
                      <div className={`transition-all duration-300 overflow-hidden ${isExpanded ? 'max-h-[500px] opacity-100 border-t border-zinc-800' : 'max-h-0 opacity-0'}`}>
                        <div className="p-6 bg-[#0a0a0b]/50">
                          <h4 className="text-white font-bold uppercase tracking-widest text-xs mb-4 flex items-center gap-2">
                            <Play size={12} className="text-cyan-400" /> Action Plan
                          </h4>
                          <div className="flex flex-col gap-3 pl-2">
                            {p.steps ? p.steps.map((step, idx) => (
                              <div key={idx} className="flex gap-3 text-zinc-300 text-sm font-sans">
                                <span className="text-cyan-500 font-bold">{idx + 1}.</span>
                                <span className="text-zinc-300">{step}</span>
                              </div>
                            )) : (
                              <div className="text-zinc-500 text-sm font-sans italic">Action steps will be generated shortly.</div>
                            )}
                          </div>
                          
                          <button 
                            className="mt-6 w-full py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 font-bold text-xs uppercase tracking-widest hover:bg-cyan-500/20 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation(); // prevent collapsing
                              alert('Protocol added to Active Directives.');
                            }}
                          >
                            Add to Active Directives
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {dashboardData?.protocols && dashboardData.protocols.length > 3 && (
                <div className="flex justify-center mt-2">
                  <button 
                    onClick={() => setShowAllProtocols(!showAllProtocols)}
                    className="px-6 py-2.5 rounded-full border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 text-zinc-400 hover:text-white font-sans text-xs uppercase tracking-widest font-bold transition-all flex items-center gap-2 group"
                  >
                    {showAllProtocols ? 'Show Less' : `Show All ${dashboardData.protocols.length} Protocols`}
                    <ChevronDown size={14} className={`transition-transform duration-300 ${showAllProtocols ? 'rotate-180' : 'group-hover:translate-y-0.5'}`} />
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* NEWS SECTION */}
          <section id="news" className="scroll-mt-24">
            <div className="flex flex-col gap-8">
              <div>
                <h1 className="text-3xl font-black uppercase tracking-tighter italic text-white mb-2 flex items-center gap-3">
                  <Newspaper size={28} className="text-cyan-400" /> Latest Intel
                </h1>
                <p className="text-zinc-400 font-sans text-sm uppercase tracking-widest">System updates and aesthetic news.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div 
                  className="group relative flex flex-col bg-[#0c0d0e] border border-zinc-800 rounded-2xl p-8 overflow-hidden hover:border-cyan-500/40 hover:shadow-[0_0_20px_rgba(34,211,238,0.1)] transition-all cursor-pointer"
                  onClick={() => setCurrentPage('news')}
                >
                  <div className="absolute top-0 right-0 w-48 h-48 bg-cyan-500/5 rounded-full blur-[60px] -translate-y-1/2 translate-x-1/2 group-hover:bg-cyan-500/15 transition-colors" />
                  <div className="flex items-center gap-3 mb-6">
                    <span className="text-cyan-400 font-bold font-sans text-[10px] uppercase tracking-[0.2em] border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 rounded-full shadow-[0_0_10px_rgba(34,211,238,0.2)]">v2.1 Update</span>
                    <span className="text-zinc-500 font-mono text-[10px] uppercase tracking-widest flex items-center gap-1"><FileText size={10} /> 2 Hours Ago</span>
                  </div>
                  <h3 className="text-white font-black text-xl md:text-2xl mb-3 group-hover:text-cyan-400 transition-colors leading-tight">Advanced Symmetry Metrics Live</h3>
                  <p className="text-zinc-400 text-sm font-sans leading-relaxed line-clamp-2 mb-6 flex-grow">The new engine update includes highly sensitive millimeter-accurate symmetry plotting for facial thirds, revealing micro-deviations.</p>
                  <div className="mt-auto flex items-center text-cyan-500 text-[11px] font-bold uppercase tracking-widest group-hover:text-cyan-300 transition-colors">
                    <span className="flex items-center gap-1 group-hover:gap-2 transition-all">Read Full Report <ChevronRight size={14} /></span>
                  </div>
                </div>

                <div 
                  className="group relative flex flex-col bg-[#0c0d0e] border border-zinc-800 rounded-2xl p-8 overflow-hidden hover:border-cyan-500/40 hover:shadow-[0_0_20px_rgba(34,211,238,0.1)] transition-all cursor-pointer"
                  onClick={() => setCurrentPage('news')}
                >
                  <div className="flex items-center gap-3 mb-6">
                    <span className="text-zinc-300 font-bold font-sans text-[10px] uppercase tracking-[0.2em] border border-zinc-700 bg-zinc-800/80 px-3 py-1 rounded-full">Protocol Theory</span>
                    <span className="text-zinc-500 font-mono text-[10px] uppercase tracking-widest flex items-center gap-1"><FileText size={10} /> Yesterday</span>
                  </div>
                  <h3 className="text-white font-black text-xl md:text-2xl mb-3 group-hover:text-cyan-400 transition-colors leading-tight">The Optimal Zygomatic Ratio</h3>
                  <p className="text-zinc-400 text-sm font-sans leading-relaxed line-clamp-2 mb-6 flex-grow">Breaking down the exact mathematical ratios of the ideal cheekbone projection to bizygomatic width for maximum dimorphism.</p>
                  <div className="mt-auto flex items-center text-zinc-500 text-[11px] font-bold uppercase tracking-widest group-hover:text-cyan-400 transition-colors">
                    <span className="flex items-center gap-1 group-hover:gap-2 transition-all">Read Full Report <ChevronRight size={14} /></span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* MOG BATTLES SECTION */}
          <section id="mog-battles" className="scroll-mt-24">
            <div className="flex flex-col gap-8">
              <div>
                <h1 className="text-3xl font-black uppercase tracking-tighter italic text-white mb-2 flex items-center gap-3">
                  <Swords size={28} className="text-cyan-400" /> Mog Battles
                </h1>
                <p className="text-zinc-400 font-sans text-sm uppercase tracking-widest">
                  Vote for your winner first, then see how the AI scored them.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setCurrentPage('mog-battles')}
                className="group relative flex w-full flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-br from-[#0c0d0e] via-[#0a0f14] to-[#0c0d0e] p-8 text-left shadow-[0_0_40px_rgba(34,211,238,0.06)] transition-all hover:border-cyan-500/40 hover:shadow-[0_0_32px_rgba(34,211,238,0.12)] md:flex-row md:items-center md:justify-between md:gap-8 md:p-10"
              >
                <div className="absolute -right-16 top-1/2 h-48 w-48 -translate-y-1/2 rounded-full bg-cyan-500/10 blur-3xl transition-colors group-hover:bg-cyan-500/20" aria-hidden />
                <div className="relative z-10 flex flex-1 flex-col gap-3">
                  <span className="inline-flex w-fit items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 font-sans text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400">
                    Arena
                  </span>
                  <h2 className="text-2xl font-black uppercase italic tracking-tight text-white md:text-3xl">
                    Check out Mog Battles
                  </h2>
                  <p className="max-w-xl font-sans text-sm leading-relaxed text-zinc-400">
                    See celebs go head-to-head and vote on who mogs who.
                  </p>
                </div>
                <div className="relative z-10 mt-6 flex shrink-0 items-center gap-2 md:mt-0">
                  <span className="font-sans text-xs font-bold uppercase tracking-widest text-cyan-400 transition-all group-hover:gap-3 flex items-center gap-2">
                    Open Mog Battles
                    <ChevronRight size={18} className="transition-transform group-hover:translate-x-1" />
                  </span>
                </div>
              </button>
            </div>
          </section>

          </>
          )}

          {/* COMMUNITY SCANS SECTION */}
          <section id="community" className="scroll-mt-24">
            <div className="flex flex-col gap-8">
              <div className="flex items-end justify-between">
                <div>
                  <h1 className="text-3xl font-black uppercase tracking-tighter italic text-white mb-2">Community Scans</h1>
                  <p className="text-zinc-400 font-sans text-sm uppercase tracking-widest">See how others stack up.</p>
                </div>
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
                      onClick={() =>
                        setCommunityView({
                          displayName: scan.displayName,
                          data: stripCommunityDashboardData({ ...dd }),
                        })
                      }
                      className="text-left bg-[#0c0d0e] border border-zinc-800 rounded-2xl overflow-hidden group cursor-pointer hover:border-cyan-500/50 hover:shadow-[0_0_20px_rgba(34,211,238,0.15)] transition-all relative"
                    >
                      <div className="absolute inset-0 bg-black/80 backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity z-30 flex flex-col items-center justify-center p-4 pointer-events-none">
                        <span className="text-cyan-400 font-sans text-[10px] uppercase tracking-[0.3em] font-bold mb-3 border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 rounded">
                          Intercept Analysis
                        </span>
                        <svg viewBox="0 0 100 100" className="w-16 h-16 opacity-70 mb-2 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]" aria-hidden>
                          <polygon points="50,10 90,40 75,90 25,90 10,40" fill="rgba(34,211,238,0.2)" stroke="#22d3ee" strokeWidth="1" />
                          <circle cx="50" cy="50" r="2" fill="#22d3ee" />
                          <line x1="50" y1="50" x2="50" y2="10" stroke="#22d3ee" strokeWidth="0.5" opacity="0.5" />
                          <line x1="50" y1="50" x2="90" y2="40" stroke="#22d3ee" strokeWidth="0.5" opacity="0.5" />
                          <line x1="50" y1="50" x2="75" y2="90" stroke="#22d3ee" strokeWidth="0.5" opacity="0.5" />
                          <line x1="50" y1="50" x2="25" y2="90" stroke="#22d3ee" strokeWidth="0.5" opacity="0.5" />
                          <line x1="50" y1="50" x2="10" y2="40" stroke="#22d3ee" strokeWidth="0.5" opacity="0.5" />
                        </svg>
                        <span className="text-white text-[10px] uppercase font-bold tracking-widest mt-1">View Full Profile</span>
                      </div>

                      <div className="aspect-[3/4] bg-zinc-900 relative">
                        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0b] via-transparent to-transparent z-10 pointer-events-none" />
                        {dd?.frontImage ? (
                          <img
                            src={dd.frontImage}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover object-top"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-700 opacity-50">
                            <Users size={48} className="drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]" />
                          </div>
                        )}
                        <div className="absolute top-3 left-3 z-20">
                          <span
                            className={`border text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${tierBadgeClass}`}
                          >
                            {scan.tier || '—'}
                          </span>
                        </div>
                        <div className="absolute bottom-3 left-3 z-20 flex items-baseline gap-1">
                          <span className="text-white font-black italic text-2xl drop-shadow-[0_0_10px_rgba(255,255,255,0.4)] tabular-nums">
                            {Number(rating).toFixed(1)}
                          </span>
                          <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">/100</span>
                        </div>
                      </div>
                      <div className="p-4 flex items-center justify-between bg-[#0a0a0b] relative z-20">
                        <span className="text-zinc-400 font-mono text-[10px] uppercase tracking-widest group-hover:text-white transition-colors truncate">
                          {scan.displayName}
                        </span>
                        <ExternalLink size={12} className="text-zinc-600 group-hover:text-cyan-400 transition-colors shrink-0" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {isFreeModelScan && (
          <>
          {/* PLANS SECTION — upgrade CTA for free-model dashboard */}
          <section id="plans" className="scroll-mt-24 pt-12 pb-12 border-t border-zinc-900">
            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-3xl p-8 md:p-12 text-center relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0a0a0b] z-0 pointer-events-none" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-yellow-500/5 rounded-full blur-[100px] pointer-events-none z-0 group-hover:bg-yellow-500/10 transition-colors" />
              
              <div className="relative z-10 flex flex-col items-center max-w-2xl mx-auto">
                <Crown size={48} className="text-yellow-500 mb-6 drop-shadow-[0_0_15px_rgba(234,179,8,0.5)]" />
                <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter italic text-white mb-4">Unlock Full Potential</h2>
                <p className="text-zinc-400 font-sans text-sm md:text-base leading-relaxed mb-8">
                  Get access to deep-dive biometrics, unblurred premium features, and limitless protocol generation. The ultimate tool for self-improvement.
                </p>
                <button 
                  onClick={() => setCurrentPage('plans')}
                  className="px-10 py-4 bg-gradient-to-r from-yellow-600 to-yellow-500 text-black font-black uppercase tracking-[0.2em] text-sm rounded-full hover:scale-105 transition-all shadow-[0_0_20px_rgba(234,179,8,0.4)] hover:shadow-[0_0_30px_rgba(234,179,8,0.6)]"
                >
                  Upgrade to Pro
                </button>
              </div>
            </div>
          </section>
          </>
          )}

        </div>
      </main>
    </div>
  );
};

export default ProDashboardPage;
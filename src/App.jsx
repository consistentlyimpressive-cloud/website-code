import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ChevronRight, ChevronLeft, Menu, X, Lock, Unlock, Play, ArrowUpRight, User, Mail, Swords, Shield, Activity, Target, Loader2, Plus, Crown, Zap, Check, AlertCircle, Key, Clock, Server, HardDrive, TrendingUp, RefreshCw, LogOut, Eye, EyeOff, BarChart3, ChevronDown, LogIn, UserPlus, Users, ExternalLink, ArrowLeft, Settings, Gauge, Sparkles } from 'lucide-react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import NewsPage from './components/NewsPage';
import MogBattlePage from './components/MogBattlePage';
import ProDashboardPage from './components/ProDashboardPage';
import PublicProfilePage from './components/PublicProfilePage';
import TermsOfServicePage from './components/TermsOfServicePage';
import PrivacyPolicyPage from './components/PrivacyPolicyPage';
import SettingsPage from './components/SettingsPage';
import { DashboardHubPreviewsCompact } from './components/DashboardHubPreviews';
import { getNavbarPlanChip, hasEffectiveProAccess, canAlwaysAccessDashboard } from './utils/planAccess';
import { initializeApp } from 'firebase/app';
import { celebrityData } from './data/celebrityData';
import { COMMUNITY_SCANS } from './data/communityScans';
import { measureItems, researchItems, reviewsData, compBefore1, compAfter1, compBefore2, compAfter2, compBefore3, compAfter3 } from './data/shared';
import HolographicCard from './components/ui/HolographicCard';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from 'firebase/auth';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';
import { getApiBase } from './utils/apiBase';

const GENERIC_ERROR = 'Something went wrong. Please try again later.';

function parseAppLocation(pathname, userUid = null) {
  const cleanPath = String(pathname || '/').split('?')[0].replace(/\/+$/, '') || '/';
  const parts = cleanPath.split('/').filter(Boolean).map((part) => decodeURIComponent(part));

  if (!parts.length) {
    return {
      page: 'home',
      routeParams: {},
      dashboardRoute: { slug: null, profileId: null },
    };
  }

  if (parts[0] === 'users' && parts.length >= 3) {
    return {
      page: 'public-profile',
      routeParams: { uid: parts[1], profileId: parts[2] },
      dashboardRoute: { slug: null, profileId: null },
    };
  }

  if (parts[0] === 'profile' && parts.length >= 2) {
    return {
      page: 'public-profile',
      routeParams: { uid: userUid || null, profileId: parts[1] },
      dashboardRoute: { slug: null, profileId: null },
    };
  }

  if (parts[0] === 'dashboard') {
    return {
      page: 'dashboard',
      routeParams: {},
      dashboardRoute: {
        slug: parts[1] || null,
        profileId: parts[2] || null,
      },
    };
  }

  return {
    page: parts.join('/'),
    routeParams: {},
    dashboardRoute: { slug: null, profileId: null },
  };
}

function stripCommunityDashboardData(dd) {
  if (!dd || typeof dd !== 'object') return dd;
  const { bestFeatures, primaryFlaws, sideBestFeatures, sidePrimaryFlaws, ...rest } = dd;
  return rest;
}

function normalizeFeatureList(items, fallbackLabel) {
  if (!Array.isArray(items)) return [];

  const cleanText = (value) => {
    if (typeof value !== 'string') return '';
    return value
      .split(/\n(?=\s*(?:#{2,}\s*|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|JUSTIFICATION\b|TECHNICAL SUMMARY\b|APPEAL ASSESSMENT\b|HEXAGON CHART RATINGS\b|CORE CATEGORY SCORES\b|CRITICAL MARKERS\b))/i)[0]
      .replace(/\s+/g, ' ')
      .trim();
  };

  return items
    .map((item, index) => {
      if (typeof item === 'string') {
        const description = cleanText(item);
        if (!description) return null;
        return {
          title: `${fallbackLabel} ${index + 1}`,
          description,
        };
      }

      if (!item || typeof item !== 'object') return null;

      const title = [
        item.title,
        item.name,
        item.label,
        item.feature,
        item.heading,
      ]
        .map(cleanText)
        .find(Boolean);

      const description = [
        item.description,
        item.desc,
        item.summary,
        item.text,
        item.details,
        item.reason,
        item.rationale,
        item.value,
      ]
        .map(cleanText)
        .find(Boolean);

      if (!title && !description) return null;

      const combinedText = `${title || ''} ${description || ''}`.trim();
      if (looksLikeFeatureSectionLeak(combinedText)) return null;

      return {
        title: title || `${fallbackLabel} ${index + 1}`,
        description:
          description ||
          (title
            ? 'Included in the scan output without extra detail.'
            : 'Included in the scan output.'),
      };
    })
    .filter(Boolean);
}

function looksLikeFeatureSectionLeak(value) {
  if (typeof value !== 'string') return false;
  const cleaned = stripInlineMarkers(value);
  return /###\s*(?:DASHBOARD_DATA|RATINGS|PERSONALISED\s+FEEDBACK|ACTIONABLE\s+PROTOCOLS|MOG_REPORT_REVISION)|\b(?:BEST FEATURES|PRIMARY FLAWS)\s*\(10\)|\bJUSTIFICATION\b/i.test(cleaned);
}

function splitDashboardFeatureItems(value) {
  if (typeof value !== 'string') return [];
  let working = value.trim();
  if (!working) return [];

  if (working.startsWith('[') && working.endsWith(']')) {
    working = working.slice(1, -1);
  }

  return working
    .replace(/\r/g, '')
    .split(/\s*,\s*|\s*;\s*|\r?\n+/)
    .map((item) => item.replace(/^\s*(?:\d+\.\s*|[-*]\s*)/, '').trim())
    .filter(Boolean);
}

function splitPrefixedDashboardEntries(block) {
  if (typeof block !== 'string') return [];

  return block
    .replace(/\r/g, '\n')
    .replace(/(?:^|[\t ]+)(?=(?:[-*]\s*)?\[\s*(?:FRONT|FRONTAL|SIDE)\s*\])/gi, '\n')
    .split(/\n+/)
    .map((item) => item.replace(/^\s*(?:[-*]\s*)?/, '').trim())
    .filter(Boolean);
}

function buildDashboardFeatureEntry(rawItem, type, index) {
  const cleaned = String(rawItem || '')
    .replace(/^\s*\[?(?:front|frontal|side)\]?\s*:?\s*/i, '')
    .trim();

  if (!cleaned) return null;

  const split = cleaned.match(/^(.{2,80}?)(?:\s+-\s+|:\s+)(.+)$/);
  if (split) {
    const entry = {
      title: stripInlineMarkers(split[1].trim()),
      description: split[2].trim(),
    };
    return looksLikeFeatureSectionLeak(`${entry.title} ${entry.description}`) ? null : entry;
  }

  const fallbackEntry = {
    title: stripInlineMarkers(cleaned),
    description:
      type === 'best'
        ? 'Flagged in the scan output as one of the strongest structural features.'
        : 'Flagged in the scan output as one of the main structural weaknesses.',
    order: index,
  };
  return looksLikeFeatureSectionLeak(`${fallbackEntry.title} ${fallbackEntry.description}`) ? null : fallbackEntry;
}

function extractDashboardFeatureListsFromRawOutput(rawOutput, type) {
  if (typeof rawOutput !== 'string' || !rawOutput.trim()) {
    return { front: [], side: [] };
  }

  const sectionRegex =
    type === 'best'
      ? /BEST FEATURES[\s\d()]*:\s*([\s\S]*?)(?=PRIMARY FLAWS[\s\d()]*:|###|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|JUSTIFICATION\b|$)/i
      : /PRIMARY FLAWS[\s\d()]*:\s*([\s\S]*?)(?=###|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|JUSTIFICATION\b|$)/i;

  const match = rawOutput.match(sectionRegex);
  if (!match) return { front: [], side: [] };

  const block = match[1].trim();
  if (!block) return { front: [], side: [] };

  let frontItems = [];
  let sideItems = [];

  const prefixedEntries = splitPrefixedDashboardEntries(block)
    .map((line) => line.match(/^\[\s*(FRONT|FRONTAL|SIDE)\s*\]\s*([\s\S]+)$/i))
    .filter(Boolean);

  if (prefixedEntries.length) {
    frontItems = prefixedEntries
      .filter((entry) => /^front/i.test(entry[1]))
      .map((entry) => `[${entry[1]}] ${entry[2].trim()}`)
      .slice(0, 5);
    sideItems = prefixedEntries
      .filter((entry) => /^side/i.test(entry[1]))
      .map((entry) => `[${entry[1]}] ${entry[2].trim()}`)
      .slice(0, 5);
  } else {
    const combined = splitDashboardFeatureItems(block);
    const prefixedFront = combined.filter((item) => /^\s*\[?\s*front(?:al)?\s*\]?/i.test(item));
    const prefixedSide = combined.filter((item) => /^\s*\[?\s*side\s*\]?/i.test(item));
    if (prefixedFront.length || prefixedSide.length) {
      frontItems = prefixedFront.slice(0, 5);
      sideItems = prefixedSide.slice(0, 5);
    } else {
      frontItems = combined.slice(0, 5);
      sideItems = combined.slice(5, 10);
    }
  }

  return {
    front: frontItems.map((item, index) => buildDashboardFeatureEntry(item, type, index)).filter(Boolean).slice(0, 5),
    side: sideItems.map((item, index) => buildDashboardFeatureEntry(item, type, index)).filter(Boolean).slice(0, 5),
  };
}

function getCommunityImageToken(value) {
  if (typeof value !== 'string') return '';
  const base = value.split('?')[0].split('#')[0].split('/').pop() || '';
  return base.trim().toLowerCase();
}

function findCommunityScanTemplate(scan) {
  if (!scan) return null;

  const idCandidates = [
    scan.id,
    scan.profileId,
    scan.userId,
    scan.displayName,
    scan.name,
  ]
    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
    .filter(Boolean);

  const imageCandidates = [
    scan.frontImage,
    scan.sideImage,
    scan.dashboardData?.frontImage,
    scan.dashboardData?.sideImage,
  ]
    .map(getCommunityImageToken)
    .filter(Boolean);

  return (
    COMMUNITY_SCANS.find((entry) => {
      const entryIds = [
        entry.id,
        entry.displayName,
      ]
        .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
        .filter(Boolean);

      if (idCandidates.some((candidate) => entryIds.includes(candidate))) {
        return true;
      }

      const entryImages = [
        entry.dashboardData?.frontImage,
        entry.dashboardData?.sideImage,
      ]
        .map(getCommunityImageToken)
        .filter(Boolean);

      return imageCandidates.some((candidate) => entryImages.includes(candidate));
    }) || null
  );
}

function hydrateCommunityScanEntry(scan, index = 0) {
  const template = findCommunityScanTemplate(scan);
  const payload = scan?.dashboardData && typeof scan.dashboardData === 'object'
    ? scan.dashboardData
    : template?.dashboardData || null;

  const frontImage =
    payload?.frontImage ||
    scan?.frontImage ||
    template?.dashboardData?.frontImage ||
    null;
  const sideImage =
    payload?.sideImage ||
    scan?.sideImage ||
    template?.dashboardData?.sideImage ||
    frontImage ||
    null;
  const finalRating =
    payload?.finalRating ??
    scan?.finalRating ??
    template?.dashboardData?.finalRating ??
    0;
  const sideRating =
    payload?.sideRating ??
    scan?.sideRating ??
    template?.dashboardData?.sideRating ??
    finalRating;

  const dashboardData = payload
    ? {
        ...payload,
        frontImage,
        sideImage,
        finalRating,
        sideRating,
        selectedModel: String(payload.selectedModel || scan?.selectedModel || '1'),
      }
    : null;

  return {
    ...template,
    ...scan,
    id: scan?.id || template?.id || `community-${index}`,
    displayName: 'Community Scan',
    tier:
      scan?.tier ||
      template?.tier ||
      (Number(finalRating) >= 90
        ? 'S-Tier'
        : Number(finalRating) >= 80
          ? 'A-Tier'
          : Number(finalRating) >= 70
            ? 'B-Tier'
            : Number(finalRating) >= 60
              ? 'C-Tier'
              : 'D-Tier'),
    frontImage,
    sideImage,
    finalRating,
    sideRating,
    dashboardData,
  };
}

function extractFeatureHighlightsFromRawOutput(rawOutput) {
  if (typeof rawOutput !== 'string' || !rawOutput.trim()) {
    return { bestFeatures: [], primaryFlaws: [] };
  }

  const trimFeatureDescription = (value) =>
    String(value || '')
      .split(/\r?\n(?=\s*(?:#{2,}\s*|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|JUSTIFICATION\b|TECHNICAL SUMMARY\b|APPEAL ASSESSMENT\b|HEXAGON CHART RATINGS\b|CORE CATEGORY SCORES\b|CRITICAL MARKERS\b))/i)[0]
      .replace(/\s+/g, ' ')
      .trim();

  const parseSingleHighlight = (regex, fallbackLabel) => {
    const match = rawOutput.match(regex);
    if (!match) return [];

    const clean = trimFeatureDescription(
      String(match[1] || '').replace(/\*\*/g, '')
    );

    if (!clean) return [];

    const split = clean.match(/^([^:.]{3,80}?)(?:\s+-\s+|:\s+)(.+)$/);
    if (split) {
      return [{ title: split[1].trim(), description: split[2].trim() }];
    }

    return [{ title: fallbackLabel, description: clean }];
  };

  return {
    bestFeatures: parseSingleHighlight(
      /(?:^|\n)\s*(?:[-*]\s*)?(?:\*{1,2}\s*)?#1\s*BEST FEATURE(?:\s*\*{1,2})?\s*:?\s*([\s\S]*?)(?=(?:\n\s*(?:[-*]\s*)?(?:\*{1,2}\s*)?#1\s*WORST FEATURE)|\n\s*(?:###\s*DASHBOARD_DATA|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|JUSTIFICATION\b)|$)/i,
      'Best Feature'
    ),
    primaryFlaws: parseSingleHighlight(
      /(?:^|\n)\s*(?:[-*]\s*)?(?:\*{1,2}\s*)?#1\s*WORST FEATURE(?:\s*\*{1,2})?\s*:?\s*([\s\S]*?)(?=\n\s*(?:###\s*DASHBOARD_DATA|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|JUSTIFICATION\b)|$)/i,
      'Primary Flaw'
    ),
  };
}

function resolveNormalizedFeatures(dashboardData, type, isSideView = false) {
  const primaryItems = type === 'best'
    ? (isSideView && dashboardData?.sideBestFeatures?.length
        ? dashboardData.sideBestFeatures
        : dashboardData?.bestFeatures)
    : (isSideView && dashboardData?.sidePrimaryFlaws?.length
        ? dashboardData.sidePrimaryFlaws
        : dashboardData?.primaryFlaws);

  const normalized = normalizeFeatureList(primaryItems, type === 'best' ? 'Best feature' : 'Primary flaw');
  const dashboardLists = extractDashboardFeatureListsFromRawOutput(dashboardData?.rawOutput || '', type);
  const rawList = isSideView ? dashboardLists.side : dashboardLists.front;
  const mergeFeatureEntryLists = (existing, incoming, max = 5) => {
    const merged = Array.isArray(existing) ? [...existing] : [];
    const seen = new Set(merged.map((item) => `${stripInlineMarkers(item?.title || '')}::${stripInlineMarkers(item?.description || '')}`));
    for (const item of incoming || []) {
      if (!item) continue;
      const key = `${stripInlineMarkers(item.title || '')}::${stripInlineMarkers(item.description || '')}`;
      if (!key.trim() || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
      if (merged.length >= max) break;
    }
    return merged.slice(0, max);
  };
  if (rawList.length > normalized.length) {
    return mergeFeatureEntryLists(rawList, normalized, 5);
  }
  if (normalized.length > 0) return mergeFeatureEntryLists(normalized, rawList, 5);

  const fallback = extractFeatureHighlightsFromRawOutput(dashboardData?.rawOutput || '');
  return (type === 'best' ? fallback.bestFeatures : fallback.primaryFlaws).slice(0, 5);
}

function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) return numeric;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') {
    const nanos = typeof value?.nanoseconds === 'number' ? value.nanoseconds / 1e6 : 0;
    return value.seconds * 1000 + nanos;
  }
  const fallback = new Date(value).getTime();
  return Number.isFinite(fallback) ? fallback : 0;
}

function formatTimestamp(value, fallback = 'Unknown Time') {
  const millis = timestampToMillis(value);
  return millis ? new Date(millis).toLocaleString() : fallback;
}

function normalizeMarkedText(value) {
  return String(value || '')
    .replace(/\*\*([\s\S]*?)\*\*/g, '*$1*')
    .replace(/\r\n/g, '\n');
}

function stripInlineMarkers(value) {
  return normalizeMarkedText(value)
    .replace(/&(red|green|blue|white|yellow)\s+([^&]+)&/gi, '$2')
    .replace(/\*/g, '')
    .trim();
}

const INLINE_COLOR_CLASSES = {
  red: 'text-red-300',
  green: 'text-emerald-300',
  blue: 'text-cyan-300',
  white: 'text-white',
  yellow: 'text-yellow-300',
};

function renderMarkedText(value, options = {}) {
  const text = normalizeMarkedText(value);
  if (!text) return null;

  const boldClassName = options.boldClassName || 'font-semibold text-white';
  const nodes = [];
  const pattern = /&(red|green|blue|white|yellow)\s+([^&]+)&|\*([^*]+)\*/gi;
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
    if (match[1]) {
      const colorKey = String(match[1]).toLowerCase();
      nodes.push(
        <span key={`color-${key++}`} className={INLINE_COLOR_CLASSES[colorKey] || ''}>
          {match[2]}
        </span>
      );
    } else {
      nodes.push(
        <strong key={`bold-${key++}`} className={boldClassName}>
          {match[3]}
        </strong>
      );
    }
    cursor = pattern.lastIndex;
  }

  pushPlain(text.slice(cursor));
  return nodes.length ? nodes : text;
}

const firebaseConfig = {
  apiKey: "AIzaSyDg9bES9zvmfvsjS6FLjCOKzBb9b6Mm0Ts",
  authDomain: "mogcheck-net.firebaseapp.com",
  projectId: "mogcheck-net",
  storageBucket: "mogcheck-net.firebasestorage.app",
  messagingSenderId: "489045009823",
  appId: "1:489045009823:web:b0fb6b4397a74b256189aa",
  measurementId: "G-NQTQ3J6DSB"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

const CHECKOUT_URLS = {
  single_scan: 'https://mogcheck.lemonsqueezy.com/checkout/buy/b61ebcdf-48c1-4a08-b04d-6a1184df0211',
  pro: 'https://mogcheck.lemonsqueezy.com/checkout/buy/79dc90c2-1197-415a-ab3d-896c27ac6962',
};

const getCheckoutUrl = (plan, user) => {
  const base = CHECKOUT_URLS[plan];
  if (!base) return '#';
  const params = new URLSearchParams();
  if (user?.uid) params.set('checkout[custom][user_id]', user.uid);
  if (user?.email) params.set('checkout[email]', user.email);
  return `${base}?${params.toString()}`;
};

const API_BASE = getApiBase();

const MOGCHECK_LOGO_SRC = '/mogcheck-logo.png';

/** PNG mark for nav / footer / page heroes */
const MogCheckLogoMark = ({ className = '', size = 32 }) => (
  <img
    src={MOGCHECK_LOGO_SRC}
    alt=""
    width={size}
    height={size}
    className={`object-contain shrink-0 drop-shadow-[0_0_12px_rgba(255,255,255,0.22)] ${className}`}
    aria-hidden
  />
);

/** Drop-in for Lucide icons where models omit a custom Icon */
const MogCheckLogoIcon = ({ size = 16, className = '' }) => (
  <img
    src={MOGCHECK_LOGO_SRC}
    alt=""
    width={size}
    height={size}
    className={`object-contain ${className}`}
    aria-hidden
  />
);

// --- Shared Components ---
const FadeUp = ({ children, delay = 0 }) => {
  const [isVisible, setIsVisible] = useState(false);
  const domRef = useRef();
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) setIsVisible(true); });
    });
    const current = domRef.current;
    if (current) observer.observe(current);
    return () => { if (current) observer.unobserve(current); };
  }, []);
  return (
    <div ref={domRef} className={`transition-all duration-1000 transform ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>
  );
};

const FlipIn = ({ children, delay = 0 }) => {
  const domRef = useRef();
  const [isVisible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    });
    if (domRef.current) observer.observe(domRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div 
      ref={domRef} 
      className={`transition-all duration-1000 ease-out [transform-style:preserve-3d] ${isVisible ? 'opacity-100 [transform:rotateY(0deg)_scale(1)]' : 'opacity-0 [transform:rotateY(-30deg)_scale(0.8)]'}`} 
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
};

// --- Navbar ---
const Navbar = ({ currentPage, setCurrentPage, user, onSignOut, userPlan, showDashboard, lowPerfMode, setLowPerfMode }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef(null);
  const username = user?.email?.split('@')[0] || '';
  const planChip = user ? getNavbarPlanChip(userPlan, user) : null;

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowUserMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <nav className="fixed top-0 w-full z-50 overflow-visible bg-[#0c0d0e]/80 backdrop-blur-md border-b border-zinc-900 flex justify-between items-center px-6 py-4">
      <div className="flex items-center gap-2.5 cursor-pointer group" onClick={() => setCurrentPage('home')}>
        <div className="w-9 h-9 flex items-center justify-center group-hover:rotate-12 transition-transform">
          <MogCheckLogoMark size={36} className="w-9 h-9" />
        </div>
        <span className="text-xl font-black tracking-tighter text-white italic">MogCheck</span>
      </div>
      <div className="hidden md:flex items-center gap-8 text-xs font-bold">
        <button onClick={() => setCurrentPage('home')} className={`${currentPage === 'home' ? 'text-white' : 'text-zinc-400'} hover:text-white transition-colors uppercase tracking-widest`}>Home</button>
        <button onClick={() => setCurrentPage('news')} className={`${currentPage === 'news' ? 'text-white' : 'text-zinc-400'} hover:text-white transition-colors uppercase tracking-widest flex items-center gap-1`}>
          News
          <span className="bg-red-500/20 text-red-500 text-[8px] px-1.5 py-0.5 rounded-sm animate-pulse ml-1">LIVE</span>
        </button>
        <button onClick={() => setCurrentPage('mog-battles')} className={`${currentPage === 'mog-battles' ? 'text-white' : 'text-zinc-400'} hover:text-white transition-colors uppercase tracking-widest flex items-center gap-1`}>
          <Swords size={14} className="text-cyan-500/90" /> Mog Battles
        </button>
        {showDashboard && (
        <button onClick={() => setCurrentPage('dashboard')} className={`${currentPage === 'dashboard' ? 'text-white' : 'text-zinc-400'} hover:text-white transition-colors uppercase tracking-widest flex items-center gap-1`}><Activity size={14} /> Dashboard</button>
        )}
        <button onClick={() => setCurrentPage('celebrity')} className={`${currentPage === 'celebrity' ? 'text-white' : 'text-zinc-400'} hover:text-white transition-colors uppercase tracking-widest`}>Scans</button>
        <button onClick={() => setCurrentPage('plans')} className={`${currentPage === 'plans' ? 'text-yellow-400 drop-shadow-[0_0_8px_rgba(234,179,8,0.6)]' : 'text-yellow-500/70'} hover:text-yellow-400 transition-all uppercase tracking-widest flex items-center gap-1`}><Crown size={13} /> Plans</button>
      </div>
      <div className="hidden md:block">
        {user ? (
          <div className="relative flex items-center gap-2" ref={menuRef}>
            {planChip && (
              <span
                className={`hidden sm:inline-flex items-center px-2.5 py-1 rounded-full border text-[9px] font-bold uppercase tracking-widest shrink-0 ${planChip.className}`}
                title="Current plan"
              >
                {planChip.label}
              </span>
            )}
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 px-5 py-2 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all text-xs font-bold uppercase tracking-widest"
            >
              {username}
              <ChevronDown size={12} className={`transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
            </button>
            {showUserMenu && (
              <div className="absolute right-0 top-full z-[100] mt-2 w-52 bg-[#0c0d0e] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-800">
                  <p className="text-[10px] text-zinc-500 font-sans truncate">{user.email}</p>
                  {planChip && (
                    <p className={`mt-2 inline-flex items-center px-2 py-0.5 rounded-md border text-[9px] font-bold uppercase tracking-widest ${planChip.className}`}>
                      Plan: {planChip.label}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setCurrentPage('settings'); setShowUserMenu(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-xs text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors uppercase tracking-widest font-bold border-b border-zinc-800"
                >
                  <Settings size={14} /> Account &amp; settings
                </button>
                <button
                  type="button"
                  onClick={() => { setCurrentPage('profile'); setShowUserMenu(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-xs text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors uppercase tracking-widest font-bold border-b border-zinc-800"
                >
                  <User size={14} /> Profile &amp; scans
                </button>
                <button
                  type="button"
                  onClick={() => setLowPerfMode((v) => !v)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-xs text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors uppercase tracking-widest font-bold border-b border-zinc-800"
                >
                  <span className="flex items-center gap-3">
                    <Gauge size={14} /> Low performance
                  </span>
                  <span className={`text-[9px] px-2 py-0.5 rounded-md border ${lowPerfMode ? 'border-cyan-500/40 text-cyan-400 bg-cyan-500/10' : 'border-zinc-700 text-zinc-500'}`}>
                    {lowPerfMode ? 'On' : 'Off'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => { onSignOut(); setShowUserMenu(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-xs text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors uppercase tracking-widest font-bold"
                >
                  <LogOut size={14} /> Sign Out
                </button>
              </div>
            )}
          </div>
        ) : (
          <button onClick={() => setCurrentPage('login')} className="px-6 py-2 rounded-full bg-white text-black font-bold text-xs uppercase tracking-widest hover:bg-zinc-200 transition-colors">Login</button>
        )}
      </div>
      <button className="md:hidden text-white" onClick={() => setIsOpen(!isOpen)}>{isOpen ? <X /> : <Menu />}</button>
      {isOpen && (
        <div className="absolute top-full left-0 w-full bg-[#0c0d0e] border-b border-zinc-900 flex flex-col items-center py-6 gap-6 md:hidden">
        <button onClick={() => { setCurrentPage('home'); setIsOpen(false); }} className="text-zinc-400 uppercase tracking-widest text-xs font-bold">Home</button>
        <button onClick={() => { setCurrentPage('news'); setIsOpen(false); }} className="text-zinc-400 uppercase tracking-widest text-xs font-bold flex items-center gap-2">News <span className="bg-red-500/20 text-red-500 text-[8px] px-1.5 py-0.5 rounded-sm animate-pulse ml-1">LIVE</span></button>
        <button onClick={() => { setCurrentPage('mog-battles'); setIsOpen(false); }} className="text-zinc-400 uppercase tracking-widest text-xs font-bold flex items-center gap-2"><Swords size={14} className="text-cyan-500/90" /> Mog Battles</button>
        {showDashboard && (
        <button onClick={() => { setCurrentPage('dashboard'); setIsOpen(false); }} className="text-zinc-400 uppercase tracking-widest text-xs font-bold flex items-center gap-2"><Activity size={14} /> Dashboard</button>
        )}
          <button onClick={() => { setCurrentPage('celebrity'); setIsOpen(false); }} className="text-zinc-400 uppercase tracking-widest text-xs font-bold">Celebrity Rating</button>
          <button onClick={() => { setCurrentPage('plans'); setIsOpen(false); }} className="text-yellow-500/70 uppercase tracking-widest text-xs font-bold flex items-center gap-2"><Crown size={13} /> Plans</button>
          {user ? (
            <>
              <div className="flex flex-col items-center gap-1">
                <span className="text-zinc-300 font-sans text-xs">{username}</span>
                {planChip && (
                  <span className={`px-2.5 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-widest ${planChip.className}`}>
                    {planChip.label}
                  </span>
                )}
              </div>
              <button type="button" onClick={() => { setCurrentPage('settings'); setIsOpen(false); }} className="flex items-center gap-2 text-zinc-400 hover:text-white font-bold text-xs uppercase tracking-widest">
                <Settings size={14} /> Account &amp; settings
              </button>
              <button type="button" onClick={() => { setCurrentPage('profile'); setIsOpen(false); }} className="flex items-center gap-2 text-zinc-400 hover:text-white font-bold text-xs uppercase tracking-widest">
                <User size={14} /> Profile &amp; scans
              </button>
              <button type="button" onClick={() => setLowPerfMode((v) => !v)} className="flex items-center gap-2 text-zinc-400 hover:text-white font-bold text-xs uppercase tracking-widest">
                <Gauge size={14} /> Low perf: {lowPerfMode ? 'On' : 'Off'}
              </button>
              <button type="button" onClick={() => { onSignOut(); setIsOpen(false); }} className="flex items-center gap-2 px-8 py-2 rounded-full border border-zinc-800 text-red-400 hover:text-red-300 font-bold text-xs uppercase tracking-widest">
                <LogOut size={14} /> Sign Out
              </button>
            </>
          ) : (
            <button onClick={() => { setCurrentPage('login'); setIsOpen(false); }} className="px-8 py-2 rounded-full bg-white text-black font-bold text-xs uppercase tracking-widest mt-2">Login</button>
          )}
        </div>
      )}
    </nav>
  );
};

// --- Spotlight Image Card ---
const SpotlightImageCard = ({ item }) => {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const handleMouseMove = (e) => { const rect = e.currentTarget.getBoundingClientRect(); setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top }); };
  return (
    <div className="flex flex-col items-center cursor-pointer w-full group">
      <div className="relative w-full aspect-square rounded-2xl overflow-hidden transition-all duration-500 border border-zinc-900 group-hover:border-zinc-700 transform-gpu" onMouseMove={handleMouseMove} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
        {item.imgSrc ? (<img src={item.imgSrc} alt={item.title} referrerPolicy="no-referrer" className={`absolute inset-0 w-full h-full object-cover transition-all duration-700 transform-gpu will-change-transform ${isHovered ? 'opacity-100 scale-105' : 'opacity-90 scale-100'} ${item.imgClassName || ''}`} />) : (<div className="absolute inset-0 bg-zinc-900/40" />)}
        {item.imgSrc && (
          <div className={`absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-500 ${isHovered ? 'opacity-100' : 'opacity-0'}`} style={{ WebkitMaskImage: `radial-gradient(120px circle at ${mousePos.x}px ${mousePos.y}px, black 0%, transparent 100%)`, maskImage: `radial-gradient(120px circle at ${mousePos.x}px ${mousePos.y}px, black 0%, transparent 100%)` }}>
            <img src={item.imgSrc} alt={`${item.title} blurred`} referrerPolicy="no-referrer" className={`w-full h-full object-cover blur-xl transform-gpu will-change-transform transition-all duration-700 opacity-60 ${isHovered ? 'scale-105' : 'scale-100'} ${item.imgClassName || ''}`} />
          </div>
        )}
        <div className="absolute inset-0 p-8 pointer-events-none z-30 transform-gpu">{item.svg}</div>
      </div>
      <span className={`mt-6 text-zinc-500 font-sans uppercase text-sm tracking-[0.3em] transition-colors ${isHovered ? 'text-white' : ''}`}>{item.title}</span>
    </div>
  );
};

// --- Comparison Card ---
const ComparisonCard = ({ beforeImgSrc, afterImgSrc, beforeScore, afterScore, isActive = false, review }) => {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef(null);
  const handleMove = (clientX) => { if (!containerRef.current) return; const rect = containerRef.current.getBoundingClientRect(); const x = Math.max(0, Math.min(clientX - rect.left, rect.width)); setSliderPosition((x / rect.width) * 100); };
  const handleMouseUp = () => setIsDragging(false);
  const handleMouseMove = (e) => { if (isDragging) handleMove(e.clientX); };
  const handleTouchMove = (e) => { if (isDragging) handleMove(e.touches[0].clientX); };
  useEffect(() => {
    if (isDragging) { window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp); window.addEventListener('touchmove', handleTouchMove, { passive: false }); window.addEventListener('touchend', handleMouseUp); }
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); window.removeEventListener('touchmove', handleTouchMove); window.removeEventListener('touchend', handleMouseUp); };
  }, [isDragging]);
  return (
    <div ref={containerRef} className={`relative aspect-[4/5] rounded-xl overflow-hidden border ${isActive ? 'border-blue-500/50 scale-105 z-10 shadow-[0_0_30px_rgba(59,130,246,0.3)]' : 'border-zinc-800 opacity-80 scale-95'} transition-all duration-700 bg-zinc-900 group cursor-ew-resize select-none touch-none`} onMouseDown={(e) => { setIsDragging(true); handleMove(e.clientX); }} onTouchStart={(e) => { setIsDragging(true); handleMove(e.touches[0].clientX); }}>
      <img src={afterImgSrc} className="absolute inset-0 w-full h-full object-cover brightness-110 pointer-events-none" alt="After" draggable="false" referrerPolicy="no-referrer" />
      <img src={beforeImgSrc} className="absolute inset-0 w-full h-full object-cover pointer-events-none" style={{ clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0% 100%)` }} alt="Before" draggable="false" referrerPolicy="no-referrer" />
      <div className="absolute top-0 bottom-0 w-[2px] bg-white/40 z-20 shadow-[0_0_10px_rgba(0,0,0,0.5)] pointer-events-none" style={{ left: `calc(${sliderPosition}% - 1px)` }} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent z-10 pointer-events-none" />
      
      {/* CRT + Blue Tint Filters */}
      <div className="absolute inset-0 pointer-events-none z-20 opacity-[0.08] mix-blend-overlay bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,#000_2px,#000_4px)]" />
      <div className="absolute inset-0 pointer-events-none z-20 bg-blue-500/10 mix-blend-color" />
      <div className="absolute inset-0 pointer-events-none z-20 bg-[radial-gradient(circle,transparent_40%,rgba(0,5,20,0.9)_120%)]" />

      <div className="absolute top-1/2 -translate-y-1/2 z-30 pointer-events-none" style={{ left: `calc(${sliderPosition}% - 12px)` }}>
        <div className={`w-6 h-6 bg-black/80 backdrop-blur border border-white/20 rounded flex items-center justify-center rotate-45 shadow-xl transition-transform ${isDragging ? 'scale-125 bg-white/20' : 'group-hover:scale-110'}`}><div className="-rotate-45 flex items-center justify-center"><ChevronRight size={14} className="text-white ml-0.5" /></div></div>
      </div>
      
      {/* Integrated Review */}
      {review && (
        <div className="absolute bottom-4 left-[7.5%] right-[7.5%] w-[85%] z-40 p-4 bg-black/25 backdrop-blur-md border border-blue-500/20 rounded-xl transform-gpu transition-all duration-500 hover:scale-[1.02] hover:bg-black/45">
          <div className="flex gap-1 mb-2 text-blue-400">
            {[...Array(review.rating)].map((_, i) => (
              <svg key={i} className="w-2.5 h-2.5 fill-current drop-shadow-[0_0_5px_rgba(96,165,250,0.8)]" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
            ))}
          </div>
          <p className="text-blue-50 text-[11px] md:text-xs font-sans italic mb-2 leading-relaxed opacity-90">"{review.text}"</p>
          <p className="text-blue-400 font-sans text-[9px] uppercase tracking-widest font-bold">{review.author}</p>
        </div>
      )}
    </div>
  );
};

// --- Body Fat Slider ---
const BodyFatSlider = () => {
  const videoRef = useRef(null);
  const [sliderValue, setSliderValue] = useState(100);
  const [duration, setDuration] = useState(0);
  const currentBF = (10 + (sliderValue / 100) * 25).toFixed(1);

  /** Snap to 1% body-fat steps (10%–35% → 26 steps on the 0–100 slider). */
  const handleSliderChange = (e) => {
    const raw = Number(e.target.value);
    const snapped = Math.round(raw / 4) * 4;
    setSliderValue(snapped);
    if (videoRef.current && duration > 0) {
      videoRef.current.currentTime = Math.min((snapped / 100) * duration, duration * 0.99);
    }
  };

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="w-full max-w-sm aspect-[9/16] max-h-[45vh] rounded-xl bg-zinc-800/40 border border-blue-500/60 relative overflow-hidden shadow-[0_0_40px_rgba(59,130,246,0.5)]">
        <video
          ref={videoRef}
          src="/bodyfat-morph-smooth.mp4"
          className="w-full h-full object-cover transform scale-[1.15]" style={{ filter: 'saturate(0.7)' }}
          muted
          playsInline
          preload="auto"
          onLoadedData={(e) => { setDuration(e.target.duration); e.target.currentTime = e.target.duration * 0.99; }}
        />
        {/* CRT Overlay */}
        <div className="absolute inset-0 pointer-events-none z-10 opacity-[0.12] mix-blend-overlay bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,#000_2px,#000_4px)]" />
        <div className="absolute inset-0 pointer-events-none z-10 bg-blue-500/10 mix-blend-color" />
        <div className="absolute inset-0 pointer-events-none z-10 bg-[radial-gradient(circle,transparent_40%,rgba(0,5,20,0.8)_120%)]" />
      </div>
      <div className="w-full max-w-sm">
        <div className="flex justify-between items-center mb-3">
          <span className="text-xs font-sans font-bold uppercase tracking-widest text-green-400">10% Body Fat</span>
          <span className="text-lg font-black italic text-white">{currentBF}%</span>
          <span className="text-xs font-sans font-bold uppercase tracking-widest text-red-400">35% Body Fat</span>
        </div>
        <style>{`
          .bf-slider { 
            -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 999px; 
            background: linear-gradient(90deg, #22c55e, #eab308, #ef4444, #eab308, #22c55e); 
            background-size: 200% 100%;
            animation: gradientFlow 3s linear infinite;
            outline: none; cursor: pointer; 
            box-shadow: 0 0 15px rgba(234,179,8,0.3);
          }
          @keyframes gradientFlow {
            0% { background-position: 0% 50%; }
            100% { background-position: 200% 50%; }
          }
          .bf-slider::-webkit-slider-thumb { 
            -webkit-appearance: none; appearance: none; width: 22px; height: 22px; border-radius: 50%; 
            background: white; border: 3px solid #0c0d0e; 
            box-shadow: 0 0 10px rgba(255,255,255,0.4); 
            cursor: grab; 
            transition: all 0.1s cubic-bezier(0.4, 0, 0.2, 1); 
          }
          .bf-slider::-webkit-slider-thumb:hover { transform: scale(1.2); box-shadow: 0 0 15px rgba(255,255,255,0.6); }
          .bf-slider::-webkit-slider-thumb:active { 
            cursor: grabbing; 
            transform: scaleX(1.6) scaleY(0.85); 
            box-shadow: -10px 0 15px rgba(255,255,255,0.4), 10px 0 15px rgba(255,255,255,0.4), 0 0 20px white; 
            filter: blur(0.5px);
          }
          .bf-slider::-moz-range-thumb { 
            width: 22px; height: 22px; border-radius: 50%; 
            background: white; border: 3px solid #0c0d0e; 
            box-shadow: 0 0 10px rgba(255,255,255,0.4); 
            cursor: grab; 
            transition: all 0.1s cubic-bezier(0.4, 0, 0.2, 1); 
          }
          .bf-slider::-moz-range-thumb:hover { transform: scale(1.2); box-shadow: 0 0 15px rgba(255,255,255,0.6); }
          .bf-slider::-moz-range-thumb:active { 
            cursor: grabbing; 
            transform: scaleX(1.6) scaleY(0.85); 
            box-shadow: -10px 0 15px rgba(255,255,255,0.4), 10px 0 15px rgba(255,255,255,0.4), 0 0 20px white; 
            filter: blur(0.5px);
          }
        `}</style>
        <input
          type="range"
          min="0"
          max="100"
          step="4"
          value={sliderValue}
          onChange={handleSliderChange}
          className="bf-slider w-full"
          aria-valuetext={`${currentBF}% body fat`}
        />
      </div>
    </div>
  );
};

// --- Reviews Carousel ---

const ReviewsCarousel = () => {
  const [activeIndex, setActiveIndex] = useState(0);

  const nextReview = () => setActiveIndex((prev) => (prev + 1) % 3);
  const prevReview = () => setActiveIndex((prev) => (prev - 1 + 3) % 3);

  return (
    <div className="w-full max-w-6xl mx-auto py-20 px-6 relative flex flex-col items-center">
      <FadeUp><h2 className="text-4xl md:text-5xl font-black uppercase tracking-widest italic mb-16 text-center text-white">Wall of Ascent</h2></FadeUp>
      
      <div className="relative w-full h-[400px] flex items-center justify-center">
        {/* Navigation Arrows */}
        <button onClick={prevReview} className="absolute left-0 md:left-8 z-40 p-4 bg-zinc-900/80 border border-zinc-700 hover:border-zinc-400 rounded-full text-white transition-all transform hover:scale-110 cursor-pointer backdrop-blur-md">
          <ChevronLeft size={32} />
        </button>
        <button onClick={nextReview} className="absolute right-0 md:right-8 z-40 p-4 bg-zinc-900/80 border border-zinc-700 hover:border-zinc-400 rounded-full text-white transition-all transform hover:scale-110 cursor-pointer backdrop-blur-md">
          <ChevronRight size={32} />
        </button>

        <div className="relative w-full max-w-5xl h-full flex items-center justify-center">
          {reviewsData.map((review, idx) => {
            const offset = (idx - activeIndex + 3) % 3;
            let transformClass = '';
            let zIndexClass = '';
            let blurClass = '';
            let bgClass = '';
            
            if (offset === 0) {
              transformClass = 'translate-x-0 scale-100';
              zIndexClass = 'z-30';
              blurClass = 'blur-none opacity-100';
              bgClass = 'bg-zinc-900/90 border-zinc-700';
            } else if (offset === 1) {
              transformClass = 'translate-x-[40%] md:translate-x-[60%] scale-75 cursor-pointer hover:scale-[0.8]';
              zIndexClass = 'z-20';
              blurClass = 'blur-md opacity-40';
              bgClass = 'bg-zinc-900/40 border-zinc-800';
            } else { // offset === 2 (left)
              transformClass = '-translate-x-[40%] md:-translate-x-[60%] scale-75 cursor-pointer hover:scale-[0.8]';
              zIndexClass = 'z-20';
              blurClass = 'blur-md opacity-40';
              bgClass = 'bg-zinc-900/40 border-zinc-800';
            }

            return (
              <div 
                key={idx} 
                onClick={() => offset !== 0 && setActiveIndex(idx)}
                className={`absolute w-full max-w-md p-10 rounded-2xl border transition-all duration-700 ease-in-out transform-gpu ${transformClass} ${bgClass} backdrop-blur-xl shadow-2xl ${zIndexClass}`}
              >
                <div className={`transition-all duration-700 ${blurClass}`}>
                  <div className="flex gap-1.5 mb-5 text-yellow-500">
                    {[...Array(review.rating)].map((_, i) => (
                      <svg key={i} className="w-6 h-6 fill-current" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                    ))}
                  </div>
                  <p className="text-zinc-200 font-sans text-xl italic mb-8 leading-relaxed">"{review.text}"</p>
                  <p className="text-zinc-500 font-sans text-xs uppercase tracking-[0.2em]">{review.author}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const CelebrityRatingPage = ({ setCurrentPage, setSelectedCelebrity }) => {
  const [communityScans, setCommunityScans] = useState([]);
  const [showAllCommunity, setShowAllCommunity] = useState(false);
  const [communityPeek, setCommunityPeek] = useState(null);

  useEffect(() => {
    if (!communityPeek) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [communityPeek]);

  useEffect(() => {
    const fetchCommunity = async () => {
      try {
        const { fetchCommunityBattles } = await import('./api/mogBattleVotes');
        const res = await fetchCommunityBattles();
        const scansMap = new Map();
        res.battles.forEach(b => {
          // If profileId exists it's from a real user, otherwise fallback to local mocked data from communityScans.js
          if (b.fighterA) scansMap.set(b.fighterA.profileId || b.fighterA.name, { ...b.fighterA, isCommunity: true });
          if (b.fighterB) scansMap.set(b.fighterB.profileId || b.fighterB.name, { ...b.fighterB, isCommunity: true });
        });
        
        let loadedScans = Array.from(scansMap.values()).map((scan, idx) => hydrateCommunityScanEntry(scan, idx));
        
        // If the API doesn't return enough scans, let's load the mocked ones from data/communityScans.js
        if (loadedScans.length === 0) {
          loadedScans = COMMUNITY_SCANS.map((s, i) =>
            hydrateCommunityScanEntry(
              {
                ...s,
                name: `User ${i + 1}`,
                isCommunity: true,
                profileId: `mock-${i}`,
              },
              i
            )
          );
        }
        
        setCommunityScans(loadedScans);
      } catch(e) {
        console.error(e);
      }
    };
    fetchCommunity();
  }, []);

  return (
    <div className="w-full flex-grow pt-28 pb-16 px-4 sm:px-6 relative flex flex-col items-center overflow-hidden">
      {communityPeek && communityPeek.dashboardData && (
        <div
          className="fixed inset-0 z-[220] flex flex-col bg-[#0a0a0b] overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="community-scan-page-title"
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
              <h2 id="community-scan-page-title" className="truncate font-black uppercase italic tracking-tight text-white">
                Community Scan
              </h2>
            </div>
          </header>
          <div className="flex-1 px-4 pb-16 pt-6 md:px-8">
            <DashboardPage
              dashboardData={communityPeek.dashboardData}
              setCurrentPage={setCurrentPage}
              userPlan={{ plan: 'pro', scanCredits: 0 }}
              user={null}
              hideTopSection
              hideProtocols
              hideActionableProtocols
              hideUnlockPotential
              hidePersonalizedFeedback
              isEmbedded
            />
          </div>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0c0d0e] via-zinc-900/20 to-[#0c0d0e] -z-10" />
      <FadeUp>
        <div className="text-center mb-10 md:mb-12 relative">
          <div className="absolute -top-[100%] left-1/2 -translate-x-1/2 w-[300px] h-[300px] bg-white/5 blur-[100px] rounded-full pointer-events-none" />
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black italic uppercase tracking-tighter text-white mb-4 drop-shadow-2xl">Elite Protocol</h1>
          <div className="flex items-center justify-center gap-4">
            <div className="h-[1px] w-12 bg-zinc-800" />
            <p className="text-white font-sans text-[10px] md:text-xs uppercase tracking-[0.2em] font-black text-center px-4 py-2 border border-white/20 bg-white/10 backdrop-blur-md rounded-full max-w-xl leading-relaxed shadow-[0_0_20px_rgba(255,255,255,0.15)]">
              The flags represent genetic ethnic backgrounds and not nationalities
            </p>
            <div className="h-[1px] w-12 bg-zinc-800" />
          </div>
        </div>
      </FadeUp>

      <div className="w-full max-w-5xl mx-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3 md:gap-4 mb-24">
        {celebrityData.map((celeb, idx) => (
          <FlipIn key={idx} delay={Math.min(idx * 80, 400)}>
            <HolographicCard 
              compact
              celeb={celeb} 
              onClick={() => {
                setSelectedCelebrity(celeb);
                setCurrentPage('celebrity-stats');
              }} 
            />
          </FlipIn>
        ))}
      </div>

      <div className="w-full max-w-5xl mx-auto flex flex-col items-center text-center">
        <h2 className="text-3xl font-black italic uppercase tracking-widest text-white mb-2">Community Scans</h2>
        <p className="text-zinc-500 uppercase tracking-widest text-xs mb-10">SEE HOW OTHERS IN THE COMMUNITY STACK UP.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 w-full">
          {(showAllCommunity ? communityScans : communityScans.slice(0, 8)).map((rawScan, idx) => {
            const scan = hydrateCommunityScanEntry(rawScan, idx);
            const scanTier = scan.tier || (Number(scan.finalRating) >= 90 ? 'S-Tier' : Number(scan.finalRating) >= 80 ? 'A-Tier' : Number(scan.finalRating) >= 70 ? 'B-Tier' : Number(scan.finalRating) >= 60 ? 'C-Tier' : 'D-Tier');
            const tierUpper = String(scanTier).toUpperCase();
            const tierBadgeClass =
              tierUpper.includes('S') && tierUpper.includes('TIER')
                ? 'bg-red-500/20 text-red-500 border-red-500/30 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                : tierUpper.includes('A') && tierUpper.includes('TIER')
                  ? 'bg-orange-500/20 text-orange-400 border-orange-500/30 shadow-[0_0_8px_rgba(249,115,22,0.6)]'
                  : 'bg-zinc-700/40 text-zinc-300 border-zinc-600/50';

            return (
            <button 
              type="button"
              key={scan.id || idx}
              onClick={() => {
                if (!scan.dashboardData) return;
                setCommunityPeek(scan);
              }}
              className="bg-zinc-900/40 border border-zinc-800 rounded-[28px] overflow-hidden cursor-pointer hover:border-cyan-500/50 transition-colors group relative"
            >
              <div className="overflow-hidden rounded-[28px]">
                <img src={scan.frontImage} className="w-full aspect-[3/4] object-cover object-top" alt="Community Scan" />
              </div>
              <div className="absolute top-3 left-3 z-20">
                <span className={`border text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded backdrop-blur-md ${tierBadgeClass}`}>
                  {scanTier}
                </span>
              </div>
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black via-black/80 to-transparent p-4 flex flex-col items-start">
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-2xl font-black italic text-white drop-shadow-md">{Number(scan.finalRating || 0).toFixed(1)}</span>
                  <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">/100</span>
                </div>
                <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-[0.2em]">COMMUNITY SCAN</span>
              </div>
            </button>
          )})}
        </div>
        {communityScans.length === 0 && (
          <p className="text-zinc-500 text-center py-12 w-full">No community scans available yet.</p>
        )}
        {communityScans.length > 8 && !showAllCommunity && (
          <div className="mt-12 flex justify-center w-full">
            <button 
              onClick={() => setShowAllCommunity(true)}
              className="px-8 py-3 rounded-xl bg-zinc-900 border border-zinc-700 text-white font-bold uppercase tracking-widest hover:bg-zinc-800 transition-colors"
            >
              Show More
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Celebrity Stats Page ---
const CelebrityStatsPage = ({ celeb, setCurrentPage }) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const num = parseFloat(celeb.rating);
  let rColors = {};
  if (num >= 90) {
    rColors = {
      text: 'from-green-200 via-green-400 to-green-500',
      dropConfig: 'drop-shadow-[0_0_20px_rgba(74,222,128,1)] drop-shadow-[0_0_40px_rgba(74,222,128,0.8)]',
      border: 'border-green-400/80',
      badge: 'text-green-300 border-green-500/30'
    };
  } else if (num >= 80) {
    rColors = {
      text: 'from-green-400 via-green-500 to-green-600',
      dropConfig: 'drop-shadow-[0_0_15px_rgba(34,197,94,0.6)]',
      border: 'border-green-500/60',
      badge: 'text-green-400 border-green-500/30'
    };
  } else if (num >= 70) {
    rColors = {
      text: 'from-orange-400 via-lime-500 to-green-500',
      dropConfig: 'drop-shadow-[0_0_15px_rgba(132,204,22,0.5)]',
      border: 'border-lime-500/60',
      badge: 'text-lime-400 border-lime-500/30'
    };
  } else if (num >= 60) {
    rColors = {
      text: 'from-orange-500 via-yellow-500 to-lime-500',
      dropConfig: 'drop-shadow-[0_0_15px_rgba(234,179,8,0.5)]',
      border: 'border-yellow-500/60',
      badge: 'text-yellow-400 border-yellow-500/30'
    };
  } else {
    rColors = {
      text: 'from-orange-500 via-orange-600 to-orange-700',
      dropConfig: 'drop-shadow-[0_0_15px_rgba(249,115,22,0.5)]',
      border: 'border-orange-600/60',
      badge: 'text-orange-500 border-orange-600/30'
    };
  }

  // Group stats
  const groupedStats = celeb.stats.reduce((acc, stat) => {
    if (!acc[stat.category]) acc[stat.category] = [];
    acc[stat.category].push(stat);
    return acc;
  }, {});

  return (
    <div className="w-full flex-grow pt-32 pb-24 px-4 sm:px-6 relative flex flex-col items-center">
      <div className="absolute inset-0 bg-gradient-to-b from-[#0c0d0e] via-zinc-900/20 to-[#0c0d0e] -z-10" />
      
      <div className="w-full max-w-5xl">
        <button 
          onClick={() => setCurrentPage('celebrity')}
          className="flex items-center gap-2 text-zinc-400 hover:text-white mb-8 transition-colors group uppercase tracking-widest text-xs font-bold"
        >
          <ChevronRight className="w-4 h-4 rotate-180 group-hover:-translate-x-1 transition-transform" />
          Back to Elite Protocol
        </button>

        <div className="flex flex-col md:flex-row gap-12">
          {/* Left Column: Card Image & Flags */}
          <div className="w-full md:w-1/3 flex flex-col items-center gap-6">
            <div className={`relative w-full aspect-[3/4] rounded-2xl border ${rColors.border} bg-[#0c0d0e] overflow-hidden shadow-2xl shadow-black/50`}>
              <img src={celeb.imgSrc} referrerPolicy="no-referrer" className="w-full h-full object-cover" alt={celeb.name} />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0c0d0e]/80 via-transparent to-transparent pointer-events-none" />
            </div>
          </div>

          {/* Right Column: Stats & Info */}
          <div className="w-full md:w-2/3 space-y-12">
            {/* Header section */}
            <div>
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-2">
                <h1 className="text-4xl md:text-5xl font-black italic uppercase tracking-tighter text-white">
                  {celeb.name}
                </h1>
                <span className={`text-5xl font-black italic text-transparent bg-clip-text bg-gradient-to-br leading-none shrink-0 ${rColors.text} ${rColors.dropConfig}`}>
                  {celeb.rating}
                </span>
              </div>
              
              <div className="flex items-center gap-4 border-b border-zinc-800/50 pb-6 mb-6">
                <span className={`text-xs font-black uppercase tracking-widest px-3 py-1 rounded bg-black/60 border ${rColors.badge}`}>
                  {celeb.tier}
                </span>
                
                {celeb.flags && celeb.flags.length > 0 && (
                  <div className="flex items-center gap-2 border-l border-zinc-800 pl-4">
                    {celeb.flags.map((code) => (
                      <img key={code} src={`https://flagcdn.com/w20/${code}.png`} alt={`${code} flag`} className="w-6 h-[18px] object-cover rounded-[2px] opacity-90 shadow-sm border border-white/10" />
                    ))}
                  </div>
                )}
                
                <span className="text-xs font-sans uppercase tracking-widest text-zinc-400 border-l border-zinc-800 pl-4">
                  Sex: {celeb.sex || 'Unknown'}
                </span>
              </div>
            </div>

            {/* Overview */}
            <section>
              <h2 className="text-2xl font-black uppercase tracking-widest mb-4 text-white italic">Overview</h2>
              <div className="p-6 bg-zinc-900/30 border border-zinc-800/50 rounded-xl shadow-lg">
                <p className="text-zinc-300 font-sans leading-relaxed tracking-wide" dangerouslySetInnerHTML={{ __html: String(celeb.technicalSummary || '').replace(/\*\*(.*?)\*\*/g, '<b class="text-white">$1</b>') }} />
              </div>
            </section>

            {/* Metrics */}
            <section className="space-y-8">
              <h2 className="text-2xl font-black uppercase tracking-widest text-white italic">Facial Metrics</h2>
              
              <div className="flex flex-col gap-10">
                {Object.entries(groupedStats).map(([cat, metrics]) => (
                  <div key={cat} className="flex flex-col">
                    <h4 className="text-cyan-500/80 font-bold uppercase tracking-widest text-xs mb-5 border-b border-zinc-800/80 pb-3">{cat}</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 gap-x-12 gap-y-7">
                      {metrics.map((m, i) => (
                        <MetricBar key={i} label={m.label} score={m.score} max={100} displayValue={m.displayValue} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Home Page ---
const UserProfilePage = ({ user, userPlan, setCurrentPage }) => {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchScans = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/scans`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch history');
      const data = await res.json();
      setScans(data.scans || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScans();
  }, [user]);

  const handleDeleteScan = async (scanId) => {
    if (!window.confirm("Are you sure you want to delete this scan and its images?")) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/scans/${scanId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to delete scan');
      setScans(scans.filter(s => s.id !== scanId));
    } catch (e) {
      alert("Error deleting scan: " + e.message);
    }
  };

  const handleDeleteAccount = async () => {
    if (window.confirm("Are you sure you want to delete your account? This action cannot be undone and you will lose all scan history.")) {
      try {
        const { deleteUser } = await import('firebase/auth');
        if (user) {
          await deleteUser(user);
          setCurrentPage('home');
        }
      } catch (e) {
        console.error("Error deleting account:", e);
        alert("Error deleting account. For security reasons, you may need to sign out and sign back in before deleting your account.");
      }
    }
  };

  // Compute daily scans
  const todayScans = scans.filter((scan) => {
    const millis = timestampToMillis(scan.timestamp || scan.scannedAt || scan.createdAt);
    if (!millis) return false;
    return new Date(millis).toDateString() === new Date().toDateString();
  }).length;

  return (
    <div className="min-h-screen pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row gap-8">
        
        {/* Left Sidebar: Plan & Danger Zone */}
        <div className="w-full md:w-80 shrink-0 space-y-6">
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <h2 className="text-lg font-black italic tracking-tighter uppercase mb-4 flex items-center gap-2"><User size={18}/> Profile</h2>
            <div className="text-sm font-sans text-zinc-300 mb-1">{user?.email}</div>
            <div className="text-[10px] font-sans text-zinc-500 uppercase tracking-widest mb-6">UID: {user?.uid.substring(0,8)}...</div>
            
            <div className="border-t border-zinc-800 pt-4 mb-4">
              <h3 className="text-[10px] font-sans text-zinc-500 uppercase tracking-widest mb-2">Current Plan</h3>
              <div className="flex items-center justify-between">
                <span className="text-lg font-black uppercase text-cyan-400">{userPlan.plan}</span>
                {userPlan.plan === 'single_scan' && (
                  <span className="text-xs font-sans text-zinc-400 bg-zinc-800 px-2 py-1 rounded">{userPlan.scanCredits} credits</span>
                )}
              </div>
            </div>

            <button onClick={() => setCurrentPage('plans')} className="w-full py-2 bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 rounded hover:bg-cyan-500/20 transition-colors uppercase tracking-widest text-[10px] font-bold mb-4">
              Upgrade Plan
            </button>
            
            <div className="border-t border-zinc-800 pt-4 mt-4">
              <h3 className="text-[10px] font-sans text-zinc-500 uppercase tracking-widest mb-2 text-red-500">Danger Zone</h3>
              <button onClick={handleDeleteAccount} className="w-full py-2 bg-red-500/10 border border-red-500/30 text-red-500 rounded hover:bg-red-500/20 transition-colors uppercase tracking-widest text-[10px] font-bold">
                Delete Account
              </button>
            </div>
          </div>
        </div>

        {/* Right Area: Stats & History */}
        <div className="flex-1 space-y-6">
          
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 relative overflow-hidden">
              <BarChart3 size={20} className="text-cyan-400 mb-2" />
              <p className="text-3xl font-black">{scans.length}</p>
              <p className="text-[10px] font-sans text-zinc-500 uppercase tracking-widest">Total Scans</p>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 relative overflow-hidden">
              <Activity size={20} className="text-emerald-400 mb-2" />
              <p className="text-3xl font-black">{todayScans}</p>
              <p className="text-[10px] font-sans text-zinc-500 uppercase tracking-widest">Scans Today</p>
            </div>
          </div>

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <h2 className="text-lg font-black italic tracking-tighter uppercase mb-4 flex items-center gap-2"><Clock size={18}/> Scan History</h2>
            
            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="animate-spin text-cyan-400" /></div>
            ) : error ? (
              <div className="text-red-400 text-sm">{error}</div>
            ) : scans.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-zinc-500 text-sm font-sans mb-4">No scan history available yet.</p>
                <button onClick={() => setCurrentPage('upload-photo')} className="px-6 py-2 bg-cyan-500 text-black font-bold uppercase tracking-widest text-xs rounded-full">New Scan</button>
              </div>
            ) : (
              <div className="space-y-3">
                {scans.map(scan => (
                  <div key={scan.id} className="flex items-center justify-between p-4 bg-zinc-950/50 border border-zinc-800/80 rounded-xl hover:border-zinc-700 transition-colors">
                    <div className="flex items-center gap-4">
                      {scan.frontImageUrl ? (
                        <div className="w-12 h-12 rounded overflow-hidden bg-zinc-800 shrink-0">
                          <img src={scan.frontImageUrl} alt="Scan preview" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded bg-zinc-800 shrink-0 flex items-center justify-center text-zinc-600 text-[10px]">No Img</div>
                      )}
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-sm">{scan.finalRating ? `${scan.finalRating}/100` : 'N/A'}</span>
                          {scan.model === '1' && <span className="bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest">Premium</span>}
                          {scan.success === false && <span className="bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest">Failed</span>}
                        </div>
                        <div className="text-[10px] font-sans text-zinc-500 uppercase tracking-widest">
                          {formatTimestamp(scan.timestamp || scan.scannedAt || scan.createdAt)}
                        </div>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleDeleteScan(scan.id)}
                      className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                      title="Delete Scan & Image"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

const HomePage = ({ setCurrentPage }) => {
  const [analysisHeroCount, setAnalysisHeroCount] = useState(74);
  const [activeUsers, setActiveUsers] = useState(106);

  useEffect(() => {
    // Initial active users (analysis count + 32)
    setActiveUsers(analysisHeroCount + 32);

    // Fluctuate by ~3 every minute
    const interval = setInterval(() => {
      setActiveUsers(prev => {
        const change = Math.floor(Math.random() * 7) - 3; // Random between -3 and +3
        return Math.max(1, prev + change); // Ensure it doesn't go below 1
      });
    }, 60000); // 1 minute

    return () => clearInterval(interval);
  }, [analysisHeroCount]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/public-stats`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data.analysisCount === 'number' && data.analysisCount >= 74) {
          setAnalysisHeroCount(data.analysisCount);
        }
      } catch {
        /* keep default */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
  <div className="w-full flex flex-col items-center relative overflow-x-hidden">
    {/* Animated gradient sweep - page level, behind all content */}
    <div className="absolute inset-0 h-full pointer-events-none overflow-hidden -z-10">
      <div className="absolute top-0 left-0 w-[30%] h-full bg-gradient-to-r from-transparent via-white/[0.03] to-transparent" style={{ animation: 'sweepGlow 8s ease-in-out infinite' }} />
    </div>
    <header className="relative w-full flex flex-col items-center pt-[25vh] pb-32 text-center px-6 overflow-x-hidden overflow-y-visible">
      <div className="absolute inset-0 bg-radial-gradient from-white/5 to-transparent -z-10 opacity-30" />
      
      {/* Extracted Video: Placed directly in the header to avoid FadeUp's stacking context which breaks mix-blend-screen */}
      <div
        className="pointer-events-none absolute left-1/2 top-[18vh] z-0 w-[min(118vw,1040px)] h-[min(82vh,760px)] origin-center -translate-x-1/2 -translate-y-[22%] sm:-translate-y-[27%] md:-translate-y-[32%] overflow-visible scale-[0.81] mix-blend-screen"
        style={{ mixBlendMode: 'screen' }}
        aria-hidden
      >
        <video 
          autoPlay 
          loop 
          muted 
          playsInline 
          className="w-full h-full object-contain object-center opacity-[0.92]"
          style={{ filter: 'contrast(1.08)' }}
          src="/FaceANimationforwebsite.webm" 
        />
      </div>

      {/* Animated gradient sweep */}
      <style>{`
        @keyframes sweepGlow {
          0% { transform: translateX(-100%) rotate(-45deg); }
          100% { transform: translateX(200%) rotate(-45deg); }
        }
        @keyframes ctaPulse {
          0%, 100% { box-shadow: 0 0 20px rgba(255,255,255,0.2); }
          50% { box-shadow: 0 0 40px rgba(255,255,255,0.4), 0 0 80px rgba(255,255,255,0.1); }
        }
      `}</style>

      <FadeUp>
        <div className="relative flex flex-col items-center w-full max-w-6xl mx-auto">
          {/* Wireframe only behind the headline â€” flow continues at divider / CTA */}
          <div className="relative w-full flex justify-center px-4 mb-6 md:mb-10">
            {/* Mesh: absolute overlay only â€” height comes from headline text, not from the SVG */}
            <div className="relative w-fit max-w-full py-2 md:py-4">
              <div className="relative z-10 flex flex-col items-center">
                
                {/* Active Users Badge */}
                <div className="flex items-center gap-2 mb-2 bg-zinc-900/50 border border-zinc-800 backdrop-blur-md px-3 py-1.5 rounded-full shadow-[0_0_15px_rgba(0,0,0,0.5)]">
                  <div className="relative flex items-center justify-center w-2 h-2">
                    <div className="absolute w-full h-full bg-green-500 rounded-full animate-ping opacity-75"></div>
                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.8)]"></div>
                  </div>
                  <span className="font-sans font-bold text-xs uppercase tracking-widest text-zinc-300">
                    <span className="text-white mr-1 tabular-nums">{activeUsers}</span>Users Online
                  </span>
                </div>

                {/* Analysis Count Badge */}
                <div
                  className="mb-1 md:mb-2 pointer-events-none select-none flex items-center gap-2 text-base md:text-lg font-sans uppercase tracking-[0.18em] text-white bg-zinc-900/50 border border-zinc-800 backdrop-blur-md px-4 py-1.5 rounded-full shadow-[0_0_15px_rgba(0,0,0,0.5)]"
                  aria-label={`${analysisHeroCount} analyses completed`}
                >
                  <div className="relative flex items-center justify-center w-2.5 h-2.5 mr-1">
                    <div className="absolute w-full h-full bg-cyan-500 rounded-full animate-ping opacity-75" style={{ animationDuration: '2s' }}></div>
                    <div className="w-2 h-2 bg-cyan-400 rounded-full shadow-[0_0_8px_rgba(34,211,238,0.8)]"></div>
                  </div>
                  <span className="font-black italic tabular-nums">{analysisHeroCount}</span>
                  <span className="font-bold">Analyses</span>
                </div>

                <h1
                  className="text-6xl md:text-[140px] italic uppercase leading-[0.82] overflow-visible px-0 [-webkit-font-smoothing:antialiased] font-extrabold tracking-[-0.03em] md:tracking-[-0.04em] [font-variation-settings:'wght'_800]"
                  style={{
                    filter:
                      'drop-shadow(0 0 12px rgba(255,255,255,0.26)) drop-shadow(0 0 28px rgba(255,255,255,0.16)) drop-shadow(0 0 56px rgba(255,255,255,0.09)) drop-shadow(0 3px 5px rgba(0,0,0,0.72)) drop-shadow(0 8px 14px rgba(0,0,0,0.58)) drop-shadow(0 16px 32px rgba(0,0,0,0.42))',
                  }}
                >
                  <span className="block text-center bg-clip-text text-transparent bg-[linear-gradient(180deg,#fff_0%,#e4e4e7_26%,#a1a1aa_55%,#52525b_100%)]">YOUR LOOKS</span>
                  <span className="block text-center w-full mt-1 md:mt-2 bg-clip-text text-transparent bg-[linear-gradient(180deg,#fff_0%,#e4e4e7_24%,#a1a1aa_52%,#3f3f46_100%)]">MATTER</span>
                </h1>
              </div>
            </div>
          </div>

          <div className="w-16 h-[1px] bg-gradient-to-r from-transparent via-zinc-500 to-transparent mb-5" />
          <p className="text-zinc-300 font-sans text-sm md:text-base uppercase tracking-[0.3em] mb-14 font-bold">Powered by AI - track your looks with MogCheck</p>
          <button onClick={() => setCurrentPage('login')} className="mx-auto group relative px-12 py-5 bg-white text-black font-black uppercase tracking-tighter text-lg flex items-center gap-5 hover:scale-110 transition-all duration-300 rounded-sm" style={{ animation: 'ctaPulse 3s ease-in-out infinite' }}>
            <span className="tracking-widest">TRY FOR FREE</span>
            <div className="flex items-center"><div className="h-[2px] w-10 bg-black" /><div className="rotate-45 w-4 h-4 bg-black -ml-2" /></div>
          </button>
        </div>
      </FadeUp>
    </header>

    <section id="results-section" className="w-full pt-24 pb-16 px-6 max-w-7xl mx-auto border-t border-zinc-900 relative z-10">
      <FadeUp>
        <div className="text-center mb-20">
          <span className="text-blue-500 font-sans text-[10px] uppercase tracking-[0.3em] block mb-4 font-bold drop-shadow-[0_0_10px_rgba(59,130,246,0.6)]">REAL RESULTS</span>
          <h2 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-4 uppercase italic [font-weight:950] drop-shadow-none [text-shadow:none]">Make The Impossible, Possible.</h2>
          <p className="text-zinc-400 font-sans text-sm max-w-2xl mx-auto uppercase tracking-widest">Join the many who cracked the aesthetic code</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-center">
          <ComparisonCard beforeImgSrc={compBefore1} afterImgSrc={compAfter1} beforeScore="4.8" afterScore="7.4" review={reviewsData[0]} />
          <ComparisonCard beforeImgSrc={compBefore2} afterImgSrc={compAfter2} beforeScore="5.2" afterScore="8.5" isActive={true} review={reviewsData[2]} />
          <ComparisonCard beforeImgSrc={compAfter3} afterImgSrc={compBefore3} beforeScore="4.5" afterScore="7.1" review={reviewsData[1]} />
        </div>
      </FadeUp>
    </section>

    <section className="w-full pt-16 pb-16 px-6 max-w-5xl mx-auto relative z-0">
      <FadeUp>

        <BodyFatSlider />
      </FadeUp>
    </section>

    <section className="w-full pt-16 pb-32 px-6 bg-[#0c0d0e]">
      <FadeUp><div className="text-center mb-16"><h2 className="text-4xl md:text-5xl font-black italic uppercase tracking-tighter text-white mb-4">What Actually Matters</h2><p className="text-zinc-500 font-sans text-[10px] uppercase tracking-widest">Forget the trends. Follow the metrics.</p></div></FadeUp>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-10 w-full max-w-5xl mx-auto">{measureItems.map((item, idx) => (<FadeUp key={idx} delay={idx * 150}><SpotlightImageCard item={item} /></FadeUp>))}</div>
    </section>

    <section className="w-full py-32 px-6 max-w-5xl mx-auto border-t border-zinc-900">
      <FadeUp>
        <h2 className="text-4xl font-black italic uppercase tracking-tighter text-white mb-20 text-center">Backed by Research</h2>
        <div className="space-y-6">
          {researchItems.map((item, idx) => (
            <a key={idx} href={item.url} target="_blank" rel="noopener noreferrer" className="flex flex-col sm:flex-row items-center justify-between p-8 rounded-2xl bg-zinc-900/20 border border-zinc-900 hover:border-zinc-700 hover:bg-zinc-900/40 transition-all group">
              <div className="flex flex-col gap-3"><div className="flex items-center gap-4 text-blue-500 group-hover:text-blue-400 transition-colors uppercase font-sans font-bold tracking-widest text-lg">{item.label} <ArrowUpRight size={20} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" /></div><span className="text-zinc-500 font-sans text-xs uppercase tracking-[0.2em]">{item.text}</span></div>
              <div className="w-32 h-40 sm:w-40 sm:h-48 bg-zinc-800 rounded-xl mt-8 sm:mt-0 overflow-hidden border border-zinc-700 shadow-2xl"><img src={item.imgSrc} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover [filter:grayscale(100%)_saturate(0)]" /></div>
            </a>
          ))}
        </div>
      </FadeUp>
    </section>

    <section className="w-full py-32 px-6 border-t border-zinc-900">
      <FadeUp>
        <div className="flex flex-col items-center gap-6">
          <h2 className="text-4xl md:text-5xl font-black italic uppercase tracking-tighter text-white text-center">Ready for MogCheck?</h2>
          <p className="text-zinc-500 font-sans text-[10px] uppercase tracking-[0.3em] mb-4">Discover your true potential today</p>
          <button onClick={() => setCurrentPage('login')} className="group relative px-12 py-5 bg-white text-black font-black uppercase tracking-tighter text-lg flex items-center gap-5 hover:scale-110 hover:shadow-[0_0_60px_rgba(255,255,255,0.8)] transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.2)] rounded-sm">
            <span className="tracking-widest">START NOW</span>
            <div className="flex items-center"><div className="h-[2px] w-10 bg-black" /><div className="rotate-45 w-4 h-4 bg-black -ml-2" /></div>
          </button>
        </div>
      </FadeUp>
    </section>
  </div>
  );
};

// --- Form Components ---
const SpotlightFormWrapper = ({ children }) => {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const handleMouseMove = (e) => { const rect = e.currentTarget.getBoundingClientRect(); setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top }); };
  return (
    <div className="relative w-[360px] md:w-[400px] flex flex-col gap-5 items-center p-8 md:p-10 rounded-3xl border border-zinc-800 bg-[#0c0d0e]/50 backdrop-blur-xl transition-colors duration-500 z-10" onMouseMove={handleMouseMove} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
      <div className="pointer-events-none absolute inset-0 -z-10 rounded-3xl transition-opacity duration-300" style={{ opacity: isHovered ? 1 : 0, background: `radial-gradient(200px circle at ${mousePos.x}px ${mousePos.y}px, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 80%)` }} />
      {children}
    </div>
  );
};

const GoogleIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>);


const LoginPage = ({ setCurrentPage, user }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (user) setCurrentPage('photo-guide'); }, [user, setCurrentPage]);

  const friendlyError = (code) => ({
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password. Try again.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Please try again later.',
    'auth/invalid-credential': 'Invalid email or password.',
  }[code] || 'Something went wrong. Please try again.');

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      await signInWithEmailAndPassword(auth, email, password);
      setCurrentPage('photo-guide');
    } catch (err) { setError(friendlyError(err.code)); } finally { setLoading(false); }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try { await signInWithPopup(auth, googleProvider); setCurrentPage('photo-guide'); } catch (e) { setError(friendlyError(e.code)); } finally { setLoading(false); }
  };

  return (
    <div className="flex-grow flex items-center justify-center px-6 py-32 relative">
      <FadeUp>
        <SpotlightFormWrapper>
          <div className="w-full flex flex-col items-center mb-6">
            <MogCheckLogoMark size={80} className="w-16 h-16 md:w-20 md:h-20 mb-5 opacity-95" />
            <h2 className="text-3xl font-black italic text-white uppercase tracking-tighter">Welcome Back</h2>
            <p className="text-zinc-500 text-[10px] uppercase font-sans tracking-widest mt-2">Resume your ascent</p>
          </div>

          {error && (
            <div className="w-full p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2 mb-2">
              <AlertCircle size={14} className="text-red-400 shrink-0" />
              <span className="text-red-400 text-xs">{error}</span>
            </div>
          )}

          <button onClick={handleGoogleLogin} disabled={loading} className="w-full py-3 mb-2 bg-zinc-900/50 border border-zinc-800 hover:bg-white hover:text-black rounded-xl flex items-center justify-center gap-2 text-white text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer disabled:opacity-50"><GoogleIcon /> {loading ? 'Signing in...' : 'Continue with Google'}</button>
          <div className="flex items-center gap-4 w-full"><div className="h-[1px] flex-1 bg-zinc-800" /><span className="text-[10px] font-sans text-zinc-600 uppercase tracking-widest">Or</span><div className="h-[1px] flex-1 bg-zinc-800" /></div>
          <form onSubmit={handleEmailLogin} className="w-full space-y-4">
            <input type="email" placeholder="Email Address" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-4 px-6 text-white text-sm outline-none focus:border-zinc-600 transition-colors" />
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-4 px-6 text-white text-sm outline-none focus:border-zinc-600 transition-colors pr-12" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <label className="flex items-center gap-3 w-full cursor-pointer group">
              <div className={`relative flex items-center justify-center w-4 h-4 border rounded transition-colors ${rememberMe ? 'bg-white border-white' : 'border-zinc-700 bg-zinc-900/50 group-hover:border-zinc-500'}`}>
                {rememberMe && <Check size={10} className="text-black" />}
              </div>
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="hidden" />
              <span className="text-[10px] text-zinc-400 uppercase font-sans tracking-widest group-hover:text-zinc-300 transition-colors select-none">Keep me logged in</span>
            </label>
            <button type="submit" disabled={loading} className="w-full py-4 bg-white text-black font-black uppercase tracking-widest italic text-sm hover:scale-[1.02] transition-transform cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
              {loading ? 'SIGNING IN...' : 'LOGIN'}
            </button>
          </form>
          <button onClick={() => setCurrentPage('register')} className="text-zinc-500 text-[10px] uppercase font-sans tracking-widest hover:text-white transition-colors cursor-pointer">No account? Create one</button>
        </SpotlightFormWrapper>
      </FadeUp>
    </div>
  );
};

const RegisterPage = ({ setCurrentPage, user }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (user) setCurrentPage('photo-guide'); }, [user, setCurrentPage]);

  const friendlyError = (code) => ({
    'auth/email-already-in-use': 'An account with this email already exists.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/operation-not-allowed': 'Email/password accounts are not enabled.',
  }[code] || 'Something went wrong. Please try again.');

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      setCurrentPage('photo-guide');
    } catch (err) { setError(friendlyError(err.code)); } finally { setLoading(false); }
  };

  const handleGoogleRegister = async () => {
    setError('');
    setLoading(true);
    try { await signInWithPopup(auth, googleProvider); setCurrentPage('photo-guide'); } catch (e) { setError(friendlyError(e.code)); } finally { setLoading(false); }
  };

  return (
    <div className="flex-grow flex items-center justify-center px-6 py-32 relative">
      <FadeUp>
        <SpotlightFormWrapper>
          <div className="w-full flex flex-col items-center mb-6">
            <MogCheckLogoMark size={80} className="w-16 h-16 md:w-20 md:h-20 mb-5 opacity-95" />
            <h2 className="text-3xl font-black italic text-white uppercase tracking-tighter">Start Now</h2>
            <p className="text-zinc-500 text-[10px] uppercase font-sans tracking-widest mt-2">Join the elite</p>
          </div>

          {error && (
            <div className="w-full p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2 mb-2">
              <AlertCircle size={14} className="text-red-400 shrink-0" />
              <span className="text-red-400 text-xs">{error}</span>
            </div>
          )}

          <button onClick={handleGoogleRegister} disabled={loading} className="w-full py-3 mb-2 bg-zinc-900/50 border border-zinc-800 hover:bg-white hover:text-black rounded-xl flex items-center justify-center gap-2 text-white text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer disabled:opacity-50"><GoogleIcon /> {loading ? 'Signing in...' : 'Continue with Google'}</button>
          <div className="flex items-center gap-4 w-full"><div className="h-[1px] flex-1 bg-zinc-800" /><span className="text-[10px] font-sans text-zinc-600 uppercase tracking-widest">Or</span><div className="h-[1px] flex-1 bg-zinc-800" /></div>
          <form onSubmit={handleRegister} className="w-full space-y-4">
            <input type="text" placeholder="Full Name" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-4 px-6 text-white text-sm outline-none focus:border-zinc-600 transition-colors" />
            <input type="email" placeholder="Email Address" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-4 px-6 text-white text-sm outline-none focus:border-zinc-600 transition-colors" />
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} placeholder="Password (min. 6 characters)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-4 px-6 text-white text-sm outline-none focus:border-zinc-600 transition-colors pr-12" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button type="submit" disabled={loading} className="w-full py-4 mt-2 bg-white text-black font-black uppercase tracking-widest italic text-sm hover:scale-[1.02] transition-transform cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
              {loading ? 'CREATING...' : 'CREATE ACCOUNT'}
            </button>
          </form>
          <button onClick={() => setCurrentPage('login')} className="text-zinc-500 text-[10px] uppercase font-sans tracking-widest hover:text-white transition-colors cursor-pointer">Already registered? Login</button>
        </SpotlightFormWrapper>
      </FadeUp>
    </div>
  );
};

// --- Photo Guide Page ---
const PhotoGuidePage = ({ setCurrentPage }) => {
  return (
    <div className="flex-grow flex flex-col items-center pt-32 pb-24 px-6 relative font-sans overflow-hidden">
      <FadeUp>
        <div className="w-full max-w-4xl bg-[#0c0d0e]/80 border border-zinc-800 rounded-2xl p-8 md:p-12 shadow-2xl backdrop-blur-xl relative z-10 mx-auto">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 via-yellow-500 to-green-500" />
          
          <div className="flex flex-col items-center gap-4 mb-6">
            <MogCheckLogoMark size={56} className="w-14 h-14 opacity-90" />
            <h2 className="text-3xl md:text-5xl font-black italic uppercase tracking-tighter text-white text-center">Take the Perfect Photo</h2>
          </div>
          
          <div className="flex items-start gap-4 bg-red-500/10 border border-red-500/30 p-5 rounded-xl mb-12 shadow-[0_0_20px_rgba(239,68,68,0.1)]">
            <span className="text-red-500 font-bold uppercase tracking-widest text-sm md:text-base mt-0.5 animate-pulse">Warning:</span>
            <p className="text-zinc-300 text-xs md:text-sm uppercase tracking-wider leading-relaxed">
              A bad photo can massively skew your stats and render the analysis completely inaccurate. Follow these instructions carefully.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-12">
            <div className="flex flex-col">
              <h3 className="text-green-500 font-black italic uppercase text-3xl tracking-tighter mb-6 drop-shadow-[0_0_10px_rgba(34,197,94,0.5)]">DO:</h3>
              <ul className="space-y-6 text-zinc-300 text-sm md:text-base tracking-wider leading-relaxed mb-8 flex-grow">
                <li><span className="text-white font-bold">1.</span> Place your phone roughly 6 feet (2 meters) away from you.</li>
                <li><span className="text-white font-bold">2.</span> Set your camera to 2x or 3x zoom and step back until your head fits the frame.</li>
                <li><span className="text-white font-bold">3.</span> Ensure the camera is exactly at eye level - not tilted up or down.</li>
              </ul>
              <img src="/guide/do-example.png" alt="Do example" className="w-full aspect-square object-cover rounded-xl border border-green-500/30 shadow-[0_0_20px_rgba(34,197,94,0.1)] grayscale opacity-80" />
            </div>

            <div className="flex flex-col">
              <h3 className="text-red-500 font-black italic uppercase text-3xl tracking-tighter mb-6 drop-shadow-[0_0_10px_rgba(239,68,68,0.5)]">DO NOT:</h3>
              <ul className="space-y-6 text-zinc-300 text-sm md:text-base tracking-wider leading-relaxed mb-8 flex-grow">
                <li><span className="text-white font-bold">1.</span> Do not take a close-up selfie by holding the phone at arm's length.</li>
                <li><span className="text-white font-bold">2.</span> Do not take a photo in dark lighting.</li>
              </ul>
              <img src="/guide/do-not-example.png" alt="Do not example" className="w-full aspect-square object-cover rounded-xl border border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.1)] grayscale opacity-80" />
            </div>
          </div>
          
          <button onClick={() => setCurrentPage('upload-photo')} className="w-full py-5 bg-white text-black font-black uppercase tracking-widest text-sm md:text-base flex items-center justify-center gap-4 hover:scale-[1.02] hover:bg-zinc-200 transition-all cursor-pointer shadow-[0_0_30px_rgba(255,255,255,0.2)] rounded-sm">
            I understand, let's go
            <ChevronRight size={20} className="text-black" />
          </button>
        </div>
      </FadeUp>
    </div>
  );
};

// --- Upload Photo Page ---
const FileDropzone = ({ label, file, setFile, isPulsing }) => {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div className="flex flex-col items-center w-full">
      <span className="text-zinc-300 font-bold text-lg md:text-xl uppercase tracking-widest mb-6 drop-shadow-md">{label}</span>
      <label 
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
          if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const f = e.dataTransfer.files[0];
            setFile(URL.createObjectURL(f), f);
          }
        }}
        className={`w-full aspect-[3/4] max-w-sm mx-auto rounded-3xl border transition-all duration-300 flex flex-col items-center justify-center cursor-pointer relative overflow-hidden group ${
          isDragging 
            ? 'border-white bg-white/10 shadow-[0_0_50px_rgba(255,255,255,0.3)] scale-[1.02]' 
            : (isPulsing && !file ? 'border-zinc-500 bg-zinc-900/40 shadow-[0_0_30px_rgba(255,255,255,0.1)] animate-pulse hover:border-zinc-400' : 'border-zinc-800 bg-zinc-900/30 backdrop-blur-md hover:border-zinc-600 hover:bg-zinc-900/50 shadow-2xl')
        }`}
      >
        <input type="file" className="hidden" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(URL.createObjectURL(f), f); }} />
        {file ? (
          <>
            <img src={file} alt={label} className="absolute inset-0 w-full h-full object-cover opacity-90 group-hover:opacity-40 transition-opacity duration-300" />
            <div 
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFile(null, null); }}
              className="absolute top-4 right-4 md:top-6 md:right-6 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20 bg-black/60 hover:bg-red-500/80 text-white rounded-full p-2 backdrop-blur-md border border-white/10 hover:border-red-500/50"
              title="Remove Image"
            >
              <X size={20} />
            </div>
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10 pointer-events-none">
              <span className="font-sans text-sm md:text-base uppercase tracking-widest text-white font-bold bg-black/50 px-4 py-2 rounded-lg backdrop-blur-sm border border-white/10">Replace Image</span>
            </div>
          </>
        ) : (
          <>
            <div className="absolute inset-4 md:inset-6 border border-dashed border-zinc-700/60 rounded-2xl opacity-50 pointer-events-none group-hover:border-zinc-500 transition-colors duration-300" />
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10 transition-transform text-zinc-500 group-hover:text-zinc-300 gap-3">
              <div className="w-12 h-12 rounded-full bg-zinc-800/50 border border-zinc-700 flex items-center justify-center group-hover:scale-110 transition-transform mb-2">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </div>
              <span className="font-sans text-sm md:text-base font-bold tracking-wide text-center leading-relaxed transition-colors">Select Image <br/> <span className="text-xs font-normal text-zinc-600 group-hover:text-zinc-400 uppercase tracking-widest mt-1 block">Or Drag & Drop</span></span>
              <span className="font-sans text-[9px] uppercase tracking-widest opacity-40 mt-2">JPG or PNG (Max 10MB)</span>
            </div>
          </>
        )}
      </label>
    </div>
  );
};

// --- Scanning Components ---
const FaceScanOverlay = ({
  landmarksData,
  revealDurationSeconds = 36,
  scanLoopSeconds = 4,
}) => {
  let mappedPoints = [];
  let mappedEdges = [];

  if (landmarksData && landmarksData !== 'fallback') {
    const { points, imgW, imgH } = landmarksData;
    
    // Instead of simple contours, generate the fully detailed face tessellation matrix
    const uniquePoints = new Set();
    const connections = [];

    if (FaceLandmarker?.FACE_LANDMARKS_TESSELATION) {
      FaceLandmarker.FACE_LANDMARKS_TESSELATION.forEach(conn => {
        uniquePoints.add(conn.start);
        uniquePoints.add(conn.end);
        connections.push([conn.start, conn.end]);
      });
    }

    const C_w = 100;
    const C_h = 133.33; // 3:4 aspect ratio
    const imgRatio = imgW / imgH;
    const containerRatio = C_w / C_h;
    
    let scaleX, scaleY, offsetX, offsetY;
    
    if (imgRatio > containerRatio) {
      scaleY = C_h;
      scaleX = C_h * imgRatio;
      offsetX = (scaleX - C_w) / 2;
      offsetY = 0;
    } else {
      scaleX = C_w;
      scaleY = C_w / imgRatio;
      offsetX = 0;
      offsetY = (scaleY - C_h) / 2;
    }

    const pointMap = new Map();

    Array.from(uniquePoints).forEach((idx) => {
      const pt = points[idx] || points[0];
      const screenX = pt.x * scaleX - offsetX;
      const screenY = pt.y * scaleY - offsetY;
      const mapped = { id: idx, x: screenX, y: screenY };
      mappedPoints.push(mapped);
      pointMap.set(idx, mapped);
    });

    mappedEdges = connections.map(([start, end]) => {
      return [pointMap.get(start), pointMap.get(end)];
    }).filter(edge => edge[0] && edge[1]);
  } else {
    // Generate fallback generic grid if mediapipe failed or hasn't loaded yet
    const cols = 22;
    const rows = 30;
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        let x = 20 + (c / cols) * 60;
        let y = 15 + (r / rows) * 95;
        let cx = 50; let cy = 55;
        let dx = x - cx; let dy = y - cy;
        let rx = 32; 
        if (y > cy) rx = 32 * (1 - ((y - cy) / 55) * 0.5);
        let ry = 48;
        if ((dx*dx)/(rx*rx) + (dy*dy)/(ry*ry) <= 1) {
           x += (Math.random() - 0.5) * 2.5;
           y += (Math.random() - 0.5) * 2.5;
           mappedPoints.push({ x, y, id: mappedPoints.length });
        }
      }
    }
    for (let i = 0; i < mappedPoints.length; i++) {
       let connections = 0;
       for (let j = i + 1; j < mappedPoints.length; j++) {
          let p1 = mappedPoints[i];
          let p2 = mappedPoints[j];
          let d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          if (d > 2 && d <= 7.5) {
             mappedEdges.push([p1, p2]);
             connections++;
             if (connections > 4) break;
          }
       }
    }
  }

  // Find min/max Y for dynamic delay mapping
  let minY = 999;
  let maxY = -999;
  mappedPoints.forEach(p => {
     if (p.y < minY) minY = p.y;
     if (p.y > maxY) maxY = p.y;
  });
  const ySpan = Math.max(1, maxY - minY);

  const revealWindowSeconds = Math.max(8, Number(revealDurationSeconds) || 36);
  const buildWindowSeconds = Math.min(revealWindowSeconds, 14);
  const dashWindowSeconds = Math.max(4.8, buildWindowSeconds - 1.4);
  const scanSeconds = Math.max(2.8, Number(scanLoopSeconds) || 4);

  return (
    <div className="absolute inset-0 z-20 overflow-hidden" style={{ perspective: '1000px' }}>
      <svg viewBox="0 0 100 133.33" className="w-full h-full drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]" preserveAspectRatio="xMidYMid slice">
        {mappedEdges.map((edge, i) => {
          const length = Math.sqrt(Math.pow(edge[1].x - edge[0].x, 2) + Math.pow(edge[1].y - edge[0].y, 2));
          const avgY = (edge[0].y + edge[1].y) / 2;
          const normY = Math.max(0, Math.min(1, (maxY - avgY) / ySpan)); // 0 at chin, 1 at forehead
          const delay = normY * dashWindowSeconds + 1.2 + Math.random() * 1.2;
          return (
            <line 
              key={`e${i}`} x1={edge[0].x} y1={edge[0].y} x2={edge[1].x} y2={edge[1].y} 
              stroke="rgba(34, 211, 238, 0.45)" strokeWidth="0.2"
              strokeDasharray={length} strokeDashoffset={length}
              style={{ animation: `dash 0.82s cubic-bezier(0.22, 1, 0.36, 1) forwards ${delay}s, meshPulse 3.1s ease-in-out infinite ${delay + 0.82}s` }}
            />
          );
        })}
        {mappedPoints.map((pt, i) => {
          const normY = Math.max(0, Math.min(1, (maxY - pt.y) / ySpan)); 
          const delay = normY * dashWindowSeconds + Math.random() * 0.45;
          return (
            <circle
              key={'p'+i}
              cx={pt.x}
              cy={pt.y}
              r="0.4"
              fill="#67e8f9"
              className="opacity-0"
              style={{ animation: `fadeIn 0.28s ease-out forwards ${delay}s, pointPulse 2.8s ease-in-out infinite ${delay + 0.28}s` }}
            />
          );
        })}
        {/* Scanning crosshairs */}
        <path d="M 0 15 L 5 15 M 0 118 L 5 118 M 95 15 L 100 15 M 95 118 L 100 118" stroke="rgba(34, 211, 238, 0.8)" strokeWidth="0.5" />
      </svg>
      {/* Scanner laser lines */}
      <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#22d3ee] to-transparent shadow-[0_0_15px_rgba(34,211,238,1)]" style={{ animation: `scan ${scanSeconds}s linear infinite` }} />
      <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-[#22d3ee]/20 to-transparent" style={{ animation: `scan ${scanSeconds}s linear infinite` }} />
    </div>
  );
};

/** mainImageSrc: front preview URL; mainImageFile: native File for reliable FormData uploads */
const ScanningView = ({
  mainImageSrc,
  mainImageFile,
  sideImageUrl,
  sideImageFile,
  sideMetricData,
  choice,
  onComplete,
  onScanFailed,
  user,
  profileId,
}) => {
  const [statusText, setStatusText] = useState('Connecting to Backend Bridge...');
  const [videoUrl, setVideoUrl] = useState(null);
  const [landmarks, setLandmarks] = useState(null);
  const [hasError, setHasError] = useState(false);
  const isUltra31 = choice === "1";
  const overlayRevealSeconds = isUltra31 ? 75 : choice === "2" ? 24 : 36;
  const overlayScanLoopSeconds = isUltra31 ? 6.75 : choice === "2" ? 4.5 : 4;

  /** Parent passes an inline onComplete; keep a ref so the analyze effect does not re-run every render (duplicate requests). */
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onScanFailedRef = useRef(onScanFailed);
  onScanFailedRef.current = onScanFailed;

  useEffect(() => {
    let active = true;

    const initDetector = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU"
          },
          outputFaceBlendshapes: false,
          runningMode: "IMAGE",
          numFaces: 1
        });
        
        const img = new Image();
        img.src = mainImageSrc;
        img.onload = () => {
          if (!active) return;
          const result = faceLandmarker.detect(img);
          if (result.faceLandmarks && result.faceLandmarks.length > 0) {
            setLandmarks({
              points: result.faceLandmarks[0],
              imgW: img.naturalWidth,
              imgH: img.naturalHeight
            });
          }
        };
      } catch (err) {
        console.error("MediaPipe failed", err);
      }
    };
    initDetector();

    const startScan = async () => {
      const minScanMs = 3200;
      const scanStartedAt = Date.now();
      let scanSucceeded = false;
      try {
        const isUltra = choice === "1" || choice === "2";

        setStatusText("Checking analysis server...");
        try {
          const healthCtrl = new AbortController();
          const healthTimer = setTimeout(() => healthCtrl.abort(), 8000);
          const healthRes = await fetch(`${API_BASE}/api/health`, { signal: healthCtrl.signal });
          clearTimeout(healthTimer);
          if (!healthRes.ok) {
            setStatusText(
              `Analysis server returned ${healthRes.status}. Check VITE_API_URL (currently ${API_BASE}) and that the backend is running.`
            );
            setHasError(true);
            return;
          }
        } catch (e) {
          console.error("API health check failed", e);
          setStatusText(
            `Can't reach the analysis server at ${API_BASE}. If you're on the live site, set VITE_API_URL to your tunnel URL and redeploy. Locally, run npm run dev and keep the backend terminal open.`
          );
          setHasError(true);
          return;
        }

        if (isUltra && !user) {
          setStatusText('Sign in required for Ultra / Fun mode scans. Use Basic scan while signed out, or log in and try again.');
          setHasError(true);
          return;
        }

        let authToken = null;
        if (isUltra) {
          setStatusText("Checking premium access...");
          try {
            const readyCtrl = new AbortController();
            const readyTimer = setTimeout(() => readyCtrl.abort(), 8000);
            const readyRes = await fetch(`${API_BASE}/api/ready`, { signal: readyCtrl.signal });
            clearTimeout(readyTimer);

            let readyData = null;
            try {
              readyData = await readyRes.json();
            } catch (e) {
              readyData = null;
            }

            if (!readyRes.ok || readyData?.ok === false) {
              const readyError =
                (readyData && typeof readyData.error === 'string' && readyData.error.trim()) ||
                'Premium scans are unavailable because the backend Firebase connection is not ready.';
              setStatusText(readyError);
              setHasError(true);
              return;
            }
          } catch (e) {
            console.error("Premium preflight failed", e);
            setStatusText(
              `Can't verify premium access on ${API_BASE}. If you're using mogcheck.net with your PC backend, make sure the tunnel is up and Firebase Admin is configured on this machine.`
            );
            setHasError(true);
            return;
          }

          try {
            authToken = await user.getIdToken(true);
          } catch (e) {
            console.error("Failed to refresh auth token", e);
            setStatusText('Your session could not be refreshed. Sign out and sign back in, then try the premium scan again.');
            setHasError(true);
            return;
          }
        }

        setStatusText("Uploading image to secure AI server...");

        const formData = new FormData();
        if (mainImageFile instanceof File) {
          formData.append('image', mainImageFile, mainImageFile.name || 'upload.jpg');
        } else {
          const response = await fetch(mainImageSrc);
          const blob = await response.blob();
          formData.append('image', blob, 'upload.jpg');
        }
        formData.append('choice', choice || "3");
        if (profileId) formData.append('profileId', profileId);

        if (isUltra && (sideImageUrl || sideImageFile)) {
          if (sideImageFile instanceof File) {
            formData.append('sideImage', sideImageFile, sideImageFile.name || 'side.jpg');
          } else if (sideImageUrl) {
            const sideResponse = await fetch(sideImageUrl);
            const sideBlob = await sideResponse.blob();
            formData.append('sideImage', sideBlob, 'side.jpg');
          }
        }

        setStatusText('Running AI analysis... 0:00 elapsed. Leave this tab open.');

        const headers = {};
        if (authToken) {
          headers.Authorization = `Bearer ${authToken}`;
        }

        /** So the UI never sits on “Consulting AI” forever if Python/API hangs */
        const analyzeAbort = new AbortController();
        const ANALYZE_CLIENT_MAX_MS = 10 * 60 * 1000;
        const analyzeHardStop = setTimeout(() => analyzeAbort.abort(), ANALYZE_CLIENT_MAX_MS);

        const formatElapsed = () => {
          const sec = Math.floor((Date.now() - scanStartedAt) / 1000);
          const m = Math.floor(sec / 60);
          const s = sec % 60;
          return `${m}:${String(s).padStart(2, '0')}`;
        };

        const progressTick = setInterval(() => {
          if (!active) return;
            setStatusText(
              `Running AI analysis... ${formatElapsed()} elapsed. Ultra scans can take a few minutes.`
            );
        }, 4000);

        const runAnalyzeRequest = async (attempt = 1) => {
          try {
            return await fetch(`${API_BASE}/api/analyze`, {
              method: "POST",
              headers,
              body: formData,
              signal: analyzeAbort.signal,
            });
          } catch (networkErr) {
            if (networkErr?.name === 'AbortError' || attempt >= 2) {
              throw networkErr;
            }
            console.warn(`[analyze] network failure on attempt ${attempt}, retrying`, networkErr);
            if (active) {
              setStatusText('Network hiccup detected. Retrying the analysis request...');
            }
            await new Promise((resolve) => setTimeout(resolve, 1200));
            return runAnalyzeRequest(attempt + 1);
          }
        };

        let apiRes;
        try {
          apiRes = await runAnalyzeRequest();
        } finally {
          clearTimeout(analyzeHardStop);
          clearInterval(progressTick);
        }

        if (!active) return;
        let data;
        try {
          data = await apiRes.json();
        } catch (parseErr) {
          console.error("Analyze response not JSON", parseErr);
          setStatusText(GENERIC_ERROR);
          setHasError(true);
          return;
        }

        if (!apiRes.ok) {
          const msg =
            (data && typeof data.error === 'string' && data.error.trim()) ||
            (data && typeof data.message === 'string' && data.message.trim()) ||
            null;
          setStatusText(
            msg ||
              `Request failed (${apiRes.status}). ${isUltra ? 'For premium models, confirm you are signed in with Pro or a scan credit.' : ''} If this persists, check the backend logs.`
          );
          setHasError(true);
          return;
        }

        const elapsed = Date.now() - scanStartedAt;
        if (elapsed < minScanMs) {
          await new Promise((r) => setTimeout(r, minScanMs - elapsed));
        }
        if (!active) return;
        
        if (data.success) {
           scanSucceeded = true;
           setStatusText("Analysis Complete! Transitioning...");
           setVideoUrl(data.videoUrl);
           if (active) onCompleteRef.current(data);
        } else {
           console.error('[analyze] success=false', data?.error || data);
           const detail =
             typeof data?.error === 'string' && data.error.trim()
               ? data.error
               : 'The AI engine did not return a valid analysis. Please try again in a moment.';
           setStatusText(detail);
           setHasError(true);
        }
      } catch (err) {
        console.error("API failed", err);
        setStatusText(
          err?.name === 'AbortError'
            ? 'Analysis timed out after about 10 minutes. Please try again with a smaller image or try again in a moment.'
            : `Network error: ${err?.message || 'failed to reach server'}. Please try again in a moment.`
        );
        setHasError(true);
      } finally {
        // Remove automatic exit so the user can read the error!
        // if (!scanSucceeded && active) {
        //   onScanFailedRef.current?.();
        // }
      }
    };

    startScan();

    return () => { active = false; };
  }, [mainImageSrc, mainImageFile, sideImageUrl, sideImageFile, sideMetricData, choice, user, profileId]);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center animate-[fadeIn_0.5s_ease-out]">
      <style>{`
        @keyframes scan {
          0% { transform: translateY(-120px); opacity: 0.24; }
          8% { opacity: 1; }
          92% { opacity: 1; }
          100% { transform: translateY(620px); opacity: 0.24; }
        }
        @keyframes dash { to { stroke-dashoffset: 0; } }
        @keyframes fadeIn { to { opacity: 1; } }
        @keyframes meshPulse {
          0%, 100% { stroke-opacity: 0.42; }
          50% { stroke-opacity: 0.7; }
        }
        @keyframes pointPulse {
          0%, 100% { opacity: 0.55; filter: drop-shadow(0 0 0 rgba(34,211,238,0)); }
          50% { opacity: 1; filter: drop-shadow(0 0 4px rgba(34,211,238,0.75)); }
        }
      `}</style>
      <div className="text-center mb-10 mt-10">
        <h2 className="text-3xl md:text-5xl font-black italic uppercase tracking-tighter text-cyan-400 mb-2 drop-shadow-[0_0_15px_rgba(34,211,238,0.5)] animate-pulse">Consulting AI</h2>
        <p
          className={`font-sans text-zinc-400 text-sm ${
            statusText.length > 50 || /API offline|Can't reach|Error:|Invalid response|Sign in required/i.test(statusText)
              ? 'normal-case tracking-normal max-w-lg mx-auto px-4 leading-relaxed'
              : 'uppercase tracking-[0.3em]'
          }`}
        >
          {statusText}
        </p>
      </div>

      <div className="relative aspect-[3/4] w-full max-w-md mx-auto bg-zinc-900 border border-cyan-500/50 rounded-3xl overflow-hidden shadow-[0_0_60px_rgba(34,211,238,0.2)] scale-[1.02] transform-gpu">
        {videoUrl ? (
           <video src={videoUrl} autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover z-10" />
        ) : (
           <>
             <img src={mainImageSrc} alt="Scan target" className="absolute inset-0 w-full h-full object-cover filter contrast-125 brightness-90 saturate-50 grayscale-[20%] z-0" />
             <div className="absolute inset-0 bg-blue-900/30 mix-blend-overlay z-0" />
           </>
        )}
        
        {!videoUrl && (
          <FaceScanOverlay
            landmarksData={landmarks}
            revealDurationSeconds={overlayRevealSeconds}
            scanLoopSeconds={overlayScanLoopSeconds}
          />
        )}

        <div className="absolute top-6 left-6 w-8 h-8 border-t-2 border-l-2 border-cyan-500/80 z-30" />
        <div className="absolute top-6 right-6 w-8 h-8 border-t-2 border-r-2 border-cyan-500/80 z-30" />
        <div className="absolute bottom-6 left-6 w-8 h-8 border-b-2 border-l-2 border-cyan-500/80 z-30" />
        <div className="absolute bottom-6 right-6 w-8 h-8 border-b-2 border-r-2 border-cyan-500/80 z-30" />
      </div>

      {hasError && (
        <button
          onClick={() => onScanFailedRef.current?.()}
          className="mt-8 px-8 py-3 rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300 font-bold uppercase tracking-widest text-xs hover:bg-zinc-800 hover:text-white transition-colors"
        >
          Go Back
        </button>
      )}
    </div>
  );
};


// --- Upload Photo Page ---
const UploadPhotoPage = ({ setCurrentPage, setDashboardData, setSelectedCelebrity, user, userPlan, initialModel = "3", isLockedToUltra = false, initialProfileId = null }) => {
  const [frontImage, setFrontImage] = useState(null);
  const [frontFile, setFrontFile] = useState(null);
  const [sideImage, setSideImage] = useState(null);
  const [sideFile, setSideFile] = useState(null);
  const [selectedModel, setSelectedModel] = useState(initialModel);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [dropdownAnimOpen, setDropdownAnimOpen] = useState(false);
  const [justUnlocked, setJustUnlocked] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanningCeleb, setScanningCeleb] = useState(null);
  const modelMenuRef = useRef(null);
  const scanTopRef = useRef(null);

  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(initialProfileId || 'new');
  const [newProfileName, setNewProfileName] = useState('');
  const [profilesUnavailable, setProfilesUnavailable] = useState(false);

  useEffect(() => {
    const fetchProfiles = async () => {
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const res = await fetch(`${API_BASE}/api/user/profiles`, {
          headers: { Authorization: `Bearer ${token}` }
        });
          if (res.ok) {
            const data = await res.json();
            const fetchedProfiles = data.profiles || [];
            setProfilesUnavailable(Boolean(data.profilesUnavailable));
            setProfiles(fetchedProfiles);
            if (initialProfileId && fetchedProfiles.some((p) => p.id === initialProfileId)) {
              setSelectedProfileId(initialProfileId);
            } else if (fetchedProfiles.length > 0) {
              setSelectedProfileId((prev) =>
                fetchedProfiles.some((p) => p.id === prev) ? prev : fetchedProfiles[0].id
              );
            } else {
              setSelectedProfileId('new');
            }
        } else {
          // 401 = token not accepted by server; 503 = Firestore off — avoid invalid <select> value
          setProfiles([]);
          setProfilesUnavailable(false);
          setSelectedProfileId('new');
          if (res.status !== 401 && res.status !== 503) {
            console.warn('fetch profiles HTTP', res.status);
          }
        }
      } catch (e) {
        console.error('Failed to fetch profiles', e);
        setProfilesUnavailable(false);
        setSelectedProfileId('new');
      }
    };
    fetchProfiles();
  }, [user, initialProfileId]);

  const models = [
    {
      id: "1",
      name: "Premium - highest quality",
      description:
        "Our most powerful analysis engine. Provides the highest level of accuracy and detail, though processing may take longer.",
      tier: "ultra",
      Icon: Crown
    },
    {
      id: "2",
      name: "Fun mode",
      description:
        "Faster, lighter analysis for quick entertainment. Results can be inaccurate - don't treat scores as medical or professional advice.",
      tier: "ultra",
      Icon: Zap
    },
    { id: "separator" },
    {
      id: "3",
      name: "OPTIC (Balance & Alignment)",
      description:
        "Specialized in Balance and Alignment. Best for assessing facial symmetry and structural equilibrium.",
      tier: "standard",
      Icon: Target
    },
    {
      id: "4",
      name: "CORE (Objective Attractiveness)",
      description:
        "Specialized in Objective Attractiveness. Analyzes sexual dimorphism and mass-market aesthetic appeal.",
      tier: "standard",
      Icon: Activity
    },
    {
      id: "5",
      name: "GENEVA (Mathematical Beauty)",
      description:
        "Specialized in Mathematical Beauty. Evaluates the face through the lens of the Golden Ratio and geometric vectors.",
      tier: "standard",
      Icon: Shield
    }
  ];

  const isUltraModel = selectedModel === "1" || selectedModel === "2";

  // Check if current user is an admin by email domain or specific email
  const isAdmin = user?.email && (
    user.email === 'laithbu07@gmail.com' || 
    user.email === 'admin@looksmaxxing.com' ||
    user.email === 'serenity.eyb@gmail.com' ||
    user.email.endsWith('@looksmaxxing.com')
  );

  const planResolved = !user || userPlan?.loaded !== false;
  const ultraAccessPending = !!user && !isAdmin && !planResolved;
  const canUseUltra =
    !!user &&
    (isAdmin ||
      (planResolved &&
        (userPlan?.plan === 'pro' ||
          (userPlan?.plan === 'single_scan' && (userPlan?.scanCredits ?? 0) > 0))));

  useEffect(() => {
    if (ultraAccessPending) return;
    if (!canUseUltra && (selectedModel === '1' || selectedModel === '2')) {
      setSelectedModel('3');
    }
  }, [canUseUltra, selectedModel, ultraAccessPending]);

  useEffect(() => {
    if (!isUltraModel) {
      setSideImage(null);
      setSideFile(null);
    }
  }, [isUltraModel]);

  useEffect(() => {
    const bothReady = isUltraModel ? (frontImage && sideImage) : frontImage;
    if (bothReady) {
      setJustUnlocked(true);
      const timer = setTimeout(() => setJustUnlocked(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [frontImage, sideImage, isUltraModel]);

  useEffect(() => {
    if (!isModelMenuOpen) return;
    const onPointerDown = (e) => {
      const el = modelMenuRef.current;
      if (!el) return;
      if (!el.contains(e.target)) setIsModelMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [isModelMenuOpen]);

  useEffect(() => {
    if (!isModelMenuOpen) {
      setDropdownAnimOpen(false);
      return;
    }
    let raf1 = 0;
    let raf2 = 0;
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => setDropdownAnimOpen(true));
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [isModelMenuOpen]);

  useEffect(() => {
    setSelectedModel(initialModel);
  }, [initialModel]);

  useEffect(() => {
    setSelectedProfileId(initialProfileId || 'new');
  }, [initialProfileId]);

  useEffect(() => {
    if (!isScanning) return undefined;
    const id = window.setTimeout(() => {
      scanTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => clearTimeout(id);
  }, [isScanning]);

  if (isScanning) {
    return (
      <div ref={scanTopRef} className="flex-grow flex flex-col bg-[#0c0d0e] scroll-mt-20">
        {scanningCeleb ? (
          <CelebrityStatsPage celeb={scanningCeleb} setCurrentPage={() => setScanningCeleb(null)} />
        ) : (
          <>
            <div className="flex flex-col items-center pt-24 pb-16 px-6 lg:px-12 relative min-h-screen">
              <ScanningView 
                 mainImageSrc={frontImage}
                 mainImageFile={frontFile}
                 sideImageUrl={sideImage}
                 sideImageFile={sideFile}
                 sideMetricData={sideMetricDataGlobal} 
                 choice={selectedModel}
                 user={user}
                 profileId={selectedProfileId}
                 onScanFailed={() => setIsScanning(false)}
                 onComplete={(data) => {
                    setScanningCeleb(null);
                    setIsScanning(false);
                    setDashboardData(prev => {
                      const newScanHistory = prev?.scanHistory ? [...prev.scanHistory] : [];
                      const newRatingHistory = prev?.ratingHistory ? [...prev.ratingHistory] : [];
                      
                      if (prev && prev.frontImage && prev.finalRating && newScanHistory.length === 0) {
                         newScanHistory.push({
                           ...prev,
                           scannedAt: prev.scannedAt || new Date().toISOString(),
                         });
                      }
                      if (prev && prev.finalRating && newRatingHistory.length === 0) {
                         newRatingHistory.push(prev.finalRating);
                      }

                      if (data.finalRating) {
                        newScanHistory.push({
                           ...data,
                           frontImage,
                           sideImage,
                           selectedModel,
                           scannedAt: new Date().toISOString(),
                         });
                        newRatingHistory.push(data.finalRating);
                      }

                      return {
                        ...data,
                        frontImage,
                        sideImage,
                        selectedModel,
                        scanHistory: newScanHistory,
                        ratingHistory: newRatingHistory
                      };
                    });
                    setCurrentPage('dashboard');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                 }} 
              />
              <div className="mt-16 flex flex-col items-center gap-3 animate-bounce cursor-pointer hover:scale-105 transition-transform" onClick={() => window.scrollBy({ top: 600, behavior: 'smooth' })}>
                <div className="bg-cyan-500/10 border border-cyan-500/30 px-6 py-2 rounded-full shadow-[0_0_15px_rgba(34,211,238,0.2)]">
                  <span className="text-cyan-400 font-bold font-sans text-xs uppercase tracking-[0.3em]">Scroll down while you wait</span>
                </div>
                <ChevronRight size={24} className="text-cyan-400 rotate-90 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
              </div>
            </div>
            <div className="border-t border-zinc-800/50">
              <CelebrityRatingPage setCurrentPage={() => {}} setSelectedCelebrity={setScanningCeleb} />
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex-grow flex flex-col items-center pt-40 md:pt-48 pb-48 md:pb-72 px-6 lg:px-12 relative overflow-x-hidden bg-[#111214]">
      <style>{`
        @keyframes sweepGlow {
          0% { transform: translateX(-150%) skewX(-15deg); }
          100% { transform: translateX(150%) skewX(-15deg); }
        }
        @keyframes popOpen {
          0% { transform: scale(0.8) translateY(5px); opacity: 0; }
          50% { transform: scale(1.2) translateY(-2px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes buttonUnlock {
          0%, 100% { box-shadow: 0 0 30px rgba(255,255,255,0.2); }
          50% { box-shadow: 0 0 60px rgba(255,255,255,0.6); }
        }
        @keyframes premiumShine {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
      `}</style>
      <FadeUp>
        <div className="w-full max-w-[1200px] flex flex-col items-center outline-none">
          <h2 className="text-4xl md:text-6xl font-black italic uppercase tracking-tighter text-white mb-16 text-center drop-shadow-2xl">Upload Photo</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-24 w-full mb-16 px-4">
            <FileDropzone label="Front Profile" file={frontImage} setFile={(url, f) => { setFrontImage(url); setFrontFile(f ?? null); }} isPulsing={(isUltraModel ? sideImage : false) && !frontImage} />
            <div className="relative">
              <div className={!isUltraModel ? 'blur-[6px] pointer-events-none select-none' : ''}>
                <FileDropzone label="Side Profile" file={sideImage} setFile={(url, f) => { setSideImage(url); setSideFile(f ?? null); }} isPulsing={isUltraModel && frontImage && !sideImage} />
              </div>
              {!isUltraModel && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none translate-y-8 px-6 text-center">
                  <Lock size={24} className="text-yellow-500 mb-2 drop-shadow-[0_0_10px_rgba(234,179,8,0.5)]" />
                  <span className="text-yellow-400 font-black italic uppercase tracking-widest text-xs">Premium only</span>
                  <span className="text-zinc-500 font-sans text-[9px] uppercase tracking-[0.28em] mt-2 leading-[1.7] max-w-[220px]">
                    Side profile requires
                    <br />
                    a premium model
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </FadeUp>

      {/* Dropdown + CTA outside FadeUp: parent transform/opacity was compositing away child motion */}
      <div className="w-full max-w-[1200px] flex flex-col items-center outline-none">
          <div className="w-full max-w-sm mb-12">
            <label className="block text-zinc-500 font-sans text-[10px] uppercase tracking-[0.3em] mb-3 text-center">AI Model Selection</label>
            <div ref={modelMenuRef} className="relative">
              {(() => {
                const active = models.find((m) => m.id === selectedModel);
                const ActiveIcon = active?.Icon;
                const isUltra = active?.tier === 'ultra';
                return (
                  <button
                    type="button"
                    onClick={() => { if (!isLockedToUltra) setIsModelMenuOpen((v) => !v); }}
                    className={[
                      "w-full flex items-center justify-between gap-4 rounded-xl py-4 px-5 text-sm outline-none transition-all",
                      isLockedToUltra ? "cursor-default" : "cursor-pointer",
                      "border bg-zinc-900/50 hover:bg-zinc-900/80 focus:border-zinc-500",
                      isUltra ? "border-yellow-500/40 shadow-[0_0_28px_rgba(234,179,8,0.14)]" : "border-zinc-800"
                    ].join(' ')}
                    aria-haspopup={isLockedToUltra ? undefined : "listbox"}
                    aria-expanded={isLockedToUltra ? undefined : isModelMenuOpen}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <span
                        className={[
                          "relative inline-flex items-center justify-center w-8 h-8 rounded-lg border shrink-0",
                          isUltra ? "border-yellow-500/30 bg-yellow-500/10" : "border-zinc-800 bg-zinc-900/50"
                        ].join(' ')}
                      >
                        {ActiveIcon ? (
                          <ActiveIcon
                            size={16}
                            className={isUltra ? "text-yellow-300 drop-shadow-[0_0_10px_rgba(250,204,21,0.35)]" : "text-zinc-300"}
                          />
                        ) : (
                          <MogCheckLogoIcon size={16} className="opacity-90" />
                        )}
                        {isUltra && (
                          <span
                            className="absolute inset-0 rounded-lg opacity-60"
                            style={{
                              backgroundImage:
                                "linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(250,204,21,0.25) 35%, rgba(255,255,255,0.22) 50%, rgba(250,204,21,0.25) 65%, rgba(0,0,0,0) 100%)",
                              backgroundSize: "200% 100%",
                              animation: "premiumShine 2.4s linear infinite"
                            }}
                          />
                        )}
                      </span>
                      <span className="flex flex-col min-w-0 text-left">
                        <span
                          className={[
                            "font-black uppercase tracking-widest truncate",
                            isUltra
                              ? "text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 via-yellow-100 to-amber-300 drop-shadow-[0_0_16px_rgba(250,204,21,0.12)]"
                              : "text-white"
                          ].join(' ')}
                        >
                          {active?.name ?? "Select a model"}
                        </span>
                        <span className="text-[10px] font-sans uppercase tracking-[0.22em] text-zinc-500 truncate">
                          {isUltra ? "Premium model" : "Free model"}
                        </span>
                      </span>
                    </span>
                    {!isLockedToUltra && (
                    <span className="text-zinc-500">
                      <ChevronRight size={18} className={`rotate-90 transition-transform duration-300 ease-out ${isModelMenuOpen ? "rotate-[270deg]" : ""}`} />
                    </span>
                    )}
                  </button>
                );
              })()}

              {isModelMenuOpen && !isLockedToUltra && (
                <div
                  className={`mogcheck-model-dropdown absolute left-0 right-0 mt-3 rounded-2xl border border-zinc-800 bg-[#0c0d0e]/95 backdrop-blur-xl shadow-2xl z-[80] origin-top ${dropdownAnimOpen ? 'mogcheck-model-dropdown--open' : ''}`}
                  role="listbox"
                  aria-label="AI Model Selection"
                >
                  <div className="p-2">
                    {models.map((m, idx) => {
                      if (m.id === "separator") {
                        return (
                          <div key={`sep-${idx}`} className="px-3 py-2">
                            <div className="flex items-center gap-3">
                              <div className="h-px flex-1 bg-zinc-800/80" />
                              <span className="text-[9px] font-sans uppercase tracking-[0.35em] text-zinc-600">Free Models</span>
                              <div className="h-px flex-1 bg-zinc-800/80" />
                            </div>
                          </div>
                        );
                      }

                      const isActive = m.id === selectedModel;
                      const isUltra = m.tier === 'ultra';
                      const Icon = m.Icon ?? MogCheckLogoIcon;

                      const ultraLocked = isUltra && !ultraAccessPending && !canUseUltra;

                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            if (ultraLocked) {
                              setIsModelMenuOpen(false);
                              if (!user) setCurrentPage('login');
                              else setCurrentPage('plans');
                              return;
                            }
                            setSelectedModel(m.id);
                            setIsModelMenuOpen(false);
                          }}
                          className={[
                            "mogcheck-model-option w-full text-left rounded-xl px-3 py-3 flex items-start gap-3 relative group",
                            ultraLocked ? "opacity-50 cursor-pointer" : "",
                            isActive
                              ? "bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
                              : "hover:bg-white/5 hover:shadow-[0_12px_44px_rgba(0,0,0,0.38)]"
                          ].join(' ')}
                        >
                          <span
                            className={[
                              "relative mt-0.5 inline-flex items-center justify-center w-9 h-9 rounded-xl border shrink-0 overflow-hidden",
                              isUltra ? "border-yellow-500/30 bg-yellow-500/10" : "border-zinc-800 bg-zinc-900/40"
                            ].join(' ')}
                          >
                            <Icon
                              size={16}
                              className={isUltra ? "text-yellow-300 drop-shadow-[0_0_10px_rgba(250,204,21,0.35)]" : "text-zinc-300"}
                            />
                            {isUltra && (
                              <span
                                className="absolute inset-0 opacity-60"
                                style={{
                                  backgroundImage:
                                    "linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(250,204,21,0.25) 35%, rgba(255,255,255,0.20) 50%, rgba(250,204,21,0.25) 65%, rgba(0,0,0,0) 100%)",
                                  backgroundSize: "200% 100%",
                                  animation: "premiumShine 2.6s linear infinite"
                                }}
                              />
                            )}
                          </span>

                          <span className="flex-1 min-w-0">
                            <span className="flex items-center justify-between gap-3">
                              <span
                                className={[
                                  "text-[11px] font-black uppercase tracking-widest truncate",
                                  isUltra
                                    ? "text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 via-yellow-50 to-amber-300"
                                    : "text-zinc-100"
                                ].join(' ')}
                              >
                                {m.name}
                              </span>
                              {isUltra && (
                                <span className="text-[9px] font-sans uppercase tracking-[0.3em] text-yellow-300/80 border border-yellow-500/20 bg-yellow-500/10 px-2 py-1 rounded-full">
                                  {ultraAccessPending ? 'Checking...' : ultraLocked ? 'Pro / 1 scan' : 'Premium'}
                                </span>
                              )}
                              {!isUltra && (
                                <span className="text-[9px] font-sans uppercase tracking-[0.3em] text-cyan-300/80 border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 rounded-full">
                                  Free
                                </span>
                              )}
                              {isActive && (
                                <span className="text-[9px] font-sans uppercase tracking-[0.3em] text-cyan-300/80 border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 rounded-full">
                                  Selected
                                </span>
                              )}
                            </span>

                            {/* Below md: description only on hover (smooth expand) */}
                            <div className="mogcheck-model-desc md:hidden">
                              <p className="text-[11px] text-zinc-400 leading-relaxed font-sans normal-case tracking-normal pr-1">
                                {m.description}
                              </p>
                            </div>
                          </span>

                          {/* md+: description only, slides in smoothly */}
                          <div className="mogcheck-model-tooltip hidden md:block z-[90]">
                            <p className="text-xs text-zinc-300 leading-relaxed font-sans normal-case tracking-normal">
                              {m.description}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

            {ultraAccessPending && (
              <p className="w-full max-w-sm -mt-8 mb-8 text-center text-[10px] font-sans uppercase tracking-[0.28em] text-zinc-500">
                Checking your premium access...
              </p>
            )}

            {user && (
              <div className="w-full max-w-md mx-auto mb-8 rounded-2xl p-[1px] bg-gradient-to-br from-cyan-500/40 via-zinc-700/50 to-violet-500/30 shadow-[0_0_40px_rgba(34,211,238,0.08)]">
                <div className="bg-zinc-950/95 backdrop-blur-sm rounded-[15px] p-5 border border-zinc-800/80">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="text-zinc-100 font-black uppercase tracking-[0.2em] text-xs flex items-center gap-2">
                      <span className="inline-flex h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]" aria-hidden />
                      Select profile
                    </h3>
                    <span className="text-[9px] font-sans text-zinc-600 uppercase tracking-widest">Saved scans</span>
                  </div>
                  {profilesUnavailable && (
                    <p className="text-amber-500/90 font-sans text-xs leading-relaxed mb-3 normal-case tracking-normal">
                      Profiles are disabled until the API has Firestore (set <code className="text-zinc-400">FIREBASE_SERVICE_ACCOUNT_JSON</code> or run the emulator). Scans still use a default slot.
                    </p>
                  )}
                  <div className="relative group">
                    <select
                      value={selectedProfileId}
                      onChange={(e) => setSelectedProfileId(e.target.value)}
                      disabled={profilesUnavailable}
                      className="mogcheck-profile-select w-full appearance-none bg-gradient-to-b from-zinc-900/90 to-zinc-950 border border-zinc-700/80 rounded-xl pl-4 pr-11 py-3.5 text-sm font-sans text-zinc-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50 mb-4 disabled:opacity-50 cursor-pointer shadow-inner"
                    >
                      <option value="new">+ Create new profile</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <ChevronDown
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-cyan-500/70 group-hover:text-cyan-400 transition-colors"
                      aria-hidden
                    />
                  </div>
                  {selectedProfileId === 'new' && !profilesUnavailable && (
                    <input
                      type="text"
                      placeholder="New profile name"
                      value={newProfileName}
                      onChange={(e) => setNewProfileName(e.target.value)}
                      className="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl px-4 py-3 text-sm font-sans text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                    />
                  )}
                </div>
              </div>
            )}

            <button 
              onClick={async () => {
                let actualProfileId = selectedProfileId;
                if (selectedProfileId === 'new') {
                  if (profilesUnavailable) {
                    actualProfileId = 'default';
                  } else {
                    if (!newProfileName.trim()) {
                      alert("Please enter a profile name");
                      return;
                    }
                    try {
                      const token = await user.getIdToken();
                      const res = await fetch(`${API_BASE}/api/user/profiles`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: newProfileName, visibility: 'private' })
                      });
                      if (res.ok) {
                        const data = await res.json();
                        actualProfileId = data.id;
                      } else {
                        const errBody = await res.json().catch(() => ({}));
                        throw new Error(errBody.error || 'Failed to create profile');
                      }
                    } catch (e) {
                      alert(e.message);
                      return;
                    }
                  }
                }
                setSelectedProfileId(actualProfileId);
                setIsScanning(true);
              }} 
              disabled={isUltraModel ? (!frontImage || !sideImage || ultraAccessPending || !canUseUltra) : !frontImage} 
              className={`relative overflow-hidden px-20 py-6 bg-white text-black font-black uppercase tracking-widest text-lg md:text-xl flex items-center justify-center gap-5 hover:scale-[1.02] hover:bg-zinc-200 transition-all cursor-pointer rounded-lg disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none ${justUnlocked ? 'animate-[buttonUnlock_1s_ease-out_forwards]' : 'shadow-[0_0_30px_rgba(255,255,255,0.2)]'}`}
            >
            {justUnlocked && <div className="absolute top-0 bottom-0 w-[50%] bg-gradient-to-r from-transparent via-white to-transparent opacity-80 mix-blend-overlay" style={{ animation: 'sweepGlow 1.5s ease-out forwards' }} />}
            <span className="relative z-10">Analyze Profiles</span>
            {justUnlocked ? <Unlock size={28} className="text-black relative z-10" style={{ animation: 'popOpen 0.5s ease-out forwards' }} /> : <ChevronRight size={28} className="text-black relative z-10" />}
          </button>
      </div>
    </div>
  );
};

// --- ScoreBar ---
const ScoreBar = ({ label, score, max = 10, locked = false }) => {
  const displayScore = locked && score === null ? 8.8 : score;
  const isGreen = displayScore >= 7;
  let colorClass = locked ? 'bg-gradient-to-r from-red-600 via-orange-500 to-green-500' : (isGreen ? 'bg-green-500' : displayScore >= 4 ? 'bg-yellow-600' : 'bg-red-600');
  const textColor = isGreen ? 'text-green-500' : displayScore >= 4 ? 'text-yellow-500' : 'text-red-500';
  return (
    <div className="flex flex-col mb-3 relative group">
      <div className="flex justify-between items-end text-[10px] uppercase font-sans text-zinc-400 mb-1.5">
        <span className={`tracking-widest ${locked ? 'blur-[3px] opacity-60' : ''}`}>{label}</span>
        {displayScore !== null && (<span className={`relative ${textColor} font-bold text-sm leading-none`}><span className={locked ? 'blur-[5px] opacity-60 inline-block' : ''}>{displayScore.toFixed(1)}</span></span>)}
      </div>
      <div className="w-full h-1.5 bg-zinc-800/80 rounded-full relative">{displayScore !== null && (<div className={`h-full rounded-full ${colorClass} transition-all duration-1000 ${locked ? 'opacity-80 blur-[2px]' : ''}`} style={{ width: `${(displayScore/max)*100}%` }} />)}</div>
    </div>
  );
};

// --- Results Page ---
const ResultsPage = () => (
  <div className="w-full flex flex-col items-center py-24 px-4 sm:px-6 relative font-sans">
    <style>{`@keyframes oscillate { 0% { width: 5%; } 100% { width: 85%; } } .animate-oscillate { animation: oscillate 2s ease-in-out infinite alternate; }`}</style>
    <div className="w-full max-w-5xl flex justify-end items-center gap-4 mb-12">
      <button className="px-3 py-1.5 bg-zinc-200 hover:bg-white text-black font-bold text-xs uppercase tracking-widest transition-colors shadow-lg rounded">UPGRADE</button>
      <div className="flex items-center gap-3 border border-zinc-800 pl-4 pr-1 py-1 rounded-full bg-zinc-900/50"><div className="flex flex-col text-right px-1"><span className="text-xs font-sans uppercase tracking-widest text-zinc-300 leading-none">Stinky User</span><span className="text-[8px] font-sans uppercase tracking-widest text-zinc-500 mt-1">Free Plan</span></div><div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700"></div></div>
    </div>
    <div className="w-full max-w-5xl space-y-16">
      <section>
        <h3 className="text-zinc-500 font-sans text-xs uppercase tracking-widest mb-4">Face Analysis 1</h3>
        <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">{[1,2,3,4,5].map(i => (<div key={i} className="w-24 h-32 shrink-0 bg-zinc-900/50 border border-zinc-800 rounded flex items-center justify-center">{i === 1 && <span className="text-[10px] text-zinc-600 font-sans uppercase">Current</span>}</div>))}</div>
      </section>
      <section className="flex flex-col md:flex-row gap-12">
        <div className="w-full md:w-1/3 flex flex-col items-center">
          <div className="w-full aspect-[3/4] border border-zinc-800 rounded-lg relative overflow-hidden bg-zinc-900/20 p-4"><svg viewBox="0 0 100 130" className="w-full h-full stroke-zinc-700 fill-none stroke-1"><path d="M 20 20 C 20 0, 80 0, 80 20 C 80 80, 50 120, 50 120 C 50 120, 20 80, 20 20 Z" /><path d="M 35 45 Q 40 40, 45 45" /><path d="M 55 45 Q 60 40, 65 45" /><path d="M 50 60 L 50 80" /><path d="M 40 95 Q 50 105, 60 95" /><rect x="10" y="10" width="80" height="110" stroke="#3f3f46" strokeWidth="0.5" strokeDasharray="2 2" /></svg></div>
          <div className="flex gap-2 mt-4"><div className="w-8 h-8 border border-zinc-800 rounded"></div><div className="w-8 h-8 border border-zinc-800 rounded"></div></div>
        </div>
        <div className="w-full md:w-2/3 space-y-8">
          <h2 className="text-2xl font-bold uppercase tracking-widest flex items-center gap-2">Your Front Profile <ChevronRight className="text-zinc-500" /></h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-8">
            <div><h4 className="text-zinc-300 font-sans text-xs uppercase tracking-widest mb-4">Harmony</h4><ScoreBar label="Facial ratio" score={6.7} /><ScoreBar label="Jaw likeness" score={5.1} /><ScoreBar label="Facial thirds" score={2.3} /><ScoreBar label="Facial width to height" score={9.2} locked={true} /></div>
            <div><h4 className="text-zinc-300 font-sans text-xs uppercase tracking-widest mb-4">Dimorphism</h4><ScoreBar label="Eye brow thickness" score={6.7} /><ScoreBar label="Eye brow distance" score={5.1} /><ScoreBar label="Facial hair" score={2.3} /><ScoreBar label="Facial width to height" score={9.2} locked={true} /></div>
            <div><h4 className="text-zinc-300 font-sans text-xs uppercase tracking-widest mb-4">Health Indicators</h4><ScoreBar label="Skin health" score={8.5} /><ScoreBar label="Bone score" score={4.2} /><ScoreBar label="Facial symmetry" score={9.6} locked={true} /><ScoreBar label="Facial width to height" score={null} /></div>
            <div><h4 className="text-zinc-300 font-sans text-xs uppercase tracking-widest mb-4">Uniqueness (Subjective)</h4><ScoreBar label="Eye color" score={7.0} /><ScoreBar label="Jaw symmetry" score={5.5} /><ScoreBar label="Facial symmetry" score={8.9} locked={true} /><ScoreBar label="Facial width to height" score={null} /></div>
          </div>
          <button className="w-full mt-6 py-4 bg-zinc-900 border border-zinc-700 hover:border-zinc-500 rounded-lg flex items-center justify-center gap-3 text-white uppercase font-bold tracking-widest transition-all shadow-lg hover:shadow-xl cursor-pointer group hover:bg-zinc-800/50"><MogCheckLogoIcon size={18} className="opacity-70 group-hover:opacity-100 transition-opacity" /> Unlock All Stats</button>
        </div>
      </section>
      <hr className="border-zinc-800/50" />
      <section>
        <h2 className="text-3xl font-black uppercase tracking-widest mb-8 text-center italic">Plan</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="p-8 bg-zinc-900/30 border border-zinc-800 rounded-2xl shadow-xl"><h3 className="text-xl font-bold uppercase tracking-widest mb-6 text-zinc-100">Softmaxing</h3><ol className="space-y-4 font-sans text-sm tracking-wider"><li className="flex flex-col sm:flex-row sm:items-end gap-1 sm:gap-2 text-green-500"><div className="flex gap-2"><span className="text-lg">1.</span><span className="uppercase font-bold">Grooming</span></div><span className="text-[10px] text-zinc-500 mb-0.5 ml-5 sm:ml-0">(estimated price $20/mth)</span></li><li className="flex flex-col sm:flex-row sm:items-end gap-1 sm:gap-2 text-yellow-500"><div className="flex gap-2"><span className="text-lg">2.</span><span className="uppercase font-bold">Skincare</span></div><span className="text-[10px] text-zinc-500 mb-0.5 ml-5 sm:ml-0">(estimated price $40/mth)</span></li></ol></div>
          <div className="p-8 bg-zinc-900/30 border border-zinc-800 rounded-2xl shadow-xl"><h3 className="text-xl font-bold uppercase tracking-widest mb-6 text-zinc-100">Hardmaxing</h3><ol className="space-y-4 font-sans text-sm tracking-wider"><li className="flex flex-col sm:flex-row sm:items-end gap-1 sm:gap-2 text-zinc-400"><div className="flex gap-2"><span className="text-lg">1.</span><span className="uppercase font-bold text-zinc-300">Jaw Surgery</span></div><span className="text-[10px] text-zinc-500 mb-0.5 ml-5 sm:ml-0">(estimated price $3000)</span></li><li className="flex flex-col sm:flex-row sm:items-end gap-1 sm:gap-2 text-zinc-400"><div className="flex gap-2"><span className="text-lg">2.</span><span className="uppercase font-bold text-zinc-300">Rhinoplasty</span></div><span className="text-[10px] text-zinc-500 mb-0.5 ml-5 sm:ml-0">(estimated price $2500)</span></li></ol></div>
        </div>
      </section>
      <hr className="border-zinc-800/50" />
      <section><h2 className="text-3xl font-black uppercase tracking-widest mb-6 text-center italic">Overview</h2><div className="p-6 bg-zinc-900/20 border border-zinc-800/50 rounded-lg"><p className="text-zinc-300 font-sans text-sm leading-relaxed tracking-wide text-justify">Based on your face analysis, you have strong baseline symmetry but could optimize your harmony through targeted grooming and skincare. Your dimorphism score indicates solid masculine features that can be highlighted by reducing body fat. Softmaxing options provide an excellent ROI for immediate aesthetic improvement, whereas hardmaxing recommendations address structural areas for maximum potential alignment. Proceed with the suggested grooming routine to see the quickest initial progress.</p></div></section>
      <hr className="border-zinc-800/50" />
      <section className="flex flex-col items-center">
        <h2 className="text-3xl font-black uppercase tracking-widest mb-12 text-center italic">Potential</h2>
        <div className="flex flex-col md:flex-row items-center gap-8 mb-12 w-full justify-center">
          <div className="flex flex-col items-center gap-3"><span className="text-sm font-bold font-sans uppercase tracking-widest text-white">Face Analysis 1</span><div className="w-48 h-64 bg-zinc-900/50 border border-zinc-800 rounded-lg shadow-xl"></div></div>
          <div className="hidden md:flex flex-col items-center text-zinc-500 px-4"><div className="w-32 h-[2px] bg-zinc-700 relative"><ChevronRight className="absolute -right-3 top-1/2 -translate-y-1/2" size={24} /></div></div>
          <div className="flex flex-col items-center gap-3"><span className="text-sm font-bold font-sans uppercase tracking-widest text-white">Estimated Image of your potential</span><div className="w-48 h-64 bg-zinc-900/50 border border-zinc-800 rounded-lg relative overflow-hidden flex flex-col items-center justify-center text-center p-4 shadow-xl"><div className="absolute inset-0 backdrop-blur-xl bg-black/40 z-10" /><div className="relative z-20 text-zinc-300 flex flex-col items-center gap-4"><button className="flex items-center gap-2 text-yellow-400 bg-yellow-500/10 border border-yellow-500/50 px-5 py-2.5 rounded-full shadow-[0_0_30px_rgba(234,179,8,0.4)] hover:shadow-[0_0_50px_rgba(234,179,8,0.7)] hover:bg-yellow-500/20 hover:scale-105 transition-all duration-300 cursor-pointer"><Lock size={18} className="drop-shadow-[0_0_8px_rgba(234,179,8,0.8)]" /><span className="font-bold uppercase tracking-widest text-lg drop-shadow-[0_0_8px_rgba(234,179,8,0.8)]">UNLOCK</span></button><span className="block text-xs font-sans uppercase leading-tight opacity-80 tracking-wider">Estimated<br/>Full Potential</span></div></div></div>
        </div>
        <button className="relative w-full max-w-md h-16 bg-zinc-900 border border-yellow-600/50 rounded-lg overflow-hidden flex items-center justify-between px-6 shadow-[0_0_15px_rgba(202,138,4,0.1)] hover:shadow-[0_0_25px_rgba(202,138,4,0.2)] hover:border-yellow-500 transition-all group cursor-pointer"><div className="absolute top-0 left-0 bottom-0 bg-gradient-to-r from-yellow-900/40 to-yellow-600/40 animate-oscillate z-0 border-r border-yellow-500/50" /><div className="relative z-10 flex items-center gap-3"><Lock size={20} className="text-yellow-500 group-hover:scale-110 transition-transform" /><span className="text-zinc-100 font-bold uppercase tracking-widest text-sm">Unlock</span></div><span className="relative z-10 text-yellow-500 font-sans uppercase tracking-widest text-xs drop-shadow-md">Estimated Full Potential</span></button>
      </section>
      <hr className="border-zinc-800/50" />
      <section className="pb-12">
        <h2 className="text-3xl font-black uppercase tracking-widest mb-12 text-center italic">Progress</h2>
        <div className="w-full max-w-2xl mx-auto aspect-video relative px-4">
          <svg viewBox="0 0 100 70" className="w-full h-full overflow-visible">
            <line x1="8" y1="60" x2="92" y2="60" stroke="#71717a" strokeWidth="0.5" /><path d="M 8 60 L 5 57 L 2 60 L 5 63 Z" fill="none" stroke="#71717a" strokeWidth="0.5" /><path d="M 92 60 L 95 57 L 98 60 L 95 63 Z" fill="none" stroke="#71717a" strokeWidth="0.5" /><path d="M 8 60 C 35 60, 42 15, 50 15 C 58 15, 65 60, 92 60" fill="none" stroke="#e4e4e7" strokeWidth="0.5" /><line x1="50" y1="15" x2="50" y2="60" stroke="#71717a" strokeWidth="0.5" />
            <line x1="24" y1="58" x2="24" y2="60" stroke="#ef4444" strokeWidth="0.5" /><line x1="50" y1="58" x2="50" y2="60" stroke="#d97706" strokeWidth="0.5" /><line x1="76" y1="58" x2="76" y2="60" stroke="#22c55e" strokeWidth="0.5" />
            <text x="24" y="66" fill="#ef4444" fontSize="4" textAnchor="middle" className="font-sans">2</text><text x="50" y="66" fill="#d97706" fontSize="4" textAnchor="middle" className="font-sans">5</text><text x="76" y="66" fill="#22c55e" fontSize="4" textAnchor="middle" className="font-sans">8</text>
            <text x="69" y="10" fill="#e4e4e7" fontSize="3" textAnchor="middle" className="font-sans tracking-wide">Now</text><rect x="64" y="12" width="10" height="10" fill="none" stroke="#a1a1aa" strokeWidth="0.3" rx="1.5" /><text x="62" y="20" fill="#e4e4e7" fontSize="3.5" textAnchor="end" className="font-sans uppercase tracking-widest">YOU</text>
            <path d="M 59 23 Q 56 26, 54 28" fill="none" stroke="#a1a1aa" strokeWidth="0.6" strokeLinecap="round" /><path d="M 57 27 L 54 28 L 54 25" fill="none" stroke="#a1a1aa" strokeWidth="0.6" strokeLinecap="round" strokeLinejoin="round" />
            <text x="75" y="38" fill="#e4e4e7" fontSize="3" textAnchor="middle" className="font-sans tracking-wide">3 months</text><rect x="70" y="40" width="10" height="10" fill="none" stroke="#a1a1aa" strokeWidth="0.3" rx="1.5" />
            <path d="M 69 52 Q 64 54, 61 55" fill="none" stroke="#a1a1aa" strokeWidth="0.6" strokeLinecap="round" /><path d="M 64 54 L 61 55 L 63 57" fill="none" stroke="#a1a1aa" strokeWidth="0.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </section>
    </div>
  </div>
);

/** Category and overall scores may be stored as 0–100 or 0–10; UI shows 0–10. */
const scoreToDisplay10 = (fs) => {
  if (fs == null || fs === '' || Number.isNaN(Number(fs))) return null;
  const n = Number(fs);
  return n > 10 ? n / 10 : n;
};

const categoryToRadar10 = (v, fallbackRaw) => {
  const fb = Number(fallbackRaw);
  const fallback = Number.isNaN(fb) ? 5 : fb > 10 ? fb / 10 : fb;
  if (v == null || Number.isNaN(Number(v))) return fallback;
  const n = Number(v);
  return n > 10 ? n / 10 : n;
};

const hexagonToRadarData = (hexagon, fallbackRaw) => {
  if (!hexagon || typeof hexagon !== 'object') return null;
  const keyOrder = ['Skin', 'Dimorphism', 'Symmetry', 'Harmony', 'Bone'];
  const normalizedHexagon = Object.fromEntries(
    Object.entries(hexagon).map(([key, value]) => [String(key).trim().toLowerCase(), value])
  );

  let validCount = 0;
  const out = keyOrder.map((label) => {
    const raw = normalizedHexagon[label.toLowerCase()];
    if (raw == null || raw === 'N/A' || Number.isNaN(Number(raw))) {
      return { label, val: null };
    }
    validCount += 1;
    return { label, val: categoryToRadar10(Number(raw), fallbackRaw) };
  });

  if (validCount === 0) return null;
  return out.map((item) => ({
    label: item.label,
    val: item.val == null ? categoryToRadar10(null, fallbackRaw) : item.val,
  }));
};

// --- Radar Chart Component ---
const RadarChart = ({ data, finalScore }) => {
  const [progress, setProgress] = useState(0);
  const dataKey = data.map((d) => `${d.label}:${d.val}`).join('|');
  useEffect(() => {
    let start = Date.now();
    let frame;
    const update = () => {
      const p = Math.min((Date.now() - start) / 1500, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setProgress(ease);
      if (p < 1) frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [dataKey]);

  const points = data.map((d, i) => {
    const angle = (Math.PI / 2) + (2 * Math.PI * i / data.length);
    const val = (d.val * progress) / 10;
    const x = 50 + val * 40 * Math.cos(angle);
    const y = 50 - val * 40 * Math.sin(angle);
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="relative w-full aspect-square">
      <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-[162deg]">
        <polygon points="50,10 88,38 73,82 27,82 12,38" fill="rgba(255,255,255,0.05)" stroke="#3f3f46" strokeWidth="0.5" />
        <polygon points="50,30 69,44 62,66 38,66 31,44" fill="rgba(255,255,255,0.1)" stroke="#52525b" strokeWidth="0.5" />
        <line x1="50" y1="50" x2="50" y2="10" stroke="#3f3f46" strokeWidth="0.5" />
        <line x1="50" y1="50" x2="88" y2="38" stroke="#3f3f46" strokeWidth="0.5" />
        <line x1="50" y1="50" x2="73" y2="82" stroke="#3f3f46" strokeWidth="0.5" />
        <line x1="50" y1="50" x2="27" y2="82" stroke="#3f3f46" strokeWidth="0.5" />
        <line x1="50" y1="50" x2="12" y2="38" stroke="#3f3f46" strokeWidth="0.5" />
        <polygon points={points} fill="rgba(34,211,238,0.2)" stroke="#22d3ee" strokeWidth="1" className="drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
        {data.map((d, i) => {
          const angle = (Math.PI / 2) + (2 * Math.PI * i / data.length);
          const val = (d.val * progress) / 10;
          const x = 50 + val * 40 * Math.cos(angle);
          const y = 50 - val * 40 * Math.sin(angle);
          return <circle key={i} cx={x} cy={y} r="1.5" fill="#fff" className="drop-shadow-[0_0_4px_rgba(255,255,255,1)]" />;
        })}
      </svg>
      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-2">
        <div className="flex justify-between w-full px-2 mt-4">
           <span className="text-[9px] font-sans text-cyan-400 uppercase tracking-widest">{data[3].label}</span>
           <span className="text-[9px] font-sans text-cyan-400 uppercase tracking-widest">{data[2].label}</span>
        </div>
        <div className="flex justify-between w-full px-0 -mt-2">
           <span className="text-[9px] font-sans text-cyan-400 uppercase tracking-widest">{data[4].label}</span>
           <span className="text-[9px] font-sans text-cyan-400 uppercase tracking-widest">{data[1].label}</span>
        </div>
        <div className="flex justify-center w-full mb-1">
           <span className="text-[9px] font-sans text-cyan-400 uppercase tracking-widest">{data[0].label}</span>
        </div>
      </div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-white font-black italic text-xl drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]">
        {scoreToDisplay10(finalScore) != null
          ? (scoreToDisplay10(finalScore) * progress).toFixed(1)
          : (data.reduce((a, b) => a + b.val * progress, 0) / data.length).toFixed(1)}
      </div>
    </div>
  );
};

// --- Metric Bar Component ---
const MetricBar = ({ label, score, max = 100, displayValue, isFreePlan = false }) => {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (isFreePlan) {
      const interval = setInterval(() => {
        setProgress(Math.random() * 100);
      }, 500);
      return () => clearInterval(interval);
    } else {
      const timer = setTimeout(() => {
        setProgress(score);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [score, isFreePlan]);

  const percentage = Math.min(100, Math.max(0, (progress / max) * 100));
  
  let colorClass = 'bg-gradient-to-r from-red-600 via-red-500 to-rose-400';
  let shadowClass = 'shadow-[0_0_15px_rgba(225,29,72,0.5)]';
  if (percentage >= 70) {
    colorClass = 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-400';
    shadowClass = 'shadow-[0_0_15px_rgba(20,184,166,0.5)]';
  } else if (percentage >= 40) {
    colorClass = 'bg-gradient-to-r from-orange-600 via-orange-500 to-amber-400';
    shadowClass = 'shadow-[0_0_15px_rgba(251,191,36,0.5)]';
  }

  return (
    <div className="flex flex-col relative group">
      <div className="flex justify-between items-end gap-3 text-[10px] uppercase font-sans text-zinc-400 mb-1.5">
        <span className="tracking-[0.22em] font-bold leading-tight">{label}</span>
        <span className="font-black text-white text-sm bg-zinc-900/80 px-2 py-0.5 rounded shadow-sm border border-zinc-800">{isFreePlan ? `${Math.round(progress)}/100` : (displayValue ? displayValue : `${progress.toFixed(1)}${max === 100 ? '%' : ''}`)}</span>
      </div>
      <div className="w-full h-2.5 bg-zinc-800/80 rounded-full relative overflow-hidden flex items-center shadow-inner">
        <div 
          className={`h-full rounded-full ${colorClass} ${shadowClass} transition-all duration-1000 ease-out`} 
          style={{ width: `${percentage}%` }} 
        />
      </div>
    </div>
  );
};

// --- Dashboard Overview Component ---
const FeatureCard = ({ type = 'best', title, description }) => {
  const isBest = type === 'best';
  
  const bgClass = isBest ? 'bg-green-900/10' : 'bg-red-900/10';
  const borderClass = isBest ? 'border-green-500/20 hover:border-green-500/40' : 'border-red-500/20 hover:border-red-500/40';
  const shadowClass = isBest ? 'shadow-[0_0_30px_rgba(34,197,94,0.05)] group-hover:shadow-[0_0_50px_rgba(34,197,94,0.15)]' : 'shadow-[0_0_30px_rgba(239,68,68,0.05)] group-hover:shadow-[0_0_50px_rgba(239,68,68,0.15)]';
  const gradientLine = isBest ? 'from-green-400 to-green-600' : 'from-red-400 to-red-600';
  const textLabel = isBest ? 'text-green-500/50' : 'text-red-500/50';
  const textTitle = isBest ? 'text-green-400' : 'text-red-400';
  const gradientMoving = isBest ? 'from-green-900/40 via-transparent to-green-500/20' : 'from-red-900/40 via-transparent to-red-500/20';
  const particleColor = isBest ? 'bg-green-400 shadow-[0_0_12px_#4ade80]' : 'bg-red-400 shadow-[0_0_12px_#f87171]';
  const label = isBest ? 'Best Feature' : 'Primary Flaw';

  const particles = React.useMemo(() => {
    return Array.from({ length: 15 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 3 + 1.5,
      tx: (Math.random() - 0.5) * 40,
      ty: (Math.random() - 0.5) * 40,
      duration: Math.random() * 5 + 5,
      delay: Math.random() * 2
    }));
  }, []);

  return (
    <div className={`p-6 ${bgClass} border ${borderClass} rounded-2xl relative overflow-hidden flex flex-col group transition-all duration-700 ${shadowClass}`}>
      
      {/* Moving cheeky gradient */}
      <div className={`absolute -inset-[100%] opacity-0 group-hover:opacity-60 transition-opacity duration-1000 bg-gradient-to-br ${gradientMoving}`} style={{ animation: 'spinSlow 15s linear infinite' }} />
      
      {/* Particles */}
      <div className="absolute inset-0 pointer-events-none opacity-100 transition-opacity duration-1000">
        {particles.map(p => (
          <div 
            key={p.id}
            className={`absolute rounded-full blur-[1.5px] ${particleColor}`}
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              transform: `translate(${p.tx}px, ${p.ty}px)`,
              animation: `floatParticle ${p.duration}s ease-in-out infinite alternate`,
              animationDelay: `${p.delay}s`
            }}
          />
        ))}
      </div>

      <div className={`absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b ${gradientLine} z-10`} />
      
      <div className="relative z-10 flex flex-col h-full transition-colors duration-700">
        <span className={`${textLabel} text-[10px] uppercase font-black tracking-widest mb-1 block`}>{label}</span>
        <h4 className={`${textTitle} font-bold uppercase text-sm tracking-widest mb-3 drop-shadow-md`}>{stripInlineMarkers(title)}</h4>
        <p className="text-zinc-300 text-[11px] font-sans leading-relaxed mt-auto drop-shadow">{renderMarkedText(description)}</p>
      </div>
    </div>
  );
};

const DashboardOverview = ({ dashboardData, isRestrictedPreview, activeProfileView }) => {
  const summary =
    dashboardData?.technicalSummary &&
    dashboardData.technicalSummary !== 'Could not generate technical summary.'
      ? dashboardData.technicalSummary
      : 'The subject presents with a heavily midface-dominant structural profile, corroborated by a suboptimal fWHR...';

  const isSide = activeProfileView === 'side';
  const displayFlaws = useMemo(
    () => resolveNormalizedFeatures(dashboardData, 'flaw', isSide),
    [dashboardData, isSide]
  );
  const displayFeatures = useMemo(
    () => resolveNormalizedFeatures(dashboardData, 'best', isSide),
    [dashboardData, isSide]
  );
  const shouldExpand = isRestrictedPreview || displayFlaws.length > 0 || displayFeatures.length > 0;
  const [isExpanded, setIsExpanded] = useState(shouldExpand);

  useEffect(() => {
    setIsExpanded(shouldExpand);
  }, [
    shouldExpand,
    activeProfileView,
    dashboardData?.frontImage,
    dashboardData?.sideImage,
    dashboardData?.finalRating,
    dashboardData?.sideRating,
  ]);

  return (
    <div id="dashboard-structural-overview" className="bg-zinc-900/30 p-8 rounded-3xl border border-zinc-800 flex flex-col relative overflow-hidden scroll-mt-28">
      <h3 className="text-zinc-400 font-sans text-xs uppercase tracking-widest mb-6 border-b border-zinc-800/50 pb-4"><Activity size={14} className="inline mr-2" /> Structural Overview</h3>
      
      <div className={`relative transition-all duration-500 overflow-hidden ${isExpanded ? 'max-h-[2000px]' : 'max-h-[64px]'}`}>
        <p className="text-zinc-300 font-sans text-sm leading-relaxed tracking-wide text-justify mb-6">
          {renderMarkedText(summary)}
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mt-8 mb-4" style={{ zoom: 0.92 }}>
          <style>{`
            @keyframes floatParticle {
              0% { transform: translateY(0px) translateX(0px); opacity: 0.3; }
              50% { opacity: 1; }
              100% { transform: translateY(-20px) translateX(15px); opacity: 0.3; }
            }
            @keyframes spinSlow {
              100% { transform: rotate(360deg); }
            }
          `}</style>
          
          {/* Left Column: Primary Flaws */}
          <div className="flex flex-col gap-4">
            <h4 className="text-red-400 font-bold uppercase tracking-widest text-xs mb-2">PRIMARY FLAWS</h4>
            <div className="flex flex-col gap-4 z-10 w-full relative">
              {displayFlaws.length > 0 ? (
                displayFlaws.map((flaw, idx) => (
                  <FeatureCard
                    key={`flaw-${idx}-${flaw.title}`}
                    type="flaw"
                    title={flaw.title}
                    description={flaw.description}
                  />
                ))
              ) : (
                <p className="text-zinc-500 italic">No flaws detected or backend disconnected.</p>
              )}
            </div>
          </div>

          {/* Right Column: Best Features */}
          <div className="flex flex-col gap-4">
            <h4 className="text-green-400 font-bold uppercase tracking-widest text-xs mb-2">BEST FEATURES</h4>
            <div className="flex flex-col gap-4 z-10 w-full relative">
              {displayFeatures.length > 0 ? (
                displayFeatures.map((feature, idx) => (
                  <FeatureCard
                    key={`feature-${idx}-${feature.title}`}
                    type="best"
                    title={feature.title}
                    description={feature.description}
                  />
                ))
              ) : (
                <p className="text-zinc-500 italic">No features detected or backend disconnected.</p>
              )}
            </div>
          </div>
        </div>
        
        {!isExpanded && (
          <div className="absolute bottom-0 left-0 w-full h-12 bg-gradient-to-t from-[#101113] to-transparent pointer-events-none" />
        )}
      </div>

      {!isRestrictedPreview && (
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className="mt-6 self-start md:self-center px-6 py-2 border border-zinc-700 rounded-full text-zinc-400 text-[10px] font-sans uppercase tracking-widest hover:text-white hover:border-zinc-500 transition-colors"
        >
          {isExpanded ? 'Show Less' : 'Show More'}
        </button>
      )}
    </div>
  );
};

// --- Detailed Dashboard Page ---

const sideMetricDataGlobal = [
  { label: 'Gonial Angle', score: 96, max: 100 },
  { label: 'Nasofrontal Angle', score: 82, max: 100 },
  { label: 'Nasofacial Angle', score: 78, max: 100 },
  { label: 'Nasolabial Angle', score: 88, max: 100 },
  { label: 'Mentolabial Angle', score: 70, max: 100 },
  { label: 'Facial Convexity', score: 92, max: 100 },
  { label: 'Subnasale-Pogonion', score: 85, max: 100 },
  { label: 'Mandibular Plane', score: 94, max: 100 },
  { label: 'Maxillary Projection', score: 86, max: 100 },
  { label: 'Chin Projection', score: 96, max: 100 }
];

// --- Feature Keyword Coordinate Mapping ---
const mapFeatureToCoordinates = (title, desc) => {
  const t = (title + ' ' + (desc || '')).toLowerCase();
  
  if (t.includes('fwhr') || t.includes('face')) {
    return { type: 'rect', x: 12, y: 31, w: 76, h: 33 };
  }
  if (t.includes('midface') || t.includes('middle third') || t.includes('mid face')) {
    return { type: 'rect', x: 30, y: 40, w: 40, h: 30 };
  }
  if (t.includes('jaw') || t.includes('gonial') || t.includes('mandible') || t.includes('lower third') || t.includes('bigonial')) {
    return { type: 'rect', x: 25, y: 65, w: 50, h: 30 };
  }
  if (t.includes('forehead') || t.includes('hairline') || t.includes('upper third')) {
    return { type: 'rect', x: 25, y: 15, w: 50, h: 25 };
  }

  if (t.includes('chin') || t.includes('mentolabial') || t.includes('pogonion')) {
    return { x: 50, y: 90 }; // Chin
  }
  if (t.includes('lip') || t.includes('mouth') || t.includes('philtrum')) {
    return { x: 50, y: 75 }; // Mouth area
  }
  if (t.includes('nose') || t.includes('nasal') || t.includes('alar') || t.includes('naso')) {
    return { x: 50, y: 55 }; // Nose
  }
  if (t.includes('eye') || t.includes('canthal') || t.includes('pupil') || t.includes('orbital') || t.includes('infraorbital') || t.includes('ipd')) {
    return { x: 30, y: 40 }; // Eye area (left side relative to image)
  }
  if (t.includes('brow') || t.includes('supraorbital')) {
    return { x: 30, y: 35 }; // Brow area
  }
  if (t.includes('cheek') || t.includes('zygomatic')) {
    return { x: 25, y: 55 }; // Cheekbone
  }
  
  // Default fallback if no match
  return { x: 50, y: 50 };
};

const FeatureHighlightCard = ({ type, feature, onHover }) => {
  const isBest = type === 'best';
  if (!feature) return null;
  const cardClass = isBest
    ? 'p-5 bg-green-900/10 border border-green-500/20 rounded-2xl relative overflow-hidden shadow-[0_0_30px_rgba(34,197,94,0.05)] cursor-default transition-all duration-300 hover:scale-[1.02]'
    : 'p-5 bg-red-900/10 border border-red-500/20 rounded-2xl relative overflow-hidden shadow-[0_0_30px_rgba(239,68,68,0.05)] cursor-default transition-all duration-300 hover:scale-[1.02]';
  const railClass = isBest
    ? 'absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-green-400 to-green-600'
    : 'absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-red-400 to-red-600';
  const labelClass = isBest
    ? 'text-green-500/50 text-[10px] uppercase font-black tracking-widest mb-1 block'
    : 'text-red-500/50 text-[10px] uppercase font-black tracking-widest mb-1 block';
  const titleClass = isBest
    ? 'text-green-400 font-bold uppercase text-sm tracking-widest mb-2'
    : 'text-red-400 font-bold uppercase text-sm tracking-widest mb-2';
  return (
    <div className={cardClass}>
      <div className={railClass} />
      <span className={labelClass}>{isBest ? 'Best Feature' : 'Primary Flaw'}</span>
      <h4 className={titleClass}>{stripInlineMarkers(feature.title)}</h4>
      <p className="text-zinc-400 text-[12px] font-sans leading-relaxed">{renderMarkedText(feature.description)}</p>
    </div>
  );
};

const PersonalizedFeedbackCard = ({ item, delay = 0 }) => (
  <div
    className="group relative overflow-hidden rounded-2xl border border-cyan-500/15 bg-cyan-500/5 p-5 shadow-[0_0_24px_rgba(34,211,238,0.04)] transition-all duration-500 hover:-translate-y-1 hover:border-cyan-500/35 hover:shadow-[0_0_30px_rgba(34,211,238,0.12)]"
    style={{ animation: `fadeInUp 0.55s ease ${delay}ms both` }}
  >
    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent" />
    <div className="mb-4 flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-cyan-500/25 bg-cyan-500/10 text-[11px] font-black text-cyan-300">
        {String(item?.id ?? '').padStart(2, '0')}
      </div>
      <h4 className="text-sm font-black uppercase tracking-[0.22em] text-white">
        {stripInlineMarkers(item?.title || 'Feedback')}
      </h4>
    </div>
    <div className="text-sm font-sans leading-relaxed text-zinc-300">
      {renderMarkedText(item?.description)}
    </div>
  </div>
);

const StructureMap = ({ activeImageUrl, bestFeature, primaryFlaw, activeHover }) => {
  const [landmarker, setLandmarker] = useState(null);
  const [landmarks, setLandmarks] = useState(null);
  const imgRef = useRef(null);

  useEffect(() => {
    const initializeLandmarker = async () => {
      try {
        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        const faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: "/models/face_landmarker.task",
            delegate: "GPU"
          },
          outputFaceBlendshapes: false,
          runningMode: "IMAGE",
          numFaces: 1
        });
        setLandmarker(faceLandmarker);
      } catch (error) {
        console.error("Error initializing landmarker:", error);
      }
    };
    initializeLandmarker();
  }, []);

  useEffect(() => {
    if (landmarker && imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth !== 0) {
      try {
        const result = landmarker.detect(imgRef.current);
        if (result.faceLandmarks && result.faceLandmarks.length > 0) {
          setLandmarks(result.faceLandmarks[0]);
        }
      } catch (e) {
        console.error("Error during initial detection:", e);
      }
    }
  }, [landmarker, activeImageUrl]);

  const mapKeywordToLandmark = (title, description) => {
    const t = (title + " " + description).toLowerCase();
    
    if (t.includes('fwhr') || t.includes('face')) {
      if (landmarks) {
        const leftFaceIndices = [127, 234, 93, 132, 58];
        const rightFaceIndices = [356, 454, 323, 361, 288];

        const xMin = Math.min(...leftFaceIndices.map((idx) => landmarks[idx].x));
        const xMax = Math.max(...rightFaceIndices.map((idx) => landmarks[idx].x));
        const yMin = landmarks[9].y; // Top of forehead / Glabella
        const yMax = landmarks[13].y; // Upper lip

        return {
          type: 'rect',
          x: xMin * 100,
          y: yMin * 100,
          w: (xMax - xMin) * 100,
          h: Math.max((yMax - yMin) * 100, 1)
        };
      }
      return { type: 'rect', x: 12, y: 31, w: 76, h: 33 };
    }

    if (t.includes('midface') || t.includes('middle third') || t.includes('mid face')) {
      if (landmarks) {
        const xMin = Math.min(landmarks[159].x, landmarks[386].x);
        const xMax = Math.max(landmarks[159].x, landmarks[386].x);
        const yMin = (landmarks[468].y + landmarks[473].y) / 2; // Average of pupils
        const yMax = landmarks[164].y; // Subnasale / just above lip
        return { type: 'rect', x: xMin * 100, y: yMin * 100, w: (xMax - xMin) * 100, h: (yMax - yMin) * 100 };
      }
      return { type: 'rect', x: 30, y: 40, w: 40, h: 30 };
    }

    if (t.includes('jaw') || t.includes('lower third') || t.includes('gonial') || t.includes('mandible')) {
      if (landmarks) {
        const pathIndices = [132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 379, 365, 397, 288, 361];
        const points = pathIndices.map(idx => `${landmarks[idx].x * 100},${landmarks[idx].y * 100}`).join(' ');
        
        return {
          type: 'path',
          points,
          x: 0,
          y: 0,
          w: 100,
          h: 100
        };
      }
      return { type: 'path', points: '', x: 0, y: 0, w: 100, h: 100 };
    }

    if (t.includes('forehead') || t.includes('hairline') || t.includes('upper third')) {
      if (landmarks) {
        const xMin = Math.min(landmarks[54].x, landmarks[284].x);
        const xMax = Math.max(landmarks[54].x, landmarks[284].x);
        const yMin = landmarks[10].y; // Top of forehead
        const yMax = landmarks[9].y; // Glabella
        return { type: 'rect', x: xMin * 100, y: yMin * 100, w: (xMax - xMin) * 100, h: (yMax - yMin) * 100 };
      }
      return { type: 'rect', x: 25, y: 15, w: 50, h: 25 };
    }

    if (t.includes('cheek') || t.includes('zygomatic')) {
      if (landmarks) {
        const leftCheekIndices = [234, 93, 132, 58, 172, 136, 150, 149];
        const rightCheekIndices = [454, 323, 361, 288, 397, 365, 378, 379];
        
        const getBounds = (indices) => {
          const xs = indices.map(i => landmarks[i].x * 100);
          const ys = indices.map(i => landmarks[i].y * 100);
          return {
            x: Math.min(...xs),
            y: Math.min(...ys),
            w: Math.max(...xs) - Math.min(...xs),
            h: Math.max(...ys) - Math.min(...ys)
          };
        };
        
        return {
          type: 'double-glow',
          left: getBounds(leftCheekIndices),
          right: getBounds(rightCheekIndices),
          x: 0,
          y: 0,
          w: 100,
          h: 100
        };
      }
      return { type: 'double-glow', left: {x:20,y:40,w:10,h:10}, right: {x:70,y:40,w:10,h:10}, x:0, y:0, w:100, h:100 };
    }

    if (t.includes('upper eyelid')) {
      if (landmarks) {
        return {
          type: 'double-point',
          left: { x: landmarks[159].x * 100, y: landmarks[159].y * 100 },
          right: { x: landmarks[386].x * 100, y: landmarks[386].y * 100 },
          x: 0,
          y: 0,
          w: 100,
          h: 100
        };
      }
      return { type: 'double-point', left: {x: 35, y: 40}, right: {x: 65, y: 40}, x: 0, y: 0, w: 100, h: 100 };
    }

    let index = null;
    
    if (t.includes('chin') || t.includes('mentolabial') || t.includes('pogonion')) {
      index = 152;
    } else if (t.includes('nose') || t.includes('nasal')) {
      index = 4;
    } else if (t.includes('eye') || t.includes('canthal') || t.includes('ipd')) {
      index = 33;
    } else if (t.includes('lip') || t.includes('mouth') || t.includes('philtrum')) {
      index = 13;
    } else if (t.includes('brow')) {
      index = 105;
    }

    if (landmarks && index !== null && landmarks[index]) {
      const lm = landmarks[index];
      return { type: 'point', x: lm.x * 100, y: lm.y * 100 };
    }
    
    const fallbackCoords = mapFeatureToCoordinates(title, description);
    return fallbackCoords.type === 'rect' ? fallbackCoords : { type: 'point', ...fallbackCoords };
  };

  const bestCoords = bestFeature ? mapKeywordToLandmark(bestFeature.title, bestFeature.description) : null;
  const flawCoords = primaryFlaw ? mapKeywordToLandmark(primaryFlaw.title, primaryFlaw.description) : null;

  const renderHighlight = (coords, color) => {
    if (!coords) return null;

    const ringClass =
      color === 'green'
        ? 'border-emerald-400/80 shadow-[0_0_22px_rgba(34,197,94,0.45)]'
        : 'border-red-400/80 shadow-[0_0_22px_rgba(239,68,68,0.45)]';

    if (coords.type === 'rect') {
      return (
        <div
          className={`absolute rounded-lg border-2 ${ringClass} z-20 pointer-events-none bg-transparent`}
          style={{ left: `${coords.x}%`, top: `${coords.y}%`, width: `${coords.w}%`, height: `${coords.h}%` }}
        />
      );
    }
    if (coords.type === 'glow') {
      return (
        <div
          className={`absolute rounded-full border-2 ${ringClass} z-20 pointer-events-none -translate-x-1/2 -translate-y-1/2`}
          style={{ left: `${coords.x}%`, top: `${coords.y}%`, width: `${coords.w}%`, height: `${coords.h}%` }}
        />
      );
    }
    if (coords.type === 'path' && coords.points) {
      return (
        <svg
          className="absolute inset-0 w-full h-full z-20 pointer-events-none overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <polyline
            points={coords.points}
            fill="none"
            stroke={color === 'green' ? 'rgba(34,197,94,0.95)' : 'rgba(239,68,68,0.95)'}
            strokeWidth="0.35"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="drop-shadow-[0_0_12px_rgba(255,255,255,0.25)]"
          />
        </svg>
      );
    }
    if (coords.type === 'double-glow') {
      return (
        <div className="absolute inset-0 w-full h-full z-20 pointer-events-none">
          <div
            className={`absolute rounded-lg border-2 ${ringClass}`}
            style={{
              left: `${coords.left.x}%`,
              top: `${coords.left.y}%`,
              width: `${coords.left.w}%`,
              height: `${coords.left.h}%`,
            }}
          />
          <div
            className={`absolute rounded-lg border-2 ${ringClass}`}
            style={{
              left: `${coords.right.x}%`,
              top: `${coords.right.y}%`,
              width: `${coords.right.w}%`,
              height: `${coords.right.h}%`,
            }}
          />
        </div>
      );
    }
    if (coords.type === 'double-point') {
      return (
        <div className="absolute inset-0 w-full h-full z-20 pointer-events-none">
          <div
            className={`absolute left-0 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${ringClass}`}
            style={{ left: `${coords.left.x}%`, top: `${coords.left.y}%` }}
          />
          <div
            className={`absolute left-0 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${ringClass}`}
            style={{ left: `${coords.right.x}%`, top: `${coords.right.y}%` }}
          />
        </div>
      );
    }

    return (
      <div
        className={`absolute z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${ringClass}`}
        style={{ left: `${coords.x}%`, top: `${coords.y}%` }}
      />
    );
  };

  return (
    <div className="relative w-60 sm:w-64 md:w-[18rem] aspect-[3/4] shrink-0 bg-[#060708] rounded-2xl overflow-hidden shadow-2xl border border-zinc-800 mx-auto">
      <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0b] via-[#0a0a0b]/20 to-transparent z-10 pointer-events-none" />
      <img 
        ref={imgRef}
        src={activeImageUrl} 
        crossOrigin="anonymous"
        onLoad={() => {
          if (landmarker && imgRef.current) {
            try {
              const result = landmarker.detect(imgRef.current);
              if (result.faceLandmarks && result.faceLandmarks.length > 0) {
                setLandmarks(result.faceLandmarks[0]);
              }
            } catch (e) {
              console.error("Error during load detection:", e);
            }
          }
        }}
        className="absolute inset-0 w-full h-full object-cover object-center scale-[1.14] duration-700"
        alt="face map"
      />
    </div>
  );
};

const DashboardPage = ({ dashboardData, setCurrentPage, userPlan, user, hideTopSection, hideProtocols, hideActionableProtocols, isEmbedded, hideUnlockPotential, hideBestFlawSection, hidePersonalizedFeedback }) => {
  const selectedModel = String(dashboardData?.selectedModel || '').trim();
  const isFreeModelResult = ['3', '4', '5'].includes(selectedModel);
  const hasFullProUnlock = userPlan?.plan === 'pro';
  const isRestrictedPreview = isFreeModelResult && !hasFullProUnlock;
  const showBestFlaw = !hideBestFlawSection;

  const renderBlurredOverlay = (title) => (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0a0a0b]/60 backdrop-blur-[6px] rounded-3xl border border-zinc-800/50 group transition-all select-none">
      <Lock size={32} className="text-yellow-500 mb-3 drop-shadow-[0_0_15px_rgba(234,179,8,0.5)]" />
      <span className="text-white font-black italic uppercase tracking-widest text-lg mb-1 drop-shadow-md">PRO FEATURE</span>
      <span className="text-zinc-300 font-sans text-[10px] uppercase tracking-widest mb-6 text-center px-4 max-w-[min(100%,280px)] leading-relaxed">{title} requires a premium model</span>
      <button 
        onClick={() => setCurrentPage('plans')}
        className="px-6 py-2 bg-gradient-to-r from-yellow-600 to-yellow-500 text-black font-bold uppercase tracking-widest text-xs rounded-full hover:scale-105 transition-transform shadow-[0_0_15px_rgba(234,179,8,0.4)]"
      >
        Upgrade to Pro
      </button>
    </div>
  );

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [potentialImageUrl, setPotentialImageUrl] = useState(null);
  const [unlockError, setUnlockError] = useState(null);
  const [communityPeek, setCommunityPeek] = useState(null);
  const [showAllProtocols, setShowAllProtocols] = useState(false);

  useEffect(() => {
    if (!communityPeek) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [communityPeek]);

  const openCommunityScan = useCallback((scan) => {
    const hydrated = hydrateCommunityScanEntry(scan);
    if (!hydrated?.dashboardData) return;
    setCommunityPeek({
      id: hydrated.id,
      tier: hydrated.tier || null,
      data: {
        ...hydrated.dashboardData,
        selectedModel: String(hydrated.dashboardData?.selectedModel || '1'),
      },
    });
  }, []);

  const handleUnlock = async () => {
    setIsUnlocking(true);
    setUnlockError(null);
    try {
      // ONLY apply to front profile as requested
      const imgSrc = dashboardData?.frontImage;

      if (!imgSrc) {
        setUnlockError(GENERIC_ERROR);
        setIsUnlocking(false);
        return;
      }

      const response = await fetch(imgSrc);
      const blob = await response.blob();

      const formData = new FormData();
      formData.append('image', blob, 'face.jpg');

      const res = await fetch(`${API_BASE}/api/unlock-potential`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (data.success && data.imageUrl) {
        setPotentialImageUrl(data.imageUrl);
        setIsUnlocked(true);
      } else {
        setUnlockError(GENERIC_ERROR);
      }
    } catch (err) {
      console.error('Unlock potential failed:', err);
      setUnlockError(GENERIC_ERROR);
    } finally {
      setIsUnlocking(false);
    }
  };

  const [activeProfileView, setActiveProfileView] = useState('front');
  const [freeRatingLoop, setFreeRatingLoop] = useState(70);

  const isSideView = activeProfileView === 'side';
  const activeCats = isSideView && dashboardData?.sideCategories
    ? dashboardData.sideCategories
    : dashboardData?.categories;

  const defaultRadar = [
    { label: 'Skin', val: 6.4 },
    { label: 'Dimorphism', val: 7.8 },
    { label: 'Symmetry', val: 9.2 },
    { label: 'Harmony', val: 8.5 },
    { label: 'Bone', val: 8.8 }
  ];

  const frForRadar = isSideView
    ? (dashboardData?.sideRating ?? dashboardData?.finalRating)
    : dashboardData?.finalRating;
  const activeHexagon = isSideView ? dashboardData?.hexagonSide : dashboardData?.hexagonFront;
  const radarData =
    hexagonToRadarData(activeHexagon, frForRadar) ||
    (activeCats
      ? [
          { label: 'Skin', val: categoryToRadar10(activeCats.Skin, frForRadar) },
          { label: 'Dimorphism', val: categoryToRadar10(activeCats.Dimorphism, frForRadar) },
          { label: 'Symmetry', val: categoryToRadar10(activeCats.Symmetry, frForRadar) },
          { label: 'Harmony', val: categoryToRadar10(activeCats.Harmony, frForRadar) },
          { label: 'Bone', val: categoryToRadar10(activeCats.Bone, frForRadar) },
        ]
      : defaultRadar);

  const getCatScore = (catName) => {
    if (!dashboardData?.categories) return null;
    const v = dashboardData.categories[catName];
    if (typeof v !== 'number' || Number.isNaN(v)) return null;
    const n = v > 10 ? v / 10 : v;
    return n.toFixed(1);
  };

  const frontMetricData = [
    { label: 'Bigonial Width Ratio', score: 88, max: 100 },
    { label: 'IPD Ratio', score: 92, max: 100 },
    { label: 'Mouth Width Ratio', score: 75, max: 100 },
    { label: 'Upper Third', score: 80, max: 100 },
    { label: 'Middle Third', score: 60, max: 100 },
    { label: 'Lower Third', score: 85, max: 100 },
    { label: 'Eye Height Ratio', score: 45, max: 100 },
    { label: 'Canthal Tilt', score: 35, max: 100 },
    { label: 'Brow Compactness', score: 95, max: 100 },
    { label: 'Philtrum Height', score: 55, max: 100 },
    { label: 'Total Lip Height', score: 70, max: 100 },
    { label: 'fWHR', score: 98, max: 100 },
    { label: 'Midface Ratio', score: 83, max: 100 }
  ];

  const FRONTAL_KEYWORDS = [
    'bigonial', 'ipd', 'mouth', 'nose width', 'upper third', 'middle third',
    'lower third', 'eye height', 'brow compactness', 'philtrum', 'lip height',
    'fwhr', 'midface', 'canthal'
  ];
  const isFrontalMetric = (label) => {
    const low = label.toLowerCase();
    return FRONTAL_KEYWORDS.some(kw => low.includes(kw));
  };
  const frontalBiometrics = dashboardData?.biometrics?.length
    ? dashboardData.biometrics.filter(m => isFrontalMetric(m.label))
    : [];
  const metricData = isSideView
    ? (dashboardData?.sideBiometrics?.length ? dashboardData.sideBiometrics : sideMetricDataGlobal)
    : (frontalBiometrics.length ? frontalBiometrics : frontMetricData);

  const activeImageUrl = activeProfileView === 'front' 
    ? (dashboardData?.frontImage || "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png")
    : (dashboardData?.sideImage || "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png");

  const activeBestFeatures = useMemo(
    () => resolveNormalizedFeatures(dashboardData, 'best', isSideView),
    [dashboardData, isSideView]
  );
  const activePrimaryFlaws = useMemo(
    () => resolveNormalizedFeatures(dashboardData, 'flaw', isSideView),
    [dashboardData, isSideView]
  );
  const primaryBestFeature = showBestFlaw ? activeBestFeatures[0] ?? null : null;
  const primaryFlawFeature = showBestFlaw ? activePrimaryFlaws[0] ?? null : null;
  const appealAssessment = String(dashboardData?.appealAssessment || '').trim();
  const personalizedFeedback = Array.isArray(dashboardData?.personalizedFeedback)
    ? dashboardData.personalizedFeedback.filter((item) => item && (item.title || item.description))
    : [];

  const [activeHover, setActiveHover] = useState(null);

  useEffect(() => {
    if (!isRestrictedPreview) return;
    const interval = setInterval(() => {
      setFreeRatingLoop((prev) => (prev >= 95 ? 70 : prev + 1));
    }, 120);
    return () => clearInterval(interval);
  }, [isRestrictedPreview]);

  const displayedFinalRating = isRestrictedPreview
    ? freeRatingLoop
    : (isSideView
        ? (dashboardData?.sideRating ?? dashboardData?.finalRating ?? 85)
        : (dashboardData?.finalRating ?? 85));

  return (
    <div className={`w-full flex-grow flex flex-col items-center relative font-sans overflow-hidden bg-[#0a0a0b] ${isEmbedded ? '' : 'pt-16 pb-24 px-4 sm:px-6'}`}>
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      {communityPeek && (
        <div
          className="fixed inset-0 z-[200] flex flex-col bg-[#0a0a0b] overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="free-community-scan-title"
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
              <h2 id="free-community-scan-title" className="truncate font-black uppercase italic tracking-tight text-white">
                Community Scan
              </h2>
            </div>
          </header>
          <div className="flex-1 px-4 pb-16 pt-6 md:px-8">
            <DashboardPage
              dashboardData={communityPeek.data}
              setCurrentPage={setCurrentPage}
              userPlan={userPlan}
              user={user}
              hideTopSection
              hideProtocols
              hideActionableProtocols
              isEmbedded
              hideUnlockPotential
              hidePersonalizedFeedback
            />
          </div>
        </div>
      )}
      <style>{`
        @keyframes freeRatingFlicker {
          0%, 100% { opacity: 0.92; filter: blur(10px); }
          25% { opacity: 0.82; filter: blur(8px); }
          50% { opacity: 1; filter: blur(12px); }
          75% { opacity: 0.88; filter: blur(9px); }
        }
      `}</style>
      <FadeUp>
        <div className={`w-full mx-auto flex flex-col gap-12 ${isEmbedded ? '' : 'max-w-6xl'}`}>
          {/* Top Section: Subject & History */}
          {!hideTopSection && (
          <div className="flex flex-col gap-8 hidden">
            {/* Header (Subject Badge) */}
            <div className="flex justify-start">
              <div className="bg-zinc-900/35 px-4 py-3 rounded-3xl border border-zinc-800 shadow-2xl backdrop-blur-xl flex items-center gap-3">
                <div className="w-12 h-12 rounded-full border border-cyan-500/30 p-1 shrink-0">
                  <div className="w-full h-full bg-zinc-800 rounded-full overflow-hidden grayscale">
                    <img src={dashboardData?.frontImage || "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"} alt="Avatar" className="w-full h-full object-cover scale-150 origin-top" />
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-zinc-500 font-sans text-[7px] uppercase tracking-[0.35em] mb-1">Subject</div>
                  <div className="text-xs md:text-sm font-black italic text-zinc-300 uppercase tracking-tight truncate">User_8410</div>
                  <div className="text-zinc-400 text-[10px] uppercase font-sans tracking-widest mt-1">Sex: {dashboardData?.sex || 'Unknown'}</div>
                </div>
              </div>
            </div>

            {/* Face Analysis History Row */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col">
                <h3 className="text-base md:text-lg font-black uppercase tracking-[0.28em] text-[#e4e4e7] font-sans">FACE ANALYSIS 1</h3>
                <span className="text-zinc-500 font-sans text-xs tracking-widest">2026/March/5</span>
              </div>
              
              <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar">
                {/* Card 1 */}
                <div className="shrink-0 w-40 md:w-48 h-24 md:h-28 bg-[#0c0d0e] rounded-2xl border border-zinc-800 flex overflow-hidden shadow-lg">
                <div 
                  className={`flex-1 border-r border-zinc-900 relative cursor-pointer overflow-hidden group ${activeProfileView === 'front' ? 'ring-2 ring-inset ring-cyan-500 z-10' : ''}`}
                  onClick={() => setActiveProfileView('front')}
                >
                  <img src={dashboardData?.frontImage || "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"} className={`w-full h-full object-cover transition-all duration-300 ${activeProfileView === 'front' ? 'opacity-100 grayscale-0 scale-105' : 'opacity-40 grayscale group-hover:opacity-70 group-hover:grayscale-0'}`} alt="Front Profile" />
                  <div className={`absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-cyan-900/50 to-transparent pointer-events-none transition-opacity duration-300 ${activeProfileView === 'front' ? 'opacity-100' : 'opacity-0'}`} />
                </div>
                <div 
                  className={`flex-1 relative cursor-pointer overflow-hidden group ${activeProfileView === 'side' ? 'ring-2 ring-inset ring-cyan-500 z-10' : ''}`}
                  onClick={() => setActiveProfileView('side')}
                >
                  <img src={dashboardData?.sideImage || "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"} className={`w-full h-full object-cover transition-all duration-300 ${activeProfileView === 'side' ? 'opacity-100 grayscale-0 scale-105' : 'opacity-40 grayscale group-hover:opacity-70 group-hover:grayscale-0'}`} style={{objectPosition: 'top'}} alt="Side Profile" />
                  <div className={`absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-cyan-900/50 to-transparent pointer-events-none transition-opacity duration-300 ${activeProfileView === 'side' ? 'opacity-100' : 'opacity-0'}`} />
                </div>
              </div>
              
              {/* Analyze Another Image Button */}
              <div className="shrink-0 w-24 md:w-28 h-24 md:h-28 bg-[#0c0d0e] rounded-2xl border border-zinc-800 flex flex-col items-center justify-center cursor-pointer hover:bg-zinc-900/50 hover:border-zinc-600 transition-all group shadow-lg">
                <div className="w-10 h-10 rounded-full border border-zinc-700 flex items-center justify-center group-hover:border-zinc-500 transition-colors">
                  <span className="text-zinc-500 group-hover:text-zinc-400 transition-colors">
                    <Plus size={16} strokeWidth={1} />
                  </span>
                </div>
              </div>

              {/* Card 2 (Empty) */}
              <div className="shrink-0 w-40 md:w-48 h-24 md:h-28 bg-[#090a0b] rounded-2xl border border-zinc-800/50 flex overflow-hidden flex flex-col justify-center items-center opacity-50">
                <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-900/50" />
              </div>

              {/* Card 3 (Empty) */}
              <div className="shrink-0 w-40 md:w-48 h-24 md:h-28 bg-[#090a0b] rounded-2xl border border-zinc-800/50 flex overflow-hidden flex flex-col justify-center items-center opacity-30">
                <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-900/50" />
              </div>

              {/* Card 4 (Empty) */}
              <div className="shrink-0 w-40 md:w-48 h-24 md:h-28 bg-[#090a0b] rounded-2xl border border-zinc-800/50 flex overflow-hidden flex flex-col justify-center items-center opacity-20">
                <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-900/50" />
              </div>
            </div>
          </div>
          </div>
          )}

          {/* Free vs Pro Adaptive Layout */}
          {isRestrictedPreview ? (
            <>
              <DashboardOverview dashboardData={dashboardData} isRestrictedPreview={isRestrictedPreview} activeProfileView={activeProfileView} />

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="col-span-1 md:col-span-1 flex flex-col gap-6">
                  {/* Left Column Stack: Final Rating then Categories */}
                  <div className="bg-[#0c0d0e] border border-zinc-800 rounded-2xl relative overflow-hidden text-center flex flex-col justify-center h-[180px] shadow-lg group hover:border-zinc-700 transition-colors">
                    <div className="relative z-10 flex flex-col items-center justify-center">
                      <span className="font-sans text-[10px] uppercase tracking-[0.45em] mb-4 text-green-300/80">Final Rating</span>
                      <div className="relative leading-none">
                        <>
                          <span className="absolute inset-0 block text-6xl font-black italic tracking-tighter text-green-400/90 blur-[28px] animate-[freeRatingFlicker_2.4s_ease-in-out_infinite] select-none">
                            {displayedFinalRating}
                          </span>
                          <span className="relative block text-6xl font-black italic tracking-tighter text-green-400 blur-[20px] animate-[freeRatingFlicker_2.4s_ease-in-out_infinite] select-none drop-shadow-[0_0_15px_rgba(74,222,128,0.4)]">
                            {displayedFinalRating}
                          </span>
                        </>
                      </div>
                    </div>
                  </div>
                  <div className="relative bg-[#0c0d0e] rounded-2xl border border-zinc-800 flex items-center justify-center aspect-square shadow-lg group hover:border-zinc-700 transition-colors p-4">
                    {renderBlurredOverlay("Category Scores")}
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(74,222,128,0.05)_0%,transparent_70%)] pointer-events-none" />
                    <div className="w-[85%] max-w-[200px] opacity-10 blur-[14px] pointer-events-none select-none relative z-10">
                      <RadarChart data={radarData} finalScore={dashboardData?.finalRating} />
                    </div>
                  </div>
                </div>

                <div className="col-span-1 md:col-span-3 bg-[#0c0d0e] p-8 rounded-2xl border border-zinc-800 flex flex-col shadow-lg group hover:border-zinc-700 transition-colors">
                  <h3 className="text-zinc-400 font-sans text-xs uppercase tracking-widest mb-6 flex items-center gap-2">
                    <Target size={14} className="text-zinc-500" /> Structure
                  </h3>
                  <div className="flex flex-col md:flex-row gap-8 items-center justify-center flex-grow">
                    <StructureMap 
                      activeImageUrl={activeImageUrl} 
                      bestFeature={primaryBestFeature} 
                      primaryFlaw={primaryFlawFeature} 
                      activeHover={showBestFlaw ? activeHover : null}
                    />
                    <div className="flex-grow space-y-3 w-full flex flex-col justify-center max-w-[15rem]">
                       {!isRestrictedPreview && (
                       <div className="flex gap-2 mb-1 w-full max-w-[13rem] mx-auto md:mx-0">
                         <div onClick={() => setActiveProfileView('front')} className={`relative flex-1 aspect-[6/5] rounded-xl overflow-hidden cursor-pointer border-2 transition-all group-hover/btn:scale-105 ${activeProfileView === 'front' ? 'border-cyan-500 shadow-[0_0_15px_rgba(34,211,238,0.2)]' : 'border-zinc-800 opacity-60 hover:opacity-100'}`}>
                          <img src={dashboardData?.frontImage || "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"} className="w-full h-full object-cover object-center scale-[1.08]" alt="Front" />
                           <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
                           <span className={`absolute bottom-1.5 left-0 right-0 text-center text-[9px] font-sans uppercase tracking-[0.25em] font-bold ${activeProfileView === 'front' ? 'text-cyan-400' : 'text-zinc-400'}`}>Front</span>
                         </div>
                         <div onClick={() => setActiveProfileView('side')} className={`relative flex-1 aspect-[6/5] rounded-xl overflow-hidden cursor-pointer border-2 transition-all group-hover/btn:scale-105 ${activeProfileView === 'side' ? 'border-cyan-500 shadow-[0_0_15px_rgba(34,211,238,0.2)]' : 'border-zinc-800 opacity-60 hover:opacity-100'}`}>
                          <img src={dashboardData?.sideImage || "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"} className="w-full h-full object-cover scale-[1.08]" style={{objectPosition: 'center top'}} alt="Side" />
                           <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
                           <span className={`absolute bottom-1.5 left-0 right-0 text-center text-[9px] font-sans uppercase tracking-[0.25em] font-bold ${activeProfileView === 'side' ? 'text-cyan-400' : 'text-zinc-400'}`}>Side</span>
                         </div>
                       </div>
                       )}
                      {showBestFlaw && (
                        <div className="space-y-4">
                          {primaryBestFeature && (
                            <FeatureHighlightCard type="best" feature={primaryBestFeature} onHover={setActiveHover} />
                          )}
                          {primaryFlawFeature && (
                            <FeatureHighlightCard type="flaw" feature={primaryFlawFeature} onHover={setActiveHover} />
                          )}
                          {!primaryBestFeature && !primaryFlawFeature && (
                            <p className="text-zinc-500 text-[11px] font-sans leading-relaxed">
                              Feature highlights will appear here once the scan returns best features and primary flaws.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="col-span-1 md:col-span-1 flex flex-col gap-6">
                  {/* Left Column Stack: Final Rating then Categories */}
                  <div className="bg-[#0c0d0e] border border-zinc-800 rounded-2xl relative overflow-hidden text-center flex flex-col justify-center h-[180px] shadow-lg group hover:border-zinc-700 transition-colors">
                    <div className="relative z-10 flex flex-col items-center justify-center">
                      <span className="font-sans text-[10px] uppercase tracking-[0.45em] mb-4 text-cyan-400/80">Final Rating</span>
                      <div className="relative leading-none">
                        <span className="block text-6xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white via-cyan-100 to-cyan-500 drop-shadow-[0_0_15px_rgba(34,211,238,0.3)]">
                          {displayedFinalRating}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="relative bg-[#0c0d0e] rounded-2xl border border-zinc-800 flex items-center justify-center aspect-square shadow-lg group hover:border-zinc-700 transition-colors p-4">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.05)_0%,transparent_70%)] pointer-events-none" />
                    <div className="w-[85%] max-w-[200px] relative z-10">
                      <RadarChart data={radarData} finalScore={displayedFinalRating} />
                    </div>
                  </div>
                </div>

                <div className="col-span-1 md:col-span-3 bg-[#0c0d0e] p-8 rounded-2xl border border-zinc-800 flex flex-col shadow-lg group hover:border-zinc-700 transition-colors">
                  <h3 className="text-zinc-400 font-sans text-xs uppercase tracking-widest mb-6 flex items-center gap-2">
                    <Target size={14} className="text-zinc-500" /> Structure
                  </h3>
                  <div className="flex flex-col md:flex-row gap-8 items-center justify-center flex-grow">
                    <StructureMap 
                      activeImageUrl={activeImageUrl} 
                      bestFeature={primaryBestFeature} 
                      primaryFlaw={primaryFlawFeature} 
                      activeHover={showBestFlaw ? activeHover : null}
                    />
                    <div className="flex-grow space-y-3 w-full flex flex-col justify-center max-w-[15rem]">
                       <div className="flex gap-2 mb-1 w-full max-w-[13rem] mx-auto md:mx-0">
                         <div onClick={() => setActiveProfileView('front')} className={`relative flex-1 aspect-[6/5] rounded-xl overflow-hidden cursor-pointer border-2 transition-all group-hover/btn:scale-105 ${activeProfileView === 'front' ? 'border-cyan-500 shadow-[0_0_15px_rgba(34,211,238,0.2)]' : 'border-zinc-800 opacity-60 hover:opacity-100'}`}>
                          <img src={dashboardData?.frontImage || "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"} className="w-full h-full object-cover object-center scale-[1.08]" alt="Front" />
                           <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
                           <span className={`absolute bottom-1.5 left-0 right-0 text-center text-[9px] font-sans uppercase tracking-[0.25em] font-bold ${activeProfileView === 'front' ? 'text-cyan-400' : 'text-zinc-400'}`}>Front</span>
                         </div>
                         <div onClick={() => setActiveProfileView('side')} className={`relative flex-1 aspect-[6/5] rounded-xl overflow-hidden cursor-pointer border-2 transition-all group-hover/btn:scale-105 ${activeProfileView === 'side' ? 'border-cyan-500 shadow-[0_0_15px_rgba(34,211,238,0.2)]' : 'border-zinc-800 opacity-60 hover:opacity-100'}`}>
                          <img src={dashboardData?.sideImage || "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"} className="w-full h-full object-cover scale-[1.08]" style={{objectPosition: 'center top'}} alt="Side" />
                           <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
                           <span className={`absolute bottom-1.5 left-0 right-0 text-center text-[9px] font-sans uppercase tracking-[0.25em] font-bold ${activeProfileView === 'side' ? 'text-cyan-400' : 'text-zinc-400'}`}>Side</span>
                         </div>
                       </div>
                      {showBestFlaw && (
                        <div className="space-y-4">
                          {primaryBestFeature && (
                            <FeatureHighlightCard type="best" feature={primaryBestFeature} onHover={setActiveHover} />
                          )}
                          {primaryFlawFeature && (
                            <FeatureHighlightCard type="flaw" feature={primaryFlawFeature} onHover={setActiveHover} />
                          )}
                          {!primaryBestFeature && !primaryFlawFeature && (
                            <p className="text-zinc-500 text-[11px] font-sans leading-relaxed">
                              Feature highlights will appear here once the scan returns best features and primary flaws.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {!!appealAssessment && (
            <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 shadow-lg transition-colors hover:border-emerald-500/35">
              <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-emerald-300 to-emerald-600" />
              <div className="relative pl-3">
                <h3 className="mb-3 flex items-center gap-2 text-xs font-sans uppercase tracking-widest text-emerald-300">
                  <Sparkles size={14} className="text-emerald-400" /> Appeal Assessment
                </h3>
                <div className="text-sm font-sans leading-relaxed text-zinc-200">
                  {renderMarkedText(appealAssessment)}
                </div>
              </div>
            </div>
          )}

          {/* Detailed Ratios Section */}
          <div className="relative bg-[#0c0d0e] p-6 rounded-2xl border border-zinc-800 flex flex-col shadow-lg group hover:border-zinc-700 transition-colors">
            {isRestrictedPreview && renderBlurredOverlay("Detailed Ratios")}
            <div className={`flex flex-col ${isRestrictedPreview ? 'opacity-30 blur-[6px] pointer-events-none select-none' : ''}`}>
              <h3 className="text-zinc-400 font-sans text-xs uppercase tracking-widest mb-6 flex items-center gap-2"><Activity size={14} className="text-zinc-500" /> Detailed Morphometric Ratios</h3>
              <div className="flex flex-col gap-6">
              {Object.entries(
                metricData.reduce((acc, m) => {
                  const labelLow = m.label.toLowerCase();
                  let cat = 'Other Ratios';
                  if (labelLow.includes('bigonial') || labelLow.includes('fwhr') || labelLow.includes('midface') || labelLow.includes('third') || labelLow.includes('zygo') || labelLow.includes('mandib') || labelLow.includes('chin')) cat = 'Skeletal Structure & Harmony';
                  else if (labelLow.includes('eye') || labelLow.includes('canthal') || labelLow.includes('ipd') || labelLow.includes('brow') || labelLow.includes('pupil')) cat = 'Eye / Upper Third Area';
                  else if (labelLow.includes('lip') || labelLow.includes('philtrum') || labelLow.includes('mouth') || labelLow.includes('nose') || labelLow.includes('naso') || labelLow.includes('mentolabial')) cat = 'Nasal & Peri-Oral Area';
                  if (!acc[cat]) acc[cat] = [];
                  acc[cat].push(m);
                  return acc;
                }, {})
              ).map(([cat, metrics]) => (
                <div key={cat} className="flex flex-col">
                  <h4 className="text-cyan-500/80 font-bold uppercase tracking-widest text-xs mb-3 border-b border-zinc-800/80 pb-2">{cat}</h4>
                  <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 md:grid-cols-3">
                    {metrics.map((m, i) => (
                      <MetricBar key={i} label={m.label} score={m.score} max={m.max || 100} displayValue={m.displayValue} isFreePlan={isRestrictedPreview} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            </div>
          </div>

          {!isRestrictedPreview && <DashboardOverview dashboardData={dashboardData} isRestrictedPreview={isRestrictedPreview} activeProfileView={activeProfileView} />}

          {/* Actionable Protocol */}
          {!hideActionableProtocols && (
            <div className="relative bg-[#0c0d0e] p-8 rounded-2xl border border-zinc-800 shadow-lg group hover:border-zinc-700 transition-colors">
              {isRestrictedPreview && renderBlurredOverlay("Actionable Protocol")}
              <div className={`flex flex-col ${isRestrictedPreview ? 'opacity-30 blur-[6px] pointer-events-none select-none' : ''}`}>
                <h3 className="text-zinc-400 font-sans text-xs uppercase tracking-widest mb-6 flex items-center gap-2 border-b border-zinc-800 pb-4"><Target size={14} className="text-zinc-500" /> Actionable Protocol</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(dashboardData?.protocols && dashboardData.protocols.length > 0
                    ? dashboardData.protocols
                    : [
                        { id: 1, name: 'Reduce Body Fat to 12%', description: 'Will vastly improve buccal framing and expose zygomatic arch', impact: 'Highest Impact' },
                        { id: 2, name: 'Minoxidil for Brows', description: 'Increasing eyebrow density by 15% will heavily boost dimorphism score', impact: 'High Impact' },
                        { id: 3, name: 'Volufiline under eyes', description: 'Will help mask negative canthal tilt and reduce orbital shadowing', impact: 'Medium Impact' },
                      ]
                  ).slice(0, showAllProtocols ? undefined : 3).map((p, i) => {
                    const impactColor = /highest/i.test(p.impact) ? 'text-red-400' : /high/i.test(p.impact) ? 'text-orange-400' : /medium/i.test(p.impact) ? 'text-yellow-400' : 'text-emerald-400';
                    return (
                      <div key={p.id || i} onClick={() => setCurrentPage(`protocol-${p.id || i+1}`)} className="flex bg-zinc-900/50 rounded-xl border border-zinc-800 overflow-hidden hover:border-cyan-500/40 hover:shadow-[0_0_20px_rgba(34,211,238,0.08)] transition-all cursor-pointer group">
                        <div className="bg-zinc-800 flex items-center justify-center px-4 shrink-0"><span className="text-2xl font-black text-zinc-600 group-hover:text-cyan-400 transition-colors">{String(p.id || i+1).padStart(2, '0')}</span></div>
                        <div className="p-4 flex flex-col gap-1 min-w-0">
                          <span className="text-white font-bold uppercase text-sm tracking-widest truncate">{p.name}</span>
                          <span className="text-zinc-500 text-xs font-sans line-clamp-2">{p.description}</span>
                          <span className={`text-[9px] font-sans uppercase tracking-widest mt-1 ${impactColor}`}>{p.impact}</span>
                        </div>
                        <div className="flex items-center pr-4 shrink-0"><ChevronRight size={16} className="text-zinc-700 group-hover:text-cyan-400 transition-colors" /></div>
                      </div>
                    );
                  })}
                </div>
                    {((dashboardData?.protocols && dashboardData.protocols.length > 3) || (!dashboardData?.protocols && 3 > 3)) && (
                      <button onClick={() => setShowAllProtocols(!showAllProtocols)} className="mt-6 self-center px-6 py-2 border border-zinc-700 rounded-full text-zinc-400 text-[10px] font-sans uppercase tracking-widest hover:text-white hover:border-zinc-500 transition-colors flex items-center gap-2">
                        {showAllProtocols ? 'Show Less' : `Show All ${dashboardData?.protocols?.length || 3} Protocols`}
                        <ChevronDown size={14} className={`transition-transform duration-300 ${showAllProtocols ? 'rotate-180' : ''}`} />
                      </button>
                    )}
                    {!dashboardData?.protocols?.length && !isRestrictedPreview && (
                      <p className="text-zinc-600 font-sans text-[10px] uppercase tracking-widest mt-4 text-center">Run a premium analysis to get personalized protocols based on your weak points</p>
                    )}
              </div>
            </div>
          )}

          {!hidePersonalizedFeedback && (
            <div className="relative bg-[#0c0d0e] p-8 rounded-2xl border border-zinc-800 shadow-lg group hover:border-zinc-700 transition-colors">
              {isRestrictedPreview && renderBlurredOverlay("Personalized Feedback")}
              <div className={`flex flex-col ${isRestrictedPreview ? 'opacity-30 blur-[6px] pointer-events-none select-none' : ''}`}>
                <h3 className="text-zinc-400 font-sans text-xs uppercase tracking-widest mb-6 flex items-center gap-2 border-b border-zinc-800 pb-4">
                  <Sparkles size={14} className="text-zinc-500" /> Personalized Feedback
                </h3>
                {personalizedFeedback.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {personalizedFeedback.map((item, index) => (
                      <PersonalizedFeedbackCard
                        key={`${item.id || index}-${item.title || 'feedback'}`}
                        item={item}
                        delay={index * 70}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-zinc-500 text-sm font-sans leading-relaxed">
                    Personalized feedback will appear here once the scan returns individualized tips.
                  </p>
                )}
              </div>
            </div>
          )}

          {!hideUnlockPotential && (
          <div className="bg-gradient-to-br from-zinc-900/80 to-black p-1 rounded-2xl overflow-hidden mt-4 relative shadow-[0_10px_50px_rgba(0,0,0,0.5)] border border-zinc-800/50 group hover:border-zinc-700 transition-colors">
            {isRestrictedPreview && renderBlurredOverlay("Analyze Potential")}
            <div className={`bg-[#0a0a0b] p-8 md:p-12 rounded-[14px] flex flex-col md:flex-row items-center gap-12 relative overflow-hidden ${isRestrictedPreview ? 'opacity-30 blur-[6px] pointer-events-none select-none' : ''}`}>
              
              {/* Glow effect behind the image */}
              {isUnlocked && <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-64 h-64 bg-cyan-500/20 blur-[100px] rounded-full pointer-events-none" />}

              <div className="relative w-48 sm:w-64 aspect-square shrink-0 rounded-2xl overflow-hidden border border-zinc-800 p-6">
                {isUnlocked && potentialImageUrl ? (
                  <img src={potentialImageUrl} className="w-full h-full object-contain opacity-100 transition-all duration-1000 scale-90" alt="Max Potential" />
                ) : isUnlocking ? (
                  <>
                    <img src={activeImageUrl} className="w-full h-full object-contain blur-md opacity-20 transition-all duration-500 scale-90" alt="Generating" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40 backdrop-blur-sm">
                      <div className="relative w-12 h-12">
                        <div className="absolute inset-0 border-2 border-cyan-500/30 rounded-full" />
                        <div className="absolute inset-0 border-2 border-transparent border-t-cyan-400 rounded-full animate-spin" />
                      </div>
                      <span className="text-cyan-400 font-sans text-[10px] uppercase tracking-widest animate-pulse">Generating...</span>
                      <span className="text-zinc-500 font-sans text-[8px] uppercase tracking-widest">AI Enhancement in Progress</span>
                    </div>
                  </>
                ) : (
                  <>
                    <img src={activeImageUrl} className="w-full h-full object-contain blur-sm opacity-30 scale-90" alt="Locked Potential" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Lock className="text-zinc-500 drop-shadow-[0_0_15px_rgba(0,0,0,1)]" size={48} />
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-col flex-1 text-center md:text-left z-10">
                <h3 className="text-3xl font-black italic text-white uppercase tracking-tighter mb-2">Analyze Potential</h3>
                <p className="text-zinc-400 font-sans text-xs leading-relaxed mb-8 max-w-sm mx-auto md:mx-0">Unlock an AI-generated rendering of your exact facial morphology if you perfectly executed the actionable protocol.</p>
                
                {!isUnlocked ? (
                  <div className="flex flex-col gap-3 w-full md:w-auto">
                    <button 
                      onClick={handleUnlock}
                      disabled={isUnlocking}
                      className="bg-cyan-500 hover:bg-cyan-400 text-black font-black uppercase italic tracking-widest px-8 py-4 rounded-xl shadow-[0_0_20px_rgba(34,211,238,0.2)] transition-all flex items-center justify-center gap-3 w-full md:w-auto hover:shadow-[0_0_30px_rgba(34,211,238,0.4)] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isUnlocking ? (
                        <><Loader2 size={20} className="animate-spin" /> GENERATING...</>
                      ) : (
                        <><Unlock size={20} /> {unlockError ? 'RETRY' : 'UNLOCK POTENTIAL'}</>
                      )}
                    </button>
                    {unlockError && (
                      <div className="flex items-center gap-2 bg-red-950/40 border border-red-500/30 rounded-lg px-4 py-2.5">
                        <AlertCircle size={14} className="text-red-400 shrink-0" />
                        <span className="text-red-400 font-sans text-[10px] uppercase tracking-wider">{unlockError}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="animate-[fade-in_1s_ease-out] flex flex-col gap-2">
                    <div className="bg-cyan-900/20 border border-cyan-500/30 rounded-xl p-4 inline-block self-center md:self-start shadow-[0_0_20px_rgba(34,211,238,0.1)] backdrop-blur-md">
                      <span className="text-cyan-400 font-black italic uppercase text-2xl drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">9.4 TIER UNLOCKED</span>
                    </div>
                    <p className="text-[10px] text-cyan-500/70 font-sans uppercase tracking-widest mt-2">{'>'} PROJECTION COMPLETE</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          )}

          {!isEmbedded && isRestrictedPreview && (
            <section className="w-full max-w-6xl mx-auto mt-8 scroll-mt-24">
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
                        className="text-left bg-[#0c0d0e] border border-zinc-800 rounded-[28px] overflow-hidden group cursor-pointer hover:border-cyan-500/50 hover:shadow-[0_0_20px_rgba(34,211,238,0.15)] transition-all relative"
                      >
                        <div className="aspect-[3/4] bg-zinc-900 relative overflow-hidden rounded-[28px]">
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
                          <span className="text-zinc-500 font-sans text-[9px] uppercase tracking-[0.25em]">
                            View results & analysis
                          </span>
                          <ExternalLink size={12} className="text-zinc-600 group-hover:text-cyan-400 transition-colors shrink-0" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {!isEmbedded && (
            <DashboardHubPreviewsCompact
              setCurrentPage={setCurrentPage}
              hideCommunity={isRestrictedPreview}
              onOpenCommunityScan={openCommunityScan}
            />
          )}

        </div>
      </FadeUp>
    </div>
  );
};

const NoiseOverlay = () => (
  <div 
    className="fixed -inset-[100%] pointer-events-none z-[100] opacity-[0.04] mix-blend-overlay"
    style={{
      backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
      animation: 'noiseAnim 0.2s infinite'
    }}
  >
    <style>{`
      @keyframes noiseAnim {
        0%, 100% { transform: translate(0, 0); }
        10% { transform: translate(-1%, -1%); }
        20% { transform: translate(-2%, 1%); }
        30% { transform: translate(1%, -2%); }
        40% { transform: translate(-1%, 3%); }
        50% { transform: translate(-2%, 1%); }
        60% { transform: translate(3%, 0); }
        70% { transform: translate(0, 3%); }
        80% { transform: translate(1%, 1%); }
        90% { transform: translate(-2%, 2%); }
      }
    `}</style>
  </div>
);

const PlansPage = ({ setCurrentPage, user }) => {
  const [tosAgreed, setTosAgreed] = useState(false);

  const handleCheckout = (plan) => {
    if (!tosAgreed) {
      alert("Please agree to the Terms of Service to proceed.");
      return;
    }
    if (!user) {
      setCurrentPage('login');
      return;
    }
    const url = getCheckoutUrl(plan, user);
    if (window.createLemonSqueezy) window.createLemonSqueezy();
    if (window.LemonSqueezy) {
      window.LemonSqueezy.Url.Open(url);
    } else {
      window.open(url, '_blank');
    }
  };

  return (
  <div className="w-full flex flex-col items-center pt-32 pb-24 px-6 font-sans min-h-screen relative">
    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-yellow-500/5 rounded-full blur-[150px] pointer-events-none" />

    <FadeUp>
      <div className="text-center mb-14 max-w-2xl relative z-10 flex flex-col items-center">
        <MogCheckLogoMark size={72} className="w-16 h-16 sm:w-20 sm:h-20 mb-6 opacity-95" />
        <p className="text-yellow-500/80 font-sans text-[10px] uppercase tracking-[0.4em] mb-4">Pricing</p>
        <h1 className="text-5xl sm:text-7xl font-black uppercase tracking-tighter mb-5 italic">
          Choose Your <span className="text-yellow-500 drop-shadow-[0_0_20px_rgba(234,179,8,0.4)]">Path</span>
        </h1>
        <p className="text-zinc-500 font-sans text-xs leading-relaxed uppercase tracking-widest">
          Start free, try a single scan, or go all-in with Pro
        </p>
      </div>
    </FadeUp>

    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full max-w-6xl relative z-10">

      {/* --- Free --- */}
      <FadeUp delay={150}>
        <div className="h-full bg-zinc-900/40 border border-zinc-800 rounded-3xl p-8 md:p-10 flex flex-col hover:border-zinc-700 transition-colors">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center p-1.5">
              <MogCheckLogoIcon size={28} className="opacity-95" />
            </div>
            <div>
              <h3 className="text-xl font-black uppercase italic tracking-tighter text-zinc-200">Free</h3>
              <p className="text-zinc-600 font-sans text-[9px] uppercase tracking-widest">Basic tier</p>
            </div>
          </div>

          <div className="flex items-baseline gap-1 mb-1">
            <span className="text-5xl font-black text-white">$0</span>
            <span className="text-sm text-zinc-600 font-sans tracking-widest">/forever</span>
          </div>
          <p className="text-zinc-400 font-sans text-xs uppercase tracking-wide mb-8">No credit card required</p>

          <div className="w-full h-px bg-zinc-800 mb-8" />

          <p className="text-zinc-500 font-sans text-[10px] uppercase tracking-widest mb-5">What you get</p>
          <ul className="flex flex-col gap-4 text-sm font-sans text-zinc-400 w-full mb-10">
            <li className="flex items-start gap-3"><Check size={15} className="text-zinc-500 mt-0.5 shrink-0" /> <span>Basic appearance overview & general rating</span></li>
            <li className="flex items-start gap-3"><Check size={15} className="text-zinc-500 mt-0.5 shrink-0" /> <span>Structural symmetry snapshot</span></li>
            <li className="flex items-start gap-3"><Check size={15} className="text-zinc-500 mt-0.5 shrink-0" /> <span>1 scan per day</span></li>
            <li className="flex items-start gap-3 text-zinc-600"><X size={15} className="text-zinc-700 mt-0.5 shrink-0" /> <span>No detailed facial biometrics</span></li>
            <li className="flex items-start gap-3 text-zinc-600"><X size={15} className="text-zinc-700 mt-0.5 shrink-0" /> <span>No AI potential analysis</span></li>
            <li className="flex items-start gap-3 text-zinc-600"><X size={15} className="text-zinc-700 mt-0.5 shrink-0" /> <span>No personalized protocols</span></li>
            <li className="flex items-start gap-3 text-zinc-600"><X size={15} className="text-zinc-700 mt-0.5 shrink-0" /> <span>No celebrity lookalike matching</span></li>
          </ul>

          <button onClick={() => setCurrentPage('photo-guide')} className="mt-auto w-full py-3.5 rounded-xl border border-zinc-700 text-zinc-300 font-bold uppercase tracking-widest text-xs hover:bg-zinc-800 hover:text-white transition-all">
            Get Started Free
          </button>
        </div>
      </FadeUp>

      {/* --- Single Scan --- */}
      <FadeUp delay={300}>
        <div className="h-full bg-gradient-to-b from-[#0f1520] via-zinc-900/60 to-[#0c0d0e] border border-cyan-500/30 rounded-3xl p-8 md:p-10 flex flex-col relative hover:border-cyan-500/50 transition-colors shadow-[0_0_60px_rgba(34,211,238,0.04)] hover:shadow-[0_0_60px_rgba(34,211,238,0.1)]">
          <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-cyan-500 text-black px-5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg">Best Value</div>

          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center p-1.5">
              <MogCheckLogoIcon size={28} className="opacity-95 [filter:drop-shadow(0_0_8px_rgba(34,211,238,0.35))]" />
            </div>
            <div>
              <h3 className="text-xl font-black uppercase italic tracking-tighter text-cyan-400">Single Scan</h3>
              <p className="text-cyan-400/40 font-sans text-[9px] uppercase tracking-widest">One-time</p>
            </div>
          </div>

          <div className="flex items-baseline gap-1 mb-1">
            <span className="text-5xl font-black text-white">$8</span>
            <span className="text-sm text-zinc-600 font-sans tracking-widest">/one-time</span>
          </div>
          <p className="text-zinc-400 font-sans text-xs uppercase tracking-wide mb-8">Pay once, no subscription</p>

          <div className="w-full h-px bg-cyan-500/15 mb-8" />

          <p className="text-cyan-400/60 font-sans text-[10px] uppercase tracking-widest mb-5">One full analysis includes</p>
          <ul className="flex flex-col gap-4 text-sm font-sans text-zinc-300 w-full mb-10">
            <li className="flex items-start gap-3"><Check size={15} className="text-cyan-400 mt-0.5 shrink-0" /> <span>1 full-detail AI facial analysis with 40+ measurements</span></li>
            <li className="flex items-start gap-3"><Check size={15} className="text-cyan-400 mt-0.5 shrink-0" /> <span>Exact final rating with detailed ratio breakdown</span></li>
            <li className="flex items-start gap-3"><Check size={15} className="text-cyan-400 mt-0.5 shrink-0" /> <span>Customized personal improvement protocols</span></li>
            <li className="flex items-start gap-3"><Check size={15} className="text-cyan-400 mt-0.5 shrink-0" /> <span>Celebrity lookalike matching & comparison</span></li>
            <li className="flex items-start gap-3 text-zinc-600"><X size={15} className="text-zinc-700 mt-0.5 shrink-0" /> <span>No AI potential analysis</span></li>
            <li className="flex items-start gap-3 text-zinc-600"><X size={15} className="text-zinc-700 mt-0.5 shrink-0" /> <span>No progress tracking</span></li>
          </ul>

          <div className="mt-auto flex flex-col gap-4">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input 
                type="checkbox" 
                className="mt-1 shrink-0 cursor-pointer accent-cyan-500" 
                checked={tosAgreed}
                onChange={(e) => setTosAgreed(e.target.checked)}
              />
              <span className="text-zinc-500 font-sans text-[10px] leading-tight group-hover:text-zinc-400 transition-colors">
                I agree to the <a href="/tos" onClick={(e) => { e.preventDefault(); setCurrentPage('tos'); }} className="text-cyan-400 hover:text-cyan-300 underline">Terms of Service</a> and acknowledge that I lose my right to a refund once the AI analysis is generated.
              </span>
            </label>
            <button onClick={() => handleCheckout('single_scan')} className="w-full py-3.5 rounded-xl bg-gradient-to-r from-cyan-600 to-cyan-400 text-black font-black uppercase tracking-widest text-xs hover:scale-[1.02] transition-transform shadow-[0_0_25px_rgba(34,211,238,0.25)] flex items-center justify-center gap-2">
              <Zap size={14} /> Buy Single Scan
            </button>
          </div>
        </div>
      </FadeUp>

      {/* --- MogCheck Pro --- */}
      <FadeUp delay={450}>
        <div className="h-full bg-gradient-to-b from-[#1a1600] via-zinc-900/80 to-[#0c0d0e] border border-yellow-500/40 rounded-3xl p-8 md:p-10 flex flex-col relative shadow-[0_0_80px_rgba(234,179,8,0.08)] hover:shadow-[0_0_80px_rgba(234,179,8,0.15)] transition-shadow">
          <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-yellow-600 to-yellow-400 text-black px-5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg">Unlimited</div>

          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center p-1.5">
              <MogCheckLogoIcon size={28} className="opacity-95 [filter:drop-shadow(0_0_8px_rgba(234,179,8,0.4))]" />
            </div>
            <div>
              <h3 className="text-xl font-black uppercase italic tracking-tighter text-yellow-500">MogCheck Pro</h3>
              <p className="text-yellow-500/40 font-sans text-[9px] uppercase tracking-widest">Full access</p>
            </div>
          </div>

          <div className="flex items-baseline gap-1 mb-1">
            <span className="text-5xl font-black text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]">$23</span>
            <span className="text-sm text-zinc-500 font-sans tracking-widest">/mo</span>
          </div>
          <p className="text-zinc-400 font-sans text-xs uppercase tracking-wide mb-8">Cancel anytime, no commitment</p>

          <div className="w-full h-px bg-yellow-500/15 mb-8" />

          <p className="text-yellow-500/60 font-sans text-[10px] uppercase tracking-widest mb-5">Everything in Single Scan, plus</p>
          <ul className="flex flex-col gap-4 text-sm font-sans text-zinc-300 w-full mb-10">
            <li className="flex items-start gap-3"><Check size={15} className="text-yellow-500 mt-0.5 shrink-0" /> <span>Up to 2 full scans per day</span></li>
            <li className="flex items-start gap-3"><Check size={15} className="text-yellow-500 mt-0.5 shrink-0" /> <span>AI potential analysis - see your projected best self</span></li>
            <li className="flex items-start gap-3"><Check size={15} className="text-yellow-500 mt-0.5 shrink-0" /> <span>Full-detail AI facial analysis with 40+ biometric measurements</span></li>
            <li className="flex items-start gap-3"><Check size={15} className="text-yellow-500 mt-0.5 shrink-0" /> <span>Customized personal improvement protocols</span></li>
            <li className="flex items-start gap-3"><Check size={15} className="text-yellow-500 mt-0.5 shrink-0" /> <span>Celebrity lookalike matching & comparison</span></li>
            <li className="flex items-start gap-3"><Check size={15} className="text-yellow-500 mt-0.5 shrink-0" /> <span>Progress tracking dashboard</span></li>
            <li className="flex items-start gap-3"><Check size={15} className="text-yellow-500 mt-0.5 shrink-0" /> <span>Exact final rating with detailed ratio breakdown</span></li>
          </ul>

          <div className="mt-auto flex flex-col gap-4">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input 
                type="checkbox" 
                className="mt-1 shrink-0 cursor-pointer accent-yellow-500" 
                checked={tosAgreed}
                onChange={(e) => setTosAgreed(e.target.checked)}
              />
              <span className="text-zinc-500 font-sans text-[10px] leading-tight group-hover:text-zinc-400 transition-colors">
                I agree to the <a href="/tos" onClick={(e) => { e.preventDefault(); setCurrentPage('tos'); }} className="text-yellow-500 hover:text-yellow-400 underline">Terms of Service</a> and acknowledge that I lose my right to a refund once the AI analysis is generated.
              </span>
            </label>
            <button onClick={() => handleCheckout('pro')} className="w-full py-3.5 rounded-xl bg-gradient-to-r from-yellow-600 to-yellow-400 text-black font-black uppercase tracking-widest text-xs hover:scale-[1.02] transition-transform shadow-[0_0_25px_rgba(234,179,8,0.3)] flex items-center justify-center gap-2">
              <Crown size={14} /> Upgrade to Pro
            </button>
          </div>
        </div>
      </FadeUp>
    </div>

    <FadeUp delay={600}>
      <div className="mt-20 w-full max-w-4xl relative z-10">
        <p className="text-center text-zinc-600 font-sans text-[10px] uppercase tracking-widest mb-10">Why upgrade?</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { icon: <Target size={18} />, title: 'Precision', desc: '40+ facial measurements using advanced AI biometric models' },
            { icon: <TrendingUp size={18} />, title: 'Potential', desc: 'AI forecasts your achievable look with surgery or softmaxxing' },
            { icon: <Shield size={18} />, title: 'Protocols', desc: 'Personalized step-by-step plans built around your exact facial structure' },
          ].map((item, i) => (
            <div key={i} className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-6 text-center hover:border-zinc-700 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center mx-auto mb-4 text-zinc-400">{item.icon}</div>
              <h4 className="text-white font-bold uppercase text-xs tracking-widest mb-2">{item.title}</h4>
              <p className="text-zinc-500 font-sans text-[10px] leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </FadeUp>

    <FadeUp delay={700}>
      <p className="mt-16 text-zinc-600 font-sans text-[10px] uppercase tracking-widest text-center relative z-10">
        Secure payment via Lemon Squeezy Â· Cancel anytime Â· Instant access
      </p>
    </FadeUp>
  </div>
  );
};

// --- Admin Dashboard ---
const AdminDashboardPage = ({ setCurrentPage }) => {
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [activeTab, setActiveTab] = useState('stats'); // 'stats' | 'users'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [expandedPlanUserId, setExpandedPlanUserId] = useState(null);
  const [userScansByUser, setUserScansByUser] = useState({});
  const [userScansLoading, setUserScansLoading] = useState({});
  const [userScansError, setUserScansError] = useState({});
  const [userMogBattlesByUser, setUserMogBattlesByUser] = useState({});
  const [userMogBattlesLoading, setUserMogBattlesLoading] = useState({});
  const [userMogBattlesError, setUserMogBattlesError] = useState({});
  const [planDrafts, setPlanDrafts] = useState({});
  const [planSaveLoading, setPlanSaveLoading] = useState({});
  const [planSaveError, setPlanSaveError] = useState({});
  const storedPw = useRef('');

  const fetchStats = async (pw) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/admin/stats`, { headers: { 'x-admin-password': pw } });
      if (!res.ok) {
        if (res.status === 401) {
          setAuthenticated(false);
          setError('Invalid password');
          return false;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setStats(data);
      
      const usersRes = await fetch(`${API_BASE}/api/admin/users`, { headers: { 'x-admin-password': pw } });
      const usersData = await usersRes.json().catch(() => ({}));
      if (!usersRes.ok) {
        throw new Error(usersData?.error || `Users endpoint failed (${usersRes.status})`);
      }
      setUsers(Array.isArray(usersData.users) ? usersData.users : []);
      
      setLastRefresh(new Date());
      setAuthenticated(true);
      return true;
    } catch (e) {
      setError(e.message);
      setAuthenticated(false);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    const pw = password.trim();
    if (!pw) return;
    storedPw.current = pw;
    fetchStats(pw);
  };

  useEffect(() => {
    if (!authenticated) return;
    const iv = setInterval(() => fetchStats(storedPw.current), 30000);
    return () => clearInterval(iv);
  }, [authenticated]);

  const fmtUptime = (ms) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const fmtDuration = (ms) => {
    if (!ms) return '-';
    return ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : `${(ms / 1000).toFixed(0)}s`;
  };

  const modelLabel = (m) => ({ '1': 'Premium', '2': 'Fun mode', '3': 'Free' }[m] || m);

  const handleDeleteUser = async (uid, email) => {
    if (!window.confirm(`Are you sure you want to permanently delete user ${email}?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${uid}`, {
        method: 'DELETE',
        headers: { 'x-admin-password': storedPw.current }
      });
      if (!res.ok) throw new Error('Failed to delete user');
      setUsers(users.filter(u => u.uid !== uid));
    } catch (err) {
      alert(err.message);
    }
  };

  const handleToggleUserPlan = (uid, currentPlan, currentCredits) => {
    if (expandedPlanUserId === uid) {
      setExpandedPlanUserId(null);
      return;
    }

    setExpandedPlanUserId(uid);
    setPlanSaveError((prev) => ({ ...prev, [uid]: '' }));
    setPlanDrafts((prev) => ({
      ...prev,
      [uid]: prev[uid] || {
        plan: currentPlan || 'free',
        scanCredits: Number.isFinite(Number(currentCredits)) ? Number(currentCredits) : 0,
      },
    }));
  };

  const handlePlanDraftChange = (uid, field, value) => {
    setPlanDrafts((prev) => {
      const existing = prev[uid] || { plan: 'free', scanCredits: 0 };
      return {
        ...prev,
        [uid]: {
          ...existing,
          [field]: field === 'scanCredits' ? value : value,
        },
      };
    });
  };

  const handleUpdatePlan = async (uid) => {
    const draft = planDrafts[uid] || { plan: 'free', scanCredits: 0 };
    const normalizedPlan = String(draft.plan || 'free').trim().toLowerCase();
    const normalizedCredits = Math.max(0, parseInt(draft.scanCredits, 10) || 0);
    if (!['free', 'pro', 'single_scan'].includes(normalizedPlan)) {
      setPlanSaveError((prev) => ({ ...prev, [uid]: 'Plan must be free, pro, or single_scan.' }));
      return;
    }

    setPlanSaveLoading((prev) => ({ ...prev, [uid]: true }));
    setPlanSaveError((prev) => ({ ...prev, [uid]: '' }));
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${uid}/plan`, {
        method: 'POST',
        headers: { 'x-admin-password': storedPw.current, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: normalizedPlan, scanCredits: normalizedCredits })
      });
      if (!res.ok) throw new Error('Failed to update plan');
      setUsers((prev) =>
        prev.map((user) =>
          user.uid === uid
            ? { ...user, plan: normalizedPlan, scanCredits: normalizedCredits }
            : user
        )
      );
      setExpandedPlanUserId(null);
      fetchStats(storedPw.current);
    } catch (err) {
      setPlanSaveError((prev) => ({ ...prev, [uid]: err.message }));
    } finally {
      setPlanSaveLoading((prev) => ({ ...prev, [uid]: false }));
    }
  };

  const handleToggleUserScans = async (uid) => {
    if (expandedUserId === uid) {
      setExpandedUserId(null);
      return;
    }

    setExpandedUserId(uid);
    if (userScansByUser[uid] && userMogBattlesByUser[uid]) return;

    setUserScansLoading((prev) => ({ ...prev, [uid]: !userScansByUser[uid] }));
    setUserScansError((prev) => ({ ...prev, [uid]: '' }));
    setUserMogBattlesLoading((prev) => ({ ...prev, [uid]: !userMogBattlesByUser[uid] }));
    setUserMogBattlesError((prev) => ({ ...prev, [uid]: '' }));
    try {
      const requests = [];

      if (!userScansByUser[uid]) {
        requests.push(
          fetch(`${API_BASE}/api/admin/users/${uid}/scans`, {
            headers: { 'x-admin-password': storedPw.current }
          }).then(async (res) => {
            if (!res.ok) throw new Error('Failed to fetch scans');
            const data = await res.json();
            setUserScansByUser((prev) => ({ ...prev, [uid]: data.scans || [] }));
          })
        );
      }

      if (!userMogBattlesByUser[uid]) {
        requests.push(
          fetch(`${API_BASE}/api/admin/users/${uid}/mog-battles`, {
            headers: { 'x-admin-password': storedPw.current }
          }).then(async (res) => {
            if (!res.ok) throw new Error('Failed to fetch Mog Battles');
            const data = await res.json();
            setUserMogBattlesByUser((prev) => ({ ...prev, [uid]: data.battles || [] }));
          })
        );
      }

      await Promise.all(requests);
    } catch (err) {
      const message = err.message || 'Failed to fetch user data';
      setUserScansError((prev) => ({ ...prev, [uid]: message }));
      setUserMogBattlesError((prev) => ({ ...prev, [uid]: message }));
    } finally {
      setUserScansLoading((prev) => ({ ...prev, [uid]: false }));
      setUserMogBattlesLoading((prev) => ({ ...prev, [uid]: false }));
    }
  };

  const handleDeleteUserScan = async (uid, scanId) => {
    try {
      const delRes = await fetch(`${API_BASE}/api/admin/users/${uid}/scans/${scanId}`, {
        method: 'DELETE',
        headers: { 'x-admin-password': storedPw.current }
      });
      if (!delRes.ok) throw new Error('Failed to delete scan');
      setUserScansByUser((prev) => ({
        ...prev,
        [uid]: Array.isArray(prev[uid]) ? prev[uid].filter((scan) => scan.id !== scanId) : [],
      }));
    } catch (err) {
      setUserScansError((prev) => ({ ...prev, [uid]: err.message }));
    }
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 pt-24">
        <div className="w-full max-w-sm">
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-8 backdrop-blur-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center p-1.5">
                <MogCheckLogoIcon size={30} className="opacity-95" />
              </div>
              <div>
                <h2 className="text-lg font-bold tracking-tight">Admin Access</h2>
                <p className="text-[10px] font-sans text-zinc-500 uppercase tracking-widest">Restricted Area</p>
              </div>
            </div>
            <form onSubmit={handleLogin}>
              <div className="relative mb-4">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter admin password"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-sans text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 transition-colors pr-10"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {error && <p className="text-red-400 text-xs font-sans mb-3">{error}</p>}
              <button type="submit" disabled={!password.trim()} className="w-full py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 font-sans text-xs uppercase tracking-widest hover:bg-cyan-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                Authenticate
              </button>
            </form>
            <button onClick={() => setCurrentPage('home')} className="w-full mt-3 py-2 text-zinc-600 text-[10px] font-sans uppercase tracking-widest hover:text-zinc-400 transition-colors">
              &larr; Back to site
            </button>
          </div>
        </div>
      </div>
    );
  }

  const ov = stats?.overview || {};
  const maxHour = stats?.hourlyUsage ? Math.max(...stats.hourlyUsage, 1) : 1;

  return (
    <div className="min-h-screen pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center p-1.5">
            <MogCheckLogoIcon size={30} className="opacity-95" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight">ADMIN PANEL</h1>
            <p className="text-[10px] font-sans text-zinc-500 uppercase tracking-widest">
              {lastRefresh ? `Last refresh: ${lastRefresh.toLocaleTimeString()}` : 'Loading...'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => fetchStats(storedPw.current)} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-sans uppercase tracking-widest hover:text-cyan-400 hover:border-cyan-500/30 transition-all disabled:opacity-40">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={() => { setAuthenticated(false); setStats(null); setPassword(''); setCurrentPage('home'); }} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-sans uppercase tracking-widest hover:text-red-400 hover:border-red-500/30 transition-all">
            <LogOut size={13} /> Exit
          </button>
        </div>
      </div>

      {error && <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-sans">{error}</div>}

      {stats && (
        <>
          <div className="flex items-center gap-4 border-b border-zinc-800 mb-6 pb-2">
            <button onClick={() => setActiveTab('stats')} className={`text-xs font-sans uppercase tracking-widest font-bold pb-2 border-b-2 transition-colors ${activeTab === 'stats' ? 'text-cyan-400 border-cyan-400' : 'text-zinc-500 border-transparent hover:text-zinc-300'}`}>System Stats</button>
            <button onClick={() => setActiveTab('users')} className={`text-xs font-sans uppercase tracking-widest font-bold pb-2 border-b-2 transition-colors ${activeTab === 'users' ? 'text-cyan-400 border-cyan-400' : 'text-zinc-500 border-transparent hover:text-zinc-300'}`}>User Management ({users.length})</button>
          </div>

          {activeTab === 'stats' && (
            <>
              {/* Overview Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Analyses Today', value: ov.totalToday, sub: `${ov.totalAll} total`, icon: BarChart3, color: 'cyan' },
              { label: 'Success Rate', value: `${ov.successRate}%`, sub: `${ov.failToday} failed today`, icon: TrendingUp, color: ov.successRate >= 80 ? 'emerald' : ov.successRate >= 50 ? 'amber' : 'red' },
              { label: 'Avg Duration', value: fmtDuration(ov.avgDurationMs), sub: 'successful scans', icon: Clock, color: 'violet' },
              { label: 'Server Uptime', value: fmtUptime(ov.uptimeMs), sub: `${ov.diskUsageMB} MB uploads`, icon: Server, color: 'orange' },
            ].map((card, i) => (
              <div key={i} className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5 relative overflow-hidden">
                <div className={`absolute top-0 right-0 w-20 h-20 rounded-full bg-${card.color}-500/5 -translate-y-1/2 translate-x-1/2`} />
                <card.icon size={16} className={`text-${card.color}-400 mb-3`} />
                <p className="text-2xl font-black tracking-tight">{card.value}</p>
                <p className="text-[10px] font-sans text-zinc-500 uppercase tracking-widest mt-1">{card.label}</p>
                <p className="text-[9px] font-sans text-zinc-600 mt-0.5">{card.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {/* API Key Health */}
            <div className="lg:col-span-2 bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Key size={14} className="text-cyan-400" />
                <h3 className="font-sans text-xs uppercase tracking-widest text-zinc-300">Gemini API Key Health</h3>
              </div>
              <div className="space-y-3">
                {(stats.keyHealth || []).map((k) => (
                  <div key={k.key} className="flex items-center gap-3">
                    <span className="text-[10px] font-sans text-zinc-500 w-12 shrink-0">KEY {k.key}</span>
                    <div className="flex-grow h-2.5 bg-zinc-950 rounded-full overflow-hidden relative">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${k.exhausted ? 'bg-gradient-to-r from-red-600 to-red-400' : 'bg-gradient-to-r from-cyan-600 to-cyan-400'}`}
                        style={{ width: `${k.exhausted ? 100 : Math.min(100, (k.attempts / 250) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-sans text-zinc-500 w-16 text-right shrink-0">{k.attempts}/250</span>
                    <span className="w-5 shrink-0 text-center">
                      {k.exhausted
                        ? <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                        : <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                      }
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[9px] font-sans text-zinc-600 mt-3">Quota resets daily. Attempts tracked from Python stdout during this server session.</p>
            </div>

            {/* Model Breakdown */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Zap size={14} className="text-violet-400" />
                <h3 className="font-sans text-xs uppercase tracking-widest text-zinc-300">Model Usage</h3>
              </div>
              {(() => {
                const total = (stats.modelBreakdown?.ultra || 0) + (stats.modelBreakdown?.free || 0);
                const uPct = total > 0 ? Math.round((stats.modelBreakdown.ultra / total) * 100) : 0;
                const fPct = total > 0 ? 100 - uPct : 0;
                return (
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between mb-1.5">
                        <span className="text-xs font-sans text-cyan-400 uppercase tracking-widest">Premium</span>
                        <span className="text-xs font-sans text-zinc-400">{stats.modelBreakdown?.ultra || 0} ({uPct}%)</span>
                      </div>
                      <div className="h-2.5 bg-zinc-950 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 rounded-full transition-all" style={{ width: `${uPct}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between mb-1.5">
                        <span className="text-xs font-sans text-emerald-400 uppercase tracking-widest">Free</span>
                        <span className="text-xs font-sans text-zinc-400">{stats.modelBreakdown?.free || 0} ({fPct}%)</span>
                      </div>
                      <div className="h-2.5 bg-zinc-950 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all" style={{ width: `${fPct}%` }} />
                      </div>
                    </div>
                    <div className="text-center pt-2 border-t border-zinc-800/50">
                      <p className="text-3xl font-black">{total}</p>
                      <p className="text-[9px] font-sans text-zinc-500 uppercase tracking-widest">Total analyses</p>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Hourly Activity Chart */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Activity size={14} className="text-emerald-400" />
              <h3 className="font-sans text-xs uppercase tracking-widest text-zinc-300">Today's Activity</h3>
            </div>
            <div className="flex items-end gap-[3px] h-24">
              {(stats.hourlyUsage || Array(24).fill(0)).map((count, i) => {
                const h = maxHour > 0 ? (count / maxHour) * 100 : 0;
                const now = new Date().getHours();
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div className="w-full rounded-t-sm transition-all duration-300 group-hover:opacity-80 relative" style={{ height: `${Math.max(h, 2)}%`, background: i === now ? 'linear-gradient(to top, #06b6d4, #22d3ee)' : count > 0 ? 'linear-gradient(to top, #27272a, #3f3f46)' : '#18181b' }}>
                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-zinc-800 px-1.5 py-0.5 rounded text-[8px] font-sans text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                        {count} scan{count !== 1 ? 's' : ''} at {i}:00
                      </div>
                    </div>
                    {i % 4 === 0 && <span className="text-[7px] font-sans text-zinc-600">{i}</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Analyses Table */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Clock size={14} className="text-amber-400" />
              <h3 className="font-sans text-xs uppercase tracking-widest text-zinc-300">Recent Analyses</h3>
              <span className="ml-auto text-[9px] font-sans text-zinc-600">{stats.recentAnalyses?.length || 0} records</span>
            </div>
            {(!stats.recentAnalyses || stats.recentAnalyses.length === 0) ? (
              <div className="text-center py-12">
                <BarChart3 size={32} className="text-zinc-700 mx-auto mb-3" />
                <p className="text-zinc-600 text-xs font-sans uppercase tracking-widest">No analyses recorded yet</p>
                <p className="text-zinc-700 text-[10px] font-sans mt-1">Run a scan to see data here</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-zinc-800/50">
                      {['Time', 'Model', 'Status', 'Rating', 'Duration', 'Details'].map(h => (
                        <th key={h} className="text-[9px] font-sans text-zinc-500 uppercase tracking-widest pb-2 pr-4">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentAnalyses.map((a, i) => (
                      <tr key={a.id || i} className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                        <td className="py-2.5 pr-4 text-[11px] font-sans text-zinc-400">
                          {new Date(a.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className={`text-[10px] font-sans px-2 py-0.5 rounded-full ${['1','2'].includes(a.model) ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'}`}>
                            {modelLabel(a.model)}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          {a.success
                            ? <span className="inline-flex items-center gap-1 text-emerald-400 text-[10px] font-sans"><Check size={10} /> OK</span>
                            : <span className="inline-flex items-center gap-1 text-red-400 text-[10px] font-sans"><X size={10} /> FAIL</span>
                          }
                        </td>
                        <td className="py-2.5 pr-4 text-[11px] font-sans text-zinc-300">
                          {a.rating != null ? `${a.rating}/100` : '-'}
                          {a.sideRating != null && <span className="text-zinc-600 ml-1">| {a.sideRating}</span>}
                        </td>
                        <td className="py-2.5 pr-4 text-[11px] font-sans text-zinc-400">{fmtDuration(a.durationMs)}</td>
                        <td className="py-2.5 text-[10px] font-sans text-zinc-600 max-w-[200px] truncate">{a.error || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
            </>
          )}

          {activeTab === 'users' && (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-cyan-400" />
                  <h3 className="font-sans text-xs uppercase tracking-widest text-zinc-300">Registered Users</h3>
                </div>
                <span className="text-[9px] font-sans text-zinc-600">{users.length} users found</span>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-zinc-800/50">
                      <th className="text-[9px] font-sans text-zinc-500 uppercase tracking-widest pb-2 pr-4">User</th>
                      <th className="text-[9px] font-sans text-zinc-500 uppercase tracking-widest pb-2 pr-4">Plan / Credits</th>
                      <th className="text-[9px] font-sans text-zinc-500 uppercase tracking-widest pb-2 pr-4">Status / IP</th>
                      <th className="text-[9px] font-sans text-zinc-500 uppercase tracking-widest pb-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const isActive = u.lastActive && (new Date() - new Date(u.lastActive)) < 5 * 60 * 1000;
                      const isExpanded = expandedUserId === u.uid;
                      const isPlanExpanded = expandedPlanUserId === u.uid;
                      const scans = userScansByUser[u.uid] || [];
                      const scansLoading = !!userScansLoading[u.uid];
                      const scansError = userScansError[u.uid];
                      const mogBattles = userMogBattlesByUser[u.uid] || [];
                      const mogBattlesLoading = !!userMogBattlesLoading[u.uid];
                      const mogBattlesError = userMogBattlesError[u.uid];
                      const planDraft = planDrafts[u.uid] || { plan: u.plan || 'free', scanCredits: u.scanCredits ?? 0 };
                      const isSavingPlan = !!planSaveLoading[u.uid];
                      const planError = planSaveError[u.uid];
                      return (
                        <React.Fragment key={u.uid}>
                          <tr className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                            <td className="py-3 pr-4">
                              <div className="font-sans text-xs text-zinc-300">{u.email}</div>
                              <div className="font-sans text-[10px] text-zinc-600 truncate max-w-[150px]">{u.uid}</div>
                            </td>
                            <td className="py-3 pr-4">
                              <div className="font-sans text-[11px] text-cyan-400 uppercase tracking-wider">{u.plan}</div>
                              <div className="font-sans text-[10px] text-zinc-500">{u.scanCredits} credits</div>
                            </td>
                            <td className="py-3 pr-4">
                              <div className="flex items-center gap-1.5">
                                <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-zinc-600'}`}></span>
                                <span className="font-sans text-[11px] text-zinc-400">{isActive ? 'Online' : (u.lastActive ? new Date(u.lastActive).toLocaleString() : 'Never')}</span>
                              </div>
                              <div className="font-sans text-[10px] text-zinc-600 mt-0.5">{u.lastIp}</div>
                            </td>
                            <td className="py-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button onClick={() => handleToggleUserScans(u.uid)} className={`px-2 py-1 rounded text-[10px] font-sans uppercase tracking-widest transition-colors ${isExpanded ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-300' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'}`}>{isExpanded ? 'Hide' : 'Scans'}</button>
                                <button onClick={() => handleToggleUserPlan(u.uid, u.plan, u.scanCredits)} className={`px-2 py-1 rounded text-[10px] font-sans uppercase tracking-widest transition-colors ${isPlanExpanded ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-300' : 'bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'}`}>{isPlanExpanded ? 'Hide' : 'Plan'}</button>
                                <button onClick={() => handleDeleteUser(u.uid, u.email)} className="px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded text-[10px] font-sans uppercase tracking-widest transition-colors">Del</button>
                              </div>
                            </td>
                          </tr>
                          {isPlanExpanded && (
                            <tr className="border-b border-zinc-800/30 bg-zinc-950/40">
                              <td colSpan={4} className="px-4 py-4">
                                <div className="rounded-2xl border border-zinc-800 bg-black/30 p-4">
                                  <div className="mb-4 flex items-center justify-between gap-3">
                                    <div>
                                      <p className="text-[10px] font-sans uppercase tracking-[0.28em] text-zinc-500">Plan editor</p>
                                      <h4 className="mt-1 text-sm font-black uppercase tracking-widest text-zinc-100">{u.email}</h4>
                                    </div>
                                    <span className="text-[10px] font-sans uppercase tracking-widest text-zinc-600">Update access</span>
                                  </div>
                                  <div className="grid gap-4 md:grid-cols-[minmax(0,220px)_minmax(0,180px)_auto] md:items-end">
                                    <label className="block">
                                      <span className="mb-2 block text-[10px] font-sans uppercase tracking-[0.24em] text-zinc-500">Plan</span>
                                      <select
                                        value={planDraft.plan}
                                        onChange={(e) => handlePlanDraftChange(u.uid, 'plan', e.target.value)}
                                        className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm font-sans text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
                                      >
                                        <option value="free">free</option>
                                        <option value="pro">pro</option>
                                        <option value="single_scan">single_scan</option>
                                      </select>
                                    </label>
                                    <label className="block">
                                      <span className="mb-2 block text-[10px] font-sans uppercase tracking-[0.24em] text-zinc-500">Scan credits</span>
                                      <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={planDraft.scanCredits}
                                        onChange={(e) => handlePlanDraftChange(u.uid, 'scanCredits', e.target.value)}
                                        className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm font-sans text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
                                      />
                                    </label>
                                    <div className="flex gap-2 md:justify-end">
                                      <button
                                        onClick={() => setExpandedPlanUserId(null)}
                                        className="rounded-xl border border-zinc-700 bg-zinc-900/70 px-4 py-3 text-[10px] font-sans uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => handleUpdatePlan(u.uid)}
                                        disabled={isSavingPlan}
                                        className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-[10px] font-sans uppercase tracking-[0.24em] text-cyan-300 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
                                      >
                                        {isSavingPlan ? 'Saving...' : 'Save plan'}
                                      </button>
                                    </div>
                                  </div>
                                  {planError && (
                                    <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs font-sans text-red-400">
                                      {planError}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                          {isExpanded && (
                            <tr className="border-b border-zinc-800/30 bg-zinc-950/50">
                              <td colSpan={4} className="px-4 py-4">
                                <div className="rounded-2xl border border-zinc-800 bg-black/30 p-4">
                                  <div className="mb-4 flex items-center justify-between gap-3">
                                    <div>
                                      <p className="text-[10px] font-sans uppercase tracking-[0.28em] text-zinc-500">User scans</p>
                                      <h4 className="mt-1 text-sm font-black uppercase tracking-widest text-zinc-100">{u.email}</h4>
                                    </div>
                                    <span className="text-[10px] font-sans uppercase tracking-widest text-zinc-600">{scans.length} records</span>
                                  </div>
                                  {scansLoading ? (
                                    <div className="py-8 text-center text-zinc-500 text-xs font-sans uppercase tracking-widest">Loading scans...</div>
                                  ) : scansError ? (
                                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs font-sans text-red-400">{scansError}</div>
                                  ) : scans.length === 0 ? (
                                    <div className="py-8 text-center text-zinc-500 text-xs font-sans uppercase tracking-widest">No scans found for this user.</div>
                                  ) : (
                                    <div className="space-y-3">
                                      {scans.map((scan) => {
                                        const frontImage = scan.frontImageUrl || scan.payload?.frontImage || null;
                                        const sideImage = scan.sideImageUrl || scan.payload?.sideImage || frontImage || null;
                                        return (
                                          <div key={scan.id} className="grid grid-cols-[auto_1fr_auto] gap-4 rounded-xl border border-zinc-800 bg-zinc-900/35 p-3">
                                            <div className="flex gap-2">
                                              <div className="h-16 w-12 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                                                {frontImage ? <img src={frontImage} alt="" className="h-full w-full object-cover object-top" /> : <div className="flex h-full w-full items-center justify-center text-zinc-700"><Users size={16} /></div>}
                                              </div>
                                              <div className="h-16 w-12 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                                                {sideImage ? <img src={sideImage} alt="" className="h-full w-full object-cover object-top" /> : <div className="flex h-full w-full items-center justify-center text-zinc-700"><Users size={16} /></div>}
                                              </div>
                                            </div>
                                            <div className="min-w-0">
                                              <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-black text-zinc-100">{scan.finalRating ?? '—'}/100</span>
                                                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-sans uppercase tracking-[0.22em] text-cyan-300">{modelLabel(scan.model)}</span>
                                                {scan.profileId && <span className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[9px] font-sans uppercase tracking-[0.22em] text-zinc-400">{scan.profileId}</span>}
                                              </div>
                                              <p className="mt-2 text-[10px] font-sans uppercase tracking-[0.24em] text-zinc-500">{formatTimestamp(scan.timestamp || scan.scannedAt || scan.createdAt)}</p>
                                              {scan.payload?.technicalSummary && (
                                                <p className="mt-2 line-clamp-2 text-xs font-sans leading-relaxed text-zinc-400">{scan.payload.technicalSummary}</p>
                                              )}
                                            </div>
                                            <div className="flex items-start">
                                              <button onClick={() => handleDeleteUserScan(u.uid, scan.id)} className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[10px] font-sans uppercase tracking-[0.22em] text-red-300 transition-colors hover:bg-red-500/20">
                                                Delete
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}

                                  <div className="mt-6 border-t border-zinc-800/70 pt-5">
                                    <div className="mb-4 flex items-center justify-between gap-3">
                                      <div>
                                        <p className="text-[10px] font-sans uppercase tracking-[0.28em] text-zinc-500">Mog battle submissions</p>
                                        <h4 className="mt-1 text-sm font-black uppercase tracking-widest text-zinc-100">{u.email}</h4>
                                      </div>
                                      <span className="text-[10px] font-sans uppercase tracking-widest text-zinc-600">{mogBattles.length} battles</span>
                                    </div>
                                    {mogBattlesLoading ? (
                                      <div className="py-8 text-center text-zinc-500 text-xs font-sans uppercase tracking-widest">Loading battles...</div>
                                    ) : mogBattlesError ? (
                                      <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs font-sans text-red-400">{mogBattlesError}</div>
                                    ) : mogBattles.length === 0 ? (
                                      <div className="py-6 text-center text-zinc-500 text-xs font-sans uppercase tracking-widest">No Mog Battles found for this user.</div>
                                    ) : (
                                      <div className="space-y-3">
                                        {mogBattles.map((battle) => {
                                          const fighterA = battle.fighterA || {};
                                          const fighterB = battle.fighterB || {};
                                          const frontA = fighterA.frontImage || fighterA.imgSrc || 'https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png';
                                          const frontB = fighterB.frontImage || fighterB.imgSrc || 'https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png';
                                          const scoreA = Number(fighterA.finalRating ?? fighterA.rating);
                                          const scoreB = Number(fighterB.finalRating ?? fighterB.rating);
                                          const winnerName =
                                            Number.isFinite(scoreA) && Number.isFinite(scoreB)
                                              ? scoreA === scoreB
                                                ? 'Tie'
                                                : scoreA > scoreB
                                                  ? (fighterA.name || fighterA.displayName || 'Scan')
                                                  : (fighterB.name || fighterB.displayName || 'Scan')
                                              : 'Unknown';
                                          return (
                                            <div key={battle.id} className="grid gap-4 rounded-xl border border-zinc-800 bg-zinc-900/35 p-3 md:grid-cols-[auto_1fr_auto]">
                                              <div className="flex gap-2">
                                                <div className="h-20 w-14 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                                                  <img src={frontA} alt="" className="h-full w-full object-cover object-top" />
                                                </div>
                                                <div className="h-20 w-14 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                                                  <img src={frontB} alt="" className="h-full w-full object-cover object-top" />
                                                </div>
                                              </div>
                                              <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                  <span className="text-sm font-black uppercase tracking-widest text-zinc-100">
                                                    {fighterA.name || fighterA.displayName || 'Scan'}
                                                  </span>
                                                  <span className="text-[10px] font-sans uppercase tracking-[0.24em] text-zinc-500">VS</span>
                                                  <span className="text-sm font-black uppercase tracking-widest text-zinc-100">
                                                    {fighterB.name || fighterB.displayName || 'Scan'}
                                                  </span>
                                                </div>
                                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                                  {Number.isFinite(scoreA) ? <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-sans uppercase tracking-[0.22em] text-cyan-300">{scoreA.toFixed(1)}</span> : null}
                                                  {Number.isFinite(scoreB) ? <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-sans uppercase tracking-[0.22em] text-emerald-300">{scoreB.toFixed(1)}</span> : null}
                                                  <span className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[9px] font-sans uppercase tracking-[0.22em] text-zinc-400">
                                                    {Number(battle.votesA || 0) + Number(battle.votesB || 0)} votes
                                                  </span>
                                                  <span className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[9px] font-sans uppercase tracking-[0.22em] text-zinc-400">
                                                    {formatTimestamp(battle.createdAt)}
                                                  </span>
                                                </div>
                                              </div>
                                              <div className="flex flex-col items-start gap-2 md:items-end">
                                                <span className="text-[10px] font-sans uppercase tracking-[0.24em] text-zinc-500">AI winner</span>
                                                <span className="text-xs font-black uppercase tracking-widest text-cyan-300">{winnerName}</span>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                {users.length === 0 && (
                  <div className="text-center py-8 text-zinc-500 font-sans text-xs">No users found.</div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {loading && !stats && (
        <div className="flex items-center justify-center py-32">
          <Loader2 size={24} className="text-cyan-400 animate-spin" />
        </div>
      )}
    </div>
  );
};

// --- Protocol Detail Page ---
const ProtocolDetailPage = ({ protocol, allProtocols, setCurrentPage }) => {
  const [activePhase, setActivePhase] = useState(0);
  const [checkedTasks, setCheckedTasks] = useState({});

  const toggleTask = (phaseIdx, taskIdx) => {
    const key = `${phaseIdx}-${taskIdx}`;
    setCheckedTasks(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const impactLevel = (impact) => {
    if (/highest/i.test(impact)) return { color: 'red', pct: 100, label: 'CRITICAL' };
    if (/high/i.test(impact)) return { color: 'orange', pct: 80, label: 'HIGH' };
    if (/medium/i.test(impact)) return { color: 'yellow', pct: 55, label: 'MODERATE' };
    return { color: 'emerald', pct: 30, label: 'LOW' };
  };

  const imp = impactLevel(protocol?.impact || 'Medium');

  const isSurgical = /surgery|rhinoplasty|implant|genioplasty|osteotomy|blepharoplasty|buccal|liposuction|fat graft|filler|botox|lefort/i.test(protocol?.name + ' ' + protocol?.description);

  const timelinePhases = isSurgical ? [
    { week: 'Month 1-2', title: 'Research & Consultation', icon: 'ðŸ”', tasks: ['Research board-certified surgeons in your area', 'Book 2-3 consultations for multiple opinions', 'Review before/after galleries of each surgeon', 'Ask about complication rates and revision rates', 'Get imaging/morphs done during consultations'] },
    { week: 'Month 2-3', title: 'Pre-Operative Preparation', icon: 'ðŸ“‹', tasks: ['Complete all required bloodwork and imaging', 'Stop blood thinners, supplements, and smoking', 'Arrange 1-2 weeks off work for recovery', 'Prepare recovery area at home (ice, soft foods, pillows)', 'Take standardized baseline photos (front, side, 45Â°)'] },
    { week: 'Day of Surgery', title: 'Procedure Day', icon: 'ðŸ¥', tasks: ['Follow NPO (nothing by mouth) instructions', 'Arrive with a responsible adult for transport', 'Confirm procedure details with your surgeon', 'Follow all pre-op nursing instructions'] },
    { week: 'Week 1-2', title: 'Acute Recovery', icon: 'ðŸ©¹', tasks: ['Apply ice 20 min on / 20 min off for first 48 hours', 'Sleep elevated at 30-45 degrees to minimize swelling', 'Soft/liquid diet for the first week', 'Take prescribed medications on schedule', 'Attend your first post-op checkup'] },
    { week: 'Week 3-6', title: 'Healing Phase', icon: 'ðŸ”„', tasks: ['Swelling continues to reduce â€” be patient', 'Gradually reintroduce normal diet and activity', 'Avoid contact sports and strenuous exercise', 'Take weekly progress photos for comparison', 'Follow up with surgeon at 4-6 week mark'] },
    { week: 'Month 3-12', title: 'Final Results', icon: 'âœ…', tasks: ['Most swelling resolved by month 3; final form by month 12', 'Compare progress photos against pre-op baseline', 'Schedule 6-month and 12-month follow-up visits', 'Discuss any asymmetries or concerns with surgeon', 'Consider complementary protocols if needed'] },
  ] : [
    { week: 'Week 1', title: 'Setup & Baseline', icon: 'ðŸ“¸', tasks: ['Take standardized baseline photos (front, side, 45Â°)', 'Purchase all required products or equipment', 'Set daily reminders/alarms for consistency', 'Journal your starting measurements if applicable', 'Research proper technique and application methods'] },
    { week: 'Week 2-4', title: 'Building the Habit', icon: 'âš¡', tasks: ['Apply the protocol daily without skipping', 'Track adherence in a habit tracker or journal', 'Note any skin sensitivity or adverse reactions', 'Take weekly progress photos in the same lighting', 'Adjust dosage/frequency if irritation occurs'] },
    { week: 'Month 2-3', title: 'Early Adaptation', icon: 'ðŸ”¬', tasks: ['First subtle changes may become visible', 'Compare month 2 photos vs. baseline side-by-side', 'Increase intensity/frequency if well-tolerated', 'Re-evaluate product quality and consider upgrades', 'Stay consistent â€” this is where most people quit'] },
    { week: 'Month 3-6', title: 'Visible Transformation', icon: 'ðŸ“ˆ', tasks: ['Clear, measurable changes vs. baseline', 'Document with high-quality progress photos', 'Evaluate whether to continue, intensify, or maintain', 'Begin transitioning to maintenance dosage if applicable', 'Stack with complementary protocols for compound gains'] },
    { week: 'Month 6+', title: 'Maintenance', icon: 'ðŸ†', tasks: ['Shift to maintenance frequency/dosage', 'Take monthly comparison photos', 'Focus on the next highest-impact protocol', 'Re-evaluate every 3 months for continued relevance', 'Share progress with your community for accountability'] },
  ];

  const totalTasks = timelinePhases.reduce((sum, p) => sum + p.tasks.length, 0);
  const completedTasks = Object.values(checkedTasks).filter(Boolean).length;
  const overallProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div className="min-h-screen pt-28 pb-20 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto">
      <button onClick={() => setCurrentPage('dashboard')} className="flex items-center gap-2 text-zinc-500 hover:text-cyan-400 font-sans text-[10px] uppercase tracking-widest mb-8 transition-colors">
        <ChevronLeft size={14} /> Back to Dashboard
      </button>

      {/* Header */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-8 mb-6 relative overflow-hidden">
        <div className="flex items-start gap-4 mb-6">
          <div className="w-14 h-14 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
            <span className="text-xl font-black text-zinc-400">{String(protocol?.id || 1).padStart(2, '0')}</span>
          </div>
          <div className="flex-grow">
            <h1 className="text-2xl md:text-3xl font-black italic uppercase tracking-tight text-white">{protocol?.name || 'Protocol'}</h1>
            <p className="text-zinc-400 font-sans text-sm mt-2 leading-relaxed">{protocol?.description || ''}</p>
            <div className="flex items-center gap-3 mt-3">
              <span className={`text-[9px] font-sans uppercase tracking-widest px-2.5 py-1 rounded-full border ${/highest/i.test(protocol?.impact) ? 'text-red-400 border-red-500/20 bg-red-500/10' : /high/i.test(protocol?.impact) ? 'text-orange-400 border-orange-500/20 bg-orange-500/10' : /medium/i.test(protocol?.impact) ? 'text-yellow-400 border-yellow-500/20 bg-yellow-500/10' : 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10'}`}>{protocol?.impact || 'Medium Impact'}</span>
              <span className="text-[9px] font-sans uppercase tracking-widest text-zinc-600 px-2.5 py-1 rounded-full border border-zinc-800 bg-zinc-900">{isSurgical ? 'Surgical' : 'Non-Surgical'}</span>
            </div>
          </div>
        </div>
        {/* Overall progress */}
        <div className="mt-2">
          <div className="flex justify-between mb-1.5">
            <span className="text-[10px] font-sans uppercase tracking-widest text-zinc-500">Overall Progress</span>
            <span className="text-[10px] font-sans uppercase tracking-widest text-cyan-400">{overallProgress}%</span>
          </div>
          <div className="h-2 bg-zinc-950 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 rounded-full transition-all duration-500" style={{ width: `${overallProgress}%` }} />
          </div>
        </div>
      </div>

      {/* Interactive Timeline */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-8 mb-6">
        <h2 className="font-sans text-xs uppercase tracking-widest text-zinc-300 mb-6 flex items-center gap-2">
          <Clock size={14} className="text-cyan-400" /> Implementation Timeline
        </h2>

        {/* Phase selector tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {timelinePhases.map((phase, i) => {
            const phaseTasks = phase.tasks.length;
            const phaseCompleted = phase.tasks.filter((_, ti) => checkedTasks[`${i}-${ti}`]).length;
            const phasePct = phaseTasks > 0 ? Math.round((phaseCompleted / phaseTasks) * 100) : 0;
            return (
              <button key={i} onClick={() => setActivePhase(i)} className={`shrink-0 px-4 py-3 rounded-xl border font-sans text-[10px] uppercase tracking-widest transition-all ${activePhase === i ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-zinc-950/50 border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400'}`}>
                <span className="mr-2">{phase.icon}</span>
                {phase.week}
                {phaseCompleted > 0 && <span className="ml-2 text-[8px] text-cyan-500">{phasePct}%</span>}
              </button>
            );
          })}
        </div>

        {/* Active phase detail */}
        <div className="bg-zinc-950/50 border border-zinc-800/50 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-white font-bold uppercase text-sm tracking-widest">{timelinePhases[activePhase]?.title}</h3>
              <span className="text-cyan-400 font-sans text-[10px] uppercase tracking-widest">{timelinePhases[activePhase]?.week}</span>
            </div>
            <div className="text-right">
              <span className="text-zinc-500 font-sans text-[10px]">
                {timelinePhases[activePhase]?.tasks.filter((_, ti) => checkedTasks[`${activePhase}-${ti}`]).length}/{timelinePhases[activePhase]?.tasks.length} tasks
              </span>
            </div>
          </div>
          <div className="space-y-2">
            {timelinePhases[activePhase]?.tasks.map((task, ti) => {
              const isChecked = !!checkedTasks[`${activePhase}-${ti}`];
              return (
                <div key={ti} onClick={() => toggleTask(activePhase, ti)} className={`flex items-start gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-all ${isChecked ? 'bg-cyan-500/5 border-cyan-500/20' : 'bg-zinc-900/30 border-zinc-800/50 hover:border-zinc-700'}`}>
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${isChecked ? 'border-cyan-500 bg-cyan-500' : 'border-zinc-700'}`}>
                    {isChecked && <Check size={12} className="text-black" />}
                  </div>
                  <span className={`font-sans text-xs leading-relaxed transition-colors ${isChecked ? 'text-zinc-500 line-through' : 'text-zinc-300'}`}>{task}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Phase progress dots */}
        <div className="flex items-center justify-center gap-2 mt-6">
          {timelinePhases.map((phase, i) => {
            const phaseTasks = phase.tasks.length;
            const phaseCompleted = phase.tasks.filter((_, ti) => checkedTasks[`${i}-${ti}`]).length;
            const done = phaseCompleted === phaseTasks && phaseTasks > 0;
            return (
              <button key={i} onClick={() => setActivePhase(i)} className={`w-3 h-3 rounded-full transition-all ${activePhase === i ? 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)] scale-125' : done ? 'bg-emerald-500' : phaseCompleted > 0 ? 'bg-yellow-500' : 'bg-zinc-700 hover:bg-zinc-600'}`} />
            );
          })}
        </div>
      </div>

      {/* Scientific Research */}
      {protocol?.research && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-8 mb-6">
          <h2 className="font-sans text-xs uppercase tracking-widest text-zinc-300 mb-6 flex items-center gap-2">
            <Activity size={14} className="text-violet-400" /> Scientific Research
          </h2>
          <div className="bg-zinc-950/50 border border-zinc-800/50 rounded-xl p-6">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <Activity size={14} className="text-violet-400" />
              </div>
              <div>
                {(() => {
                  const titleMatch = protocol.research.match(/"([^"]+)"/);
                  const query = titleMatch ? titleMatch[1] : protocol.research;
                  const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`;
                  return (
                    <a href={scholarUrl} target="_blank" rel="noopener noreferrer" className="group/link block">
                      <p className="text-zinc-300 font-sans text-xs leading-relaxed group-hover/link:text-violet-300 transition-colors">
                        {protocol.research}
                        <ArrowUpRight size={12} className="inline ml-1 opacity-0 group-hover/link:opacity-100 transition-opacity text-violet-400" />
                      </p>
                    </a>
                  );
                })()}
                <p className="text-violet-400/60 font-sans text-[9px] uppercase tracking-widest mt-3">Cited from peer-reviewed literature</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Key Principles */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-8 mb-6">
        <h2 className="font-sans text-xs uppercase tracking-widest text-zinc-300 mb-6 flex items-center gap-2">
          <Target size={14} className="text-emerald-400" /> Key Principles
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(isSurgical ? [
            { title: 'Surgeon Selection', desc: 'Choose a board-certified surgeon with specific experience in this procedure. Review at least 20 before/after cases.' },
            { title: 'Realistic Expectations', desc: 'Understand the limits of the procedure. Results depend on your anatomy, healing, and the surgeon\'s skill.' },
            { title: 'Recovery Compliance', desc: 'Follow post-op instructions exactly. Most complications arise from non-compliance during recovery.' },
          ] : [
            { title: 'Consistency', desc: 'Results compound over time. Daily adherence matters more than intensity.' },
            { title: 'Documentation', desc: 'Take progress photos weekly under the same lighting and angle.' },
            { title: 'Patience', desc: 'Most changes take 3-6 months to become clearly visible. Don\'t quit early.' },
          ]).map((tip, i) => (
            <div key={i} className="bg-zinc-950/50 border border-zinc-800/50 rounded-xl p-5">
              <h4 className="text-white font-bold uppercase text-xs tracking-widest mb-2">{tip.title}</h4>
              <p className="text-zinc-500 font-sans text-[10px] leading-relaxed">{tip.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Other Protocols */}
      {allProtocols && allProtocols.length > 1 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-8">
          <h2 className="font-sans text-xs uppercase tracking-widest text-zinc-300 mb-6">Other Protocols</h2>
          <div className="space-y-2">
            {allProtocols.filter(p => p.id !== protocol?.id).slice(0, 8).map((p, i) => {
              const pImp = impactLevel(p.impact);
              return (
                <div key={p.id || i} onClick={() => { setCurrentPage(`protocol-${p.id}`); window.scrollTo(0, 0); }} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-zinc-950/30 border border-zinc-800/50 hover:border-zinc-700 cursor-pointer transition-colors group">
                  <span className="text-zinc-600 font-black text-sm w-8">{String(p.id).padStart(2, '0')}</span>
                  <span className="text-zinc-300 font-bold uppercase text-xs tracking-widest flex-grow truncate group-hover:text-white transition-colors">{p.name}</span>
                  <span className={`text-[8px] font-sans uppercase tracking-widest text-${pImp.color}-400 shrink-0`}>{p.impact}</span>
                  <ChevronRight size={12} className="text-zinc-700 group-hover:text-cyan-400 shrink-0 transition-colors" />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// --- All Protocols Page ---
const AllProtocolsPage = ({ protocols, setCurrentPage }) => {
  const impactColor = (impact) => {
    if (/highest/i.test(impact)) return 'text-red-400';
    if (/high/i.test(impact)) return 'text-orange-400';
    if (/medium/i.test(impact)) return 'text-yellow-400';
    return 'text-emerald-400';
  };

  return (
    <div className="min-h-screen pt-28 pb-20 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto">
      <button onClick={() => setCurrentPage('dashboard')} className="flex items-center gap-2 text-zinc-500 hover:text-cyan-400 font-sans text-[10px] uppercase tracking-widest mb-8 transition-colors">
        <ChevronLeft size={14} /> Back to Dashboard
      </button>
      <h1 className="text-3xl md:text-4xl font-black italic uppercase tracking-tight text-white mb-2">All Protocols</h1>
      <p className="text-zinc-500 font-sans text-xs uppercase tracking-widest mb-10">Sorted by impact - highest first</p>
      <div className="space-y-3">
        {(protocols || []).map((p, i) => (
          <div key={p.id || i} onClick={() => { setCurrentPage(`protocol-${p.id}`); window.scrollTo(0, 0); }} className="flex items-center gap-4 px-5 py-4 rounded-xl bg-zinc-900/50 border border-zinc-800 hover:border-cyan-500/30 hover:shadow-[0_0_15px_rgba(34,211,238,0.05)] cursor-pointer transition-all group">
            <span className="text-2xl font-black text-zinc-700 group-hover:text-cyan-400 transition-colors w-10 shrink-0">{String(p.id).padStart(2, '0')}</span>
            <div className="flex-grow min-w-0">
              <span className="text-white font-bold uppercase text-sm tracking-widest block truncate group-hover:text-cyan-50 transition-colors">{p.name}</span>
              <span className="text-zinc-600 text-xs font-sans block truncate">{p.description}</span>
            </div>
            <span className={`text-[9px] font-sans uppercase tracking-widest shrink-0 ${impactColor(p.impact)}`}>{p.impact}</span>
            <ChevronRight size={16} className="text-zinc-700 group-hover:text-cyan-400 shrink-0 transition-colors" />
          </div>
        ))}
      </div>
    </div>
  );
};

// --- Hidden Admin Access (5 clicks on footer logo within 3s) ---
const AdminFooterTrigger = ({ setCurrentPage }) => {
  const clicks = useRef([]);
  const handleClick = () => {
    const now = Date.now();
    clicks.current = clicks.current.filter(t => now - t < 3000);
    clicks.current.push(now);
    if (clicks.current.length >= 5) {
      clicks.current = [];
      setCurrentPage('admin');
    }
  };
  return (
    <div className="flex items-center gap-2.5 cursor-pointer select-none" onClick={handleClick}>
      <MogCheckLogoMark size={32} className="w-8 h-8" />
      <span className="text-2xl font-black italic tracking-tighter">MogCheck</span>
    </div>
  );
};

// --- App Root ---
const App = () => {
  const initialLocation = parseAppLocation(window.location.pathname);
  const [currentPage, _setCurrentPage] = useState(initialLocation.page);

  const [dashboardData, setDashboardData] = useState(null);
  /** When set from Pro dashboard “Run a new scan”, upload page pre-selects this model (1–5). */
  const [pendingUploadModel, setPendingUploadModel] = useState(null);
  const [pendingUploadProfileId, setPendingUploadProfileId] = useState(null);
  const [selectedCelebrity, setSelectedCelebrity] = useState(null);
  const [routeParams, setRouteParams] = useState(initialLocation.routeParams);
  const [dashboardRoute, setDashboardRoute] = useState(initialLocation.dashboardRoute);
  const [user, setUser] = useState(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [userPlan, setUserPlan] = useState({ plan: 'free', scanCredits: 0, loaded: false });

  const setCurrentPage = useCallback((page, pathOverride = null) => {
    const newPath = pathOverride || (page === 'home' ? '/' : `/${page}`);
    const parsed = parseAppLocation(newPath, user?.uid);

    _setCurrentPage(parsed.page || page);
    setRouteParams(parsed.routeParams || {});
    setDashboardRoute(parsed.dashboardRoute || { slug: null, profileId: null });

    const targetPath = `${newPath}${window.location.search}`;
    if (window.location.pathname + window.location.search !== targetPath) {
      window.history.pushState({ page: parsed.page || page }, '', targetPath);
    } else if (window.history.state?.page !== (parsed.page || page)) {
      window.history.replaceState({ page: parsed.page || page }, '', targetPath);
    }
  }, [user?.uid]);

  useEffect(() => {
    const syncLocationState = () => {
      const parsed = parseAppLocation(window.location.pathname, user?.uid);
      _setCurrentPage(parsed.page);
      setRouteParams(parsed.routeParams || {});
      setDashboardRoute(parsed.dashboardRoute || { slug: null, profileId: null });
      if (window.history.state?.page !== parsed.page) {
        window.history.replaceState({ page: parsed.page }, '', window.location.pathname + window.location.search);
      }
    };
    syncLocationState();
    window.addEventListener('popstate', syncLocationState);
    return () => window.removeEventListener('popstate', syncLocationState);
  }, [user?.uid]);
  const [lowPerfMode, setLowPerfMode] = useState(window.innerWidth < 768);

  useEffect(() => {
    if (lowPerfMode) {
      document.body.classList.add('low-perf-mode');
    } else {
      document.body.classList.remove('low-perf-mode');
    }
  }, [lowPerfMode]);
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthResolved(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user?.uid) { setUserPlan({ plan: 'free', scanCredits: 0, loaded: true }); return; }
    setUserPlan((prev) => ({ ...prev, loaded: false }));
    
    // Setup Firestore listener for user plan
    const unsubscribe = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setUserPlan({
            plan: data.plan || 'free',
            scanCredits: data.scanCredits ?? 0,
            subscriptionId: data.subscriptionId || null,
            loaded: true,
          });
        } else {
          setUserPlan({ plan: 'free', scanCredits: 0, loaded: true });
        }
      },
      (err) => {
        console.error('User plan listener failed', err);
        setUserPlan({ plan: 'free', scanCredits: 0, loaded: true });
      }
    );

    // Session Heartbeat
    const sendHeartbeat = async () => {
      try {
        const token = await user.getIdToken();
        await fetch(`${API_BASE}/api/user/status`, {
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch (e) {
        console.error('Heartbeat failed', e);
      }
    };
    sendHeartbeat(); // immediate first beat
    const heartbeatInterval = setInterval(sendHeartbeat, 60000); // every minute

    return () => {
      unsubscribe();
      clearInterval(heartbeatInterval);
    };
  }, [user?.uid]);

  useEffect(() => { window.scrollTo(0, 0); }, [currentPage]);

  useEffect(() => {
    if (currentPage !== 'upload-photo' && currentPage !== 'upload-ultra') {
      setPendingUploadModel(null);
      setPendingUploadProfileId(null);
    }
  }, [currentPage]);

  const hasScanData = useMemo(() => {
    if (!dashboardData) return false;
    return (
      dashboardData.finalRating != null ||
      !!dashboardData.frontImage ||
      (Array.isArray(dashboardData.biometrics) && dashboardData.biometrics.length > 0)
    );
  }, [dashboardData]);

  const isFreeModelDashboard = useMemo(() => {
    const model = String(dashboardData?.selectedModel || '').trim();
    return model === '3' || model === '4' || model === '5';
  }, [dashboardData?.selectedModel]);

  const isPremiumModelDashboard = useMemo(() => {
    const model = String(dashboardData?.selectedModel || '').trim();
    return model === '1' || model === '2';
  }, [dashboardData?.selectedModel]);

  const useProDashboard = hasScanData
    ? isPremiumModelDashboard
    : hasEffectiveProAccess(user, userPlan) && !isFreeModelDashboard;

  useEffect(() => {
    if (currentPage !== 'dashboard') return;
    if (!authResolved) return;
    // Fresh scan results (guest or signed-in): always show dashboard when we have payload/images
    if (hasScanData) return;
    if (!user) {
      setCurrentPage('login');
    }
  }, [authResolved, currentPage, user, hasScanData, setCurrentPage]);

  const handleSignOut = async () => {
    await signOut(auth);
    setCurrentPage('home');
  };
  
  return (
    <div className="min-h-screen bg-[#0c0d0e] text-zinc-100 selection:bg-white selection:text-black">
      <NoiseOverlay />
      <Navbar
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        user={user}
        onSignOut={handleSignOut}
        userPlan={userPlan}
        showDashboard={Boolean(user && (hasScanData || canAlwaysAccessDashboard(user)))}
        lowPerfMode={lowPerfMode}
        setLowPerfMode={setLowPerfMode}
      />
      <main className="flex flex-col min-h-screen">
        {currentPage === 'home' && <HomePage setCurrentPage={setCurrentPage} />}
        {currentPage === 'photo-guide' && <PhotoGuidePage setCurrentPage={setCurrentPage} />}
        {(currentPage === 'upload-photo' || currentPage === 'upload-ultra') && (
          <UploadPhotoPage
            key={`upload-${currentPage}-${pendingUploadModel ?? 'default'}`}
            setCurrentPage={setCurrentPage}
            setDashboardData={setDashboardData}
            setSelectedCelebrity={setSelectedCelebrity}
            user={user}
            userPlan={userPlan}
            initialModel={pendingUploadModel ?? (currentPage === 'upload-ultra' ? '1' : '3')}
            isLockedToUltra={currentPage === 'upload-ultra'}
            initialProfileId={pendingUploadProfileId}
          />
        )}
        {currentPage === 'results' && <ResultsPage />}
        {currentPage === 'dashboard' && (
          useProDashboard
            ? (
              <ProDashboardPage
                dashboardData={dashboardData}
                setCurrentPage={setCurrentPage}
                userPlan={userPlan}
                user={user}
                onSignOut={handleSignOut}
                setPendingUploadModel={setPendingUploadModel}
                setPendingUploadProfileId={setPendingUploadProfileId}
                setDashboardData={setDashboardData}
                initialDashboardProfileId={dashboardRoute?.profileId || null}
                hasActiveAnalysis={hasScanData}
                analysisContent={
                  hasScanData
                    ? <DashboardPage dashboardData={dashboardData} setCurrentPage={setCurrentPage} userPlan={userPlan} user={user} hideTopSection isEmbedded />
                    : null
                }
                renderCommunityDashboard={(communityData) => (
                  <DashboardPage
                    dashboardData={communityData}
                    setCurrentPage={setCurrentPage}
                    userPlan={userPlan}
                    user={user}
                    hideTopSection
                    hideProtocols
                    hideActionableProtocols
                    isEmbedded
                    hideUnlockPotential
                    hidePersonalizedFeedback
                  />
                )}
              />
            )
            : <DashboardPage dashboardData={dashboardData} setCurrentPage={setCurrentPage} userPlan={userPlan} user={user} />
        )}
        {currentPage === 'plans' && <PlansPage setCurrentPage={setCurrentPage} user={user} />}
        {currentPage === 'mog-battles' && (
          <MogBattlePage user={user} userPlan={userPlan} setCurrentPage={setCurrentPage} dashboardData={dashboardData} />
        )}
        {currentPage === 'login' && <LoginPage setCurrentPage={setCurrentPage} user={user} />}
        {currentPage === 'register' && <RegisterPage setCurrentPage={setCurrentPage} user={user} />}
        {currentPage === 'news' && <NewsPage />}
        {currentPage === 'public-profile' && (
          <PublicProfilePage routeParams={routeParams} user={user} />
        )}
        {currentPage === 'profile' && (
          <UserProfilePage user={user} userPlan={userPlan} setCurrentPage={setCurrentPage} />
        )}
        {currentPage === 'celebrity' && <CelebrityRatingPage setCurrentPage={setCurrentPage} setSelectedCelebrity={setSelectedCelebrity} />}
        {currentPage === 'celebrity-stats' && selectedCelebrity && <CelebrityStatsPage celeb={selectedCelebrity} setCurrentPage={setCurrentPage} />}
        {currentPage === 'admin' && <AdminDashboardPage setCurrentPage={setCurrentPage} />}
        {currentPage === 'protocol-all' && <AllProtocolsPage protocols={dashboardData?.protocols || []} setCurrentPage={setCurrentPage} />}
        {currentPage === 'tos' && <TermsOfServicePage setCurrentPage={setCurrentPage} />}
        {currentPage === 'privacy' && <PrivacyPolicyPage setCurrentPage={setCurrentPage} />}
        {currentPage === 'settings' && <SettingsPage setCurrentPage={setCurrentPage} user={user} userPlan={userPlan} lowPerfMode={lowPerfMode} setLowPerfMode={setLowPerfMode} dashboardData={dashboardData} />}
        {currentPage.startsWith('protocol-') && currentPage !== 'protocol-all' && (() => {
          const pid = parseInt(currentPage.split('-')[1]);
          const allProtos = dashboardData?.protocols || [];
          const proto = allProtos.find(p => p.id === pid) || { id: pid, name: `Protocol ${pid}`, description: '', impact: 'Medium Impact' };
          return <ProtocolDetailPage protocol={proto} allProtocols={allProtos} setCurrentPage={setCurrentPage} />;
        })()}
      </main>
      <footer className="py-12 border-t border-zinc-900 flex flex-col items-center gap-6 bg-[#090a0b]">
        <AdminFooterTrigger setCurrentPage={setCurrentPage} />
        <div className="flex gap-6">
           <button onClick={() => setCurrentPage('tos')} className="text-zinc-500 hover:text-zinc-300 text-xs font-sans transition-colors uppercase tracking-widest">Terms of Service</button>
           <button onClick={() => setCurrentPage('privacy')} className="text-zinc-500 hover:text-zinc-300 text-xs font-sans transition-colors uppercase tracking-widest">Privacy Policy</button>
        </div>
        <p className="text-zinc-600 text-[10px] font-sans uppercase tracking-[0.5em]">Peak Performance Aesthetics (c) 2026</p>
      </footer>
    </div>
  );
};

export default App;

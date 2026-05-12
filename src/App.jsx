import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ChevronRight, ChevronLeft, Menu, X, Lock, Unlock, Play, ArrowUpRight, User, Mail, Swords, Shield, Activity, Target, Loader2, Plus, Crown, Zap, Check, AlertCircle, Key, Clock, Server, HardDrive, TrendingUp, RefreshCw, LogOut, Eye, EyeOff, BarChart3, ChevronDown, LogIn, UserPlus, Users, ExternalLink, ArrowLeft, Settings, Sparkles, Bell, Trash2, Bug, Share2 } from 'lucide-react';
import { ConfirmDialog, ImageLightbox, SiteModal } from './components/ui/SiteModal';
import { DashboardHubPreviewsCompact } from './components/DashboardHubPreviews';
import { getNavbarPlanChip, hasEffectiveProAccess, canAlwaysAccessDashboard, isProPlan, normalizePlanValue } from './utils/planAccess';
import { initializeApp } from 'firebase/app';
import { celebrityData } from './data/celebrityData';
import { COMMUNITY_SCANS } from './data/communityScans';
import { measureItems, reviewsData, compBefore1, compAfter1, compBefore2, compAfter2, compBefore3, compAfter3 } from './data/shared';
import HolographicCard from './components/ui/HolographicCard';
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
} from 'firebase/auth';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';
import { getApiBase } from './utils/apiBase';
import { resolveMediaUrl } from './utils/mediaUrl';


const MogBattlePage = React.lazy(() => import('./components/MogBattlePage'));
const MogBattlePage2 = React.lazy(() => import('./components/MogBattlePage2'));
const ProDashboardPage = React.lazy(() => import('./components/ProDashboardPage'));
const PublicProfilePage = React.lazy(() => import('./components/PublicProfilePage'));
const TermsOfServicePage = React.lazy(() => import('./components/TermsOfServicePage'));
const PrivacyPolicyPage = React.lazy(() => import('./components/PrivacyPolicyPage'));
const SettingsPage = React.lazy(() => import('./components/SettingsPage'));

const GENERIC_ERROR = 'Something went wrong. Please try again later.';
const EMPTY_ANALYSIS_RESPONSE_ERROR = 'Analysis finished but no usable text was parsed';
const FRIENDLY_FRONTAL_IMAGE_ERROR = "Analysis failed. Are you sure you're using a frontal image?";
const PREMIUM_PROOF_VIDEO_SRC = '/social-proof/premium-proof.mp4';
const HOME_FEATURED_COMMUNITY_SCANS = [
  {
    id: 'home-community-cillian',
    name: 'Cillian Murphy',
    image: 'https://api.mogcheck.net/uploads/community-cillian-murphy.png',
    rating: 74,
    tier: 'B-TIER',
    footer: 'Community Scan - Premium Model',
  },
  {
    id: 'home-community-matt-damon',
    name: 'Matt Damon',
    image: 'https://api.mogcheck.net/uploads/1777228794523-328924b4953df45f.jpg',
    rating: 56,
    tier: 'D-TIER',
    footer: 'Community Scan - Premium Model',
  },
  {
    id: 'home-community-tyla',
    name: 'Tyla',
    image: 'https://api.mogcheck.net/uploads/1777227531979-2463cd04416e29ca.jpg',
    rating: 72,
    tier: 'B-TIER',
    footer: 'Community Scan - Premium Model',
  },
];
const PREMIUM_DEMO_MODEL_ID = 'premium-demo';
const DEFAULT_PREMIUM_DEMO_ID = 'henry';
const PREMIUM_DEMO_FACES = [
  {
    id: 'henry',
    name: 'Henry Cavill',
    shortName: 'Henry',
    image: '/premium-demo/henry-cavill.jpg',
    payloadSrc: '/premium-demo/henry-cavill-scan.json',
    score: 82,
    enabled: true,
  },
  {
    id: 'sean-opry',
    name: "Sean O'Pry",
    shortName: 'Sean',
    image: '/premium-demo/sean-opry.webp',
    payloadSrc: '/premium-demo/sean-opry-scan.json',
    score: 77,
    enabled: true,
  },
  {
    id: 'empty-3',
    name: 'Coming Soon',
    shortName: 'Locked',
    image: null,
    payloadSrc: null,
    score: null,
    enabled: false,
  },
];
const ACTIVE_PREMIUM_DEMO_FACES = PREMIUM_DEMO_FACES.filter((face) => face.enabled);
const ACTIVE_PREMIUM_DEMO_IDS = ACTIVE_PREMIUM_DEMO_FACES.map((face) => face.id);
const PREMIUM_DEMO_FRONT_IMAGE = ACTIVE_PREMIUM_DEMO_FACES[0]?.image || '/premium-demo/henry-cavill.jpg';
const PREMIUM_DEMO_SCAN_PAYLOAD_SRC = ACTIVE_PREMIUM_DEMO_FACES[0]?.payloadSrc || '/premium-demo/henry-cavill-scan.json';

function friendlyAnalysisErrorMessage(message) {
  const text = String(message || '').trim();
  if (/No healthy Google GenAI\/Gemma keys are available|temporarily cooling down|disabled or quarantined/i.test(text)) {
    return 'The AI provider timed out on all available keys, so they are cooling down. Please wait a few minutes and try again.';
  }
  if (/All configured Google GenAI\/Gemma keys failed|All Google\/Gemma API keys failed/i.test(text)) {
    return 'The AI provider failed on every available key during this scan. Please try again in a moment.';
  }
  if (text.includes(EMPTY_ANALYSIS_RESPONSE_ERROR)) return FRIENDLY_FRONTAL_IMAGE_ERROR;
  return text;
}

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

  if (parts[0] === 'scan' && parts.length >= 3) {
    return {
      page: 'public-scan',
      routeParams: { uid: parts[1], scanId: parts[2], scanOnly: true },
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

  if (parts[0] === 'analysis' || parts[0] === 'consulting-ai') {
    return {
      page: 'analysis',
      routeParams: {},
      dashboardRoute: { slug: null, profileId: null },
    };
  }

  if (parts[0] === 'animations' && parts.length >= 2) {
    return {
      page: 'animations',
      routeParams: { animationId: parts[1] },
      dashboardRoute: { slug: null, profileId: null },
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
      .split(/\n(?=\s*(?:#{2,}\s*|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|DEBUG RATING JUSTIFICATION\b|JUSTIFICATION\b|TECHNICAL SUMMARY\b|APPEAL ASSESSMENT\b|HEXAGON CHART RATINGS\b|CORE CATEGORY SCORES\b|CRITICAL MARKERS\b))/i)[0]
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
  return /###\s*(?:DASHBOARD_DATA|RATINGS|PERSONALISED\s+FEEDBACK|ACTIONABLE\s+PROTOCOLS|MOG_REPORT_REVISION)|\b(?:BEST FEATURES|PRIMARY FLAWS)\s*\(10\)|\b(?:DEBUG RATING JUSTIFICATION|JUSTIFICATION)\b/i.test(cleaned);
}

function getAuthenticityFlag(dashboardData) {
  const directFlag = String(dashboardData?.authenticityFlag || '').replace(/\*/g, '').trim();
  if (directFlag) {
    return directFlag.length > 96 ? `${directFlag.slice(0, 93).trim()}...` : directFlag;
  }

  const raw = [
    dashboardData?.rawOutput,
    dashboardData?.technicalSummary,
  ]
    .filter(Boolean)
    .join('\n');

  if (!raw) return '';

  const match = raw.match(/(?:\*\*)?Authenticity Flag(?:\*\*)?\s*:\s*([^\n]+)/i);
  const flagText = match?.[1]?.replace(/\*/g, '').trim();
  if (!flagText) return '';

  return flagText.length > 96 ? `${flagText.slice(0, 93).trim()}...` : flagText;
}

function getUncannyFlag(dashboardData) {
  const directFlag = String(dashboardData?.uncannyFlag || dashboardData?.payload?.uncannyFlag || '').replace(/\*/g, '').trim();
  if (directFlag) {
    return directFlag.replace(/\.$/, '').toLowerCase();
  }

  const raw = [
    dashboardData?.rawOutput,
    dashboardData?.payload?.rawOutput,
    dashboardData?.technicalSummary,
  ]
    .filter(Boolean)
    .join('\n');

  if (!raw) return '';

  const match = raw.match(/(?:\*\*)?Uncanny Flag(?:\*\*)?\s*:\s*([^\n]+)/i);
  const flagText = match?.[1]?.replace(/\*/g, '').trim();
  if (!flagText) return '';

  return flagText.replace(/\.$/, '').toLowerCase();
}

function hasConventionalAppealCue(dashboardData) {
  const text = String(dashboardData?.appealAssessment || '').toLowerCase();
  return /\buniversally conventional\b|\byouthful\b|\brefined,\s*clean look\b|\bclean look\b|\bprioriti[sz]es harmony\b|\bharmony and symmetry over aggressive dimorphism\b|\bbalance,\s*skin clarity,\s*and orbital harmony\b|\bbalanced,\s*polished\b|\bapproachable\b|\bsoft,\s*youthful appeal\b/.test(text);
}

function getDashboardMetricScore(dashboardData, labelStartsWith) {
  const target = String(labelStartsWith || '').toLowerCase();
  const metrics = [
    ...(Array.isArray(dashboardData?.biometrics) ? dashboardData.biometrics : []),
    ...(Array.isArray(dashboardData?.sideBiometrics) ? dashboardData.sideBiometrics : []),
  ];

  for (const metric of metrics) {
    const label = String(metric?.label || '').toLowerCase();
    if (!label.startsWith(target)) continue;
    const directScore = Number(metric?.score);
    if (Number.isFinite(directScore)) return directScore;
    const displayScore = String(metric?.displayValue || '').match(/(\d+(?:\.\d+)?)/);
    if (displayScore) return Number(displayScore[1]);
  }
  return null;
}

function getDashboardMetricRawValue(dashboardData, labelStartsWith) {
  const target = String(labelStartsWith || '').toLowerCase();
  const metrics = [
    ...(Array.isArray(dashboardData?.biometrics) ? dashboardData.biometrics : []),
    ...(Array.isArray(dashboardData?.sideBiometrics) ? dashboardData.sideBiometrics : []),
  ];

  for (const metric of metrics) {
    const label = String(metric?.label || '');
    if (!label.toLowerCase().startsWith(target)) continue;
    const rawMatch = label.match(/\(([-+]?\d+(?:\.\d+)?)/);
    if (rawMatch) return Number(rawMatch[1]);
  }
  return null;
}

function isContradictoryAggressiveStyleFeature(feature) {
  const text = `${feature?.title || ''} ${feature?.description || ''}`.toLowerCase();
  return /\bbrutalist\b|\boverbuilt\s*\/\s*editorial\b|\boverbuilt\b|\bover-?aggressive\b|\baggressive dimorphism\b|\btoo heavily on sharp\b|\bextreme dimorphism\b|\bhyper-?masculine\b/.test(text);
}

function isModerateBigonialStandaloneFeature(feature, dashboardData) {
  const text = `${feature?.title || ''} ${feature?.description || ''}`.toLowerCase();
  const looksBigonial =
    /\bbigonial\b|\blower face width\b|\bnarrow jaw\b|\bnarrow jawline\b|\bjaw relative to cheekbones\b|\blower third breadth\b|\btapered jawline\b/.test(text);
  if (!looksBigonial) return false;

  const rawIndex = getDashboardMetricRawValue(dashboardData, 'bigonial width index');
  const hasExtremeRaw = Number.isFinite(rawIndex) && (rawIndex < 0.75 || rawIndex > 1.05);
  return !hasExtremeRaw;
}

function isBalancedIpdStandaloneFeature(feature, dashboardData) {
  const text = `${feature?.title || ''} ${feature?.description || ''}`.toLowerCase();
  const looksIpd =
    /\bipd\b|\binterpupillary\b|\beye spacing\b|\bclose-set\b|\bclose set\b|\bwide-set\b|\bwide set\b|\bhypertelorism\b|\besotropia\b/.test(text);
  if (!looksIpd) return false;

  const rawIndex = getDashboardMetricRawValue(dashboardData, 'ipd index');
  return Number.isFinite(rawIndex) && rawIndex >= 0.44 && rawIndex <= 0.48;
}

function isBalancedMouthStandaloneFeature(feature, dashboardData) {
  const text = `${feature?.title || ''} ${feature?.description || ''}`.toLowerCase();
  const looksMouth =
    /\bmouth\b|\blip width\b|\bnarrow lips\b|\bnarrow mouth\b|\bwide mouth\b|\boverly wide\b/.test(text);
  if (!looksMouth) return false;

  const rawIndex = getDashboardMetricRawValue(dashboardData, 'mouth width index');
  return Number.isFinite(rawIndex) && rawIndex >= 0.36 && rawIndex <= 0.38;
}

function sanitizeResolvedFeatures(features, dashboardData, type) {
  if (type !== 'flaw') return features;
  const conventionalCue = hasConventionalAppealCue(dashboardData);
  const authenticityFlag = getAuthenticityFlag(dashboardData);

  return (features || []).map((feature) => {
    const title = String(feature?.title || '').trim().toLowerCase();
    const description = String(feature?.description || '').trim().toLowerCase();
    if (
      title === 'synthetic / uncanny look' &&
      description === 'the face reads too designed and over-processed, which hurts natural facial harmony.'
    ) {
      return {
        ...feature,
        title: 'Synthetic Uncanny Face Detected',
        description: 'Three or more uncanny cues were detected, making the facial read appear synthetic or overbuilt rather than naturally harmonious.',
      };
    }
    return feature;
  }).filter((feature) => {
    if (isModerateBigonialStandaloneFeature(feature, dashboardData)) return false;
    if (isBalancedIpdStandaloneFeature(feature, dashboardData)) return false;
    if (isBalancedMouthStandaloneFeature(feature, dashboardData)) return false;
    if (conventionalCue && !authenticityFlag && isContradictoryAggressiveStyleFeature(feature)) return false;
    return true;
  });
}

function splitDashboardFeatureItems(value) {
  if (typeof value !== 'string') return [];
  let working = value.replace(/\r/g, '').trim();
  if (!working) return [];

  if (working.startsWith('[') && working.endsWith(']')) {
    working = working.slice(1, -1);
  }

  const splitter = working.includes('\n')
    ? /\r?\n+/
    : working.includes(';')
      ? /\s*;\s*/
      : /\s*,\s*/;

  return working
    .split(splitter)
    .map((item) => item.replace(/^\s*(?:\d+\.\s*|[-*]\s*)/, '').trim())
    .filter(Boolean);
}

function splitPrefixedDashboardEntries(block) {
  if (typeof block !== 'string') return [];

  return block
    .replace(/\r/g, '\n')
    .replace(/(?:^|[\t ]+)(?=(?:(?:\d+\.\s*)|(?:[-*]\s*))?\[\s*(?:FRONT|FRONTAL|SIDE)\s*\])/gi, '\n')
    .split(/\n+/)
    .map((item) => item.replace(/^\s*(?:(?:\d+\.\s*)|(?:[-*]\s*))?/, '').trim())
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
      ? /BEST FEATURES[\s\d()]*:\s*([\s\S]*?)(?=PRIMARY FLAWS[\s\d()]*:|###|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|DEBUG RATING JUSTIFICATION\b|JUSTIFICATION\b|$)/i
      : /PRIMARY FLAWS[\s\d()]*:\s*([\s\S]*?)(?=###|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|DEBUG RATING JUSTIFICATION\b|JUSTIFICATION\b|$)/i;

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
    scan.scanId,
    scan.profileId,
    scan.userId,
    scan.displayName,
    scan.name,
  ]
    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
    .filter(Boolean);

  const imageCandidates = [
    scan.frontImage,
    scan.frontImageUrl,
    scan.sideImage,
    scan.sideImageUrl,
    scan.dashboardData?.frontImage,
    scan.dashboardData?.sideImage,
    scan.payload?.frontImage,
    scan.payload?.sideImage,
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

function forceCommunityScanFrontOnly(data) {
  if (!data || typeof data !== 'object') return data;
  const payload = data.payload && typeof data.payload === 'object'
    ? {
        ...data.payload,
        sideImage: null,
        sideImageUrl: null,
        sideRating: null,
        sideCategories: null,
        sideBestFeatures: [],
        sidePrimaryFlaws: [],
        sideBiometrics: [],
        hexagonSide: null,
        cohesiveFrontSide: false,
      }
    : data.payload;

  return {
    ...data,
    payload,
    sideImage: null,
    sideImageUrl: null,
    sideRating: null,
    sideCategories: null,
    sideBestFeatures: [],
    sidePrimaryFlaws: [],
    sideBiometrics: [],
    hexagonSide: null,
    cohesiveFrontSide: false,
    communityFrontOnly: true,
  };
}

function hydrateCommunityScanEntry(scan, index = 0) {
  const template = findCommunityScanTemplate(scan);
  const isOfficialScan = Boolean(scan?.officialScan || scan?.official || template?.officialScan || template?.official);
  const payload =
    scan?.dashboardData && typeof scan.dashboardData === 'object'
      ? scan.dashboardData
      : scan?.payload && typeof scan.payload === 'object'
        ? scan.payload
        : template?.dashboardData || null;

  const frontImage =
    payload?.frontImage ||
    scan?.frontImage ||
    scan?.frontImageUrl ||
    template?.dashboardData?.frontImage ||
    null;
  const finalRating =
    payload?.finalRating ??
    scan?.finalRating ??
    template?.dashboardData?.finalRating ??
    0;

  const dashboardData = payload
    ? forceCommunityScanFrontOnly({
        ...payload,
        frontImage,
        finalRating,
        selectedModel: String(payload.selectedModel || scan?.selectedModel || scan?.model || (isOfficialScan ? 'official' : '1')),
      })
    : null;

  return {
    ...template,
    ...scan,
    id: scan?.id || scan?.scanId || template?.id || `community-${index}`,
    displayName: isOfficialScan ? 'Official Scan' : 'Community Scan',
    officialScan: isOfficialScan,
    official: isOfficialScan,
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
    sideImage: null,
    finalRating,
    sideRating: null,
    dashboardData,
  };
}

function extractFeatureHighlightsFromRawOutput(rawOutput) {
  if (typeof rawOutput !== 'string' || !rawOutput.trim()) {
    return { bestFeatures: [], primaryFlaws: [] };
  }

  const trimFeatureDescription = (value) =>
    String(value || '')
      .split(/\r?\n(?=\s*(?:#{2,}\s*|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|DEBUG RATING JUSTIFICATION\b|JUSTIFICATION\b|TECHNICAL SUMMARY\b|APPEAL ASSESSMENT\b|HEXAGON CHART RATINGS\b|CORE CATEGORY SCORES\b|CRITICAL MARKERS\b))/i)[0]
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
      /(?:^|\n)\s*(?:[-*]\s*)?(?:\*{1,2}\s*)?#1\s*BEST FEATURE(?:\s*\*{1,2})?\s*:?\s*([\s\S]*?)(?=(?:\n\s*(?:[-*]\s*)?(?:\*{1,2}\s*)?#1\s*WORST FEATURE)|\n\s*(?:###\s*DASHBOARD_DATA|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|DEBUG RATING JUSTIFICATION\b|JUSTIFICATION\b)|$)/i,
      'Best Feature'
    ),
    primaryFlaws: parseSingleHighlight(
      /(?:^|\n)\s*(?:[-*]\s*)?(?:\*{1,2}\s*)?#1\s*WORST FEATURE(?:\s*\*{1,2})?\s*:?\s*([\s\S]*?)(?=\n\s*(?:###\s*DASHBOARD_DATA|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|DEBUG RATING JUSTIFICATION\b|JUSTIFICATION\b)|$)/i,
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
    return sanitizeResolvedFeatures(mergeFeatureEntryLists(rawList, normalized, 5), dashboardData, type);
  }
  if (normalized.length > 0) {
    return sanitizeResolvedFeatures(mergeFeatureEntryLists(normalized, rawList, 5), dashboardData, type);
  }

  const fallback = extractFeatureHighlightsFromRawOutput(dashboardData?.rawOutput || '');
  return sanitizeResolvedFeatures(
    (type === 'best' ? fallback.bestFeatures : fallback.primaryFlaws).slice(0, 5),
    dashboardData,
    type
  );
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
  if (typeof value?._seconds === 'number') {
    const nanos = typeof value?._nanoseconds === 'number' ? value._nanoseconds / 1e6 : 0;
    return value._seconds * 1000 + nanos;
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
    .replace(/Ãƒâ€šÃ‚|Ã‚/g, ' ')
    .replace(/Ã¢â‚¬â„¢/g, "'")
    .replace(/Ã¢â‚¬Å“|Ã¢â‚¬ï¿½/g, '"')
    .replace(/Ã¢â‚¬â€œ|Ã¢â‚¬â€/g, '-')
    .replace(/Ã¢â‚¬Â¢/g, 'â€¢')
    .replace(/Ã¢â‚¬Â¦/g, '...')
    .replace(/\*\*([\s\S]*?)\*\*/g, '*$1*')
    .replace(/&(red|green|blue|white|yellow)\s+([^&]+)&/gi, '$2')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/#([^#]+)#/g, '$1')
    .replace(/@([^@]+)@/g, '$1')
    .replace(/&([^&]+)&/g, '$1')
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

function isMobileOperaBrowser() {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  return /(OPR\/|OPT\/|Opera|OPiOS|OPX\/)/i.test(userAgent) && /Mobile|Android|iPhone|iPad|iPod/i.test(userAgent);
}

async function setAuthPersistenceSafely(rememberMe = false) {
  const persistenceOrder = rememberMe
    ? [browserLocalPersistence, browserSessionPersistence, inMemoryPersistence]
    : [browserSessionPersistence, browserLocalPersistence, inMemoryPersistence];

  let lastError = null;
  for (const persistence of persistenceOrder) {
    try {
      await setPersistence(auth, persistence);
      return;
    } catch (err) {
      lastError = err;
      console.warn('Firebase auth persistence failed, trying fallback', err);
    }
  }

  throw lastError;
}

const signInWithGoogleProvider = async () => {
  await setAuthPersistenceSafely(true);
  if (isMobileOperaBrowser()) {
    return signInWithRedirect(auth, googleProvider);
  }
  return signInWithPopup(auth, googleProvider);
};

const PADDLE_CLIENT_TOKEN =
  String(import.meta.env.VITE_PADDLE_CLIENT_TOKEN || 'live_41a7033635d9efa677b7d3a8521').trim();
const PADDLE_ENVIRONMENT =
  String(import.meta.env.VITE_PADDLE_ENV || 'production').trim().toLowerCase();

function normalizePaddlePriceId(value, fallback) {
  const candidate = String(value || '').trim();
  return candidate.startsWith('pri_') ? candidate : fallback;
}

const PADDLE_PRICE_IDS = {
  single_scan:
    normalizePaddlePriceId(import.meta.env.VITE_PADDLE_PRICE_SINGLE_SCAN, 'pri_01kph4qjjrtbdbnswrvdt16jkn'),
  pro: normalizePaddlePriceId(import.meta.env.VITE_PADDLE_PRICE_PRO, 'pri_01kph4pr6xpxhq7c4jfztdmr44'),
  pro_yearly: normalizePaddlePriceId(import.meta.env.VITE_PADDLE_PRICE_PRO_YEARLY, 'pri_01kq54g14he2zakyxr0nrt1ckc'),
};

function isLocalPaddleHost() {
  if (typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function isLivePaddleBlockedOnLocalhost() {
  return isLocalPaddleHost() && PADDLE_ENVIRONMENT !== 'sandbox';
}

function initializePaddle() {
  if (typeof window === 'undefined' || !window.Paddle || !PADDLE_CLIENT_TOKEN) return false;
  if (window.__mogcheckPaddleInitialized) return true;

  try {
    if (PADDLE_ENVIRONMENT === 'sandbox' && window.Paddle.Environment?.set) {
      window.Paddle.Environment.set('sandbox');
    }

    window.Paddle.Initialize({
      token: PADDLE_CLIENT_TOKEN,
      checkout: {
        settings: {
          displayMode: 'overlay',
          theme: 'dark',
          locale: 'en',
        },
      },
    });
    window.__mogcheckPaddleInitialized = true;
    return true;
  } catch (error) {
    if (/initialize/i.test(String(error?.message || ''))) {
      window.__mogcheckPaddleInitialized = true;
      return true;
    }
    console.error('[billing] Paddle init failed', error);
    return false;
  }
}

function openPaddleCheckout(plan, user) {
  const priceId = PADDLE_PRICE_IDS[plan];
  if (isLivePaddleBlockedOnLocalhost()) return false;
  if (!priceId || typeof window === 'undefined' || !window.Paddle) return false;
  if (!initializePaddle()) return false;

  window.Paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customer: user?.email ? { email: user.email } : undefined,
    customData: {
      plan,
      user_id: user?.uid || '',
      user_email: user?.email || '',
    },
    settings: {
      displayMode: 'overlay',
      theme: 'dark',
      allowLogout: false,
      successUrl: `${window.location.origin}/dashboard?checkout=success`,
    },
  });

  return true;
}

const API_BASE = getApiBase();
const PROFILE_SCAN_HISTORY_LIMIT = 10;
const postedAnalyzeRequestIds = new Set();

function createClientRequestId(prefix = 'scan') {
  const safePrefix = String(prefix || 'scan').replace(/[^a-z0-9_-]/gi, '') || 'scan';
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return `${safePrefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const normalizeDashboardMedia = (data, includeHistory = true) => {
  if (!data || typeof data !== 'object') return data;
  const payload = data.payload && typeof data.payload === 'object' ? data.payload : null;
  const frontImage = resolveMediaUrl(data.frontImage || data.frontImageUrl || payload?.frontImage || payload?.frontImageUrl || null);
  const sideImage = resolveMediaUrl(data.sideImage || data.sideImageUrl || payload?.sideImage || payload?.sideImageUrl || null);
  const debugAnchorsImage = resolveMediaUrl(data.debugAnchorsImage || data.debugAnchorsImageUrl || payload?.debugAnchorsImage || payload?.debugAnchorsImageUrl || null);
  const debugRatiosImage = resolveMediaUrl(data.debugRatiosImage || data.debugRatiosImageUrl || payload?.debugRatiosImage || payload?.debugRatiosImageUrl || null);
  const normalized = {
    ...data,
    frontImage,
    sideImage,
    debugAnchorsImage,
    debugAnchorsImageUrl: debugAnchorsImage,
    debugRatiosImage,
    debugRatiosImageUrl: debugRatiosImage,
  };

  if (data.frontImageUrl || frontImage) normalized.frontImageUrl = frontImage;
  if (data.sideImageUrl || sideImage) normalized.sideImageUrl = sideImage;
  if (payload) {
    normalized.payload = {
      ...payload,
      frontImage,
      sideImage,
      debugAnchorsImage,
      debugAnchorsImageUrl: debugAnchorsImage,
      debugRatiosImage,
      debugRatiosImageUrl: debugRatiosImage,
    };
  }
  if (includeHistory && Array.isArray(data.scanHistory)) {
    normalized.scanHistory = data.scanHistory.map((scan) => normalizeDashboardMedia(scan, false));
  }
  return normalized;
};

function getPremiumDemoFace(demoId = DEFAULT_PREMIUM_DEMO_ID) {
  return PREMIUM_DEMO_FACES.find((face) => face.id === demoId && face.enabled) || ACTIVE_PREMIUM_DEMO_FACES[0];
}

function normalizePremiumDemoId(demoId) {
  return getPremiumDemoFace(demoId)?.id || DEFAULT_PREMIUM_DEMO_ID;
}

function getAvailablePremiumDemoId(usedIds = [], preferredId = DEFAULT_PREMIUM_DEMO_ID) {
  const used = new Set(usedIds);
  const preferred = getPremiumDemoFace(preferredId);
  if (preferred && !used.has(preferred.id)) return preferred.id;
  return ACTIVE_PREMIUM_DEMO_FACES.find((face) => !used.has(face.id))?.id || preferred?.id || DEFAULT_PREMIUM_DEMO_ID;
}

function getPremiumDemoIdFromScan(scan) {
  const payload = scan?.payload && typeof scan.payload === 'object' ? scan.payload : {};
  const demoId = payload.demoId || scan?.demoId;
  if (demoId && getPremiumDemoFace(demoId)?.id === demoId) return demoId;
  const scanId = scan?.id || scan?.scanId || payload.scanId || payload.scanRequestId;
  const matchedFace = ACTIVE_PREMIUM_DEMO_FACES.find((face) => scanId === `premium-demo-scan-${face.id}`);
  if (matchedFace) return matchedFace.id;
  if (
    scanId === 'premium-demo-scan' ||
    scan?.isPremiumDemo ||
    scan?.demoScan ||
    payload.isPremiumDemo ||
    payload.demoScan
  ) {
    return DEFAULT_PREMIUM_DEMO_ID;
  }
  return null;
}

async function loadPremiumDemoScanPayload(demoId = DEFAULT_PREMIUM_DEMO_ID) {
  const face = getPremiumDemoFace(demoId);
  try {
    const res = await fetch(face?.payloadSrc || PREMIUM_DEMO_SCAN_PAYLOAD_SRC, { cache: 'force-cache' });
    if (res.ok) return res.json();
  } catch (error) {
    console.warn('Failed to load premium demo payload', error);
  }
  return {
    success: true,
    sex: 'male',
    finalRating: 82,
    tier: 'elite natural high-tier',
    technicalSummary: 'Exceptional structural harmony anchored by a perfect 1.0 midface ratio and strong fWHR.',
    bestFeatures: [
      { title: 'Midface Harmony', description: 'A perfect 1.0 midface ratio creates an ideal vertical balance.' },
      { title: 'Eye Area', description: 'Positive canthal tilt and strong brow compactness.' },
    ],
    primaryFlaws: [
      { title: 'Mouth Width', description: 'The mouth is slightly narrow relative to the overall facial breadth.' },
    ],
  };
}

function buildPremiumDemoScanPayload(payload = {}, overrides = {}) {
  const demoId = normalizePremiumDemoId(overrides.demoId || payload.demoId);
  const face = getPremiumDemoFace(demoId);
  const scanId = overrides.scanId || overrides.id || payload.scanId || `premium-demo-scan-${demoId}`;
  const scannedAt = overrides.scannedAt || new Date().toISOString();
  return normalizeDashboardMedia({
    ...payload,
    success: true,
    id: scanId,
    scanId,
    scanRequestId: scanId,
    profileId: 'premium-demo',
    profileName: 'Demo Scan',
    selectedModel: PREMIUM_DEMO_MODEL_ID,
    model: PREMIUM_DEMO_MODEL_ID,
    frontImage: face?.image || PREMIUM_DEMO_FRONT_IMAGE,
    frontImageUrl: face?.image || PREMIUM_DEMO_FRONT_IMAGE,
    sideImage: null,
    sideImageUrl: null,
    isPremiumDemo: true,
    demoScan: true,
    demoId,
    demoName: face?.name || 'Premium Demo',
    visibility: 'private',
    reportStatus: 'complete',
    scannedAt,
    title: 'Demo Scan',
    badge: 'Demo',
    ...overrides,
  });
}

const ANALYSIS_MODEL_LABELS = {
  '1': 'Premium Model',
  '2': 'Backup Model',
  '6': 'Premium Model',
  '7': 'Premium Model',
  '8': 'Premium Model',
  '9': 'Premium Model',
  [PREMIUM_DEMO_MODEL_ID]: 'Premium Demo',
  '3': 'Free Optic',
  '4': 'Free Core',
  '5': 'Free Geneva',
  official: 'Official Scan',
};

function getAnalysisModelLabel(model) {
  const key = String(model || '').trim();
  return ANALYSIS_MODEL_LABELS[key] || (key ? `Model ${key}` : 'Unknown AI');
}

function isFreeScanModel(model) {
  return ['3', '4', '5'].includes(String(model || '').trim());
}

const GOAT_USER_EMAILS = new Set([
  'shliggawa@gmail.com',
  'consistentlyimpressive@gmail.com',
  'consistent.fein@gmail.com',
  'ali.shahin.111015@gmail.com',
  'doggu3rd@gmail.com',
  'serenity.eyb@gmail.com',
  'bernardomorais7@gmail.com',
]);

function scansLookSame(a, b) {
  if (!a || !b) return false;
  const aRequestId = String(a.scanRequestId || a.scanId || '').trim();
  const bRequestId = String(b.scanRequestId || b.scanId || '').trim();
  if (aRequestId && bRequestId && aRequestId === bRequestId) return true;
  const sameFront = String(a.frontImage || a.frontImageUrl || '').trim() === String(b.frontImage || b.frontImageUrl || '').trim();
  const sameSide = String(a.sideImage || a.sideImageUrl || '').trim() === String(b.sideImage || b.sideImageUrl || '').trim();
  const sameProfile = String(a.profileId || 'default').trim() === String(b.profileId || 'default').trim();
  const sameRating = String(a.finalRating ?? '').trim() === String(b.finalRating ?? '').trim();
  return Boolean(sameFront && sameSide && sameProfile && sameRating);
}

function appendUniqueScan(items, scan) {
  const next = Array.isArray(items) ? [...items] : [];
  if (scan && !next.some((item) => scansLookSame(item, scan))) {
    next.push(scan);
  }
  return next;
}

function getRatingToneClasses(score) {
  const n = Number(score) || 0;
  if (n >= 90) { // Emerald Green
    return {
      text: 'text-emerald-400 drop-shadow-[0_0_16px_rgba(16,185,129,0.55)]',
      glow: 'group-hover:shadow-[0_24px_70px_rgba(16,185,129,0.22)]',
      border: 'border-emerald-300/45 group-hover:border-emerald-200/70',
      badge: 'border-emerald-300/35 bg-emerald-400/15 text-emerald-200',
      fill: 'rgba(16,185,129,0.2)',
      stroke: '#10b981',
    };
  }
  if (n >= 75) { // Greenish Yellow / Lime
    return {
      text: 'text-lime-300 drop-shadow-[0_0_13px_rgba(163,230,53,0.35)]',
      glow: 'group-hover:shadow-[0_24px_65px_rgba(163,230,53,0.12)]',
      border: 'border-lime-500/30 group-hover:border-lime-400/55',
      badge: 'border-lime-500/30 bg-lime-500/12 text-lime-300',
      fill: 'rgba(163,230,53,0.2)',
      stroke: '#a3e635',
    };
  }
  if (n >= 60) { // Yellow
    return {
      text: 'text-yellow-300 drop-shadow-[0_0_13px_rgba(250,204,21,0.35)]',
      glow: 'group-hover:shadow-[0_24px_65px_rgba(250,204,21,0.1)]',
      border: 'border-yellow-500/30 group-hover:border-yellow-400/55',
      badge: 'border-yellow-500/30 bg-yellow-500/12 text-yellow-300',
      fill: 'rgba(250,204,21,0.2)',
      stroke: '#facc15',
    };
  }
  if (n >= 50) { // Orange
    return {
      text: 'text-orange-400 drop-shadow-[0_0_13px_rgba(251,146,60,0.35)]',
      glow: 'group-hover:shadow-[0_24px_65px_rgba(249,115,22,0.12)]',
      border: 'border-orange-500/35 group-hover:border-orange-400/60',
      badge: 'border-orange-500/30 bg-orange-500/12 text-orange-300',
      fill: 'rgba(249,115,22,0.2)',
      stroke: '#f97316',
    };
  }
  // Red
  return {
    text: 'text-red-500 drop-shadow-[0_0_13px_rgba(239,68,68,0.35)]',
    glow: 'group-hover:shadow-[0_24px_65px_rgba(239,68,68,0.14)]',
    border: 'border-red-500/35 group-hover:border-red-400/60',
    badge: 'border-red-500/30 bg-red-500/12 text-red-300',
    fill: 'rgba(239,68,68,0.2)',
    stroke: '#ef4444',
  };
}

function slugifyScanName(value) {
  return String(value || 'scan')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'scan';
}

function celebrityToOfficialCommunityScan(celeb, index = 0) {
  const rating = Number(celeb?.rating) || 0;
  const stats = Array.isArray(celeb?.stats) ? celeb.stats : [];
  const categories = stats.reduce((acc, item) => {
    const label = String(item?.label || '').toLowerCase();
    const score = Number(item?.score);
    if (!Number.isFinite(score)) return acc;
    if (label.includes('skin')) acc.Skin = score;
    if (label.includes('fwhr') || label.includes('bigonial') || label.includes('jaw')) acc.Bone = score;
    if (label.includes('symmetry') || label.includes('canthal') || label.includes('ipd')) acc.Symmetry = score;
    if (label.includes('midface') || label.includes('third')) acc.Harmony = score;
    return acc;
  }, {});
  const dashboardData = {
    scanId: `official-${slugifyScanName(celeb?.name)}-${index}`,
    profileId: `official-${slugifyScanName(celeb?.name)}`,
    profileName: 'Official Scan',
    selectedModel: 'official',
    finalRating: rating,
    sideRating: rating,
    sex: celeb?.sex || null,
    technicalSummary: celeb?.technicalSummary || '',
    appealAssessment: celeb?.technicalSummary || '',
    categories: {
      Skin: categories.Skin ?? rating,
      Bone: categories.Bone ?? rating,
      Symmetry: categories.Symmetry ?? rating,
      Harmony: categories.Harmony ?? rating,
      Dimorphism: rating,
    },
    biometrics: stats,
    frontImage: celeb?.imgSrc || '',
    sideImage: celeb?.imgSrc || '',
  };
  return {
    id: dashboardData.scanId,
    scanId: dashboardData.scanId,
    ownerUid: 'official',
    officialScan: true,
    official: true,
    displayName: 'Official Scan',
    name: celeb?.name || 'Official Scan',
    tier: celeb?.tier || '',
    finalRating: rating,
    sideRating: rating,
    frontImage: dashboardData.frontImage,
    sideImage: dashboardData.sideImage,
    model: 'official',
    dashboardData,
    timestamp: `2099-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
  };
}

const OFFICIAL_CELEBRITY_COMMUNITY_SCANS = celebrityData.map(celebrityToOfficialCommunityScan);

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

const PageLoadingFallback = () => (
  <div className="flex min-h-[55vh] items-center justify-center px-6">
    <div className="flex items-center gap-3 rounded-full border border-cyan-500/20 bg-black/40 px-5 py-3 text-[10px] font-black uppercase tracking-[0.28em] text-cyan-300 shadow-[0_0_24px_rgba(34,211,238,0.12)]">
      <Loader2 size={14} className="animate-spin" />
      Loading
    </div>
  </div>
);

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

const PremiumProofModal = ({ onClose, onContinue }) => (
  <SiteModal title="See Premium In Action" subtitle="Real scan flow preview" onClose={onClose} maxWidth="max-w-md">
    <div className="space-y-5">
      <div className="mx-auto aspect-[9/16] max-h-[68vh] w-full max-w-[360px] overflow-hidden rounded-2xl border border-yellow-500/25 bg-black shadow-[0_0_50px_rgba(234,179,8,0.10)]">
        <video
          src={PREMIUM_PROOF_VIDEO_SRC}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className="h-full w-full bg-black object-cover"
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-yellow-600 to-yellow-400 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-black shadow-[0_0_25px_rgba(234,179,8,0.25)] transition-transform hover:scale-[1.02]"
        >
          <Crown size={14} /> Continue
        </button>
      </div>
    </div>
  </SiteModal>
);

// --- Navbar ---
const Navbar = ({ currentPage, setCurrentPage, onOpenPremiumPlans, user, onSignOut, userPlan, showDashboard }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const menuRef = useRef(null);
  const username = user?.email?.split('@')[0] || '';
  const planChip = user ? getNavbarPlanChip(userPlan, user) : null;
  const isAdminNavUser = Boolean(user?.email && (
    user.email === 'laithbu07@gmail.com' ||
    user.email === 'admin@looksmaxxing.com' ||
    user.email === 'serenity.eyb@gmail.com' ||
    user.email.endsWith('@looksmaxxing.com')
  ));
  const unreadNotificationCount = notifications.filter((item) => !item.read).length;

  const loadNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      return;
    }
    setNotificationsLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setNotifications(data.notifications || []);
    } catch (e) {
      console.warn('Failed to load notifications', e);
    } finally {
      setNotificationsLoading(false);
    }
  }, [user]);

  const markNotificationRead = useCallback(async (id) => {
    if (!user || !id) return;
    setNotifications((prev) => prev.map((item) => (item.id === id ? { ...item, read: true } : item)));
    try {
      const token = await user.getIdToken();
      await fetch(`${API_BASE}/api/notifications/${encodeURIComponent(id)}/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      console.warn('Failed to mark notification read', e);
    }
  }, [user]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowUserMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }
    if (showNotifications) loadNotifications();
  }, [loadNotifications, showNotifications, user]);

  return (
    <>
      {/* Top Navbar */}
      <nav className="fixed top-0 z-50 flex w-full items-center justify-between overflow-visible border-b border-zinc-900 bg-[#0c0d0e]/80 px-4 md:px-6 py-3 md:py-4 backdrop-blur-md">
        {/* Desktop Logo / Mobile Hidden if needed */}
        <div className="hidden md:flex items-center cursor-pointer group" onClick={() => setCurrentPage('home')}>
          <div className="w-9 h-9 flex items-center justify-center group-hover:rotate-12 transition-transform">
            <MogCheckLogoMark size={36} className="w-9 h-9" />
          </div>
        </div>

        {/* Mobile Navigation Buttons (at the top) */}
        <div className="md:hidden flex items-center gap-1.5 flex-1">
          {[
            { key: 'home', label: 'Home', icon: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> },
            { key: 'celebrity', label: 'Scans', icon: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> },
            { key: 'mog-battles', label: 'Battles', icon: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg> },
            { key: user ? 'dashboard' : 'login', label: 'Profile', icon: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
          ].map((tab) => {
            const isActive = currentPage === tab.key || (tab.key === 'dashboard' && (currentPage === 'dashboard' || currentPage === 'profile'));
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setCurrentPage(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl transition-all duration-200 ${isActive ? 'bg-zinc-800/60 text-cyan-400' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                {tab.icon}
                <span className={`text-[10px] font-black uppercase tracking-[0.08em] ${isActive ? 'text-white' : 'text-zinc-500'}`}>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Desktop Navigation Links */}
        <div className="hidden md:flex items-center justify-center gap-8 text-xs font-bold absolute left-1/2 -translate-x-1/2">
          <button onClick={() => setCurrentPage('home')} className={`${currentPage === 'home' ? 'text-white' : 'text-zinc-400'} hover:text-white transition-colors uppercase tracking-widest`}>Home</button>
          <button onClick={() => setCurrentPage('mog-battles')} className={`${currentPage === 'mog-battles' ? 'text-white' : 'text-zinc-400'} hover:text-white transition-colors uppercase tracking-widest flex items-center gap-1`}>
            <Swords size={14} className="text-cyan-500/90" /> Mog Battles
          </button>
          {showDashboard && (
            <button onClick={() => setCurrentPage('dashboard')} className={`${currentPage === 'dashboard' ? 'text-white' : 'text-zinc-400'} hover:text-white transition-colors uppercase tracking-widest flex items-center gap-1`}><Activity size={14} /> Dashboard</button>
          )}
          <button onClick={() => setCurrentPage('celebrity')} className={`${currentPage === 'celebrity' ? 'text-white' : 'text-zinc-400'} hover:text-white transition-colors uppercase tracking-widest`}>Scans</button>
          <button
            onClick={() => {
              if (currentPage === 'plans') setCurrentPage('plans');
              else onOpenPremiumPlans?.();
            }}
            className={`${currentPage === 'plans' ? 'text-yellow-400 drop-shadow-[0_0_8px_rgba(234,179,8,0.6)]' : 'text-yellow-500/70'} hover:text-yellow-400 transition-all uppercase tracking-widest flex items-center gap-1`}
          >
            <Crown size={13} /> Plans
          </button>
        </div>

        {/* Profile / Actions (Right side) */}
        <div className="flex items-center gap-2">
          {user ? (
            <div className="relative flex items-center gap-2" ref={menuRef}>
              <button
                type="button"
                onClick={() => {
                  setCurrentPage('photo-guide');
                  setShowUserMenu(false);
                  setShowNotifications(false);
                }}
                className="hidden md:inline-flex h-10 w-10 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 transition-all hover:border-cyan-400/60 hover:bg-cyan-500/20 hover:text-cyan-100"
                aria-label="Start scan"
              >
                <Plus size={18} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNotifications((v) => !v);
                  setShowUserMenu(false);
                  loadNotifications();
                }}
                className="relative flex h-9 w-9 md:h-10 md:w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400 transition-all hover:border-cyan-500/35 hover:text-cyan-300"
                aria-label="Notifications"
              >
                <Bell size={16} />
                {unreadNotificationCount > 0 && (
                  <span className="absolute -right-1 -top-1 min-w-5 rounded-full border border-black bg-cyan-400 px-1.5 py-0.5 text-center text-[9px] font-black leading-none text-black">
                    {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 md:gap-3 rounded-full bg-zinc-900 border border-zinc-800 px-3 md:px-4 py-1.5 md:py-2 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all"
              >
                <span className="hidden md:flex min-w-0 flex-col items-start leading-none">
                  <span className="max-w-[150px] truncate text-xs font-bold uppercase tracking-widest">{username}</span>
                  {planChip && (
                    <span className={`mt-1 text-[9px] font-bold uppercase tracking-[0.16em] ${planChip.className.includes('text-') ? planChip.className.match(/text-[^\s]+/)?.[0] || 'text-zinc-500' : 'text-zinc-500'}`}>
                      {planChip.label}
                    </span>
                  )}
                </span>
                <User size={16} className="md:hidden text-zinc-400" />
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
                    onClick={() => { onSignOut(); setShowUserMenu(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-xs text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors uppercase tracking-widest font-bold"
                  >
                    <LogOut size={14} /> Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button onClick={() => setCurrentPage('login')} className="px-4 md:px-6 py-1.5 md:py-2 rounded-full bg-white text-black font-bold text-[10px] md:text-xs uppercase tracking-widest hover:bg-zinc-200 transition-colors">Login</button>
          )}
        </div>
      </nav>
    </>
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
    <div ref={containerRef} className={`relative aspect-[4/5] rounded-xl overflow-hidden border ${isActive ? 'border-blue-500/50 scale-105 z-10 shadow-[0_0_30px_rgba(59,130,246,0.3)]' : 'border-zinc-800 opacity-80 scale-95'} transition-all duration-700 bg-zinc-900 group cursor-ew-resize select-none touch-none hover:-translate-y-3 hover:opacity-100 hover:border-blue-400/60 hover:shadow-[0_24px_70px_rgba(59,130,246,0.18)]`} onMouseDown={(e) => { setIsDragging(true); handleMove(e.clientX); }} onTouchStart={(e) => { setIsDragging(true); handleMove(e.touches[0].clientX); }}>
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

  /** Snap to 1% body-fat steps (10%-35%, 26 steps on the 0-100 slider). */
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

const CommunityScanCard = ({
  scan,
  rating,
  ratingTone,
  tierBadgeClass,
  scanTier,
  isOwnedCommunityScan,
  isAdmin,
  communityMenuId,
  onOpen,
  onRemove,
  onToggleMenu,
  onMarkOfficial,
  onShare,
  compact = false,
}) => {
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setMousePos({ x, y });
  };

  const rotateY = (mousePos.x - 50) * 0.22;
  const rotateX = (50 - mousePos.y) * 0.18;
  const modelLabel = scan.officialScan ? 'MogCheck verified' : getAnalysisModelLabel(scan.dashboardData?.selectedModel || scan.model);

  const votesCount = useMemo(() => {
    const id = String(scan.id || scan.frontImage || '');
    if (!id) return 40;
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    return 40 + (Math.abs(hash) % 53);
  }, [scan.id, scan.frontImage]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onOpen();
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
        className={`relative overflow-hidden ${compact ? 'rounded-[20px]' : 'rounded-[30px]'} border bg-zinc-900/40 transition-[transform,box-shadow,border-color] duration-500 ease-out [transform-style:preserve-3d] ${ratingTone.border} ${ratingTone.glow}`}
        style={{
          transform: isHovered
            ? `rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-12px) scale(1.025)`
            : 'rotateX(0deg) rotateY(0deg) translateY(0) scale(1)',
        }}
      >
        <div className={`relative overflow-hidden ${compact ? 'rounded-[20px]' : 'rounded-[30px]'} bg-zinc-950`}>
          <img
            src={scan.frontImage}
            className={`w-full ${compact ? 'aspect-[4/5]' : 'aspect-[3/4]'} object-cover object-top transition-transform duration-700 ease-out group-hover:scale-[1.065]`}
            alt="Community Scan"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent opacity-95" />
          <div
            className="pointer-events-none absolute inset-0 opacity-0 mix-blend-screen transition-opacity duration-300 group-hover:opacity-100"
            style={{
              background: `radial-gradient(190px circle at ${mousePos.x}% ${mousePos.y}%, rgba(255,255,255,0.18), rgba(255,255,255,0.04) 36%, transparent 68%)`,
            }}
          />
          <div className={`pointer-events-none absolute inset-0 rounded-[30px] ring-1 ring-current/20 transition ${ratingTone.text}`} />
        </div>

        <div className="absolute top-3 left-3 z-20">
          <span className={`border text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded backdrop-blur-md ${tierBadgeClass}`}>
            {scanTier}
          </span>
        </div>

        {onShare && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShare();
            }}
            className="absolute right-3 top-3 z-30 inline-flex h-8 w-8 items-center justify-center rounded-full border border-cyan-500/30 bg-black/70 text-cyan-200 backdrop-blur transition-colors hover:bg-cyan-500/15 hover:text-white"
            title="Share scan"
          >
            <Share2 size={13} />
          </button>
        )}

        {isOwnedCommunityScan && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className={`absolute ${onShare ? 'right-12' : 'right-3'} top-3 z-30 inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-500/30 bg-black/70 text-red-300 backdrop-blur transition-colors hover:bg-red-500/15 hover:text-red-200`}
            title="Remove from Community Scans"
          >
            <Trash2 size={14} />
          </button>
        )}

        {isAdmin && (
          <div className={`absolute ${onShare ? 'right-12' : 'right-3'} top-3 z-40`}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleMenu();
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-black/70 text-zinc-300 backdrop-blur transition-colors hover:border-zinc-400 hover:text-white"
              title="Admin scan actions"
            >
              <span className="text-lg leading-none">...</span>
            </button>
            {communityMenuId === scan.id && (
              <div className="absolute right-0 top-10 w-56 overflow-hidden rounded-2xl border border-zinc-700 bg-[#090a0b] text-left text-[10px] font-black uppercase tracking-[0.18em] shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkOfficial(!scan.officialScan);
                  }}
                  className="block w-full px-4 py-3 text-left text-zinc-200 hover:bg-white/5"
                >
                  {scan.officialScan ? 'Turn into community scan' : 'Turn into official scan'}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                  }}
                  className="block w-full border-t border-zinc-800 px-4 py-3 text-left text-red-300 hover:bg-red-500/10"
                >
                  Remove listing
                </button>
              </div>
            )}
          </div>
        )}

        <div className={`absolute bottom-0 inset-x-0 z-20 bg-gradient-to-t from-black via-black/80 to-transparent ${compact ? 'p-3' : 'p-4'} flex flex-col items-start [transform:translateZ(32px)]`}>
          <div className="flex items-baseline justify-between w-full pr-3 mb-1.5">
            <div className="flex items-baseline gap-1">
              <span className={`${compact ? 'text-2xl' : 'text-3xl'} font-black italic tabular-nums ${ratingTone.text}`}>{rating.toFixed(1)}</span>
              <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">/100</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Activity size={12} className="text-cyan-400" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-400">{votesCount} Votes</span>
            </div>
          </div>
          <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-[0.2em]">
            Community Scan - {modelLabel}
          </span>
        </div>
      </div>
    </div>
  );
};

const CelebrityRatingPage = ({ setCurrentPage, setSelectedCelebrity, user }) => {
  const [communityScans, setCommunityScans] = useState([]);
  const [communitySort, setCommunitySort] = useState('latest');
  const [communityPeek, setCommunityPeek] = useState(null);
  const [communityRemovalIntent, setCommunityRemovalIntent] = useState(null);
  const [communityNotice, setCommunityNotice] = useState('');
  const [communityMenuId, setCommunityMenuId] = useState(null);
  const isAdmin = Boolean(user?.email && (
    user.email === 'laithbu07@gmail.com' ||
    user.email === 'admin@looksmaxxing.com' ||
    user.email === 'serenity.eyb@gmail.com' ||
    user.email.endsWith('@looksmaxxing.com')
  ));

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
        const { fetchCommunityScans, fetchCommunityBattles } = await import('./api/mogBattleVotes');
        const res = await fetchCommunityScans(80);
        let loadedScans = (res.scans || [])
          .map((scan, idx) => hydrateCommunityScanEntry(scan, idx))
          .filter((scan) => scan?.dashboardData && scan?.frontImage);

        if (loadedScans.length === 0) {
          const battleRes = await fetchCommunityBattles();
          const scansMap = new Map();
          battleRes.battles.forEach(b => {
            if (b.fighterA) scansMap.set(b.fighterA.scanId || b.fighterA.profileId || b.fighterA.name, { ...b.fighterA, isCommunity: true });
            if (b.fighterB) scansMap.set(b.fighterB.scanId || b.fighterB.profileId || b.fighterB.name, { ...b.fighterB, isCommunity: true });
          });
          loadedScans = Array.from(scansMap.values())
            .map((scan, idx) => hydrateCommunityScanEntry(scan, idx))
            .filter((scan) => scan?.dashboardData && scan?.frontImage);
        }

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
        
        const merged = new Map();
        [...OFFICIAL_CELEBRITY_COMMUNITY_SCANS, ...loadedScans].forEach((scan, idx) => {
          const hydrated = hydrateCommunityScanEntry(scan, idx);
          const key = hydrated.scanId || hydrated.id || `${hydrated.frontImage}-${idx}`;
          if (hydrated?.dashboardData && hydrated?.frontImage && !merged.has(key)) merged.set(key, hydrated);
        });

        setCommunityScans(Array.from(merged.values()));
      } catch(e) {
        console.error(e);
        const merged = new Map();
        [
          ...OFFICIAL_CELEBRITY_COMMUNITY_SCANS,
          ...COMMUNITY_SCANS.map((scan, idx) =>
            hydrateCommunityScanEntry(
              {
                ...scan,
                name: scan.name || `User ${idx + 1}`,
                isCommunity: true,
                profileId: scan.profileId || `mock-${idx}`,
              },
              idx
            )
          ),
        ].forEach((scan, idx) => {
          const hydrated = hydrateCommunityScanEntry(scan, idx);
          const key = hydrated.scanId || hydrated.id || `${hydrated.frontImage}-${idx}`;
          if (hydrated?.dashboardData && hydrated?.frontImage && !merged.has(key)) merged.set(key, hydrated);
        });

        setCommunityScans(Array.from(merged.values()));
      }
    };
    fetchCommunity();
  }, []);

  const verifiedScans = useMemo(
    () => communityScans.filter((scan) => scan?.officialScan),
    [communityScans]
  );
  const sortedCommunityScans = useMemo(() => {
    const scans = communityScans.filter((scan) => !scan?.officialScan);
    return scans.sort((a, b) => {
      if (communitySort === 'highest') {
        const ratingDiff = (Number(b.finalRating) || 0) - (Number(a.finalRating) || 0);
        if (ratingDiff) return ratingDiff;
      }
      return timestampToMillis(b.timestamp || b.scannedAt || b.createdAt) - timestampToMillis(a.timestamp || a.scannedAt || a.createdAt);
    });
  }, [communityScans, communitySort]);

  const getCelebrityScanShareUrl = useCallback((scan) => {
    const ownerUid = String(scan?.ownerUid || scan?.uid || '').trim();
    const scanId = String(scan?.scanId || scan?.id || '').trim();
    if (ownerUid && scanId && !scan?.officialScan) {
      return `${window.location.origin}/scan/${encodeURIComponent(ownerUid)}/${encodeURIComponent(scanId)}`;
    }
    return `${window.location.origin}/celebrity?scan=${encodeURIComponent(scanId || scan?.id || 'community')}`;
  }, []);

  const shareCommunityScan = useCallback(async (scan) => {
    const url = getCelebrityScanShareUrl(scan);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCommunityNotice('Scan link copied.');
      } else {
        setCommunityNotice(url);
      }
    } catch {
      setCommunityNotice(url);
    }
  }, [getCelebrityScanShareUrl]);

  useEffect(() => {
    if (!communityScans.length || communityPeek) return;
    const requestedScanId = new URLSearchParams(window.location.search).get('scan');
    if (!requestedScanId) return;
    const match = communityScans.find((scan) => String(scan.scanId || scan.id) === String(requestedScanId));
    if (match?.dashboardData) setCommunityPeek(match);
  }, [communityScans, communityPeek]);

  const removeOwnedCommunityScan = async (scan) => {
    if (!user || !scan?.scanId) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/scans/${encodeURIComponent(scan.scanId)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ visibility: 'private' }),
      });
      if (!res.ok) throw new Error('Failed to update scan visibility');
      setCommunityScans((prev) => prev.filter((item) => item.id !== scan.id && item.scanId !== scan.scanId));
      setCommunityNotice('Scan removed from Community Scans. It is still saved privately on your dashboard.');
    } catch (e) {
      setCommunityNotice(e.message || 'Failed to remove scan from Community Scans.');
    } finally {
      setCommunityRemovalIntent(null);
    }
  };

  const removeAdminCommunityScan = async (scan) => {
    const password = window.localStorage.getItem('mogcheck_admin_pw') || '';
    if (!password || !scan?.id) {
      setCommunityNotice('Admin password is required. Log into the admin panel once, then try again.');
      setCommunityRemovalIntent(null);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/admin/community-scans/${encodeURIComponent(scan.id)}`, {
        method: 'DELETE',
        headers: { 'x-admin-password': password },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to remove community scan listing');
      setCommunityScans((prev) => prev.filter((item) => item.id !== scan.id && item.scanId !== scan.scanId));
      setCommunityNotice('Community scan listing removed. The saved user scan was not deleted.');
    } catch (e) {
      setCommunityNotice(e.message || 'Failed to remove community scan listing.');
    } finally {
      setCommunityRemovalIntent(null);
      setCommunityMenuId(null);
    }
  };

  const removeCommunityScan = async (scan) => {
    const isOwner = Boolean(user?.uid && scan?.ownerUid && scan.ownerUid === user.uid && scan?.scanId);
    if (isOwner) return removeOwnedCommunityScan(scan);
    if (isAdmin) return removeAdminCommunityScan(scan);
    setCommunityRemovalIntent(null);
    return undefined;
  };

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
      setCommunityScans((prev) => prev.map((item) => (item.id === scan.id ? { ...item, officialScan: official, official } : item)));
      setCommunityNotice(official ? 'Scan marked as official.' : 'Scan turned back into a normal community scan.');
    } catch (e) {
      setCommunityNotice(e.message || 'Failed to update official status.');
    } finally {
      setCommunityMenuId(null);
    }
  };

  const renderScanColumn = (title, subtitle, scans, controls = null) => (
    <section className="min-w-0 rounded-[28px] border border-zinc-800/90 bg-black/25 p-4 shadow-[0_20px_70px_rgba(0,0,0,0.28)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0 text-left">
          <h3 className="text-sm font-black uppercase tracking-[0.22em] text-white">{title}</h3>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">{subtitle}</p>
        </div>
        {controls}
      </div>
      <div className="mog-scroll max-h-[74vh] overflow-y-auto pr-2">
        <div className="grid grid-cols-2 gap-3 md:gap-4">
          {scans.filter((rawScan) => rawScan?.dashboardData && rawScan?.frontImage).map((rawScan, idx) => {
            const scan = hydrateCommunityScanEntry(rawScan, idx);
            const isOwnedCommunityScan = Boolean(user?.uid && scan.ownerUid && scan.ownerUid === user.uid && scan.scanId && !scan.officialScan);
            const rating = Number(scan.finalRating || 0);
            const ratingTone = getRatingToneClasses(rating);
            const scanTier = scan.tier || '-';
            const tierUpper = String(scanTier).toUpperCase();
            const tierBadgeClass =
              tierUpper.includes('S') && tierUpper.includes('TIER')
                ? 'bg-red-500/20 text-red-500 border-red-500/30 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                : tierUpper.includes('A') && tierUpper.includes('TIER')
                  ? 'bg-orange-500/20 text-orange-400 border-orange-500/30 shadow-[0_0_8px_rgba(249,115,22,0.6)]'
                  : 'bg-zinc-700/40 text-zinc-300 border-zinc-600/50';

            return (
              <CommunityScanCard
                key={scan.id || idx}
                scan={scan}
                rating={rating}
                ratingTone={ratingTone}
                tierBadgeClass={tierBadgeClass}
                scanTier={scanTier}
                isOwnedCommunityScan={isOwnedCommunityScan}
                isAdmin={isAdmin}
                communityMenuId={communityMenuId}
                compact
                onOpen={() => {
                  if (!scan.dashboardData) return;
                  setCommunityPeek(scan);
                }}
                onShare={() => shareCommunityScan(scan)}
                onRemove={() => setCommunityRemovalIntent(scan)}
                onToggleMenu={() => setCommunityMenuId((prev) => (prev === scan.id ? null : scan.id))}
                onMarkOfficial={(official) => markCommunityScanOfficial(scan, official)}
              />
            );
          })}
        </div>
        {scans.length === 0 && (
          <p className="py-12 text-center text-sm text-zinc-500">No scans available yet.</p>
        )}
      </div>
    </section>
  );

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
                Community scan{communityPeek?.tier ? ` - ${communityPeek.tier}` : ''}
              </p>
              <h2 id="community-scan-page-title" className="truncate font-black uppercase italic tracking-tight text-white">
                Community Scan
              </h2>
            </div>
          </header>
          <div className="flex-1 px-4 pb-16 pt-6 md:px-8">
            <button
              type="button"
              onClick={() => setCommunityPeek(null)}
              className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/[0.07] px-4 py-2 font-sans text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100 transition-colors hover:border-cyan-300/60 hover:bg-cyan-400/10"
            >
              <ArrowLeft size={14} />
              Go to previous page
            </button>
            <DashboardPage
              dashboardData={forceCommunityScanFrontOnly(communityPeek.dashboardData)}
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
      <div className="w-full max-w-7xl mx-auto flex flex-col items-center text-center">
        <h2 className="text-3xl font-black italic uppercase tracking-widest text-white mb-2">Scans</h2>
        <p className="text-zinc-500 uppercase tracking-widest text-xs mb-8">Verified scans and live community scans with shareable links.</p>
        <div className="grid w-full grid-cols-1 gap-5 lg:grid-cols-2">
          {renderScanColumn('Verified Scans', `${verifiedScans.length} MogCheck verified`, verifiedScans)}
          {renderScanColumn(
            'Community Scans',
            `${sortedCommunityScans.length} public community scans`,
            sortedCommunityScans,
              <CustomSelectDropdown
                value={communitySort}
                onChange={setCommunitySort}
                options={[
                  { value: 'latest', label: 'Latest' },
                  { value: 'highest', label: 'Highest score' }
                ]}
                className="appearance-none rounded-full border border-cyan-400/20 bg-cyan-400/[0.06] px-4 py-3 text-[9px] font-black uppercase tracking-[0.18em] text-cyan-100 focus:border-cyan-300/50"
              />
          )}
        </div>
      </div>
      {communityRemovalIntent && (
        <ConfirmDialog
          title="Remove From Community?"
          body={isAdmin && !(user?.uid && communityRemovalIntent?.ownerUid === user.uid)
            ? 'This removes the public Community Scans listing only. The saved user scan will not be deleted.'
            : 'This will set the scan back to private. It will stay saved on your dashboard, but it will disappear from Community Scans.'}
          confirmLabel="Remove"
          tone="danger"
          onClose={() => setCommunityRemovalIntent(null)}
          onConfirm={() => removeCommunityScan(communityRemovalIntent)}
        />
      )}
      {communityNotice && (
        <SiteModal title="Community Scan" onClose={() => setCommunityNotice('')} maxWidth="max-w-lg">
          <p className="text-sm leading-relaxed text-zinc-300">{communityNotice}</p>
        </SiteModal>
      )}
    </div>
  );
};

const CustomSelectDropdown = ({ value, onChange, options, className }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(o => o.value === value) || options[0];

  return (
    <div className="relative shrink-0 w-full md:w-auto" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex w-full items-center justify-between gap-4 outline-none transition-colors ${className}`}
      >
        <span>{selectedOption?.label}</span>
        <ChevronDown size={14} className={`transition-transform duration-300 ${isOpen ? 'rotate-180 text-cyan-200' : 'text-cyan-200/70'}`} />
      </button>
      
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-full min-w-[200px] z-[100] rounded-[20px] border border-cyan-500/30 bg-[#06080a] p-2 shadow-[0_12px_40px_rgba(0,0,0,0.8),0_0_20px_rgba(0,240,255,0.1)] backdrop-blur-xl animate-[mogBattle2NoticeIn__0.2s_ease-out] flex flex-col gap-1">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setIsOpen(false); }}
              className={`w-full text-left px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.18em] transition-all duration-200 ${
                value === opt.value 
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/20 shadow-[inset_0_0_10px_rgba(0,240,255,0.1)]' 
                  : 'text-zinc-400 hover:bg-cyan-950/40 hover:text-cyan-100 border border-transparent'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
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
          Back to Community Scans
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
                <p className="text-zinc-300 font-sans leading-relaxed tracking-wide">
                  {renderMarkedText(celeb.technicalSummary)}
                </p>
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
  const [scanToDelete, setScanToDelete] = useState(null);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [profileNotice, setProfileNotice] = useState('');

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
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/scans/${scanId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to delete scan');
      setScans(scans.filter(s => s.id !== scanId));
    } catch (e) {
      setProfileNotice("Error deleting scan: " + e.message);
    } finally {
      setScanToDelete(null);
    }
  };

  const handleDeleteAccount = async () => {
    try {
      const { deleteUser } = await import('firebase/auth');
      if (user) {
        await deleteUser(user);
        setCurrentPage('home');
      }
    } catch (e) {
      console.error("Error deleting account:", e);
      setProfileNotice("Error deleting account. For security reasons, you may need to sign out and sign back in before deleting your account.");
    } finally {
      setConfirmDeleteAccount(false);
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
                <span className="text-lg font-black uppercase text-cyan-400">{userPlan.planLabel || userPlan.plan}</span>
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
              <button onClick={() => setConfirmDeleteAccount(true)} className="w-full py-2 bg-red-500/10 border border-red-500/30 text-red-500 rounded hover:bg-red-500/20 transition-colors uppercase tracking-widest text-[10px] font-bold">
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
                          <span className="text-sm font-black text-zinc-100">{scan.finalRating ?? '-'}/100</span>
                          {(['1', '2', '6', '7', '8', '9'].includes(String(scan.model || '').trim())) && <span className="bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest">Premium</span>}
                          {scan.success === false && <span className="bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest">Failed</span>}
                        </div>
                        <div className="text-[10px] font-sans text-zinc-500 uppercase tracking-widest">
                          {formatTimestamp(scan.timestamp || scan.scannedAt || scan.createdAt)}
                        </div>
                      </div>
                    </div>
                    <button 
                      onClick={() => setScanToDelete(scan.id)}
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
      {scanToDelete && (
        <ConfirmDialog
          title="Delete Scan?"
          body="Are you sure you want to delete this scan and its images? This removes it from your profile and community scans."
          confirmLabel="Delete Scan"
          tone="danger"
          onClose={() => setScanToDelete(null)}
          onConfirm={() => handleDeleteScan(scanToDelete)}
        />
      )}

      {confirmDeleteAccount && (
        <ConfirmDialog
          title="Delete Account?"
          body="Are you sure you want to delete your account? This action cannot be undone and you will lose all scan history."
          confirmLabel="Delete Account"
          tone="danger"
          onClose={() => setConfirmDeleteAccount(false)}
          onConfirm={handleDeleteAccount}
        />
      )}

      {profileNotice && (
        <SiteModal title="Profile Notice" onClose={() => setProfileNotice('')} maxWidth="max-w-lg">
          <p className="text-sm leading-relaxed text-zinc-300">{profileNotice}</p>
        </SiteModal>
      )}
    </div>
  );
};

const HomePage = ({ setCurrentPage, user, queueAnalysisJob }) => {
  const [analysisHeroCount, setAnalysisHeroCount] = useState(74);
  const [activeUsers, setActiveUsers] = useState(106);
  const [homeDemoId, setHomeDemoId] = useState(DEFAULT_PREMIUM_DEMO_ID);
  const [homeDemoNotice, setHomeDemoNotice] = useState('');
  const [homeDemoStarting, setHomeDemoStarting] = useState(false);
  const [homeProAnnual, setHomeProAnnual] = useState(false);
  const heroFaceVideoRef = useRef(null);

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

  useEffect(() => {
    const video = heroFaceVideoRef.current;
    if (!video) return undefined;

    let rafId = 0;
    let active = true;
    let startedAt = null;
    const rate = 1.3;

    const tick = (frameAt) => {
      if (!active) return;
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      if (!duration) {
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      if (startedAt == null) startedAt = frameAt - ((video.currentTime || 0) / rate) * 1000;
      const elapsedSeconds = ((frameAt - startedAt) / 1000) * rate;
      const cycle = duration * 2;
      const phase = elapsedSeconds % cycle;
      const endpointPadding = Math.min(0.04, duration / 30);
      const rawPosition = phase <= duration ? phase : cycle - phase;
      const position = Math.min(duration - endpointPadding, Math.max(endpointPadding, rawPosition));

      if (Math.abs(video.currentTime - position) > 0.025) {
        try {
          video.currentTime = position;
        } catch {
          /* keep decorative animation best-effort */
        }
      }
      rafId = window.requestAnimationFrame(tick);
    };

    const startPingPong = () => {
      window.cancelAnimationFrame(rafId);
      video.pause();
      startedAt = null;
      rafId = window.requestAnimationFrame(tick);
    };

    video.addEventListener('loadedmetadata', startPingPong);
    if (video.readyState >= 1) startPingPong();

    return () => {
      active = false;
      window.cancelAnimationFrame(rafId);
      video.removeEventListener('loadedmetadata', startPingPong);
    };
  }, []);

  const whatMattersItems = [
    {
      step: '01 / Upload',
      title: 'Start With A Clear Front Photo',
      imgSrc: measureItems[0].imgSrc,
      text: 'MogCheck begins with a clean face input, then prepares the image for structure, harmony, skin, and proportion analysis. No guessing, no trend-chasing, just a consistent scan target.',
      note: 'Front-facing photos produce the cleanest ratings and profile history.',
    },
    {
      step: '02 / Measure',
      title: 'Extract The Metrics That Shape The Read',
      imgSrc: measureItems[1].imgSrc,
      text: 'The system checks ratios, spacing, balance, dimorphism, symmetry, and visible quality signals. Premium scans go deeper with best features, flaws, structural overview, and personalized feedback.',
      note: 'The goal is to explain why a face reads the way it does.',
    },
    {
      step: '03 / Report',
      title: 'Turn The Scan Into A Dashboard',
      imgSrc: measureItems[2].imgSrc,
      text: 'Your result becomes a saved profile scan with ratings, category signals, morphometric ratios, and protocols. You can compare scans over time instead of losing everything after one result.',
      note: 'Profiles keep your progress organized scan by scan.',
    },
    {
      step: '04 / Improve',
      title: 'Use The Feedback To Know What To Work On',
      imgSrc: measureItems[3].imgSrc,
      text: 'The point is not random advice. It is direction: what is helping, what is holding the rating back, and what changes are most likely to matter for your face specifically.',
      note: 'Better inputs, clearer goals, and repeatable progress.',
    },
  ];
  const selectedHomeDemoFace = PREMIUM_DEMO_FACES.find((face) => face.id === homeDemoId) || getPremiumDemoFace(homeDemoId);
  const selectedHomeDemoLocked = !selectedHomeDemoFace?.enabled;

  const startHomeDemoScan = async () => {
    setHomeDemoNotice('');
    if (selectedHomeDemoLocked) {
      setHomeDemoNotice('This demo face is locked for now. Choose Henry or Sean.');
      return;
    }
    if (!user) {
      setCurrentPage('login');
      return;
    }
    setHomeDemoStarting(true);
    try {
      const requestedDemoId = normalizePremiumDemoId(homeDemoId);
      const requestedDemoFace = getPremiumDemoFace(requestedDemoId);
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/demo-scan`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ demoId: requestedDemoId }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setHomeDemoNotice(body.error || 'You already used this demo face. Pick another available one.');
        return;
      }
      if (!res.ok) throw new Error(body.error || 'Failed to save demo scan.');
      const demoPayload = buildPremiumDemoScanPayload(body.payload || body.scan?.payload || await loadPremiumDemoScanPayload(requestedDemoId), {
        demoId: requestedDemoId,
        id: body.scan?.id || `premium-demo-scan-${requestedDemoId}`,
        scanId: body.scan?.scanId || body.scan?.id || `premium-demo-scan-${requestedDemoId}`,
        scannedAt: body.scan?.scannedAt || body.scan?.createdAt || new Date().toISOString(),
      });
      const queuedJob = queueAnalysisJob?.({
        analysisLabel: 'Demo Scan',
        mainImageSrc: requestedDemoFace?.image || PREMIUM_DEMO_FRONT_IMAGE,
        mainImageFile: null,
        sideImageUrl: null,
        sideImageFile: null,
        sideMetricData: null,
        choice: PREMIUM_DEMO_MODEL_ID,
        user,
        profileId: PREMIUM_DEMO_MODEL_ID,
        scanRequestId: demoPayload?.scanRequestId || `premium-demo-scan-${requestedDemoId}`,
        demoPayload,
      });
      if (!queuedJob) throw new Error('Demo scan could not be queued.');
      setCurrentPage('analysis');
    } catch (e) {
      setHomeDemoNotice(e.message || 'Failed to start demo scan.');
    } finally {
      setHomeDemoStarting(false);
    }
  };

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
        className="pointer-events-none absolute left-1/2 top-[18vh] z-0 w-[min(118vw,1040px)] h-[min(82vh,760px)] origin-center -translate-x-1/2 -translate-y-[22%] sm:-translate-y-[27%] md:-translate-y-[32%] overflow-visible scale-[0.81]"
        style={{ mixBlendMode: 'plus-lighter' }}
        aria-hidden
      >
        <video
          ref={heroFaceVideoRef}
          muted 
          playsInline 
          preload="auto"
          className="w-full h-full object-contain object-center opacity-[0.92]"
          style={{ filter: 'contrast(1.08) brightness(1.05)', mixBlendMode: 'plus-lighter' }}
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
        @keyframes processScanLine {
          0% { transform: translateY(-120%); opacity: 0; }
          14% { opacity: 0.75; }
          72% { opacity: 0.35; }
          100% { transform: translateY(420%); opacity: 0; }
        }
        @keyframes lineDrift {
          0% { transform: translateX(-45%); opacity: 0.25; }
          50% { opacity: 0.85; }
          100% { transform: translateX(45%); opacity: 0.25; }
        }
        @keyframes homeFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>

      <FadeUp>
        <div className="relative flex flex-col items-center w-full max-w-6xl mx-auto">
          {/* Wireframe only behind the headline - flow continues at divider / CTA */}
          <div className="relative w-full flex justify-center px-4 mb-6 md:mb-10">
          {/* Mesh: absolute overlay only - height comes from headline text, not from the SVG */}
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
          <button
            onClick={() => setCurrentPage('login')}
            className="mx-auto group relative inline-flex items-center gap-5 overflow-hidden rounded-full border border-cyan-200/60 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(233,249,255,0.98)_54%,rgba(182,240,255,0.96))] px-10 py-4 text-black shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_0_44px_rgba(34,211,238,0.24),0_22px_70px_rgba(0,0,0,0.32)] transition-all duration-500 hover:-translate-y-1 hover:scale-[1.03] hover:shadow-[0_0_0_1px_rgba(255,255,255,0.18),0_0_68px_rgba(34,211,238,0.36),0_28px_90px_rgba(0,0,0,0.42)]"
            style={{ animation: 'ctaPulse 3s ease-in-out infinite' }}
          >
            <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent opacity-80 transition-transform duration-700 group-hover:translate-x-[360%]" />
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-600 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.28)]">
              <Plus size={18} />
            </span>
            <span className="relative text-lg font-black uppercase tracking-[0.26em]">TRY FOR FREE</span>
            <div className="relative flex items-center text-cyan-700">
              <div className="h-[2px] w-10 bg-cyan-700/70 transition-all duration-300 group-hover:w-12" />
              <ChevronRight size={20} className="-ml-1 transition-transform duration-300 group-hover:translate-x-1" />
            </div>
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
        <div className="grid grid-cols-2 gap-4 md:gap-8 items-start max-w-5xl mx-auto">
          <ComparisonCard beforeImgSrc={compBefore1} afterImgSrc={compAfter1} beforeScore="4.8" afterScore="7.4" review={reviewsData[0]} />
          <ComparisonCard beforeImgSrc={compBefore2} afterImgSrc={compAfter2} beforeScore="5.2" afterScore="8.5" isActive={true} review={reviewsData[2]} />
          <div className="col-span-2 flex justify-center -mt-2 md:-mt-4">
            <div className="w-full max-w-[calc(50%-0.5rem)] md:max-w-[calc(50%-1rem)]">
              <ComparisonCard beforeImgSrc={compAfter3} afterImgSrc={compBefore3} beforeScore="4.5" afterScore="7.1" review={reviewsData[1]} />
            </div>
          </div>
        </div>
      </FadeUp>
    </section>

    <section className="w-full pt-16 pb-16 px-6 max-w-5xl mx-auto relative z-0">
      <FadeUp>
        <div className="group overflow-hidden rounded-[32px] border border-cyan-500/15 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_35%),linear-gradient(180deg,rgba(10,13,16,0.98),rgba(8,9,10,0.98))] p-8 md:p-10 shadow-[0_0_40px_rgba(34,211,238,0.07)] transition-all duration-500 hover:-translate-y-2 hover:border-cyan-400/35 hover:shadow-[0_22px_70px_rgba(34,211,238,0.12)]">
          <div className="grid gap-8 md:grid-cols-[1.25fr_0.75fr] md:items-center">
            <div>
              <p className="text-[10px] font-sans uppercase tracking-[0.3em] text-cyan-400/80">Live Matchups</p>
              <h2 className="mt-3 text-4xl md:text-5xl font-black italic uppercase tracking-tighter text-white">Mog Battles</h2>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400">
                Compare scans head-to-head, track community voting, and follow how specific battles move over time.
              </p>
            </div>
            <div className="flex md:justify-end">
              <button
                type="button"
                onClick={() => setCurrentPage('mog-battles')}
                className="group inline-flex items-center gap-3 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-6 py-4 text-sm font-black uppercase tracking-[0.22em] text-cyan-300 transition-all hover:scale-[1.02] hover:bg-cyan-500/20 hover:shadow-[0_0_24px_rgba(34,211,238,0.16)]"
              >
                Open Mog Battles
                <ArrowUpRight size={18} className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>
        </div>
      </FadeUp>
    </section>

    <section className="w-full px-6 pb-20 pt-8 relative z-10">
      <FadeUp>
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center">
          <h2 className="mb-3 text-center text-4xl md:text-5xl font-black italic uppercase tracking-tighter text-white">
            Try A Demo Scan
          </h2>
          <p className="mb-10 max-w-2xl text-center text-sm leading-relaxed text-zinc-400">
            See how the analysis looks before creating an account.
          </p>
          <div className="relative w-full max-w-[380px]">
            <div className="pointer-events-none absolute inset-[-22px] bg-[radial-gradient(circle,rgba(34,211,238,0.14),transparent_66%)] blur-2xl" />
            <div className="relative overflow-hidden rounded-[1.4rem] bg-zinc-950 shadow-[0_28px_80px_rgba(0,0,0,0.4)]">
              {selectedHomeDemoFace.image ? (
                <img
                  src={selectedHomeDemoFace.image}
                  alt={`${selectedHomeDemoFace.name} demo face`}
                  className="aspect-[3/4] w-full object-cover saturate-0 brightness-[0.88] contrast-[1.08]"
                />
              ) : (
                <span className="flex aspect-[3/4] flex-col items-center justify-center gap-3 bg-zinc-950/70 text-zinc-600">
                  <Lock size={24} />
                  <span className="text-[9px] font-black uppercase tracking-[0.24em]">Locked</span>
                </span>
              )}
            </div>
          </div>

          {homeDemoNotice && (
            <p className="mt-3 max-w-lg text-center text-xs font-sans leading-relaxed text-amber-200/90">{homeDemoNotice}</p>
          )}

          <button
            type="button"
            onClick={startHomeDemoScan}
            disabled={homeDemoStarting || selectedHomeDemoLocked}
            className="group mt-8 relative flex w-full max-w-md items-center justify-center gap-4 overflow-hidden rounded-xl border border-cyan-200/50 bg-[linear-gradient(135deg,rgba(34,211,238,0.95),rgba(14,165,233,0.78)_42%,rgba(29,78,216,0.88))] px-12 py-6 text-lg font-black uppercase tracking-[0.28em] text-white shadow-[0_0_34px_rgba(34,211,238,0.38),0_18px_70px_rgba(14,165,233,0.16)] transition-all duration-300 hover:-translate-y-1 hover:scale-[1.015] hover:shadow-[0_0_54px_rgba(34,211,238,0.55),0_24px_90px_rgba(14,165,233,0.22)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:scale-100"
          >
            <span className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/50 to-transparent opacity-60 transition-transform duration-700 group-hover:translate-x-[320%]" />
            <span className="relative z-10">{homeDemoStarting ? 'Starting' : selectedHomeDemoLocked ? 'Locked' : 'Try Demo Scan'}</span>
            <ChevronRight size={26} className="relative z-10 transition-transform group-hover:translate-x-1" />
          </button>
        </div>
      </FadeUp>
    </section>

    <section className="w-full pt-16 pb-32 px-6 bg-[#0c0d0e]">
      <FadeUp>
        <div className="text-center mb-10 md:mb-16">
          <h2 className="text-3xl md:text-5xl font-black italic uppercase tracking-tighter text-white mb-2 md:mb-4">What Actually Matters</h2>
          <p className="text-zinc-500 font-sans text-[9px] md:text-[10px] uppercase tracking-widest">What we do, how it works, and why it is repeatable.</p>
        </div>
      </FadeUp>
      <div className="w-full max-w-6xl mx-auto space-y-8 md:space-y-20">
        {whatMattersItems.map((item, idx) => {
          const imageFirst = idx % 2 === 0;
          return (
            <FadeUp key={item.step} delay={idx * 120}>
              <div className="group/process grid gap-6 md:gap-12 md:grid-cols-2 md:items-center">
                <div
                  className={`${imageFirst ? 'md:order-1' : 'md:order-2'} w-full order-1`}
                  style={{ animation: `homeFloat ${6.8 + idx * 0.35}s ease-in-out infinite`, animationDelay: `${idx * 0.35}s` }}
                >
                  <div className="relative overflow-hidden rounded-2xl border border-zinc-800/70 shadow-[0_24px_70px_rgba(0,0,0,0.38)] transition-all duration-500 group-hover/process:-translate-y-2 group-hover/process:border-cyan-400/35">
                    <img
                      loading="lazy"
                      decoding="async"
                      src={item.imgSrc}
                      alt=""
                      className="relative z-10 block h-auto w-full [filter:grayscale(100%)_saturate(0)] transition-all duration-700 group-hover/process:scale-[1.02] group-hover/process:brightness-110"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.12),transparent_45%)] opacity-20 transition-opacity duration-500 group-hover/process:opacity-100" />
                  </div>
                </div>
                <div className={`${imageFirst ? 'md:order-2 md:pl-4' : 'md:order-1 md:pr-4'} max-w-lg order-2 px-2 md:px-0`}>
                  <p className="mb-1.5 font-sans text-[8px] md:text-[9px] font-bold uppercase tracking-[0.36em] text-cyan-400/80">{item.step}</p>
                  <h3 className="text-lg md:text-3xl font-black italic uppercase tracking-tight text-white leading-tight">{item.title}</h3>
                  <div className="my-2.5 md:my-5 h-[1.5px] w-12 md:w-28 overflow-hidden bg-zinc-800">
                    <div className="h-full w-full bg-gradient-to-r from-transparent via-cyan-300 to-transparent" style={{ animation: 'lineDrift 3.2s ease-in-out infinite' }} />
                  </div>
                  <p className="font-sans text-[11px] md:text-base leading-5 md:leading-7 text-zinc-400 md:text-zinc-300">{item.text}</p>
                  <p className="mt-3 md:mt-5 font-sans text-[8px] md:text-[9px] font-bold uppercase tracking-[0.26em] text-zinc-600 md:text-zinc-500">{item.note}</p>
                </div>
              </div>
            </FadeUp>
          );
        })}
      </div>
    </section>

    <section className="w-full px-6 py-28 border-t border-zinc-900 bg-[radial-gradient(circle_at_50%_0%,rgba(234,179,8,0.06),transparent_34%),#0c0d0e]">
      <FadeUp>
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <p className="mb-4 text-[10px] font-black uppercase tracking-[0.38em] text-yellow-400/75">Plans</p>
          <h2 className="text-4xl md:text-6xl font-black italic uppercase tracking-tighter text-white">Choose Your Access</h2>
          <p className="mx-auto mt-5 max-w-xl text-sm font-sans leading-relaxed text-zinc-500">
            Start free, unlock two premium scans, or use Pro for full tracking and unlimited analysis.
          </p>
        </div>
      </FadeUp>

      <div className="mx-auto grid w-full max-w-6xl items-center gap-6 lg:grid-cols-[0.9fr_1.08fr_0.9fr]">
        <FadeUp delay={100}>
          <div className="group flex min-h-[540px] flex-col rounded-[28px] border border-zinc-800 bg-zinc-950/55 p-7 shadow-[0_18px_70px_rgba(0,0,0,0.24)] transition-all duration-500 hover:-translate-y-2 hover:border-zinc-600">
            <div className="mb-8">
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.34em] text-zinc-500">Starter</p>
              <h3 className="text-4xl font-black italic uppercase tracking-tighter text-white">Free</h3>
            </div>
            <div className="mb-8 flex items-end gap-2">
              <span className="text-6xl font-black tracking-tighter text-white">$0</span>
              <span className="pb-2 text-xs font-sans uppercase tracking-[0.24em] text-zinc-600">Forever</span>
            </div>
            <div className="mb-8 h-px w-full bg-zinc-800" />
            <ul className="mb-10 flex flex-col gap-4 text-sm font-sans text-zinc-400">
              <li className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-zinc-500" /> Basic appearance overview & general rating</li>
              <li className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-zinc-500" /> Structural symmetry snapshot</li>
              <li className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-zinc-500" /> 1 scan per day</li>
              <li className="flex gap-3 text-zinc-600"><X size={16} className="mt-0.5 shrink-0 text-zinc-700" /> No detailed facial biometrics</li>
              <li className="flex gap-3 text-zinc-600"><X size={16} className="mt-0.5 shrink-0 text-zinc-700" /> No AI potential analysis</li>
              <li className="flex gap-3 text-zinc-600"><X size={16} className="mt-0.5 shrink-0 text-zinc-700" /> No personalized protocols</li>
              <li className="flex gap-3 text-zinc-600"><X size={16} className="mt-0.5 shrink-0 text-zinc-700" /> No celebrity lookalike matching</li>
            </ul>
            <button
              type="button"
              onClick={() => setCurrentPage('photo-guide')}
              className="group mt-auto inline-flex items-center justify-center gap-3 rounded-2xl border border-cyan-400/30 bg-[linear-gradient(135deg,rgba(15,23,42,0.92),rgba(8,47,73,0.9))] px-5 py-4 text-xs font-black uppercase tracking-[0.24em] text-cyan-100 shadow-[0_0_28px_rgba(34,211,238,0.08)] transition-all duration-300 hover:-translate-y-1 hover:border-cyan-300/60 hover:shadow-[0_0_36px_rgba(34,211,238,0.16)]"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 text-cyan-300">
                <Plus size={14} />
              </span>
              Start Free
              <ChevronRight size={16} className="transition-transform duration-300 group-hover:translate-x-0.5" />
            </button>
          </div>
        </FadeUp>

        <FadeUp delay={180}>
          <div className={`relative flex h-[910px] flex-col overflow-hidden rounded-[30px] bg-zinc-950 p-8 transition-all duration-[2200ms] hover:-translate-y-3 ${
            homeProAnnual
              ? 'border border-emerald-500/35 shadow-[0_0_80px_rgba(16,185,129,0.11)] hover:border-emerald-300/70 hover:shadow-[0_0_100px_rgba(16,185,129,0.18)]'
              : 'border border-yellow-400/45 shadow-[0_0_80px_rgba(234,179,8,0.13)] hover:border-yellow-300/70 hover:shadow-[0_0_100px_rgba(234,179,8,0.2)]'
          }`}>
            <div className={`pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(250,204,21,0.18),transparent_34%),linear-gradient(180deg,rgba(28,22,4,0.92),rgba(9,9,11,0.96))] transition-opacity duration-[2200ms] ease-in-out ${homeProAnnual ? 'opacity-0' : 'opacity-100'}`} />
            <div className={`pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(16,185,129,0.18),transparent_34%),linear-gradient(180deg,rgba(9,21,27,0.92),rgba(9,9,11,0.96))] transition-opacity duration-[2200ms] ease-in-out ${homeProAnnual ? 'opacity-100' : 'opacity-0'}`} />
            <div className="relative z-10 flex flex-1 flex-col">
            <div className="mb-8 text-center">
              <h3 className={`text-5xl font-black italic uppercase tracking-tighter text-white transition-[filter] duration-700 ${
                homeProAnnual
                  ? 'drop-shadow-[0_0_24px_rgba(16,185,129,0.24)]'
                  : 'drop-shadow-[0_0_24px_rgba(234,179,8,0.22)]'
              }`}>Pro</h3>
              <p className={`-mt-1 text-xs font-sans uppercase tracking-[0.24em] transition-colors duration-700 ${homeProAnnual ? 'text-emerald-200/80' : 'text-yellow-200/80'}`}>Most popular</p>
            </div>
            <div className="mb-8 flex items-center justify-between gap-4">
              <div>
                <p className={`mb-2 text-[10px] font-black uppercase tracking-[0.34em] transition-colors duration-700 ${homeProAnnual ? 'text-emerald-400/70' : 'text-yellow-400/70'}`}>Full access</p>
                <p className="text-sm font-sans text-zinc-400">{homeProAnnual ? 'Annual billing' : 'Monthly billing'}</p>
              </div>
              <button
                type="button"
                onClick={() => setHomeProAnnual((value) => !value)}
                className={`group/toggle flex h-11 w-24 items-center rounded-full bg-black/35 p-1 transition-all duration-700 ${
                  homeProAnnual
                    ? 'border border-emerald-300/40 ring-1 ring-emerald-400/20 hover:border-emerald-200/75 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/55'
                    : 'border border-yellow-300/35 ring-1 ring-yellow-300/15 hover:border-yellow-200/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-200/55'
                }`}
                aria-pressed={homeProAnnual}
              >
                <span className={`h-9 w-9 rounded-full transition-all duration-700 ${
                  homeProAnnual
                    ? 'translate-x-[52px] bg-gradient-to-br from-emerald-100 to-emerald-400 shadow-[0_0_22px_rgba(16,185,129,0.42)]'
                    : 'translate-x-0 bg-gradient-to-br from-yellow-100 to-yellow-400 shadow-[0_0_18px_rgba(250,204,21,0.36)]'
                }`} />
              </button>
            </div>
            <div className="mb-2 flex items-end gap-2">
              <span className="text-6xl font-black tracking-tighter text-white">{homeProAnnual ? '$12' : '$15'}</span>
              <span className="pb-2 text-xs font-sans uppercase tracking-[0.24em] text-zinc-500">/mo</span>
            </div>
            <p className="mb-6 text-xs font-sans uppercase tracking-[0.18em] text-zinc-400">
              {homeProAnnual ? <>Billed annually at <span className="line-through text-zinc-600">$180</span> <span className="text-emerald-300">$144</span></> : 'Cancel anytime, no commitment'}
            </p>
            <div className={`mb-8 inline-flex w-fit rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] transition-colors duration-700 ${
              homeProAnnual
                ? 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                : 'border border-yellow-400/25 bg-yellow-400/10 text-yellow-200'
            }`}>
              {homeProAnnual ? 'Save $36 yearly' : 'Switch to annual to save'}
            </div>
            <div className={`mb-8 h-px w-full transition-colors duration-700 ${homeProAnnual ? 'bg-emerald-500/15' : 'bg-yellow-400/15'}`} />
            <p className={`mb-5 font-sans text-[10px] uppercase tracking-[0.24em] transition-colors duration-700 ${homeProAnnual ? 'text-emerald-400/60' : 'text-yellow-500/60'}`}>
              {homeProAnnual ? 'Everything in monthly Pro, plus' : 'Everything in 2 Scans, plus'}
            </p>
            <ul className="mb-10 flex h-[340px] flex-col gap-4 text-sm font-sans text-zinc-300">
              {homeProAnnual ? (
                <>
                  <li className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-emerald-400" /> Best monthly rate for long-term access</li>
                  <li className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-emerald-400" /> Unlimited analysis (fair usage)</li>
                  <li className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-emerald-400" /> AI potential analysis, protocols, and progress tracking</li>
                  <li className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-emerald-400" /> Full-detail biometric breakdowns and premium dashboard access</li>
                </>
              ) : (
                <>
                  <li className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-yellow-500" /> Unlimited analysis (fair usage)</li>
                  <li className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-yellow-500" /> AI potential analysis - see your projected best self</li>
                  <li className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-yellow-500" /> Full-detail AI facial analysis with 40+ biometric measurements</li>
                  <li className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-yellow-500" /> Customized personal improvement protocols</li>
                  <li className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-yellow-500" /> Celebrity lookalike matching & comparison</li>
                  <li className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-yellow-500" /> Progress tracking dashboard</li>
                  <li className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-yellow-500" /> Exact final rating with detailed ratio breakdown</li>
                </>
              )}
            </ul>
            <button
              type="button"
              onClick={() => setCurrentPage('plans')}
              className={`mt-auto rounded-2xl px-5 py-4 text-xs font-black uppercase tracking-[0.24em] text-black transition-all duration-700 hover:scale-[1.02] ${
                homeProAnnual
                  ? 'bg-gradient-to-r from-emerald-600 to-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.3)]'
                  : 'bg-gradient-to-r from-yellow-500 to-yellow-300 shadow-[0_0_30px_rgba(234,179,8,0.28)]'
              }`}
            >
              {homeProAnnual ? 'Go Yearly' : 'Upgrade To Pro'}
            </button>
            </div>
          </div>
        </FadeUp>

        <FadeUp delay={260}>
          <div className="group flex min-h-[600px] flex-col rounded-[28px] border border-cyan-500/30 bg-[linear-gradient(180deg,rgba(8,20,28,0.74),rgba(9,9,11,0.94))] p-7 shadow-[0_18px_80px_rgba(34,211,238,0.07)] transition-all duration-500 hover:-translate-y-2 hover:border-cyan-300/55 hover:shadow-[0_0_80px_rgba(34,211,238,0.14)]">
            <div className="mb-8">
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.34em] text-cyan-300/70">One-time</p>
              <h3 className="text-4xl font-black italic uppercase tracking-tighter text-white">2 Scans</h3>
            </div>
            <div className="mb-8 flex items-end gap-2">
              <span className="text-6xl font-black tracking-tighter text-white">$8</span>
              <span className="pb-2 text-xs font-sans uppercase tracking-[0.24em] text-zinc-600">Once</span>
            </div>
            <div className="mb-8 h-px w-full bg-cyan-500/20" />
            <p className="mb-5 font-sans text-[10px] uppercase tracking-[0.24em] text-cyan-400/60">Two premium analyses include</p>
            <ul className="mb-10 flex flex-col gap-4 text-sm font-sans text-zinc-300">
              <li className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-cyan-300" /> 2 full-detail AI facial analyses with 40+ measurements</li>
              <li className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-cyan-300" /> Exact final rating with detailed ratio breakdown</li>
              <li className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-cyan-300" /> Customized personal improvement protocols</li>
              <li className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-cyan-300" /> Celebrity lookalike matching & comparison</li>
              <li className="flex gap-3 text-zinc-600"><X size={16} className="mt-0.5 shrink-0 text-zinc-700" /> No AI potential analysis</li>
              <li className="flex gap-3 text-zinc-600"><X size={16} className="mt-0.5 shrink-0 text-zinc-700" /> No ongoing monthly access</li>
              <li className="flex gap-3 text-zinc-600"><X size={16} className="mt-0.5 shrink-0 text-zinc-700" /> No progress tracking</li>
            </ul>
            <button
              type="button"
              onClick={() => setCurrentPage('plans')}
              className="mt-auto rounded-2xl border border-cyan-300/45 bg-cyan-400/10 px-5 py-4 text-xs font-black uppercase tracking-[0.24em] text-cyan-100 shadow-[0_0_26px_rgba(34,211,238,0.14)] transition-all hover:bg-cyan-300 hover:text-black"
            >
              Buy 2 Scans
            </button>
          </div>
        </FadeUp>
      </div>
    </section>

    <section className="w-full border-t border-zinc-900 px-6 py-24">
      <FadeUp>
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-3 text-[10px] font-black uppercase tracking-[0.34em] text-cyan-400/75">Featured Community Scans</p>
              <h2 className="text-4xl md:text-5xl font-black italic uppercase tracking-tighter text-white">See What The Community Is Posting</h2>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400">
                A quick look at three live community scans before you jump into the full gallery.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCurrentPage('celebrity')}
              className="group inline-flex items-center gap-3 self-start rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-6 py-4 text-sm font-black uppercase tracking-[0.22em] text-cyan-300 transition-all hover:-translate-y-1 hover:border-cyan-300/55 hover:bg-cyan-500/18"
            >
              Show More
              <ArrowUpRight size={18} className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </button>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {HOME_FEATURED_COMMUNITY_SCANS.map((scan) => {
              const scoreTone = scan.rating >= 70 ? 'text-lime-300' : scan.rating >= 60 ? 'text-cyan-300' : 'text-orange-400';
              const borderTone = scan.rating >= 70 ? 'border-lime-400/40 hover:border-lime-300/60' : scan.rating >= 60 ? 'border-cyan-400/40 hover:border-cyan-300/60' : 'border-orange-400/40 hover:border-orange-300/60';
              return (
                <button
                  key={scan.id}
                  type="button"
                  onClick={() => setCurrentPage('celebrity')}
                  className={`group relative aspect-[0.76] overflow-hidden rounded-[26px] border bg-zinc-950 text-left shadow-[0_24px_70px_rgba(0,0,0,0.34)] transition-all duration-500 hover:-translate-y-2 ${borderTone}`}
                >
                  <img
                    src={resolveMediaUrl(scan.image)}
                    alt={scan.name}
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/28 to-transparent" />
                  <div className="absolute left-4 top-4 rounded-md border border-zinc-500/50 bg-zinc-800/75 px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-200">
                    {scan.tier}
                  </div>
                  <div className="absolute right-4 top-4 flex items-center gap-2">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-500/40 bg-black/45 text-zinc-100">
                      <span className="text-lg leading-none">...</span>
                    </span>
                    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-cyan-500/45 bg-black/35 text-cyan-300">
                      <Share2 size={15} />
                    </span>
                  </div>
                  <div className="absolute inset-x-0 bottom-0 p-5">
                    <div className={`text-[2.2rem] font-black tracking-tight ${scoreTone}`}>
                      {scan.rating.toFixed(1)}
                      <span className="ml-1 text-sm text-zinc-300">/100</span>
                    </div>
                    <p className="mt-1 text-[10px] font-sans uppercase tracking-[0.28em] text-zinc-400">
                      {scan.footer}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
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
    'auth/user-disabled': 'This account has been disabled.',
    'auth/operation-not-allowed': 'This login method is not enabled.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.',
    'auth/unauthorized-domain': 'Login is not enabled for this domain in Firebase.',
    'auth/popup-blocked': 'Your browser blocked the Google sign-in popup.',
    'auth/popup-closed-by-user': 'Google sign-in was closed before it finished.',
    'auth/cancelled-popup-request': 'Another Google sign-in popup is already open.',
  }[code] || `Login failed${code ? ` (${code})` : ''}. Please try again.`);

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await setAuthPersistenceSafely(rememberMe);
      await signInWithEmailAndPassword(auth, email, password);
      setCurrentPage('photo-guide');
    } catch (err) { console.error('Email login failed', err); setError(friendlyError(err.code)); } finally { setLoading(false); }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try { const result = await signInWithGoogleProvider(); if (result) setCurrentPage('photo-guide'); } catch (e) { console.error('Google login failed', e); setError(friendlyError(e.code)); } finally { setLoading(false); }
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
    'auth/network-request-failed': 'Network error. Check your connection and try again.',
    'auth/unauthorized-domain': 'Login is not enabled for this domain in Firebase.',
    'auth/popup-blocked': 'Your browser blocked the Google sign-in popup.',
    'auth/popup-closed-by-user': 'Google sign-in was closed before it finished.',
    'auth/cancelled-popup-request': 'Another Google sign-in popup is already open.',
  }[code] || `Registration failed${code ? ` (${code})` : ''}. Please try again.`);

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      setCurrentPage('photo-guide');
    } catch (err) { console.error('Registration failed', err); setError(friendlyError(err.code)); } finally { setLoading(false); }
  };

  const handleGoogleRegister = async () => {
    setError('');
    setLoading(true);
    try { const result = await signInWithGoogleProvider(); if (result) setCurrentPage('photo-guide'); } catch (e) { console.error('Google registration failed', e); setError(friendlyError(e.code)); } finally { setLoading(false); }
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
    <div className="flex-grow flex flex-col items-center pt-24 pb-16 px-4 md:px-6 relative font-sans overflow-hidden">
      <FadeUp>
        <div className="w-full max-w-3xl bg-[#0c0d0e]/80 border border-zinc-800 rounded-2xl p-5 md:p-8 shadow-2xl backdrop-blur-xl relative z-10 mx-auto">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 via-yellow-500 to-green-500" />
          
          <div className="flex flex-col items-center gap-3 mb-5">
            <MogCheckLogoMark size={48} className="w-12 h-12 opacity-90" />
            <h2 className="text-3xl md:text-4xl font-black italic uppercase tracking-tighter text-white text-center">Take the Perfect Photo</h2>
          </div>
          
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 p-4 rounded-xl mb-8 shadow-[0_0_20px_rgba(239,68,68,0.1)]">
            <span className="text-red-500 font-bold uppercase tracking-widest text-sm md:text-base mt-0.5 animate-pulse">Warning:</span>
            <p className="text-zinc-300 text-xs md:text-sm uppercase tracking-wider leading-relaxed">
              A bad photo can massively skew your stats and render the analysis completely inaccurate. Follow these instructions carefully.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-7 mb-8">
            <div className="flex flex-col">
              <h3 className="text-green-500 font-black italic uppercase text-2xl tracking-tighter mb-4 drop-shadow-[0_0_10px_rgba(34,197,94,0.5)]">DO:</h3>
              <ul className="space-y-4 text-zinc-300 text-sm tracking-wider leading-relaxed mb-5 flex-grow">
                <li><span className="text-white font-bold">1.</span> Place your phone roughly 6 feet (2 meters) away from you.</li>
                <li><span className="text-white font-bold">2.</span> Set your camera to 2x or 3x zoom and step back until your head fits the frame.</li>
                <li><span className="text-white font-bold">3.</span> Ensure the camera is exactly at eye level - not tilted up or down.</li>
                <li><span className="text-white font-bold">4.</span> Keep your forehead and hairline visible.</li>
              </ul>
              <img src="/guide/do-example.png" alt="Do example" className="w-full max-h-[240px] object-cover rounded-xl border border-green-500/30 shadow-[0_0_20px_rgba(34,197,94,0.1)] grayscale opacity-80" />
            </div>

            <div className="flex flex-col">
              <h3 className="text-red-500 font-black italic uppercase text-2xl tracking-tighter mb-4 drop-shadow-[0_0_10px_rgba(239,68,68,0.5)]">DO NOT:</h3>
              <ul className="space-y-4 text-zinc-300 text-sm tracking-wider leading-relaxed mb-5 flex-grow">
                <li><span className="text-white font-bold">1.</span> Do not take a close-up selfie by holding the phone at arm's length.</li>
                <li><span className="text-white font-bold">2.</span> Do not take a photo in dark lighting.</li>
                <li><span className="text-white font-bold">3.</span> Do not cover your forehead or hairline with hair, hats, hoods, or cropping.</li>
              </ul>
              <img src="/guide/do-not-example.png" alt="Do not example" className="w-full max-h-[240px] object-cover rounded-xl border border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.1)] grayscale opacity-80" />
            </div>
          </div>
          
          <button onClick={() => setCurrentPage('upload-photo')} className="w-full py-4 bg-white text-black font-black uppercase tracking-widest text-sm md:text-base flex items-center justify-center gap-4 hover:scale-[1.02] hover:bg-zinc-200 transition-all cursor-pointer shadow-[0_0_30px_rgba(255,255,255,0.2)] rounded-sm">
            I understand, let's go
            <ChevronRight size={20} className="text-black" />
          </button>
        </div>
      </FadeUp>
    </div>
  );
};

const extractMetricRawValue = (label = '') => {
  const matches = [...String(label || '').matchAll(/\(([-+]?\d+(?:\.\d+)?)\s*(?:°|deg)?\)/gi)];
  if (!matches.length) return null;
  const value = Number(matches[matches.length - 1][1]);
  return Number.isFinite(value) ? value : null;
};

const getMetricAnimationAxis = (label = '') => {
  const low = String(label || '').toLowerCase();
  const fallback = { left: 'Low', center: 'Ideal', right: 'High', ideal: [72, 92], domain: [0, 100], useScore: true };
  const configs = [
    { test: /bigonial|jaw.*width|mandibular/, left: 'Too narrow', center: 'Ideal', right: 'Too wide', ideal: [0.95, 1.05], domain: [0.75, 1.2] },
    { test: /\bipd|interpupillary/, left: 'Too close', center: 'Ideal', right: 'Too wide', ideal: [0.44, 0.48], domain: [0.36, 0.56] },
    { test: /mouth.*width/, left: 'Too narrow', center: 'Ideal', right: 'Too wide', ideal: [0.38, 0.44], domain: [0.28, 0.54] },
    { test: /nose.*width|nasal.*base/, left: 'Too narrow', center: 'Ideal', right: 'Too wide', ideal: [0.20, 0.25], domain: [0.15, 0.34] },
    { test: /upper.*third/, left: 'Too short', center: 'Ideal', right: 'Too tall', ideal: [0.32, 0.39], domain: [0.24, 0.5] },
    { test: /middle.*third/, left: 'Too short', center: 'Ideal', right: 'Too tall', ideal: [0.40, 0.46], domain: [0.30, 0.58] },
    { test: /lower.*third/, left: 'Too short', center: 'Ideal', right: 'Too tall', ideal: [0.39, 0.47], domain: [0.30, 0.60] },
    { test: /eye.*height/, left: 'Too small', center: 'Ideal', right: 'Too tall', ideal: [0.06, 0.09], domain: [0.035, 0.13] },
    { test: /brow.*compact/, left: 'Too compact', center: 'Ideal', right: 'Too tall', ideal: [0.08, 0.11], domain: [0.04, 0.16] },
    { test: /philtrum/, left: 'Too short', center: 'Ideal', right: 'Too tall', ideal: [0.09, 0.12], domain: [0.055, 0.17] },
    { test: /lip.*height|total.*lip/, left: 'Too thin', center: 'Ideal', right: 'Too full', ideal: [0.11, 0.16], domain: [0.06, 0.24] },
    { test: /fwhr|facial.*width.*height/, left: 'Too narrow', center: 'Ideal', right: 'Too wide', ideal: [1.75, 2.05], domain: [1.40, 2.40] },
    { test: /midface/, left: 'Too short', center: 'Ideal', right: 'Too long', ideal: [0.95, 1.05], domain: [0.75, 1.28] },
    { test: /canthal|tilt/, left: 'Negative tilt', center: 'Ideal', right: 'Too steep', ideal: [4, 10], domain: [-6, 20] },
    { test: /maxillary|cheekbone|projection|chin/, left: 'Too recessed', center: 'Ideal', right: 'Too projected', ideal: [72, 92], domain: [0, 100], useScore: true },
    { test: /nasolabial|angle|gonial|plane|convexity/, left: 'Too low', center: 'Ideal', right: 'Too high', ideal: [72, 92], domain: [0, 100], useScore: true },
  ];
  return configs.find((config) => config.test.test(low)) || fallback;
};

const metricAnimationPosition = (metric = {}) => {
  const axis = getMetricAnimationAxis(metric.label);
  const rawValue = extractMetricRawValue(metric.label);
  const score = Number(metric.score);
  const value = axis.useScore || rawValue == null ? score : rawValue;
  const [min, max] = axis.domain;
  const position = Number.isFinite(value) && max > min
    ? Math.max(4, Math.min(96, ((value - min) / (max - min)) * 100))
    : 50;
  const [idealMin, idealMax] = axis.ideal;
  const status = Number.isFinite(value)
    ? value < idealMin ? axis.left : value > idealMax ? axis.right : axis.center
    : axis.center;
  return {
    ...axis,
    rawValue,
    score: Number.isFinite(score) ? score : null,
    value: Number.isFinite(value) ? value : null,
    position,
    status,
    severity: status === axis.center ? 'Ideal' : (Number.isFinite(score) && score >= 68 ? 'Slight Flaw' : 'Primary Flaw'),
  };
};

const ScanAnimationsPage = ({ routeParams, setCurrentPage }) => {
  const [payload, setPayload] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    try {
      const store = JSON.parse(window.sessionStorage.getItem(ANIMATION_LINK_STORAGE_KEY) || '{}');
      setPayload(store?.[routeParams?.animationId] || null);
    } catch {
      setPayload(null);
    }
  }, [routeParams?.animationId]);

  const steps = useMemo(() => {
    if (!payload) return [];
    const metrics = (Array.isArray(payload.metrics) ? payload.metrics : [])
      .filter((metric) => metric?.label)
      .map((metric) => ({ type: 'metric', metric }));
    const best = (Array.isArray(payload.bestFeatures) ? payload.bestFeatures : [])
      .slice(0, 5)
      .map((feature, index) => ({ type: 'best', feature, index }));
    const flaws = (Array.isArray(payload.primaryFlaws) ? payload.primaryFlaws : [])
      .slice(0, 5)
      .map((feature, index) => ({ type: 'flaw', feature, index }));
    return [...metrics, ...best, ...flaws];
  }, [payload]);

  useEffect(() => {
    if (!steps.length) return undefined;
    const interval = setInterval(() => {
      setStepIndex((current) => (current + 1) % steps.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [steps.length]);

  useEffect(() => {
    if (stepIndex >= steps.length) setStepIndex(0);
  }, [stepIndex, steps.length]);

  if (!payload) {
    return (
      <div className="min-h-screen px-6 pt-28">
        <div className="mx-auto max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-950/70 p-8 text-center">
          <h1 className="text-2xl font-black uppercase tracking-[0.24em] text-white">Animation link expired</h1>
          <p className="mt-4 text-sm text-zinc-400">Open it again from the scan dashboard on this browser.</p>
          <button type="button" onClick={() => setCurrentPage('dashboard')} className="mt-6 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-5 py-2 text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-200">
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!steps.length) {
    return (
      <div className="min-h-screen px-6 pt-28">
        <div className="mx-auto max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-950/70 p-8 text-center">
          <h1 className="text-2xl font-black uppercase tracking-[0.24em] text-white">No animation data</h1>
          <p className="mt-4 text-sm text-zinc-400">This scan does not have ratios, best features, or flaws to animate yet.</p>
          <button type="button" onClick={() => setCurrentPage('dashboard')} className="mt-6 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-5 py-2 text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-200">
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  const currentStep = steps[stepIndex] || null;
  const isMetricStep = currentStep?.type === 'metric';
  const metricAxis = isMetricStep ? metricAnimationPosition(currentStep.metric) : null;
  const feature = currentStep?.feature || null;
  const imageLabel = payload.profileView === 'side' ? 'Side profile' : 'Front profile';
  const metricTitle = isMetricStep
    ? String(currentStep.metric?.label || 'Measurement').replace(/\s*\([^)]*\)\s*/g, '').trim()
    : '';
  const scrubberPercent = steps.length > 1 ? (stepIndex / (steps.length - 1)) * 100 : 100;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#020405] p-4 text-zinc-100">
      <style>{`
        @keyframes metricPointerWave {
          0% { left: 50%; transform: translateX(-50%) translateY(0) scale(1); }
          25% { left: 47.5%; transform: translateX(-50%) translateY(-0.35px) scale(1.002); }
          50% { left: 52.5%; transform: translateX(-50%) translateY(0.35px) scale(1); }
          75% { left: 49%; transform: translateX(-50%) translateY(-0.2px) scale(1.001); }
          100% { left: var(--target); transform: translateX(-50%) translateY(0) scale(1); }
        }
        @keyframes featureCardIn {
          0% { opacity: 0; transform: translateY(10px) scale(0.98); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .animation-scrubber {
          appearance: none;
          -webkit-appearance: none;
          height: 4px;
          border-radius: 999px;
          cursor: pointer;
        }
        .animation-scrubber::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 999px;
          background: #22d3ee;
          border: 2px solid rgba(255,255,255,0.92);
          box-shadow: 0 0 16px rgba(34,211,238,0.85);
          cursor: grab;
        }
        .animation-scrubber:active::-webkit-slider-thumb {
          cursor: grabbing;
          transform: scale(1.08);
        }
        .animation-scrubber::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 999px;
          background: #22d3ee;
          border: 2px solid rgba(255,255,255,0.92);
          box-shadow: 0 0 16px rgba(34,211,238,0.85);
          cursor: grab;
        }
      `}</style>
      <div className="flex w-full max-w-[480px] flex-col gap-3">
        <button
          type="button"
          onClick={() => setCurrentPage('dashboard')}
          className="inline-flex w-fit items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100 shadow-[0_0_22px_rgba(34,211,238,0.14)] transition-all hover:border-cyan-200/70 hover:bg-cyan-400/20 hover:text-white"
        >
          <ChevronLeft size={13} /> Back
        </button>
      <div className="flex w-full max-w-[480px] flex-col overflow-hidden border border-cyan-500/15 bg-[#050708] shadow-[0_24px_80px_rgba(0,0,0,0.75),0_0_34px_rgba(34,211,238,0.08)]">
        <div className="border-b border-cyan-500/15 bg-[#080b0d] px-3 py-3">
          <div className="mb-2 flex items-center justify-end gap-3">
            <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100">
              {imageLabel}
            </span>
          </div>

          {isMetricStep ? (
            <div key={`metric-${stepIndex}`} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-300/70">Measurement</div>
                  <h1 className="text-lg font-black tracking-tight text-white">{metricTitle}</h1>
                </div>
                <span className={`rounded-full px-3 py-1 text-[11px] font-black ${
                  metricAxis.status === metricAxis.center ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {metricAxis.severity}
                </span>
              </div>
              <div className="relative pt-5">
                <div className="absolute top-0 flex flex-col items-center" style={{ '--target': `${metricAxis.position}%`, animation: 'metricPointerWave 1.8s cubic-bezier(0.65, 0, 0.35, 1) forwards' }}>
                  <div className="rounded-full border border-cyan-400/25 bg-zinc-950 px-2 py-0.5 text-xs font-black text-white shadow-[0_0_16px_rgba(34,211,238,0.35)]">
                    {metricAxis.rawValue != null ? metricAxis.rawValue : metricAxis.score ?? '-'}
                  </div>
                  <div className="-mt-px h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-zinc-950" />
                </div>
                <div className="h-2 rounded-full bg-[linear-gradient(90deg,#f43f5e_0%,#fb923c_22%,#34d399_50%,#fb923c_78%,#f43f5e_100%)]" />
                <div className="mt-2 flex justify-between text-[11px] font-medium text-zinc-300">
                  <span>{metricAxis.left}</span>
                  <span className="font-black text-emerald-400">{metricAxis.center}</span>
                  <span>{metricAxis.right}</span>
                </div>
                <div className="mt-1 text-[11px] text-zinc-300">
                  Ideal: <span className="font-black text-emerald-400">{metricAxis.ideal[0]} - {metricAxis.ideal[1]}</span>
                </div>
              </div>
            </div>
          ) : (
            <div key={`feature-${stepIndex}`} className="space-y-2" style={{ animation: 'featureCardIn 0.45s ease both' }}>
              <div className="flex items-center justify-between">
                <h1 className={`text-base font-black uppercase tracking-[0.12em] ${currentStep?.type === 'best' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {currentStep?.type === 'best' ? `Best feature ${currentStep.index + 1}` : `Primary flaw ${currentStep.index + 1}`}
                </h1>
                <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${currentStep?.type === 'best' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                  {currentStep?.type === 'best' ? 'Positive' : 'Fix point'}
                </span>
              </div>
              <h2 className="text-xl font-black tracking-tight text-white">{feature?.title || 'Feature'}</h2>
              <p className="text-sm leading-relaxed text-zinc-300">{feature?.description || 'No description available.'}</p>
            </div>
          )}
        </div>

        <div className="relative overflow-hidden bg-[#050708]">
          <img src={payload.imageUrl} alt={imageLabel} className="block w-full max-h-[calc(100vh-214px)] object-cover object-top" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-4">
            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.2em] text-white/80">
              <span>{stepIndex + 1}/{Math.max(steps.length, 1)}</span>
              <span>{isMetricStep ? metricTitle : currentStep?.type === 'best' ? 'Best feature' : 'Primary flaw'}</span>
            </div>
            <input
              type="range"
              min="0"
              max={Math.max(steps.length - 1, 0)}
              step="1"
              value={stepIndex}
              onChange={(event) => setStepIndex(Number(event.target.value))}
              className="animation-scrubber mt-3 block w-full"
              aria-label="Animation timeline"
              style={{
                background: `linear-gradient(90deg, #22d3ee 0%, #22d3ee ${scrubberPercent}%, rgba(255,255,255,0.24) ${scrubberPercent}%, rgba(255,255,255,0.24) 100%)`,
              }}
            />
          </div>
        </div>

        <div className="flex gap-2 border-t border-cyan-500/20 bg-[#050708] p-3">
          <button type="button" onClick={() => setStepIndex((current) => (current - 1 + steps.length) % steps.length)} className="flex-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.08)] transition-all hover:border-cyan-300/60 hover:bg-cyan-500/15 hover:text-white">
            Previous
          </button>
          <button type="button" onClick={() => setStepIndex((current) => (current + 1) % steps.length)} className="flex-1 rounded-full border border-cyan-400/50 bg-cyan-400/15 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100 shadow-[0_0_22px_rgba(34,211,238,0.18)] transition-all hover:border-cyan-200/80 hover:bg-cyan-400/25 hover:text-white">
            Next
          </button>
        </div>
      </div>
      </div>
    </div>
  );
};

// --- Upload Photo Page ---
const FileDropzone = ({ label, file, setFile, isPulsing, locked = false, lockedLabel = 'Locked preview' }) => {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div className="flex flex-col items-center w-full">
      <span className="text-zinc-300 font-bold text-lg md:text-xl uppercase tracking-widest mb-6 drop-shadow-md">{label}</span>
      <label 
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!locked) setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (!locked) setIsDragging(false); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (locked) return;
          setIsDragging(false);
          if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const f = e.dataTransfer.files[0];
            setFile(URL.createObjectURL(f), f);
          }
        }}
        className={`w-full aspect-[3/4] max-w-sm mx-auto rounded-3xl border transition-all duration-300 flex flex-col items-center justify-center cursor-pointer relative overflow-hidden group ${
          locked
            ? 'border-cyan-400/35 bg-cyan-500/10 shadow-[0_0_42px_rgba(34,211,238,0.14)] cursor-default'
            :
          isDragging 
            ? 'border-white bg-white/10 shadow-[0_0_50px_rgba(255,255,255,0.3)] scale-[1.02]' 
            : (isPulsing && !file ? 'border-zinc-500 bg-zinc-900/40 shadow-[0_0_30px_rgba(255,255,255,0.1)] animate-pulse hover:border-zinc-400' : 'border-zinc-800 bg-zinc-900/30 backdrop-blur-md hover:border-zinc-600 hover:bg-zinc-900/50 shadow-2xl')
        }`}
      >
        <input type="file" className="hidden" accept="image/*" disabled={locked} onChange={(e) => { const f = e.target.files?.[0]; if (f && !locked) setFile(URL.createObjectURL(f), f); }} />
        {file ? (
          <>
            <img src={file} alt={label} className="absolute inset-0 w-full h-full object-cover opacity-90 group-hover:opacity-40 transition-opacity duration-300" />
            {!locked && (
              <div 
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFile(null, null); }}
                className="absolute top-4 right-4 md:top-6 md:right-6 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20 bg-black/60 hover:bg-red-500/80 text-white rounded-full p-2 backdrop-blur-md border border-white/10 hover:border-red-500/50"
                title="Remove Image"
              >
                <X size={20} />
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10 pointer-events-none">
              <span className="font-sans text-sm md:text-base uppercase tracking-widest text-white font-bold bg-black/50 px-4 py-2 rounded-lg backdrop-blur-sm border border-white/10">
                {locked ? lockedLabel : 'Replace Image'}
              </span>
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
const AnalysisScanBand = () => (
  <div
    className="pointer-events-none absolute inset-x-0 top-0 z-[12] h-[28%] overflow-hidden mix-blend-screen will-change-transform"
    style={{ animation: 'analysisScanBand 4.8s ease-in-out infinite alternate' }}
    aria-hidden
  >
    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-300/18 to-transparent" />
    <div className="absolute left-0 right-0 top-1/2 h-px bg-gradient-to-r from-transparent via-cyan-200/90 to-transparent shadow-[0_0_18px_rgba(34,211,238,0.85)]" />
  </div>
);

const FaceScanOverlay = ({
  landmarksData,
  meshConnections = null,
  revealDurationSeconds = 36,
  scanLoopSeconds = 4,
  freezeAfterReveal = true,
}) => {
  const compactMotion = false;
  let mappedPoints = [];
  let mappedEdges = [];

  if (landmarksData && landmarksData !== 'fallback' && meshConnections?.length) {
    const { points, imgW, imgH } = landmarksData;
    
    // Instead of simple contours, generate the fully detailed face tessellation matrix
    const uniquePoints = new Set();
    const connections = [];

    if (meshConnections?.length) {
      meshConnections.forEach(conn => {
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

  if (compactMotion) {
    const visiblePointIds = new Set(
      mappedPoints.filter((_, index) => index % 2 === 0).map((point) => point.id)
    );
    mappedPoints = mappedPoints.filter((_, index) => index % 2 === 0);
    mappedEdges = mappedEdges.filter(
      ([start, end], index) =>
        index % 2 === 0 &&
        visiblePointIds.has(start?.id) &&
        visiblePointIds.has(end?.id)
    );
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
  const buildWindowSeconds = Math.min(revealWindowSeconds, compactMotion ? 8 : 14);
  const dashWindowSeconds = Math.max(compactMotion ? 3.6 : 4.8, buildWindowSeconds - (compactMotion ? 0.9 : 1.4));
  const scanSeconds = Math.max(compactMotion ? 2.2 : 2.8, Number(scanLoopSeconds) || 4);

  return (
    <div className="absolute inset-0 z-20 overflow-hidden" style={{ perspective: '1000px' }}>
      <svg viewBox="0 0 100 133.33" className={`w-full h-full ${compactMotion ? '' : 'drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]'}`} preserveAspectRatio="xMidYMid slice">
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
              style={{
                animation: freezeAfterReveal
                  ? `dash 0.82s cubic-bezier(0.22, 1, 0.36, 1) forwards ${delay}s`
                  : compactMotion
                    ? `dash 0.58s cubic-bezier(0.22, 1, 0.36, 1) forwards ${delay}s`
                    : `dash 0.82s cubic-bezier(0.22, 1, 0.36, 1) forwards ${delay}s, meshPulse 3.1s ease-in-out infinite ${delay + 0.82}s`,
              }}
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
              style={{
                animation: freezeAfterReveal
                  ? `fadeIn 0.28s ease-out forwards ${delay}s`
                  : compactMotion
                    ? `fadeIn 0.18s ease-out forwards ${delay}s`
                    : `fadeIn 0.28s ease-out forwards ${delay}s, pointPulse 2.8s ease-in-out infinite ${delay + 0.28}s`,
              }}
            />
          );
        })}
        {/* Scanning crosshairs */}
        <path d="M 0 15 L 5 15 M 0 118 L 5 118 M 95 15 L 100 15 M 95 118 L 100 118" stroke="rgba(34, 211, 238, 0.8)" strokeWidth="0.5" />
      </svg>
      {/* Scanner laser lines */}
      {!freezeAfterReveal && (
        <>
          <div className={`absolute top-0 left-0 w-full ${compactMotion ? 'h-[1px]' : 'h-[2px]'} bg-gradient-to-r from-transparent via-[#22d3ee] to-transparent ${compactMotion ? '' : 'shadow-[0_0_15px_rgba(34,211,238,1)]'}`} style={{ animation: `scan ${scanSeconds}s linear infinite` }} />
          <div className={`absolute top-0 left-0 w-full ${compactMotion ? 'h-20' : 'h-32'} bg-gradient-to-b from-[#22d3ee]/20 to-transparent`} style={{ animation: `scan ${scanSeconds}s linear infinite` }} />
        </>
      )}
    </div>
  );
};

/** mainImageSrc: front preview URL; mainImageFile: native File for reliable FormData uploads */
const SCAN_PROGRESS_MESSAGES = [
  'Mapping facial landmarks',
  'Checking structural balance',
  'Finding weak points',
  'Reading soft tissue',
  'Comparing front and side cues',
  'Writing the analysis',
];

const getEstimatedScanTotalMs = (choice, fairUsageState) => {
  if (fairUsageState?.lowPriority) return 5 * 60 * 1000;
  if (choice === '6' || choice === '7' || choice === '8' || choice === '9') return 55 * 1000;
  if (choice === '1') return 3.5 * 60 * 1000;
  if (choice === '2') return 2.5 * 60 * 1000;
  return 90 * 1000;
};

const SCAN_DURATION_HISTORY_KEY = 'mogcheck.scanDurationHistory.v1';
const ANIMATION_LINK_STORAGE_KEY = 'mogcheck.animationLinks.v1';

const getScanDurationHistory = () => {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(SCAN_DURATION_HISTORY_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

const scanDurationHistoryKey = (choice, fairUsageState) =>
  `${choice || '3'}:${fairUsageState?.lowPriority ? 'low' : 'normal'}`;

const getAdaptiveScanTotalMs = (choice, fairUsageState) => {
  const fallback = getEstimatedScanTotalMs(choice, fairUsageState);
  const entry = getScanDurationHistory()[scanDurationHistoryKey(choice, fairUsageState)];
  const averageMs = Number(entry?.averageMs);
  if (!Number.isFinite(averageMs) || averageMs <= 0) return fallback;
  return Math.min(fallback * 1.6, Math.max(fallback * 0.55, averageMs * 1.08));
};

const rememberScanDuration = (choice, fairUsageState, durationMs) => {
  if (typeof window === 'undefined' || !Number.isFinite(durationMs) || durationMs <= 0) return;
  try {
    const history = getScanDurationHistory();
    const key = scanDurationHistoryKey(choice, fairUsageState);
    const previous = Number(history[key]?.averageMs);
    history[key] = {
      averageMs: Number.isFinite(previous) && previous > 0
        ? previous * 0.65 + durationMs * 0.35
        : durationMs,
      samples: Math.min(20, Number(history[key]?.samples || 0) + 1),
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(SCAN_DURATION_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Local storage is best-effort only.
  }
};

const formatTimeLeft = (ms) => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const formatElapsedMinutes = (ms) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}.${String(Math.floor(seconds / 6)).padStart(1, '0')}m elapsed`;
};

const isTransientMobileScanError = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    error?.name === 'TypeError' &&
    (
      message.includes('load failed') ||
      message.includes('failed to fetch') ||
      message.includes('networkerror') ||
      message.includes('network request failed')
    )
  );
};

const buildRecoveredScanPayload = (scan = {}) => {
  const payload = scan && typeof scan.payload === 'object' && scan.payload ? scan.payload : {};
  return normalizeDashboardMedia({
    ...payload,
    scanId: payload.scanId || scan.scanId || scan.id || null,
    scanRequestId: payload.scanRequestId || scan.scanRequestId || null,
    profileId: payload.profileId || scan.profileId || 'default',
    selectedModel: String(payload.selectedModel || scan.selectedModel || scan.model || '').trim() || '3',
    frontImage: scan.frontImageUrl || scan.frontImage || payload.frontImage || null,
    sideImage: scan.sideImageUrl || scan.sideImage || payload.sideImage || null,
    debugAnchorsImage: scan.debugAnchorsImageUrl || scan.debugAnchorsImage || payload.debugAnchorsImage || payload.debugAnchorsImageUrl || null,
    debugAnchorsImageUrl: scan.debugAnchorsImageUrl || payload.debugAnchorsImageUrl || payload.debugAnchorsImage || null,
    debugRatiosImage: scan.debugRatiosImageUrl || scan.debugRatiosImage || payload.debugRatiosImage || payload.debugRatiosImageUrl || null,
    debugRatiosImageUrl: scan.debugRatiosImageUrl || payload.debugRatiosImageUrl || payload.debugRatiosImage || null,
    uncannyFlag: payload.uncannyFlag || scan.uncannyFlag || null,
    scannedAt: scan.scannedAt || scan.createdAt || payload.scannedAt || null,
    success: true,
  });
};

const ScanningView = ({
  mainImageSrc,
  mainImageFile,
  sideImageUrl,
  sideImageFile,
  sideMetricData,
  choice,
  scanRequestId: suppliedScanRequestId,
  onComplete,
  onScanFailed,
  user,
  profileId,
  compact = false,
  analysisLabel = 'Analysis',
  onDismiss,
  onOpen,
  onStatusChange,
  runnerOnly = false,
  startedAtMs = null,
  demoPayload = null,
}) => {
  const [statusText, setStatusText] = useState('Connecting to Backend Bridge...');
  const [elapsedScanMs, setElapsedScanMs] = useState(0);
  const [videoUrl, setVideoUrl] = useState(null);
  const [landmarks, setLandmarks] = useState(null);
  const [meshConnections, setMeshConnections] = useState(null);
  const [hasError, setHasError] = useState(false);
  const [fairUsageState, setFairUsageState] = useState(null);
  const isUltra31 = choice === "1";
  const isGemini31Pro = choice === "6" || choice === "7" || choice === "8" || choice === "9";
  const isCompactViewport = typeof window !== 'undefined' && window.innerWidth < 768;
  const overlayRevealSeconds = isUltra31 ? 34 : isGemini31Pro ? 18 : choice === "2" ? 24 : 36;
  const overlayScanLoopSeconds = isUltra31 ? 4 : isGemini31Pro ? 3.5 : choice === "2" ? 4.5 : 4;
  const lowPriorityBadge = fairUsageState?.lowPriority
    ? (fairUsageState.badgeText || 'High usage detected, you have been placed on low-priority queue.')
    : '';
  const fallbackScanRequestIdRef = useRef('');
  if (!fallbackScanRequestIdRef.current) {
    fallbackScanRequestIdRef.current = createClientRequestId('scan');
  }
  const scanRequestId = String(suppliedScanRequestId || fallbackScanRequestIdRef.current).trim();
  const getQuotaAwareScanMessage = useCallback((rawMessage, fallbackMessage = '') => {
    const source = `${rawMessage || ''} ${fallbackMessage || ''}`.trim();
    if (/RESOURCE_EXHAUSTED|quota exceeded|firestore quota/i.test(source)) {
      return 'Firebase quota exceeded right now. The AI scan may still run, but saving or loading the scan into your dashboard can temporarily fail until quota resets.';
    }
    return rawMessage || fallbackMessage;
  }, []);

  /** Parent passes an inline onComplete; keep a ref so the analyze effect does not re-run every render (duplicate requests). */
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onScanFailedRef = useRef(onScanFailed);
  onScanFailedRef.current = onScanFailed;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    onStatusChangeRef.current?.({
      statusText,
      hasError,
      videoUrl,
      landmarks,
      meshConnections,
      fairUsageState,
      overlayRevealSeconds,
      overlayScanLoopSeconds,
      elapsedScanMs,
      scanRequestId,
    });
  }, [elapsedScanMs, fairUsageState, hasError, landmarks, meshConnections, overlayRevealSeconds, overlayScanLoopSeconds, scanRequestId, statusText, videoUrl]);

  useEffect(() => {
    let active = true;
    let cancelAnalyzeRequest = () => {};

    const initDetector = async () => {
      try {
        const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
        if (!active) return;
        setMeshConnections(FaceLandmarker.FACE_LANDMARKS_TESSELATION || null);
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
      const providedStartedAt = Number(startedAtMs);
      const scanStartedAt = Number.isFinite(providedStartedAt) && providedStartedAt > 0 ? providedStartedAt : Date.now();
      setElapsedScanMs(Math.max(0, Date.now() - scanStartedAt));
      let scanSucceeded = false;
      let currentFairUsage = null;
      let authToken = null;
      let activeUser = null;

      const fetchWithTimeoutRetry = async (url, options = {}, attempt = 1) => {
        const { timeoutMs = 8000, ...fetchOptions } = options;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          return await fetch(url, {
            cache: 'no-store',
            ...fetchOptions,
            signal: ctrl.signal,
          });
        } catch (networkErr) {
          if (attempt >= 2) throw networkErr;
          await new Promise((resolve) => setTimeout(resolve, 900));
          return fetchWithTimeoutRetry(url, options, attempt + 1);
        } finally {
          clearTimeout(timer);
        }
      };

      const pollForSavedScan = async () => {
        if (!activeUser || !scanRequestId) return null;
        const expectedProfileId = profileId || 'default';
        let token = authToken;
        if (!token) {
          try {
            token = await activeUser.getIdToken();
          } catch {
            return null;
          }
        }

        const startedAt = Date.now();
        const maxWaitMs = 18 * 60 * 1000;
        while (active && Date.now() - startedAt < maxWaitMs) {
          const elapsedMs = Date.now() - scanStartedAt;
          setElapsedScanMs(elapsedMs);
          const expectedMs = getAdaptiveScanTotalMs(choice, currentFairUsage);
          setStatusText(
            elapsedMs > expectedMs
              ? 'Taking longer than usual. The scan is still running and we are waiting for the result...'
              : 'Still analyzing. Reconnecting to the scan result...'
          );
          try {
            const statusRes = await fetchWithTimeoutRetry(`${API_BASE}/api/analyze/status/${encodeURIComponent(scanRequestId)}`, {
              timeoutMs: 12000,
              headers: { Authorization: `Bearer ${token}` },
            });
            if (statusRes.ok) {
              const statusData = await statusRes.json().catch(() => ({}));
              if (statusData.state === 'completed') {
                if (statusData.payload?.success) return statusData.payload;
                if (statusData.scan) return buildRecoveredScanPayload(statusData.scan);
              }
              if (statusData.state === 'failed') {
                throw new Error(statusData.error || 'Analysis failed. Please try again with a clear frontal image.');
              }
            }

            const scansRes = await fetchWithTimeoutRetry(`${API_BASE}/api/user/scans`, {
              timeoutMs: 12000,
              headers: { Authorization: `Bearer ${token}` },
            });
            if (scansRes.ok) {
              const scansData = await scansRes.json().catch(() => ({}));
              const scans = Array.isArray(scansData.scans) ? scansData.scans : [];
              const requestMatches = scans.filter((scan) => {
                const payload = scan && typeof scan.payload === 'object' && scan.payload ? scan.payload : {};
                const recoveredRequestId = String(scan.scanRequestId || payload.scanRequestId || '').trim();
                return recoveredRequestId === scanRequestId;
              });
              const recovered = requestMatches.find((scan) => {
                const payload = scan && typeof scan.payload === 'object' && scan.payload ? scan.payload : {};
                return String(scan.profileId || payload.profileId || 'default').trim() === expectedProfileId;
              }) || (requestMatches.length === 1 ? requestMatches[0] : null);
              if (recovered) return buildRecoveredScanPayload(recovered);
            }
          } catch (pollErr) {
            if (pollErr?.message && !isTransientMobileScanError(pollErr) && pollErr.name !== 'AbortError') {
              throw pollErr;
            }
            console.warn('Saved scan recovery poll failed', pollErr);
          }
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
        return null;
      };

      const recoverCompletedScanOnce = async () => {
        if (!activeUser || !scanRequestId) return null;
        let token = authToken;
        if (!token) {
          try {
            token = await activeUser.getIdToken();
          } catch {
            return null;
          }
        }

        const statusRes = await fetchWithTimeoutRetry(`${API_BASE}/api/analyze/status/${encodeURIComponent(scanRequestId)}`, {
          timeoutMs: 12000,
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!statusRes.ok) return null;
        const statusData = await statusRes.json().catch(() => ({}));
        if (statusData.state === 'completed') {
          if (statusData.payload?.success) return statusData.payload;
          if (statusData.scan) return buildRecoveredScanPayload(statusData.scan);
        }
        if (statusData.state === 'failed') {
          throw new Error(statusData.error || 'Analysis failed. Please try again with a clear frontal image.');
        }
        return null;
      };

      try {
        if (demoPayload?.isPremiumDemo || choice === PREMIUM_DEMO_MODEL_ID) {
          const demoSteps = [
            'Loading premium demo scan',
            'Reading fixed demo face',
            'Preparing premium dashboard',
            'Saving demo preview',
          ];
          const progressTick = setInterval(() => {
            if (!active) return;
            const elapsedMs = Date.now() - scanStartedAt;
            setElapsedScanMs(elapsedMs);
            setStatusText(`${demoSteps[Math.floor(elapsedMs / 900) % demoSteps.length]}...`);
          }, 500);
          await new Promise((resolve) => setTimeout(resolve, 25000));
          clearInterval(progressTick);
          if (!active) return;
          scanSucceeded = true;
          setStatusText('Analysis Complete! Transitioning...');
          onCompleteRef.current(buildPremiumDemoScanPayload(demoPayload, {
            scannedAt: new Date().toISOString(),
          }));
          return;
        }

        const isUltra = choice === "1" || choice === "2" || choice === "6" || choice === "7" || choice === "8" || choice === "9";
        activeUser = userRef.current;
        if (activeUser) {
          try {
            authToken = await activeUser.getIdToken();
          } catch (e) {
            console.warn("Unable to attach auth token to scan", e);
          }
        }

        setStatusText("Checking analysis server...");
        try {
          const healthRes = await fetchWithTimeoutRetry(`${API_BASE}/api/health`);
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

        if (isUltra && !activeUser) {
          setStatusText('Sign in required for Ultra scans. Use Basic scan while signed out, or log in and try again.');
          setHasError(true);
          return;
        }

        if (isUltra) {
          setStatusText("Checking premium access...");
          try {
            const readyRes = await fetchWithTimeoutRetry(`${API_BASE}/api/ready`);

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
              setStatusText(getQuotaAwareScanMessage(readyError, 'Premium scans are unavailable because the backend Firebase connection is not ready.'));
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
            authToken = await activeUser.getIdToken(true);
          } catch (e) {
            console.error("Failed to refresh auth token", e);
            setStatusText('Your session could not be refreshed. Sign out and sign back in, then try the premium scan again.');
            setHasError(true);
            return;
          }

          try {
            const planRes = await fetchWithTimeoutRetry(`${API_BASE}/api/user/plan`, {
              timeoutMs: 12000,
              headers: { Authorization: `Bearer ${authToken}` },
            });
            if (planRes.ok) {
              const planData = await planRes.json();
              currentFairUsage = planData?.fairUsage || null;
              if (active) setFairUsageState(currentFairUsage);
            }
          } catch (fairUsageErr) {
            console.warn('Unable to prefetch fair usage state', fairUsageErr);
          }
        }

        if (postedAnalyzeRequestIds.has(scanRequestId)) {
          setStatusText('This scan is already running. Reconnecting to the scan result...');
          if (activeUser) {
            try {
              const recoveredScan = await pollForSavedScan();
              if (!active) return;
              if (recoveredScan) {
                scanSucceeded = true;
                rememberScanDuration(choice, currentFairUsage, Date.now() - scanStartedAt);
                setStatusText("Analysis Complete! Transitioning...");
                onCompleteRef.current(recoveredScan);
              }
            } catch (recoveryErr) {
              if (!active) return;
              setStatusText(friendlyAnalysisErrorMessage(recoveryErr?.message || 'Analysis failed. Please try again.'));
              setHasError(true);
            }
          }
          return;
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
        formData.append('scanRequestId', scanRequestId);
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

        const headers = {};
        if (authToken) {
          headers.Authorization = `Bearer ${authToken}`;
        }

      /** So the UI never sits on "Consulting AI" forever if Python/API hangs */
        const analyzeAbort = new AbortController();
        cancelAnalyzeRequest = () => analyzeAbort.abort();
        const ANALYZE_CLIENT_MAX_MS = (choice === "6" || choice === "7" || choice === "8" || choice === "9") ? 8 * 60 * 1000 : 14 * 60 * 1000;
        const analyzeHardStop = setTimeout(() => analyzeAbort.abort(), ANALYZE_CLIENT_MAX_MS);

        const buildProgressMessage = () => {
          const elapsedMs = Date.now() - scanStartedAt;
          const totalMs = getAdaptiveScanTotalMs(choice, currentFairUsage);
          const remainingMs = totalMs - elapsedMs;
          const remaining = remainingMs <= 0 ? 'taking longer than usual' : formatTimeLeft(remainingMs);
          const phaseIndex = Math.floor(elapsedMs / 5000) % SCAN_PROGRESS_MESSAGES.length;
          const queueNote = currentFairUsage?.lowPriority ? ' Low-priority queue active.' : '';
          return `${SCAN_PROGRESS_MESSAGES[phaseIndex]}... Estimated time left: ${remaining}.${queueNote}`;
        };

        setStatusText(buildProgressMessage());

        const progressTick = setInterval(() => {
          if (!active) return;
          setElapsedScanMs(Date.now() - scanStartedAt);
          setStatusText(buildProgressMessage());
        }, 1000);
        const recoveryProbeDelayMs = (choice === "6" || choice === "7" || choice === "8" || choice === "9") ? 25000 : isUltra ? 45000 : 30000;
        let recoveryProbeRunning = false;
        const recoveryTick = activeUser ? setInterval(async () => {
          if (!active || scanSucceeded || recoveryProbeRunning) return;
          if (Date.now() - scanStartedAt < recoveryProbeDelayMs) return;
          recoveryProbeRunning = true;
          try {
            const recoveredScan = await recoverCompletedScanOnce();
            if (!active || scanSucceeded || !recoveredScan) return;
            scanSucceeded = true;
            rememberScanDuration(choice, currentFairUsage, Date.now() - scanStartedAt);
            clearTimeout(analyzeHardStop);
            clearInterval(progressTick);
            clearInterval(recoveryTick);
            setStatusText("Analysis Complete! Transitioning...");
            cancelAnalyzeRequest();
            onCompleteRef.current(recoveredScan);
          } catch (recoveryErr) {
            if (!isTransientMobileScanError(recoveryErr) && recoveryErr?.name !== 'AbortError') {
              console.warn('Live scan recovery probe failed', recoveryErr);
            }
          } finally {
            recoveryProbeRunning = false;
          }
        }, 5000) : null;

        const runAnalyzeRequest = async () => {
          if (!active) return null;
          postedAnalyzeRequestIds.add(scanRequestId);
          return fetch(`${API_BASE}/api/analyze`, {
            method: "POST",
            headers,
            body: formData,
            signal: analyzeAbort.signal,
            cache: 'no-store',
          });
        };

        let apiRes;
        try {
          apiRes = await runAnalyzeRequest();
        } finally {
          clearTimeout(analyzeHardStop);
          clearInterval(progressTick);
          if (recoveryTick) clearInterval(recoveryTick);
        }

        if (scanSucceeded) return;
        if (!apiRes) return;
        if (!active) return;
        let data;
        try {
          data = await apiRes.json();
        } catch (parseErr) {
          console.error("Analyze response not JSON", parseErr);
          if (activeUser) {
            try {
              const recoveredScan = await pollForSavedScan();
              if (!active) return;
              if (recoveredScan) {
                scanSucceeded = true;
                rememberScanDuration(choice, currentFairUsage, Date.now() - scanStartedAt);
                setStatusText("Analysis Complete! Transitioning...");
                onCompleteRef.current(recoveredScan);
                return;
              }
            } catch (recoveryErr) {
              if (!active) return;
              setStatusText(friendlyAnalysisErrorMessage(recoveryErr?.message || 'Analysis failed. Please try again.'));
              setHasError(true);
              return;
            }
          }
          setStatusText(GENERIC_ERROR);
          setHasError(true);
          return;
        }

        if (!apiRes.ok) {
          if (data?.fairUsage && active) {
            currentFairUsage = data.fairUsage;
            setFairUsageState(data.fairUsage);
          }
          const msg =
            (data && typeof data.error === 'string' && data.error.trim()) ||
            (data && typeof data.message === 'string' && data.message.trim()) ||
            null;
          setStatusText(
            getQuotaAwareScanMessage(
              friendlyAnalysisErrorMessage(msg),
              `Request failed (${apiRes.status}). ${isUltra ? 'For premium models, confirm you are signed in with Pro or a scan credit.' : ''} If this persists, check the backend logs.`
            )
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
           if (active && data?.fairUsage) {
             currentFairUsage = data.fairUsage;
             setFairUsageState(data.fairUsage);
           }
           rememberScanDuration(choice, currentFairUsage, Date.now() - scanStartedAt);
           scanSucceeded = true;
           setStatusText("Analysis Complete! Transitioning...");
           setVideoUrl(data.videoUrl);
           if (active) onCompleteRef.current(data);
        } else {
           console.error('[analyze] success=false', data?.error || data);
           const detail =
             typeof data?.error === 'string' && data.error.trim()
               ? getQuotaAwareScanMessage(friendlyAnalysisErrorMessage(data.error), 'The AI engine did not return a valid analysis. Please try again in a moment.')
               : 'The AI engine did not return a valid analysis. Please try again in a moment.';
           setStatusText(detail);
           setHasError(true);
        }
      } catch (err) {
        if (scanSucceeded) return;
        console.error("API failed", err);
        if (isTransientMobileScanError(err) && activeUser) {
          let recoveredScan = null;
          try {
            recoveredScan = await pollForSavedScan();
          } catch (recoveryErr) {
            if (!active) return;
            setStatusText(friendlyAnalysisErrorMessage(recoveryErr?.message || 'Analysis failed. Please try again.'));
            setHasError(true);
            return;
          }
          if (!active) return;
          if (recoveredScan) {
            scanSucceeded = true;
            rememberScanDuration(choice, currentFairUsage, Date.now() - scanStartedAt);
            setStatusText("Analysis Complete! Transitioning...");
            onCompleteRef.current(recoveredScan);
            return;
          }
        }
        setStatusText(
          err?.name === 'AbortError'
            ? 'Analysis timed out after about 14 minutes. Please try again with a smaller image or try again in a moment.'
            : getQuotaAwareScanMessage(
                null,
                `Network error: ${err?.message || 'failed to reach server'}. Please try again in a moment.`
              )
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

    return () => {
      active = false;
      cancelAnalyzeRequest();
    };
  }, [mainImageSrc, mainImageFile, sideImageUrl, sideImageFile, sideMetricData, choice, profileId, scanRequestId, startedAtMs, demoPayload]);

  if (runnerOnly) {
    return null;
  }

  if (compact) {
    return (
      <div
        className={`overflow-hidden rounded-2xl border border-cyan-500/20 bg-[#0c0d0e]/95 shadow-[0_0_28px_rgba(34,211,238,0.12)] backdrop-blur-xl ${onOpen ? 'cursor-pointer transition-transform hover:scale-[1.01]' : ''}`}
        onClick={onOpen}
        role={onOpen ? 'button' : undefined}
        tabIndex={onOpen ? 0 : undefined}
        onKeyDown={(event) => {
          if (!onOpen) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen();
          }
        }}
      >
        <div className="flex items-center gap-3 px-3 py-2.5">
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-cyan-500/25 bg-zinc-950">
            {videoUrl ? (
              <video src={videoUrl} autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <>
                <img
                  src={mainImageSrc}
                  alt="Scan target"
                  className="absolute inset-0 h-full w-full object-cover filter contrast-125 brightness-90 saturate-50 grayscale-[20%]"
                />
                <div className="absolute inset-0 bg-blue-900/20 mix-blend-overlay" />
              </>
            )}

            {!videoUrl && (
              <FaceScanOverlay
                landmarksData={landmarks}
                meshConnections={meshConnections}
                revealDurationSeconds={overlayRevealSeconds}
                scanLoopSeconds={overlayScanLoopSeconds}
              />
            )}

            <div className="absolute left-2 top-2 h-3 w-3 border-l-2 border-t-2 border-cyan-500/80" />
            <div className="absolute right-2 top-2 h-3 w-3 border-r-2 border-t-2 border-cyan-500/80" />
            <div className="absolute bottom-2 left-2 h-3 w-3 border-b-2 border-l-2 border-cyan-500/80" />
            <div className="absolute bottom-2 right-2 h-3 w-3 border-b-2 border-r-2 border-cyan-500/80" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`inline-flex h-2.5 w-2.5 rounded-full ${hasError ? 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.85)]' : 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.85)] animate-pulse'}`} />
              <p className={`truncate text-[10px] font-black uppercase tracking-[0.28em] ${hasError ? 'text-red-300/85' : 'text-cyan-300/85'}`}>
                {hasError ? 'Scan paused' : 'Scan in progress'}
              </p>
            </div>
            <p className="mt-1 truncate text-[11px] font-black uppercase tracking-[0.22em] text-white">
              {analysisLabel || 'Profile'}
            </p>
            <p className="mt-0.5 truncate text-[10px] font-sans uppercase tracking-[0.2em] text-zinc-500">
              {hasError ? 'Action needed' : getAnalysisModelLabel(choice)}
            </p>
            {lowPriorityBadge && !hasError && (
              <div className="mt-1 inline-flex max-w-full rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-red-300">
                <span className="truncate">{lowPriorityBadge}</span>
              </div>
            )}
            <p className="mt-1 truncate text-[10px] leading-relaxed text-zinc-400">
              {statusText}
            </p>
            <p className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-400">
              {formatElapsedMinutes(elapsedScanMs)}
            </p>
            {!hasError && (
              <div className="mt-2 overflow-hidden rounded-full border border-cyan-500/15 bg-zinc-900/80 p-1">
                <div className="h-1.5 rounded-full bg-gradient-to-r from-cyan-700/40 via-cyan-300 to-cyan-700/40 animate-pulse" />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              return onDismiss ? onDismiss() : onScanFailedRef.current?.();
            }}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/80 text-zinc-500 transition-colors hover:border-cyan-500/40 hover:text-cyan-300"
            aria-label="Dismiss analysis"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center animate-[fadeIn_0.5s_ease-out]">
      <style>{`
        @keyframes scan {
          0% { transform: translateY(-120px); opacity: 0.24; }
          8% { opacity: 1; }
          92% { opacity: 1; }
          100% { transform: translateY(620px); opacity: 0.24; }
        }
        @keyframes analysisScanBand {
          0% { transform: translate3d(0, -72%, 0); opacity: 0.38; }
          12% { opacity: 0.72; }
          88% { opacity: 0.72; }
          100% { transform: translate3d(0, 360%, 0); opacity: 0.38; }
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
        <h2 className={`text-2xl sm:text-3xl md:text-5xl font-black italic uppercase tracking-tighter text-cyan-400 mb-2 drop-shadow-[0_0_15px_rgba(34,211,238,0.5)] ${isCompactViewport ? '' : 'animate-pulse'}`}>Analysing Face</h2>
        <p className="font-sans text-xs sm:text-sm text-zinc-400 normal-case tracking-normal max-w-lg mx-auto px-4 leading-relaxed">
          {statusText}
        </p>
        <p className="mt-2 text-[10px] font-black uppercase tracking-[0.24em] text-emerald-400">
          {formatElapsedMinutes(elapsedScanMs)}
        </p>
        {lowPriorityBadge && (
          <div className="mt-4 inline-flex max-w-[min(92vw,720px)] rounded-full border border-red-500/35 bg-red-500/12 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.24em] text-red-300">
            <span className="truncate">{lowPriorityBadge}</span>
          </div>
        )}
      </div>

      <div className="relative aspect-[3/4] w-[88vw] max-w-md mx-auto bg-zinc-900 border border-cyan-500/50 rounded-3xl overflow-hidden shadow-[0_0_60px_rgba(34,211,238,0.2)] sm:scale-[1.02] transform-gpu">
        {videoUrl ? (
           <video src={videoUrl} autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover z-10" />
        ) : (
           <>
             <img src={mainImageSrc} alt="Scan target" className="absolute inset-0 w-full h-full object-cover filter contrast-125 brightness-90 saturate-50 grayscale-[20%] z-0" />
             <div className="absolute inset-0 bg-blue-900/30 mix-blend-overlay z-0" />
             <AnalysisScanBand />
           </>
        )}
        
        {!videoUrl && (
          <FaceScanOverlay
            landmarksData={landmarks}
            meshConnections={meshConnections}
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

const AnalysisDockSummaryCard = ({ job, onOpenResult, onDismiss }) => (
  <div className="overflow-hidden rounded-2xl border border-emerald-500/20 bg-[#0c0d0e]/95 shadow-[0_0_28px_rgba(16,185,129,0.12)] backdrop-blur-xl">
    <div className="flex items-center gap-3 px-3 py-3">
      <img
        src={job.result?.frontImage || job.mainImageSrc}
        alt="Completed scan"
        className="h-16 w-16 shrink-0 rounded-xl border border-emerald-500/25 object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(74,222,128,0.9)]" />
          <p className="truncate text-[10px] font-sans uppercase tracking-[0.28em] text-emerald-400/85">
            {job.analysisLabel || 'Analysis'}
          </p>
        </div>
        <p className="mt-1 truncate text-[11px] font-black uppercase tracking-widest text-white">
          {job.result?.finalRating != null
            ? `Final rating ${Number(job.result.finalRating).toFixed(1)}`
            : 'Description ready'}
        </p>
        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-zinc-400">
          Your scan finished and is ready to open.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onOpenResult(job.id)}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-black shadow-[0_0_20px_rgba(16,185,129,0.25)] transition-transform hover:scale-[1.02]"
          >
            <ArrowUpRight size={12} /> Open
          </button>
          <button
            type="button"
            onClick={() => onDismiss(job.id)}
            className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(job.id)}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/80 text-zinc-500 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
        aria-label="Dismiss completed analysis"
      >
        <X size={14} />
      </button>
    </div>
  </div>
);

const AnalysisDockRunningCard = ({ job, onOpen, onDismiss }) => {
  const hasError = Boolean(job.hasError);
  const lowPriorityBadge = job.fairUsageState?.lowPriority
    ? (job.fairUsageState.badgeText || 'High usage detected, you have been placed on low-priority queue.')
    : '';
  const elapsedMs = Number(job.elapsedScanMs);

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-cyan-500/20 bg-[#0c0d0e]/95 shadow-[0_0_28px_rgba(34,211,238,0.12)] backdrop-blur-xl ${onOpen ? 'cursor-pointer transition-transform hover:scale-[1.01]' : ''}`}
      onClick={onOpen}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(event) => {
        if (!onOpen) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-cyan-500/25 bg-zinc-950">
          <img
            src={job.mainImageSrc}
            alt="Scan target"
            className="absolute inset-0 h-full w-full object-cover filter contrast-125 brightness-90 saturate-50 grayscale-[20%]"
          />
          <div className="absolute inset-0 bg-blue-900/20 mix-blend-overlay" />
          <div className="absolute left-2 top-2 h-3 w-3 border-l-2 border-t-2 border-cyan-500/80" />
          <div className="absolute right-2 top-2 h-3 w-3 border-r-2 border-t-2 border-cyan-500/80" />
          <div className="absolute bottom-2 left-2 h-3 w-3 border-b-2 border-l-2 border-cyan-500/80" />
          <div className="absolute bottom-2 right-2 h-3 w-3 border-b-2 border-r-2 border-cyan-500/80" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`inline-flex h-2.5 w-2.5 rounded-full ${hasError ? 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.85)]' : 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.85)] animate-pulse'}`} />
            <p className={`truncate text-[10px] font-black uppercase tracking-[0.28em] ${hasError ? 'text-red-300/85' : 'text-cyan-300/85'}`}>
              {hasError ? 'Scan paused' : 'Scan in progress'}
            </p>
          </div>
          <p className="mt-1 truncate text-[11px] font-black uppercase tracking-[0.22em] text-white">
            {job.analysisLabel || 'Profile'}
          </p>
          <p className="mt-0.5 truncate text-[10px] font-sans uppercase tracking-[0.2em] text-zinc-500">
            {hasError ? 'Action needed' : getAnalysisModelLabel(job.choice)}
          </p>
          {lowPriorityBadge && !hasError && (
            <div className="mt-1 inline-flex max-w-full rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-red-300">
              <span className="truncate">{lowPriorityBadge}</span>
            </div>
          )}
          <p className="mt-1 truncate text-[10px] leading-relaxed text-zinc-400">
            {job.statusText || 'Preparing analysis...'}
          </p>
          <p className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-400">
            {formatElapsedMinutes(Number.isFinite(elapsedMs) ? elapsedMs : Math.max(0, Date.now() - Number(job.createdAt || Date.now())))}
          </p>
          {!hasError && (
            <div className="mt-2 overflow-hidden rounded-full border border-cyan-500/15 bg-zinc-900/80 p-1">
              <div className="h-1.5 rounded-full bg-gradient-to-r from-cyan-700/40 via-cyan-300 to-cyan-700/40 animate-pulse" />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDismiss?.();
          }}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/80 text-zinc-500 transition-colors hover:border-cyan-500/40 hover:text-cyan-300"
          aria-label="Dismiss analysis"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

const AnalysisDock = ({
  jobs,
  collapsed,
  setCollapsed,
  onOpenResult,
  onOpenRunning,
  onJobStatusChange,
  onDismiss,
  currentPage,
}) => {
  if (!Array.isArray(jobs) || jobs.length === 0) return null;

  const runningJobs = jobs.filter((job) => job.state === 'running');
  const runningCount = runningJobs.length;
  const completedCount = jobs.filter((job) => job.state === 'complete').length;
  const visibleJobs = jobs.slice(0, 4);
  const hiddenJobsCount = Math.max(0, jobs.length - visibleJobs.length);
  const runnerElements = runningJobs.map((job) => (
    <ScanningView
      key={`runner-${job.id}`}
      compact
      runnerOnly
      analysisLabel={job.analysisLabel}
      onStatusChange={(status) => onJobStatusChange(job.id, status)}
      startedAtMs={job.createdAt}
      scanRequestId={job.scanRequestId}
      mainImageSrc={job.mainImageSrc}
      mainImageFile={job.mainImageFile}
      sideImageUrl={job.sideImageUrl}
      sideImageFile={job.sideImageFile}
      sideMetricData={job.sideMetricData || sideMetricDataGlobal}
      choice={job.choice}
      demoPayload={job.demoPayload}
      onComplete={job.onComplete}
      onScanFailed={() => onDismiss(job.id)}
      user={job.user}
      profileId={job.profileId}
    />
  ));

  if (currentPage === 'analysis') return <>{runnerElements}</>;

  if (collapsed) {
    return (
      <>
        {runnerElements}
        <div
          className="fixed bottom-5 z-[240] flex flex-col items-end gap-2"
          style={{ right: '1.6rem' }}
        >
          {jobs.slice(0, 4).map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => (job.state === 'complete' ? onOpenResult(job.id) : onOpenRunning(job.id))}
              className="inline-flex min-w-[184px] items-center gap-3 rounded-full border border-cyan-500/25 bg-[#0c0d0e]/95 px-4 py-3 shadow-[0_0_35px_rgba(34,211,238,0.18)] backdrop-blur-xl transition-transform hover:scale-[1.01]"
            >
              <span className={`inline-flex h-2.5 w-2.5 rounded-full ${job.state === 'complete' ? 'bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.85)]' : 'bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.85)] animate-pulse'}`} />
              <span className={`text-[10px] font-black uppercase tracking-[0.3em] ${job.state === 'complete' ? 'text-emerald-300' : 'text-cyan-300'}`}>
                {job.state === 'complete' ? 'Ready' : '1 Running'}
              </span>
            </button>
          ))}
          {jobs.length > 4 && (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="inline-flex items-center gap-3 rounded-full border border-zinc-800 bg-[#0c0d0e]/95 px-4 py-3 shadow-[0_0_25px_rgba(255,255,255,0.05)] backdrop-blur-xl transition-transform hover:scale-[1.01]"
            >
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-300">
                +{jobs.length - 4} more
              </span>
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {runnerElements}
      <div
        className="fixed bottom-5 z-[240] flex max-w-[92vw] flex-col items-end gap-2"
        style={{ right: '2.35rem' }}
      >
      <div className="inline-flex items-center justify-between gap-5 rounded-full border border-zinc-800 bg-[#0c0d0e]/95 px-4 py-2 shadow-[0_0_35px_rgba(34,211,238,0.08)] backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.85)] animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white">
            Analysis queue
          </span>
        </div>
        <div className="flex items-center gap-4">
          {runningCount > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-300">
              {runningCount} running
            </span>
          )}
          {completedCount > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-300">
              {completedCount} ready
            </span>
          )}
          {hiddenJobsCount > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
              +{hiddenJobsCount} more
            </span>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-500 transition-colors hover:text-cyan-300"
          >
            Minimize
          </button>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        {visibleJobs.map((job) =>
          <div key={job.id} className="w-[min(92vw,320px)]">
            {job.state === 'complete' ? (
              <AnalysisDockSummaryCard
                job={job}
                onOpenResult={onOpenResult}
                onDismiss={onDismiss}
              />
            ) : (
              <AnalysisDockRunningCard
                job={job}
                onOpen={() => onOpenRunning(job.id)}
                onDismiss={() => onDismiss(job.id)}
              />
            )}
          </div>
        )}
      </div>
      </div>
    </>
  );
};

const ConsultingStatusPage = ({ job, setCurrentPage, user }) => {
  const [scanningCeleb, setScanningCeleb] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Number(job?.createdAt);
    if (!Number.isFinite(startedAt) || startedAt <= 0) {
      setElapsedMs(0);
      return undefined;
    }
    const updateElapsed = () => setElapsedMs(Math.max(0, Date.now() - startedAt));
    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    return () => clearInterval(timer);
  }, [job?.createdAt]);

  if (!job) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#0c0d0e] px-6 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-zinc-500">No active scan</p>
        <button
          type="button"
          onClick={() => setCurrentPage('upload-photo')}
          className="mt-6 rounded-full border border-zinc-700 bg-zinc-900 px-5 py-2 text-xs font-bold uppercase tracking-widest text-zinc-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-300"
        >
          Start Scan
        </button>
      </div>
    );
  }

  const isUltra31 = job.choice === "1";
  const isGemini31Pro = job.choice === "6" || job.choice === "7" || job.choice === "8" || job.choice === "9";
  const overlayRevealSeconds = job.overlayRevealSeconds || (isUltra31 ? 34 : isGemini31Pro ? 18 : job.choice === "2" ? 24 : 36);
  const overlayScanLoopSeconds = job.overlayScanLoopSeconds || (isUltra31 ? 4 : isGemini31Pro ? 3.5 : job.choice === "2" ? 4.5 : 4);
  const lowPriorityBadge = job.fairUsageState?.lowPriority
    ? (job.fairUsageState.badgeText || 'High usage detected, you have been placed on low-priority queue.')
    : '';
  const statusText = job.statusText || 'Preparing analysis... Estimated time left: calculating.';

  return (
    <div className="flex-grow flex flex-col bg-[#0c0d0e] scroll-mt-20">
      <style>{`
        @keyframes scan {
          0% { transform: translateY(-120px); opacity: 0.24; }
          8% { opacity: 1; }
          92% { opacity: 1; }
          100% { transform: translateY(620px); opacity: 0.24; }
        }
        @keyframes analysisScanBand {
          0% { transform: translate3d(0, -72%, 0); opacity: 0.38; }
          12% { opacity: 0.72; }
          88% { opacity: 0.72; }
          100% { transform: translate3d(0, 360%, 0); opacity: 0.38; }
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
      <div className="flex flex-col items-center pt-24 pb-16 px-6 lg:px-12 relative min-h-screen">
        <div className="w-full h-full flex flex-col items-center justify-center animate-[fadeIn_0.5s_ease-out]">
          <div className="text-center mb-10 mt-10">
            <h2 className="text-2xl sm:text-3xl md:text-5xl font-black italic uppercase tracking-tighter text-cyan-400 mb-2 drop-shadow-[0_0_15px_rgba(34,211,238,0.5)] animate-pulse">Analysing Face</h2>
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.24em] text-emerald-400">
              {formatElapsedMinutes(elapsedMs)}
            </p>
            <p className="font-sans text-xs sm:text-sm text-zinc-400 normal-case tracking-normal max-w-lg mx-auto px-4 leading-relaxed">
              {statusText}
            </p>
            {lowPriorityBadge && (
              <div className="mt-4 inline-flex max-w-[min(92vw,720px)] rounded-full border border-red-500/35 bg-red-500/12 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.24em] text-red-300">
                <span className="truncate">{lowPriorityBadge}</span>
              </div>
            )}
          </div>

          <div className="relative aspect-[3/4] w-[88vw] max-w-md mx-auto bg-zinc-900 border border-cyan-500/50 rounded-3xl overflow-hidden shadow-[0_0_60px_rgba(34,211,238,0.2)] sm:scale-[1.02] transform-gpu">
            {job.videoUrl ? (
              <video src={job.videoUrl} autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover z-10" />
            ) : (
              <>
                <img src={job.mainImageSrc} alt="Scan target" className="absolute inset-0 w-full h-full object-cover filter contrast-125 brightness-90 saturate-50 grayscale-[20%] z-0" />
                <div className="absolute inset-0 bg-blue-900/30 mix-blend-overlay z-0" />
                <AnalysisScanBand />
              </>
            )}

            {!job.videoUrl && (
              <FaceScanOverlay
                landmarksData={job.landmarks}
                meshConnections={job.meshConnections}
                revealDurationSeconds={overlayRevealSeconds}
                scanLoopSeconds={overlayScanLoopSeconds}
              />
            )}

            <div className="absolute top-6 left-6 w-8 h-8 border-t-2 border-l-2 border-cyan-500/80 z-30" />
            <div className="absolute top-6 right-6 w-8 h-8 border-t-2 border-r-2 border-cyan-500/80 z-30" />
            <div className="absolute bottom-6 left-6 w-8 h-8 border-b-2 border-l-2 border-cyan-500/80 z-30" />
            <div className="absolute bottom-6 right-6 w-8 h-8 border-b-2 border-r-2 border-cyan-500/80 z-30" />
          </div>

          <div className="mt-16 flex flex-col items-center gap-3 animate-bounce cursor-pointer hover:scale-105 transition-transform" onClick={() => window.scrollBy({ top: 600, behavior: 'smooth' })}>
            <div className="bg-cyan-500/10 border border-cyan-500/30 px-6 py-2 rounded-full shadow-[0_0_15px_rgba(34,211,238,0.2)]">
              <span className="text-cyan-400 font-bold font-sans text-xs uppercase tracking-[0.3em]">Scroll down while you wait</span>
            </div>
            <ChevronRight size={24} className="text-cyan-400 rotate-90 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
          </div>
        </div>
      </div>
      <div className="border-t border-zinc-800/50">
        <CelebrityRatingPage setCurrentPage={() => {}} setSelectedCelebrity={setScanningCeleb} user={user} />
      </div>
      {scanningCeleb && (
        <div className="fixed inset-0 z-[220] overflow-y-auto bg-black/85 backdrop-blur-xl">
          <div className="sticky top-0 z-10 flex justify-end border-b border-zinc-900 bg-[#0c0d0e]/95 px-4 py-4">
            <button
              type="button"
              onClick={() => setScanningCeleb(null)}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-4 py-2 text-xs font-bold uppercase tracking-widest text-zinc-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-300"
            >
              <X size={14} /> Back to scan
            </button>
          </div>
          <CelebrityStatsPage celeb={scanningCeleb} setCurrentPage={() => setScanningCeleb(null)} />
        </div>
      )}
    </div>
  );
};


// --- Upload Photo Page ---
const UPLOAD_GUIDE_STORAGE_PREFIX = 'mogcheck_upload_guide_hidden_v1';
const UPLOAD_GUIDE_SLIDES = [
  {
    src: '/images/upload-guide-1.jpg',
    alt: 'Perfectly centered selfie guide',
  },
  {
    src: '/images/upload-guide-2.jpg',
    alt: 'Clear lighting versus harsh lighting guide',
  },
  {
    src: '/images/upload-guide-3.jpg',
    alt: 'Clean shaven versus obstructed facial hair guide',
  },
];

const UploadPhotoPage = ({ setCurrentPage, setDashboardData, setSelectedCelebrity, user, userPlan, initialModel = "3", isLockedToUltra = false, initialProfileId = null, queueAnalysisJob }) => {
  const [frontImage, setFrontImage] = useState(null);
  const [frontFile, setFrontFile] = useState(null);
  const [sideImage, setSideImage] = useState(null);
  const [sideFile, setSideFile] = useState(null);
  const [useSideProfile, setUseSideProfile] = useState(true);
  const normalizeSelectableModel = (model) => {
    const normalized = String(model || '3').trim();
    return normalized === '1' || normalized === '6' ? '9' : normalized;
  };
  const [selectedModel, setSelectedModel] = useState(normalizeSelectableModel(initialModel));
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [dropdownAnimOpen, setDropdownAnimOpen] = useState(false);
  const [justUnlocked, setJustUnlocked] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [activeAnalysisJob, setActiveAnalysisJob] = useState(null);
  const [scanningCeleb, setScanningCeleb] = useState(null);
  const [uploadNotice, setUploadNotice] = useState('');
  const [isUploadGuideOpen, setIsUploadGuideOpen] = useState(false);
  const [uploadGuideIndex, setUploadGuideIndex] = useState(0);
  const [dontShowUploadGuideAgain, setDontShowUploadGuideAgain] = useState(false);
  const modelMenuRef = useRef(null);
  const scanTopRef = useRef(null);

  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(initialProfileId || 'new');
  const [activeScanProfileId, setActiveScanProfileId] = useState(initialProfileId || 'new');
  const [newProfileName, setNewProfileName] = useState('');
  const [profilesUnavailable, setProfilesUnavailable] = useState(false);
  const [profileScanCounts, setProfileScanCounts] = useState({});
  const [premiumDemoScanUsed, setPremiumDemoScanUsed] = useState(false);
  const [premiumDemoUsedIds, setPremiumDemoUsedIds] = useState([]);
  const [selectedPremiumDemoId, setSelectedPremiumDemoId] = useState(DEFAULT_PREMIUM_DEMO_ID);

  useEffect(() => {
    setFrontImage(null);
    setFrontFile(null);
    setSideImage(null);
    setSideFile(null);
  }, [initialModel, initialProfileId]);

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
            try {
              const scansRes = await fetch(`${API_BASE}/api/user/scans`, {
                headers: { Authorization: `Bearer ${token}` }
              });
              if (scansRes.ok) {
                const scansData = await scansRes.json();
                const counts = {};
                (scansData.scans || []).forEach((scan) => {
                  const profileId = scan.profileId || scan.payload?.profileId || 'default';
                  counts[profileId] = (counts[profileId] || 0) + 1;
                });
                setProfileScanCounts(counts);
                const detectedDemoIds = new Set(
                  Array.isArray(scansData.premiumDemoUsedIds) ? scansData.premiumDemoUsedIds : []
                );
                (scansData.scans || []).forEach((scan) => {
                  const demoId = getPremiumDemoIdFromScan(scan);
                  if (demoId) detectedDemoIds.add(demoId);
                });
                const nextDemoUsedIds = ACTIVE_PREMIUM_DEMO_IDS.filter((demoId) => detectedDemoIds.has(demoId));
                setPremiumDemoUsedIds(nextDemoUsedIds);
                setPremiumDemoScanUsed(Boolean(scansData.premiumDemoScanUsed) || ACTIVE_PREMIUM_DEMO_IDS.every((demoId) => detectedDemoIds.has(demoId)));
              }
            } catch (scanErr) {
              console.warn('Failed to fetch profile scan counts', scanErr);
            }
            setProfilesUnavailable(Boolean(data.profilesUnavailable));
            setProfiles((prev) => (
              fetchedProfiles.length > 0 || prev.length === 0 || !data.warning
                ? fetchedProfiles
                : prev
            ));
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
        // 401 = token not accepted by server; 503 = Firestore off - avoid invalid <select> value
          setProfilesUnavailable(false);
          if (res.status !== 401 && res.status !== 503) {
            console.warn('fetch profiles HTTP', res.status);
          }
        }
      } catch (e) {
        console.error('Failed to fetch profiles', e);
        setProfilesUnavailable(false);
      }
    };
    fetchProfiles();
  }, [user, initialProfileId]);

  // Check if current user is an admin by email domain or specific email
  const isAdmin = user?.email && (
    user.email === 'laithbu07@gmail.com' ||
    user.email === 'admin@looksmaxxing.com' ||
    user.email === 'serenity.eyb@gmail.com' ||
    user.email === 'laithabuamsheh@gmail.com' ||
    user.email.endsWith('@looksmaxxing.com')
  );
  const premiumDemoUsedSet = useMemo(() => new Set(premiumDemoUsedIds), [premiumDemoUsedIds]);
  const selectedPremiumDemoFace = PREMIUM_DEMO_FACES.find((face) => face.id === selectedPremiumDemoId) || getPremiumDemoFace(selectedPremiumDemoId);
  const visiblePremiumDemoFaceId = selectedPremiumDemoFace?.id || DEFAULT_PREMIUM_DEMO_ID;
  const activePremiumDemoTotal = ACTIVE_PREMIUM_DEMO_IDS.length;
  const activePremiumDemoUsedCount = ACTIVE_PREMIUM_DEMO_IDS.filter((demoId) => premiumDemoUsedSet.has(demoId)).length;
  const hasUsedAnyPremiumDemo = activePremiumDemoUsedCount > 0 || Boolean(premiumDemoScanUsed);
  const allPremiumDemosUsed = activePremiumDemoTotal > 0 && activePremiumDemoUsedCount >= activePremiumDemoTotal;

  const models = [
    ...(!allPremiumDemosUsed || isAdmin ? [{
      id: PREMIUM_DEMO_MODEL_ID,
      name: "Free Demo Scan",
      description:
        "Choose a fixed-face premium demo scan. Each demo face can be previewed once per account.",
      tier: "demo",
      Icon: Crown
    }] : []),
    {
      id: "2",
      name: "Backup Model",
      description:
        "Fallback model for times when the premium model is unavailable or behaving inconsistently.",
      tier: "ultra",
      Icon: Zap
    },
    {
      id: "9",
      name: "Premium Model",
      description:
        "Primary premium analysis with the full high-detail dashboard and premium reporting flow.",
      tier: "ultra",
      Icon: Crown
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

  const isUltraModel = selectedModel === "1" || selectedModel === "2" || selectedModel === "6" || selectedModel === "7" || selectedModel === "8" || selectedModel === "9";
  const isPremiumDemoModel = selectedModel === PREMIUM_DEMO_MODEL_ID;
  const selectedPremiumDemoLocked = isPremiumDemoModel && !selectedPremiumDemoFace?.enabled;
  const shouldUseSideProfile = isUltraModel && useSideProfile;
  const planResolved = !user || userPlan?.loaded !== false;
  const isFreePlanAccount = Boolean(
    user &&
    !isAdmin &&
    planResolved &&
    normalizePlanValue(userPlan?.plan || 'free') === 'free'
  );
  const shouldDemoGlowFlicker = isFreePlanAccount;
  const shouldShowDemoNudge = Boolean(
    user &&
    !isPremiumDemoModel &&
    !hasUsedAnyPremiumDemo &&
    (isAdmin || isFreePlanAccount)
  );

  const ultraAccessPending = !!user && !isAdmin && !planResolved;
  const canUseUltra =
    !!user &&
    (isAdmin ||
      (planResolved &&
        (isProPlan(userPlan) ||
          (userPlan?.plan === 'single_scan' && (userPlan?.scanCredits ?? 0) > 0))));
  const missingRequiredImage = isPremiumDemoModel ? false : (shouldUseSideProfile ? (!frontImage || !sideImage) : !frontImage);
  const scanAccessLocked = !isPremiumDemoModel && isUltraModel && (ultraAccessPending || !canUseUltra);
  const selectedProfileScanCount = selectedProfileId !== 'new'
    ? (profileScanCounts[selectedProfileId] || 0)
    : 0;
  const selectedProfileFull = !isPremiumDemoModel && selectedProfileId !== 'new' && selectedProfileScanCount >= PROFILE_SCAN_HISTORY_LIMIT;
  const uploadGuideStorageKey = useMemo(
    () => `${UPLOAD_GUIDE_STORAGE_PREFIX}:${user?.uid || 'guest'}`,
    [user?.uid]
  );

  useEffect(() => {
    let hidden = false;
    try {
      hidden = window.localStorage.getItem(uploadGuideStorageKey) === '1';
    } catch {
      hidden = false;
    }
    setDontShowUploadGuideAgain(hidden);
    setUploadGuideIndex(0);
    if (!hidden) setIsUploadGuideOpen(true);
  }, [uploadGuideStorageKey]);

  const openUploadGuide = useCallback(() => {
    setUploadGuideIndex(0);
    setIsUploadGuideOpen(true);
  }, []);

  const setUploadGuideDismissed = useCallback((checked) => {
    setDontShowUploadGuideAgain(checked);
    try {
      if (checked) window.localStorage.setItem(uploadGuideStorageKey, '1');
      else window.localStorage.removeItem(uploadGuideStorageKey);
    } catch {
      // Best-effort only.
    }
  }, [uploadGuideStorageKey]);

  useEffect(() => {
    if (selectedModel === PREMIUM_DEMO_MODEL_ID) return;
    if (ultraAccessPending) return;
    if (!isAdmin && (selectedModel === '7' || selectedModel === '8')) {
      setSelectedModel('3');
      return;
    }
    if (!canUseUltra && (selectedModel === '1' || selectedModel === '2' || selectedModel === '6' || selectedModel === '7' || selectedModel === '8' || selectedModel === '9')) {
      setSelectedModel('3');
    }
  }, [canUseUltra, isAdmin, selectedModel, ultraAccessPending]);

  useEffect(() => {
    if (!isAdmin && allPremiumDemosUsed && selectedModel === PREMIUM_DEMO_MODEL_ID) {
      setSelectedModel('3');
    }
  }, [allPremiumDemosUsed, isAdmin, selectedModel]);

  useEffect(() => {
    if (!isPremiumDemoModel) return;
    const selectedDemoFace = PREMIUM_DEMO_FACES.find((face) => face.id === selectedPremiumDemoId);
    const nextDemoId = selectedDemoFace?.id || getAvailablePremiumDemoId(premiumDemoUsedIds, selectedPremiumDemoId);
    if (nextDemoId !== selectedPremiumDemoId) {
      setSelectedPremiumDemoId(nextDemoId);
    }
    const nextDemoFace = PREMIUM_DEMO_FACES.find((face) => face.id === nextDemoId) || getPremiumDemoFace(nextDemoId);
    setUseSideProfile(false);
    setSelectedProfileId(PREMIUM_DEMO_MODEL_ID);
    setActiveScanProfileId(PREMIUM_DEMO_MODEL_ID);
    setFrontImage(nextDemoFace?.image || null);
    setFrontFile(null);
    setSideImage(null);
    setSideFile(null);
    setJustUnlocked(true);
    const timer = setTimeout(() => setJustUnlocked(false), 1600);
    return () => clearTimeout(timer);
  }, [isPremiumDemoModel, premiumDemoUsedIds, selectedPremiumDemoId]);

  useEffect(() => {
    if (isPremiumDemoModel || selectedProfileId !== PREMIUM_DEMO_MODEL_ID) return;
    const nextProfileId = profiles[0]?.id || 'new';
    setSelectedProfileId(nextProfileId);
    setActiveScanProfileId(nextProfileId);
  }, [isPremiumDemoModel, profiles, selectedProfileId]);

  useEffect(() => {
    if (!shouldUseSideProfile) {
      setSideImage(null);
      setSideFile(null);
    }
  }, [shouldUseSideProfile]);

  useEffect(() => {
    const bothReady = shouldUseSideProfile ? (frontImage && sideImage) : frontImage;
    if (bothReady) {
      setJustUnlocked(true);
      const timer = setTimeout(() => setJustUnlocked(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [frontImage, sideImage, shouldUseSideProfile]);

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
    setSelectedModel(normalizeSelectableModel(initialModel));
  }, [initialModel]);

  useEffect(() => {
    setSelectedProfileId(initialProfileId || 'new');
    setActiveScanProfileId(initialProfileId || 'new');
  }, [initialProfileId]);

  const handleScanComplete = useCallback((data) => {
    const completedAt = new Date().toISOString();
    const targetProfileId = data?.profileId || activeScanProfileId || selectedProfileId || 'default';
    const completedScan = normalizeDashboardMedia({
      ...data,
      scanRequestId: data?.scanRequestId || null,
      frontImage: data?.frontImage || frontImage,
      sideImage: shouldUseSideProfile ? (data?.sideImage || sideImage) : null,
      debugAnchorsImage: data?.debugAnchorsImage || data?.debugAnchorsImageUrl || null,
      debugAnchorsImageUrl: data?.debugAnchorsImageUrl || data?.debugAnchorsImage || null,
      debugRatiosImage: data?.debugRatiosImage || data?.debugRatiosImageUrl || null,
      debugRatiosImageUrl: data?.debugRatiosImageUrl || data?.debugRatiosImage || null,
      selectedModel: data?.selectedModel || data?.model || selectedModel,
      profileId: targetProfileId && targetProfileId !== 'new' ? targetProfileId : 'default',
      scannedAt: data?.scannedAt || completedAt,
      _handoffSavedAt: completedAt,
    });

    setScanningCeleb(null);
    setProfileScanCounts((prev) => ({
      ...prev,
      [completedScan.profileId]: Math.min(PROFILE_SCAN_HISTORY_LIMIT, (prev[completedScan.profileId] || 0) + 1),
    }));

    setDashboardData(prev => {
      const sameProfile =
        String(prev?.profileId || 'default').trim() === completedScan.profileId;
      const newScanHistory =
        sameProfile && Array.isArray(prev?.scanHistory) ? [...prev.scanHistory] : [];
      const newRatingHistory =
        sameProfile && Array.isArray(prev?.ratingHistory) ? [...prev.ratingHistory] : [];

      if (sameProfile && prev && prev.frontImage && prev.finalRating && newScanHistory.length === 0) {
        newScanHistory.push({
          ...prev,
          scannedAt: prev.scannedAt || completedAt,
        });
      }
      if (sameProfile && prev && prev.finalRating && newRatingHistory.length === 0) {
        newRatingHistory.push(prev.finalRating);
      }

      const dedupedScanHistory = appendUniqueScan(newScanHistory, completedScan);
      if (completedScan.finalRating != null && !Number.isNaN(Number(completedScan.finalRating))) {
        newRatingHistory.push(Number(completedScan.finalRating));
      }

      const cappedScanHistory = dedupedScanHistory.slice(-PROFILE_SCAN_HISTORY_LIMIT);
      const cappedRatingHistory = newRatingHistory.slice(-PROFILE_SCAN_HISTORY_LIMIT);

      return {
        ...completedScan,
        scanHistory: cappedScanHistory,
        ratingHistory: cappedRatingHistory
      };
    });
  }, [activeScanProfileId, frontImage, selectedModel, selectedProfileId, setDashboardData, shouldUseSideProfile, sideImage]);

  useEffect(() => {
    if (!isScanning) return undefined;
    const id = window.setTimeout(() => {
      scanTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => clearTimeout(id);
  }, [isScanning]);

  if (isScanning && activeAnalysisJob) {
    return (
      <div ref={scanTopRef} className="flex-grow flex flex-col bg-[#0c0d0e] scroll-mt-20">
        <div className="flex flex-col items-center pt-24 pb-16 px-6 lg:px-12 relative min-h-screen">
          <ScanningView
             mainImageSrc={activeAnalysisJob.mainImageSrc}
             mainImageFile={activeAnalysisJob.mainImageFile}
             sideImageUrl={activeAnalysisJob.sideImageUrl}
             sideImageFile={activeAnalysisJob.sideImageFile}
             sideMetricData={activeAnalysisJob.sideMetricData || sideMetricDataGlobal}
             choice={activeAnalysisJob.choice}
             demoPayload={activeAnalysisJob.demoPayload}
             scanRequestId={activeAnalysisJob.scanRequestId}
             user={activeAnalysisJob.user || user}
             profileId={activeAnalysisJob.profileId || activeScanProfileId}
             analysisLabel={activeAnalysisJob.analysisLabel || 'Analysis'}
             onScanFailed={() => {
               setIsScanning(false);
               setActiveAnalysisJob(null);
             }}
             onComplete={(data) => {
               const completedScan = activeAnalysisJob.onComplete?.(data, { skipDashboardUpdate: true }) || data;
               handleScanComplete(completedScan);
               setIsScanning(false);
               setActiveAnalysisJob(null);
               setCurrentPage('dashboard');
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
          <CelebrityRatingPage setCurrentPage={() => {}} setSelectedCelebrity={setScanningCeleb} user={user} />
        </div>
        {scanningCeleb && (
          <div className="fixed inset-0 z-[220] overflow-y-auto bg-black/85 backdrop-blur-xl">
            <div className="sticky top-0 z-10 flex justify-end border-b border-zinc-900 bg-[#0c0d0e]/95 px-4 py-4">
              <button
                type="button"
                onClick={() => setScanningCeleb(null)}
                className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-4 py-2 text-xs font-bold uppercase tracking-widest text-zinc-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-300"
              >
                <X size={14} /> Back to scan
              </button>
            </div>
            <CelebrityStatsPage celeb={scanningCeleb} setCurrentPage={() => setScanningCeleb(null)} />
          </div>
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
        @keyframes cyanPreviewFlicker {
          0%, 100% { box-shadow: 0 0 18px rgba(34,211,238,0.16); filter: saturate(1); }
          42% { box-shadow: 0 0 34px rgba(34,211,238,0.38); filter: saturate(1.35); }
          46% { box-shadow: 0 0 12px rgba(34,211,238,0.12); filter: saturate(0.9); }
          58% { box-shadow: 0 0 42px rgba(34,211,238,0.46); filter: saturate(1.5); }
        }
      `}</style>
      <FadeUp>
        <div className="w-full max-w-[1200px] flex flex-col items-center outline-none">
          <h2 className="text-4xl md:text-6xl font-black italic uppercase tracking-tighter text-white mb-6 text-center drop-shadow-2xl">Upload Photo</h2>

          <button
            type="button"
            onClick={openUploadGuide}
            className="mb-12 inline-flex items-center gap-2 rounded-full border border-cyan-500/35 bg-cyan-500/10 px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300 transition-all hover:border-cyan-400/70 hover:bg-cyan-500/20 hover:text-cyan-100"
          >
            <Eye size={14} />
            View Guide
          </button>

          <div className="mb-10 flex w-full justify-center px-4">
          <button
            type="button"
            disabled={isPremiumDemoModel}
            onClick={() => {
              if (isPremiumDemoModel) return;
              setUseSideProfile((prev) => {
                const next = !prev;
                  if (!next) {
                    setSideImage(null);
                    setSideFile(null);
                  }
                  return next;
                });
              }}
              className={[
                "group flex w-full max-w-md items-center justify-between gap-4 rounded-2xl border px-5 py-4 transition-all duration-300",
                isPremiumDemoModel
                  ? "cursor-not-allowed border-cyan-500/25 bg-cyan-500/[0.06] opacity-70"
                  :
                useSideProfile
                  ? "border-cyan-500/35 bg-cyan-500/10 shadow-[0_0_28px_rgba(34,211,238,0.10)]"
                  : "border-zinc-800 bg-zinc-950/70 hover:border-zinc-700"
              ].join(' ')}
              aria-pressed={useSideProfile}
            >
              <span className="flex min-w-0 flex-col text-left">
                <span className="text-[11px] font-black uppercase tracking-[0.28em] text-zinc-100">
                  Use side profile
                </span>
                <span className="mt-1 text-[10px] font-sans uppercase tracking-[0.22em] text-zinc-500">
                  {isPremiumDemoModel ? "Fixed preview face" : useSideProfile ? "Front + side analysis" : "Front-only scan"}
                </span>
              </span>
              <span
                className={[
                  "relative h-7 w-14 shrink-0 rounded-full border transition-all duration-300",
                  useSideProfile
                    ? "border-cyan-400/40 bg-cyan-400/20"
                    : "border-zinc-700 bg-zinc-900"
                ].join(' ')}
              >
                <span
                  className={[
                    "absolute top-1 h-5 w-5 rounded-full transition-all duration-300",
                    useSideProfile
                      ? "left-8 bg-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.7)]"
                      : "left-1 bg-zinc-500"
                  ].join(' ')}
                />
              </span>
            </button>
          </div>
          
          <div
            className={[
              "grid grid-cols-1 w-full mb-16 px-4 transition-all duration-500",
              isPremiumDemoModel
                ? "max-w-6xl mx-auto"
                : useSideProfile
                ? "md:grid-cols-2 gap-12 md:gap-24"
                : "max-w-sm mx-auto"
            ].join(' ')}
          >
            {isPremiumDemoModel ? (
              <div className="group/demo-picker col-span-full flex w-full flex-col items-center">
                <span className="mb-5 text-lg font-bold uppercase tracking-widest text-cyan-100 drop-shadow-[0_0_16px_rgba(34,211,238,0.24)] md:text-xl">
                  Demo Preview Face
                </span>
                {(() => {
                  const stageFaces = PREMIUM_DEMO_FACES;

                  return (
                    <div className="relative h-[370px] w-full max-w-[620px] overflow-visible sm:h-[395px]">
                      {stageFaces.filter(Boolean).map((face) => {
                        const isSelectedFace = face.id === visiblePremiumDemoFaceId;
                        const isUsedFace = premiumDemoUsedSet.has(face.id);
                        const isDisabledFace = !face.enabled;
                        const slotOffset = isSelectedFace
                          ? 0
                          : visiblePremiumDemoFaceId === 'henry'
                          ? (face.id === 'sean-opry' ? -218 : 218)
                          : visiblePremiumDemoFaceId === 'sean-opry'
                          ? (face.id === 'henry' ? 218 : -218)
                          : face.id === 'henry'
                          ? -218
                          : 218;
                        const slotScale = isSelectedFace ? 1 : 0.45;
                        const selectFace = () => {
                          setSelectedPremiumDemoId(face.id);
                          setFrontImage(face.image || null);
                        };
                        const cardStatus = !face.enabled
                          ? 'Coming Soon'
                          : isSelectedFace
                          ? 'Premium Demo'
                          : isUsedFace && !isAdmin
                          ? 'Preview'
                          : 'Choose';

                        return (
                          <button
                            key={face.id}
                            type="button"
                            onClick={selectFace}
                            className={[
                              "absolute left-1/2 top-1/2 flex w-[286px] flex-col overflow-hidden bg-transparent sm:w-[300px]",
                              "transition-[transform,opacity,filter,box-shadow] duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform",
                              isSelectedFace
                                ? "opacity-100 shadow-[0_0_42px_rgba(34,211,238,0.12)]"
                                : isDisabledFace
                                ? "opacity-35 blur-[1.5px] md:opacity-35 md:group-hover/demo-picker:opacity-45 md:group-focus-within/demo-picker:opacity-45"
                                : "opacity-70 blur-[1.5px] md:opacity-65 md:group-hover/demo-picker:opacity-80 md:group-focus-within/demo-picker:opacity-80",
                              isSelectedFace
                                ? "cursor-default"
                                : "cursor-pointer hover:!opacity-100 hover:!blur-0 hover:drop-shadow-[0_0_24px_rgba(34,211,238,0.22)]",
                              isDisabledFace ? "grayscale" : ""
                            ].join(' ')}
                            style={{
                              transform: `translate(calc(-50% + ${slotOffset}px), -50%) scale(${slotScale})`,
                              zIndex: isSelectedFace ? 20 : 10,
                            }}
                          >
                            <span className={["relative aspect-[3/4] overflow-hidden bg-zinc-950", isSelectedFace ? "rounded-[1.15rem]" : "rounded-[0.95rem]"].join(' ')}>
                              {face.image ? (
                                <img
                                  src={face.image}
                                  alt={`${face.name} demo face`}
                                  className={[
                                    "absolute inset-0 h-full w-full object-cover transition-transform duration-700",
                                    isSelectedFace ? "group-hover/demo-picker:scale-[1.018]" : "opacity-80 hover:scale-105"
                                  ].join(' ')}
                                />
                              ) : (
                                <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-950/70 text-zinc-600">
                                  <Lock size={isSelectedFace ? 22 : 18} />
                                  <span className="text-[8px] font-black uppercase tracking-[0.2em] sm:text-[9px] sm:tracking-[0.24em]">Coming Soon</span>
                                </span>
                              )}
                              <span className={["absolute inset-x-0 bottom-0 bg-gradient-to-t from-black to-transparent text-left", isSelectedFace ? "via-black/45 p-4" : "via-black/55 p-3"].join(' ')}>
                                <span className={["block font-black uppercase text-cyan-200", isSelectedFace ? "text-[10px] tracking-[0.28em]" : "text-[8px] tracking-[0.22em]"].join(' ')}>
                                  {cardStatus}
                                </span>
                                <span className={["mt-1 block font-black italic uppercase tracking-tight text-white", isSelectedFace ? "text-3xl" : "text-sm text-white/90"].join(' ')}>
                                  {face.shortName}
                                </span>
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <FileDropzone
                label="Front Profile"
                file={frontImage}
                setFile={(url, f) => {
                  setFrontImage(url);
                  setFrontFile(f ?? null);
                }}
                isPulsing={shouldUseSideProfile && sideImage && !frontImage}
              />
            )}
            {useSideProfile && (
              <div className="relative">
                <div className={!isUltraModel ? 'blur-[6px] pointer-events-none select-none' : ''}>
                  <FileDropzone label="Side Profile" file={sideImage} setFile={(url, f) => { setSideImage(url); setSideFile(f ?? null); }} isPulsing={shouldUseSideProfile && frontImage && !sideImage} />
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
            )}
          </div>
        </div>
      </FadeUp>

      {/* Dropdown + CTA outside FadeUp: parent transform/opacity was compositing away child motion */}
      <div className="w-full max-w-[1200px] flex flex-col items-center outline-none">
          <div className="w-full max-w-sm mb-12">
            <label className="block text-zinc-500 font-sans text-[10px] uppercase tracking-[0.3em] mb-3 text-center">AI Model Selection</label>
            {shouldShowDemoNudge && (
              <button
                type="button"
                onClick={() => setIsModelMenuOpen(true)}
                className="mb-3 flex w-full items-center justify-between gap-3 rounded-2xl border border-amber-300/35 bg-amber-400/[0.08] px-4 py-3 text-left shadow-[0_0_28px_rgba(251,191,36,0.10)] transition-all hover:border-amber-200/70 hover:bg-amber-400/[0.12]"
              >
                <span className="min-w-0">
                  <span className="block text-[10px] font-black uppercase tracking-[0.28em] text-amber-200">
                    {isAdmin ? 'Admin demo preview' : 'Free plan perk'}
                  </span>
                  <span className="mt-1 block text-xs font-sans leading-relaxed text-amber-100/75">
                    Open this menu and choose Free Demo Scan.
                  </span>
                </span>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-300/35 bg-amber-300/10 text-amber-100">
                  <ChevronRight size={18} className="rotate-90" />
                </span>
              </button>
            )}
            <div ref={modelMenuRef} className="relative">
              {(() => {
                const active = models.find((m) => m.id === selectedModel);
                const ActiveIcon = active?.Icon;
                const isUltra = active?.tier === 'ultra';
                const isDemo = active?.tier === 'demo';
                return (
                  <button
                    type="button"
                    onClick={() => { if (!isLockedToUltra) setIsModelMenuOpen((v) => !v); }}
                    className={[
                      "w-full flex items-center justify-between gap-4 rounded-xl py-4 px-5 text-sm outline-none transition-all",
                      isLockedToUltra ? "cursor-default" : "cursor-pointer",
                      "border bg-zinc-900/50 hover:bg-zinc-900/80 focus:border-zinc-500",
                      isDemo
                        ? "border-cyan-400/45 shadow-[0_0_34px_rgba(34,211,238,0.20)]"
                        : isUltra ? "border-yellow-500/40 shadow-[0_0_28px_rgba(234,179,8,0.14)]" : "border-zinc-800"
                    ].join(' ')}
                    aria-haspopup={isLockedToUltra ? undefined : "listbox"}
                    aria-expanded={isLockedToUltra ? undefined : isModelMenuOpen}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <span
                        className={[
                          "relative inline-flex items-center justify-center w-8 h-8 rounded-lg border shrink-0",
                          isDemo ? "border-cyan-400/35 bg-cyan-400/10" : isUltra ? "border-yellow-500/30 bg-yellow-500/10" : "border-zinc-800 bg-zinc-900/50"
                        ].join(' ')}
                      >
                        {ActiveIcon ? (
                          <ActiveIcon
                            size={16}
                            className={isDemo ? "text-cyan-200 drop-shadow-[0_0_12px_rgba(34,211,238,0.70)]" : isUltra ? "text-yellow-300 drop-shadow-[0_0_10px_rgba(250,204,21,0.35)]" : "text-zinc-300"}
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
                            isDemo
                              ? "text-transparent bg-clip-text bg-gradient-to-r from-cyan-200 via-white to-cyan-300 drop-shadow-[0_0_16px_rgba(34,211,238,0.24)]"
                              : isUltra
                              ? "text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 via-yellow-100 to-amber-300 drop-shadow-[0_0_16px_rgba(250,204,21,0.12)]"
                              : "text-white"
                          ].join(' ')}
                        >
                          {active?.name ?? "Select a model"}
                        </span>
                        <span className="text-[10px] font-sans uppercase tracking-[0.22em] text-zinc-500 truncate">
                          {isDemo ? "Fixed demo scan" : isUltra ? "Premium model" : "Free model"}
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
                      if (m.adminOnly && !isAdmin) return null;

                      const isActive = m.id === selectedModel;
                      const isUltra = m.tier === 'ultra';
                      const isDemo = m.tier === 'demo';
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
                            if (m.id === PREMIUM_DEMO_MODEL_ID) {
                              const nextDemoId = getAvailablePremiumDemoId(premiumDemoUsedIds, selectedPremiumDemoId);
                              setSelectedPremiumDemoId(nextDemoId);
                              setSelectedProfileId(PREMIUM_DEMO_MODEL_ID);
                              setActiveScanProfileId(PREMIUM_DEMO_MODEL_ID);
                            }
                            setSelectedModel(m.id);
                            setIsModelMenuOpen(false);
                          }}
                          className={[
                            "mogcheck-model-option w-full text-left rounded-xl px-3 py-3 flex items-start gap-3 relative group",
                            ultraLocked ? "opacity-50 cursor-pointer" : "",
                            isDemo ? "border border-cyan-400/20 bg-cyan-400/[0.045]" : "",
                            isDemo && shouldDemoGlowFlicker ? "animate-[cyanPreviewFlicker_2.2s_ease-in-out_infinite]" : "",
                            isActive
                              ? "bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
                              : "hover:bg-white/5 hover:shadow-[0_12px_44px_rgba(0,0,0,0.38)]"
                          ].join(' ')}
                        >
                          <span
                            className={[
                              "relative mt-0.5 inline-flex items-center justify-center w-9 h-9 rounded-xl border shrink-0 overflow-hidden",
                              isDemo ? "border-cyan-400/35 bg-cyan-400/10" : isUltra ? "border-yellow-500/30 bg-yellow-500/10" : "border-zinc-800 bg-zinc-900/40"
                            ].join(' ')}
                          >
                            <Icon
                              size={16}
                              className={isDemo ? "text-cyan-200 drop-shadow-[0_0_12px_rgba(34,211,238,0.7)]" : isUltra ? "text-yellow-300 drop-shadow-[0_0_10px_rgba(250,204,21,0.35)]" : "text-zinc-300"}
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
                              {isDemo && shouldShowDemoNudge && (
                                <span className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-300/35 bg-amber-300/10 text-amber-100 sm:inline-flex">
                                  <ChevronRight size={14} />
                                </span>
                              )}
                              <span
                                className={[
                                  "text-[11px] font-black uppercase tracking-widest truncate",
                                  isDemo
                                    ? "text-transparent bg-clip-text bg-gradient-to-r from-cyan-200 via-white to-cyan-300"
                                    : isUltra
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
                              {isDemo && (
                                <span className="text-[9px] font-sans uppercase tracking-[0.3em] text-cyan-200 border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 rounded-full">
                                  Demo
                                </span>
                              )}
                              {!isUltra && !isDemo && (
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

            {user && (isPremiumDemoModel ? (
              <div className="w-full max-w-md mx-auto mb-8 rounded-2xl p-[1px] bg-gradient-to-br from-cyan-300/65 via-cyan-500/35 to-blue-600/45 shadow-[0_0_44px_rgba(34,211,238,0.18)]">
                <div className="rounded-[15px] border border-cyan-300/25 bg-cyan-950/20 p-5 backdrop-blur-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-cyan-100">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-cyan-300/35 bg-cyan-300/10 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.24)]">
                          <Lock size={14} />
                        </span>
                        Demo Scan Profile
                      </h3>
                      <p className="mt-3 text-xs font-sans leading-relaxed text-cyan-100/75">
                        Demo scans use their own locked profile and do not count toward your normal profiles.
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-cyan-300/35 bg-cyan-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">
                      {activePremiumDemoUsedCount}/{activePremiumDemoTotal} locked
                    </span>
                  </div>
                </div>
              </div>
            ) : (
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
                        <option key={p.id} value={p.id} disabled={(profileScanCounts[p.id] || 0) >= PROFILE_SCAN_HISTORY_LIMIT}>
                          {p.name} ({Math.min(profileScanCounts[p.id] || 0, PROFILE_SCAN_HISTORY_LIMIT)}/{PROFILE_SCAN_HISTORY_LIMIT})
                        </option>
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
                  {selectedProfileId !== 'new' && !profilesUnavailable && (
                    <p className={`mt-[-0.5rem] mb-1 text-[10px] font-sans uppercase tracking-[0.18em] ${selectedProfileFull ? 'text-red-400' : 'text-zinc-500'}`}>
                      {Math.min(selectedProfileScanCount, PROFILE_SCAN_HISTORY_LIMIT)}/{PROFILE_SCAN_HISTORY_LIMIT} profile slots used
                    </p>
                  )}
                </div>
              </div>
            ))}

            <button 
              onClick={async () => {
                if (isPremiumDemoModel) {
                  if (!user) {
                    setCurrentPage('login');
                    return;
                  }
                  const requestedDemoId = normalizePremiumDemoId(visiblePremiumDemoFaceId);
                  const requestedDemoFace = getPremiumDemoFace(requestedDemoId);
                  let demoPayload = null;
                  try {
                    const token = await user.getIdToken();
                    const res = await fetch(`${API_BASE}/api/user/demo-scan`, {
                      method: 'POST',
                      headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({ demoId: requestedDemoId }),
                    });
                    const body = await res.json().catch(() => ({}));
                    if (res.status === 409) {
                      const nextUsedIds = Array.isArray(body.premiumDemoUsedIds)
                        ? body.premiumDemoUsedIds
                        : Array.from(new Set([...premiumDemoUsedIds, requestedDemoId]));
                      setPremiumDemoUsedIds(nextUsedIds);
                      const nextAllUsed = ACTIVE_PREMIUM_DEMO_IDS.every((demoId) => nextUsedIds.includes(demoId));
                      setPremiumDemoScanUsed(nextAllUsed);
                      setProfileScanCounts((prev) => ({
                        ...prev,
                        [PREMIUM_DEMO_MODEL_ID]: nextUsedIds.length,
                      }));
                      if (nextAllUsed) {
                        setSelectedModel('3');
                      } else {
                        const nextDemoId = getAvailablePremiumDemoId(nextUsedIds, requestedDemoId);
                        const nextDemoFace = getPremiumDemoFace(nextDemoId);
                        setSelectedPremiumDemoId(nextDemoId);
                        setFrontImage(nextDemoFace?.image || PREMIUM_DEMO_FRONT_IMAGE);
                      }
                      setUploadNotice(body.error || 'You have already used this premium demo scan.');
                      return;
                    }
                    if (!res.ok) throw new Error(body.error || 'Failed to save demo scan.');
                    demoPayload = buildPremiumDemoScanPayload(body.payload || body.scan?.payload || await loadPremiumDemoScanPayload(requestedDemoId), {
                      demoId: requestedDemoId,
                      id: body.scan?.id || `premium-demo-scan-${requestedDemoId}`,
                      scanId: body.scan?.scanId || body.scan?.id || `premium-demo-scan-${requestedDemoId}`,
                      scannedAt: body.scan?.scannedAt || body.scan?.createdAt || new Date().toISOString(),
                    });
                    const nextUsedIds = Array.from(new Set([...premiumDemoUsedIds, requestedDemoId]));
                    setPremiumDemoUsedIds(nextUsedIds);
                    setPremiumDemoScanUsed(ACTIVE_PREMIUM_DEMO_IDS.every((demoId) => nextUsedIds.includes(demoId)));
                    setProfileScanCounts((prev) => ({
                      ...prev,
                      [PREMIUM_DEMO_MODEL_ID]: nextUsedIds.length,
                    }));
                  } catch (e) {
                    setUploadNotice(e.message || 'Failed to save demo scan.');
                    return;
                  }
                  setSelectedProfileId(PREMIUM_DEMO_MODEL_ID);
                  setActiveScanProfileId(PREMIUM_DEMO_MODEL_ID);
                  const queuedJob = queueAnalysisJob?.({
                    analysisLabel: 'Demo Scan',
                    mainImageSrc: requestedDemoFace?.image || PREMIUM_DEMO_FRONT_IMAGE,
                    mainImageFile: null,
                    sideImageUrl: null,
                    sideImageFile: null,
                    sideMetricData: null,
                    choice: PREMIUM_DEMO_MODEL_ID,
                    user,
                    profileId: PREMIUM_DEMO_MODEL_ID,
                    scanRequestId: demoPayload?.scanRequestId || `premium-demo-scan-${requestedDemoId}`,
                    demoPayload,
                  });
                  if (queuedJob) {
                    setActiveAnalysisJob(null);
                    setIsScanning(false);
                    setCurrentPage('analysis');
                  } else {
                    setActiveAnalysisJob({
                      analysisLabel: 'Demo Scan',
                      mainImageSrc: requestedDemoFace?.image || PREMIUM_DEMO_FRONT_IMAGE,
                      mainImageFile: null,
                      sideImageUrl: null,
                      sideImageFile: null,
                      sideMetricData: null,
                      choice: PREMIUM_DEMO_MODEL_ID,
                      user,
                      profileId: PREMIUM_DEMO_MODEL_ID,
                      scanRequestId: demoPayload?.scanRequestId || `premium-demo-scan-${requestedDemoId}`,
                      demoPayload,
                    });
                    setIsScanning(true);
                  }
                  return;
                }
                let actualProfileId = selectedProfileId;
                if (actualProfileId !== 'new' && (profileScanCounts[actualProfileId] || 0) >= PROFILE_SCAN_HISTORY_LIMIT) {
                  setUploadNotice('This profile has reached its 10/10 scan limit. Create a new profile or choose a different one.');
                  return;
                }
                if (selectedProfileId === 'new') {
                  if (!user) {
                    actualProfileId = 'guest';
                  } else if (profilesUnavailable) {
                    actualProfileId = 'default';
                  } else {
                    if (!newProfileName.trim()) {
                      setUploadNotice("Please enter a profile name");
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
                      setUploadNotice(e.message);
                      return;
                    }
                  }
                }
                setSelectedProfileId(actualProfileId);
                setActiveScanProfileId(actualProfileId);
                const queuedJob = queueAnalysisJob?.({
                  analysisLabel:
                    selectedProfileId === 'new'
                      ? (newProfileName.trim() || 'New profile')
                      : (profiles.find((p) => p.id === actualProfileId)?.name || 'Saved profile'),
                  mainImageSrc: frontImage,
                  mainImageFile: frontFile,
                  sideImageUrl: shouldUseSideProfile ? sideImage : null,
                  sideImageFile: shouldUseSideProfile ? sideFile : null,
                  sideMetricData: sideMetricDataGlobal,
                  choice: selectedModel,
                  user,
                  profileId: actualProfileId,
                });
                if (queuedJob) {
                  setActiveAnalysisJob(null);
                  setIsScanning(false);
                  setCurrentPage('analysis');
                }

                setFrontImage(null);
                setFrontFile(null);
                setSideImage(null);
                setSideFile(null);
                setJustUnlocked(false);
                if (selectedProfileId === 'new') {
                  setNewProfileName('');
                }
              }} 
              disabled={missingRequiredImage || scanAccessLocked || selectedProfileFull || selectedPremiumDemoLocked}
              className={`relative overflow-hidden px-20 py-6 bg-white text-black font-black uppercase tracking-widest text-lg md:text-xl flex items-center justify-center gap-5 hover:scale-[1.02] hover:bg-zinc-200 transition-all cursor-pointer rounded-lg disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none ${justUnlocked ? 'animate-[buttonUnlock_1s_ease-out_forwards]' : 'shadow-[0_0_30px_rgba(255,255,255,0.2)]'}`}
            >
            {justUnlocked && <div className="absolute top-0 bottom-0 w-[50%] bg-gradient-to-r from-transparent via-white to-transparent opacity-80 mix-blend-overlay" style={{ animation: 'sweepGlow 1.5s ease-out forwards' }} />}
            <span className="relative z-10">{isPremiumDemoModel ? 'Scan Preview' : 'Analyze Profiles'}</span>
            {justUnlocked ? <Unlock size={28} className="text-black relative z-10" style={{ animation: 'popOpen 0.5s ease-out forwards' }} /> : <ChevronRight size={28} className="text-black relative z-10" />}
          </button>
          {isUploadGuideOpen && (
            <SiteModal
              title="Photo Guide"
              subtitle={`${uploadGuideIndex + 1} / ${UPLOAD_GUIDE_SLIDES.length}`}
              onClose={() => setIsUploadGuideOpen(false)}
              maxWidth="max-w-3xl"
            >
              <div className="space-y-5">
                <div className="relative overflow-hidden rounded-2xl border border-cyan-500/25 bg-black shadow-[0_0_40px_rgba(34,211,238,0.10)]">
                  <img
                    src={UPLOAD_GUIDE_SLIDES[uploadGuideIndex].src}
                    alt={UPLOAD_GUIDE_SLIDES[uploadGuideIndex].alt}
                    className="block max-h-[68vh] w-full object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => setUploadGuideIndex((prev) => (prev + UPLOAD_GUIDE_SLIDES.length - 1) % UPLOAD_GUIDE_SLIDES.length)}
                    className="absolute left-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-cyan-500/35 bg-black/70 text-cyan-200 backdrop-blur-md transition-all hover:border-cyan-300 hover:bg-cyan-500/15 hover:text-white"
                    aria-label="Previous guide image"
                  >
                    <ChevronLeft size={22} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setUploadGuideIndex((prev) => (prev + 1) % UPLOAD_GUIDE_SLIDES.length)}
                    className="absolute right-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-cyan-500/35 bg-black/70 text-cyan-200 backdrop-blur-md transition-all hover:border-cyan-300 hover:bg-cyan-500/15 hover:text-white"
                    aria-label="Next guide image"
                  >
                    <ChevronRight size={22} />
                  </button>
                </div>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex justify-center gap-2">
                    {UPLOAD_GUIDE_SLIDES.map((slide, index) => (
                      <button
                        key={slide.src}
                        type="button"
                        onClick={() => setUploadGuideIndex(index)}
                        className={[
                          "h-2.5 rounded-full transition-all",
                          index === uploadGuideIndex
                            ? "w-9 bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.65)]"
                            : "w-2.5 bg-zinc-700 hover:bg-zinc-500"
                        ].join(' ')}
                        aria-label={`Open guide image ${index + 1}`}
                      />
                    ))}
                  </div>

                  <label className="flex cursor-pointer items-center justify-center gap-3 rounded-full border border-zinc-800 bg-zinc-950/80 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white">
                    <span className="relative inline-flex h-5 w-5 items-center justify-center rounded-md border border-zinc-700 bg-black">
                      <input
                        type="checkbox"
                        checked={dontShowUploadGuideAgain}
                        onChange={(event) => setUploadGuideDismissed(event.target.checked)}
                        className="peer sr-only"
                      />
                      <Check size={14} className="scale-0 text-cyan-300 transition-transform peer-checked:scale-100" />
                    </span>
                    Don't show again
                  </label>
                </div>
              </div>
            </SiteModal>
          )}
          {uploadNotice && (
            <SiteModal title="Scan Notice" onClose={() => setUploadNotice('')} maxWidth="max-w-lg">
              <p className="text-sm leading-relaxed text-zinc-300">{uploadNotice}</p>
            </SiteModal>
          )}
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

  /** Category and overall scores may be stored as 0-100 or 0-10; UI shows 0-10. */
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
  const keyOrder = ['Skin', 'Bone', 'Dimorphism', 'Symmetry', 'Harmony'];
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

const blendNumeric = (primaryValue, secondaryValue, weight = 0.18) => {
  const primary = Number(primaryValue);
  if (Number.isNaN(primary)) return null;
  const secondary = Number(secondaryValue);
  if (Number.isNaN(secondary)) return primary;
  return Math.round((primary * (1 - weight) + secondary * weight) * 10) / 10;
};

const blendRadarSets = (primaryData, secondaryData, weight = 0.18) => {
  if (!Array.isArray(primaryData) || primaryData.length === 0) return primaryData;
  if (!Array.isArray(secondaryData) || secondaryData.length === 0) return primaryData;

  const secondaryByLabel = new Map(
    secondaryData.map((item) => [String(item?.label || '').toLowerCase(), Number(item?.val)])
  );

  return primaryData.map((item) => {
    const secondary = secondaryByLabel.get(String(item?.label || '').toLowerCase());
    const blended = blendNumeric(item?.val, secondary, weight);
    return {
      ...item,
      val: blended == null ? item?.val : blended,
    };
  });
};

// --- Radar Chart Component ---
const RadarChart = ({ data, finalScore, compact = false }) => {
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

  const numPoints = data.length;
  const getPoint = (val, i) => {
    const angle = (Math.PI / 2) + (2 * Math.PI * i / numPoints);
    const x = 50 + val * 35 * Math.cos(angle);
    const y = 50 - val * 35 * Math.sin(angle);
    return { x, y };
  };

  const points = data.map((d, i) => {
    const { x, y } = getPoint((d.val * progress) / 10, i);
    return `${x},${y}`;
  }).join(' ');

  const bgPoints100 = Array.from({ length: numPoints }, (_, i) => {
    const { x, y } = getPoint(1, i);
    return `${x},${y}`;
  }).join(' ');

  const bgPoints50 = Array.from({ length: numPoints }, (_, i) => {
    const { x, y } = getPoint(0.5, i);
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="relative w-full aspect-square">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <polygon points={bgPoints100} fill="rgba(255,255,255,0.05)" stroke="#3f3f46" strokeWidth="0.5" />
        <polygon points={bgPoints50} fill="rgba(255,255,255,0.1)" stroke="#52525b" strokeWidth="0.5" />
        {Array.from({ length: numPoints }).map((_, i) => {
          const { x, y } = getPoint(1, i);
          return <line key={i} x1="50" y1="50" x2={x} y2={y} stroke="#3f3f46" strokeWidth="0.5" />;
        })}
        <polygon points={points} fill={getRatingToneClasses(finalScore).fill || "rgba(34,211,238,0.2)"} stroke={getRatingToneClasses(finalScore).stroke || "#22d3ee"} strokeWidth="1" style={{ filter: `drop-shadow(0 0 4px ${getRatingToneClasses(finalScore).stroke || "rgba(34,211,238,0.8)"})` }} />
        {data.map((d, i) => {
          const { x, y } = getPoint((d.val * progress) / 10, i);
          return <circle key={i} cx={x} cy={y} r="1.2" fill="#fff" className="drop-shadow-[0_0_4px_rgba(255,255,255,1)]" />;
        })}
      </svg>
      {!compact && (
        <div className="absolute inset-0 pointer-events-none">
          {data.map((d, i) => {
            const angle = (Math.PI / 2) + (2 * Math.PI * i / numPoints);
            const x = 50 + 50 * Math.cos(angle);
            const y = 50 - 50 * Math.sin(angle);
            return (
              <span 
                key={i} 
                className={`absolute text-[6.5px] font-black font-sans uppercase tracking-[0.2em] whitespace-nowrap ${getRatingToneClasses(finalScore).text.split(' ')[0]}`}
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  transform: 'translate(-50%, -50%)'
                }}
              >
                {d.label}
              </span>
            );
          })}
        </div>
      )}
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center font-black italic ${getRatingToneClasses(finalScore).text} ${compact ? 'text-sm' : 'text-lg'}`}>
        {scoreToDisplay10(finalScore) != null
          ? (scoreToDisplay10(finalScore) * progress).toFixed(1)
          : (data.reduce((a, b) => a + b.val * progress, 0) / data.length).toFixed(1)}
      </div>
    </div>
  );
};

const HexagonStats = ({ radarData4, radarData5, finalScore }) => {
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <div 
      className="relative w-full h-full flex items-center justify-center p-4"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Radar Chart Layer */}
      <div className={`w-full h-full transition-all duration-500 ${isHovered ? 'opacity-15 blur-lg scale-90' : 'opacity-100 blur-0 scale-100'}`}>
        <RadarChart data={radarData5} finalScore={finalScore} />
      </div>

      {/* Stats Overlay Layer */}
      <div className={`absolute inset-0 flex flex-col justify-center p-6 gap-4 transition-all duration-500 ${isHovered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
        {radarData4.map((item, idx) => (
          <div key={item.label} className="flex flex-col">
            <div className="flex flex-col mb-1.5 px-0.5">
              <span className="text-[7px] font-black uppercase tracking-[0.3em] text-cyan-500/50 mb-0.5">Category</span>
              <div className="flex justify-between items-end">
                <span className="text-[9px] font-black uppercase tracking-[0.15em] text-white/90">{item.label}</span>
                <span className="text-[14px] font-black italic text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]">{item.val.toFixed(1)}</span>
              </div>
            </div>
            <div className="h-1.5 w-full bg-cyan-900/30 rounded-full overflow-hidden">
              <div 
                className="h-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.7)] transition-all duration-700 ease-out" 
                style={{ width: isHovered ? `${(item.val / 10) * 100}%` : '0%' }}
              />
            </div>
          </div>
        ))}
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
  let textColorClass = 'text-rose-400';
  if (percentage >= 70) {
    colorClass = 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-400';
    shadowClass = 'shadow-[0_0_15px_rgba(20,184,166,0.5)]';
    textColorClass = 'text-emerald-400';
  } else if (percentage >= 40) {
    colorClass = 'bg-gradient-to-r from-orange-600 via-orange-500 to-amber-400';
    shadowClass = 'shadow-[0_0_15px_rgba(251,191,36,0.5)]';
    textColorClass = 'text-amber-400';
  }

  return (
    <div className="flex flex-col relative group">
      <div className="flex justify-between items-end gap-3 text-[10px] uppercase font-sans text-zinc-400 mb-1.5">
        <span className="tracking-[0.22em] font-bold leading-tight">{label}</span>
        <span className={`font-black ${textColorClass} text-sm bg-zinc-900/80 px-2.5 py-0.5 rounded-md shadow-sm border border-zinc-800 transition-colors duration-500`}>
          {isFreePlan ? `${Math.round(progress)}/100` : (displayValue ? displayValue : `${progress.toFixed(1)}${max === 100 ? '%' : ''}`)}
        </span>
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

const DashboardOverview = ({ dashboardData, isRestrictedPreview, activeProfileView, showFeatureLists = true }) => {
  const summary =
    dashboardData?.technicalSummary &&
    dashboardData.technicalSummary !== 'Could not generate technical summary.'
      ? dashboardData.technicalSummary
      : 'The subject presents with a heavily midface-dominant structural profile, corroborated by a suboptimal fWHR...';

  const isSide = activeProfileView === 'side';
  const displayFlaws = useMemo(
    () => {
      const features = resolveNormalizedFeatures(dashboardData, 'flaw', isSide);
      return isRestrictedPreview ? features.slice(0, 1) : features;
    },
    [dashboardData, isRestrictedPreview, isSide]
  );
  const displayFeatures = useMemo(
    () => {
      const features = resolveNormalizedFeatures(dashboardData, 'best', isSide);
      return isRestrictedPreview ? features.slice(0, 1) : features;
    },
    [dashboardData, isRestrictedPreview, isSide]
  );
  const shouldExpand = isRestrictedPreview || !showFeatureLists || (displayFlaws.length > 0 || displayFeatures.length > 0);
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

        {showFeatureLists && (
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
            <h4 className="text-red-400 font-bold uppercase tracking-widest text-xs mb-2">{isRestrictedPreview ? 'PRIMARY FLAW' : 'PRIMARY FLAWS'}</h4>
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
            <h4 className="text-green-400 font-bold uppercase tracking-widest text-xs mb-2">{isRestrictedPreview ? 'BEST FEATURE' : 'BEST FEATURES'}</h4>
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
        )}
        
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

const HoloCube = ({ data }) => {
  const [rot, setRot] = useState({ x: -10, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e) => {
    setIsDragging(true);
    lastMouse.current = { x: e.clientX, y: e.clientY };
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - lastMouse.current.x;
      const deltaY = e.clientY - lastMouse.current.y;
      setRot(prev => ({ 
        x: Math.max(-60, Math.min(60, prev.x - deltaY * 0.5)), 
        y: prev.y + deltaX * 0.5 
      }));
      lastMouse.current = { x: e.clientX, y: e.clientY };
    };
    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div 
      className={`relative w-full h-full flex items-center justify-center [perspective:1000px] select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      onMouseDown={handleMouseDown}
    >
      <div 
        className="relative w-36 h-36 [transform-style:preserve-3d] transition-transform duration-150 ease-out"
        style={{ transform: `rotateX(${rot.x}deg) rotateY(${rot.y}deg)` }}
      >
        {[0, 90, 180, 270].map((ry, idx) => {
          const item = data[idx];
          const faceAngle = (ry + rot.y) % 360;
          const normalized = ((faceAngle + 180) % 360 + 360) % 360 - 180;
          const cos = Math.cos(normalized * (Math.PI / 180));
          const opacity = Math.max(0.05, cos); 

          return (
            <div 
              key={item.label} 
              className="absolute inset-0 bg-cyan-500/[0.04] backdrop-blur-[1px] border border-cyan-400/30 shadow-[0_0_15px_rgba(34,211,238,0.1)] flex flex-col items-center justify-center p-4 transition-opacity duration-300"
              style={{ 
                transform: `rotateY(${ry}deg) translateZ(72px)`,
                backgroundImage: 'linear-gradient(rgba(34,211,238,0.05) 1px, transparent 1px)',
                backgroundSize: '100% 4px',
                opacity: opacity
              }}
            >
              <div 
                className="w-full flex flex-col items-center justify-center transition-transform duration-150 ease-out"
                style={{ transform: `rotateY(${-rot.y - ry}deg) rotateX(${-rot.x}deg)` }}
              >
                <p className="text-[6px] font-black uppercase tracking-[0.3em] text-cyan-400/50 mb-1">Live Telemetry</p>
                <h4 className="text-[10px] font-black uppercase tracking-widest text-white/90 mb-2 text-center">{item.label}</h4>
                
                <div className="relative w-full px-1">
                  <div className="flex justify-between items-end mb-1">
                    <span className="text-[14px] font-black italic text-cyan-400 drop-shadow-[0_0_5px_rgba(34,211,238,0.4)]">
                      {item.val.toFixed(1)}
                    </span>
                  </div>
                  <div className="h-[2px] w-full bg-cyan-900/20 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]"
                      style={{ width: `${(item.val / 10) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div className="absolute inset-0 bg-cyan-500/[0.02] border border-cyan-500/10 [transform:rotateX(90deg)_translateZ(72px)] opacity-20" />
        <div className="absolute inset-0 bg-cyan-500/[0.02] border border-cyan-500/10 [transform:rotateX(-90deg)_translateZ(72px)] opacity-20" />
      </div>
    </div>
  );
};

const FeatureHighlightCard = ({ type, feature, onHover }) => {
  const isBest = type === 'best';
  if (!feature) return null;
  const cardClass = isBest
    ? 'p-7 bg-green-900/10 border border-green-500/20 rounded-2xl relative overflow-hidden shadow-[0_0_30px_rgba(34,197,94,0.05)] cursor-default transition-all duration-300 hover:scale-[1.02]'
    : 'p-7 bg-red-900/10 border border-red-500/20 rounded-2xl relative overflow-hidden shadow-[0_0_30px_rgba(239,68,68,0.05)] cursor-default transition-all duration-300 hover:scale-[1.02]';
  const railClass = isBest
    ? 'absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-green-400 to-green-600'
    : 'absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-red-400 to-red-600';
  const labelClass = isBest
    ? 'text-green-500/50 text-[11px] uppercase font-black tracking-widest mb-1.5 block'
    : 'text-red-500/50 text-[11px] uppercase font-black tracking-widest mb-1.5 block';
  const titleClass = isBest
    ? 'text-green-400 font-bold uppercase text-lg tracking-widest mb-2.5'
    : 'text-red-400 font-bold uppercase text-lg tracking-widest mb-2.5';
  return (
    <div className={cardClass}>
      <div className={railClass} />
      <span className={labelClass}>{isBest ? 'Best Feature' : 'Primary Flaw'}</span>
      <h4 className={titleClass}>{stripInlineMarkers(feature.title)}</h4>
      <p className="text-zinc-300 text-[14px] font-sans leading-relaxed">{renderMarkedText(feature.description)}</p>
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

const StructureMap = ({ activeImageUrl, bestFeature, primaryFlaw, activeHover, onImageClick, showAnchors = false, anchorImageUrl = null }) => {
  const [landmarker, setLandmarker] = useState(null);
  const [landmarks, setLandmarks] = useState(null);
  const imgRef = useRef(null);

  const detectCurrentImage = useCallback(() => {
    if (!landmarker || !imgRef.current || !imgRef.current.complete || imgRef.current.naturalWidth === 0) {
      return;
    }
    try {
      const result = landmarker.detect(imgRef.current);
      if (result.faceLandmarks && result.faceLandmarks.length > 0) {
        setLandmarks(result.faceLandmarks[0]);
      }
    } catch (e) {
      console.error("Error during structure map detection:", e);
    }
  }, [landmarker]);

  useEffect(() => {
    let active = true;
    const initializeLandmarker = async () => {
      try {
        const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
        if (!active) return;
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
        if (active) setLandmarker(faceLandmarker);
      } catch (error) {
        console.error("Error initializing landmarker:", error);
      }
    };
    initializeLandmarker();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setLandmarks(null);
    detectCurrentImage();
  }, [detectCurrentImage, activeImageUrl]);

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
    <button
      type="button"
      onClick={() => onImageClick?.(activeImageUrl)}
      className="relative w-72 sm:w-72 md:w-[21rem] aspect-[3/4] shrink-0 bg-[#060708] rounded-2xl overflow-hidden shadow-2xl border border-zinc-800 mx-auto text-left transition-colors hover:border-cyan-500/40 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
    >
      <img 
        ref={imgRef}
        src={activeImageUrl} 
        loading="eager"
        decoding="async"
        onLoad={detectCurrentImage}
        className={`absolute inset-0 w-full h-full object-cover object-center scale-[1.14] transition-all duration-700 ${showAnchors && anchorImageUrl ? 'opacity-30 grayscale brightness-50' : 'opacity-100'}`}
        alt="face map"
      />
      {showAnchors && anchorImageUrl && (
        <img 
          src={anchorImageUrl} 
          loading="eager"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover object-center scale-[1.14] z-10 mix-blend-screen opacity-100"
          alt="anchors overlay"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0b] via-[#0a0a0b]/20 to-transparent z-20 pointer-events-none" />
    </button>
  );
};

const DashboardPage = ({ dashboardData, setDashboardData = null, setCurrentPage, onOpenPremiumPlans = null, userPlan, user, hideTopSection, hideProtocols, hideActionableProtocols, isEmbedded, hideUnlockPotential, hideBestFlawSection, hidePersonalizedFeedback, forceFullAnalysis = false, onBackToProfiles = null, onOpenHistoryScan = null }) => {
  dashboardData = useMemo(() => normalizeDashboardMedia(dashboardData), [dashboardData]);
  const selectedModel = String(dashboardData?.selectedModel || '').trim();
  const isPremiumDemoScan = Boolean(dashboardData?.isPremiumDemo || dashboardData?.demoScan || selectedModel === PREMIUM_DEMO_MODEL_ID);
  const isFreeModelResult = !forceFullAnalysis && ['3', '4', '5'].includes(selectedModel);
  const hasFullProUnlock = isProPlan(userPlan);
  const isRestrictedPreview = !forceFullAnalysis && isFreeModelResult;
  const showBestFlaw = !hideBestFlawSection;
  const isAdmin = Boolean(user?.email && (
    user.email === 'laithbu07@gmail.com' ||
    user.email === 'admin@looksmaxxing.com' ||
    user.email === 'serenity.eyb@gmail.com' ||
    user.email.endsWith('@looksmaxxing.com')
  ));

  const getCommunityScanShareUrl = useCallback((scan) => {
    const ownerUid = String(scan?.ownerUid || scan?.uid || '').trim();
    const scanId = String(scan?.scanId || scan?.id || '').trim();
    if (ownerUid && scanId && !scan?.officialScan) {
      return `${window.location.origin}/scan/${encodeURIComponent(ownerUid)}/${encodeURIComponent(scanId)}`;
    }
    return `${window.location.origin}/celebrity?scan=${encodeURIComponent(scanId || scan?.id || '')}`;
  }, []);

  const shareCommunityScan = useCallback(async (scan) => {
    const url = getCommunityScanShareUrl(scan);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCommunityNotice('Scan link copied.');
      } else {
        setCommunityNotice(url);
      }
    } catch {
      setCommunityNotice(url);
    }
  }, [getCommunityScanShareUrl]);

  const renderBlurredOverlay = (title, compact = false) => (
    <div className={`absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0a0a0b]/60 backdrop-blur-[5.55px] rounded-3xl border border-zinc-800/50 group transition-all select-none ${compact ? 'py-3' : ''}`}>
      <Lock size={compact ? 14 : 32} className={`text-yellow-500 drop-shadow-[0_0_15px_rgba(234,179,8,0.5)] ${compact ? 'mb-2' : 'mb-3'}`} />
      <span className={`text-white font-black italic uppercase tracking-widest mb-1 drop-shadow-md ${compact ? 'text-base' : 'text-lg'}`}>PRO FEATURE</span>
      <span className={`text-zinc-300 font-sans text-[10px] uppercase tracking-widest text-center px-4 max-w-[min(100%,280px)] leading-relaxed ${compact ? 'mb-4' : 'mb-6'}`}>{title} requires a premium model</span>
      <button 
        onClick={() => {
          if (onOpenPremiumPlans) onOpenPremiumPlans();
          else setCurrentPage('plans');
        }}
        className={`bg-gradient-to-r from-yellow-600 to-yellow-500 text-black font-bold uppercase tracking-widest rounded-full hover:scale-105 transition-transform shadow-[0_0_15px_rgba(234,179,8,0.4)] ${compact ? 'px-5 py-1.5 text-[10px]' : 'px-6 py-2 text-xs'}`}
      >
        Upgrade to Pro
      </button>
    </div>
  );

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [potentialImageUrl, setPotentialImageUrl] = useState(null);
  const [unlockError, setUnlockError] = useState(null);
  const [potentialLightboxOpen, setPotentialLightboxOpen] = useState(false);
  const [communityPeek, setCommunityPeek] = useState(null);
  const [showAllProtocols, setShowAllProtocols] = useState(false);
  const [completedProtocolIds, setCompletedProtocolIds] = useState({});
  const [scanLightbox, setScanLightbox] = useState(null);
  const freeHistoryStripRef = useRef(null);
  const startedDetailedReportsRef = useRef(new Set());

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
      data: forceCommunityScanFrontOnly({
        ...hydrated.dashboardData,
        selectedModel: String(hydrated.dashboardData?.selectedModel || '1'),
      }),
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
        if (data.fallback) {
          setUnlockError('Potential renderer unavailable. Showing original image for now.');
        }
      } else {
        setUnlockError(data?.error || GENERIC_ERROR);
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
  const [experimentalCohesiveEnabled, setExperimentalCohesiveEnabled] = useState(Boolean(dashboardData?.cohesiveFrontSide));

  useEffect(() => {
    setExperimentalCohesiveEnabled(Boolean(dashboardData?.cohesiveFrontSide));
  }, [dashboardData?.scanId, dashboardData?.cohesiveFrontSide]);

  const placeholderProfileImage = "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png";
  const hasUsableImage = (src) => Boolean(
    typeof src === 'string' &&
    src.trim() &&
    !src.includes('Portrait_Placeholder')
  );
  const hasSideProfileImage = hasUsableImage(dashboardData?.sideImage);
  const hasFrontProfileImage = hasUsableImage(dashboardData?.frontImage);
  const effectiveProfileView = activeProfileView === 'side' && hasSideProfileImage ? 'side' : 'front';
  const isSideView = effectiveProfileView === 'side';
  const hasBothProfileViews = hasFrontProfileImage && hasSideProfileImage;
  const effectiveCohesiveEnabled = hasBothProfileViews && experimentalCohesiveEnabled;

  useEffect(() => {
    if (!hasSideProfileImage && activeProfileView === 'side') {
      setActiveProfileView('front');
    }
  }, [activeProfileView, hasSideProfileImage]);

  const activeCats = isSideView && dashboardData?.sideCategories
    ? dashboardData.sideCategories
    : dashboardData?.categories;
  const oppositeCats = !isSideView && dashboardData?.sideCategories
    ? dashboardData.sideCategories
    : (isSideView ? dashboardData?.categories : null);

  const defaultRadar = [
    { label: 'Skin', val: 6.4 },
    { label: 'Bone', val: 7.2 },
    { label: 'Dimorphism', val: 7.8 },
    { label: 'Symmetry', val: 9.2 },
    { label: 'Harmony', val: 8.5 }
  ];

  const frForRadar = isSideView
    ? (dashboardData?.sideRating ?? dashboardData?.finalRating)
    : dashboardData?.finalRating;
  const oppositeRawRating = isSideView
    ? (dashboardData?.finalRating ?? dashboardData?.sideRating)
    : (dashboardData?.sideRating ?? dashboardData?.finalRating);
  const activeHexagon = isSideView ? dashboardData?.hexagonSide : dashboardData?.hexagonFront;
  const oppositeHexagon = !isSideView ? dashboardData?.hexagonSide : dashboardData?.hexagonFront;
  const primaryRadarData =
    hexagonToRadarData(activeHexagon, frForRadar) ||
    (activeCats
      ? [
          { label: 'Skin', val: categoryToRadar10(activeCats.Skin, frForRadar) },
          { label: 'Bone', val: categoryToRadar10(activeCats.Bone, frForRadar) },
          { label: 'Dimorphism', val: categoryToRadar10(activeCats.Dimorphism, frForRadar) },
          { label: 'Symmetry', val: categoryToRadar10(activeCats.Symmetry, frForRadar) },
          { label: 'Harmony', val: categoryToRadar10(activeCats.Harmony, frForRadar) },
        ]
      : defaultRadar);
  const secondaryRadarData =
    hexagonToRadarData(oppositeHexagon, oppositeRawRating) ||
    (oppositeCats
      ? [
          { label: 'Skin', val: categoryToRadar10(oppositeCats.Skin, oppositeRawRating) },
          { label: 'Bone', val: categoryToRadar10(oppositeCats.Bone, oppositeRawRating) },
          { label: 'Dimorphism', val: categoryToRadar10(oppositeCats.Dimorphism, oppositeRawRating) },
          { label: 'Symmetry', val: categoryToRadar10(oppositeCats.Symmetry, oppositeRawRating) },
          { label: 'Harmony', val: categoryToRadar10(oppositeCats.Harmony, oppositeRawRating) },
        ]
      : null);
  const radarData = effectiveCohesiveEnabled
    ? blendRadarSets(primaryRadarData, secondaryRadarData, 0.18)
    : primaryRadarData;

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

  const normalizeMetricLabelForMatching = (value) =>
    String(value || '')
      .toLowerCase()
      .replace(/[_/()\-]+/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const compactMetricLabelForMatching = (value) =>
    normalizeMetricLabelForMatching(value).replace(/\s+/g, '');
  const FRONTAL_KEYWORDS = [
    'bigonial', 'jaw', 'chin', 'mandibular',
    'ipd', 'eye spacing', 'eye height', 'eye shape', 'eye area', 'eyelid exposure',
    'mouth', 'nose width', 'nose length', 'nose projection',
    'upper third', 'middle third', 'lower third', 'facial thirds',
    'brow compactness', 'philtrum', 'lip height', 'total lip height',
    'fwhr', 'midface', 'canthal',
    'skin texture', 'skin clarity', 'facial fat', 'soft tissue', 'symmetry',
    'cheekbone', 'maxillary'
  ];
  const FRONTAL_KEYWORD_MATCHERS = FRONTAL_KEYWORDS.map((keyword) => ({
    normal: normalizeMetricLabelForMatching(keyword),
    compact: compactMetricLabelForMatching(keyword),
  }));
  const isFrontalMetric = (label) => {
    const normal = normalizeMetricLabelForMatching(label);
    const compact = compactMetricLabelForMatching(label);
    return FRONTAL_KEYWORD_MATCHERS.some(({ normal: keyword, compact: compactKeyword }) =>
      (keyword && normal.includes(keyword)) ||
      (compactKeyword && compact.includes(compactKeyword))
    );
  };
  const frontalBiometrics = dashboardData?.biometrics?.length
    ? dashboardData.biometrics.filter(m => isFrontalMetric(m.label))
    : [];
  const metricData = isSideView
    ? (dashboardData?.sideBiometrics?.length ? dashboardData.sideBiometrics : sideMetricDataGlobal)
    : (frontalBiometrics.length ? frontalBiometrics : frontMetricData);

  const activeImageUrl = effectiveProfileView === 'front'
    ? (dashboardData?.frontImage || placeholderProfileImage)
    : (dashboardData?.sideImage || dashboardData?.frontImage || placeholderProfileImage);
  const rawMaxNaturalPotential = dashboardData?.maxNaturalPotential;
  const rawMaxPotentialWithSurgery = dashboardData?.maxPotentialWithSurgery;
  const maxNaturalPotential = rawMaxNaturalPotential == null || rawMaxNaturalPotential === ''
    ? NaN
    : Number(rawMaxNaturalPotential);
  const maxPotentialWithSurgery = rawMaxPotentialWithSurgery == null || rawMaxPotentialWithSurgery === ''
    ? NaN
    : Number(rawMaxPotentialWithSurgery);
  const hasPotentialRatings =
    Number.isFinite(maxNaturalPotential) || Number.isFinite(maxPotentialWithSurgery);
  const formatPotentialScore = (value) =>
    Number.isFinite(value) ? `${Math.round(value * 10) / 10}/100` : 'Pending';

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
  const debugJustification = String(dashboardData?.debugJustification || dashboardData?.payload?.debugJustification || '').trim();
  const debugAnchorsImage =
    dashboardData?.debugAnchorsImage ||
    dashboardData?.debugAnchorsImageUrl ||
    dashboardData?.payload?.debugAnchorsImage ||
    dashboardData?.payload?.debugAnchorsImageUrl ||
    null;
  const authenticityFlag = getAuthenticityFlag(dashboardData);
  const uncannyFlag = getUncannyFlag(dashboardData);
  const showUncannyFlagUnderScore = Boolean(
    uncannyFlag &&
    !/\b(?:synthetic|non[-\s]?human|ai[-\s]?generated|score capped)\b/i.test(authenticityFlag)
  );
  const personalizedFeedback = Array.isArray(dashboardData?.personalizedFeedback)
    ? dashboardData.personalizedFeedback.filter((item) => item && (item.title || item.description))
    : [];
  const detailedReportStatus = String(dashboardData?.reportStatus || dashboardData?.payload?.reportStatus || '').toLowerCase();
  const isDetailedReportGenerating = detailedReportStatus === 'generating';
  const hasDetailedReportFailed = detailedReportStatus === 'failed';
  const detailedReportError = String(dashboardData?.reportError || dashboardData?.payload?.reportError || '').trim();
  const detailedReportScanRequestId = String(dashboardData?.scanRequestId || dashboardData?.payload?.scanRequestId || '').trim();
  const detailedReportStartedMs = Date.parse(dashboardData?.reportStartedAt || dashboardData?.payload?.reportStartedAt || '');

  const [activeHover, setActiveHover] = useState(null);
  const [showAnchorOverlay, setShowAnchorOverlay] = useState(false);
  const [reportNowMs, setReportNowMs] = useState(Date.now());
  const [reportRetrying, setReportRetrying] = useState(false);
  const [reportRetryError, setReportRetryError] = useState('');

  useEffect(() => {
    if (!isDetailedReportGenerating) return;
    const interval = setInterval(() => setReportNowMs(Date.now()), 5000);
    return () => clearInterval(interval);
  }, [isDetailedReportGenerating]);

  const detailedReportHasWaitedTooLong =
    isDetailedReportGenerating &&
    Number.isFinite(detailedReportStartedMs) &&
    reportNowMs - detailedReportStartedMs >= 120000;
  const canRetryDetailedReport =
    !isRestrictedPreview &&
    !isFreeModelResult &&
    Boolean(user && setDashboardData && detailedReportScanRequestId) &&
    (hasDetailedReportFailed || detailedReportHasWaitedTooLong);

  useEffect(() => {
    if (
      isRestrictedPreview ||
      isFreeModelResult ||
      !user ||
      !setDashboardData ||
      detailedReportStatus !== 'generating' ||
      !detailedReportScanRequestId
    ) {
      return undefined;
    }

    const reportAttemptId = String(
      dashboardData?.reportAttemptId ||
      dashboardData?.payload?.reportAttemptId ||
      'initial'
    ).trim();
    const startKey = `${detailedReportScanRequestId}:${reportAttemptId || 'initial'}`;
    if (startedDetailedReportsRef.current.has(startKey)) return undefined;
    startedDetailedReportsRef.current.add(startKey);

    let cancelled = false;
    const startDetailedReport = async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`${API_BASE}/api/analyze/report/start/${encodeURIComponent(detailedReportScanRequestId)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Detailed report start failed (${res.status})`);
        const nextPayload = body.payload || null;
        if (!cancelled && nextPayload) {
          setDashboardData((prev) => normalizeDashboardMedia({
            ...(prev || {}),
            ...nextPayload,
            scanHistory: Array.isArray(prev?.scanHistory) ? prev.scanHistory : nextPayload.scanHistory,
            ratingHistory: Array.isArray(prev?.ratingHistory) ? prev.ratingHistory : nextPayload.ratingHistory,
          }));
        }
      } catch (error) {
        console.warn('Detailed report start failed', error);
        if (!cancelled) {
          setDashboardData((prev) => prev
            ? normalizeDashboardMedia({
                ...prev,
                reportStatus: 'failed',
                reportError: error?.message || 'Could not start the detailed report.',
              })
            : prev);
        }
      }
    };

    startDetailedReport();
    return () => {
      cancelled = true;
    };
  }, [
    dashboardData?.payload?.reportAttemptId,
    dashboardData?.reportAttemptId,
    detailedReportScanRequestId,
    detailedReportStatus,
    isFreeModelResult,
    isRestrictedPreview,
    setDashboardData,
    user,
  ]);

  const retryDetailedReport = useCallback(async () => {
    if (!canRetryDetailedReport || reportRetrying) return;
    setReportRetrying(true);
    setReportRetryError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/analyze/report/retry/${encodeURIComponent(detailedReportScanRequestId)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Report retry failed (${res.status})`);
      const nextPayload = body.payload || null;
      if (nextPayload) {
        setDashboardData((prev) => normalizeDashboardMedia({
          ...(prev || {}),
          ...nextPayload,
          scanHistory: Array.isArray(prev?.scanHistory) ? prev.scanHistory : nextPayload.scanHistory,
          ratingHistory: Array.isArray(prev?.ratingHistory) ? prev.ratingHistory : nextPayload.ratingHistory,
        }));
      }
    } catch (error) {
      setReportRetryError(error?.message || 'Could not retry the detailed report.');
    } finally {
      setReportRetrying(false);
    }
  }, [canRetryDetailedReport, detailedReportScanRequestId, reportRetrying, setDashboardData, user]);

  const detailedReportRetryButton = canRetryDetailedReport ? (
    <div className="mt-5 flex flex-col items-center gap-2 text-center">
      <button
        type="button"
        onClick={retryDetailedReport}
        disabled={reportRetrying}
        className="inline-flex items-center gap-2 rounded-full border border-amber-400/35 bg-amber-400/10 px-5 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200 transition-colors hover:border-amber-300/60 hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {reportRetrying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        Retry Detailed Report
      </button>
      <p className="max-w-xl text-[10px] font-sans uppercase tracking-widest text-zinc-600">
        Reruns only protocols and feedback. Your score is already saved.
      </p>
      {reportRetryError && (
        <p className="max-w-xl text-xs font-sans text-amber-300/80">{reportRetryError}</p>
      )}
    </div>
  ) : null;

  useEffect(() => {
    if (!isRestrictedPreview) return;
    const interval = setInterval(() => {
      setFreeRatingLoop(Math.floor(70 + Math.random() * 30));
    }, 120);
    return () => clearInterval(interval);
  }, [isRestrictedPreview]);

  const baseDisplayedFinalRating = isSideView
    ? (dashboardData?.sideRating ?? dashboardData?.finalRating ?? null)
    : (dashboardData?.finalRating ?? null);
  const numericDisplayedFinalRating = effectiveCohesiveEnabled
    ? blendNumeric(baseDisplayedFinalRating, oppositeRawRating, 0.18)
    : baseDisplayedFinalRating;
  const displayedFinalRating = isFreeModelResult
    ? freeRatingLoop
    : (numericDisplayedFinalRating ?? 85);
  const ratingTone = getRatingToneClasses(displayedFinalRating);
  const openAnimationsViewer = useCallback(() => {
    if (typeof window === 'undefined') return;
    const animationId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `animation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const payload = {
      id: animationId,
      createdAt: new Date().toISOString(),
      profileView: effectiveProfileView,
      imageUrl: activeImageUrl,
      finalRating: numericDisplayedFinalRating ?? dashboardData?.finalRating ?? null,
      metrics: metricData,
      bestFeatures: activeBestFeatures.slice(0, 5),
      primaryFlaws: activePrimaryFlaws.slice(0, 5),
    };
    try {
      const store = JSON.parse(window.sessionStorage.getItem(ANIMATION_LINK_STORAGE_KEY) || '{}');
      store[animationId] = payload;
      const keys = Object.keys(store);
      if (keys.length > 12) {
        keys.slice(0, keys.length - 12).forEach((key) => delete store[key]);
      }
      window.sessionStorage.setItem(ANIMATION_LINK_STORAGE_KEY, JSON.stringify(store));
    } catch (error) {
      console.error('Failed to create animation link', error);
      return;
    }
    setCurrentPage('animations', `/animations/${animationId}`);
  }, [activeBestFeatures, activeImageUrl, activePrimaryFlaws, dashboardData?.finalRating, effectiveProfileView, metricData, numericDisplayedFinalRating, setCurrentPage]);
  const cohesiveExperimentToggle = hasBothProfileViews && !isFreeModelResult ? (
    <button
      type="button"
      onClick={() => setExperimentalCohesiveEnabled((prev) => !prev)}
      className={`mb-4 inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] transition-colors ${
        effectiveCohesiveEnabled
          ? 'border-amber-400/35 bg-amber-400/10 text-amber-300'
          : 'border-zinc-700 bg-zinc-900/80 text-zinc-400 hover:border-amber-400/25 hover:text-amber-300'
      }`}
      title="Experimental: let front and side influence each other slightly instead of staying fully separate."
    >
      <Sparkles size={12} />
      {effectiveCohesiveEnabled ? 'Experimental cohesive on' : 'Experimental cohesive off'}
    </button>
  ) : null;
  const radarFinalScore = Number(numericDisplayedFinalRating ?? dashboardData?.finalRating ?? 0) || 0;
  const freeHistoryCards = useMemo(() => {
    const items = Array.isArray(dashboardData?.scanHistory) ? [...dashboardData.scanHistory] : [];
    const currentSnapshot = dashboardData?.frontImage || dashboardData?.finalRating != null
      ? {
          ...dashboardData,
          scannedAt: dashboardData?.scannedAt || new Date().toISOString(),
        }
      : null;

    if (currentSnapshot) {
      const alreadyPresent = items.some((item) => scansLookSame(item, currentSnapshot));
      if (!alreadyPresent) items.push(currentSnapshot);
    }

    return items
      .filter((item) => item && (item.frontImage || item.finalRating != null))
      .slice(-PROFILE_SCAN_HISTORY_LIMIT)
      .reverse();
  }, [dashboardData]);

  const scrollFreeHistoryStrip = (direction) => {
    const el = freeHistoryStripRef.current;
    if (!el) return;
    const amount = Math.max(240, el.clientWidth * 0.75);
    el.scrollBy({ left: direction * amount, behavior: 'smooth' });
  };
  const isFreeHistoryScan = (scan) => ['3', '4', '5'].includes(String(scan?.selectedModel || scan?.model || scan?.payload?.selectedModel || '').trim());

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
                Community scan{communityPeek?.tier ? ` - ${communityPeek.tier}` : ''}
              </p>
              <h2 id="free-community-scan-title" className="truncate font-black uppercase italic tracking-tight text-white">
                Community Scan
              </h2>
            </div>
          </header>
          <div className="flex-1 px-4 pb-16 pt-6 md:px-8">
            <button
              type="button"
              onClick={() => setCommunityPeek(null)}
              className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/[0.07] px-4 py-2 font-sans text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100 transition-colors hover:border-cyan-300/60 hover:bg-cyan-400/10"
            >
              <ArrowLeft size={14} />
              Go to previous page
            </button>
            <DashboardPage
              dashboardData={forceCommunityScanFrontOnly(communityPeek.data)}
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
          0%, 100% { opacity: 0.92; filter: blur(9.25px); }
          25% { opacity: 0.82; filter: blur(7.4px); }
          50% { opacity: 1; filter: blur(11.1px); }
          75% { opacity: 0.88; filter: blur(8.325px); }
        }
      `}</style>
      <FadeUp>
        <div className={`w-full mx-auto flex flex-col gap-12 ${isEmbedded ? 'max-w-5xl' : 'max-w-6xl'}`}>
          <div className="hidden flex-wrap items-center gap-2 md:flex">
            <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-300">
              AI used: {getAnalysisModelLabel(selectedModel || dashboardData?.model)}
            </span>
            {isPremiumDemoScan && (
              <span className="rounded-full border border-cyan-400/35 bg-cyan-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.12)]">
                Demo Scan
              </span>
            )}
            {isDetailedReportGenerating && (
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-amber-300">
                <Loader2 size={12} className="animate-spin" />
                Detailed report loading
              </span>
            )}
            {(dashboardData?.cohesiveFrontSide || effectiveCohesiveEnabled) && (
              <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-300">
                Cohesive side/front enabled
              </span>
            )}
          </div>

          {/* Mobile Scan History Strip (Free) */}
          {!isEmbedded && isFreeModelResult && freeHistoryCards.length > 1 && (
            <div className="mb-4 md:hidden">
              <div className="flex items-center justify-between mb-3 px-1">
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Scan History</p>
                <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">{freeHistoryCards.length} scans</span>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-4 -mx-6 px-6 custom-scrollbar scroll-smooth">
                {freeHistoryCards.map((scan, idx) => {
                  const isActive = scan?.frontImage === dashboardData?.frontImage && scan?.finalRating === dashboardData?.finalRating;
                  const rating = Number(scan.finalRating || 0);
                  const tone = getRatingToneClasses(rating);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onOpenHistoryScan?.({
                        ...scan,
                        scanHistory: freeHistoryCards.slice().reverse(),
                        ratingHistory: freeHistoryCards
                          .slice()
                          .reverse()
                          .map((item) => Number(item?.finalRating))
                          .filter((rating) => Number.isFinite(rating)),
                      })}
                      className={`relative flex-shrink-0 w-24 aspect-[4/5] rounded-2xl overflow-hidden border transition-all duration-300 ${isActive ? 'border-cyan-400 ring-4 ring-cyan-400/15 scale-[1.05] z-10' : 'border-zinc-800 opacity-60 hover:opacity-100'}`}
                    >
                      <img loading="lazy" decoding="async" src={scan.frontImage} className="w-full h-full object-cover" alt="" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                      <div className={`absolute bottom-2 left-0 right-0 text-center text-xs font-black italic ${tone.text}`}>
                        {rating.toFixed(1)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {(isRestrictedPreview || !isFreeModelResult) && (
            <div className="space-y-4 md:hidden">
              <div className="grid grid-cols-[1.15fr_0.85fr] gap-3">
                <button
                  type="button"
                  onClick={() => setScanLightbox({ src: activeImageUrl, subtitle: `${effectiveProfileView === 'side' ? 'Side' : 'Front'} profile` })}
                  className="relative aspect-square overflow-hidden rounded-[28px] border border-zinc-800 bg-zinc-950 text-left shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
                >
                  <img
                    loading="lazy"
                    decoding="async"
                    src={activeImageUrl}
                    alt={`${effectiveProfileView === 'side' ? 'Side' : 'Front'} profile`}
                    className="h-full w-full object-cover"
                    style={{ objectPosition: effectiveProfileView === 'side' ? 'center top' : 'center' }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
                </button>
                <div className="grid gap-3">
                  <div className="flex min-h-[7.25rem] flex-col items-center justify-center rounded-[26px] border border-zinc-900 bg-[#0c0d0e] p-3 text-center shadow-[0_16px_42px_rgba(0,0,0,0.28)]">
                    <span className={`mb-2 text-[9px] font-black uppercase tracking-[0.26em] ${ratingTone.text.split(' ')[0]}`}>Final Rating</span>
                    <span className={`text-5xl font-black italic tracking-tight text-zinc-200 drop-shadow-[0_0_18px_${ratingTone.stroke || 'rgba(34,211,238,0.18)'}]`}>
                      {displayedFinalRating}
                    </span>
                  </div>
                  <div className="relative flex min-h-[7.25rem] items-center justify-center overflow-hidden rounded-[26px] border border-zinc-900 bg-[#0c0d0e] p-4 shadow-[0_16px_42px_rgba(0,0,0,0.28)]">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.08)_0%,transparent_72%)]" />
                    <div className="relative z-10 w-[88%] max-w-[7rem]">
                      <RadarChart data={radarData} finalScore={radarFinalScore} compact />
                    </div>
                  </div>
                </div>
              </div>
              {showBestFlaw && (
                <div className="space-y-3">
                  {primaryBestFeature && (
                    <FeatureHighlightCard type="best" feature={primaryBestFeature} onHover={setActiveHover} />
                  )}
                  {primaryFlawFeature && (
                    <FeatureHighlightCard type="flaw" feature={primaryFlawFeature} onHover={setActiveHover} />
                  )}
                </div>
              )}
            </div>
          )}
          {isPremiumDemoScan && !isEmbedded && (
            <div className="rounded-2xl border border-cyan-400/25 bg-cyan-400/[0.06] p-5 shadow-[0_0_30px_rgba(34,211,238,0.08)]">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-200">Demo Scan</p>
                  <p className="mt-2 text-sm font-sans leading-relaxed text-zinc-300">
                    This is a fixed demo face so you can preview the saved premium result flow.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (hasFullProUnlock) setCurrentPage('upload-ultra');
                    else if (onOpenPremiumPlans) onOpenPremiumPlans();
                    else setCurrentPage('plans');
                  }}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-cyan-400/35 bg-cyan-400/15 px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100 transition-all hover:border-cyan-200 hover:bg-cyan-400/25 hover:text-white"
                >
                  <Plus size={14} /> Run this on my face
                </button>
              </div>
            </div>
          )}
          {!isEmbedded && isFreeModelResult && user && onBackToProfiles && (
            <button
              type="button"
              onClick={onBackToProfiles}
              className="inline-flex w-fit items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/80 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-300 transition-colors hover:border-cyan-500/45 hover:text-cyan-300"
            >
              <ArrowLeft size={14} /> Back to Profiles
            </button>
          )}
          {/* Top Section: Subject & History */}
          {!hideTopSection && (
          <div className="flex flex-col gap-8 hidden">
            {/* Header (Subject Badge) */}
            <div className="flex justify-start">
              <div className="bg-zinc-900/35 px-4 py-3 rounded-3xl border border-zinc-800 shadow-2xl backdrop-blur-xl flex items-center gap-3">
                <div className="w-12 h-12 rounded-full border border-cyan-500/30 p-1 shrink-0">
                  <div className="w-full h-full bg-zinc-800 rounded-full overflow-hidden grayscale">
                    <img loading="lazy" decoding="async" src={dashboardData?.frontImage || "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"} alt="Avatar" className="w-full h-full object-cover scale-150 origin-top" />
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
                  <img loading="lazy" decoding="async" src={dashboardData?.frontImage || "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"} className={`w-full h-full object-cover transition-all duration-300 ${activeProfileView === 'front' ? 'opacity-100 grayscale-0 scale-105' : 'opacity-40 grayscale group-hover:opacity-70 group-hover:grayscale-0'}`} alt="Front Profile" />
                  <div className={`absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-cyan-900/50 to-transparent pointer-events-none transition-opacity duration-300 ${activeProfileView === 'front' ? 'opacity-100' : 'opacity-0'}`} />
                </div>
                <div 
                  className={`flex-1 relative cursor-pointer overflow-hidden group ${activeProfileView === 'side' ? 'ring-2 ring-inset ring-cyan-500 z-10' : ''}`}
                  onClick={() => setActiveProfileView('side')}
                >
                  <img loading="lazy" decoding="async" src={dashboardData?.sideImage || "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"} className={`w-full h-full object-cover transition-all duration-300 ${activeProfileView === 'side' ? 'opacity-100 grayscale-0 scale-105' : 'opacity-40 grayscale group-hover:opacity-70 group-hover:grayscale-0'}`} style={{objectPosition: 'top'}} alt="Side Profile" />
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
              <DashboardOverview dashboardData={dashboardData} isRestrictedPreview={isRestrictedPreview} activeProfileView={effectiveProfileView} showFeatureLists={true} />

              <div className="hidden md:grid md:grid-cols-4 gap-6">
                <div className="col-span-1 md:col-span-1 flex flex-col gap-6">
                  {/* Left Column Stack: Final Rating then Categories */}
                  <div className="bg-[#0c0d0e] border border-zinc-800 rounded-2xl relative overflow-hidden text-center flex flex-col justify-center h-[180px] shadow-lg group hover:border-zinc-700 transition-colors">
                    <div className="relative z-10 flex flex-col items-center justify-center">
                      <span className={`font-sans text-[10px] uppercase tracking-[0.45em] mb-4 ${ratingTone.text.split(' ')[0]}/80`}>Final Rating</span>
                      <div className="relative leading-none">
                        <>
                          <span className={`absolute inset-0 block text-6xl font-black italic tracking-tighter ${ratingTone.text.split(' ')[0]}/90 blur-[25.9px] animate-[freeRatingFlicker_2.4s_ease-in-out_infinite] select-none`}>
                            {displayedFinalRating}
                          </span>
                          <span className={`relative block text-6xl font-black italic tracking-tighter ${ratingTone.text.split(' ')[0]} blur-[18.5px] animate-[freeRatingFlicker_2.4s_ease-in-out_infinite] select-none drop-shadow-[0_0_15px_${ratingTone.stroke || 'rgba(74,222,128,0.4)'}]`}>
                            {displayedFinalRating}
                          </span>
                        </>
                      </div>
                      {authenticityFlag && !isFreeModelResult && (
                        <span className="mt-3 max-w-[85%] rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[8px] font-bold uppercase tracking-[0.18em] text-red-300">
                          {authenticityFlag}
                        </span>
                      )}
                      {showUncannyFlagUnderScore && (
                        <span className="mt-2 max-w-[85%] text-[8px] font-bold uppercase tracking-[0.18em] text-red-300">
                          ({uncannyFlag})
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative bg-[#0c0d0e] rounded-2xl border border-zinc-800 flex items-center justify-center aspect-square shadow-lg group hover:border-zinc-700 transition-colors p-4">
                    {renderBlurredOverlay("Category Scores")}
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(74,222,128,0.05)_0%,transparent_70%)] pointer-events-none" />
                    <div className="w-[85%] max-w-[200px] opacity-10 blur-[12.95px] pointer-events-none select-none relative z-10">
                      <RadarChart data={radarData} finalScore={radarFinalScore} />
                    </div>
                  </div>
                </div>

                <div className="col-span-1 md:col-span-3 bg-[#0c0d0e] p-8 rounded-2xl border border-zinc-800 flex flex-col shadow-lg group hover:border-zinc-700 transition-colors">
                  {cohesiveExperimentToggle}
                  <div className="mb-6 flex items-center justify-between gap-3">
                    <h3 className="text-zinc-400 font-sans text-xs uppercase tracking-widest flex items-center gap-2">
                      <Target size={14} className="text-zinc-500" /> Structure
                    </h3>
                    <div className="flex flex-wrap justify-end gap-2">
                      {debugAnchorsImage && (
                        <button
                          type="button"
                          onClick={() => setScanLightbox({ src: debugAnchorsImage, subtitle: 'Debug anchors - landmark overlay' })}
                          className="inline-flex items-center gap-2 rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-cyan-200 transition-colors hover:border-cyan-300/50 hover:bg-cyan-500/15"
                        >
                          <Eye size={12} /> Debug
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col md:flex-row gap-8 items-center justify-center flex-grow">
                    <StructureMap 
                      activeImageUrl={activeImageUrl} 
                      bestFeature={primaryBestFeature} 
                      primaryFlaw={primaryFlawFeature} 
                      activeHover={showBestFlaw ? activeHover : null}
                      onImageClick={(src) => setScanLightbox({ src, subtitle: `${effectiveProfileView === 'side' ? 'Side' : 'Front'} profile` })}
                    />
                    <div className="flex-grow space-y-3 w-full flex flex-col justify-center max-w-[15rem]">
                       {!isRestrictedPreview && (
                       <div className={`flex gap-2 mb-1 w-full ${hasSideProfileImage ? 'max-w-[13rem]' : 'max-w-[8rem]'} mx-auto md:mx-0`}>
                         <div onClick={() => setActiveProfileView('front')} className={`relative ${hasSideProfileImage ? 'flex-1' : 'w-full'} aspect-[6/5] rounded-xl overflow-hidden cursor-pointer border-2 transition-all group-hover/btn:scale-105 ${effectiveProfileView === 'front' ? 'border-cyan-500 shadow-[0_0_15px_rgba(34,211,238,0.2)]' : 'border-zinc-800 opacity-60 hover:opacity-100'}`}>
                          <img loading="lazy" decoding="async" src={dashboardData?.frontImage || placeholderProfileImage} className="w-full h-full object-cover object-center scale-[1.08]" alt="Front" />
                           <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
                           <span className={`absolute bottom-1.5 left-0 right-0 text-center text-[9px] font-sans uppercase tracking-[0.25em] font-bold ${effectiveProfileView === 'front' ? 'text-cyan-400' : 'text-zinc-400'}`}>Front</span>
                         </div>
                         {hasSideProfileImage && (
                           <div onClick={() => setActiveProfileView('side')} className={`relative flex-1 aspect-[6/5] rounded-xl overflow-hidden cursor-pointer border-2 transition-all group-hover/btn:scale-105 ${effectiveProfileView === 'side' ? 'border-cyan-500 shadow-[0_0_15px_rgba(34,211,238,0.2)]' : 'border-zinc-800 opacity-60 hover:opacity-100'}`}>
                            <img loading="lazy" decoding="async" src={dashboardData?.sideImage || placeholderProfileImage} className="w-full h-full object-cover scale-[1.08]" style={{objectPosition: 'center top'}} alt="Side" />
                             <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
                             <span className={`absolute bottom-1.5 left-0 right-0 text-center text-[9px] font-sans uppercase tracking-[0.25em] font-bold ${effectiveProfileView === 'side' ? 'text-cyan-400' : 'text-zinc-400'}`}>Side</span>
                           </div>
                         )}
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
              <div className="hidden md:grid md:grid-cols-4 gap-6">
                <div className="col-span-1 md:col-span-1 flex flex-col gap-6 h-full">
                  {/* Left Column Stack: Final Rating then Categories */}
                  <div className="bg-[#0c0d0e] border border-zinc-800 rounded-2xl relative overflow-hidden text-center flex flex-col justify-center flex-1 min-h-[240px] shadow-lg group hover:border-zinc-700 transition-colors">
                    <div className="relative z-10 flex flex-col items-center justify-center">
                      <span className="font-sans text-[10px] uppercase tracking-[0.45em] mb-4 text-cyan-400/80">
                        {isFreeModelResult ? 'Analysis Type' : 'Final Rating'}
                      </span>
                      <div className="relative leading-none w-full flex justify-center">
                        <span className={`block font-black tracking-tighter ${ratingTone.text} ${isFreeModelResult ? 'text-3xl' : 'text-[5.5rem] md:text-[6.5rem]'}`}>
                          {displayedFinalRating}
                        </span>
                      </div>
                      {authenticityFlag && !isFreeModelResult && (
                        <span className="mt-3 max-w-[85%] rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[8px] font-bold uppercase tracking-[0.18em] text-red-300">
                          {authenticityFlag}
                        </span>
                      )}
                      {showUncannyFlagUnderScore && (
                        <span className="mt-2 max-w-[85%] text-[8px] font-bold uppercase tracking-[0.18em] text-red-300">
                          ({uncannyFlag})
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative bg-[#0c0d0e] rounded-2xl border border-zinc-800 flex items-center justify-center aspect-square shadow-lg overflow-hidden transition-all duration-500 hover:border-zinc-700">
                    <HexagonStats 
                      radarData4={radarData} 
                      radarData5={[
                        ...radarData,
                        { label: 'Bone', val: categoryToRadar10(dashboardData?.categories?.Bone || 8.5, radarFinalScore) }
                      ]}
                      finalScore={radarFinalScore} 
                    />
                  </div>
                </div>

                <div className="col-span-1 md:col-span-3 bg-[#0c0d0e] p-8 rounded-2xl border border-zinc-800 flex flex-col shadow-lg group hover:border-zinc-700 transition-colors">
                  {cohesiveExperimentToggle}
                  <div className="mb-6 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setShowAnchorOverlay(!showAnchorOverlay)}
                      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-[0.25em] transition-all duration-300 ${
                        showAnchorOverlay 
                          ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200 shadow-[0_0_15px_rgba(34,211,238,0.25)]' 
                          : 'border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                      }`}
                    >
                      <Target size={14} className={showAnchorOverlay ? 'text-cyan-400' : 'text-zinc-500'} />
                      {showAnchorOverlay ? 'Anchors Active' : 'Anchor Points'}
                    </button>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={openAnimationsViewer}
                        className="inline-flex items-center gap-2 rounded-full border border-fuchsia-500/25 bg-fuchsia-500/10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-fuchsia-100 transition-colors hover:border-fuchsia-300/50 hover:bg-fuchsia-500/15"
                      >
                        <Play size={12} /> View Animations
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col md:flex-row gap-8 items-center justify-center flex-grow">
                    <StructureMap 
                      activeImageUrl={activeImageUrl} 
                      bestFeature={primaryBestFeature} 
                      primaryFlaw={primaryFlawFeature} 
                      activeHover={showBestFlaw ? activeHover : null}
                      onImageClick={(src) => setScanLightbox({ src, subtitle: `${effectiveProfileView === 'side' ? 'Side' : 'Front'} profile` })}
                      showAnchors={showAnchorOverlay}
                      anchorImageUrl={debugAnchorsImage}
                    />
                    <div className="flex-grow space-y-4 w-full flex flex-col justify-center max-w-[20rem]">
                       <div className={`flex gap-2 mb-1 w-full ${hasSideProfileImage ? 'max-w-[18rem]' : 'max-w-[10rem]'} mx-auto md:mx-0`}>
                         <div onClick={() => setActiveProfileView('front')} className={`relative ${hasSideProfileImage ? 'flex-1' : 'w-full'} aspect-[16/10] rounded-xl overflow-hidden cursor-pointer border-2 transition-all group-hover/btn:scale-105 ${effectiveProfileView === 'front' ? 'border-cyan-500 shadow-[0_0_15px_rgba(34,211,238,0.2)]' : 'border-zinc-800 opacity-60 hover:opacity-100'}`}>
                          <img loading="lazy" decoding="async" src={dashboardData?.frontImage || placeholderProfileImage} className="w-full h-full object-cover object-center scale-[1.08]" alt="Front" />
                           <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
                           <span className={`absolute bottom-1.5 left-0 right-0 text-center text-[9px] font-sans uppercase tracking-[0.25em] font-bold ${effectiveProfileView === 'front' ? 'text-cyan-400' : 'text-zinc-400'}`}>Front</span>
                         </div>
                         {hasSideProfileImage && (
                           <div onClick={() => setActiveProfileView('side')} className={`relative flex-1 aspect-[16/10] rounded-xl overflow-hidden cursor-pointer border-2 transition-all group-hover/btn:scale-105 ${effectiveProfileView === 'side' ? 'border-cyan-500 shadow-[0_0_15px_rgba(34,211,238,0.2)]' : 'border-zinc-800 opacity-60 hover:opacity-100'}`}>
                            <img loading="lazy" decoding="async" src={dashboardData?.sideImage || placeholderProfileImage} className="w-full h-full object-cover scale-[1.08]" style={{objectPosition: 'center top'}} alt="Side" />
                             <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
                             <span className={`absolute bottom-1.5 left-0 right-0 text-center text-[9px] font-sans uppercase tracking-[0.25em] font-bold ${effectiveProfileView === 'side' ? 'text-cyan-400' : 'text-zinc-400'}`}>Side</span>
                           </div>
                         )}
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

          {isAdmin && !!debugJustification && (
            <div className="relative overflow-hidden rounded-2xl border border-amber-500/25 bg-amber-500/5 p-6 shadow-lg transition-colors hover:border-amber-500/40">
              <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-amber-300 to-amber-600" />
              <div className="relative pl-3">
                <h3 className="mb-3 flex items-center gap-2 text-xs font-sans uppercase tracking-widest text-amber-300">
                  <Bug size={14} className="text-amber-400" /> Admin Debug Justification
                </h3>
                <div className="text-sm font-sans leading-relaxed text-zinc-200">
                  {renderMarkedText(debugJustification)}
                </div>
              </div>
            </div>
          )}

          {/* Detailed Ratios Section */}
          {(isRestrictedPreview || !isFreeModelResult) && (
          <div className="relative bg-[#0c0d0e] p-6 rounded-2xl border border-zinc-800 flex flex-col shadow-lg group hover:border-zinc-700 transition-colors">
            {isRestrictedPreview && renderBlurredOverlay("Detailed Ratios")}
            <div className={`flex flex-col ${isRestrictedPreview ? 'opacity-30 blur-[5.55px] pointer-events-none select-none' : ''}`}>
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
          )}

          {!isRestrictedPreview && <DashboardOverview dashboardData={dashboardData} isRestrictedPreview={isRestrictedPreview} activeProfileView={effectiveProfileView} showFeatureLists />}

          {/* Actionable Protocol */}
          {(isRestrictedPreview || !isFreeModelResult) && !hideActionableProtocols && (
            <div className="relative bg-[#0c0d0e] p-8 rounded-2xl border border-zinc-800 shadow-lg group hover:border-zinc-700 transition-colors">
              {isRestrictedPreview && renderBlurredOverlay("Actionable Protocol")}
              <div className={`flex flex-col ${isRestrictedPreview ? 'opacity-30 blur-[5.55px] pointer-events-none select-none' : ''}`}>
                <h3 className="text-zinc-400 font-sans text-xs uppercase tracking-widest mb-6 flex items-center gap-2 border-b border-zinc-800 pb-4"><Target size={14} className="text-zinc-500" /> Actionable Protocol</h3>
                {isDetailedReportGenerating ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {[1, 2, 3].map((item) => (
                      <div key={item} className="flex overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
                        <div className="flex shrink-0 items-center justify-center bg-zinc-800 px-4">
                          <Loader2 size={18} className="animate-spin text-amber-300" />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
                          <div className="h-3 w-2/3 rounded bg-zinc-700/70 animate-pulse" />
                          <div className="h-2 w-full rounded bg-zinc-800 animate-pulse" />
                          <div className="h-2 w-4/5 rounded bg-zinc-800 animate-pulse" />
                          <span className="text-[9px] font-sans uppercase tracking-widest text-amber-300">Generating personalized protocol</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(dashboardData?.protocols && dashboardData.protocols.length > 0
                      ? dashboardData.protocols
                      : [
                          { id: 1, name: 'Reduce Body Fat to 12%', description: 'Will vastly improve buccal framing and expose zygomatic arch', impact: 'Highest Impact' },
                          { id: 2, name: 'Minoxidil for Brows', description: 'Increasing eyebrow density by 15% will heavily boost dimorphism score', impact: 'High Impact' },
                          { id: 3, name: 'Volufiline under eyes', description: 'Will help mask negative canthal tilt and reduce orbital shadowing', impact: 'Medium Impact' },
                        ]
                    ).slice(0, showAllProtocols ? undefined : 3).map((p, i) => {
                      const impactColor = /extreme|critical|highest/i.test(p.impact) ? 'text-red-400' : /high/i.test(p.impact) ? 'text-orange-400' : /medium/i.test(p.impact) ? 'text-yellow-400' : 'text-emerald-400';
                      const protocolKey = String(p.id || i + 1);
                      const isCompleted = Boolean(completedProtocolIds[protocolKey]);
                      return (
                        <div key={p.id || i} onClick={() => setCurrentPage(`protocol-${p.id || i+1}`)} className="flex bg-zinc-900/50 rounded-xl border border-zinc-800 overflow-hidden hover:border-cyan-500/40 hover:shadow-[0_0_20px_rgba(34,211,238,0.08)] transition-all cursor-pointer group">
                          <div className="bg-zinc-800 flex items-center justify-center px-4 shrink-0"><span className="text-2xl font-black text-zinc-600 group-hover:text-cyan-400 transition-colors">{String(p.id || i+1).padStart(2, '0')}</span></div>
                          <div className="p-4 flex flex-col gap-1 min-w-0 flex-1">
                            <span className="text-white font-bold uppercase text-sm tracking-widest truncate">{p.name}</span>
                            <span className="text-zinc-500 text-xs font-sans line-clamp-2">{p.description}</span>
                            <span className={`text-[9px] font-sans uppercase tracking-widest mt-1 ${impactColor}`}>{p.impact}</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCompletedProtocolIds((prev) => ({ ...prev, [protocolKey]: true }));
                            }}
                            className={`m-3 self-center rounded-lg border px-3 py-2 text-[9px] font-bold uppercase tracking-[0.18em] transition-colors ${isCompleted ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-zinc-700 bg-zinc-950/70 text-zinc-400 hover:border-cyan-500/35 hover:text-cyan-300'}`}
                          >
                            {isCompleted ? '100%' : 'Complete'}
                          </button>
                          <div className="flex items-center pr-4 shrink-0"><ChevronRight size={16} className="text-zinc-700 group-hover:text-cyan-400 transition-colors" /></div>
                        </div>
                      );
                    })}
                  </div>
                )}
                    {detailedReportRetryButton}
                    {!isDetailedReportGenerating && ((dashboardData?.protocols && dashboardData.protocols.length > 3) || (!dashboardData?.protocols && 3 > 3)) && (
                      <button onClick={() => setShowAllProtocols(!showAllProtocols)} className="mt-6 self-center px-6 py-2 border border-zinc-700 rounded-full text-zinc-400 text-[10px] font-sans uppercase tracking-widest hover:text-white hover:border-zinc-500 transition-colors flex items-center gap-2">
                        {showAllProtocols ? 'Show Less' : `Show All ${dashboardData?.protocols?.length || 3} Protocols`}
                        <ChevronDown size={14} className={`transition-transform duration-300 ${showAllProtocols ? 'rotate-180' : ''}`} />
                      </button>
                    )}
                    {!dashboardData?.protocols?.length && !isRestrictedPreview && !isDetailedReportGenerating && !hasDetailedReportFailed && (
                      <p className="text-zinc-600 font-sans text-[10px] uppercase tracking-widest mt-4 text-center">Run a premium analysis to get personalized protocols based on your weak points</p>
                    )}
                    {hasDetailedReportFailed && !dashboardData?.protocols?.length && (
                      <p className="text-amber-300/80 font-sans text-[10px] uppercase tracking-widest mt-4 text-center">{detailedReportError || 'Detailed protocols could not be generated for this scan.'}</p>
                    )}
              </div>
            </div>
          )}

          {(isRestrictedPreview || !isFreeModelResult) && !hidePersonalizedFeedback && (
            <div className="relative bg-[#0c0d0e] p-8 rounded-2xl border border-zinc-800 shadow-lg group hover:border-zinc-700 transition-colors">
              {isRestrictedPreview && renderBlurredOverlay("Personalized Feedback", true)}
              <div className={`flex flex-col ${isRestrictedPreview ? 'opacity-30 blur-[5.55px] pointer-events-none select-none' : ''}`}>
                <h3 className="text-zinc-400 font-sans text-xs uppercase tracking-widest mb-6 flex items-center gap-2 border-b border-zinc-800 pb-4">
                  <Sparkles size={14} className="text-zinc-500" /> Personalized Feedback
                </h3>
                {isDetailedReportGenerating ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {[1, 2, 3, 4].map((item) => (
                      <div key={item} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
                        <div className="mb-4 flex items-center gap-3">
                          <Loader2 size={16} className="animate-spin text-amber-300" />
                          <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-300">Generating feedback</span>
                        </div>
                        <div className="space-y-2">
                          <div className="h-3 w-3/4 rounded bg-zinc-700/70 animate-pulse" />
                          <div className="h-2 w-full rounded bg-zinc-800 animate-pulse" />
                          <div className="h-2 w-5/6 rounded bg-zinc-800 animate-pulse" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : personalizedFeedback.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {personalizedFeedback.map((item, index) => (
                      <PersonalizedFeedbackCard
                        key={`${item.id || index}-${item.title || 'feedback'}`}
                        item={item}
                        delay={index * 70}
                      />
                    ))}
                  </div>
                ) : hasDetailedReportFailed ? (
                  <p className="text-amber-300/80 text-sm font-sans leading-relaxed">
                    {detailedReportError || 'The score is saved, but the detailed feedback did not finish for this scan.'}
                  </p>
                ) : (
                  <p className="text-zinc-500 text-sm font-sans leading-relaxed">
                    Personalized feedback will appear here once the scan returns individualized tips.
                  </p>
                )}
              </div>
            </div>
          )}

          {(isRestrictedPreview || !isFreeModelResult) && !hideUnlockPotential && (
          <div className="bg-gradient-to-br from-zinc-900/80 to-black p-1 rounded-2xl overflow-hidden mt-4 relative shadow-[0_10px_50px_rgba(0,0,0,0.5)] border border-zinc-800/50 group hover:border-zinc-700 transition-colors">
            {isRestrictedPreview && renderBlurredOverlay("Analyze Potential")}
            <div className={`bg-[#0a0a0b] p-8 md:p-12 rounded-[14px] flex flex-col md:flex-row items-center gap-12 relative overflow-hidden ${isRestrictedPreview ? 'opacity-30 blur-[5.55px] pointer-events-none select-none' : ''}`}>
              
              {/* Glow effect behind the image */}
              {isUnlocked && <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-64 h-64 bg-cyan-500/20 blur-[92.5px] rounded-full pointer-events-none" />}

              <div className="relative w-48 sm:w-64 aspect-square shrink-0 rounded-2xl overflow-hidden border border-zinc-800 p-6">
                {isUnlocked && potentialImageUrl ? (
                  <img loading="lazy" decoding="async" src={potentialImageUrl} className="w-full h-full object-contain opacity-100 transition-all duration-1000 scale-90" alt="Max Potential" />
                ) : isUnlocking ? (
                  <>
                    <img loading="lazy" decoding="async" src={activeImageUrl} className="w-full h-full object-contain blur-[11.1px] opacity-20 transition-all duration-500 scale-90" alt="Generating" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40 backdrop-blur-[3.7px]">
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
                    <img loading="lazy" decoding="async" src={activeImageUrl} className="w-full h-full object-contain blur-[3.7px] opacity-30 scale-90" alt="Locked Potential" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Lock className="text-zinc-500 drop-shadow-[0_0_15px_rgba(0,0,0,1)]" size={48} />
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-col flex-1 text-center md:text-left z-10">
                <h3 className="text-3xl font-black italic text-white uppercase tracking-tighter mb-2">Analyze Potential</h3>
                <p className="text-zinc-400 font-sans text-xs leading-relaxed mb-8 max-w-sm mx-auto md:mx-0">Unlock an AI-generated rendering of your exact facial morphology if you perfectly executed the actionable protocol.</p>
                <p className="mb-5 text-[10px] font-bold uppercase tracking-[0.2em] text-red-400">Experimental feature, may be inconsistent</p>
                {hasPotentialRatings && (
                  <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                      <p className="text-[9px] font-black uppercase tracking-[0.24em] text-emerald-300/80">Max Natural Potential</p>
                      <p className="mt-1 text-2xl font-black italic tracking-tight text-white">{formatPotentialScore(maxNaturalPotential)}</p>
                    </div>
                    <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3">
                      <p className="text-[9px] font-black uppercase tracking-[0.24em] text-cyan-300/80">Max With Surgery</p>
                      <p className="mt-1 text-2xl font-black italic tracking-tight text-white">{formatPotentialScore(maxPotentialWithSurgery)}</p>
                    </div>
                  </div>
                )}
                
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
                      <span className="text-cyan-400 font-black italic uppercase text-2xl drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">
                        MAX WITH SURGERY {formatPotentialScore(maxPotentialWithSurgery)}
                      </span>
                    </div>
                    {potentialImageUrl && (
                      <button
                        type="button"
                        onClick={() => setPotentialLightboxOpen(true)}
                        className="inline-flex items-center gap-2 self-center md:self-start rounded-xl border border-zinc-700 bg-zinc-900/70 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition-colors hover:border-cyan-500/35 hover:text-cyan-300"
                      >
                        <Eye size={14} /> View Full Size
                      </button>
                    )}
                    <p className="text-[10px] text-cyan-500/70 font-sans uppercase tracking-widest mt-2">{'>'} PROJECTION COMPLETE</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          )}

          {potentialLightboxOpen && potentialImageUrl && (
            <ImageLightbox
              src={potentialImageUrl}
              subtitle="Analyze Potential - Full Size Preview"
              onClose={() => setPotentialLightboxOpen(false)}
            />
          )}

          {scanLightbox && (
            <ImageLightbox
              src={scanLightbox.src}
              subtitle={scanLightbox.subtitle}
              onClose={() => setScanLightbox(null)}
            />
          )}

          {!isEmbedded && isFreeModelResult && (
            <DashboardHubPreviewsCompact
              setCurrentPage={setCurrentPage}
              variant="sections"
              onOpenCommunityScan={openCommunityScan}
              onAddScan={() => setCurrentPage('photo-guide')}
            />
          )}

          {!isEmbedded && !isFreeModelResult && (
            <DashboardHubPreviewsCompact
              setCurrentPage={setCurrentPage}
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
  const [planNotice, setPlanNotice] = useState('');

  const handleCheckout = (plan) => {
    if (!tosAgreed) {
      setPlanNotice("Please agree to the Terms of Service to proceed.");
      return;
    }
    if (!user) {
      setCurrentPage('login');
      return;
    }
    if (isLivePaddleBlockedOnLocalhost()) {
      setPlanNotice('Paddle live checkout cannot run on localhost. Use mogcheck.net for live checkout, or add Paddle sandbox token/price IDs to .env.local for local testing.');
      return;
    }
    if (!PADDLE_PRICE_IDS[plan]) {
      setPlanNotice(
        plan === 'pro_yearly'
          ? 'Yearly MogCheck Pro checkout is not configured yet. Add VITE_PADDLE_PRICE_PRO_YEARLY and redeploy, then try again.'
          : 'This checkout option is not configured yet. Please refresh and try again in a moment.'
      );
      return;
    }
    if (!openPaddleCheckout(plan, user)) {
      setPlanNotice('Paddle checkout is not configured yet. Please refresh and try again in a moment.');
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
        <div className="mt-8 inline-flex flex-wrap items-center justify-center gap-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-6 py-4 text-emerald-100 shadow-[0_0_45px_rgba(16,185,129,0.12)]">
          <Shield size={20} className="text-emerald-400 shrink-0" />
          <span className="font-sans text-[11px] font-black uppercase tracking-[0.24em]">
            Payments verified by Paddle
          </span>
          <span className="hidden sm:block h-5 w-px bg-emerald-400/25" />
          <span className="font-sans text-[11px] uppercase tracking-widest text-emerald-200/70">
            Secure checkout, tax handled, instant access
          </span>
        </div>
      </div>
    </FadeUp>

    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 w-full max-w-7xl relative z-10">

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

      {/* --- Two Scans --- */}
      <FadeUp delay={300}>
        <div className="h-full bg-gradient-to-b from-[#0f1520] via-zinc-900/60 to-[#0c0d0e] border border-cyan-500/30 rounded-3xl p-8 md:p-10 flex flex-col relative hover:border-cyan-500/50 transition-colors shadow-[0_0_60px_rgba(34,211,238,0.04)] hover:shadow-[0_0_60px_rgba(34,211,238,0.1)]">
          <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-cyan-500 text-black px-5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg">One-Time</div>

          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center p-1.5">
              <MogCheckLogoIcon size={28} className="opacity-95 [filter:drop-shadow(0_0_8px_rgba(34,211,238,0.35))]" />
            </div>
            <div>
              <h3 className="text-xl font-black uppercase italic tracking-tighter text-cyan-400">2 Scans</h3>
              <p className="text-cyan-400/40 font-sans text-[9px] uppercase tracking-widest">One-time</p>
            </div>
          </div>

          <div className="flex items-baseline gap-1 mb-1">
            <span className="text-5xl font-black text-white">$8</span>
            <span className="text-sm text-zinc-600 font-sans tracking-widest">/one-time</span>
          </div>
          <p className="text-zinc-400 font-sans text-xs uppercase tracking-wide mb-8">Pay once, no subscription</p>

          <div className="w-full h-px bg-cyan-500/15 mb-8" />

          <p className="text-cyan-400/60 font-sans text-[10px] uppercase tracking-widest mb-5">Two premium analyses include</p>
          <ul className="flex flex-col gap-4 text-sm font-sans text-zinc-300 w-full mb-10">
            <li className="flex items-start gap-3"><Check size={15} className="text-cyan-400 mt-0.5 shrink-0" /> <span>2 full-detail AI facial analyses with 40+ measurements</span></li>
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
              <Zap size={14} /> Buy 2 Scans
            </button>
          </div>
        </div>
      </FadeUp>

      {/* --- MogCheck Pro Monthly --- */}
      <FadeUp delay={450}>
        <div className="h-full bg-gradient-to-b from-[#1a1600] via-zinc-900/80 to-[#0c0d0e] border border-yellow-500/40 rounded-3xl p-8 md:p-10 flex flex-col relative shadow-[0_0_80px_rgba(234,179,8,0.08)] hover:shadow-[0_0_80px_rgba(234,179,8,0.15)] transition-shadow">
          <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-yellow-600 to-yellow-400 text-black px-5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg">Monthly</div>

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
            <span className="text-5xl font-black text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]">$15</span>
            <span className="text-sm text-zinc-500 font-sans tracking-widest">/mo</span>
          </div>
          <p className="text-zinc-400 font-sans text-xs uppercase tracking-wide mb-8">Cancel anytime, no commitment</p>

          <div className="w-full h-px bg-yellow-500/15 mb-8" />

          <p className="text-yellow-500/60 font-sans text-[10px] uppercase tracking-widest mb-5">Everything in 2 Scans, plus</p>
          <ul className="flex flex-col gap-4 text-sm font-sans text-zinc-300 w-full mb-10">
              <li className="flex items-start gap-3"><Check size={15} className="text-yellow-500 mt-0.5 shrink-0" /> <span>Unlimited analysis (fair usage)</span></li>
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

      {/* --- MogCheck Pro Annual --- */}
      <FadeUp delay={600}>
        <div className="h-full bg-gradient-to-b from-[#09151b] via-zinc-900/80 to-[#0c0d0e] border border-emerald-500/35 rounded-3xl p-8 md:p-10 flex flex-col relative shadow-[0_0_80px_rgba(16,185,129,0.08)] hover:shadow-[0_0_80px_rgba(16,185,129,0.15)] transition-shadow">
          <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-emerald-600 to-emerald-400 text-black px-5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg">Annual</div>

          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center p-1.5">
              <MogCheckLogoIcon size={28} className="opacity-95 [filter:drop-shadow(0_0_8px_rgba(16,185,129,0.4))]" />
            </div>
            <div>
              <h3 className="text-xl font-black uppercase italic tracking-tighter text-emerald-400">MogCheck Pro</h3>
              <p className="text-emerald-400/40 font-sans text-[9px] uppercase tracking-widest">Yearly billing</p>
            </div>
          </div>

          <div className="flex items-baseline gap-1 mb-1">
            <span className="text-5xl font-black text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]">$12</span>
            <span className="text-sm text-zinc-500 font-sans tracking-widest">/mo</span>
          </div>
          <p className="text-zinc-400 font-sans text-xs uppercase tracking-wide mb-2">Billed annually at <span className="line-through text-zinc-600">$180</span> <span className="text-emerald-300">$144</span></p>
          <p className="mb-8 inline-flex w-fit rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-300">Save $36</p>

          <div className="w-full h-px bg-emerald-500/15 mb-8" />

          <p className="text-emerald-400/60 font-sans text-[10px] uppercase tracking-widest mb-5">Everything in monthly Pro, plus</p>
          <ul className="flex flex-col gap-4 text-sm font-sans text-zinc-300 w-full mb-10">
            <li className="flex items-start gap-3"><Check size={15} className="text-emerald-400 mt-0.5 shrink-0" /> <span>Best monthly rate for long-term access</span></li>
              <li className="flex items-start gap-3"><Check size={15} className="text-emerald-400 mt-0.5 shrink-0" /> <span>Unlimited analysis (fair usage)</span></li>
            <li className="flex items-start gap-3"><Check size={15} className="text-emerald-400 mt-0.5 shrink-0" /> <span>AI potential analysis, protocols, and progress tracking</span></li>
            <li className="flex items-start gap-3"><Check size={15} className="text-emerald-400 mt-0.5 shrink-0" /> <span>Full-detail biometric breakdowns and premium dashboard access</span></li>
          </ul>

          <div className="mt-auto flex flex-col gap-4">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input 
                type="checkbox" 
                className="mt-1 shrink-0 cursor-pointer accent-emerald-500" 
                checked={tosAgreed}
                onChange={(e) => setTosAgreed(e.target.checked)}
              />
              <span className="text-zinc-500 font-sans text-[10px] leading-tight group-hover:text-zinc-400 transition-colors">
                I agree to the <a href="/tos" onClick={(e) => { e.preventDefault(); setCurrentPage('tos'); }} className="text-emerald-400 hover:text-emerald-300 underline">Terms of Service</a> and acknowledge that I lose my right to a refund once the AI analysis is generated.
              </span>
            </label>
            <button onClick={() => handleCheckout('pro_yearly')} className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-400 text-black font-black uppercase tracking-widest text-xs hover:scale-[1.02] transition-transform shadow-[0_0_25px_rgba(16,185,129,0.3)] flex items-center justify-center gap-2">
              <Crown size={14} /> Go Yearly
            </button>
          </div>
        </div>
      </FadeUp>
    </div>

    <FadeUp delay={750}>
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

    <FadeUp delay={850}>
      <p className="mt-16 text-zinc-600 font-sans text-[10px] uppercase tracking-widest text-center relative z-10">
        Payments verified by Paddle - Secure checkout - Cancel anytime
      </p>
    </FadeUp>

    {planNotice && (
      <SiteModal title="Plan Notice" onClose={() => setPlanNotice('')} maxWidth="max-w-lg">
        <p className="text-sm leading-relaxed text-zinc-300">{planNotice}</p>
      </SiteModal>
    )}
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
  const [userActivityByUser, setUserActivityByUser] = useState({});
  const [userActivityLoading, setUserActivityLoading] = useState({});
  const [userActivityError, setUserActivityError] = useState({});
  const [userPurchasesByUser, setUserPurchasesByUser] = useState({});
  const [userPurchasesLoading, setUserPurchasesLoading] = useState({});
  const [userPurchasesError, setUserPurchasesError] = useState({});
  const [visitorRange, setVisitorRange] = useState('24h');
  const [visitorStats, setVisitorStats] = useState(null);
  const [visitorStatsLoading, setVisitorStatsLoading] = useState(false);
  const [visitorStatsError, setVisitorStatsError] = useState('');
  const [planDrafts, setPlanDrafts] = useState({});
  const [planSaveLoading, setPlanSaveLoading] = useState({});
  const [planSaveError, setPlanSaveError] = useState({});
  const [scanLimits, setScanLimits] = useState([]);
  const [scanLimitsLoading, setScanLimitsLoading] = useState(false);
  const [scanLimitsError, setScanLimitsError] = useState('');
  const [scanLimitActionLoading, setScanLimitActionLoading] = useState({});
  const [pendingAdminDeleteUser, setPendingAdminDeleteUser] = useState(null);
  const [adminNotice, setAdminNotice] = useState('');
  const [announcementDraft, setAnnouncementDraft] = useState({ title: 'MogCheck Announcement', body: '', url: '' });
  const [announcementSending, setAnnouncementSending] = useState(false);
  const [announcementStatus, setAnnouncementStatus] = useState('');
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

      setScanLimitsLoading(true);
      setScanLimitsError('');
      try {
        const limitsRes = await fetch(`${API_BASE}/api/admin/scan-limits`, { headers: { 'x-admin-password': pw } });
        const limitsData = await limitsRes.json().catch(() => ({}));
        if (!limitsRes.ok) throw new Error(limitsData?.error || `Scan limits endpoint failed (${limitsRes.status})`);
        setScanLimits(Array.isArray(limitsData.limitedUsers) ? limitsData.limitedUsers : []);
      } catch (limitsErr) {
        setScanLimits([]);
        setScanLimitsError(limitsErr.message || 'Failed to fetch scan limits');
      } finally {
        setScanLimitsLoading(false);
      }
      
      setLastRefresh(new Date());
      setAuthenticated(true);
      window.localStorage.setItem('mogcheck_admin_pw', pw);
      return true;
    } catch (e) {
      setError(e.message);
      setAuthenticated(false);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const fetchVisitorStats = useCallback(async (range = visitorRange, pw = storedPw.current) => {
    if (!pw) return;
    setVisitorStatsLoading(true);
    setVisitorStatsError('');
    try {
      const res = await fetch(`${API_BASE}/api/admin/visitor-stats?range=${encodeURIComponent(range)}`, {
        headers: { 'x-admin-password': pw },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to fetch visitor stats');
      setVisitorStats(data);
    } catch (err) {
      setVisitorStatsError(err.message || 'Failed to fetch visitor stats');
      setVisitorStats(null);
    } finally {
      setVisitorStatsLoading(false);
    }
  }, [visitorRange]);

  const handleLogin = (e) => {
    e.preventDefault();
    const pw = password.trim();
    if (!pw) return;
    storedPw.current = pw;
    fetchStats(pw);
  };

  useEffect(() => {
    if (!authenticated) return;
    const iv = setInterval(() => fetchStats(storedPw.current), 120000);
    return () => clearInterval(iv);
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    fetchVisitorStats(visitorRange);
  }, [authenticated, fetchVisitorStats, visitorRange]);

  const fmtUptime = (ms) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const fmtDuration = (ms) => {
    if (!ms) return '-';
    return ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : `${(ms / 1000).toFixed(0)}s`;
  };

  const modelLabel = (m) => ({ '1': 'Premium Model', '2': 'Backup Model', '6': 'Premium Model', '7': 'Premium Model', '8': 'Premium Model', '9': 'Premium Model', [PREMIUM_DEMO_MODEL_ID]: 'Premium Demo', '3': 'Free' }[m] || m);
  const adminUserSections = useMemo(() => {
    const newUsers = [];
    const goatUsers = [];
    users.forEach((user) => {
      const email = String(user?.email || '').trim().toLowerCase();
      if (GOAT_USER_EMAILS.has(email)) goatUsers.push(user);
      else newUsers.push(user);
    });
    return [
      { id: 'new-users', title: 'New Users', users: newUsers },
      { id: 'the-goats', title: 'The Goats', users: goatUsers },
    ];
  }, [users]);

  const handleDeleteUser = async (uid, email) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${uid}`, {
        method: 'DELETE',
        headers: { 'x-admin-password': storedPw.current }
      });
      if (!res.ok) throw new Error('Failed to delete user');
      setUsers(users.filter(u => u.uid !== uid));
    } catch (err) {
      setAdminNotice(err.message);
    } finally {
      setPendingAdminDeleteUser(null);
    }
  };

  const handleSendAnnouncement = async () => {
    const body = announcementDraft.body.trim();
    if (!body) {
      setAnnouncementStatus('Write an announcement message first.');
      return;
    }
    setAnnouncementSending(true);
    setAnnouncementStatus('');
    try {
      const res = await fetch(`${API_BASE}/api/admin/notifications/announcement`, {
        method: 'POST',
        headers: {
          'x-admin-password': storedPw.current,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(announcementDraft),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to send announcement');
      setAnnouncementStatus(`Sent to ${data.count || 0} user${Number(data.count) === 1 ? '' : 's'}.`);
      setAnnouncementDraft({ title: 'MogCheck Announcement', body: '', url: '' });
    } catch (err) {
      setAnnouncementStatus(err.message || 'Failed to send announcement');
    } finally {
      setAnnouncementSending(false);
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
    const normalizedPlan = normalizePlanValue(draft.plan || 'free');
    const normalizedCredits = Math.max(0, parseInt(draft.scanCredits, 10) || 0);
    if (!['free', 'pro', 'pro_monthly', 'pro_annual', 'pro_infinite', 'single_scan'].includes(normalizedPlan)) {
      setPlanSaveError((prev) => ({ ...prev, [uid]: 'Plan must be free, PRO monthly, PRO annual, PRO infinite, or single_scan.' }));
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to update plan');
      setUsers((prev) =>
        prev.map((user) =>
          user.uid === uid
            ? {
                ...user,
                plan: data.plan || normalizedPlan,
                planLabel: data.planLabel || user.planLabel,
                scanCredits: data.scanCredits ?? normalizedCredits,
                subscriptionStatus: data.subscriptionStatus ?? user.subscriptionStatus,
                subscriptionCurrentPeriodEnd: data.subscriptionCurrentPeriodEnd ?? null,
                proDaysLeft: data.proDaysLeft ?? null,
              }
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

  const refreshScanLimits = async () => {
    setScanLimitsLoading(true);
    setScanLimitsError('');
    try {
      const res = await fetch(`${API_BASE}/api/admin/scan-limits`, {
        headers: { 'x-admin-password': storedPw.current },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to fetch scan limits');
      setScanLimits(Array.isArray(data.limitedUsers) ? data.limitedUsers : []);
    } catch (err) {
      setScanLimitsError(err.message || 'Failed to fetch scan limits');
    } finally {
      setScanLimitsLoading(false);
    }
  };

  const handleLimitUser = async (uid, email) => {
    setScanLimitActionLoading((prev) => ({ ...prev, [uid]: true }));
    try {
      const res = await fetch(`${API_BASE}/api/admin/scan-limits/${encodeURIComponent(uid)}`, {
        method: 'POST',
        headers: {
          'x-admin-password': storedPw.current,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, reason: 'Manual admin limit' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to limit user');
      await refreshScanLimits();
    } catch (err) {
      setAdminNotice(err.message || 'Failed to limit user');
    } finally {
      setScanLimitActionLoading((prev) => ({ ...prev, [uid]: false }));
    }
  };

  const handleUnlimitUser = async (uid) => {
    setScanLimitActionLoading((prev) => ({ ...prev, [uid]: true }));
    try {
      const res = await fetch(`${API_BASE}/api/admin/scan-limits/${encodeURIComponent(uid)}`, {
        method: 'DELETE',
        headers: { 'x-admin-password': storedPw.current },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to unlimit user');
      await refreshScanLimits();
    } catch (err) {
      setAdminNotice(err.message || 'Failed to unlimit user');
    } finally {
      setScanLimitActionLoading((prev) => ({ ...prev, [uid]: false }));
    }
  };

  const handleToggleUserScans = async (uid) => {
    if (expandedUserId === uid) {
      setExpandedUserId(null);
      return;
    }

    setExpandedUserId(uid);
    if (userScansByUser[uid] && userMogBattlesByUser[uid] && userActivityByUser[uid] && userPurchasesByUser[uid]) return;

    setUserScansLoading((prev) => ({ ...prev, [uid]: !userScansByUser[uid] }));
    setUserScansError((prev) => ({ ...prev, [uid]: '' }));
    setUserMogBattlesLoading((prev) => ({ ...prev, [uid]: !userMogBattlesByUser[uid] }));
    setUserMogBattlesError((prev) => ({ ...prev, [uid]: '' }));
    setUserActivityLoading((prev) => ({ ...prev, [uid]: !userActivityByUser[uid] }));
    setUserActivityError((prev) => ({ ...prev, [uid]: '' }));
    setUserPurchasesLoading((prev) => ({ ...prev, [uid]: !userPurchasesByUser[uid] }));
    setUserPurchasesError((prev) => ({ ...prev, [uid]: '' }));
    try {
      const requests = [];

      if (!userScansByUser[uid]) {
        requests.push(
          fetch(`${API_BASE}/api/admin/users/${uid}/scans`, {
            headers: { 'x-admin-password': storedPw.current },
            cache: 'no-store',
          }).then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Failed to fetch scans');
            setUserScansByUser((prev) => ({ ...prev, [uid]: data.scans || [] }));
          }).catch((err) => {
            setUserScansError((prev) => ({ ...prev, [uid]: err.message || 'Failed to fetch scans' }));
          })
        );
      }

      if (!userMogBattlesByUser[uid]) {
        requests.push(
          fetch(`${API_BASE}/api/admin/users/${uid}/mog-battles`, {
            headers: { 'x-admin-password': storedPw.current },
            cache: 'no-store',
          }).then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Failed to fetch Mog Battles');
            setUserMogBattlesByUser((prev) => ({ ...prev, [uid]: data.battles || [] }));
          }).catch((err) => {
            setUserMogBattlesError((prev) => ({ ...prev, [uid]: err.message || 'Failed to fetch Mog Battles' }));
          })
        );
      }

      if (!userActivityByUser[uid]) {
        requests.push(
          fetch(`${API_BASE}/api/admin/users/${uid}/activity`, {
            headers: { 'x-admin-password': storedPw.current },
            cache: 'no-store',
          }).then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Failed to fetch activity');
            setUserActivityByUser((prev) => ({ ...prev, [uid]: data.events || [] }));
          }).catch((err) => {
            setUserActivityError((prev) => ({ ...prev, [uid]: err.message || 'Failed to fetch activity' }));
          })
        );
      }

      if (!userPurchasesByUser[uid]) {
        requests.push(
          fetch(`${API_BASE}/api/admin/users/${uid}/purchases`, {
            headers: { 'x-admin-password': storedPw.current },
            cache: 'no-store',
          }).then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Failed to fetch purchases');
            setUserPurchasesByUser((prev) => ({ ...prev, [uid]: data.purchases || [] }));
          }).catch((err) => {
            setUserPurchasesError((prev) => ({ ...prev, [uid]: err.message || 'Failed to fetch purchases' }));
          })
        );
      }

      await Promise.allSettled(requests);
    } finally {
      setUserScansLoading((prev) => ({ ...prev, [uid]: false }));
      setUserMogBattlesLoading((prev) => ({ ...prev, [uid]: false }));
      setUserActivityLoading((prev) => ({ ...prev, [uid]: false }));
      setUserPurchasesLoading((prev) => ({ ...prev, [uid]: false }));
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

  const handleDeleteAdminMogBattle = async (uid, battleId) => {
    try {
      const delRes = await fetch(`${API_BASE}/api/admin/mog-battles/${encodeURIComponent(battleId)}`, {
        method: 'DELETE',
        headers: { 'x-admin-password': storedPw.current }
      });
      const data = await delRes.json().catch(() => ({}));
      if (!delRes.ok) throw new Error(data.error || 'Failed to delete Mog Battle');
      setUserMogBattlesByUser((prev) => ({
        ...prev,
        [uid]: Array.isArray(prev[uid]) ? prev[uid].filter((battle) => battle.id !== battleId) : [],
      }));
    } catch (err) {
      setUserMogBattlesError((prev) => ({ ...prev, [uid]: err.message }));
    }
  };

  const handleViewUserScan = (uid, scanId) => {
    if (!uid || !scanId) return;
    const url = `${window.location.origin}/scan/${encodeURIComponent(uid)}/${encodeURIComponent(scanId)}?admin=1`;
    window.open(url, '_blank', 'noopener,noreferrer');
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
  const visitorBuckets = visitorStats?.buckets || [];
  const maxVisitorBucket = visitorBuckets.length ? Math.max(...visitorBuckets.map((bucket) => Number(bucket.count) || 0), 1) : 1;
  const limitedUserIds = new Set(scanLimits.map((limit) => limit.uid));

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

          <div className="mb-6 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Bell size={14} className="text-cyan-400" />
                <h3 className="font-sans text-xs uppercase tracking-widest text-zinc-300">Send Announcement</h3>
              </div>
              <span className="text-[9px] font-sans uppercase tracking-[0.2em] text-zinc-600">Notifies all users</span>
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,220px)_1fr_auto] md:items-end">
              <label className="block">
                <span className="mb-2 block text-[10px] font-sans uppercase tracking-[0.24em] text-zinc-500">Title</span>
                <input
                  value={announcementDraft.title}
                  onChange={(e) => setAnnouncementDraft((prev) => ({ ...prev, title: e.target.value }))}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-sans text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
                  placeholder="MogCheck Announcement"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-[10px] font-sans uppercase tracking-[0.24em] text-zinc-500">Message</span>
                <input
                  value={announcementDraft.body}
                  onChange={(e) => setAnnouncementDraft((prev) => ({ ...prev, body: e.target.value }))}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-sans text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
                  placeholder="Write the announcement..."
                />
              </label>
              <button
                type="button"
                onClick={handleSendAnnouncement}
                disabled={announcementSending}
                className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-5 py-3 text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-300 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
              >
                {announcementSending ? 'Sending...' : 'Send'}
              </button>
            </div>
            <label className="mt-3 block">
              <span className="mb-2 block text-[10px] font-sans uppercase tracking-[0.24em] text-zinc-500">Optional Link</span>
              <input
                value={announcementDraft.url}
                onChange={(e) => setAnnouncementDraft((prev) => ({ ...prev, url: e.target.value }))}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-sans text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
                placeholder="/news or /mog-battles"
              />
            </label>
            {announcementStatus && (
              <p className="mt-3 text-xs font-sans text-cyan-300">{announcementStatus}</p>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {/* API Key Health */}
            <div className="lg:col-span-2 bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Key size={14} className="text-cyan-400" />
                <h3 className="font-sans text-xs uppercase tracking-widest text-zinc-300">Gemini API Key Health</h3>
              </div>
              <div className="space-y-3">
                {(stats.keyHealth || []).map((k) => {
                  const remainingMin = Math.ceil((Number(k.quarantineRemainingMs) || 0) / 60000);
                  const disabledKey = k.disabled || k.key === 1 || k.key === 3;
                  const statusLabel = disabledKey
                    ? 'Disabled'
                    : k.quarantined
                      ? `Quarantined ${remainingMin}m`
                      : k.status === 'quota'
                        ? 'Quota hit'
                        : k.status === 'errors'
                        ? 'Errors'
                          : 'Healthy';
                  const notInUse = disabledKey || k.quarantined || k.status === 'quota';
                  const barClass = disabledKey
                    ? 'bg-gradient-to-r from-zinc-700 to-zinc-500'
                    : k.quarantined || k.status === 'quota'
                      ? 'bg-gradient-to-r from-red-600 to-red-400'
                      : k.status === 'errors'
                        ? 'bg-gradient-to-r from-amber-600 to-amber-300'
                        : 'bg-gradient-to-r from-cyan-600 to-cyan-400';
                  const dotClass = disabledKey
                    ? 'bg-zinc-500 shadow-[0_0_8px_rgba(113,113,122,0.45)]'
                    : k.quarantined || k.status === 'quota'
                      ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                      : k.status === 'errors'
                        ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                        : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]';
                  return (
                    <div key={k.key} className="space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-sans text-zinc-500 w-12 shrink-0">KEY {k.key}</span>
                        <div className="flex-grow h-2.5 bg-zinc-950 rounded-full overflow-hidden relative">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${barClass}`}
                            style={{ width: `${disabledKey || k.quarantined ? 100 : Math.min(100, (k.attempts / 250) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-sans text-zinc-500 w-16 text-right shrink-0">{k.attempts}/250</span>
                        <span className="w-5 shrink-0 text-center">
                          {notInUse ? (
                            <X size={14} strokeWidth={3} className="inline-block text-red-400 drop-shadow-[0_0_7px_rgba(248,113,113,0.55)]" />
                          ) : (
                            <span className={`inline-block w-2.5 h-2.5 rounded-full ${dotClass}`} />
                          )}
                        </span>
                      </div>
                      <div className="ml-[60px] flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-sans uppercase tracking-[0.16em]">
                        <span className={disabledKey || k.quarantined ? 'text-red-300' : k.status === 'errors' ? 'text-amber-300' : 'text-emerald-300'}>
                          {statusLabel}
                        </span>
                        {(k.quarantineReason || k.quarantineDetail) && (
                          <span className="max-w-[min(100%,440px)] truncate text-zinc-600 normal-case tracking-normal">
                            {k.quarantineReason || k.quarantineDetail}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[9px] font-sans text-zinc-600 mt-3">Keys 1 and 3 are disabled. Failed keys are auto-quarantined before the next randomized scan attempt.</p>
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

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5 mb-6">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Users size={14} className="text-cyan-400" />
                <h3 className="font-sans text-xs uppercase tracking-widest text-zinc-300">Unique Website Visitors</h3>
              </div>
              <span className="text-[9px] font-sans uppercase tracking-[0.2em] text-zinc-600">
                {visitorStats?.totalUnique ?? 0} unique
              </span>
              <div className="ml-auto flex flex-wrap gap-2">
                {[
                  ['hour', 'Last hour'],
                  ['6h', '6 hours'],
                  ['24h', '24 hours'],
                  ['week', 'Week'],
                ].map(([range, label]) => (
                  <button
                    key={range}
                    type="button"
                    onClick={() => setVisitorRange(range)}
                    className={`rounded-lg border px-3 py-1.5 text-[9px] font-sans uppercase tracking-[0.22em] transition-colors ${visitorRange === range ? 'border-cyan-500/35 bg-cyan-500/10 text-cyan-300' : 'border-zinc-800 bg-zinc-950/60 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {visitorStatsLoading ? (
              <div className="py-10 text-center text-zinc-500 text-xs font-sans uppercase tracking-widest">Loading visitor graph...</div>
            ) : visitorStatsError ? (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs font-sans text-red-400">{visitorStatsError}</div>
            ) : (
              <div className="flex h-28 items-end gap-[3px]">
                {(visitorBuckets.length ? visitorBuckets : Array(12).fill(null)).map((bucket, i) => {
                  const count = Number(bucket?.count) || 0;
                  const h = maxVisitorBucket > 0 ? (count / maxVisitorBucket) * 100 : 0;
                  return (
                    <div key={bucket?.startMs || i} className="group relative flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t-sm bg-gradient-to-t from-cyan-700 to-cyan-300 transition-all duration-300 group-hover:opacity-80"
                        style={{ height: `${Math.max(h, count > 0 ? 6 : 2)}%`, opacity: count > 0 ? 1 : 0.25 }}
                      >
                        <div className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded bg-zinc-800 px-1.5 py-0.5 text-[8px] font-sans text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100 whitespace-nowrap">
                          {count} unique
                        </div>
                      </div>
                      {i % Math.max(1, Math.ceil((visitorBuckets.length || 12) / 6)) === 0 && (
                        <span className="text-[7px] font-sans text-zinc-600">{bucket?.label || '-'}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
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
                      {['Time', 'Model', 'Status', 'Rating', 'Score AI', 'Duration', 'Details'].map(h => (
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
                          <span className={`text-[10px] font-sans px-2 py-0.5 rounded-full ${['1','2','6'].includes(a.model) ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'}`}>
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
                        <td className="py-2.5 pr-4 text-[11px] font-sans text-cyan-300">{fmtDuration(a.coreAiDurationMs)}</td>
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
            <>
            <div className="mb-6 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-amber-300" />
                  <h3 className="font-sans text-xs uppercase tracking-widest text-zinc-300">Daily Scan Limits</h3>
                </div>
                <button
                  type="button"
                  onClick={refreshScanLimits}
                  disabled={scanLimitsLoading}
                  className="rounded-lg border border-zinc-700 bg-zinc-900/70 px-3 py-2 text-[10px] font-sans uppercase tracking-widest text-zinc-300 transition-colors hover:border-amber-400/40 hover:text-amber-200 disabled:opacity-50"
                >
                  {scanLimitsLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
              <p className="mb-4 text-xs font-sans leading-relaxed text-zinc-500">
                Users shown here are currently in low-priority scan handling because they passed the daily fair-usage threshold or were manually limited by an admin.
              </p>
              {scanLimitsError ? (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs font-sans text-red-400">{scanLimitsError}</div>
              ) : scanLimits.length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-black/20 px-4 py-5 text-center text-xs font-sans uppercase tracking-widest text-zinc-500">
                  No users are currently limited.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-zinc-800/60">
                        {['User', 'Source', 'Scans Today', 'Delay', 'Active', 'Actions'].map((h) => (
                          <th key={h} className="pb-2 pr-4 text-[9px] font-sans uppercase tracking-widest text-zinc-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {scanLimits.map((limit) => (
                        <tr key={limit.uid} className="border-b border-zinc-800/30">
                          <td className="py-3 pr-4">
                            <div className="text-xs font-sans text-zinc-200">{limit.email}</div>
                            <div className="max-w-[180px] truncate text-[10px] font-sans text-zinc-600">{limit.uid}</div>
                          </td>
                          <td className="py-3 pr-4">
                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-sans uppercase tracking-[0.22em] ${limit.manualLimit ? 'border-amber-500/25 bg-amber-500/10 text-amber-300' : 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300'}`}>
                              {limit.manualLimit ? 'Manual' : 'Daily usage'}
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-xs font-sans text-zinc-300">{limit.scansToday}</td>
                          <td className="py-3 pr-4 text-xs font-sans text-zinc-400">{fmtDuration(limit.minimumDurationMs)}</td>
                          <td className="py-3 pr-4 text-xs font-sans text-zinc-400">{limit.activeCount || 0}/{limit.maxConcurrent || '-'}</td>
                          <td className="py-3 pr-4">
                            <button
                              type="button"
                              onClick={() => handleUnlimitUser(limit.uid)}
                              disabled={!!scanLimitActionLoading[limit.uid]}
                              className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[10px] font-sans uppercase tracking-widest text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                            >
                              {scanLimitActionLoading[limit.uid] ? 'Saving...' : 'Unlimit'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

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
                    {adminUserSections.map((section) => (
                      <React.Fragment key={section.id}>
                        <tr className="border-b border-zinc-800/50 bg-black/35">
                          <td colSpan={4} className="px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-300">{section.title}</span>
                              <span className="text-[9px] font-sans uppercase tracking-[0.22em] text-zinc-600">
                                {section.users.length} user{section.users.length === 1 ? '' : 's'}
                              </span>
                            </div>
                          </td>
                        </tr>
                        {section.users.length === 0 && (
                          <tr className="border-b border-zinc-800/30">
                            <td colSpan={4} className="px-4 py-5 text-center text-xs font-sans text-zinc-600">
                              No users in this category.
                            </td>
                          </tr>
                        )}
                        {section.users.map((u) => {
                      const isActive = u.lastActive && (new Date() - new Date(u.lastActive)) < 5 * 60 * 1000;
                      const isExpanded = expandedUserId === u.uid;
                      const isPlanExpanded = expandedPlanUserId === u.uid;
                      const scans = userScansByUser[u.uid] || [];
                      const scansLoading = !!userScansLoading[u.uid];
                      const scansError = userScansError[u.uid];
                      const mogBattles = userMogBattlesByUser[u.uid] || [];
                      const mogBattlesLoading = !!userMogBattlesLoading[u.uid];
                      const mogBattlesError = userMogBattlesError[u.uid];
                      const activityEvents = userActivityByUser[u.uid] || [];
                      const activityLoading = !!userActivityLoading[u.uid];
                      const activityError = userActivityError[u.uid];
                      const purchases = userPurchasesByUser[u.uid] || [];
                      const purchasesLoading = !!userPurchasesLoading[u.uid];
                      const purchasesError = userPurchasesError[u.uid];
                      const planDraft = planDrafts[u.uid] || { plan: u.plan || 'free', scanCredits: u.scanCredits ?? 0 };
                      const isSavingPlan = !!planSaveLoading[u.uid];
                      const planError = planSaveError[u.uid];
                      const isRateLimited = limitedUserIds.has(u.uid);
                      return (
                        <React.Fragment key={u.uid}>
                          <tr className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                            <td className="py-3 pr-4">
                              <div className="font-sans text-xs text-zinc-300">{u.email}</div>
                              <div className="font-sans text-[10px] text-zinc-600 truncate max-w-[150px]">{u.uid}</div>
                            </td>
                            <td className="py-3 pr-4">
                              <div className="font-sans text-[11px] text-cyan-400 uppercase tracking-wider">{u.planLabel || u.plan}</div>
                              <div className="font-sans text-[10px] text-zinc-500">{u.scanCredits} credits</div>
                              {u.proDaysLeft != null && (
                                <div className="font-sans text-[10px] text-emerald-400">{u.proDaysLeft} days left</div>
                              )}
                            </td>
                            <td className="py-3 pr-4">
                              <div className="flex items-center gap-1.5">
                                <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-zinc-600'}`}></span>
                                <span className="font-sans text-[11px] text-zinc-400">{isActive ? 'Online' : (u.lastActive ? new Date(u.lastActive).toLocaleString() : 'Never')}</span>
                              </div>
                              <div className="font-sans text-[10px] text-zinc-600 mt-0.5">{u.lastIp} {u.lastPlatform ? `- ${u.lastPlatform}` : ''}</div>
                            </td>
                            <td className="py-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button onClick={() => handleToggleUserScans(u.uid)} className={`px-2 py-1 rounded text-[10px] font-sans uppercase tracking-widest transition-colors ${isExpanded ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-300' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'}`}>{isExpanded ? 'Hide' : 'Scans'}</button>
                                <button
                                  onClick={() => (isRateLimited ? handleUnlimitUser(u.uid) : handleLimitUser(u.uid, u.email))}
                                  disabled={!!scanLimitActionLoading[u.uid]}
                                  className={`px-2 py-1 rounded text-[10px] font-sans uppercase tracking-widest transition-colors border ${isRateLimited ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/25' : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/25'} disabled:opacity-50`}
                                >
                                  {scanLimitActionLoading[u.uid] ? '...' : (isRateLimited ? 'Unlimit' : 'Limit')}
                                </button>
                                <button onClick={() => handleToggleUserPlan(u.uid, u.plan, u.scanCredits)} className={`px-2 py-1 rounded text-[10px] font-sans uppercase tracking-widest transition-colors ${isPlanExpanded ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-300' : 'bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'}`}>{isPlanExpanded ? 'Hide' : 'Plan'}</button>
                                <button onClick={() => setPendingAdminDeleteUser({ uid: u.uid, email: u.email })} className="px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded text-[10px] font-sans uppercase tracking-widest transition-colors">Del</button>
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
                                        <option value="pro_monthly">PRO - MONTHLY</option>
                                        <option value="pro_annual">PRO - ANNUAL</option>
                                        <option value="pro_infinite">PRO - INFINITE</option>
                                        <option value="pro">pro legacy</option>
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
                                        const frontImage = resolveMediaUrl(scan.frontImageUrl || scan.payload?.frontImage || null);
                                        const sideImage = resolveMediaUrl(scan.sideImageUrl || scan.payload?.sideImage || frontImage || null);
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
              <span className="text-sm font-black text-zinc-100">{scan.finalRating ?? '-'}/100</span>
                                                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-sans uppercase tracking-[0.22em] text-cyan-300">{modelLabel(scan.model)}</span>
                                                <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[9px] font-sans uppercase tracking-[0.22em] text-violet-300">{scan.platform || scan.payload?.platform || 'unknown'}</span>
                                                {scan.profileId && <span className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[9px] font-sans uppercase tracking-[0.22em] text-zinc-400">{scan.profileId}</span>}
                                              </div>
                                              <p className="mt-2 text-[10px] font-sans uppercase tracking-[0.24em] text-zinc-500">{formatTimestamp(scan.timestamp || scan.scannedAt || scan.createdAt)}</p>
                                              {scan.payload?.technicalSummary && (
                                                <p className="mt-2 line-clamp-2 text-xs font-sans leading-relaxed text-zinc-400">{scan.payload.technicalSummary}</p>
                                              )}
                                            </div>
                                            <div className="flex flex-wrap items-start gap-2">
                                              <button onClick={() => handleViewUserScan(u.uid, scan.id)} className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-[10px] font-sans uppercase tracking-[0.22em] text-cyan-300 transition-colors hover:bg-cyan-500/20">
                                                View analysis
                                              </button>
                                              <button onClick={() => handleDeleteUserScan(u.uid, scan.id)} className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[10px] font-sans uppercase tracking-[0.22em] text-red-300 transition-colors hover:bg-red-500/20">
                                                Delete
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}

                                  <div className="mt-6 grid gap-4 border-t border-zinc-800/70 pt-5 lg:grid-cols-2">
                                    <div>
                                      <div className="mb-4 flex items-center justify-between gap-3">
                                        <div>
                                          <p className="text-[10px] font-sans uppercase tracking-[0.28em] text-zinc-500">Activity log</p>
                                          <h4 className="mt-1 text-sm font-black uppercase tracking-widest text-zinc-100">Pages and votes</h4>
                                        </div>
                                        <span className="text-[10px] font-sans uppercase tracking-widest text-zinc-600">{activityEvents.length} events</span>
                                      </div>
                                      {activityLoading ? (
                                        <div className="py-8 text-center text-zinc-500 text-xs font-sans uppercase tracking-widest">Loading activity...</div>
                                      ) : activityError ? (
                                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs font-sans text-red-400">{activityError}</div>
                                      ) : activityEvents.length === 0 ? (
                                        <div className="py-6 text-center text-zinc-500 text-xs font-sans uppercase tracking-widest">No activity logged yet.</div>
                                      ) : (
                                        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                                          {activityEvents.slice(0, 80).map((event, index) => (
                                            <div key={event.id || index} className="rounded-xl border border-zinc-800 bg-zinc-900/35 p-3">
                                              <div className="flex flex-wrap items-center gap-2">
                                                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-sans uppercase tracking-[0.22em] ${event.type === 'mog_battle_vote' ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300' : 'border-zinc-700 bg-zinc-800/60 text-zinc-400'}`}>
                                                  {event.type === 'mog_battle_vote' ? 'Vote' : 'Page'}
                                                </span>
                                                <span className="text-xs font-sans text-zinc-200">
                                                  {event.type === 'mog_battle_vote'
                                                    ? `${event.battleName || event.battleId || 'Mog Battle'} - ${String(event.side || '').toUpperCase()}`
                                                    : (event.page || event.path || 'Unknown page')}
                                                </span>
                                                <span className="ml-auto rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[9px] font-sans uppercase tracking-[0.22em] text-violet-300">{event.platform || 'unknown'}</span>
                                              </div>
                                              <p className="mt-2 text-[10px] font-sans uppercase tracking-[0.24em] text-zinc-600">{formatTimestamp(event.timestamp || event.timestampMs)}</p>
                                              {event.path && <p className="mt-1 truncate text-[10px] font-sans text-zinc-600">{event.path}</p>}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>

                                    <div>
                                      <div className="mb-4 flex items-center justify-between gap-3">
                                        <div>
                                          <p className="text-[10px] font-sans uppercase tracking-[0.28em] text-zinc-500">Purchase history</p>
                                          <h4 className="mt-1 text-sm font-black uppercase tracking-widest text-zinc-100">Payments</h4>
                                        </div>
                                        <span className="text-[10px] font-sans uppercase tracking-widest text-zinc-600">{purchases.length} records</span>
                                      </div>
                                      {purchasesLoading ? (
                                        <div className="py-8 text-center text-zinc-500 text-xs font-sans uppercase tracking-widest">Loading purchases...</div>
                                      ) : purchasesError ? (
                                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs font-sans text-red-400">{purchasesError}</div>
                                      ) : purchases.length === 0 ? (
                                        <div className="py-6 text-center text-zinc-500 text-xs font-sans uppercase tracking-widest">No purchases found.</div>
                                      ) : (
                                        <div className="space-y-2">
                                          {purchases.map((purchase) => (
                                            <div key={purchase.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/35 p-3">
                                              <div className="min-w-0">
                                                <p className="truncate text-xs font-black uppercase tracking-widest text-zinc-100">{purchase.label || purchase.plan || 'Purchase'}</p>
                                                <p className="mt-1 text-[10px] font-sans uppercase tracking-[0.24em] text-zinc-600">{formatTimestamp(purchase.purchasedAt || purchase.purchasedAtMs)}</p>
                                              </div>
                                              <div className="text-right">
                                                <p className="text-xs font-bold text-emerald-300">{purchase.amount ? `${purchase.currency || 'USD'} ${purchase.amount}` : '-'}</p>
                                                <p className="text-[9px] font-sans uppercase tracking-[0.22em] text-zinc-600">{purchase.status || 'completed'}</p>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>

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
                                                <button onClick={() => handleDeleteAdminMogBattle(u.uid, battle.id)} className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[10px] font-sans uppercase tracking-[0.22em] text-red-300 transition-colors hover:bg-red-500/20">
                                                  Delete
                                                </button>
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
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
                {users.length === 0 && (
                  <div className="text-center py-8 text-zinc-500 font-sans text-xs">No users found.</div>
                )}
              </div>
            </div>
            </>
          )}
        </>
      )}

      {loading && !stats && (
        <div className="flex items-center justify-center py-32">
          <Loader2 size={24} className="text-cyan-400 animate-spin" />
        </div>
      )}

      {pendingAdminDeleteUser && (
        <ConfirmDialog
          title="Delete User?"
          body={`Are you sure you want to permanently delete user ${pendingAdminDeleteUser.email || pendingAdminDeleteUser.uid}?`}
          confirmLabel="Delete User"
          tone="danger"
          onClose={() => setPendingAdminDeleteUser(null)}
          onConfirm={() => handleDeleteUser(pendingAdminDeleteUser.uid, pendingAdminDeleteUser.email)}
        />
      )}

      {adminNotice && (
        <SiteModal title="Admin Notice" onClose={() => setAdminNotice('')} maxWidth="max-w-lg">
          <p className="text-sm leading-relaxed text-zinc-300">{adminNotice}</p>
        </SiteModal>
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
    { week: 'Month 1-2', title: 'Research & Consultation', icon: '01', tasks: ['Research board-certified surgeons in your area', 'Book 2-3 consultations for multiple opinions', 'Review before/after galleries of each surgeon', 'Ask about complication rates and revision rates', 'Get imaging/morphs done during consultations'] },
    { week: 'Month 2-3', title: 'Pre-Operative Preparation', icon: '02', tasks: ['Complete all required bloodwork and imaging', 'Stop blood thinners, supplements, and smoking', 'Arrange 1-2 weeks off work for recovery', 'Prepare recovery area at home (ice, soft foods, pillows)', 'Take standardized baseline photos (front, side, 45 degrees)'] },
    { week: 'Day of Surgery', title: 'Procedure Day', icon: '03', tasks: ['Follow NPO (nothing by mouth) instructions', 'Arrive with a responsible adult for transport', 'Confirm procedure details with your surgeon', 'Follow all pre-op nursing instructions'] },
    { week: 'Week 1-2', title: 'Acute Recovery', icon: '04', tasks: ['Apply ice 20 min on / 20 min off for first 48 hours', 'Sleep elevated at 30-45 degrees to minimize swelling', 'Soft/liquid diet for the first week', 'Take prescribed medications on schedule', 'Attend your first post-op checkup'] },
    { week: 'Week 3-6', title: 'Healing Phase', icon: '05', tasks: ['Swelling continues to reduce - be patient', 'Gradually reintroduce normal diet and activity', 'Avoid contact sports and strenuous exercise', 'Take weekly progress photos for comparison', 'Follow up with surgeon at 4-6 week mark'] },
    { week: 'Month 3-12', title: 'Final Results', icon: '06', tasks: ['Most swelling resolved by month 3; final form by month 12', 'Compare progress photos against pre-op baseline', 'Schedule 6-month and 12-month follow-up visits', 'Discuss any asymmetries or concerns with surgeon', 'Consider complementary protocols if needed'] },
  ] : [
    { week: 'Week 1', title: 'Setup & Baseline', icon: '01', tasks: ['Take standardized baseline photos (front, side, 45 degrees)', 'Purchase all required products or equipment', 'Set daily reminders/alarms for consistency', 'Journal your starting measurements if applicable', 'Research proper technique and application methods'] },
    { week: 'Week 2-4', title: 'Building the Habit', icon: '02', tasks: ['Apply the protocol daily without skipping', 'Track adherence in a habit tracker or journal', 'Note any skin sensitivity or adverse reactions', 'Take weekly progress photos in the same lighting', 'Adjust dosage/frequency if irritation occurs'] },
    { week: 'Month 2-3', title: 'Early Adaptation', icon: '03', tasks: ['First subtle changes may become visible', 'Compare month 2 photos vs. baseline side-by-side', 'Increase intensity/frequency if well-tolerated', 'Re-evaluate product quality and consider upgrades', 'Stay consistent - this is where most people quit'] },
    { week: 'Month 3-6', title: 'Visible Transformation', icon: '04', tasks: ['Clear, measurable changes vs. baseline', 'Document with high-quality progress photos', 'Evaluate whether to continue, intensify, or maintain', 'Begin transitioning to maintenance dosage if applicable', 'Stack with complementary protocols for compound gains'] },
    { week: 'Month 6+', title: 'Maintenance', icon: '05', tasks: ['Shift to maintenance frequency/dosage', 'Take monthly comparison photos', 'Focus on the next highest-impact protocol', 'Re-evaluate every 3 months for continued relevance', 'Share progress with your community for accountability'] },
  ];

  const cleanProtocolText = (value) =>
    String(value || '')
      .replace(/Ãƒâ€šÃ‚Â°|Ã‚Â°/g, ' degrees')
      .replace(/ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â|Ã¢â‚¬â€|Ã¢â‚¬â€œ/g, '-')
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const displayTimelinePhases = timelinePhases.map((phase, index) => ({
    ...phase,
    icon: String(index + 1).padStart(2, '0'),
    week: cleanProtocolText(phase.week),
    title: cleanProtocolText(phase.title),
    tasks: phase.tasks.map(cleanProtocolText),
  }));

  const totalTasks = displayTimelinePhases.reduce((sum, p) => sum + p.tasks.length, 0);
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
              <span className={`text-[9px] font-sans uppercase tracking-widest px-2.5 py-1 rounded-full border ${/extreme|critical|highest/i.test(protocol?.impact) ? 'text-red-400 border-red-500/20 bg-red-500/10' : /high/i.test(protocol?.impact) ? 'text-orange-400 border-orange-500/20 bg-orange-500/10' : /medium/i.test(protocol?.impact) ? 'text-yellow-400 border-yellow-500/20 bg-yellow-500/10' : 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10'}`}>{protocol?.impact || 'Medium Impact'}</span>
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
          {displayTimelinePhases.map((phase, i) => {
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
              <h3 className="text-white font-bold uppercase text-sm tracking-widest">{displayTimelinePhases[activePhase]?.title}</h3>
              <span className="text-cyan-400 font-sans text-[10px] uppercase tracking-widest">{displayTimelinePhases[activePhase]?.week}</span>
            </div>
            <div className="text-right">
              <span className="text-zinc-500 font-sans text-[10px]">
                {displayTimelinePhases[activePhase]?.tasks.filter((_, ti) => checkedTasks[`${activePhase}-${ti}`]).length}/{displayTimelinePhases[activePhase]?.tasks.length} tasks
              </span>
            </div>
          </div>
          <div className="space-y-2">
            {displayTimelinePhases[activePhase]?.tasks.map((task, ti) => {
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
          {displayTimelinePhases.map((phase, i) => {
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
    if (/extreme|critical|highest/i.test(impact)) return 'text-red-400';
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
  /** When set from Pro dashboard Run a new scan, upload page pre-selects this model (1-5). */
  const [pendingUploadModel, setPendingUploadModel] = useState(null);
  const [pendingUploadProfileId, setPendingUploadProfileId] = useState(null);
  const [selectedCelebrity, setSelectedCelebrity] = useState(null);
  const [routeParams, setRouteParams] = useState(initialLocation.routeParams);
  const [dashboardRoute, setDashboardRoute] = useState(initialLocation.dashboardRoute);
  const [user, setUser] = useState(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [userPlan, setUserPlan] = useState({ plan: 'free', scanCredits: 0, dailyFreeLimit: 1, dailyScansRemaining: 1, loaded: false });
  const [analysisJobs, setAnalysisJobs] = useState([]);
  const [analysisDockCollapsed, setAnalysisDockCollapsed] = useState(false);
  const [focusedAnalysisJobId, setFocusedAnalysisJobId] = useState(null);
  const [premiumProofOpen, setPremiumProofOpen] = useState(false);
  const analysisJobsRef = useRef([]);

  useEffect(() => {
    analysisJobsRef.current = analysisJobs;
  }, [analysisJobs]);

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

  const openPremiumPlansProof = useCallback(() => {
    if (currentPage === 'plans') {
      setCurrentPage('plans');
      return;
    }
    setPremiumProofOpen(true);
  }, [currentPage, setCurrentPage]);

  const continueToPremiumPlans = useCallback(() => {
    setPremiumProofOpen(false);
    setCurrentPage('plans');
  }, [setCurrentPage]);

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
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthResolved(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user?.uid) { setUserPlan({ plan: 'free', scanCredits: 0, dailyFreeLimit: 1, dailyScansRemaining: 1, loaded: true }); return; }
    setUserPlan((prev) => ({ ...prev, loaded: false }));
    let cancelled = false;

    const applyPlan = (data = {}) => {
      if (cancelled) return;
      const subscriptionEnd = data.subscriptionCurrentPeriodEnd || null;
      const subscriptionEndMs = timestampToMillis(subscriptionEnd);
      const computedProDaysLeft = subscriptionEndMs > Date.now()
        ? Math.max(0, Math.ceil((subscriptionEndMs - Date.now()) / 86400000))
        : null;
      setUserPlan((prev) => ({
        ...prev,
        plan: normalizePlanValue(data.plan || 'free'),
        planLabel: data.planLabel || null,
        scanCredits: data.scanCredits ?? 0,
        subscriptionId: data.subscriptionId || null,
        subscriptionStatus: data.subscriptionStatus || null,
        subscriptionCurrentPeriodEnd: subscriptionEnd,
        proDaysLeft: data.proDaysLeft ?? computedProDaysLeft ?? null,
        dailyFreeLimit: data.dailyFreeLimit ?? prev.dailyFreeLimit ?? 1,
        dailyScansToday: data.dailyScansToday ?? prev.dailyScansToday ?? 0,
        dailyScansRemaining: data.dailyScansRemaining ?? prev.dailyScansRemaining ?? 1,
        updatedAt: data.updatedAt || null,
        loaded: true,
      }));
    };

    const fetchPlanFromApi = async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`${API_BASE}/api/user/plan`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Plan fetch failed (${res.status})`);
        applyPlan(body);
      } catch (err) {
        console.error('Backend user plan fetch failed', err);
        if (!cancelled) {
          setUserPlan((prev) => ({ ...prev, loaded: true }));
        }
      }
    };

    fetchPlanFromApi();
    
    // Setup Firestore listener for user plan
    const unsubscribe = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          applyPlan(data);
        } else {
          fetchPlanFromApi();
        }
      },
      (err) => {
        console.error('User plan listener failed', err);
        fetchPlanFromApi();
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
    const heartbeatInterval = setInterval(sendHeartbeat, 300000); // every 5 minutes
    const planRefreshInterval = setInterval(fetchPlanFromApi, 60000);
    window.addEventListener('focus', fetchPlanFromApi);

    return () => {
      cancelled = true;
      unsubscribe();
      clearInterval(heartbeatInterval);
      clearInterval(planRefreshInterval);
      window.removeEventListener('focus', fetchPlanFromApi);
    };
  }, [user?.uid]);

  useEffect(() => { window.scrollTo(0, 0); }, [currentPage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const logPageVisit = async () => {
      try {
        const visitorKey = 'mogcheck_visitor_id';
        let visitorId = window.localStorage.getItem(visitorKey);
        if (!visitorId) {
          visitorId = `visitor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          window.localStorage.setItem(visitorKey, visitorId);
        }
        const headers = { 'Content-Type': 'application/json' };
        if (user) {
          const token = await user.getIdToken();
          headers.Authorization = `Bearer ${token}`;
        }
        if (cancelled) return;
        fetch(`${API_BASE}/api/activity/page`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            page: currentPage,
            path: `${window.location.pathname}${window.location.search}`,
            visitorId,
            platform: /mobi|android|iphone|ipad|ipod|opera mini|opera mobi/i.test(window.navigator.userAgent) ? 'mobile' : 'desktop',
          }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Activity logging should never block navigation.
      }
    };
    logPageVisit();
    return () => {
      cancelled = true;
    };
  }, [currentPage, user?.uid]);

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
    return model === '1' || model === '2' || model === '6' || model === '7' || model === '8' || model === '9';
  }, [dashboardData?.selectedModel]);

  useEffect(() => {
    const reportStatus = String(dashboardData?.reportStatus || dashboardData?.payload?.reportStatus || '').toLowerCase();
    const scanRequestId = String(dashboardData?.scanRequestId || dashboardData?.payload?.scanRequestId || '').trim();
    if (!user || reportStatus !== 'generating' || !scanRequestId) return;

    let cancelled = false;
    let inFlight = false;

    const applyReportUpdate = (nextData) => {
      if (!nextData || cancelled) return;
      setDashboardData((prev) => {
        if (!prev) return normalizeDashboardMedia(nextData);
        return normalizeDashboardMedia({
          ...prev,
          ...nextData,
          scanHistory: Array.isArray(prev.scanHistory) ? prev.scanHistory : nextData.scanHistory,
          ratingHistory: Array.isArray(prev.ratingHistory) ? prev.ratingHistory : nextData.ratingHistory,
        });
      });
      setAnalysisJobs((prev) =>
        prev.map((job) => {
          const jobScanRequestId = String(job.scanRequestId || job.result?.scanRequestId || '').trim();
          if (jobScanRequestId !== scanRequestId || !job.result) return job;
          return {
            ...job,
            result: normalizeDashboardMedia({
              ...job.result,
              ...nextData,
            }),
          };
        })
      );
    };

    const pollReportStatus = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        const token = await user.getIdToken();
        const res = await fetch(`${API_BASE}/api/analyze/status/${encodeURIComponent(scanRequestId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const nextData = body.payload || (body.scan ? buildRecoveredScanPayload(body.scan) : null);
        const nextReportStatus = String(nextData?.reportStatus || nextData?.payload?.reportStatus || '').toLowerCase();
        if (nextData && nextReportStatus && nextReportStatus !== 'generating') {
          applyReportUpdate(nextData);
        }
      } catch (error) {
        console.warn('Detailed report status poll failed', error);
      } finally {
        inFlight = false;
      }
    };

    pollReportStatus();
    const interval = setInterval(pollReportStatus, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    user,
    dashboardData?.scanRequestId,
    dashboardData?.payload?.scanRequestId,
    dashboardData?.reportStatus,
    dashboardData?.payload?.reportStatus,
  ]);

  const useProDashboard = Boolean(user || hasScanData) && !isFreeModelDashboard;
  const isScanOnlyPage = currentPage === 'public-scan';

  const registerCompletedScan = useCallback((data, meta = {}, options = {}) => {
    const completedAt = new Date().toISOString();
    const usesSideProfile = Boolean(meta.sideImageUrl || meta.sideImageFile);
    const completedScan = normalizeDashboardMedia({
      ...data,
      scanRequestId: data?.scanRequestId || meta.scanRequestId || null,
      frontImage: data?.frontImage || meta.mainImageSrc || null,
      sideImage: usesSideProfile ? (data?.sideImage || meta.sideImageUrl || null) : null,
      debugAnchorsImage: data?.debugAnchorsImage || data?.debugAnchorsImageUrl || null,
      debugAnchorsImageUrl: data?.debugAnchorsImageUrl || data?.debugAnchorsImage || null,
      debugRatiosImage: data?.debugRatiosImage || data?.debugRatiosImageUrl || null,
      debugRatiosImageUrl: data?.debugRatiosImageUrl || data?.debugRatiosImage || null,
      selectedModel: String(data?.selectedModel || meta.choice || '3'),
      profileId: meta.profileId && meta.profileId !== 'new' ? meta.profileId : 'default',
      scannedAt: data?.scannedAt || completedAt,
      _handoffSavedAt: completedAt,
    });

    if (!options?.skipDashboardUpdate) {
      setDashboardData((prev) => {
        const sameProfile =
          String(prev?.profileId || 'default').trim() === completedScan.profileId;
        const newScanHistory =
          sameProfile && Array.isArray(prev?.scanHistory) ? [...prev.scanHistory] : [];
        const newRatingHistory =
          sameProfile && Array.isArray(prev?.ratingHistory) ? [...prev.ratingHistory] : [];

        if (sameProfile && prev && prev.frontImage && prev.finalRating && newScanHistory.length === 0) {
          newScanHistory.push({
            ...prev,
            scannedAt: prev.scannedAt || completedAt,
          });
        }
        if (sameProfile && prev && prev.finalRating && newRatingHistory.length === 0) {
          newRatingHistory.push(prev.finalRating);
        }

        const dedupedScanHistory = appendUniqueScan(newScanHistory, completedScan);
        if (completedScan.finalRating != null && !Number.isNaN(Number(completedScan.finalRating))) {
          newRatingHistory.push(Number(completedScan.finalRating));
        }

        return {
          ...completedScan,
          scanHistory: dedupedScanHistory.slice(-PROFILE_SCAN_HISTORY_LIMIT),
          ratingHistory: newRatingHistory.slice(-PROFILE_SCAN_HISTORY_LIMIT),
        };
      });
    }

    return completedScan;
  }, []);

  const queueAnalysisJob = useCallback((jobInput = {}) => {
    const jobId =
      createClientRequestId('analysis');
    const scanRequestId =
      String(jobInput.scanRequestId || '').trim() ||
      createClientRequestId('scan');

    const baseJob = {
      id: jobId,
      scanRequestId,
      state: 'running',
      createdAt: Date.now(),
      ...jobInput,
      scanRequestId,
    };

    const onComplete = (data, options = {}) => {
      const latestJob = analysisJobsRef.current.find((job) => job.id === jobId) || baseJob;
      const completedScan = registerCompletedScan(data, latestJob, options);
      setAnalysisJobs((prev) =>
        prev.map((job) =>
          job.id === jobId
            ? { ...job, state: 'complete', result: completedScan, completedAt: Date.now() }
            : job
        )
      );
      if (!options?.skipDashboardUpdate) {
        setDashboardData(completedScan);
        setCurrentPage('dashboard');
      }
    };

    const queuedJob = { ...baseJob, onComplete };
    setFocusedAnalysisJobId(jobId);
    setAnalysisDockCollapsed(false);
    setAnalysisJobs((prev) => [queuedJob, ...prev]);
    return queuedJob;
  }, [registerCompletedScan, setCurrentPage]);

  const updateAnalysisJobStatus = useCallback((jobId, status = {}) => {
    setAnalysisJobs((prev) =>
      prev.map((job) =>
        job.id === jobId && job.state === 'running'
          ? { ...job, ...status }
          : job
      )
    );
  }, []);

  const dismissAnalysisJob = useCallback((jobId) => {
    setAnalysisJobs((prev) => prev.filter((job) => job.id !== jobId));
  }, []);

  const openAnalysisResult = useCallback((jobId) => {
    const job = analysisJobsRef.current.find((entry) => entry.id === jobId);
    if (!job?.result) return;
    setDashboardData(job.result);
    setCurrentPage('dashboard');
    setAnalysisJobs((prev) => prev.filter((entry) => entry.id !== jobId));
  }, [setCurrentPage]);

  const openRunningAnalysisJob = useCallback((jobId) => {
    const job = analysisJobsRef.current.find((entry) => entry.id === jobId);
    if (!job) return;
    if (job.state === 'complete') {
      openAnalysisResult(jobId);
      return;
    }
    setFocusedAnalysisJobId(jobId);
    setAnalysisDockCollapsed(false);
    setCurrentPage('analysis');
  }, [openAnalysisResult, setCurrentPage]);

  const focusedAnalysisJob = analysisJobs.find((job) => job.id === focusedAnalysisJobId) || null;

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
      {!isScanOnlyPage && (
        <Navbar
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
          onOpenPremiumPlans={openPremiumPlansProof}
          user={user}
          onSignOut={handleSignOut}
          userPlan={userPlan}
          showDashboard={Boolean(user || hasScanData)}
        />
      )}
      {premiumProofOpen && (
        <PremiumProofModal
          onClose={() => setPremiumProofOpen(false)}
          onContinue={continueToPremiumPlans}
        />
      )}
      <main className="flex flex-col min-h-screen">
        <React.Suspense fallback={<PageLoadingFallback />}>
        {currentPage === 'home' && <HomePage setCurrentPage={setCurrentPage} user={user} queueAnalysisJob={queueAnalysisJob} />}
        {currentPage === 'photo-guide' && <PhotoGuidePage setCurrentPage={setCurrentPage} />}
        {currentPage === 'analysis' && <ConsultingStatusPage job={focusedAnalysisJob} setCurrentPage={setCurrentPage} user={user} />}
        {currentPage === 'animations' && <ScanAnimationsPage routeParams={routeParams} setCurrentPage={setCurrentPage} />}
        {(currentPage === 'upload-photo' || currentPage === 'upload-ultra') && (
          <UploadPhotoPage
            key={`upload-${currentPage}-${pendingUploadModel ?? 'default'}`}
            setCurrentPage={setCurrentPage}
            setDashboardData={setDashboardData}
            setSelectedCelebrity={setSelectedCelebrity}
            user={user}
            userPlan={userPlan}
            initialModel={pendingUploadModel ?? (currentPage === 'upload-ultra' ? '6' : '3')}
            isLockedToUltra={currentPage === 'upload-ultra'}
            initialProfileId={pendingUploadProfileId}
            queueAnalysisJob={queueAnalysisJob}
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
                    ? <DashboardPage dashboardData={dashboardData} setDashboardData={setDashboardData} setCurrentPage={setCurrentPage} onOpenPremiumPlans={openPremiumPlansProof} userPlan={userPlan} user={user} hideTopSection isEmbedded />
                    : null
                }
                renderCommunityDashboard={(communityData) => (
                  <DashboardPage
                    dashboardData={communityData}
                    setCurrentPage={setCurrentPage}
                    onOpenPremiumPlans={openPremiumPlansProof}
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
            : (
              <DashboardPage
                dashboardData={dashboardData}
                setDashboardData={setDashboardData}
                setCurrentPage={setCurrentPage}
                onOpenPremiumPlans={openPremiumPlansProof}
                userPlan={userPlan}
                user={user}
                onBackToProfiles={() => {
                  setDashboardData(null);
                  setCurrentPage('dashboard');
                }}
                onOpenHistoryScan={(scan) => {
                  setDashboardData(scan);
                  setCurrentPage('dashboard');
                }}
              />
            )
        )}
        {currentPage === 'plans' && <PlansPage setCurrentPage={setCurrentPage} user={user} />}
        {currentPage === 'mog-battles' && (
          <MogBattlePage2 user={user} setCurrentPage={setCurrentPage} />
        )}
        {currentPage === 'login' && <LoginPage setCurrentPage={setCurrentPage} user={user} />}
        {currentPage === 'register' && <RegisterPage setCurrentPage={setCurrentPage} user={user} />}

        {currentPage === 'public-profile' && (
          <PublicProfilePage routeParams={routeParams} user={user} />
        )}
        {currentPage === 'profile' && (
          <UserProfilePage user={user} userPlan={userPlan} setCurrentPage={setCurrentPage} />
        )}
        {currentPage === 'celebrity' && <ScansPage2 setCurrentPage={setCurrentPage} setSelectedCelebrity={setSelectedCelebrity} user={user} />}
        {currentPage === 'celebrity-stats' && selectedCelebrity && <CelebrityStatsPage celeb={selectedCelebrity} setCurrentPage={setCurrentPage} />}
        {currentPage === 'public-scan' && (
          <PublicProfilePage
            routeParams={routeParams}
            user={user}
            scanOnly
            renderScanDashboard={(scanDashboardData) => {
              const scanModel = scanDashboardData?.selectedModel || scanDashboardData?.model || scanDashboardData?.payload?.selectedModel;
              return (
                <DashboardPage
                  dashboardData={scanDashboardData}
                  setCurrentPage={setCurrentPage}
                  onOpenPremiumPlans={openPremiumPlansProof}
                  userPlan={userPlan}
                  user={user}
                  hideTopSection
                  isEmbedded
                  forceFullAnalysis={!isFreeScanModel(scanModel)}
                />
              );
            }}
          />
        )}
        {currentPage === 'admin' && <AdminDashboardPage setCurrentPage={setCurrentPage} />}
        {currentPage === 'protocol-all' && <AllProtocolsPage protocols={dashboardData?.protocols || []} setCurrentPage={setCurrentPage} />}
        {currentPage === 'tos' && <TermsOfServicePage setCurrentPage={setCurrentPage} />}
        {currentPage === 'privacy' && <PrivacyPolicyPage setCurrentPage={setCurrentPage} />}
        {currentPage === 'settings' && <SettingsPage setCurrentPage={setCurrentPage} user={user} userPlan={userPlan} dashboardData={dashboardData} />}
        {currentPage.startsWith('protocol-') && currentPage !== 'protocol-all' && (() => {
          const pid = parseInt(currentPage.split('-')[1]);
          const allProtos = dashboardData?.protocols || [];
          const proto = allProtos.find(p => p.id === pid) || { id: pid, name: `Protocol ${pid}`, description: '', impact: 'Medium Impact' };
          return <ProtocolDetailPage protocol={proto} allProtocols={allProtos} setCurrentPage={setCurrentPage} />;
        })()}
        </React.Suspense>
      </main>
      <AnalysisDock
        jobs={analysisJobs}
        collapsed={analysisDockCollapsed}
        setCollapsed={setAnalysisDockCollapsed}
        onOpenResult={openAnalysisResult}
        onOpenRunning={openRunningAnalysisJob}
        onJobStatusChange={updateAnalysisJobStatus}
        onDismiss={dismissAnalysisJob}
        currentPage={currentPage}
      />
      {!isScanOnlyPage && (
        <footer className="py-12 border-t border-zinc-900 flex flex-col items-center gap-6 bg-[#090a0b]">
          <AdminFooterTrigger setCurrentPage={setCurrentPage} />
          <div className="flex gap-6">
             <button onClick={() => setCurrentPage('tos')} className="text-zinc-500 hover:text-zinc-300 text-xs font-sans transition-colors uppercase tracking-widest">Terms of Service</button>
             <button onClick={() => setCurrentPage('privacy')} className="text-zinc-500 hover:text-zinc-300 text-xs font-sans transition-colors uppercase tracking-widest">Privacy Policy</button>
          </div>
          <p className="text-zinc-600 text-[10px] font-sans uppercase tracking-[0.5em]">Peak Performance Aesthetics (c) 2026</p>
        </footer>
      )}
    </div>
  );
};

// --- Scans Page 2 ---
const ScansPage2 = ({ setCurrentPage, setSelectedCelebrity, user }) => {
  const [communityScans, setCommunityScans] = useState([]);
  const [filterMode, setFilterMode] = useState('all');
  const [communitySort, setCommunitySort] = useState('latest');
  const [communityPeek, setCommunityPeek] = useState(null);
  const [communityRemovalIntent, setCommunityRemovalIntent] = useState(null);
  const [communityNotice, setCommunityNotice] = useState('');
  const [communityMenuId, setCommunityMenuId] = useState(null);
  const isAdmin = Boolean(user?.email && (
    user.email === 'laithbu07@gmail.com' ||
    user.email === 'admin@looksmaxxing.com' ||
    user.email === 'serenity.eyb@gmail.com' ||
    user.email.endsWith('@looksmaxxing.com')
  ));

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
        const { fetchCommunityScans, fetchCommunityBattles } = await import('./api/mogBattleVotes');
        const res = await fetchCommunityScans(80);
        let loadedScans = (res.scans || [])
          .map((scan, idx) => hydrateCommunityScanEntry(scan, idx))
          .filter((scan) => scan?.dashboardData && scan?.frontImage);

        if (loadedScans.length === 0) {
          const battleRes = await fetchCommunityBattles();
          const scansMap = new Map();
          battleRes.battles.forEach(b => {
            if (b.fighterA) scansMap.set(b.fighterA.scanId || b.fighterA.profileId || b.fighterA.name, { ...b.fighterA, isCommunity: true });
            if (b.fighterB) scansMap.set(b.fighterB.scanId || b.fighterB.profileId || b.fighterB.name, { ...b.fighterB, isCommunity: true });
          });
          loadedScans = Array.from(scansMap.values())
            .map((scan, idx) => hydrateCommunityScanEntry(scan, idx))
            .filter((scan) => scan?.dashboardData && scan?.frontImage);
        }

        if (loadedScans.length === 0) {
          loadedScans = COMMUNITY_SCANS.map((s, i) =>
            hydrateCommunityScanEntry({ ...s, name: `User ${i + 1}`, isCommunity: true, profileId: `mock-${i}` }, i)
          );
        }
        
        const merged = new Map();
        [...OFFICIAL_CELEBRITY_COMMUNITY_SCANS, ...loadedScans].forEach((scan, idx) => {
          const hydrated = hydrateCommunityScanEntry(scan, idx);
          const key = hydrated.scanId || hydrated.id || `${hydrated.frontImage}-${idx}`;
          if (hydrated?.dashboardData && hydrated?.frontImage && !merged.has(key)) merged.set(key, hydrated);
        });

        setCommunityScans(Array.from(merged.values()));
      } catch(e) {
        console.error(e);
        const merged = new Map();
        [
          ...OFFICIAL_CELEBRITY_COMMUNITY_SCANS,
          ...COMMUNITY_SCANS.map((scan, idx) =>
            hydrateCommunityScanEntry({ ...scan, name: scan.name || `User ${idx + 1}`, isCommunity: true, profileId: scan.profileId || `mock-${idx}` }, idx)
          ),
        ].forEach((scan, idx) => {
          const hydrated = hydrateCommunityScanEntry(scan, idx);
          const key = hydrated.scanId || hydrated.id || `${hydrated.frontImage}-${idx}`;
          if (hydrated?.dashboardData && hydrated?.frontImage && !merged.has(key)) merged.set(key, hydrated);
        });

        setCommunityScans(Array.from(merged.values()));
      }
    };
    fetchCommunity();
  }, []);

  const getCelebrityScanShareUrl = useCallback((scan) => {
    const ownerUid = String(scan?.ownerUid || scan?.uid || '').trim();
    const scanId = String(scan?.scanId || scan?.id || '').trim();
    if (ownerUid && scanId && !scan?.officialScan) {
      return `${window.location.origin}/scan/${encodeURIComponent(ownerUid)}/${encodeURIComponent(scanId)}`;
    }
    return `${window.location.origin}/celebrity?scan=${encodeURIComponent(scanId || scan?.id || 'community')}`;
  }, []);

  const shareCommunityScan = useCallback(async (scan) => {
    const url = getCelebrityScanShareUrl(scan);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCommunityNotice('Scan link copied.');
      } else {
        setCommunityNotice(url);
      }
    } catch {
      setCommunityNotice(url);
    }
  }, [getCelebrityScanShareUrl]);

  const removeOwnedCommunityScan = async (scan) => {
    if (!user || !scan?.scanId) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/scans/${encodeURIComponent(scan.scanId)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: 'private' }),
      });
      if (!res.ok) throw new Error('Failed to update scan visibility');
      setCommunityScans((prev) => prev.filter((item) => item.id !== scan.id && item.scanId !== scan.scanId));
      setCommunityNotice('Scan removed from Community Scans. It is still saved privately on your dashboard.');
    } catch (e) {
      setCommunityNotice(e.message || 'Failed to remove scan from Community Scans.');
    } finally {
      setCommunityRemovalIntent(null);
    }
  };

  const removeAdminCommunityScan = async (scan) => {
    const password = window.localStorage.getItem('mogcheck_admin_pw') || '';
    if (!password || !scan?.id) {
      setCommunityNotice('Admin password is required. Log into the admin panel once, then try again.');
      setCommunityRemovalIntent(null);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/admin/community-scans/${encodeURIComponent(scan.id)}`, {
        method: 'DELETE',
        headers: { 'x-admin-password': password },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to remove community scan listing');
      setCommunityScans((prev) => prev.filter((item) => item.id !== scan.id && item.scanId !== scan.scanId));
      setCommunityNotice('Community scan listing removed. The saved user scan was not deleted.');
    } catch (e) {
      setCommunityNotice(e.message || 'Failed to remove community scan listing.');
    } finally {
      setCommunityRemovalIntent(null);
      setCommunityMenuId(null);
    }
  };

  const removeCommunityScan = async (scan) => {
    const isOwner = Boolean(user?.uid && scan?.ownerUid && scan.ownerUid === user.uid && scan?.scanId);
    if (isOwner) return removeOwnedCommunityScan(scan);
    if (isAdmin) return removeAdminCommunityScan(scan);
    setCommunityRemovalIntent(null);
    return undefined;
  };

  const markCommunityScanOfficial = async (scan, official = true) => {
    const password = window.localStorage.getItem('mogcheck_admin_pw') || '';
    if (!password || !scan?.id) {
      setCommunityNotice('Admin password is required. Log into the admin panel once, then try again.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/admin/community-scans/${encodeURIComponent(scan.id)}/official`, {
        method: 'POST',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({ official }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to update official status');
      setCommunityScans((prev) => prev.map((item) => (item.id === scan.id ? { ...item, officialScan: official, official } : item)));
      setCommunityNotice(official ? 'Scan marked as official.' : 'Scan turned back into a normal community scan.');
    } catch (e) {
      setCommunityNotice(e.message || 'Failed to update official status.');
    } finally {
      setCommunityMenuId(null);
    }
  };

  const filteredScans = useMemo(() => {
    let scans = communityScans.filter((rawScan) => rawScan?.dashboardData && rawScan?.frontImage);
    if (filterMode === 'verified') {
      scans = scans.filter(s => s.officialScan);
    } else if (filterMode === 'community') {
      scans = scans.filter(s => !s.officialScan);
    }
    
    return scans.sort((a, b) => {
      if (communitySort === 'highest') {
        const ratingDiff = (Number(b.finalRating) || 0) - (Number(a.finalRating) || 0);
        if (ratingDiff) return ratingDiff;
      }
      return timestampToMillis(b.timestamp || b.scannedAt || b.createdAt) - timestampToMillis(a.timestamp || a.scannedAt || a.createdAt);
    });
  }, [communityScans, filterMode, communitySort]);

  return (
    <div className="w-full flex-grow pt-28 pb-16 px-4 sm:px-6 relative flex flex-col items-center overflow-x-hidden min-h-screen">
      {communityPeek && communityPeek.dashboardData && (
        <div
          className="fixed inset-0 z-[220] flex flex-col bg-[#0a0a0b] overflow-y-auto"
          role="dialog"
          aria-modal="true"
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
              <h2 className="truncate font-black uppercase italic tracking-tight text-white">
                Community Scan
              </h2>
            </div>
          </header>
          <div className="flex-1 px-4 pb-16 pt-6 md:px-8">
            <button
              type="button"
              onClick={() => setCommunityPeek(null)}
              className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/[0.07] px-4 py-2 font-sans text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100 transition-colors hover:border-cyan-300/60 hover:bg-cyan-400/10"
            >
              <ArrowLeft size={14} />
              Go to previous page
            </button>
            <DashboardPage
              dashboardData={forceCommunityScanFrontOnly(communityPeek.dashboardData)}
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
      <div className="w-full max-w-[1400px] mx-auto flex flex-col items-center text-center">
        <h2 className="text-3xl font-black italic uppercase tracking-widest text-white mb-2">Scans 2</h2>
        <p className="text-zinc-500 uppercase tracking-widest text-xs mb-8">Verified scans and live community scans with shareable links.</p>

        {/* Filters */}
        <div className="flex flex-col md:flex-row items-center gap-6 mb-10 w-full justify-between max-w-2xl bg-black/40 border border-white/5 p-4 rounded-[28px] shadow-[0_10px_40px_rgba(0,0,0,0.3)] backdrop-blur-md z-10 relative">
          <div className="flex bg-zinc-900/50 p-1 rounded-full border border-white/5 w-full md:w-auto">
            {['all', 'verified', 'community'].map(mode => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={`flex-1 md:flex-none px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.18em] transition-all duration-300 ${
                  filterMode === mode
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/30 shadow-[0_0_15px_rgba(34,211,238,0.15)]'
                    : 'text-zinc-500 hover:text-white border border-transparent'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

            <CustomSelectDropdown
              value={communitySort}
              onChange={setCommunitySort}
              options={[
                { value: 'latest', label: 'Latest' },
                { value: 'highest', label: 'Highest score' }
              ]}
              className="appearance-none rounded-full border border-cyan-400/20 bg-cyan-400/[0.06] px-5 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100 focus:border-cyan-300/50"
            />
        </div>

        {/* 3 Grid Layout */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6 w-full text-left pb-24 md:pb-16">
          {filteredScans.map((rawScan, idx) => {
            const scan = hydrateCommunityScanEntry(rawScan, idx);
            const isOwnedCommunityScan = Boolean(user?.uid && scan.ownerUid && scan.ownerUid === user.uid && scan.scanId && !scan.officialScan);
            const rating = Number(scan.finalRating || 0);
            const ratingTone = getRatingToneClasses(rating);
            const scanTier = scan.tier || '-';
            const tierUpper = String(scanTier).toUpperCase();
            const tierBadgeClass =
              tierUpper.includes('S') && tierUpper.includes('TIER')
                ? 'bg-red-500/20 text-red-500 border-red-500/30 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                : tierUpper.includes('A') && tierUpper.includes('TIER')
                  ? 'bg-orange-500/20 text-orange-400 border-orange-500/30 shadow-[0_0_8px_rgba(249,115,22,0.6)]'
                  : 'bg-zinc-700/40 text-zinc-300 border-zinc-600/50';

            return (
              <CommunityScanCard
                key={scan.id || idx}
                scan={scan}
                rating={rating}
                ratingTone={ratingTone}
                tierBadgeClass={tierBadgeClass}
                scanTier={scanTier}
                isOwnedCommunityScan={isOwnedCommunityScan}
                isAdmin={isAdmin}
                communityMenuId={communityMenuId}
                compact={false}
                onOpen={() => {
                  if (!scan.dashboardData) return;
                  setCommunityPeek(scan);
                }}
                onShare={() => shareCommunityScan(scan)}
                onRemove={() => setCommunityRemovalIntent(scan)}
                onToggleMenu={() => setCommunityMenuId((prev) => (prev === scan.id ? null : scan.id))}
                onMarkOfficial={(official) => markCommunityScanOfficial(scan, official)}
              />
            );
          })}
        </div>
        
        {filteredScans.length === 0 && (
          <p className="py-24 text-center text-sm text-zinc-500 w-full font-bold uppercase tracking-widest">No scans found in this category.</p>
        )}

      </div>
      {communityRemovalIntent && (
        <ConfirmDialog
          title="Remove From Community?"
          body={isAdmin && !(user?.uid && communityRemovalIntent?.ownerUid === user.uid)
            ? 'This removes the public Community Scans listing only. The saved user scan will not be deleted.'
            : 'This will set the scan back to private. It will stay saved on your dashboard, but it will disappear from Community Scans.'}
          confirmLabel="Remove"
          tone="danger"
          onClose={() => setCommunityRemovalIntent(null)}
          onConfirm={() => removeCommunityScan(communityRemovalIntent)}
        />
      )}
      {communityNotice && (
        <SiteModal title="Community Scan" onClose={() => setCommunityNotice('')} maxWidth="max-w-lg">
          <p className="text-sm leading-relaxed text-zinc-300">{communityNotice}</p>
        </SiteModal>
      )}
    </div>
  );
};

export default App;

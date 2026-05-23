import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, ChevronRight, Crown, Heart, History, Lock, Plus, Share2, ShieldCheck, Swords, Trash2, Trophy, X, Activity, Sparkles } from 'lucide-react';
import { getAllFeaturedBattles, getMetricRowsForBattle } from '../data/mogBattles';
import {
  adminDeleteCommunityBattle,
  deleteCommunityBattle,
  fetchCommunityBattles,
  fetchCommunityScans,
  fetchFollowedMogBattles,
  fetchMogBattleTallies,
  fetchMyMogBattleVote,
  postCommunityBattle,
  postMogBattleVote,
  setMogBattleFollow,
} from '../api/mogBattleVotes';
import { getApiBase } from '../utils/apiBase';
import { resolveMediaUrl } from '../utils/mediaUrl';
import { celebrityData } from '../data/celebrityData';

const API_BASE = getApiBase();

const FOLLOWED_BATTLES_STORAGE_KEY = 'mogcheck-followed-battles';

const overlayCardClass =
  'rounded-[28px] border border-zinc-800 bg-[#0b0c0d]/95 shadow-[0_30px_120px_rgba(0,0,0,0.55)] backdrop-blur-xl';

const ModalShell = ({ title, subtitle, onClose, children, maxWidth = 'max-w-4xl' }) => (
  <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
    <div className={`w-full ${maxWidth} ${overlayCardClass} max-h-[90vh] overflow-hidden`}>
      <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4 md:px-6">
        <div>
          <h3 className="text-lg font-black uppercase tracking-[0.16em] text-white">{title}</h3>
          {subtitle ? <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-zinc-500">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-zinc-800 p-2 text-zinc-400 transition-all hover:border-zinc-700 hover:text-white hover:scale-105"
        >
          <X size={16} />
        </button>
      </div>
      <div className="max-h-[calc(90vh-84px)] overflow-y-auto px-5 py-5 md:px-6 md:py-6">
        {children}
      </div>
    </div>
  </div>
);

const isAdminAccount = (user) => Boolean(user?.email && (
  user.email === 'laithbu07@gmail.com' ||
  user.email === 'admin@looksmaxxing.com' ||
  user.email === 'serenity.eyb@gmail.com' ||
  user.email.endsWith('@looksmaxxing.com')
));

const timestampToMillis = (value) => {
  if (!value) return 0;
  if (typeof value === 'number') return value < 1000000000000 ? value * 1000 : value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  if (typeof value?._seconds === 'number') return value._seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const MOG_BATTLE_BANNED_NAME_TERMS = [
  'porn', 'porno', 'xxx', 'nsfw', 'nude', 'nudes', 'naked', 'sex', 'sexual',
  'onlyfans', 'pornhub', 'xvideos', 'xnxx',
  'dick', 'cock', 'penis', 'pussy', 'vagina', 'boob', 'boobs', 'tits',
  'fuck', 'fucker', 'fucking', 'shit', 'bitch', 'cunt', 'whore', 'slut',
  'nigger', 'nigga', 'faggot', 'retard'
];
const MOG_BATTLE_COMPACT_BANNED_NAME_TERMS = new Set([
  'porn', 'porno', 'xxx', 'nsfw', 'onlyfans', 'pornhub', 'xvideos', 'xnxx',
  'penis', 'pussy', 'vagina', 'boobs', 'fucker', 'fucking', 'cunt', 'whore', 'slut',
  'nigger', 'nigga', 'faggot', 'retard'
]);

const formatTimeAgo = (value) => {
  const ms = timestampToMillis(value);
  if (!ms) return '';
  const now = Date.now();
  const seconds = Math.floor((now - ms) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return new Date(ms).toLocaleDateString();
};

const getMogBattleNameError = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/(https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|gg|io|co|app|xyz|link|site|me)\b)/i.test(raw)) {
    return 'Face Battle names cannot contain links.';
  }
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const compact = raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const hasBannedTerm = MOG_BATTLE_BANNED_NAME_TERMS.some((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i').test(normalized) ||
      (MOG_BATTLE_COMPACT_BANNED_NAME_TERMS.has(term) && compact.includes(term));
  });
  return hasBannedTerm ? 'Face Battle names cannot contain inappropriate words.' : null;
};

const getPseudoVotes = (battleId, side, createdAt) => {
  const seed = String(battleId || 'battle') + side;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const absHash = Math.abs(hash);
  const baseVotes = 20 + (absHash % 11); // 20-30

  // Use a very recent date (May 10 2026) to ensure we stay in double digits
  const createdTime = timestampToMillis(createdAt) || 1746835200000;
  const daysPassed = Math.floor((Date.now() - createdTime) / (1000 * 60 * 60 * 24));

  const dailyInc = 2 + (Math.abs(hash * 13) % 5); // 2-6
  const totalInc = Math.max(0, daysPassed) * dailyInc;

  // Double digits only (20-99)
  return Math.min(99, baseVotes + totalInc);
};

const fighterName = (fighter, fallback = 'Fighter') =>
  String(fighter?.name || fighter?.displayName || fighter?.profileName || fallback).trim();

const fighterImage = (fighter) =>
  resolveMediaUrl(fighter?.frontImage || fighter?.frontImageUrl || fighter?.imgSrc || fighter?.imageUrl) ||
  'https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png';

const fighterScore = (fighter) => {
  const score = Number(fighter?.finalRating ?? fighter?.rating ?? fighter?.score);
  return Number.isFinite(score) ? score : 0;
};

const formatCount = (value) => {
  const n = Math.max(0, Number(value) || 0);
  return new Intl.NumberFormat('en-US').format(n);
};

const slugifyScanName = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'scan';

const getOfficialScanIdForFighter = (fighter) => {
  const name = fighterName(fighter, '').toLowerCase();
  if (!name) return '';
  const index = celebrityData.findIndex((celeb) => String(celeb?.name || '').toLowerCase() === name);
  if (index < 0) return '';
  return `official-${slugifyScanName(celebrityData[index]?.name)}-${index}`;
};

const MOG_BATTLE_ANALYSIS_PATH_OVERRIDES = {
  'asian mfer': '/scan/yREGOC6qwfWSOWy9WChsXK7F5I63/HHiiaT5UMhnMSwe0nzcy',
  diddy: '/celebrity?scan=gHPdnuRBUHFnkoyngzG0',
};

const leaderboardRankStyles = [
  {
    number: 'text-yellow-300 drop-shadow-[0_0_12px_rgba(250,204,21,0.20)]',
    background: 'linear-gradient(270deg, rgba(250,204,21,0.24) 0%, rgba(250,204,21,0.10) 32%, rgba(0,0,0,0) 72%), linear-gradient(90deg, rgba(16,185,129,0.18), rgba(16,185,129,0.045))',
    stripe: 'rgba(52,211,153,0.98)',
  },
  {
    number: 'text-zinc-200 drop-shadow-[0_0_10px_rgba(226,232,240,0.14)]',
    background: 'linear-gradient(270deg, rgba(226,232,240,0.20) 0%, rgba(226,232,240,0.08) 34%, rgba(0,0,0,0) 72%), linear-gradient(90deg, rgba(148,163,184,0.13), rgba(148,163,184,0.025))',
    stripe: 'rgba(226,232,240,0.78)',
  },
  {
    number: 'text-orange-400 drop-shadow-[0_0_10px_rgba(251,146,60,0.18)]',
    background: 'linear-gradient(270deg, rgba(205,127,50,0.24) 0%, rgba(205,127,50,0.10) 34%, rgba(0,0,0,0) 72%), linear-gradient(90deg, rgba(251,146,60,0.12), rgba(251,146,60,0.025))',
    stripe: 'rgba(251,146,60,0.82)',
  },
];

const fighterAnalysisPath = (fighter, currentUserUid = '') => {
  const model = String(fighter?.model || fighter?.payload?.model || '').trim();
  if (model === '3' || model === 'free') {
    return null;
  }

  const overridePath = MOG_BATTLE_ANALYSIS_PATH_OVERRIDES[fighterName(fighter, '').toLowerCase()];
  if (overridePath) return overridePath;

  const explicitOwnerUid = String(fighter?.ownerUid || fighter?.uid || '').trim();
  const ownerUid = String(explicitOwnerUid || currentUserUid || '').trim();
  const scanId = String(fighter?.scanId || fighter?.id || '').trim();
  const profileId = String(fighter?.profileId || '').trim();
  const officialScanId = getOfficialScanIdForFighter(fighter);
  const isOfficial = Boolean(fighter?.officialScan || fighter?.official || explicitOwnerUid === 'official' || officialScanId);

  if (isOfficial) {
    return `/celebrity?scan=${encodeURIComponent(officialScanId || scanId || fighter?.name || 'community')}`;
  }

  if (ownerUid && scanId && !isOfficial) return `/scan/${encodeURIComponent(ownerUid)}/${encodeURIComponent(scanId)}`;
  if (ownerUid && profileId && !isOfficial) return `/users/${encodeURIComponent(ownerUid)}/${encodeURIComponent(profileId)}`;

  return null;
};

const openInternalPath = (path) => {
  if (!path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event('popstate'));
};

const readFollowedBattleIds = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FOLLOWED_BATTLES_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
};

const scanMetricRows = (scan) => {
  const source = scan?.stats || scan?.biometrics || scan?.metrics || scan?.payload?.stats || scan?.payload?.biometrics || [];
  if (!Array.isArray(source)) return [];
  return source
    .map((metric) => ({
      label: metric?.label || metric?.name || metric?.key || 'Metric',
      score: Number(metric?.score ?? metric?.value ?? metric?.rating) || 0,
    }))
    .filter((metric) => metric.label && metric.score > 0)
    .slice(0, 8);
};

const scanToBattleFighter = (scan, fallback = 'Scan') => {
  const payload = scan?.payload && typeof scan.payload === 'object' ? scan.payload : {};
  const finalRating = Number(scan?.finalRating ?? payload.finalRating ?? payload.rating);
  return {
    ...payload,
    ...scan,
    name: scan?.name || payload.profileName || payload.displayName || payload.name || fallback,
    frontImage: resolveMediaUrl(scan?.frontImage || scan?.frontImageUrl || payload.frontImage || payload.imgSrc || null),
    sideImage: resolveMediaUrl(scan?.sideImage || scan?.sideImageUrl || payload.sideImage || null),
    finalRating: Number.isFinite(finalRating) ? finalRating : 0,
    stats: scanMetricRows(scan).length ? scanMetricRows(scan) : scanMetricRows(payload),
    technicalSummary: scan?.technicalSummary || payload.technicalSummary || payload.summary || scan?.summary || '',
    ownerUid: scan?.ownerUid || scan?.uid || payload.ownerUid || payload.uid || '',
    profileId: scan?.profileId || payload.profileId || '',
    scanId: scan?.scanId || scan?.id || payload.scanId || '',
    visibility: scan?.visibility || payload.visibility || 'private',
    sex: scan?.sex || payload.sex || payload.gender || '',
    model: scan?.model || payload.model || payload.modelUsed || '',
    cohesiveFrontSide: Boolean(scan?.cohesiveFrontSide || payload.cohesiveFrontSide),
  };
};

const normalizeStats = (fighter) => {
  const source = fighter?.stats || fighter?.biometrics || fighter?.metrics || fighter?.payload?.biometrics || [];
  return Array.isArray(source)
    ? source.map((item) => ({
        label: item?.label || item?.name || item?.key || 'Metric',
        score: Number(item?.score ?? item?.value ?? item?.rating) || 0,
      })).filter((item) => item.label && item.score > 0)
    : [];
};

const normalizeBattle = (battle) => {
  if (!battle?.fighterA || !battle?.fighterB) return null;
  const fighterA = {
    ...battle.fighterA,
    name: fighterName(battle.fighterA, 'Fighter A'),
    imgSrc: fighterImage(battle.fighterA),
    rating: fighterScore(battle.fighterA),
    stats: normalizeStats(battle.fighterA),
  };
  const fighterB = {
    ...battle.fighterB,
    name: fighterName(battle.fighterB, 'Fighter B'),
    imgSrc: fighterImage(battle.fighterB),
    rating: fighterScore(battle.fighterB),
    stats: normalizeStats(battle.fighterB),
  };
  const bId = String(battle.id || `${fighterA.name}-vs-${fighterB.name}`).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const cAt = battle.createdAt || battle.timestamp || battle.created_at || null;
  return {
    ...battle,
    id: bId,
    fighterA,
    fighterB,
    votesA: Number(battle.votesA || battle.a || 0) + getPseudoVotes(bId, 'a', cAt),
    votesB: Number(battle.votesB || battle.b || 0) + getPseudoVotes(bId, 'b', cAt),
    createdAt: cAt,
  };
};

const metricAliases = [
  { label: 'HARMONY', match: ['fwhr', 'facial width'] },
  { label: 'APPEAL', match: ['midface', 'mid face'] },
  { label: 'DIMORPHISM', match: ['canthal'] },
];

const metricRowsForFighter = (fighter, fallbackRows, side) => {
  const stats = normalizeStats(fighter);
  const fallbackBySide = (fallbackRows || []).map((row) => ({
    label: row.label,
    score: Number(side === 'a' ? row.scoreA : row.scoreB) || 0,
  }));
  return metricAliases.map((alias, index) => {
    const match = stats.find((metric) => {
      const label = String(metric.label || '').toLowerCase().replace(/[_-]+/g, ' ');
      return alias.match.some((needle) => label.includes(needle));
    }) || fallbackBySide.find((metric) => String(metric.label || '').toLowerCase().includes(alias.match[0])) || fallbackBySide[index];
    return {
      label: alias.label,
      score: Math.max(8, Math.min(100, Number(match?.score) || 48 + index * 9)),
    };
  });
};

const BattleMetricStack = ({ fighter, fallbackRows, side, tone = 'green' }) => {
  const rows = metricRowsForFighter(fighter, fallbackRows, side);
  const fillClass = tone === 'green'
    ? 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-400 shadow-[0_0_15px_rgba(20,184,166,0.42)]'
    : 'bg-gradient-to-r from-rose-600 via-rose-500 to-red-400 shadow-[0_0_15px_rgba(244,63,94,0.38)]';

  return (
    <div className="space-y-3 rounded-b-[18px] bg-[#050507] px-5 pb-5 pt-4 backdrop-blur-sm">
      {rows.map((metric, index) => {
        const percentage = Math.max(0, Math.min(100, Number(metric.score) || 0));

        return (
          <div
            key={`${side}-${metric.label}`}
            className="flex flex-col"
          >
            <div className="mb-1.5 flex items-end justify-between gap-3 text-[10px] uppercase text-zinc-400">
              <span className="font-black leading-tight tracking-[0.22em]">{metric.label}</span>
              <span className="text-sm font-black text-white">{Math.round(percentage)}/100</span>
            </div>
            <div className="relative flex h-2 w-full items-center overflow-hidden rounded-full bg-zinc-800/80 shadow-inner">
              <div
                className={`h-full rounded-full transition-all duration-1000 ease-out ${fillClass}`}
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const FighterBattleCard = ({ battle, side, stats, onVote, currentUserUid, actionSlot = null, hasVoted = false }) => {
  const fighter = side === 'a' ? battle.fighterA : battle.fighterB;
  const isWinner = Boolean(stats?.isWinner);

  const tone = hasVoted ? (isWinner ? 'green' : 'red') : 'neutral';
  const toneText = hasVoted ? (isWinner ? 'text-emerald-400' : 'text-rose-400') : 'text-white';
  const toneBorder = hasVoted ? (isWinner ? 'border-emerald-500/70' : 'border-rose-500/70') : 'border-white/10';
  const toneShadow = hasVoted ? (isWinner ? 'shadow-[0_0_64px_rgba(16,185,129,0.12)]' : 'shadow-[0_0_64px_rgba(244,63,94,0.12)]') : 'shadow-[0_0_40px_rgba(255,255,255,0.02)]';
  const voteClass = hasVoted
    ? (isWinner ? 'bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-[0_0_24px_rgba(16,185,129,0.24)] text-white' : 'bg-gradient-to-r from-rose-500 to-red-500 shadow-[0_0_24px_rgba(244,63,94,0.24)] text-white')
    : 'bg-white/10 hover:bg-white/20 border border-white/20 text-white';

  const path = fighterAnalysisPath(fighter, currentUserUid);

  return (
    <div
      onClick={() => {
        if (hasVoted && path) openInternalPath(path);
      }}
      className={`group relative w-full max-w-[414px] overflow-hidden rounded-[18px] border bg-[#050506] transition-all duration-700 ease-[cubic-bezier(.16,1,.3,1)] hover:-translate-y-2 ${toneBorder} ${toneShadow} ${hasVoted && path ? 'cursor-pointer' : ''}`}
    >
      <div className="relative aspect-[9/14] md:min-h-[405px] max-h-[535px] w-full overflow-hidden rounded-t-[18px]">
        <img
          src={fighterImage(fighter)}
          alt={fighterName(fighter)}
          className="absolute inset-0 h-full w-full object-cover object-top grayscale brightness-[0.74] contrast-[1.05] transition-all duration-700 ease-out group-hover:scale-[1.025] group-hover:brightness-[0.82]"
          loading="lazy"
          decoding="async"
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.08),transparent_34%),linear-gradient(180deg,rgba(0,0,0,0.02)_0%,rgba(0,0,0,0.12)_44%,rgba(0,0,0,0.90)_100%)]" />
        {actionSlot && (
          <div className="absolute right-5 top-5 z-20 flex items-center gap-4">
            {actionSlot}
          </div>
        )}
        {hasVoted && isWinner && (
          <div
            className="absolute left-5 top-5 z-10 inline-flex items-center gap-2.5 rounded-[12px] px-3.5 py-1.5 text-[14.5px] font-black uppercase tracking-[0.17em] text-emerald-300 shadow-[0_0_30px_rgba(16,185,129,0.16),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl"
            style={{
              border: '1px solid rgba(52, 211, 153, 0.20)',
              background: 'linear-gradient(135deg, rgba(16,185,129,0.24), rgba(5,78,63,0.30))',
            }}
          >
            <Trophy size={13} className="md:w-[15px]" /> Winner
          </div>
        )}
        <div className="absolute inset-x-3 md:inset-x-6 bottom-4 md:bottom-7 z-10">
          {hasVoted ? (
            <>
              <div className={`text-2xl md:text-5xl font-black tracking-[-0.04em] ${toneText}`}>{stats.percent}%</div>
              <div className="mt-1 text-[8px] md:text-xs font-black uppercase tracking-[0.22em] text-zinc-300">{formatCount(stats.votes)} votes</div>
            </>
          ) : (
            <div className="h-[40px] md:h-[76px]" />
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (hasVoted && path) {
                openInternalPath(path);
                return;
              }
              if (!hasVoted) onVote(side);
            }}
            className={`mt-3 md:mt-5 w-full rounded-lg px-3 py-2 md:px-5 md:py-3.5 text-[10px] md:text-sm font-black uppercase tracking-[0.18em] transition-all duration-300 ${!hasVoted ? 'hover:-translate-y-0.5' : 'cursor-default'} ${voteClass}`}
          >
            {hasVoted ? (path ? (window.innerWidth < 768 ? 'Analysis' : 'View Analysis') : 'Voted') : 'Vote'}
          </button>
        </div>
      </div>
      <div className={`grid transition-all duration-[800ms] ease-[cubic-bezier(.16,1,.3,1)] ${hasVoted ? 'grid-rows-[1fr] opacity-100 translate-y-0' : 'grid-rows-[0fr] opacity-0 -translate-y-6'}`}>
        <div className="min-h-0 overflow-hidden">
          <BattleMetricStack fighter={fighter} fallbackRows={getMetricRowsForBattle(battle.fighterA, battle.fighterB, 3)} side={side} tone={tone} />
        </div>
      </div>
    </div>
  );
};

const getBattleInsightSummary = (battle, percentA, percentB, winnerSide) => {
  const winner = winnerSide === 'a' ? battle.fighterA : battle.fighterB;
  const rowsA = metricRowsForFighter(battle.fighterA, getMetricRowsForBattle(battle.fighterA, battle.fighterB, 3), 'a');
  const rowsB = metricRowsForFighter(battle.fighterB, getMetricRowsForBattle(battle.fighterA, battle.fighterB, 3), 'b');
  const biggestDiff = rowsA.reduce((best, rowA, index) => {
    const rowB = rowsB[index] || {};
    const diff = Math.abs((Number(rowA.score) || 0) - (Number(rowB.score) || 0));
    return diff > best.diff ? { label: rowA.label || rowB.label || 'structure', diff } : best;
  }, { label: 'overall harmony', diff: 0 });

  return {
    winnerName: fighterName(winner),
    winnerPercent: winnerSide === 'a' ? percentA : percentB,
    opponentPercent: winnerSide === 'a' ? percentB : percentA,
    keyMetric: biggestDiff.label,
  };
};

const BattleStatsModal = ({ battle, onClose, currentUserUid }) => {
  if (!battle) return null;

  const scoreA = fighterScore(battle.fighterA);
  const scoreB = fighterScore(battle.fighterB);
  const winnerSide = scoreA > scoreB ? 'a' : scoreB > scoreA ? 'b' : 'tie';

  const votesA = Math.max(0, Number(battle.votesA) || 0);
  const votesB = Math.max(0, Number(battle.votesB) || 0);
  const totalVotes = votesA + votesB;
  const pctA = totalVotes > 0 ? Math.round((votesA / totalVotes) * 100) : 50;
  const pctB = totalVotes > 0 ? 100 - pctA : 50;

  const metricRows = getMetricRowsForBattle(battle.fighterA, battle.fighterB, 6);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center px-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
      <div className="w-full max-w-4xl rounded-[32px] border border-white/10 bg-[#08090b] shadow-[0_0_100px_rgba(0,0,0,0.9)] relative animate-[mogBattle2NoticeIn__0.4s_cubic-bezier(0.16,1,0.3,1)] overflow-hidden flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="px-8 py-7 md:px-12 md:py-9 flex justify-between items-center shrink-0 border-b border-white/5 relative">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />
          <div>
            <h2 className="text-xl md:text-2xl font-black uppercase tracking-[0.2em] text-white mb-1">
              Battle Stats
            </h2>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-500">
              {fighterName(battle.fighterA)} VS {fighterName(battle.fighterB)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-all duration-300 p-3 rounded-full hover:bg-white/10"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-8 md:p-12 overflow-y-auto flex-1 custom-scrollbar">
          <div className="space-y-10">

            {/* Fighter Info Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { f: battle.fighterA, side: 'a', score: scoreA },
                { f: battle.fighterB, side: 'b', score: scoreB }
              ].map(({ f, side, score }) => {
                const path = fighterAnalysisPath(f, currentUserUid);
                const isWinner = winnerSide === side;
                return (
                  <div key={side} className={`relative p-6 rounded-[24px] border bg-[#030405] transition-all duration-500 ${isWinner ? 'border-emerald-500/30 shadow-[0_0_40px_rgba(16,185,129,0.06)]' : 'border-white/5'}`}>
                    <div className="flex items-start gap-5">
                      <img
                        src={fighterImage(f)}
                        alt={fighterName(f)}
                        className="w-16 h-16 md:w-20 md:h-20 rounded-2xl object-cover border border-white/10"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <h3 className="text-base font-black uppercase tracking-widest text-white truncate">{fighterName(f)}</h3>
                          <span className={`text-xl md:text-2xl font-black italic ${isWinner ? 'text-emerald-400' : 'text-zinc-400'}`}>{score.toFixed(1)}</span>
                        </div>
                        {path && (
                          <button
                            onClick={() => openInternalPath(path)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-[9px] font-black uppercase tracking-widest text-cyan-300 hover:bg-cyan-500/20 transition-all"
                          >
                            View Full Analysis <Share2 size={10} />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="mt-5 text-xs text-zinc-400 leading-relaxed font-medium line-clamp-3 italic">
                      {f?.technicalSummary || f?.analysisSummary || f?.summary || 'No detailed analysis summary available yet.'}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Live Votes Bar */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Live Votes</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{formatCount(totalVotes)} Total</span>
              </div>
              <div className="relative h-2.5 md:h-3 w-full bg-zinc-900 rounded-full overflow-hidden flex border border-white/5">
                <div
                  className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-1000"
                  style={{ width: `${pctA}%` }}
                />
                <div
                  className="h-full bg-gradient-to-r from-rose-500 to-rose-600 transition-all duration-1000"
                  style={{ width: `${pctB}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-black uppercase tracking-[0.15em]">
                <div className="flex flex-col">
                   <span className="text-emerald-400">{fighterName(battle.fighterA)}</span>
                   <span className="text-zinc-500 mt-1">{formatCount(votesA)} — {pctA}%</span>
                </div>
                <div className="flex flex-col text-right">
                   <span className="text-rose-400">{fighterName(battle.fighterB)}</span>
                   <span className="text-zinc-500 mt-1">{formatCount(votesB)} — {pctB}%</span>
                </div>
              </div>
            </div>

            {/* Metric Breakdown */}
            <div className="pt-6 border-t border-white/5">
              <div className="flex items-center gap-3 mb-8">
                <ShieldCheck size={18} className="text-cyan-400" />
                <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-white">Final AI Rating & Metric Breakdown</h3>
              </div>

              <div className="space-y-6">
                {metricRows.map((row, idx) => (
                  <div key={row.key} className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
                    <div className="space-y-2">
                      <div className="h-2 w-full bg-zinc-900 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-1000 delay-100"
                          style={{ width: `${Math.min(100, row.scoreA)}%` }}
                        />
                      </div>
                      <div className="text-[10px] font-mono text-emerald-400 font-bold">{row.scoreA}</div>
                    </div>

                    <div className="min-w-[120px] md:min-w-[200px] text-center">
                      <span className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">{row.label}</span>
                    </div>

                    <div className="space-y-2">
                      <div className="h-2 w-full bg-zinc-900 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-l from-rose-600 to-rose-400 rounded-full transition-all duration-1000 delay-100"
                          style={{ width: `${Math.min(100, row.scoreB)}%` }}
                        />
                      </div>
                      <div className="text-[10px] font-mono text-rose-400 font-bold text-right">{row.scoreB}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

const BattleInsights = ({ battle, stats, hasVoted, onViewStats }) => {
  const totalVotes = Math.max(0, Number(stats.a.votes) || 0) + Math.max(0, Number(stats.b.votes) || 0);
  const winnerSide = stats.a.percent >= stats.b.percent ? 'a' : 'b';
  const winnerVotes = winnerSide === 'a' ? stats.a.votes : stats.b.votes;
  const opponentVotes = winnerSide === 'a' ? stats.b.votes : stats.a.votes;
  const insight = getBattleInsightSummary(battle, stats.a.percent, stats.b.percent, winnerSide);
  const ring = `conic-gradient(#10d68a 0deg ${insight.winnerPercent * 3.6}deg, #ff4758 ${insight.winnerPercent * 3.6}deg 360deg)`;

  return (
    <div className={`grid w-full transition-all duration-[800ms] ease-[cubic-bezier(.16,1,.3,1)] ${hasVoted ? 'mt-7 grid-rows-[1fr] opacity-100 translate-y-0' : 'grid-rows-[0fr] opacity-0 -translate-y-4'}`}>
      <div className="min-h-0 overflow-hidden">
        <div className="relative overflow-hidden rounded-[22px] border border-cyan-400/10 bg-[#061018]/90 px-6 py-6 shadow-[0_24px_80px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur md:px-7">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(0,240,255,0.10),transparent_34%),linear-gradient(90deg,rgba(0,240,255,0.045),rgba(0,0,0,0))]" />
          <div className="relative grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_146px_150px]">
            <div>
              <div className="mb-5 flex items-center gap-3">
                <BarChart3 size={20} className="text-cyan-400 drop-shadow-[0_0_12px_rgba(34,211,238,0.45)]" />
                <h3 className="text-[13px] font-black uppercase tracking-[0.24em] text-zinc-100">Battle Insights</h3>
              </div>
              <p className="text-sm font-semibold text-zinc-300">
                {insight.winnerName} is winning with {insight.winnerPercent}% of the votes.
              </p>
              <p className="mt-3 text-xs font-medium text-zinc-500">
                The biggest difference is in {insight.keyMetric} and overall scan strength.
              </p>
              {hasVoted && (
                <button
                  onClick={onViewStats}
                  className="mt-6 flex items-center gap-2.5 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 px-5 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200 transition-all hover:bg-cyan-400/15 hover:border-cyan-400/40 group active:scale-95"
                >
                  <BarChart3 size={15} className="text-cyan-400 group-hover:rotate-12 transition-transform" />
                  View Stats
                </button>
              )}
            </div>

            <div className="mx-auto flex h-[132px] w-[132px] items-center justify-center rounded-full p-[8px] shadow-[0_0_32px_rgba(16,214,138,0.16)]" style={{ background: ring }}>
              <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-[#071018] text-center shadow-[inset_0_0_22px_rgba(0,0,0,0.7)]">
                <span className="text-2xl font-black tracking-[-0.04em] text-white">{formatCount(totalVotes)}</span>
                <span className="mt-1 text-[9px] font-black uppercase leading-tight tracking-[0.18em] text-zinc-400">Total Votes</span>
              </div>
            </div>

            <div className="space-y-4 text-xs font-black uppercase tracking-[0.18em]">
              <div>
                <div className="flex items-center gap-2 text-emerald-400">
                  <span className="h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.6)]" />
                  Winner
                </div>
                <p className="mt-1 pl-5 text-sm tracking-normal text-zinc-400">{formatCount(winnerVotes)} ({insight.winnerPercent}%)</p>
              </div>
              <div>
                <div className="flex items-center gap-2 text-rose-400">
                  <span className="h-3 w-3 rounded-full bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.55)]" />
                  Opponent
                </div>
                <p className="mt-1 pl-5 text-sm tracking-normal text-zinc-400">{formatCount(opponentVotes)} ({insight.opponentPercent}%)</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const SortDropdown = ({ value, onChange }) => {
  const items = ['latest', 'popular'];
  const activeIndex = items.indexOf(value);
  return (
    <div className="relative inline-grid select-none grid-cols-2 overflow-hidden rounded-[20px] border border-cyan-500/30 bg-black/55 p-[1px] shadow-[0_0_34px_rgba(0,240,255,0.08)] backdrop-blur">
      <div
        className="pointer-events-none absolute bottom-[1px] top-[1px] w-1/2 rounded-[18px] bg-cyan-400/10 shadow-[0_0_24px_rgba(34,211,238,0.18)] transition-transform duration-300 ease-[cubic-bezier(.16,1,.3,1)]"
        style={{ transform: `translateX(${Math.max(0, activeIndex) * 100}%)` }}
      />
      {items.map((item) => {
        const selected = item === value;
        return (
          <div
            key={item}
            role="button"
            aria-pressed={selected}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onChange(item)}
            style={{ WebkitTapHighlightColor: 'transparent' }}
            className={`relative z-10 min-w-[110px] cursor-pointer rounded-[18px] px-5 py-3 text-center text-xs font-black uppercase tracking-[0.18em] transition-colors duration-300 ${selected ? 'text-cyan-100' : 'text-zinc-500 hover:text-cyan-200'}`}
          >
            {item}
          </div>
        );
      })}
    </div>
  );
};

const MogBattlePage2 = ({ user, setCurrentPage, dashboardData }) => {
  const [communityBattles, setCommunityBattles] = useState([]);
  const [sortBy, setSortBy] = useState('latest');
  const [activeBattleId, setActiveBattleId] = useState('');
  const [votesByBattle, setVotesByBattle] = useState({});
  const [resultsOpenByBattle, setResultsOpenByBattle] = useState({});
  const [talliesByBattle, setTalliesByBattle] = useState({});
  const [followedBattleIds, setFollowedBattleIds] = useState([]);
  const [notice, setNotice] = useState('');
  const [isNewBattleModalOpen, setIsNewBattleModalOpen] = useState(false);
  const [statsModalBattle, setStatsModalBattle] = useState(null);
  const [isFollowingModalOpen, setIsFollowingModalOpen] = useState(false);
  const admin = isAdminAccount(user);
  const [leaderboardExpanded, setLeaderboardExpanded] = useState(false);

  const battles = useMemo(() => {
    const featured = getAllFeaturedBattles().map(normalizeBattle).filter(Boolean);
    const combined = [...communityBattles];
    featured.forEach((battle) => {
      if (!combined.some((item) => String(item.id) === String(battle.id))) combined.push(battle);
    });
    return combined.map((battle) => {
      const tally = talliesByBattle[battle.id];
      if (tally) {
        return {
          ...battle,
          votesA: (Number(tally.a) || 0) + getPseudoVotes(battle.id, 'a', battle.createdAt),
          votesB: (Number(tally.b) || 0) + getPseudoVotes(battle.id, 'b', battle.createdAt)
        };
      }
      return battle;
    });
  }, [communityBattles, talliesByBattle]);

  const sortedBattles = useMemo(() => {
    const items = [...battles];
    if (sortBy === 'popular') {
      return items.sort((a, b) => (Number(b.votesA) + Number(b.votesB)) - (Number(a.votesA) + Number(a.votesB)));
    }
    return items.sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
  }, [battles, sortBy]);

  const activeBattle = sortedBattles.find((battle) => battle.id === activeBattleId) || sortedBattles[0] || null;
  const votedSide = activeBattle ? votesByBattle[activeBattle.id] : null;
  const resultsVisible = activeBattle ? Boolean(votedSide || resultsOpenByBattle[activeBattle.id]) : false;
  const activeStats = useMemo(() => {
    if (!activeBattle) return null;
    const votesA = Math.max(0, Number(activeBattle.votesA) || 0);
    const votesB = Math.max(0, Number(activeBattle.votesB) || 0);
    const total = votesA + votesB;
    const scoreA = fighterScore(activeBattle.fighterA);
    const scoreB = fighterScore(activeBattle.fighterB);
    const fallbackTotal = Math.max(1, scoreA + scoreB);
    const percentA = total > 0 ? Math.round((votesA / total) * 100) : Math.round((scoreA / fallbackTotal) * 100);
    const percentB = total > 0 ? 100 - percentA : 100 - percentA;
    const winnerSide = total > 0 ? (votesA >= votesB ? 'a' : 'b') : (scoreA >= scoreB ? 'a' : 'b');
    return {
      total,
      winnerSide,
      a: { percent: percentA, votes: votesA, isWinner: winnerSide === 'a' },
      b: { percent: percentB, votes: votesB, isWinner: winnerSide === 'b' },
    };
  }, [activeBattle]);
  const leaderboard = useMemo(() => {
    const map = new Map();
    battles.forEach((battle) => {
      [
        { fighter: battle.fighterA, side: 'a' },
        { fighter: battle.fighterB, side: 'b' },
      ].forEach(({ fighter, side }) => {
        const key = `${fighterName(fighter)}|${fighterImage(fighter)}`;
        const current = map.get(key) || {
          key,
          name: fighterName(fighter),
          image: fighterImage(fighter),
          score: fighterScore(fighter),
          wins: 0,
          fighter,
        };
        const other = side === 'a' ? battle.fighterB : battle.fighterA;
        if (fighterScore(fighter) > fighterScore(other)) current.wins += 1;
        current.score = Math.max(current.score, fighterScore(fighter));
        map.set(key, current);
      });
    });
    return [...map.values()].sort((a, b) => b.wins - a.wins || b.score - a.score).slice(0, 16);
  }, [battles]);
  const leaderboardSlots = useMemo(
    () => Array.from({ length: 16 }, (_, index) => leaderboard[index] || null),
    [leaderboard]
  );
  const winnerSide = activeStats?.winnerSide || 'a';
  const winnerStats = winnerSide === 'a' ? activeStats?.a : activeStats?.b;
  const opponentStats = winnerSide === 'a' ? activeStats?.b : activeStats?.a;
  const winnerFighter = activeBattle ? (winnerSide === 'a' ? activeBattle.fighterA : activeBattle.fighterB) : null;
  const winnerPercent = winnerStats?.percent || 50;
  const opponentPercent = opponentStats?.percent || (100 - winnerPercent);
  const totalVotes = activeStats?.total || 0;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetchCommunityBattles();
        if (!cancelled) setCommunityBattles((response.battles || []).map(normalizeBattle).filter(Boolean));
      } catch (error) {
        if (!cancelled) setNotice(error?.message || 'Could not load community battles.');
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sortedBattles.length || activeBattleId) return;
    setActiveBattleId(sortedBattles[0].id);
  }, [activeBattleId, sortedBattles]);

  useEffect(() => {
    if (!battles.length) return;
    let cancelled = false;
    const loadTallies = async () => {
      const pairs = await Promise.all(battles.slice(0, 24).map(async (battle) => {
        try {
          const tally = await fetchMogBattleTallies(battle.id);
          return [battle.id, { a: Number(tally.a) || 0, b: Number(tally.b) || 0 }];
        } catch {
          return [battle.id, null];
        }
      }));
      if (!cancelled) {
        setTalliesByBattle(Object.fromEntries(pairs.filter(([, value]) => value)));
      }
    };
    loadTallies();
    return () => {
      cancelled = true;
    };
  }, [battles.length]);

  useEffect(() => {
    const localIds = readFollowedBattleIds();
    setFollowedBattleIds(localIds);
    if (!user) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const token = await user.getIdToken();
        const data = await fetchFollowedMogBattles(token);
        const remoteIds = (data.battleIds || []).map((item) => String(item));
        if (!cancelled) setFollowedBattleIds(remoteIds);
      } catch {
        if (!cancelled) setFollowedBattleIds(localIds);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || !activeBattle) return undefined;
    let cancelled = false;
    const loadVote = async () => {
      try {
        const token = await user.getIdToken();
        const data = await fetchMyMogBattleVote(token, activeBattle.id);
        const side = data?.side || data?.vote || null;
        if (!cancelled && (side === 'a' || side === 'b')) {
          setVotesByBattle((prev) => ({ ...prev, [activeBattle.id]: side }));
          setResultsOpenByBattle((prev) => ({ ...prev, [activeBattle.id]: true }));
        }
      } catch {
        // Existing votes are nice-to-have for this admin preview.
      }
    };
    loadVote();
    return () => {
      cancelled = true;
    };
  }, [activeBattle, user]);

  const castVote = useCallback(async (battle, side) => {
    if (!user || !battle) {
      setNotice('Sign in as admin to vote.');
      return;
    }
    setVotesByBattle((prev) => ({ ...prev, [battle.id]: side }));
    setResultsOpenByBattle((prev) => ({ ...prev, [battle.id]: true }));
    setTalliesByBattle((prev) => {
      const current = prev[battle.id] || { a: battle.votesA || 0, b: battle.votesB || 0 };
      return {
        ...prev,
        [battle.id]: {
          ...current,
          [side]: Number(current[side] || 0) + 1,
        },
      };
    });
    try {
      const token = await user.getIdToken();
      const result = await postMogBattleVote(token, side, battle.id);
      if (!result.ok) throw new Error(result.data?.error || 'Vote did not save.');
    } catch (error) {
      setNotice(String(error?.message || 'Vote did not save.').replace(/_/g, ' '));
      window.setTimeout(() => setNotice(''), 3000);
    }
  }, [user]);

  const toggleFollow = useCallback(async (battle) => {
    if (!battle) return;
    const id = String(battle.id);
    const nextFollowing = !followedBattleIds.includes(id);
    const nextIds = nextFollowing ? [...new Set([...followedBattleIds, id])] : followedBattleIds.filter((item) => item !== id);
    setFollowedBattleIds(nextIds);
    try {
      window.localStorage.setItem(FOLLOWED_BATTLES_STORAGE_KEY, JSON.stringify(nextIds));
      if (user) {
        const token = await user.getIdToken();
        await setMogBattleFollow(token, id, nextFollowing);
      }
    } catch {
      setNotice('Follow saved locally.');
      window.setTimeout(() => setNotice(''), 2400);
    }
  }, [followedBattleIds, user]);

  const shareBattle = useCallback(async (battle) => {
    if (!battle) return;
    const url = `${window.location.origin}/mog-battles?battle=${encodeURIComponent(battle.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Battle link copied.');
    } catch {
      setNotice(url);
    }
    window.setTimeout(() => setNotice(''), 2400);
  }, []);

  const deleteBattle = useCallback(async (battle) => {
    if (!battle || !user) return;
    const confirmed = window.confirm('Delete this Face Battle?');
    if (!confirmed) return;
    try {
      let result;
      if (admin) {
        const adminPassword = window.localStorage.getItem('mogcheck_admin_pw') || '';
        if (!adminPassword) throw new Error('Admin password is required.');
        result = await adminDeleteCommunityBattle(adminPassword, battle.id);
      } else {
        const token = await user.getIdToken();
        result = await deleteCommunityBattle(token, battle.id);
      }
      if (!result.ok) throw new Error(result.data?.error || 'Could not delete battle.');
      setCommunityBattles((prev) => prev.filter((b) => String(b.id) !== String(battle.id)));
      if (activeBattleId === battle.id) setActiveBattleId('');
      setNotice('Battle deleted.');
    } catch (error) {
      setNotice(error?.message || 'Could not delete battle.');
    }
    window.setTimeout(() => setNotice(''), 3000);
  }, [activeBattle, admin, user]);

  const renderLeaderboardRow = (row, index) => {
    const isTop3 = index < 3;
    const rankColors = [
      'from-yellow-400/20 to-transparent border-yellow-400/30 text-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.1)]',
      'from-zinc-300/20 to-transparent border-zinc-300/30 text-zinc-300 shadow-[0_0_20px_rgba(212,212,216,0.1)]',
      'from-orange-400/20 to-transparent border-orange-400/30 text-orange-400 shadow-[0_0_20px_rgba(251,146,60,0.1)]'
    ];
    const specialStyle = isTop3 ? rankColors[index] : 'border-transparent bg-white/[0.02] text-zinc-500 hover:bg-white/[0.04]';

    return row ? (
      <button
        key={row.key}
        type="button"
        onClick={() => {
          const match = sortedBattles.find((battle) =>
            fighterName(battle.fighterA) === row.name || fighterName(battle.fighterB) === row.name
          );
          if (match) setActiveBattleId(match.id);
        }}
        className={`group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border px-4 py-3 text-left transition-all duration-500 hover:scale-[1.02] hover:border-cyan-500/30 hover:shadow-[0_0_30px_rgba(34,211,238,0.15)] ${
          isTop3 ? `bg-gradient-to-r ${specialStyle.split(' text-')[0]}` : specialStyle
        }`}
      >
        <span className={`relative z-10 flex w-6 justify-center text-lg font-black italic tracking-tighter ${isTop3 ? specialStyle.match(/text-[a-z-]+-[0-9]+/)[0] : 'text-zinc-600 group-hover:text-cyan-400'}`}>
          #{index + 1}
        </span>
        <div className="relative z-10 shrink-0">
          <img src={row.image} alt={row.name} className="h-14 w-14 rounded-xl object-cover grayscale transition-all duration-500 group-hover:grayscale-0 shadow-[0_4px_12px_rgba(0,0,0,0.5)]" />
          {index === 0 && (
            <span className="absolute -right-2 -top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-yellow-300/50 bg-yellow-400 text-black shadow-[0_0_15px_rgba(250,204,21,0.6)]">
              <Crown size={14} fill="currentColor" />
            </span>
          )}
        </div>
        <div className="relative z-10 min-w-0 flex-1">
          <p className="truncate text-[16px] font-black uppercase tracking-[0.1em] text-zinc-100 transition-colors group-hover:text-white">{row.name}</p>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">{row.wins} Victories</p>
        </div>
      </button>
    ) : (
      <div key={`empty-${index}`} className="flex items-center rounded-2xl border border-transparent bg-white/[0.01] px-4 py-4">
        <span className="w-6 text-center text-lg font-black tracking-tight text-zinc-800">#{index + 1}</span>
      </div>
    );
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#030304] px-4 pb-28 md:pb-24 pt-28 text-white sm:px-6 lg:px-8">
      <style>{`
        @keyframes mogBattle2Stats_ {
          from { opacity: 0; transform: translateY(-26px) scaleY(.92); filter: blur(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes mogBattle2WinnerGlow_ {
          0%, 100% { transform: translateX(0); }
          45% { transform: translateX(2px); }
          55% { transform: translateX(-1px); }
        }
        @keyframes mogBattle2VsPulse_ {
          0%, 100% { opacity: .72; transform: scale(1) rotate(-2deg); }
          50% { opacity: 1; transform: scale(1.08) rotate(2deg); }
        }
        @keyframes mogBattle2Sweep_ {
          0%, 100% { transform: translateX(-120%) rotate(8deg); opacity: 0; }
          45%, 55% { opacity: .35; }
          100% { transform: translateX(120%) rotate(8deg); }
        }
        @keyframes mogBattle2NoticeIn_ {
          from { opacity: 0; transform: translateY(14px) scale(.86); filter: blur(8px); }
          to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        .mog-battle2-scaled {
          zoom: 0.7;
        }
        @supports not (zoom: 1) {
          .mog-battle2-scaled {
            transform: scale(0.7);
            transform-origin: top center;
            width: 142.857%;
            margin-left: 50%;
            translate: -50% 0;
          }
        }
      `}</style>
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_72%_18%,rgba(0,240,255,0.08),transparent_27%),radial-gradient(circle_at_18%_38%,rgba(247,196,0,0.055),transparent_24%),linear-gradient(180deg,#050607_0%,#030304_62%)]" />
      <div className="relative z-10 mog-battle2-scaled">
      <div className="mx-auto grid max-w-[1800px] gap-6 lg:grid-cols-[384px_minmax(0,1fr)]">
        <aside className="relative lg:-translate-x-12 lg:self-start">
          <div className="relative overflow-hidden rounded-[32px] bg-[#07070a] border border-white/[0.04] shadow-[0_40px_100px_rgba(0,0,0,0.8)]">
            <div className="absolute -top-32 -left-32 h-80 w-80 rounded-full bg-cyan-500/10 blur-[100px] pointer-events-none" />
            <div className="absolute -bottom-32 -right-32 h-80 w-80 rounded-full bg-blue-500/10 blur-[100px] pointer-events-none" />

            <div className="relative flex items-center justify-between border-b border-white/[0.04] px-7 py-6">
              <div className="flex items-center gap-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.2)]">
                  <Trophy size={20} />
                </div>
                <div>
                  <h2 className="text-[14px] font-black uppercase tracking-[0.2em] text-white">Top Fighters</h2>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.15em] text-cyan-500/70">Hall of Fame</p>
                </div>
              </div>
            </div>

            {/* Mobile: horizontal scroll, Desktop: vertical list */}
            <div className="lg:hidden overflow-x-auto px-5 py-5 custom-scrollbar">
              <div className="flex gap-5" style={{ minWidth: 'max-content' }}>
                {leaderboardSlots.slice(0, 10).map((row, i) => (
                  <div key={row?.key || `empty-${i}`} className="shrink-0 w-[140px]">
                    {row ? (
                      <button
                        type="button"
                        onClick={() => {
                          const match = sortedBattles.find((battle) =>
                            fighterName(battle.fighterA) === row.name || fighterName(battle.fighterB) === row.name
                          );
                          if (match) setActiveBattleId(match.id);
                        }}
                        className={`group relative flex w-full flex-col items-center gap-2 overflow-hidden rounded-2xl border p-3 text-center transition-all duration-300 hover:border-cyan-500/30 ${
                          i < 3
                            ? `bg-gradient-to-b ${['from-yellow-400/20 to-transparent border-yellow-400/30', 'from-zinc-300/20 to-transparent border-zinc-300/30', 'from-orange-400/20 to-transparent border-orange-400/30'][i]}`
                            : 'border-transparent bg-white/[0.02]'
                        }`}
                      >
                        <div className="relative">
                          <img src={row.image} alt={row.name} className="h-14 w-14 rounded-xl object-cover shadow-lg" referrerPolicy="no-referrer" />
                          {i === 0 && (
                            <span className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-yellow-300/50 bg-yellow-400 text-black shadow-[0_0_12px_rgba(250,204,21,0.6)]">
                              <Crown size={10} fill="currentColor" />
                            </span>
                          )}
                        </div>
                        <span className={`text-lg font-black italic ${['text-yellow-400', 'text-zinc-300', 'text-orange-400'][i] || 'text-zinc-600'}`}>#{i + 1}</span>
                        <p className="truncate w-full text-[10px] font-black uppercase tracking-widest text-zinc-200">{row.name}</p>
                        <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-500">{row.wins} Wins</p>
                      </button>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-[140px] rounded-2xl border border-zinc-800 bg-white/[0.01] p-4">
                        <span className="text-lg font-black text-zinc-800">#{i + 1}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Desktop: vertical list */}
            <div className="relative p-5 pb-0 space-y-3 hidden lg:block">
              {leaderboardSlots.slice(0, 8).map((row, i) => renderLeaderboardRow(row, i))}
            </div>

            <div className={`hidden lg:grid transition-all duration-700 ease-[cubic-bezier(.16,1,.3,1)] ${leaderboardExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
              <div className="overflow-hidden">
                <div className="px-5 pb-0 space-y-3 pt-3">
                  {leaderboardSlots.slice(8, 16).map((row, i) => renderLeaderboardRow(row, i + 8))}
                </div>
              </div>
            </div>
            <div className="p-5 pt-3 hidden lg:block">
              <button
                type="button"
                onClick={() => setLeaderboardExpanded((prev) => !prev)}
                className="group flex w-full items-center justify-center gap-3 rounded-2xl bg-cyan-500/10 px-5 py-4 text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400 transition-all duration-300 hover:bg-cyan-500/20 hover:text-cyan-300 hover:shadow-[0_0_30px_rgba(34,211,238,0.2)]"
              >
                <Trophy size={14} className={`transition-transform duration-300 ${leaderboardExpanded ? 'rotate-180' : 'group-hover:scale-110'}`} /> {leaderboardExpanded ? 'Collapse Rankings' : 'Full Rankings'}
              </button>
            </div>
          </div>
        </aside>

        <main className="min-w-0">
          <div className="mb-12 flex flex-col gap-5">
            <div>
              <div className="flex flex-wrap items-center gap-5">
                <h1 className="bg-[linear-gradient(180deg,#59ecff_0%,#1ab8ff_34%,#1676ff_66%,#0637a7_100%)] bg-clip-text text-[60px] font-black italic uppercase tracking-[-0.075em] text-transparent drop-shadow-[0_14px_38px_rgba(0,132,255,0.24)] md:text-[92px]">
                  FACE BATTLES
                </h1>
                <Swords size={72} className="hidden text-[#00F0FF] drop-shadow-[0_0_24px_rgba(0,240,255,0.35)] md:block" strokeWidth={1.6} />
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-7">
                <div className="flex flex-wrap items-center gap-5">
                  <button
                    type="button"
                    onClick={() => setIsNewBattleModalOpen(true)}
                    className="inline-flex items-center gap-3 rounded-xl border border-cyan-400/55 bg-cyan-400/[0.10] px-8 py-4 text-sm font-black uppercase tracking-[0.18em] text-cyan-200 shadow-[0_0_30px_rgba(0,240,255,0.12)] transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-200/80 hover:bg-cyan-400/[0.16]"
                  >
                    <Plus size={16} /> New Battle
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsFollowingModalOpen(true)}
                    className="inline-flex items-center gap-3 rounded-xl border border-emerald-400/55 bg-emerald-400/[0.10] px-8 py-4 text-sm font-black uppercase tracking-[0.18em] text-emerald-200 shadow-[0_0_30px_rgba(52,211,153,0.12)] transition-all duration-300 hover:-translate-y-0.5 hover:border-emerald-200/80 hover:bg-emerald-400/[0.16]"
                  >
                    <Activity size={16} /> Following
                  </button>
                </div>
                <div className="mt-3 ml-4">
                  <SortDropdown value={sortBy} onChange={setSortBy} />
                </div>
              </div>
            </div>
          </div>

          {sortedBattles.length > 0 ? (
            <div className="relative grid grid-cols-1 xl:grid-cols-2 gap-x-16 gap-y-16">
              <div className="absolute left-1/2 top-0 bottom-0 w-[2px] bg-white/[0.15] -translate-x-1/2 hidden xl:block" />
              {sortedBattles.slice(0, 15).map((battle, index) => {
                const votesA = Math.max(0, Number(battle.votesA) || 0);
                const votesB = Math.max(0, Number(battle.votesB) || 0);
                const totalVotes = votesA + votesB;
                const percentA = totalVotes > 0 ? Math.round((votesA / totalVotes) * 100) : 50;
                const percentB = totalVotes > 0 ? 100 - percentA : 50;

                const scoreA = fighterScore(battle.fighterA);
                const scoreB = fighterScore(battle.fighterB);
                const winnerSide = scoreA >= scoreB ? 'a' : 'b';

                const bStats = {
                  a: { percent: percentA, votes: votesA, isWinner: winnerSide === 'a' },
                  b: { percent: percentB, votes: votesB, isWinner: winnerSide === 'b' }
                };

                const hasVoted = Boolean(resultsOpenByBattle[battle.id]);

                return (
                  <div key={battle.id} className="relative flex flex-col gap-5 pt-8">
                    <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2 translate-y-[-50%] rounded-full border border-white/10 bg-white/5 px-4 py-1.5 backdrop-blur-md">
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 drop-shadow-lg">{formatTimeAgo(battle.createdAt)}</span>
                    </div>
                    {index > 1 && (
                      <div className="absolute -top-8 left-0 right-0 h-[1px] bg-white/[0.08] pointer-events-none" />
                    )}
                    <div className="grid items-start gap-3 grid-cols-[minmax(0,1fr)_60px_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_100px_minmax(0,1fr)] lg:gap-0">
                      <div className="flex justify-center">
                        <FighterBattleCard battle={battle} side="a" stats={bStats.a} hasVoted={hasVoted} onVote={() => castVote(battle, 'a')} currentUserUid={user?.uid} />
                      </div>

                      <div className="relative flex items-center justify-center self-center min-h-[180px] lg:min-h-[380px] w-full">
                        <div className="absolute inset-0 bg-[#02050a] [mask-image:linear-gradient(to_bottom,transparent_0%,black_15%,black_85%,transparent_100%)] hidden lg:block" />
                        <div className="absolute left-0 top-0 h-full w-[1px] bg-gradient-to-b from-transparent via-zinc-600 to-transparent opacity-50 hidden lg:block" />
                        <div className="absolute right-0 top-0 h-full w-[1px] bg-gradient-to-b from-transparent via-zinc-600 to-transparent opacity-50 hidden lg:block" />
                        <div className="relative z-10 flex h-[40px] w-[40px] lg:h-[76px] lg:w-[76px] shrink-0 items-center justify-center rounded-full bg-[#030304] border-[1px] border-zinc-700 shadow-[0_0_20px_rgba(255,255,255,0.05)]">
                          <span className="text-[14px] lg:text-[28px] font-black italic tracking-tighter text-zinc-300 drop-shadow-[0_2px_4px_rgba(0,0,0,1)] pr-0.5">VS</span>
                        </div>
                      </div>

                      <div className="flex justify-center">
                        <FighterBattleCard
                          battle={battle}
                          side="b"
                          stats={bStats.b}
                          hasVoted={hasVoted}
                          onVote={() => castVote(battle, 'b')}
                          currentUserUid={user?.uid}
                          actionSlot={(
                            <>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleFollow(battle);
                                }}
                                className={`${followedBattleIds.includes(String(battle.id)) ? 'text-emerald-300' : 'text-emerald-300/85'} drop-shadow-[0_0_12px_rgba(52,211,153,0.52)] transition-all duration-300 hover:scale-125 hover:text-emerald-200`}
                                title="Follow battle"
                              >
                                <Heart size={24} strokeWidth={2.4} fill={followedBattleIds.includes(String(battle.id)) ? 'currentColor' : 'none'} />
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  shareBattle(battle);
                                }}
                                className="text-cyan-300 drop-shadow-[0_0_10px_rgba(34,211,238,0.5)] transition-all duration-300 hover:scale-125 hover:text-cyan-100"
                                title="Share battle"
                              >
                                <Share2 size={22} strokeWidth={2.3} />
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  deleteBattle(battle);
                                }}
                                className="text-red-300/90 drop-shadow-[0_0_9px_rgba(248,113,113,0.35)] transition-all duration-300 hover:scale-125 hover:text-red-200"
                                title="Delete battle"
                              >
                                <Trash2 size={22} strokeWidth={2.1} />
                              </button>
                            </>
                          )}
                        />
                      </div>
                    </div>
                    <BattleInsights battle={battle} stats={bStats} hasVoted={hasVoted} onViewStats={() => setStatsModalBattle(battle)} />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[28px] border border-zinc-800 bg-zinc-950/70 p-12 text-center text-zinc-400">
              <ShieldCheck size={34} className="mx-auto mb-4 text-cyan-300" />
              No battles loaded yet.
            </div>
          )}
        </main>
      </div>

      {isFollowingModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-black/90 backdrop-blur-xl">
          <div className="w-full max-w-3xl rounded-[32px] border border-white/10 bg-black/40 shadow-[0_0_80px_rgba(52,211,153,0.1)] relative animate-[mogBattle2NoticeIn__0.4s_cubic-bezier(0.16,1,0.3,1)] overflow-hidden flex flex-col max-h-[85vh]">

            {/* Header */}
            <div className="px-12 py-9 flex justify-between items-center shrink-0 border-b border-white/5 relative">
              <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" />
              <div>
                <h2 className="text-2xl font-black uppercase tracking-[0.2em] bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-500 mb-1">
                  Following
                </h2>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-400/80">
                  Tracked Battles
                </p>
              </div>
              <button
                onClick={() => setIsFollowingModalOpen(false)}
                className="text-zinc-500 hover:text-white transition-all duration-300 p-3 rounded-full hover:bg-white/10"
              >
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="p-12 overflow-y-auto flex-1 flex flex-col gap-7">
              {sortedBattles.slice(0, 2).map((battle) => {
                const nameA = battle.fighterA?.name || 'Fighter A';
                const nameB = battle.fighterB?.name || 'Fighter B';
                const imgA = battle.fighterA?.image || battle.fighterA?.frontImage || battle.fighterA?.imgSrc;
                const imgB = battle.fighterB?.image || battle.fighterB?.frontImage || battle.fighterB?.imgSrc;

                return (
                  <div key={`track-${battle.id}`} className="flex flex-col md:flex-row md:items-center justify-between p-7 rounded-[24px] bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] hover:border-emerald-500/30 transition-all duration-500 group shadow-[inset_0_0_20px_rgba(0,0,0,0.5)] gap-7">

                    <div className="flex items-center gap-7">
                      <div className="flex items-center">
                        <img
                          src={resolveMediaUrl(imgA)}
                          alt={nameA}
                          className="w-16 h-16 rounded-xl object-cover border-2 border-black z-10 shadow-lg group-hover:scale-105 transition-transform duration-500"
                          referrerPolicy="no-referrer"
                        />
                        <img
                          src={resolveMediaUrl(imgB)}
                          alt={nameB}
                          className="w-16 h-16 rounded-xl object-cover border-2 border-black -ml-5 z-0 shadow-lg group-hover:scale-105 transition-transform duration-500"
                          referrerPolicy="no-referrer"
                        />
                      </div>

                      <div className="flex flex-col justify-center">
                        <div className="flex items-center gap-3">
                          <span className="text-base font-black uppercase tracking-widest text-white">{nameA}</span>
                          <span className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">VS</span>
                          <span className="text-base font-black uppercase tracking-widest text-white">{nameB}</span>
                        </div>
                      </div>
                    </div>

                    <button className="flex items-center justify-center gap-2 px-6 py-3 rounded-full border border-white/10 text-xs font-black uppercase tracking-widest text-zinc-300 hover:text-white hover:border-white/30 hover:bg-white/10 transition-all duration-300 shrink-0">
                      <Share2 size={14} /> Share
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {isNewBattleModalOpen && (
        <NewBattleModal
          user={user}
          dashboardData={dashboardData}
          setCurrentPage={setCurrentPage}
          onClose={() => setIsNewBattleModalOpen(false)}
          onCreated={(created) => {
            setCommunityScansForModal([]);
            setCommunityBattles(prev => [created, ...prev]);
          }}
        />
      )}

      {statsModalBattle && (
        <BattleStatsModal
          battle={statsModalBattle}
          onClose={() => setStatsModalBattle(null)}
          currentUserUid={user?.uid}
        />
      )}
    </div>
    </div>
  );
};

export default MogBattlePage2;

const NewBattleModal = ({ user, dashboardData, setCurrentPage, onClose, onCreated }) => {
  const [mode, setMode] = useState('choice');
  const [userScans, setUserScans] = useState([]);
  const [communityScans, setCommunityScans] = useState([]);
  const [loadingScans, setLoadingScans] = useState(false);
  const [loadingCommunityScans, setLoadingCommunityScans] = useState(false);
  const [fighterAId, setFighterAId] = useState('');
  const [fighterBId, setFighterBId] = useState('');
  const [nameA, setNameA] = useState('');
  const [nameB, setNameB] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchUserScans = useCallback(async () => {
    if (!user) return;
    setLoadingScans(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/scans`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load your scans.');
      const normalized = (data.scans || [])
        .map((scan, index) => {
          const payload = scan.payload && typeof scan.payload === 'object' ? scan.payload : {};
          const score = Number(scan.finalRating ?? payload.finalRating);
          return {
            ...scanToBattleFighter({ ...scan, payload }, `Scan ${index + 1}`),
            id: scan.id || `scan-${index}`,
            frontImage: scan.frontImageUrl || payload.frontImage || payload.imgSrc || null,
            sideImage: scan.sideImageUrl || payload.sideImage || null,
            finalRating: Number.isFinite(score) ? score : 0,
          };
        })
        .filter((scan) => scan.frontImage);
      setUserScans(normalized);
    } catch (e) {
      setError(e.message || 'Could not load your scans.');
    } finally {
      setLoadingScans(false);
    }
  }, [user]);

  const fetchPublicCommunityScans = useCallback(async () => {
    setLoadingCommunityScans(true);
    setError('');
    try {
      const data = await fetchCommunityScans(60);
      const normalized = (data.scans || data.items || [])
        .map((scan, index) => ({
          ...scanToBattleFighter(scan, `Community Scan ${index + 1}`),
          id: scan.id || scan.scanId || `community-${index}`,
          visibility: scan.visibility || 'community',
        }))
        .filter((scan) => scan.frontImage);
      setCommunityScans(normalized);
    } catch (e) {
      setError(e.message || 'Could not load public community scans.');
    } finally {
      setLoadingCommunityScans(false);
    }
  }, []);

  useEffect(() => {
    if (mode !== 'history' || userScans.length || !user) return;
    fetchUserScans();
  }, [fetchUserScans, mode, user, userScans.length]);

  useEffect(() => {
    if (mode !== 'community' || communityScans.length) return;
    fetchPublicCommunityScans();
  }, [communityScans.length, fetchPublicCommunityScans, mode]);

  const mergedScans = useMemo(() => {
    const dashboardScans = (dashboardData?.scanHistory || []).map((scan, index) => ({
      ...scanToBattleFighter(scan, `Scan ${index + 1}`),
      id: scan.scanId || `dashboard-${index}`,
      frontImage: scan.frontImage,
      sideImage: scan.sideImage || null,
      finalRating: Number(scan.finalRating) || 0,
    }));
    const map = new Map();
    [...userScans, ...dashboardScans].forEach((scan) => {
      if (scan?.id && scan.frontImage) map.set(scan.id, scan);
    });
    return Array.from(map.values());
  }, [dashboardData?.scanHistory, userScans]);

  const activeScans = mode === 'community' ? communityScans : mergedScans;
  const fighterA = activeScans.find((scan) => scan.id === fighterAId) || null;
  const fighterB = activeScans.find((scan) => scan.id === fighterBId) || null;

  const makeBattleScanUnlisted = async (fighter, token) => {
    const ownerUid = String(fighter?.ownerUid || fighter?.uid || '').trim();
    const scanId = String(fighter?.scanId || '').trim();
    const profileId = String(fighter?.profileId || '').trim();
    const visibility = String(fighter?.visibility || '').trim().toLowerCase();
    if (!scanId || ownerUid !== user?.uid) return fighter;
    let nextVisibility = visibility;
    if (!['unlisted', 'community', 'public'].includes(visibility)) {
      const scanRes = await fetch(`${API_BASE}/api/user/scans/${encodeURIComponent(scanId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ visibility: 'unlisted' }),
      });
      const data = await scanRes.json().catch(() => ({}));
      if (!scanRes.ok) throw new Error(data.error || 'Could not make scan unlisted for Face Battle.');
      nextVisibility = data.scan?.visibility || 'unlisted';
    }
    if (profileId) {
      await fetch(`${API_BASE}/api/user/profiles/${encodeURIComponent(profileId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ visibility: 'unlisted' }),
      });
    }
    return { ...fighter, visibility: nextVisibility || 'unlisted' };
  };

  const submitBattle = async () => {
    if (!user) { setError('Sign in to create a battle.'); return; }
    if (!fighterA || !fighterB) { setError('Pick two scans first.'); return; }
    if (fighterA.id === fighterB.id) { setError('Choose two different scans.'); return; }
    const displayNameA = nameA.trim() || fighterA.name || 'Scan';
    const displayNameB = nameB.trim() || fighterB.name || 'Scan';
    const nameError = getMogBattleNameError(displayNameA) || getMogBattleNameError(displayNameB);
    if (nameError) { setError(nameError); return; }
    setSubmitting(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const [unlistedFighterA, unlistedFighterB] = await Promise.all([
        makeBattleScanUnlisted(fighterA, token),
        makeBattleScanUnlisted(fighterB, token),
      ]);
      const payloadA = { ...unlistedFighterA, name: displayNameA };
      const payloadB = { ...unlistedFighterB, name: displayNameB };
      const result = await postCommunityBattle(token, payloadA, payloadB);
      if (!result.ok) throw new Error(result.data?.error || 'Could not create battle.');
      const created = normalizeBattle(result.data?.battle ? { id: result.data.battle.id || result.data.id, ...result.data.battle } : null);
      if (created) onCreated(created);
      onClose();
    } catch (e) {
      setError(e.message || 'Could not create battle.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="New battle" subtitle="Upload a new scan or pick from your history" onClose={onClose} maxWidth="max-w-5xl">
      {mode === 'choice' ? (
        <div className="grid gap-4 md:grid-cols-3">
          <button type="button" onClick={() => { onClose(); setCurrentPage('upload-photo'); }} className="rounded-[30px] border border-cyan-500/30 bg-cyan-500/8 p-6 text-left transition-all duration-300 hover:scale-[1.01] hover:border-cyan-400/60 hover:bg-cyan-500/12">
            <Plus size={22} className="text-cyan-300" />
            <h4 className="mt-4 text-xl font-black uppercase tracking-[0.14em] text-white">Add new scans</h4>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">Jump to the upload page, create fresh scans, then come back here to battle them.</p>
          </button>
          <button type="button" onClick={() => setMode('history')} className="rounded-[30px] border border-zinc-800 bg-black/30 p-6 text-left transition-all duration-300 hover:scale-[1.01] hover:border-zinc-700 hover:bg-zinc-950/80">
            <History size={22} className="text-zinc-300" />
            <h4 className="mt-4 text-xl font-black uppercase tracking-[0.14em] text-white">Pick from history</h4>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">Use scans already on your account, then type names to show on the leaderboard and voting cards.</p>
          </button>
          <button type="button" onClick={() => setMode('community')} className="rounded-[30px] border border-emerald-500/25 bg-emerald-500/8 p-6 text-left transition-all duration-300 hover:scale-[1.01] hover:border-emerald-400/50 hover:bg-emerald-500/12">
            <Sparkles size={22} className="text-emerald-300" />
            <h4 className="mt-4 text-xl font-black uppercase tracking-[0.14em] text-white">Pick community scans</h4>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">Choose from public community scans and use their saved ratings/stats to decide the battle winner.</p>
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setMode('choice')} className="rounded-full border border-zinc-800 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-zinc-400 transition-all hover:border-zinc-700 hover:text-white">Back</button>
            {mode === 'history' ? (
              <button type="button" onClick={fetchUserScans} className="rounded-full border border-zinc-800 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-zinc-400 transition-all hover:border-zinc-700 hover:text-white">Refresh scans</button>
            ) : null}
            {mode === 'community' ? (
              <button type="button" onClick={fetchPublicCommunityScans} className="rounded-full border border-emerald-500/25 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-emerald-300 transition-all hover:border-emerald-400/50 hover:text-white">Refresh community</button>
            ) : null}
          </div>
          {loadingScans ? <p className="text-sm text-zinc-500">Loading your scans...</p> : null}
          {loadingCommunityScans ? <p className="text-sm text-zinc-500">Loading public community scans...</p> : null}
          {error ? <div className="rounded-2xl border border-rose-500/25 bg-rose-500/8 px-4 py-3 text-sm text-rose-300">{error}</div> : null}
          <div className="grid gap-5 md:grid-cols-2">
            {[
              { title: 'Fighter A', activeId: fighterAId, setActiveId: setFighterAId, name: nameA, setName: setNameA, accent: 'cyan' },
              { title: 'Fighter B', activeId: fighterBId, setActiveId: setFighterBId, name: nameB, setName: setNameB, accent: 'emerald' },
            ].map((side) => (
              <div key={side.title} className="rounded-[28px] border border-zinc-800 bg-black/25 p-4">
                <h4 className="text-sm font-black uppercase tracking-[0.18em] text-white">{side.title}</h4>
                <div className="mt-4 grid max-h-[420px] grid-cols-2 gap-3 overflow-y-auto pr-1">
                  {activeScans.map((scan, idx) => {
                    const active = side.activeId === scan.id;
                    return (
                      <button
                        key={`${side.title}-${scan.id}`}
                        type="button"
                        onClick={() => side.setActiveId(scan.id)}
                        className={`overflow-hidden rounded-[22px] border bg-zinc-950/80 text-left transition-all duration-300 hover:scale-[1.01] ${
                          active
                            ? side.accent === 'cyan'
                              ? 'border-cyan-400 shadow-[0_0_24px_rgba(34,211,238,0.15)]'
                              : 'border-emerald-400 shadow-[0_0_24px_rgba(16,185,129,0.15)]'
                            : 'border-zinc-800 hover:border-zinc-700'
                        }`}
                      >
                        <img loading="lazy" decoding="async" src={scan.frontImage} alt="" className="aspect-[4/5] w-full object-cover" />
                        <div className="p-3">
                          <p className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-white">{scan.name || `Scan ${idx + 1}`}</p>
                          <p className="mt-1 text-[11px] font-mono text-zinc-400">{Number(scan.finalRating || 0).toFixed(1)}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <input type="text" value={side.name} onChange={(e) => side.setName(e.target.value)} placeholder="Type a display name" className="mt-4 w-full rounded-2xl border border-zinc-800 bg-zinc-950/75 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-cyan-500" />
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={submitBattle} disabled={submitting} className="rounded-full border border-cyan-500/40 bg-cyan-400 px-6 py-3 text-xs font-black uppercase tracking-[0.2em] text-black transition-all duration-300 hover:scale-[1.02] hover:bg-cyan-300 disabled:opacity-50">
              {submitting ? 'Creating...' : 'Create battle'}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
};

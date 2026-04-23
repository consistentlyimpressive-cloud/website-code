import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Crown, ChevronDown, Plus, History, X, ShieldCheck, Swords, Trophy, Sparkles, Activity, Share2, Heart, Copy, ExternalLink } from 'lucide-react';
import { getAllFeaturedBattles, getMetricRowsForBattle, aiWinner } from '../data/mogBattles';
import {
  fetchCommunityBattles,
  fetchCommunityScans,
  fetchFollowedMogBattles,
  fetchMogBattleTallies,
  fetchMyMogBattleVote,
  postMogBattleVote,
  postCommunityBattle,
  setMogBattleFollow,
} from '../api/mogBattleVotes';
import { getApiBase } from '../utils/apiBase';
import { resolveMediaUrl } from '../utils/mediaUrl';

const API_BASE = getApiBase();

const overlayCardClass =
  'rounded-[28px] border border-zinc-800 bg-[#0b0c0d]/95 shadow-[0_30px_120px_rgba(0,0,0,0.55)] backdrop-blur-xl';
const pageCardClass =
  'rounded-[28px] border border-zinc-800/95 bg-[linear-gradient(180deg,rgba(15,17,20,0.94),rgba(8,9,10,0.98))] shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl';
const pageCardHeaderClass =
  'border-b border-zinc-800/95 px-5 py-4 md:px-6';
const sectionTitleClass =
  'text-[11px] font-black uppercase tracking-[0.22em] text-zinc-400';
const sectionHeaderIconClass =
  'h-8 w-8 rounded-full border border-zinc-800 bg-zinc-950/90 p-2 text-cyan-300 shadow-[0_0_24px_rgba(34,211,238,0.08)]';
const celebrityNameClass =
  'text-[13px] font-black uppercase tracking-[0.12em] text-white';
const FOLLOWED_BATTLES_STORAGE_KEY = 'mogcheck-followed-battles';

const timestampToMillis = (value) => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatBattleTime = (value) => {
  const millis = timestampToMillis(value);
  if (!millis) return 'Unknown time';
  return new Date(millis).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const fighterLabel = (fighter, fallback = 'Scan') => {
  const raw = String(fighter?.name || fighter?.displayName || '').trim();
  return raw || fallback;
};

const fighterImage = (fighter) =>
  resolveMediaUrl(fighter?.frontImage || fighter?.imgSrc) || 'https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png';

const fighterScore = (fighter) => {
  const value = Number(fighter?.finalRating ?? fighter?.rating);
  return Number.isFinite(value) ? value : null;
};

const fighterSummary = (fighter) =>
  fighter?.technicalSummary ||
  fighter?.analysisSummary ||
  fighter?.summary ||
  fighter?.overview ||
  fighter?.resultSummary ||
  'No short analysis summary available yet.';

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

const fighterGenderLabel = (fighter) => {
  const value = String(fighter?.sex || fighter?.gender || '').trim().toLowerCase();
  if (!value) return 'Unknown';
  if (value.startsWith('m')) return 'Male';
  if (value.startsWith('f')) return 'Female';
  return 'Unknown';
};

const fighterAnalysisPath = (fighter, currentUserUid = '') => {
  const ownerUid = String(fighter?.ownerUid || fighter?.uid || '').trim();
  const profileId = String(fighter?.profileId || '').trim();
  const scanId = String(fighter?.scanId || '').trim();
  const visibility = String(fighter?.visibility || '').trim().toLowerCase();
  if (!ownerUid || !profileId) return null;
  if (visibility === 'private' && ownerUid !== currentUserUid) return null;
  const base = `/users/${encodeURIComponent(ownerUid)}/${encodeURIComponent(profileId)}`;
  return scanId ? `${base}?scan=${encodeURIComponent(scanId)}` : base;
};

const battleShareUrl = (battleId) => {
  try {
    const url = new URL('/mog-battles', window.location.origin);
    url.searchParams.set('battle', String(battleId || '').trim());
    return url.toString();
  } catch {
    return `/mog-battles?battle=${encodeURIComponent(String(battleId || '').trim())}`;
  }
};

const openInternalPath = (path) => {
  if (!path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event('popstate'));
};

const readFollowedBattleIds = () => {
  try {
    const raw = window.localStorage.getItem(FOLLOWED_BATTLES_STORAGE_KEY);
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
  } catch {
    return [];
  }
};

const fighterKey = (fighter) =>
  [fighterLabel(fighter), fighterImage(fighter), fighter?.profileId || ''].join('|');

const battleIdKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

function normalizeBattle(rawBattle) {
  if (!rawBattle?.fighterA || !rawBattle?.fighterB) return null;
  const fighterA = {
    ...rawBattle.fighterA,
    name: fighterLabel(rawBattle.fighterA),
    imgSrc: fighterImage(rawBattle.fighterA),
    rating: fighterScore(rawBattle.fighterA) ?? 0,
    stats:
      (Array.isArray(rawBattle.fighterA?.stats) && rawBattle.fighterA.stats.length
        ? rawBattle.fighterA.stats
        : Array.isArray(rawBattle.fighterA?.biometrics)
          ? rawBattle.fighterA.biometrics
              .map((metric) => ({
                label: metric?.label || 'Metric',
                score: Number(metric?.score) || 0,
              }))
              .filter((metric) => metric.label)
          : []),
  };
  const fighterB = {
    ...rawBattle.fighterB,
    name: fighterLabel(rawBattle.fighterB),
    imgSrc: fighterImage(rawBattle.fighterB),
    rating: fighterScore(rawBattle.fighterB) ?? 0,
    stats:
      (Array.isArray(rawBattle.fighterB?.stats) && rawBattle.fighterB.stats.length
        ? rawBattle.fighterB.stats
        : Array.isArray(rawBattle.fighterB?.biometrics)
          ? rawBattle.fighterB.biometrics
              .map((metric) => ({
                label: metric?.label || 'Metric',
                score: Number(metric?.score) || 0,
              }))
              .filter((metric) => metric.label)
          : []),
  };
  return {
    ...rawBattle,
    id: String(rawBattle.id || `battle-${battleIdKey(`${fighterKey(fighterA)}-${fighterKey(fighterB)}`)}`),
    fighterA,
    fighterB,
    votesA: Number(rawBattle.votesA) || 0,
    votesB: Number(rawBattle.votesB) || 0,
    createdAt: rawBattle.createdAt || rawBattle.timestamp || rawBattle.scannedAt || null,
  };
}

function buildMogLeaderboard(feedItems) {
  const map = new Map();

  const bump = (fighter, battle, kind, opponent) => {
    const key = fighterKey(fighter);
    const row = map.get(key) || {
      key,
      name: fighterLabel(fighter),
      img: fighterImage(fighter),
      wins: 0,
      losses: 0,
      rating: fighterScore(fighter) || 0,
      fighter,
      battles: [],
    };

    if (kind === 'win') row.wins += 1;
    if (kind === 'loss') row.losses += 1;
    row.rating = Math.max(row.rating, fighterScore(fighter) || 0);
    row.fighter = { ...row.fighter, ...fighter };
    row.battles.push({
      battleId: battle.id,
      opponentName: fighterLabel(opponent),
      opponentImage: fighterImage(opponent),
      result: kind,
      myScore: fighterScore(fighter),
      opponentScore: fighterScore(opponent),
      createdAt: battle.createdAt,
    });
    map.set(key, row);
  };

  for (const battle of feedItems) {
    const a = battle.fighterA;
    const b = battle.fighterB;
    const ra = fighterScore(a);
    const rb = fighterScore(b);
    if (ra == null || rb == null || ra === rb) continue;
    if (ra > rb) {
      bump(a, battle, 'win', b);
      bump(b, battle, 'loss', a);
    } else {
      bump(b, battle, 'win', a);
      bump(a, battle, 'loss', b);
    }
  }

  return Array.from(map.values())
    .map((row) => ({
      ...row,
      played: row.wins + row.losses,
      winRate: row.wins + row.losses ? row.wins / (row.wins + row.losses) : 0,
      battles: row.battles
        .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt))
        .slice(0, 50),
    }))
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.rating - a.rating);
}

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

const MetricBreakdown = ({ battle }) => {
  const rows = useMemo(() => getMetricRowsForBattle(battle?.fighterA, battle?.fighterB, 5), [battle]);
  const winner = battle?.fighterA && battle?.fighterB ? aiWinner(battle.fighterA, battle.fighterB) : null;
  const toneForSide = (side) => {
    if (!winner || winner === 'tie') {
      return {
        bar: 'bg-cyan-400',
        text: 'text-cyan-300',
      };
    }
    return side === winner
      ? {
          bar: 'bg-emerald-400',
          text: 'text-emerald-300',
        }
      : {
          bar: 'bg-rose-400',
          text: 'text-rose-300',
        };
  };
  const toneA = toneForSide('a');
  const toneB = toneForSide('b');

  if (!rows.length) {
    return <p className="text-sm text-zinc-500">Metric breakdown is unavailable for this battle.</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((row, idx) => (
        <div
          key={row.key}
          className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl border border-zinc-800 bg-black/30 px-3 py-3 opacity-0 [animation:mogFadeUp_.45s_ease-out_forwards]"
          style={{ animationDelay: `${idx * 60}ms` }}
        >
          <div className="min-w-0">
            <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
              <div className={`h-full rounded-full ${toneA.bar}`} style={{ width: `${Math.min(100, row.scoreA)}%` }} />
            </div>
            <div className={`mt-1 text-[11px] font-mono ${toneA.text}`}>{row.scoreA}</div>
          </div>
          <div className="w-24 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-300 md:w-32">
            {row.label}
          </div>
          <div className="min-w-0">
            <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
              <div className={`h-full rounded-full ${toneB.bar}`} style={{ width: `${Math.min(100, row.scoreB)}%` }} />
            </div>
            <div className={`mt-1 text-right text-[11px] font-mono ${toneB.text}`}>{row.scoreB}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

const FighterMiniCard = ({ fighter, scoreTone = 'text-cyan-300', hidden = false, analysisPath = null }) => (
  <div className="rounded-2xl border border-zinc-800 bg-black/30 p-3">
    <div className="flex items-center gap-3">
      {analysisPath ? (
        <button type="button" onClick={() => openInternalPath(analysisPath)} className="shrink-0">
          <img
            src={fighterImage(fighter)}
            alt={fighterLabel(fighter)}
            className="h-16 w-16 rounded-2xl border border-zinc-800 object-cover transition-transform duration-300 hover:scale-[1.04]"
          />
        </button>
      ) : (
        <img
          src={fighterImage(fighter)}
          alt={fighterLabel(fighter)}
          className="h-16 w-16 rounded-2xl border border-zinc-800 object-cover"
        />
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-black uppercase tracking-[0.12em] text-white">{fighterLabel(fighter)}</p>
        <p className={`mt-1 text-xl font-black italic tabular-nums ${hidden ? 'text-zinc-500' : scoreTone}`}>
          {hidden ? 'Hidden' : (fighterScore(fighter)?.toFixed(1) ?? '--')}
        </p>
      </div>
    </div>
    <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-zinc-400">
      {hidden ? 'Vote first to unlock the AI rating and metric breakdown for this participant.' : fighterSummary(fighter)}
    </p>
    {analysisPath ? (
      <button
        type="button"
        onClick={() => openInternalPath(analysisPath)}
        className="mt-3 inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-950/80 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300 transition-colors hover:border-cyan-400/30 hover:text-white"
      >
        Full analysis <ExternalLink size={11} />
      </button>
    ) : null}
  </div>
);

const LeaderboardProfileModal = ({ row, onClose }) => {
  if (!row) return null;
  const analysisPath = fighterAnalysisPath(row.fighter);

  return (
    <ModalShell
      title={row.name}
      subtitle={`AI rating ${Number(row.rating || 0).toFixed(1)} - ${row.wins} wins - ${row.losses} losses`}
      onClose={onClose}
      maxWidth="max-w-5xl"
    >
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <div className="rounded-[28px] border border-zinc-800 bg-black/35 p-4">
            {analysisPath ? (
              <button type="button" onClick={() => openInternalPath(analysisPath)} className="block w-full text-left">
                <img src={row.img} alt={row.name} className="aspect-[3/4] w-full rounded-[24px] border border-zinc-800 object-cover transition-transform duration-300 hover:scale-[1.01]" />
              </button>
            ) : (
              <img src={row.img} alt={row.name} className="aspect-[3/4] w-full rounded-[24px] border border-zinc-800 object-cover" />
            )}
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-3 text-center">
                <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Wins</p>
                <p className="mt-1 text-lg font-black text-emerald-400">{row.wins}</p>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-3 text-center">
                <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Losses</p>
                <p className="mt-1 text-lg font-black text-rose-400">{row.losses}</p>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-3 text-center">
                <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Score</p>
                <p className="mt-1 text-lg font-black text-cyan-300">{Number(row.rating || 0).toFixed(1)}</p>
              </div>
            </div>
            {analysisPath ? (
              <button
                type="button"
                onClick={() => openInternalPath(analysisPath)}
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/[0.06] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-200 transition-colors hover:border-cyan-400/45 hover:text-white"
              >
                Open full analysis <ExternalLink size={12} />
              </button>
            ) : null}
          </div>

          <div className="rounded-[28px] border border-emerald-500/20 bg-emerald-500/5 p-4">
            <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-400">Brief overview</p>
            <p className="mt-3 text-sm leading-relaxed text-zinc-300">{fighterSummary(row.fighter)}</p>
          </div>
        </div>

        <div className="rounded-[28px] border border-zinc-800 bg-black/25 p-4 md:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h4 className="text-sm font-black uppercase tracking-[0.18em] text-white">Fight history</h4>
            <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">15 fights max</span>
          </div>

          <div className="max-h-[480px] space-y-3 overflow-y-auto pr-1">
            {row.battles.slice(0, 15).map((entry, index) => (
              <div
                key={`${entry.battleId}-${index}`}
                className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/75 px-3 py-3"
              >
                <img
                  src={entry.opponentImage}
                  alt={entry.opponentName}
                  className="h-14 w-14 rounded-2xl border border-zinc-800 object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold uppercase tracking-[0.12em] text-white">vs {entry.opponentName}</p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-zinc-500">{formatBattleTime(entry.createdAt)}</p>
                </div>
                <div className="text-right">
                  <p
                    className={`text-xs font-black uppercase tracking-[0.16em] ${
                      entry.result === 'win' ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {entry.result}
                  </p>
                  <p className="mt-1 text-[11px] font-mono text-zinc-400">
                    {entry.myScore?.toFixed(1) ?? '--'} / {entry.opponentScore?.toFixed(1) ?? '--'}
                  </p>
                </div>
              </div>
            ))}
            {!row.battles.length ? <p className="text-sm text-zinc-500">No fight history yet.</p> : null}
          </div>
        </div>
      </div>
    </ModalShell>
  );
};

const VoteBattleModal = ({ battle, user, onClose, onVoteComplete }) => {
  const [voteCounts, setVoteCounts] = useState({ a: Number(battle?.votesA) || 0, b: Number(battle?.votesB) || 0 });
  const [myVote, setMyVote] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!battle) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const tallies = await fetchMogBattleTallies(battle.id);
        if (!cancelled) setVoteCounts({ a: Number(tallies.a) || 0, b: Number(tallies.b) || 0 });
      } catch {
        // ignore
      }

      if (!user) return;

      try {
        const token = await user.getIdToken();
        const data = await fetchMyMogBattleVote(token, battle.id);
        if (!cancelled && data?.side) setMyVote(data.side);
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [battle, user]);

  if (!battle) return null;

  const winner = aiWinner(battle.fighterA, battle.fighterB);
  const totalVotes = voteCounts.a + voteCounts.b;
  const pctA = totalVotes ? Math.round((voteCounts.a / totalVotes) * 100) : 50;
  const pctB = totalVotes ? 100 - pctA : 50;
  const voteMatched = myVote && winner && winner !== 'tie' ? myVote === winner : null;
  const hasLockedVote = Boolean(myVote);
  const analysisPathA = fighterAnalysisPath(battle.fighterA, user?.uid || '');
  const analysisPathB = fighterAnalysisPath(battle.fighterB, user?.uid || '');

  const handleVote = async (side) => {
    if (!user) {
      setError('Sign in to vote on Mog Battles.');
      return;
    }
    if (hasLockedVote) {
      setError('Your vote is already locked for this battle.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const token = await user.getIdToken();
      const result = await postMogBattleVote(token, side, battle.id);
      if (!result.ok && result.status === 409 && result.data?.error === 'already_voted') {
        if (typeof result.data?.a === 'number' && typeof result.data?.b === 'number') {
          setVoteCounts({ a: result.data.a, b: result.data.b });
        }
        if (result.data?.side === 'a' || result.data?.side === 'b') {
          setMyVote(result.data.side);
        }
        setError('Your vote is already locked for this battle.');
        return;
      }
      if (!result.ok) {
        throw new Error(result.data?.error || 'Vote failed.');
      }
      if (typeof result.data?.a === 'number' && typeof result.data?.b === 'number') {
        setVoteCounts({ a: result.data.a, b: result.data.b });
      } else {
        setVoteCounts((prev) => ({ ...prev, [side]: (prev[side] || 0) + 1 }));
      }
      setMyVote(side);
      onVoteComplete?.(battle.id, side);
    } catch (e) {
      setError(e?.message || 'Vote failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title="Cast your vote"
      subtitle={`${fighterLabel(battle.fighterA)} vs ${fighterLabel(battle.fighterB)}`}
      onClose={onClose}
      maxWidth="max-w-5xl"
    >
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <FighterMiniCard
            fighter={battle.fighterA}
            scoreTone={winner === 'a' ? 'text-emerald-300' : winner === 'b' ? 'text-rose-300' : 'text-cyan-300'}
            hidden={!hasLockedVote}
            analysisPath={analysisPathA}
          />
          <FighterMiniCard
            fighter={battle.fighterB}
            scoreTone={winner === 'b' ? 'text-emerald-300' : winner === 'a' ? 'text-rose-300' : 'text-cyan-300'}
            hidden={!hasLockedVote}
            analysisPath={analysisPathB}
          />
        </div>

        <div className="rounded-[28px] border border-zinc-800 bg-black/25 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Live votes</p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{totalVotes} total</p>
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full transition-all duration-500 ${
                winner === 'b' ? 'bg-rose-400' : winner === 'a' ? 'bg-emerald-400' : 'bg-cyan-400'
              }`}
              style={{ width: `${pctA}%` }}
            />
            <div
              className={`h-full transition-all duration-500 ${
                winner === 'a' ? 'bg-rose-400' : winner === 'b' ? 'bg-emerald-400' : 'bg-emerald-400'
              }`}
              style={{ width: `${pctB}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] font-mono text-zinc-400">
            <span>
              <span className={`${winner === 'a' ? 'text-emerald-300' : winner === 'b' ? 'text-rose-300' : 'text-zinc-300'}`}>{fighterLabel(battle.fighterA)}</span> {voteCounts.a} - {pctA}%
            </span>
            <span>
              <span className={`${winner === 'b' ? 'text-emerald-300' : winner === 'a' ? 'text-rose-300' : 'text-zinc-300'}`}>{fighterLabel(battle.fighterB)}</span> {voteCounts.b} - {pctB}%
            </span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={() => handleVote('a')}
            disabled={submitting || hasLockedVote}
            className="rounded-[24px] border border-cyan-500/35 bg-cyan-500/8 px-4 py-4 text-left transition-all duration-300 hover:scale-[1.01] hover:border-cyan-400/60 hover:bg-cyan-500/12 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-300">Vote for</p>
            <p className="mt-1 text-[13px] font-black uppercase tracking-[0.08em] text-white md:text-[14px]">{fighterLabel(battle.fighterA)}</p>
            {myVote === 'a' ? <p className="mt-2 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">Vote locked</p> : null}
          </button>
          <button
            type="button"
            onClick={() => handleVote('b')}
            disabled={submitting || hasLockedVote}
            className="rounded-[24px] border border-emerald-500/35 bg-emerald-500/8 px-4 py-4 text-left transition-all duration-300 hover:scale-[1.01] hover:border-emerald-400/60 hover:bg-emerald-500/12 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-300">Vote for</p>
            <p className="mt-1 text-[13px] font-black uppercase tracking-[0.08em] text-white md:text-[14px]">{fighterLabel(battle.fighterB)}</p>
            {myVote === 'b' ? <p className="mt-2 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">Vote locked</p> : null}
          </button>
        </div>

        {error ? <div className="rounded-2xl border border-rose-500/25 bg-rose-500/8 px-4 py-3 text-sm text-rose-300">{error}</div> : null}

        {myVote ? (
          <div className={`rounded-[26px] border px-4 py-4 ${voteMatched ? 'border-emerald-500/25 bg-emerald-500/8' : 'border-zinc-700 bg-black/25'}`}>
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Your result</p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-200">
              {voteMatched === null
                ? 'Your vote has been recorded.'
                : voteMatched
                  ? 'Your vote matched the higher stored rating.'
                  : `Your vote did not match the higher stored rating. The rating data favored ${
                      winner === 'a' ? fighterLabel(battle.fighterA) : fighterLabel(battle.fighterB)
                    }.`}
            </p>
          </div>
        ) : null}

        <div className="rounded-[28px] border border-zinc-800 bg-black/25 p-4">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck size={16} className="text-zinc-500" />
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Final AI rating and metric breakdown</p>
          </div>
          {hasLockedVote ? (
            <>
              <div className="mb-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/75 p-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{fighterLabel(battle.fighterA)}</p>
                  <p className={`mt-2 text-3xl font-black italic ${winner === 'a' ? 'text-emerald-300' : winner === 'b' ? 'text-rose-300' : 'text-cyan-300'}`}>{fighterScore(battle.fighterA)?.toFixed(1) ?? '--'}</p>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/75 p-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{fighterLabel(battle.fighterB)}</p>
                  <p className={`mt-2 text-3xl font-black italic ${winner === 'b' ? 'text-emerald-300' : winner === 'a' ? 'text-rose-300' : 'text-emerald-300'}`}>{fighterScore(battle.fighterB)?.toFixed(1) ?? '--'}</p>
                </div>
              </div>
              <MetricBreakdown battle={battle} />
            </>
          ) : (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/75 px-4 py-5 text-sm text-zinc-400">
              Vote on this battle to unlock the final ratings and metric breakdown. If a participant has a public analysis page, you can still open it directly from the participant cards above.
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
};

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

  const submitBattle = async () => {
    if (!user) {
      setError('Sign in to create a battle.');
      return;
    }
    if (!fighterA || !fighterB) {
      setError('Pick two scans first.');
      return;
    }
    if (fighterA.id === fighterB.id) {
      setError('Choose two different scans.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const token = await user.getIdToken();
      const payloadA = {
        ...fighterA,
        name: nameA.trim() || fighterA.name || 'Scan',
      };
      const payloadB = {
        ...fighterB,
        name: nameB.trim() || fighterB.name || 'Scan',
      };

      const result = await postCommunityBattle(token, payloadA, payloadB);
      if (!result.ok) throw new Error(result.data?.error || 'Could not create battle.');

      const created = normalizeBattle(
        result.data?.battle ? { id: result.data.battle.id || result.data.id, ...result.data.battle } : null
      );

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
          <button
            type="button"
            onClick={() => {
              onClose();
              setCurrentPage('upload-photo');
            }}
            className="rounded-[30px] border border-cyan-500/30 bg-cyan-500/8 p-6 text-left transition-all duration-300 hover:scale-[1.01] hover:border-cyan-400/60 hover:bg-cyan-500/12"
          >
            <Plus size={22} className="text-cyan-300" />
            <h4 className="mt-4 text-xl font-black uppercase tracking-[0.14em] text-white">Add new scans</h4>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Jump to the upload page, create fresh scans, then come back here to battle them.
            </p>
          </button>
          <button
            type="button"
            onClick={() => setMode('history')}
            className="rounded-[30px] border border-zinc-800 bg-black/30 p-6 text-left transition-all duration-300 hover:scale-[1.01] hover:border-zinc-700 hover:bg-zinc-950/80"
          >
            <History size={22} className="text-zinc-300" />
            <h4 className="mt-4 text-xl font-black uppercase tracking-[0.14em] text-white">Pick from history</h4>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Use scans already on your account, then type names to show on the leaderboard and voting cards.
            </p>
          </button>
          <button
            type="button"
            onClick={() => setMode('community')}
            className="rounded-[30px] border border-emerald-500/25 bg-emerald-500/8 p-6 text-left transition-all duration-300 hover:scale-[1.01] hover:border-emerald-400/50 hover:bg-emerald-500/12"
          >
            <Sparkles size={22} className="text-emerald-300" />
            <h4 className="mt-4 text-xl font-black uppercase tracking-[0.14em] text-white">Pick community scans</h4>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Choose from public community scans and use their saved ratings/stats to decide the battle winner.
            </p>
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setMode('choice')}
              className="rounded-full border border-zinc-800 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-zinc-400 transition-all hover:border-zinc-700 hover:text-white"
            >
              Back
            </button>
            {mode === 'history' ? (
              <button
                type="button"
                onClick={fetchUserScans}
                className="rounded-full border border-zinc-800 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-zinc-400 transition-all hover:border-zinc-700 hover:text-white"
              >
                Refresh scans
              </button>
            ) : null}
            {mode === 'community' ? (
              <button
                type="button"
                onClick={fetchPublicCommunityScans}
                className="rounded-full border border-emerald-500/25 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-emerald-300 transition-all hover:border-emerald-400/50 hover:text-white"
              >
                Refresh community
              </button>
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
                        <img src={scan.frontImage} alt="" className="aspect-[4/5] w-full object-cover" />
                        <div className="p-3">
                          <p className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-white">
                            {scan.name || `Scan ${idx + 1}`}
                          </p>
                          <p className="mt-1 text-[11px] font-mono text-zinc-400">{Number(scan.finalRating || 0).toFixed(1)}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  value={side.name}
                  onChange={(e) => side.setName(e.target.value)}
                  placeholder="Type a display name"
                  className="mt-4 w-full rounded-2xl border border-zinc-800 bg-zinc-950/75 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-cyan-500"
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={submitBattle}
              disabled={submitting}
              className="rounded-full border border-cyan-500/40 bg-cyan-400 px-6 py-3 text-xs font-black uppercase tracking-[0.2em] text-black transition-all duration-300 hover:scale-[1.02] hover:bg-cyan-300 disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create battle'}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
};

const VoteFeedCard = ({ battle, isFeatured = false, hasVoted = false, isFollowed = false, onOpen, onToggleFollow, onShare }) => {
  const labelA = fighterLabel(battle.fighterA);
  const labelB = fighterLabel(battle.fighterB);
  const totalVotes = Number(battle.votesA || 0) + Number(battle.votesB || 0);
  const pctA = totalVotes ? Math.round((Number(battle.votesA || 0) / totalVotes) * 100) : 50;
  const pctB = totalVotes ? 100 - pctA : 50;

  return (
    <article
      className={`relative rounded-[26px] border bg-[linear-gradient(180deg,rgba(8,8,8,0.96),rgba(5,5,5,0.99))] p-5 md:p-6 ${
        isFeatured
          ? 'border-cyan-400/20 shadow-[0_18px_60px_rgba(0,240,255,0.10)]'
          : 'border-white/10 shadow-[0_14px_42px_rgba(0,0,0,0.34)]'
      }`}
    >
      <div className="absolute right-5 top-5 z-10 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onToggleFollow?.(battle.id)}
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] transition-all ${
            isFollowed
              ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200'
              : 'border-white/10 bg-black/50 text-zinc-400 hover:border-emerald-400/30 hover:text-white'
          }`}
        >
          <Heart size={12} className={isFollowed ? 'fill-emerald-300 text-emerald-300' : ''} />
          {isFollowed ? 'Following' : 'Follow'}
        </button>
        <button
          type="button"
          onClick={() => onShare?.(battle.id)}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400 transition-all hover:border-cyan-400/30 hover:text-white"
        >
          <Share2 size={12} />
          Share
        </button>
      </div>
      <div className="grid gap-6 pt-4 lg:grid-cols-[minmax(0,0.9fr)_260px_minmax(0,0.9fr)] lg:items-center">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-[16px] border border-white/10 bg-black/40 shadow-[inset_0_0_0_1px_rgba(0,240,255,0.05)]">
            <img
              src={fighterImage(battle.fighterA)}
              alt={labelA}
              className="aspect-[4/4.1] w-full object-cover object-top"
            />
          </div>
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-cyan-200/45">Fighter A</p>
              <h3 className="mt-2 truncate text-[11px] font-black uppercase tracking-[0.16em] text-white md:text-[12px]">
                {labelA}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onOpen(battle)}
              className={`rounded-full px-7 py-3 text-[12px] font-black uppercase tracking-[0.24em] transition-all duration-300 ${
                hasVoted
                  ? 'border border-zinc-700 bg-zinc-800 text-zinc-400 shadow-none hover:border-zinc-600 hover:text-zinc-200'
                  : 'border border-[#f7c400]/60 bg-[linear-gradient(180deg,#ffd42a_0%,#f7c400_55%,#dba400_100%)] text-black shadow-[0_0_22px_rgba(247,196,0,0.28),0_0_52px_rgba(247,196,0,0.10)] hover:scale-[1.02] hover:shadow-[0_0_28px_rgba(247,196,0,0.34),0_0_62px_rgba(247,196,0,0.16)]'
              }`}
            >
              {hasVoted ? 'View' : 'Vote'}
            </button>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center gap-4 lg:px-2">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-cyan-200/55">Cast your vote</div>
          <div className="bg-[linear-gradient(180deg,#f5fbff_0%,#7ddfff_58%,#00F0FF_100%)] bg-clip-text text-[48px] font-black uppercase tracking-[0.18em] text-transparent">
            VS
          </div>
          <div className="w-full max-w-[240px]">
            <div className="mb-3 flex items-center justify-between text-[11px] font-mono font-bold uppercase tracking-[0.2em] text-zinc-400">
              <span>{hasVoted ? `${pctA}%` : 'Hidden'}</span>
              <span>{totalVotes} votes</span>
              <span>{hasVoted ? `${pctB}%` : 'Hidden'}</span>
            </div>
            <div className="relative h-[8px] overflow-hidden rounded-full border border-white/10 bg-zinc-900/90">
              {hasVoted ? (
                <>
                  <div
                    className="h-full bg-[linear-gradient(90deg,rgba(255,86,86,0.92),rgba(255,116,116,0.72))] transition-all duration-500"
                    style={{ width: `${pctA}%` }}
                  />
                  <div
                    className="absolute right-0 top-0 h-full bg-[linear-gradient(90deg,rgba(88,226,138,0.55),rgba(74,222,128,0.95))] transition-all duration-500"
                    style={{ width: `${pctB}%` }}
                  />
                </>
              ) : (
                <>
                  <div
                    className="absolute inset-y-0 left-0 w-1/2 overflow-hidden bg-[linear-gradient(90deg,rgba(255,74,74,0.96),rgba(255,104,104,0.82),rgba(255,74,74,0.72))]"
                  >
                    <div
                      className="absolute inset-y-0 -left-[70%] w-[190%] opacity-85"
                      style={{
                        background:
                          'repeating-linear-gradient(90deg, rgba(255,58,58,0.96) 0px, rgba(255,58,58,0.96) 16px, rgba(255,132,132,0.92) 16px, rgba(255,132,132,0.92) 32px, rgba(255,88,88,0.96) 32px, rgba(255,88,88,0.96) 50px)',
                        animation: 'mogBlindVoteSlideLeft .6s linear infinite',
                      }}
                    />
                  </div>
                  <div
                    className="absolute inset-y-0 right-0 w-1/2 overflow-hidden bg-[linear-gradient(90deg,rgba(78,226,132,0.72),rgba(100,238,150,0.86),rgba(74,222,128,0.96))]"
                  >
                    <div
                      className="absolute inset-y-0 -left-[20%] w-[190%] opacity-85"
                      style={{
                        background:
                          'repeating-linear-gradient(90deg, rgba(62,210,116,0.96) 0px, rgba(62,210,116,0.96) 16px, rgba(126,244,170,0.92) 16px, rgba(126,244,170,0.92) 32px, rgba(84,228,136,0.96) 32px, rgba(84,228,136,0.96) 50px)',
                        animation: 'mogBlindVoteSlideRight .6s linear infinite',
                      }}
                    />
                  </div>
                  <div
                    className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.06),rgba(255,255,255,0.02),rgba(0,0,0,0.06))]"
                  />
                  <div
                    className="absolute left-1/2 top-[-40%] h-[180%] w-[18%] -translate-x-1/2 rounded-full bg-white/10 blur-[10px]"
                    style={{ animation: 'mogBlindVoteCenter 1.1s ease-in-out infinite' }}
                  />
                </>
              )}
            </div>
          </div>
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-500">
            {hasVoted ? 'Percentages unlocked' : 'Vote to unlock results'}
          </div>
        </div>

        <div className="space-y-4">
          <div className="overflow-hidden rounded-[16px] border border-white/10 bg-black/40 shadow-[inset_0_0_0_1px_rgba(0,240,255,0.05)]">
            <img
              src={fighterImage(battle.fighterB)}
              alt={labelB}
              className="aspect-[4/4.1] w-full object-cover object-top"
            />
          </div>
          <div className="flex items-end justify-between gap-4">
            <button
              type="button"
              onClick={() => onOpen(battle)}
              className={`rounded-full px-7 py-3 text-[12px] font-black uppercase tracking-[0.24em] transition-all duration-300 ${
                hasVoted
                  ? 'border border-zinc-700 bg-zinc-800 text-zinc-400 shadow-none hover:border-zinc-600 hover:text-zinc-200'
                  : 'border border-[#f7c400]/60 bg-[linear-gradient(180deg,#ffd42a_0%,#f7c400_55%,#dba400_100%)] text-black shadow-[0_0_22px_rgba(247,196,0,0.28),0_0_52px_rgba(247,196,0,0.10)] hover:scale-[1.02] hover:shadow-[0_0_28px_rgba(247,196,0,0.34),0_0_62px_rgba(247,196,0,0.16)]'
              }`}
            >
              {hasVoted ? 'View' : 'Vote'}
            </button>
            <div className="min-w-0 text-right">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-cyan-200/45">Fighter B</p>
              <h3 className="mt-2 truncate text-[11px] font-black uppercase tracking-[0.16em] text-white md:text-[12px]">
                {labelB}
              </h3>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
};

const LatestBattleCard = ({ battle, isFollowed = false, onOpen, onShare, onToggleFollow }) => {
  const labelA = fighterLabel(battle.fighterA);
  const labelB = fighterLabel(battle.fighterB);

  return (
    <div className="group overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,12,12,0.96),rgba(7,7,7,0.98))] text-left shadow-[0_16px_44px_rgba(0,0,0,0.36)] transition-all duration-300 hover:border-cyan-400/30 hover:shadow-[0_18px_52px_rgba(0,240,255,0.08)]">
      <button type="button" onClick={() => onOpen(battle)} className="block w-full text-left">
      <div className="grid grid-cols-2">
        <div className="relative overflow-hidden border-r border-white/10">
          <img src={fighterImage(battle.fighterA)} alt={labelA} className="aspect-[3/4] w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]" />
        </div>
        <div className="relative overflow-hidden">
          <img src={fighterImage(battle.fighterB)} alt={labelB} className="aspect-[3/4] w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-4">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-black uppercase tracking-[0.14em] text-white">
            {labelA} <span className="text-zinc-500">vs</span> {labelB}
          </p>
        </div>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          {formatBattleTime(battle.createdAt)}
        </span>
      </div>
      </button>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={() => onToggleFollow?.(battle.id)}
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-all ${
            isFollowed
              ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200'
              : 'border-white/10 bg-black/40 text-zinc-400 hover:border-emerald-400/30 hover:text-white'
          }`}
        >
          <Heart size={11} className={isFollowed ? 'fill-emerald-300 text-emerald-300' : ''} />
          {isFollowed ? 'Following' : 'Follow'}
        </button>
        <button
          type="button"
          onClick={() => onShare?.(battle.id)}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400 transition-all hover:border-cyan-400/30 hover:text-white"
        >
          <Share2 size={11} />
          Share battle
        </button>
      </div>
    </div>
  );
};

const MogBattlePage = ({ user, setCurrentPage, dashboardData }) => {
  const [communityBattles, setCommunityBattles] = useState([]);
  const [leaderboardCap, setLeaderboardCap] = useState(50);
  const [leaderboardProfile, setLeaderboardProfile] = useState(null);
  const [voteModalBattle, setVoteModalBattle] = useState(null);
  const [newBattleOpen, setNewBattleOpen] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);
  const [sortBy, setSortBy] = useState('latest');
  const [loading, setLoading] = useState(true);
  const [myVotesByBattle, setMyVotesByBattle] = useState({});
  const [followedBattleIds, setFollowedBattleIds] = useState([]);
  const [shareStatus, setShareStatus] = useState('');
  const [openedSharedBattleId, setOpenedSharedBattleId] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadFollowedBattles = async () => {
      const localIds = readFollowedBattleIds();
      if (!user) {
        setFollowedBattleIds(localIds);
        return;
      }

      try {
        const token = await user.getIdToken();
        const data = await fetchFollowedMogBattles(token);
        if (cancelled) return;
        const remoteIds = (data.battleIds || []).map((id) => String(id));
        setFollowedBattleIds(remoteIds);
        try {
          window.localStorage.setItem(FOLLOWED_BATTLES_STORAGE_KEY, JSON.stringify(remoteIds));
        } catch {
          // ignore private browsing/local storage errors
        }
      } catch {
        if (!cancelled) setFollowedBattleIds(localIds);
      }
    };

    loadFollowedBattles();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const toggleFollowBattle = useCallback(async (battleId) => {
    const id = String(battleId || '');
    if (!id) return;
    const nextFollowing = !followedBattleIds.includes(id);

    setFollowedBattleIds((current) => {
      const next = nextFollowing ? Array.from(new Set([...current, id])) : current.filter((value) => value !== id);
      try {
        window.localStorage.setItem(FOLLOWED_BATTLES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore private browsing/local storage errors
      }
      return next;
    });

    if (!user) {
      setShareStatus('Sign in to sync followed battles.');
      window.setTimeout(() => setShareStatus(''), 2600);
      return;
    }

    try {
      const token = await user.getIdToken();
      const result = await setMogBattleFollow(token, id, nextFollowing);
      if (!result.ok) throw new Error(result.data?.error || 'Could not update follow');
    } catch {
      setShareStatus('Follow saved locally. Cloud sync will retry next time.');
      window.setTimeout(() => setShareStatus(''), 2600);
    }
  }, [followedBattleIds, user]);

  const shareBattle = useCallback(async (battleId) => {
    const url = battleShareUrl(battleId);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setShareStatus('Share link copied.');
      } else {
        setShareStatus(url);
      }
    } catch {
      setShareStatus(url);
    }
    window.setTimeout(() => setShareStatus(''), 2600);
  }, []);

  const loadCommunityBattles = useCallback(async () => {
    try {
      const response = await fetchCommunityBattles();
      setCommunityBattles((response.battles || []).map(normalizeBattle).filter(Boolean));
    } catch (e) {
      console.error('Failed to load community battles', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCommunityBattles();
    const intervalId = window.setInterval(loadCommunityBattles, 300000);
    return () => window.clearInterval(intervalId);
  }, [loadCommunityBattles]);

  const feedItems = useMemo(() => {
    const featured = getAllFeaturedBattles().map(normalizeBattle).filter(Boolean);
    const combined = [...communityBattles];
    featured.forEach((battle) => {
      if (!combined.some((item) => item.id === battle.id)) combined.push(battle);
    });
    return combined.sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
  }, [communityBattles]);

  const leaderboardRows = useMemo(() => buildMogLeaderboard(feedItems), [feedItems]);
  const leaderboardDisplay = leaderboardRows;
  const visibleRows = useMemo(() => leaderboardDisplay.slice(0, leaderboardCap), [leaderboardCap, leaderboardDisplay]);

  const castVoteBattles = useMemo(() => {
    const items = [...feedItems];
    if (sortBy === 'popular') {
      items.sort(
        (a, b) =>
          (Number(b.votesA || 0) + Number(b.votesB || 0)) -
          (Number(a.votesA || 0) + Number(a.votesB || 0))
      );
    }
    return items.slice(0, 12);
  }, [feedItems, sortBy]);

  const latestBattles = useMemo(() => feedItems.slice(0, 4), [feedItems]);
  const followedBattles = useMemo(
    () => feedItems.filter((battle) => followedBattleIds.includes(String(battle.id))),
    [feedItems, followedBattleIds]
  );

  const battleHistoryItems = useMemo(
    () => [...feedItems].sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt)).slice(0, 10),
    [feedItems]
  );

  useEffect(() => {
    if (!feedItems.length || openedSharedBattleId) return;
    const battleId = new URLSearchParams(window.location.search).get('battle');
    if (!battleId) return;
    const match = feedItems.find((battle) => String(battle.id) === String(battleId));
    if (!match) return;
    setOpenedSharedBattleId(String(battleId));
    setVoteModalBattle(match);
  }, [feedItems, openedSharedBattleId]);

  const refreshBattleTallies = useCallback(async () => {
    if (!feedItems.length) return;
    const tallyPairs = await Promise.all(
      feedItems.slice(0, 20).map(async (battle) => {
        try {
          const tally = await fetchMogBattleTallies(battle.id);
          return [battle.id, { a: Number(tally.a) || 0, b: Number(tally.b) || 0 }];
        } catch {
          return [battle.id, null];
        }
      })
    );

    const tallyMap = new Map(tallyPairs.filter(([, value]) => value));
    if (!tallyMap.size) return;

    setCommunityBattles((prev) =>
      prev.map((battle) => {
        const tally = tallyMap.get(battle.id);
        return tally ? { ...battle, votesA: tally.a, votesB: tally.b } : battle;
      })
    );
  }, [feedItems]);

  useEffect(() => {
    if (!feedItems.length) return;
    refreshBattleTallies();
  }, [feedItems.length, refreshBattleTallies]);

  useEffect(() => {
    if (!user) {
      setMyVotesByBattle({});
      return;
    }
    if (!castVoteBattles.length) return;

    let cancelled = false;

    (async () => {
      try {
        const token = await user.getIdToken();
        const results = await Promise.all(
          castVoteBattles.map(async (battle) => {
            try {
              const data = await fetchMyMogBattleVote(token, battle.id);
              return data?.side ? [battle.id, data.side] : null;
            } catch {
              return null;
            }
          })
        );

        if (cancelled) return;

        setMyVotesByBattle((prev) => {
          const next = { ...prev };
          results.forEach((entry) => {
            if (entry) next[entry[0]] = entry[1];
          });
          return next;
        });
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, castVoteBattles]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050505] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,240,255,0.07),transparent_24%),radial-gradient(circle_at_left,rgba(0,240,255,0.03),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.02),transparent_32%)]" />
      <style>{`
        @keyframes mogFadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes mogBlindVoteSlideLeft {
          0% { transform: translateX(0%); }
          100% { transform: translateX(21%); }
        }

        @keyframes mogBlindVoteSlideRight {
          0% { transform: translateX(0%); }
          100% { transform: translateX(-21%); }
        }

        @keyframes mogBlindVoteCenter {
          0% { opacity: 0.18; transform: translateX(-50%) scaleY(0.82); }
          50% { opacity: 0.36; transform: translateX(-50%) scaleY(1.16); }
          100% { opacity: 0.18; transform: translateX(-50%) scaleY(0.82); }
        }

        .mog-scroll {
          scrollbar-width: thin;
          scrollbar-color: #161616 #050505;
        }

        .mog-scroll::-webkit-scrollbar {
          width: 12px;
          height: 12px;
          background: #050505;
        }

        .mog-scroll::-webkit-scrollbar-track {
          background: #050505;
          border-left: 1px solid rgba(255, 255, 255, 0.06);
        }

        .mog-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, #161616, #0b0b0b);
          border: 2px solid #050505;
          border-radius: 999px;
        }

        .mog-scroll::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, #222222, #121212);
        }
      `}</style>

      <div className="relative z-10 mx-auto max-w-[1640px] px-6 pb-24 pt-28 xl:px-10">
        <div className="grid gap-14 xl:grid-cols-[320px_minmax(0,1fr)] xl:items-start">
          <aside className="xl:sticky xl:top-28">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="bg-[linear-gradient(180deg,#ffffff_0%,#bceeff_58%,#00F0FF_100%)] bg-clip-text text-[18px] font-black uppercase tracking-[0.08em] text-transparent">
                  Leaderboard
                </p>
                <p className="mt-1 font-mono text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-200/45">All time</p>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/10 bg-cyan-400/[0.05] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-cyan-100/80 shadow-[0_0_24px_rgba(0,240,255,0.06)]">
                <Crown size={12} className="text-[#00F0FF]" />
                W/L
              </div>
            </div>

            <div className="overflow-hidden rounded-[28px] border border-cyan-400/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] shadow-[0_20px_48px_rgba(0,0,0,0.32),0_0_0_1px_rgba(0,240,255,0.03)] backdrop-blur-xl">
              <div className="border-b border-white/10 bg-[linear-gradient(90deg,rgba(0,240,255,0.08),rgba(255,255,255,0.01))] px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-full border border-cyan-400/15 bg-cyan-400/[0.06] p-2 text-[#00F0FF]">
                      <Trophy size={15} />
                    </div>
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.2em] text-white">Top fighters</p>
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Blind ladder ranking</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLeaderboardCap((cap) => (cap >= leaderboardDisplay.length ? 10 : leaderboardDisplay.length))}
                    className="rounded-full border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300 transition-all duration-300 hover:border-cyan-400/20 hover:text-white"
                  >
                    {leaderboardDisplay.length > 10 && leaderboardCap >= leaderboardDisplay.length ? 'Collapse' : 'Expand'}
                  </button>
                </div>
              </div>
              <div className="mog-scroll max-h-[780px] overflow-y-auto">
                {visibleRows.length ? (
                  visibleRows.map((row, idx) => (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => setLeaderboardProfile(row)}
                      className="grid w-full grid-cols-[34px_42px_minmax(0,1fr)_52px] items-center gap-4 border-b border-white/10 px-5 py-4 text-left transition-all duration-300 hover:bg-cyan-400/[0.04] last:border-b-0"
                    >
                      <span className={`text-[32px] font-black leading-none ${idx < 3 ? 'bg-[linear-gradient(180deg,#ffffff_0%,#87e8ff_65%,#00F0FF_100%)] bg-clip-text text-transparent' : 'text-zinc-500'}`}>
                        {idx + 1}
                      </span>
                      <img src={row.img} alt={row.name} className="h-11 w-11 rounded-2xl border border-white/10 object-cover object-top grayscale" />
                      <div className="min-w-0">
                        <p className="truncate bg-[linear-gradient(180deg,#ffffff_0%,#c9f7ff_58%,#59ddff_100%)] bg-clip-text text-[14px] font-black uppercase tracking-[0.13em] text-transparent">{row.name}</p>
                        <p className="mt-1 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-600">{fighterGenderLabel(row.fighter)}</p>
                      </div>
                      <div className="text-right text-[11px] font-black uppercase leading-tight tracking-[0.08em]">
                        <div className="text-cyan-200">{row.wins}W</div>
                        <div className="mt-1 text-zinc-500">{row.losses}L</div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="px-5 py-12 text-sm text-zinc-500">{loading ? 'Loading leaderboard...' : 'No battles yet.'}</div>
                )}
              </div>
            </div>
          </aside>

          <main className="min-w-0">
            <div className="mb-14 grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
              <div className="max-w-[860px]">
                <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-400/15 bg-cyan-400/[0.04] px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-200/80">
                  <Swords size={12} className="text-[#00F0FF]" />
                  Ranked Matchups
                </div>
                <h1 className="bg-[linear-gradient(180deg,#33ddff_0%,#14a9ff_42%,#0d6dc4_74%,#06325f_100%)] bg-clip-text text-[56px] font-black italic uppercase tracking-[-0.06em] text-transparent drop-shadow-[0_12px_34px_rgba(0,240,255,0.12)] md:text-[86px]">
                  MOG BATTLES
                </h1>
                <p className="mt-5 max-w-[760px] text-[15px] leading-relaxed text-zinc-400">
                  Vote on matchups, track winners, and compare scan performance inside the same MogCheck visual system.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] px-5 py-4 shadow-[0_16px_38px_rgba(0,0,0,0.28)]">
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-200/70">Live Feed</p>
                  <p className="mt-3 text-4xl font-black text-white">{castVoteBattles.length}</p>
                  <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">Tracked battles</p>
                </div>
                <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] px-5 py-4 shadow-[0_16px_38px_rgba(0,0,0,0.28)]">
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-200/70">Ladder</p>
                  <p className="mt-3 text-4xl font-black text-white">{leaderboardRows.length}</p>
                  <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">Visible fighters</p>
                </div>
              </div>
            </div>

            <div className="mb-12 grid gap-8 xl:grid-cols-[minmax(0,1fr)_240px] xl:items-start">
              <div>
                <div className="mb-5 flex items-center gap-3">
                  <div className="rounded-full border border-white/10 bg-white/[0.02] p-2.5 text-[#00F0FF] shadow-[0_0_24px_rgba(0,240,255,0.08)]">
                    <Swords size={16} />
                  </div>
                  <div>
                    <p className="text-[12px] font-black uppercase tracking-[0.26em] text-white">Latest Battles</p>
                  </div>
                </div>
                <div className="grid gap-5 md:grid-cols-2">
                  {latestBattles.length ? (
                    latestBattles.map((battle) => (
                      <LatestBattleCard
                        key={battle.id}
                        battle={battle}
                        isFollowed={followedBattleIds.includes(String(battle.id))}
                        onOpen={setVoteModalBattle}
                        onShare={shareBattle}
                        onToggleFollow={toggleFollowBattle}
                      />
                    ))
                  ) : (
                    <div className="col-span-full flex min-h-[280px] items-center justify-center rounded-[28px] border border-white/10 bg-white/[0.02] text-sm text-zinc-500">
                      {loading ? 'Loading latest battles...' : 'No recent battles yet.'}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4 pt-12 xl:pt-[52px]">
                <button
                  type="button"
                  onClick={() => setNewBattleOpen(true)}
                  className="flex w-full flex-col items-start gap-2 rounded-[24px] border border-cyan-400/25 bg-cyan-400/[0.06] px-6 py-5 text-left transition-all duration-300 hover:border-cyan-400/45 hover:bg-cyan-400/[0.10] hover:shadow-[0_12px_28px_rgba(0,240,255,0.10)]"
                >
                  <span className="inline-flex items-center gap-2 text-[13px] font-black text-white">
                    <Plus size={16} className="text-[#00F0FF]" />
                    New Battle
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-200/70">Add scans or pick from history</span>
                </button>
                <button
                  type="button"
                  onClick={() => document.getElementById('mog-battle-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="flex w-full flex-col items-start gap-2 rounded-[24px] border border-white/10 bg-white/[0.02] px-6 py-5 text-left transition-all duration-300 hover:border-white/20 hover:bg-white/[0.04]"
                >
                  <span className="inline-flex items-center gap-2 text-[13px] font-black text-white">
                    <History size={16} className="text-zinc-300" />
                    Battle history
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">Jump to previous results</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowFollowing(true)}
                  className="flex w-full flex-col items-start gap-2 rounded-[24px] border border-emerald-400/20 bg-emerald-400/[0.04] px-6 py-5 text-left transition-all duration-300 hover:border-emerald-400/40 hover:bg-emerald-400/[0.08]"
                >
                  <span className="inline-flex items-center gap-2 text-[13px] font-black text-white">
                    <Heart size={16} className="text-emerald-300" />
                    Following
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-200/60">{followedBattles.length} tracked battles</span>
                </button>
              </div>
            </div>

            <div className={`${pageCardClass} mb-8 overflow-hidden`}>
              <div className={`${pageCardHeaderClass} flex items-center justify-between gap-4`}>
                <div className="flex items-center gap-3">
                  <div className={sectionHeaderIconClass}>
                    <ShieldCheck size={16} />
                  </div>
                  <div>
                    <p className="text-[12px] font-black uppercase tracking-[0.26em] text-white">Cast your vote</p>
                  </div>
                </div>
                <div className="relative">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="appearance-none rounded-full border border-white/10 bg-white/[0.03] px-4 py-3 pr-10 font-mono text-[11px] font-black uppercase tracking-[0.24em] text-white outline-none transition-colors focus:border-cyan-400/40"
                  >
                    <option value="latest">Latest</option>
                    <option value="popular">Most popular</option>
                  </select>
                  <ChevronDown size={14} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500" />
                </div>
              </div>
              <div className="mog-scroll max-h-[920px] space-y-8 overflow-y-auto px-5 py-5 md:px-6 md:py-6">
                {castVoteBattles.length ? (
                  castVoteBattles.map((battle, index) => (
                    <div
                      key={battle.id}
                      className="opacity-0 [animation:mogFadeUp_.45s_ease-out_forwards]"
                      style={{ animationDelay: `${index * 55}ms` }}
                    >
                      <VoteFeedCard
                        battle={battle}
                        isFeatured={index === 0}
                        hasVoted={Boolean(myVotesByBattle[battle.id])}
                        isFollowed={followedBattleIds.includes(String(battle.id))}
                        onToggleFollow={toggleFollowBattle}
                        onShare={shareBattle}
                        onOpen={setVoteModalBattle}
                      />
                    </div>
                  ))
                ) : (
                  <div className="flex min-h-[320px] items-center justify-center rounded-[28px] border border-white/10 bg-white/[0.02] text-sm text-zinc-500">
                    {loading ? 'Loading battles...' : 'No battles to vote on yet.'}
                  </div>
                )}
              </div>
            </div>

            <div id="mog-battle-history" className={`${pageCardClass} overflow-hidden`}>
              <div className={`${pageCardHeaderClass} flex items-center gap-3`}>
                <div className={sectionHeaderIconClass}>
                  <History size={16} />
                </div>
                <div>
                  <p className="text-[12px] font-black uppercase tracking-[0.26em] text-white">Battle history</p>
                </div>
              </div>
              <div className="mog-scroll max-h-[420px] space-y-3 overflow-y-auto px-5 py-5 md:px-6 md:py-6">
                {battleHistoryItems.length ? (
                  battleHistoryItems.map((battle) => {
                    const winner = aiWinner(battle.fighterA, battle.fighterB);
                    const winnerName =
                      winner === 'a'
                        ? fighterLabel(battle.fighterA)
                        : winner === 'b'
                          ? fighterLabel(battle.fighterB)
                          : 'Tie';
                    return (
                      <button
                        type="button"
                        key={`history-${battle.id}`}
                        onClick={() => setVoteModalBattle(battle)}
                        className="flex w-full items-center justify-between gap-4 rounded-[22px] border border-white/10 bg-white/[0.02] px-4 py-4 text-left transition-all duration-300 hover:border-cyan-400/20 hover:bg-cyan-400/[0.03]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-black uppercase tracking-[0.14em] text-white">
                            {fighterLabel(battle.fighterA)} <span className="text-zinc-500">vs</span> {fighterLabel(battle.fighterB)}
                          </p>
                          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                            {formatBattleTime(battle.createdAt)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Winner</p>
                          <p className="mt-1 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-300">{winnerName}</p>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="flex min-h-[180px] items-center justify-center rounded-[24px] border border-white/10 bg-white/[0.02] text-sm text-zinc-500">
                    {loading ? 'Loading history...' : 'No battle history yet.'}
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      </div>

      {leaderboardProfile ? (
        <LeaderboardProfileModal row={leaderboardProfile} onClose={() => setLeaderboardProfile(null)} />
      ) : null}
      {showFollowing ? (
        <ModalShell title="Following" subtitle="Mog Battles you are tracking" onClose={() => setShowFollowing(false)} maxWidth="max-w-4xl">
          <div className="space-y-3">
            {followedBattles.length ? (
              followedBattles.map((battle) => (
                <div
                  key={`followed-${battle.id}`}
                  className="flex w-full items-center justify-between gap-4 rounded-[24px] border border-zinc-800 bg-zinc-950/70 px-4 py-4 text-left transition-all hover:border-emerald-400/25 hover:bg-emerald-400/[0.04]"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setShowFollowing(false);
                      setVoteModalBattle(battle);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <div className="flex -space-x-3">
                      <img src={fighterImage(battle.fighterA)} alt="" className="h-12 w-12 rounded-2xl border border-zinc-800 object-cover object-top grayscale" />
                      <img src={fighterImage(battle.fighterB)} alt="" className="h-12 w-12 rounded-2xl border border-zinc-800 object-cover object-top grayscale" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black uppercase tracking-[0.14em] text-white">
                        {fighterLabel(battle.fighterA)} <span className="text-zinc-500">vs</span> {fighterLabel(battle.fighterB)}
                      </p>
                        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{formatBattleTime(battle.createdAt)}</p>
                      </div>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      shareBattle(battle.id);
                    }}
                    className="shrink-0 rounded-full border border-white/10 bg-black/40 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400 transition-all hover:border-cyan-400/30 hover:text-white"
                  >
                    Share
                  </button>
                </div>
              ))
            ) : (
              <div className="rounded-[24px] border border-zinc-800 bg-zinc-950/70 px-5 py-8 text-sm text-zinc-400">
                You are not following any battles yet. Hit Follow on a battle card to track it here.
              </div>
            )}
          </div>
        </ModalShell>
      ) : null}
      {voteModalBattle ? (
        <VoteBattleModal
          battle={voteModalBattle}
          user={user}
          onClose={() => setVoteModalBattle(null)}
          onVoteComplete={(battleId, side) => {
            setMyVotesByBattle((prev) => ({ ...prev, [battleId]: side }));
            refreshBattleTallies();
          }}
        />
      ) : null}
      {newBattleOpen ? (
        <NewBattleModal
          user={user}
          dashboardData={dashboardData}
          setCurrentPage={setCurrentPage}
          onClose={() => setNewBattleOpen(false)}
          onCreated={(createdBattle) => {
            setCommunityBattles((prev) => [createdBattle, ...prev]);
            refreshBattleTallies();
          }}
        />
      ) : null}
      {shareStatus ? (
        <div className="fixed bottom-6 left-1/2 z-[240] flex -translate-x-1/2 items-center gap-2 rounded-full border border-cyan-400/25 bg-black/90 px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] text-cyan-100 shadow-[0_0_32px_rgba(0,240,255,0.16)]">
          <Copy size={14} />
          {shareStatus}
        </div>
      ) : null}
    </div>
  );
};

export default MogBattlePage;

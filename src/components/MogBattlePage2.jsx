import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, ChevronRight, Crown, Heart, History, Lock, Plus, Share2, ShieldCheck, Swords, Trash2, Trophy, X, Activity } from 'lucide-react';
import { getAllFeaturedBattles, getMetricRowsForBattle } from '../data/mogBattles';
import {
  adminDeleteCommunityBattle,
  deleteCommunityBattle,
  fetchCommunityBattles,
  fetchFollowedMogBattles,
  fetchMogBattleTallies,
  fetchMyMogBattleVote,
  postMogBattleVote,
  setMogBattleFollow,
} from '../api/mogBattleVotes';
import { resolveMediaUrl } from '../utils/mediaUrl';

const FOLLOWED_BATTLES_STORAGE_KEY = 'mogcheck-followed-battles';

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

  const ownerUid = String(fighter?.ownerUid || fighter?.uid || currentUserUid || '').trim();
  const scanId = String(fighter?.scanId || fighter?.id || '').trim();
  const profileId = String(fighter?.profileId || '').trim();
  const isOfficial = Boolean(fighter?.officialScan || (!ownerUid && (scanId || fighter?.name)));

  if (ownerUid && scanId && !isOfficial) return `/scan/${encodeURIComponent(ownerUid)}/${encodeURIComponent(scanId)}`;
  if (ownerUid && profileId && !isOfficial) return `/users/${encodeURIComponent(ownerUid)}/${encodeURIComponent(profileId)}`;
  
  if (isOfficial) {
    return `/celebrity?scan=${encodeURIComponent(scanId || fighter?.name || 'community')}`;
  }
  
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
  return {
    ...battle,
    id: String(battle.id || `${fighterA.name}-vs-${fighterB.name}`).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    fighterA,
    fighterB,
    votesA: Number(battle.votesA || battle.a || 0),
    votesB: Number(battle.votesB || battle.b || 0),
    createdAt: battle.createdAt || battle.timestamp || battle.created_at || null,
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
      className={`group relative w-full max-w-[460px] overflow-hidden rounded-[18px] border bg-[#050506] transition-all duration-700 ease-[cubic-bezier(.16,1,.3,1)] hover:-translate-y-2 ${toneBorder} ${toneShadow} ${hasVoted && path ? 'cursor-pointer' : ''}`}
    >
      <div className="relative aspect-[9/16] min-h-[500px] max-h-[660px] w-full overflow-hidden rounded-t-[18px]">
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
            className="absolute left-5 top-5 z-10 inline-flex items-center gap-3 rounded-[14px] px-4 py-2 text-[16px] font-black uppercase tracking-[0.17em] text-emerald-300 shadow-[0_0_30px_rgba(16,185,129,0.16),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl"
            style={{
              border: '1px solid rgba(52, 211, 153, 0.20)',
              background: 'linear-gradient(135deg, rgba(16,185,129,0.24), rgba(5,78,63,0.30))',
            }}
          >
            <Trophy size={17} /> Winner
          </div>
        )}
        <div className="absolute inset-x-6 bottom-7 z-10">
          {hasVoted ? (
            <>
              <div className={`text-5xl font-black tracking-[-0.04em] ${toneText}`}>{stats.percent}%</div>
              <div className="mt-2 text-xs font-black uppercase tracking-[0.22em] text-zinc-300">{formatCount(stats.votes)} votes</div>
            </>
          ) : (
            <div className="h-[76px]" />
          )}
          <button
            type="button"
            onClick={(e) => { 
              e.stopPropagation();
              if (!hasVoted) onVote(side); 
            }}
            className={`mt-5 w-full rounded-lg px-5 py-3.5 text-sm font-black uppercase tracking-[0.18em] transition-all duration-300 ${!hasVoted ? 'hover:-translate-y-0.5' : 'cursor-default'} ${voteClass}`}
          >
            {hasVoted ? (path ? 'View Analysis' : 'Voted') : 'Vote'}
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

const MogBattlePage2 = ({ user, setCurrentPage }) => {
  const [communityBattles, setCommunityBattles] = useState([]);
  const [sortBy, setSortBy] = useState('latest');
  const [activeBattleId, setActiveBattleId] = useState('');
  const [votesByBattle, setVotesByBattle] = useState({});
  const [resultsOpenByBattle, setResultsOpenByBattle] = useState({});
  const [talliesByBattle, setTalliesByBattle] = useState({});
  const [followedBattleIds, setFollowedBattleIds] = useState([]);
  const [notice, setNotice] = useState('');
  const [isNewBattleModalOpen, setIsNewBattleModalOpen] = useState(false);
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
      return tally ? { ...battle, votesA: tally.a, votesB: tally.b } : battle;
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
    const confirmed = window.confirm('Delete this Mog Battle?');
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
          <img src={row.image} alt={row.name} className="h-12 w-12 rounded-xl object-cover grayscale transition-all duration-500 group-hover:grayscale-0 shadow-[0_4px_12px_rgba(0,0,0,0.5)]" />
          {index === 0 && (
            <span className="absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-yellow-300/50 bg-yellow-400 text-black shadow-[0_0_15px_rgba(250,204,21,0.6)]">
              <Crown size={12} fill="currentColor" />
            </span>
          )}
        </div>
        <div className="relative z-10 min-w-0 flex-1">
          <p className="truncate text-[14px] font-black uppercase tracking-[0.1em] text-zinc-100 transition-colors group-hover:text-white">{row.name}</p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">{row.wins} Victories</p>
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
      `}</style>
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_72%_18%,rgba(0,240,255,0.08),transparent_27%),radial-gradient(circle_at_18%_38%,rgba(247,196,0,0.055),transparent_24%),linear-gradient(180deg,#050607_0%,#030304_62%)]" />
      <div className="relative z-10 mx-auto grid max-w-[1500px] gap-10 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="relative lg:self-start">
          <div className="relative overflow-hidden rounded-[32px] bg-[#07070a] border border-white/[0.04] shadow-[0_40px_100px_rgba(0,0,0,0.8)]">
            <div className="absolute -top-32 -left-32 h-80 w-80 rounded-full bg-cyan-500/10 blur-[100px] pointer-events-none" />
            <div className="absolute -bottom-32 -right-32 h-80 w-80 rounded-full bg-blue-500/10 blur-[100px] pointer-events-none" />

            <div className="relative flex items-center justify-between border-b border-white/[0.04] px-6 py-5">
              <div className="flex items-center gap-4">
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
            <div className="lg:hidden overflow-x-auto px-4 py-4">
              <div className="flex gap-3" style={{ minWidth: 'max-content' }}>
                {leaderboardSlots.slice(0, 8).map((row, i) => (
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
                      <div className="flex flex-col items-center rounded-2xl border border-transparent bg-white/[0.01] p-4">
                        <span className="text-lg font-black text-zinc-800">#{i + 1}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Desktop: vertical list */}
            <div className="relative p-4 pb-0 space-y-2 hidden lg:block">
              {leaderboardSlots.slice(0, 8).map((row, i) => renderLeaderboardRow(row, i))}
            </div>
            
            <div className={`hidden lg:grid transition-all duration-700 ease-[cubic-bezier(.16,1,.3,1)] ${leaderboardExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
              <div className="overflow-hidden">
                <div className="px-4 pb-0 space-y-2 pt-2">
                  {leaderboardSlots.slice(8, 16).map((row, i) => renderLeaderboardRow(row, i + 8))}
                </div>
              </div>
            </div>
            <div className="p-4 pt-2 hidden lg:block">
              <button
                type="button"
                onClick={() => setLeaderboardExpanded((prev) => !prev)}
                className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500/10 px-4 py-4 text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400 transition-all duration-300 hover:bg-cyan-500/20 hover:text-cyan-300 hover:shadow-[0_0_30px_rgba(34,211,238,0.2)]"
              >
                <Trophy size={14} className={`transition-transform duration-300 ${leaderboardExpanded ? 'rotate-180' : 'group-hover:scale-110'}`} /> {leaderboardExpanded ? 'Collapse Rankings' : 'Full Rankings'}
              </button>
            </div>
          </div>
        </aside>

        <main className="min-w-0">
          <div className="mb-10 flex flex-col gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-4">
                <h1 className="bg-[linear-gradient(180deg,#59ecff_0%,#1ab8ff_34%,#1676ff_66%,#0637a7_100%)] bg-clip-text text-[60px] font-black italic uppercase tracking-[-0.075em] text-transparent drop-shadow-[0_14px_38px_rgba(0,132,255,0.24)] md:text-[92px]">
                  MOG BATTLES
                </h1>
                <Swords size={72} className="hidden text-[#00F0FF] drop-shadow-[0_0_24px_rgba(0,240,255,0.35)] md:block" strokeWidth={1.6} />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-6 lg:pr-[60px]">
                <div className="flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setIsNewBattleModalOpen(true)}
                    className="inline-flex items-center gap-3 rounded-xl border border-cyan-400/55 bg-cyan-400/[0.10] px-7 py-4 text-sm font-black uppercase tracking-[0.18em] text-cyan-200 shadow-[0_0_30px_rgba(0,240,255,0.12)] transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-200/80 hover:bg-cyan-400/[0.16]"
                  >
                    <Plus size={16} /> New Battle
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsFollowingModalOpen(true)}
                    className="inline-flex items-center gap-3 rounded-xl border border-emerald-400/55 bg-emerald-400/[0.10] px-7 py-4 text-sm font-black uppercase tracking-[0.18em] text-emerald-200 shadow-[0_0_30px_rgba(52,211,153,0.12)] transition-all duration-300 hover:-translate-y-0.5 hover:border-emerald-200/80 hover:bg-emerald-400/[0.16]"
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
            <div className="relative flex flex-col gap-24">

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
                  <div key={battle.id} className="relative">
                    {index > 0 && <div className="absolute -top-[48px] left-[15%] right-[15%] h-[1px] bg-white/[0.12]" />}
                    <div className="grid items-start gap-3 grid-cols-[minmax(0,1fr)_60px_minmax(0,1fr)] lg:grid-cols-[minmax(0,460px)_96px_minmax(0,460px)] lg:gap-0">
                      <div className="flex justify-center">
                        <FighterBattleCard battle={battle} side="a" stats={bStats.a} hasVoted={hasVoted} onVote={() => castVote(battle, 'a')} currentUserUid={user?.uid} />
                      </div>
                      
                      <div className="relative flex items-center justify-center self-center min-h-[200px] lg:min-h-[560px] w-full">
                        <div className="absolute inset-0 bg-[#02050a] [mask-image:linear-gradient(to_bottom,transparent_0%,black_15%,black_85%,transparent_100%)] hidden lg:block" />
                        <div className="absolute left-0 top-0 h-full w-[1px] bg-gradient-to-b from-transparent via-zinc-600 to-transparent opacity-50 hidden lg:block" />
                        <div className="absolute right-0 top-0 h-full w-[1px] bg-gradient-to-b from-transparent via-zinc-600 to-transparent opacity-50 hidden lg:block" />
                        <div className="relative z-10 flex h-[50px] w-[50px] lg:h-[90px] lg:w-[90px] shrink-0 items-center justify-center rounded-full bg-[#030304] border-[1px] border-zinc-700 shadow-[0_0_20px_rgba(255,255,255,0.05)]">
                          <span className="text-[18px] lg:text-[34px] font-black italic tracking-tighter text-zinc-300 drop-shadow-[0_2px_4px_rgba(0,0,0,1)] pr-0.5">VS</span>
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
                                onClick={() => toggleFollow(battle)}
                                className={`${followedBattleIds.includes(String(battle.id)) ? 'text-emerald-300' : 'text-emerald-300/85'} drop-shadow-[0_0_12px_rgba(52,211,153,0.52)] transition-all duration-300 hover:scale-125 hover:text-emerald-200`}
                                title="Follow battle"
                              >
                                <Heart size={24} strokeWidth={2.4} fill={followedBattleIds.includes(String(battle.id)) ? 'currentColor' : 'none'} />
                              </button>
                              <button
                                type="button"
                                onClick={() => shareBattle(battle)}
                                className="text-cyan-300 drop-shadow-[0_0_10px_rgba(34,211,238,0.5)] transition-all duration-300 hover:scale-125 hover:text-cyan-100"
                                title="Share battle"
                              >
                                <Share2 size={22} strokeWidth={2.3} />
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteBattle(battle)}
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
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[28px] border border-zinc-800 bg-zinc-950/70 p-10 text-center text-zinc-400">
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
            <div className="px-10 py-8 flex justify-between items-center shrink-0 border-b border-white/5 relative">
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
            <div className="p-10 overflow-y-auto flex-1 flex flex-col gap-6">
              {sortedBattles.slice(0, 2).map((battle) => {
                const nameA = battle.fighterA?.name || 'Fighter A';
                const nameB = battle.fighterB?.name || 'Fighter B';
                const imgA = battle.fighterA?.image || battle.fighterA?.frontImage || battle.fighterA?.imgSrc;
                const imgB = battle.fighterB?.image || battle.fighterB?.frontImage || battle.fighterB?.imgSrc;

                return (
                  <div key={`track-${battle.id}`} className="flex flex-col md:flex-row md:items-center justify-between p-6 rounded-[24px] bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] hover:border-emerald-500/30 transition-all duration-500 group shadow-[inset_0_0_20px_rgba(0,0,0,0.5)] gap-6">
                    
                    <div className="flex items-center gap-6">
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-2xl rounded-3xl border border-zinc-800 bg-[#0b0c10] p-8 shadow-2xl relative animate-[mogBattle2NoticeIn__0.3s_ease-out]">
            <button onClick={() => setIsNewBattleModalOpen(false)} className="absolute top-6 right-6 text-zinc-500 hover:text-white transition-colors">
              <X size={24} />
            </button>
            <h2 className="text-xl font-black uppercase tracking-widest text-white mb-2">New Battle</h2>
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-8">Upload a new scan or pick from your history</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button 
                onClick={() => { setIsNewBattleModalOpen(false); setCurrentPage('upload'); }} 
                className="flex flex-col text-left group relative overflow-hidden rounded-[24px] border border-cyan-500/20 bg-cyan-950/10 p-6 transition-all duration-300 hover:bg-cyan-900/20 hover:border-cyan-400/40"
              >
                <Plus size={24} className="text-cyan-400 mb-6 group-hover:scale-110 transition-transform" />
                <h3 className="text-lg font-black uppercase tracking-widest text-white mb-3">Add New Scans</h3>
                <p className="text-sm text-zinc-400 leading-relaxed font-medium">Jump to the upload page, create fresh scans, then come back here to battle them.</p>
              </button>

              <button 
                onClick={() => { setIsNewBattleModalOpen(false); setCurrentPage('history'); }} 
                className="flex flex-col text-left group relative overflow-hidden rounded-[24px] border border-zinc-800 bg-zinc-900/20 p-6 transition-all duration-300 hover:bg-zinc-800/40 hover:border-zinc-700"
              >
                <History size={24} className="text-zinc-300 mb-6 group-hover:scale-110 transition-transform" />
                <h3 className="text-lg font-black uppercase tracking-widest text-white mb-3">Pick From History</h3>
                <p className="text-sm text-zinc-400 leading-relaxed font-medium">Use scans already on your account, then type names to show on the leaderboard and voting cards.</p>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MogBattlePage2;

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Swords, Users, ChevronDown } from 'lucide-react';
import {
  getCurrentBattle,
  getMetricRowsForBattle,
  aiWinner,
  FEATURED_MOGBATTLE_IDS,
  getFeaturedBattleById,
} from '../data/mogBattles';
import {
  fetchMogBattleTallies,
  fetchMyMogBattleVote,
  postMogBattleVote,
  fetchCommunityBattles,
  fetchFeaturedVoteRankings,
} from '../api/mogBattleVotes';

const GENERIC_ERR = 'Something went wrong. Please try again later.';

const GLITCH_MS = 120;
const PRE_REVEAL_MS = 780;
const WIPE_FALLBACK_MS = 950;
const COUNT_MS = 1050;
const STAGGER_MS = 240;

const barClass = (scoreA, scoreB, side) => {
  const a = Number(scoreA);
  const b = Number(scoreB);
  if (a === b) return 'bg-zinc-500';
  if (side === 'a') return a >= b ? 'bg-emerald-500' : 'bg-red-500';
  return b >= a ? 'bg-emerald-500' : 'bg-red-500';
};

const WIN_SPARK_COUNT = 6;
const WIN_SPARK_AMBIENT = 6;
const WIN_SPARK_CELEBRATION_MS = 2500;

/** Deterministic 0–1 from index (stable across renders). */
function hash01(i, salt) {
  const x = Math.sin(i * 12.9898 + salt * 78.233 + i * 0.173) * 43758.5453;
  return x - Math.floor(x);
}

function WinSparkLayer({ show, prefersReduced }) {
  if (!show || prefersReduced) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[4] overflow-hidden rounded-2xl" aria-hidden>
      {Array.from({ length: WIN_SPARK_COUNT }, (_, i) => {
        const h = (s) => hash01(i, s);
        const left = 2 + h(1) * 96;
        const top = 1 + h(2) * 94;
        const delay = h(3) * 3.6;
        const duration = 1.05 + h(4) * 1.85;
        const animIdx = Math.floor(h(5) * 12);
        const w = 1.1 + h(6) * 4.2;
        const aspect = 0.45 + h(7) * 1.1;
        const glow = 2 + h(9) * 10;
        const rounded = h(10) > 0.48 ? '9999px' : `${2 + Math.floor(h(11) * 3)}px`;
        const palette = [
          'rgba(167, 243, 208, 0.92)',
          'rgba(110, 231, 183, 0.9)',
          'rgba(52, 211, 153, 0.95)',
          'rgba(16, 185, 129, 0.88)',
          'rgba(209, 250, 229, 0.75)',
        ];
        const bg = palette[Math.floor(h(12) * palette.length)];
        return (
          <span
            key={i}
            className="absolute [animation-fill-mode:both]"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: w,
              height: w * aspect,
              borderRadius: rounded,
              backgroundColor: bg,
              boxShadow: `0 0 ${glow}px rgba(52, 211, 153, ${0.25 + h(13) * 0.45})`,
              animation: `mog-spark-${animIdx} ${duration}s cubic-bezier(0.4, 0.15, 0.2, 1) forwards`,
              animationDelay: `${delay}s`,
            }}
          />
        );
      })}
      {Array.from({ length: WIN_SPARK_AMBIENT }, (_, j) => {
        const i = j + WIN_SPARK_COUNT + 17;
        const h = (s) => hash01(i, s);
        const left = 1 + h(1) * 98;
        const top = 1 + h(2) * 96;
        const dur = 1.35 + h(4) * 1.95;
        const delay = h(3) * 3.2;
        const w = 0.9 + h(6) * 2.8;
        return (
          <span
            key={`amb-${j}`}
            className="absolute rounded-full bg-emerald-300/90 shadow-[0_0_6px_rgba(52,211,153,0.65)] [animation-fill-mode:both]"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: w,
              height: w * (0.75 + h(8) * 0.5),
              animation: `mog-spark-ambient ${dur}s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite`,
              animationDelay: `${delay}s`,
            }}
          />
        );
      })}
    </div>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const fn = () => setReduced(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return reduced;
}

function communityCreatedMs(b) {
  const c = b?.createdAt;
  if (c?.seconds != null) return c.seconds * 1000;
  if (typeof c === 'string' || typeof c === 'number') return new Date(c).getTime();
  return 0;
}

const MogBattlePage = ({ user, setCurrentPage, dashboardData, userPlan }) => {
  const prefersReduced = usePrefersReducedMotion();

  const [activeBattle, setActiveBattle] = useState(null);
  const [communityBattles, setCommunityBattles] = useState([]);
  const [battleSort, setBattleSort] = useState('votes'); // 'votes' | 'recent'
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  const [phase, setPhase] = useState('vote');
  const [userPick, setUserPick] = useState(null);
  const [voteCounts, setVoteCounts] = useState({ a: 0, b: 0 });
  const [voteError, setVoteError] = useState(null);
  const [voteSubmitting, setVoteSubmitting] = useState(false);
  const [isBattleAdmin, setIsBattleAdmin] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);

  const [glitch, setGlitch] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [afterWipe, setAfterWipe] = useState(false);
  const [displayA, setDisplayA] = useState(0);
  const [displayB, setDisplayB] = useState(0);
  const [countDone, setCountDone] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [communityFill, setCommunityFill] = useState(0);

  const [ripples, setRipples] = useState([]);
  const [vsFast, setVsFast] = useState(false);
  const [splitIntro, setSplitIntro] = useState(true);

  const countRaf = useRef(null);
  const revealTimers = useRef([]);
  const wipeCompleteRef = useRef(false);
  const wipeFallbackTimerRef = useRef(null);
  const myVoteHydratedRef = useRef(false);
  const advanceFeaturedAfterRevealRef = useRef(false);

  const loadCommunityBattles = useCallback(async () => {
    try {
      const res = await fetchCommunityBattles();
      const { makeStats, tierFromRating100 } = await import('../data/celebrityData');
      const formatted = res.battles.map((b) => ({
        ...b,
        fighterA: {
          ...b.fighterA,
          imgSrc: b.fighterA.frontImage,
          name: b.fighterA.name || 'User A',
          rating: b.fighterA.finalRating,
          tier: tierFromRating100(b.fighterA.finalRating),
          stats: makeStats(b.fighterA.finalRating, 5),
        },
        fighterB: {
          ...b.fighterB,
          imgSrc: b.fighterB.frontImage,
          name: b.fighterB.name || 'User B',
          rating: b.fighterB.finalRating,
          tier: tierFromRating100(b.fighterB.finalRating),
          stats: makeStats(b.fighterB.finalRating, 5),
        },
      }));
      setCommunityBattles(formatted);
    } catch (e) {
      console.error('Failed to load community battles', e);
    }
  }, []);

  useEffect(() => {
    loadCommunityBattles();
    setActiveBattle(getCurrentBattle());
    const id = setInterval(loadCommunityBattles, 90_000);
    return () => clearInterval(id);
  }, [loadCommunityBattles]);

  const resetBattleState = useCallback(() => {
    advanceFeaturedAfterRevealRef.current = false;
    setPhase('vote');
    setUserPick(null);
    setVoteCounts({ a: 0, b: 0 });
    setVoteError(null);
    setVoteSubmitting(false);
    setShowMetrics(false);
    setGlitch(false);
    setWipe(false);
    setAfterWipe(false);
    setDisplayA(0);
    setDisplayB(0);
    setCountDone(false);
    setShowConfetti(false);
    setCommunityFill(0);
    setRipples([]);
    setVsFast(false);
    setSplitIntro(true);
    wipeCompleteRef.current = false;
    myVoteHydratedRef.current = false;
    
    if (countRaf.current) cancelAnimationFrame(countRaf.current);
    revealTimers.current.forEach(clearTimeout);
    revealTimers.current = [];
    if (wipeFallbackTimerRef.current) clearTimeout(wipeFallbackTimerRef.current);
  }, []);

  const changeBattle = useCallback((newBattle) => {
    resetBattleState();
    setActiveBattle(newBattle);
  }, [resetBattleState]);

  const battle = activeBattle;

  const sortedCommunityBattles = useMemo(() => {
    return [...communityBattles].sort((a, b) => {
      if (battleSort === 'votes') {
        const totalA = (a.votesA || 0) + (a.votesB || 0);
        const totalB = (b.votesA || 0) + (b.votesB || 0);
        return totalB - totalA;
      }
      return communityCreatedMs(b) - communityCreatedMs(a);
    });
  }, [communityBattles, battleSort]);

  const handleNextBattle = useCallback(() => {
    const nextBattle = sortedCommunityBattles.find(b => {
      const k = `mog-battle-vote-${user?.uid}-${b.id}`;
      return !localStorage.getItem(k);
    });
    if (nextBattle) changeBattle(nextBattle);
    else changeBattle(getCurrentBattle());
  }, [sortedCommunityBattles, user, changeBattle]);

  useEffect(() => {
    if (!battle) return;
    myVoteHydratedRef.current = false;
    setIsBattleAdmin(false);
  }, [user?.uid, battle?.id]);

  const fighterA = battle?.fighterA;
  const fighterB = battle?.fighterB;

  const metricRows = useMemo(
    () => (fighterA && fighterB ? getMetricRowsForBattle(fighterA, fighterB, 6) : []),
    [fighterA, fighterB]
  );

  const winnerSide = fighterA && fighterB ? aiWinner(fighterA, fighterB) : null;
  const ratingA = fighterA ? Number(fighterA.rating) : 0;
  const ratingB = fighterB ? Number(fighterB.rating) : 0;

  const totalVotes = voteCounts.a + voteCounts.b;
  const pctA = totalVotes ? Math.round((voteCounts.a / totalVotes) * 100) : 50;
  const pctB = totalVotes ? 100 - pctA : 50;

  const userCorrect =
    winnerSide && winnerSide !== 'tie' && userPick && userPick === winnerSide;

  const revealedUI = phase === 'revealed' || afterWipe;
  const showScoreNumbers = afterWipe || phase === 'revealed';

  const aWon = revealedUI && winnerSide === 'a';
  const aLost = revealedUI && winnerSide === 'b';
  const bWon = revealedUI && winnerSide === 'b';
  const bLost = revealedUI && winnerSide === 'a';

  const nameClassA =
    !countDone ? 'text-white' : winnerSide === 'tie' ? 'text-white' : aWon ? 'text-emerald-400' : aLost ? 'text-slate-400' : 'text-white';

  const nameClassB =
    !countDone ? 'text-white' : winnerSide === 'tie' ? 'text-white' : bWon ? 'text-emerald-400' : bLost ? 'text-slate-400' : 'text-white';

  const scoreClassA =
    !showScoreNumbers ? '' : !countDone ? 'text-zinc-300' : winnerSide === 'tie' ? 'text-cyan-400' : aWon ? 'text-emerald-400' : aLost ? 'text-slate-400' : 'text-cyan-400';

  const scoreClassB =
    !showScoreNumbers ? '' : !countDone ? 'text-zinc-300' : winnerSide === 'tie' ? 'text-cyan-400' : bWon ? 'text-emerald-400' : bLost ? 'text-slate-400' : 'text-cyan-400';

  /* Winner: animated frame is one thick SVG stroke (same weight as border-4 emerald). No second hairline ring. */
  const borderAClass =
    revealedUI && winnerSide !== 'tie'
      ? aWon
        ? prefersReduced
          ? 'border-emerald-500 shadow-[0_0_24px_rgba(16,185,129,0.25)]'
          : 'border-transparent'
        : 'border-zinc-600 shadow-[0_0_20px_rgba(15,23,42,0.5)]'
      : 'border-zinc-800';

  const borderBClass =
    revealedUI && winnerSide !== 'tie'
      ? bWon
        ? prefersReduced
          ? 'border-emerald-500 shadow-[0_0_24px_rgba(16,185,129,0.25)]'
          : 'border-transparent'
        : 'border-zinc-600 shadow-[0_0_20px_rgba(15,23,42,0.5)]'
      : 'border-zinc-800';

  const clearRevealTimers = () => {
    revealTimers.current.forEach(clearTimeout);
    revealTimers.current = [];
    if (wipeFallbackTimerRef.current) {
      clearTimeout(wipeFallbackTimerRef.current);
      wipeFallbackTimerRef.current = null;
    }
  };

  const runCountUp = useCallback(() => {
    if (prefersReduced) {
      setDisplayA(ratingA);
      setDisplayB(ratingB);
      setCountDone(true);
      setPhase('revealed');
      if (winnerSide && winnerSide !== 'tie') setShowConfetti(true);
      setCommunityFill(1);
      return;
    }
    const start = performance.now();
    const loop = (now) => {
      const elapsed = now - start;
      const ta = Math.min(1, Math.max(0, elapsed) / COUNT_MS);
      const tb = Math.min(1, Math.max(0, elapsed - STAGGER_MS) / COUNT_MS);
      const ea = 1 - (1 - ta) ** 3;
      const eb = 1 - (1 - tb) ** 3;
      setDisplayA(Math.round(ea * ratingA));
      setDisplayB(Math.round(eb * ratingB));
      if (tb < 1 || ta < 1) {
        countRaf.current = requestAnimationFrame(loop);
      } else {
        setDisplayA(ratingA);
        setDisplayB(ratingB);
        setCountDone(true);
        setPhase('revealed');
        if (winnerSide && winnerSide !== 'tie') setShowConfetti(true);
        setTimeout(() => {
          setShowConfetti(false);
        }, WIN_SPARK_CELEBRATION_MS);
        requestAnimationFrame(() => setCommunityFill(1));
      }
    };
    countRaf.current = requestAnimationFrame(loop);
  }, [prefersReduced, ratingA, ratingB, winnerSide]);

  const completeWipeReveal = useCallback(() => {
    if (wipeCompleteRef.current) return;
    wipeCompleteRef.current = true;
    if (wipeFallbackTimerRef.current) {
      clearTimeout(wipeFallbackTimerRef.current);
      wipeFallbackTimerRef.current = null;
    }
    setWipe(false);
    setAfterWipe(true);
    runCountUp();
  }, [runCountUp]);

  const onWipeCurtainAnimationEnd = useCallback(
    (e) => {
      const name = e?.animationName ?? '';
      if (typeof name === 'string' && !name.includes('mog-wipe-lift')) return;
      completeWipeReveal();
    },
    [completeWipeReveal]
  );

  const startRevealSequence = useCallback(() => {
    clearRevealTimers();
    wipeCompleteRef.current = false;
    if (prefersReduced) {
      setAfterWipe(true);
      requestAnimationFrame(() => runCountUp());
      return;
    }
    const tPre = setTimeout(() => {
      setGlitch(true);
      const t1 = setTimeout(() => {
        setGlitch(false);
        setWipe(true);
        wipeFallbackTimerRef.current = setTimeout(() => {
          completeWipeReveal();
        }, WIPE_FALLBACK_MS);
      }, GLITCH_MS);
      revealTimers.current.push(t1);
    }, PRE_REVEAL_MS);
    revealTimers.current.push(tPre);
  }, [prefersReduced, runCountUp, completeWipeReveal]);

  useEffect(() => {
    return () => {
      clearRevealTimers();
      if (countRaf.current) cancelAnimationFrame(countRaf.current);
    };
  }, []);

  /** Live totals from Firestore (same for everyone; polled + after vote). */
  useEffect(() => {
    if (!battle?.id) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const t = await fetchMogBattleTallies(battle.id);
        if (!cancelled) setVoteCounts({ a: t.a, b: t.b });
      } catch {
        /* keep previous counts */
      }
    };
    load();
    const id = setInterval(load, 18_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [battle?.id]);

  /** Restore reveal state if this account already voted (one vote per Firebase user). */
  useEffect(() => {
    if (!user || !battle || myVoteHydratedRef.current) return undefined;
    const battleId = battle.id;
    const ratingSnapA = Number(battle.fighterA?.rating) || 0;
    const ratingSnapB = Number(battle.fighterB?.rating) || 0;
    let cancelled = false;
    (async () => {
      const localKey = `mog-battle-vote-${user.uid}-${battleId}`;
      const localVote = localStorage.getItem(localKey);
      let data = { voted: false, side: null };

      try {
        const token = await user.getIdToken();
        data = await fetchMyMogBattleVote(token, battleId);
      } catch {
        /* fallback below */
      }

      if (cancelled) return;
      myVoteHydratedRef.current = true;

      if (data?.isBattleAdmin) {
        setIsBattleAdmin(true);
      }

      const hasVoted = data?.voted || !!localVote;
      const votedSide = data?.side || localVote;

      if (hasVoted && !data?.isBattleAdmin) {
        const ra = ratingSnapA;
        const rb = ratingSnapB;
        setUserPick(votedSide);
        setPhase('revealed');
        setAfterWipe(true);
        setCountDone(true);
        setDisplayA(ra);
        setDisplayB(rb);
        setCommunityFill(1);
        setSplitIntro(false);
        setGlitch(false);
        setWipe(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, battle?.id]);

  /** After a vote on a featured celebrity battle, rotate to the next slot by global popularity. */
  useEffect(() => {
    if (phase !== 'revealed' || !countDone || !advanceFeaturedAfterRevealRef.current) return undefined;
    const bid = battle?.id;
    if (!bid || !FEATURED_MOGBATTLE_IDS.includes(bid)) {
      advanceFeaturedAfterRevealRef.current = false;
      return undefined;
    }
    const tid = setTimeout(async () => {
      advanceFeaturedAfterRevealRef.current = false;
      try {
        const rankings = await fetchFeaturedVoteRankings(FEATURED_MOGBATTLE_IDS);
        const sortedIds = rankings.map((r) => r.id);
        if (!sortedIds.length) return;
        const idx = Math.max(0, sortedIds.indexOf(bid));
        const nextIdx = (idx + 1) % sortedIds.length;
        const next = getFeaturedBattleById(sortedIds[nextIdx]);
        if (next) {
          resetBattleState();
          setActiveBattle(next);
        }
      } catch {
        /* ignore */
      }
    }, 2600);
    return () => clearTimeout(tid);
  }, [phase, countDone, battle?.id, resetBattleState]);

  const handlePick = async (side) => {
    if (phase !== 'vote') return;
    if (!user) {
      setVoteError('Sign in to cast your vote.');
      return;
    }
    setVoteSubmitting(true);
    setVoteError(null);
    const localKey = `mog-battle-vote-${user.uid}-${battle.id}`;
    if (FEATURED_MOGBATTLE_IDS.includes(battle.id)) {
      advanceFeaturedAfterRevealRef.current = true;
    }

    try {
      const token = await user.getIdToken();
      const { ok, status, data } = await postMogBattleVote(token, side, battle.id);

      if (typeof data?.a === 'number' && typeof data?.b === 'number') {
        setVoteCounts({ a: data.a, b: data.b });
      }
      if (status === 409) {
        localStorage.setItem(localKey, side);
        setUserPick(side);
        setPhase('revealing');
        startRevealSequence();
        return;
      }
      if (!ok) {
        throw new Error('vote');
      }
      if (data?.isBattleAdmin) {
        setIsBattleAdmin(true);
      }

      localStorage.setItem(localKey, side);
      setUserPick(side);
      setPhase('revealing');
      startRevealSequence();
    } catch (e) {
      localStorage.setItem(localKey, side);
      setUserPick(side);
      setPhase('revealing');
      startRevealSequence();
      setVoteCounts((prev) => ({ ...prev, [side]: (prev[side] || 0) + 1 }));
    } finally {
      setVoteSubmitting(false);
    }
  };

  const resetAdminToVoteFlow = useCallback(() => {
    clearRevealTimers();
    if (countRaf.current) {
      cancelAnimationFrame(countRaf.current);
      countRaf.current = null;
    }
    wipeCompleteRef.current = false;
    setVoteError(null);
    setPhase('vote');
    setUserPick(null);
    setGlitch(false);
    setWipe(false);
    setAfterWipe(false);
    setCountDone(false);
    setDisplayA(0);
    setDisplayB(0);
    setCommunityFill(0);
    setShowConfetti(false);
    setSplitIntro(!prefersReduced);
    setVsFast(false);
  }, [prefersReduced]);

  const addRipple = (e, id) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const key = `${Date.now()}-${id}`;
    setRipples((prev) => [...prev, { key, x, y, id }]);
    setTimeout(() => {
      setRipples((prev) => prev.filter((p) => p.key !== key));
    }, 650);
  };

  useEffect(() => {
    if (phase !== 'vote') return undefined;
    const t = setTimeout(() => setVsFast(true), 4500);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'vote') setSplitIntro(false);
  }, [phase]);

  useEffect(() => {
    if (prefersReduced) setSplitIntro(false);
  }, [prefersReduced]);

  useEffect(() => {
    if (prefersReduced || !splitIntro) return undefined;
    const t = setTimeout(() => setSplitIntro(false), 780);
    return () => clearTimeout(t);
  }, [prefersReduced, splitIntro]);

  if (!battle || !fighterA || !fighterB) {
    return (
      <div className="w-full flex-grow flex flex-col items-center justify-center pt-32 pb-24 px-4 min-h-[50vh] bg-[#0c0d0e] text-zinc-400 font-sans text-sm">
        Battle data unavailable.
      </div>
    );
  }

  const inSuspense = phase === 'revealing' && !afterWipe && !glitch && !wipe;
  const vsChargeClass =
    phase === 'vote' ? (vsFast ? 'mog-vs-charge-fast' : 'mog-vs-charge-slow') : inSuspense ? 'mog-vs-charge-suspense' : '';

  return (
    <div className="w-full flex-grow flex flex-col items-center pt-28 pb-24 px-4 sm:px-6 relative font-sans overflow-hidden bg-[#0c0d0e]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.05)_0%,transparent_70%)] pointer-events-none" />

      <style>{`
        @keyframes mog-image-flicker {
          0%, 100% {
            box-shadow: 0 0 10px rgba(255, 255, 255, 0.05);
            border-color: rgba(255, 255, 255, 0.15);
          }
          50% {
            box-shadow: 0 0 15px rgba(255, 255, 255, 0.15);
            border-color: rgba(255, 255, 255, 0.35);
          }
        }
        .mog-image-flicker {
          animation: mog-image-flicker 4s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .mog-image-flicker { animation: none; box-shadow: 0 0 16px rgba(255,255,255,0.2); border-color: rgba(255,255,255,0.4); }
          .mog-wipe-curtain { animation: none !important; opacity: 0 !important; }
          .mog-glitch-layer { animation: none !important; opacity: 0 !important; }
          .mog-border-pulse-emerald, .mog-border-pulse-red { animation: none !important; }
          .mog-vs-charge-slow, .mog-vs-charge-fast, .mog-vs-charge-suspense { animation: none !important; }
          .mog-vs-progress-ring { animation: none !important; stroke-dashoffset: 0 !important; }
          .mog-winner-ramp-wrap, .mog-winner-breathe, .mog-winner-card-glow, .mog-winner-fill-sweep, .mog-winner-stroke-rect {
            animation: none !important;
          }
          .mog-winner-ramp-wrap { opacity: 1 !important; }
          .mog-winner-fill-sweep { opacity: 0.35 !important; }
          .mog-winner-stroke-rect { stroke-dashoffset: 0 !important; }
          .mog-metric-row-anim { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
      `}</style>

      <div className="text-center mb-10 relative z-10 max-w-2xl mx-auto">
        <h1 className="text-4xl sm:text-6xl md:text-7xl font-black italic uppercase tracking-tighter bg-gradient-to-b from-cyan-400 to-blue-600 bg-clip-text text-transparent flex justify-center items-center gap-3 sm:gap-4 flex-wrap">
          <Swords className="text-cyan-500 w-10 h-10 sm:w-12 sm:h-12 shrink-0" /> Mog Battles
        </h1>
        <p className="text-zinc-400 font-sans text-xs sm:text-sm uppercase tracking-widest mt-3 block">
          Who mogs who? Cast your vote, then check the AI verdict.
        </p>
      </div>

      <div className="w-full max-w-5xl mx-auto flex flex-col items-center relative z-10">
        {voteError && (
          <p className="text-center text-amber-300/95 text-xs mb-3 max-w-md mx-auto font-sans px-2">{voteError}</p>
        )}
        {isBattleAdmin && phase !== 'vote' && user && (
          <div className="w-full flex justify-center mb-4 px-2">
            <button
              type="button"
              onClick={resetAdminToVoteFlow}
              className="text-[10px] uppercase tracking-[0.18em] text-amber-400/95 border border-amber-500/45 rounded-lg px-3 py-2 font-sans font-bold hover:bg-amber-500/10 transition-colors"
            >
              Vote again (admin)
            </button>
          </div>
        )}
        {phase === 'vote' && !user && (
          <div className="w-full max-w-md mb-6 px-3 text-center">
            <p className="text-zinc-400 text-xs font-sans leading-relaxed">
              Sign in to cast your vote — <span className="text-zinc-300">one vote per account</span>. Totals are saved on the server so
              everyone sees the same numbers worldwide.
            </p>
            {typeof setCurrentPage === 'function' && (
              <button
                type="button"
                onClick={() => setCurrentPage('login')}
                className="mt-3 text-cyan-400 text-xs font-bold uppercase tracking-[0.2em] hover:text-cyan-300 underline-offset-4 hover:underline"
              >
                Sign in
              </button>
            )}
          </div>
        )}
        {phase === 'vote' && totalVotes > 0 && (
          <div className="w-full max-w-md mb-6 px-2">
            <p className="text-[9px] uppercase tracking-widest text-zinc-600 text-center mb-2">Global votes (live)</p>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-800/90 ring-1 ring-zinc-700/50">
              <div className="h-full bg-emerald-600/90 transition-[width] duration-500 ease-out" style={{ width: `${pctA}%` }} />
              <div className="h-full bg-red-600/70 transition-[width] duration-500 ease-out" style={{ width: `${pctB}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-[9px] uppercase tracking-widest text-zinc-600">
              <span>
                {fighterA.name.split(' ')[0]} {voteCounts.a}
              </span>
              <span>
                {fighterB.name.split(' ')[0]} {voteCounts.b}
              </span>
            </div>
          </div>
        )}
        {/* Ghost preview bar (teaches community split) — visible right after vote, animates with reveal */}
        {phase !== 'vote' && (
          <div className="w-full max-w-md mb-8 px-2">
            <p className="text-[9px] uppercase tracking-widest text-zinc-600 text-center mb-2">Community split (live)</p>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-800/90 ring-1 ring-zinc-700/50">
              <div
                className="h-full bg-emerald-600/90 transition-[width] duration-[1100ms] ease-out"
                style={{ width: `${communityFill * pctA}%` }}
              />
              <div
                className="h-full bg-red-600/70 transition-[width] duration-[1100ms] ease-out"
                style={{ width: `${communityFill * pctB}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[9px] uppercase tracking-widest text-zinc-600">
              <span>
                {fighterA.name.split(' ')[0]} {pctA}%
              </span>
              <span>
                {fighterB.name.split(' ')[0]} {pctB}%
              </span>
            </div>
          </div>
        )}

        <div className="flex flex-col md:flex-row items-center justify-center gap-6 md:gap-12 w-full">
          <div
            className={`relative flex w-full max-w-[280px] flex-col items-center transition-transform duration-300 ${
              revealedUI && aWon ? 'scale-[1.02]' : ''
            }`}
          >
            <div
              className={`relative w-full aspect-[3/4] max-w-[240px] sm:max-w-[260px] overflow-visible ${
                afterWipe && aWon && winnerSide !== 'tie' && !prefersReduced ? 'mog-winner-card-glow' : ''
              }`}
            >
              <div
                className={`relative isolate z-[1] h-full w-full rounded-2xl border-4 overflow-hidden bg-zinc-900 shadow-2xl transition-colors duration-500 ${borderAClass} ${phase === 'vote' ? 'mog-image-flicker' : ''}`}
              >
              {phase === 'vote' && splitIntro && !prefersReduced && (
                <div
                  className="absolute inset-0 z-[15] flex pointer-events-none overflow-hidden rounded-2xl"
                  aria-hidden
                >
                  <div className="mog-card-split-panel-l h-full w-1/2 border-r border-cyan-500/10 bg-[#0a0a0b]" />
                  <div className="mog-card-split-panel-r h-full w-1/2 bg-[#0a0a0b]" />
                </div>
              )}
              {glitch && (
                <div className="absolute inset-0 z-30 overflow-hidden rounded-2xl pointer-events-none mog-glitch-layer mix-blend-screen" />
              )}
              {wipe && (
                <div className="pointer-events-none absolute inset-0 z-[25] overflow-hidden rounded-2xl">
                  <div
                    className="mog-wipe-curtain absolute inset-0 bg-[#0a0a0b]"
                    onAnimationEnd={onWipeCurtainAnimationEnd}
                  />
                </div>
              )}
              <div className="absolute inset-0 z-[1] overflow-hidden rounded-2xl [transform:translateZ(0)] backface-hidden">
                <img
                  src={fighterA.imgSrc}
                  className={`h-full w-full object-cover object-top rounded-2xl transition-[filter] duration-700 [transform:translateZ(0)] ${countDone && aLost && winnerSide !== 'tie' ? 'mog-loser-photo' : ''}`}
                  alt={fighterA.name}
                  referrerPolicy="no-referrer"
                />
              </div>
              {countDone && aLost && winnerSide !== 'tie' && (
                <div
                  className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-b from-slate-900/20 via-cyan-950/10 to-slate-950/30 mix-blend-multiply"
                  aria-hidden
                />
              )}
              {afterWipe && aWon && winnerSide !== 'tie' && !prefersReduced && (
                <div
                  className="mog-winner-ramp-wrap pointer-events-none absolute inset-0 z-[3] isolate overflow-hidden rounded-2xl"
                  aria-hidden
                >
                  <div className="mog-winner-fill-sweep absolute inset-0 overflow-hidden rounded-2xl" />
                  <div className="mog-winner-breathe absolute inset-0 overflow-hidden rounded-2xl" />
                </div>
              )}
              <WinSparkLayer
                show={showConfetti && aWon && winnerSide !== 'tie'}
                prefersReduced={prefersReduced}
              />
              <div className="absolute inset-x-0 bottom-0 z-[8] bg-gradient-to-t from-black via-black/50 to-transparent p-3 text-center sm:p-4">
                <span className={`font-black uppercase italic tracking-tighter text-lg sm:text-xl transition-colors ${nameClassA}`}>
                  {fighterA.name}
                </span>
              </div>
              </div>
              {afterWipe && aWon && winnerSide !== 'tie' && !prefersReduced && (
                <svg
                  className="pointer-events-none absolute inset-0 z-[7] h-full w-full overflow-visible"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <rect
                    className="mog-winner-stroke-rect"
                    x="2"
                    y="2"
                    width="96"
                    height="96"
                    rx="6.67"
                    ry="5"
                    fill="none"
                    stroke="rgb(16 185 129)"
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    pathLength="100"
                    vectorEffect="nonScalingStroke"
                  />
                </svg>
              )}
            </div>
            {phase === 'vote' && (
              <button
                type="button"
                disabled={voteSubmitting || !user}
                onClick={(e) => {
                  if (voteSubmitting || !user) return;
                  addRipple(e, 'a');
                  handlePick('a');
                }}
                className={`relative mt-4 w-full max-w-[240px] rounded-xl border border-cyan-500/45 bg-zinc-900/95 py-3 font-sans text-xs font-bold uppercase tracking-[0.22em] text-cyan-200 shadow-lg shadow-black/40 transition hover:border-cyan-400/65 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 active:scale-[0.98] sm:max-w-[260px] disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-zinc-900/95 disabled:hover:border-cyan-500/45`}
              >
                {ripples
                  .filter((r) => r.id === 'a')
                  .map((r) => (
                    <span
                      key={r.key}
                      className="pointer-events-none absolute rounded-full border-2 border-cyan-400/50 mog-ripple-ring"
                      style={{ left: r.x, top: r.y, width: 48, height: 48, marginLeft: -24, marginTop: -24, zIndex: 40 }}
                    />
                  ))}
                Vote
              </button>
            )}
            {showScoreNumbers && (
              <div className="mt-4 flex flex-col items-center gap-1">
                <span className="font-sans text-[10px] uppercase tracking-widest text-zinc-500">AI overall</span>
                <span className={`text-4xl font-black italic tabular-nums transition-colors ${scoreClassA}`}>{displayA}</span>
                <span
                  className={`hidden text-[10px] uppercase tracking-widest ${
                    winnerSide === 'tie' ? 'text-zinc-500' : aWon ? 'text-emerald-500/80' : aLost ? 'text-slate-500' : 'text-zinc-500'
                  }`}
                >
                </span>
              </div>
            )}
          </div>

          <div className="relative flex h-[5.5rem] w-[5.5rem] shrink-0 flex-col items-center justify-center py-2 sm:h-28 sm:w-28">
            {inSuspense && !prefersReduced && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full -rotate-90 text-cyan-400/55"
                viewBox="0 0 100 100"
                aria-hidden
              >
                <circle
                  className="mog-vs-progress-ring"
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  pathLength="100"
                  style={{ animationDuration: `${PRE_REVEAL_MS}ms` }}
                />
              </svg>
            )}
            <div
              className={`relative flex h-20 w-20 items-center justify-center overflow-visible rounded-full border-4 border-zinc-700 bg-zinc-900 font-black italic text-xl text-zinc-500 sm:h-24 sm:w-24 sm:text-2xl ${vsChargeClass}`}
            >
              VS
            </div>
          </div>

          <div
            className={`relative flex w-full max-w-[280px] flex-col items-center transition-transform duration-300 ${
              revealedUI && bWon ? 'scale-[1.02]' : ''
            }`}
          >
            <div
              className={`relative w-full aspect-[3/4] max-w-[240px] sm:max-w-[260px] overflow-visible ${
                afterWipe && bWon && winnerSide !== 'tie' && !prefersReduced ? 'mog-winner-card-glow' : ''
              }`}
            >
              <div
                className={`relative isolate z-[1] h-full w-full rounded-2xl border-4 overflow-hidden bg-zinc-900 shadow-2xl transition-colors duration-500 ${borderBClass} ${phase === 'vote' ? 'mog-image-flicker' : ''}`}
              >
              {phase === 'vote' && splitIntro && !prefersReduced && (
                <div
                  className="absolute inset-0 z-[15] flex pointer-events-none overflow-hidden rounded-2xl"
                  aria-hidden
                >
                  <div className="mog-card-split-panel-l h-full w-1/2 border-r border-cyan-500/10 bg-[#0a0a0b]" />
                  <div className="mog-card-split-panel-r h-full w-1/2 bg-[#0a0a0b]" />
                </div>
              )}
              {glitch && (
                <div className="absolute inset-0 z-30 overflow-hidden rounded-2xl pointer-events-none mog-glitch-layer mix-blend-screen" />
              )}
              {wipe && (
                <div className="pointer-events-none absolute inset-0 z-[25] overflow-hidden rounded-2xl">
                  <div
                    className="mog-wipe-curtain absolute inset-0 bg-[#0a0a0b]"
                    onAnimationEnd={onWipeCurtainAnimationEnd}
                  />
                </div>
              )}
              <div className="absolute inset-0 z-[1] overflow-hidden rounded-2xl [transform:translateZ(0)] backface-hidden">
                <img
                  src={fighterB.imgSrc}
                  className={`h-full w-full object-cover object-top rounded-2xl transition-[filter] duration-700 [transform:translateZ(0)] ${countDone && bLost && winnerSide !== 'tie' ? 'mog-loser-photo' : ''}`}
                  alt={fighterB.name}
                  referrerPolicy="no-referrer"
                />
              </div>
              {countDone && bLost && winnerSide !== 'tie' && (
                <div
                  className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-b from-slate-900/20 via-cyan-950/10 to-slate-950/30 mix-blend-multiply"
                  aria-hidden
                />
              )}
              {afterWipe && bWon && winnerSide !== 'tie' && !prefersReduced && (
                <div
                  className="mog-winner-ramp-wrap pointer-events-none absolute inset-0 z-[3] isolate overflow-hidden rounded-2xl"
                  aria-hidden
                >
                  <div className="mog-winner-fill-sweep absolute inset-0 overflow-hidden rounded-2xl" />
                  <div className="mog-winner-breathe absolute inset-0 overflow-hidden rounded-2xl" />
                </div>
              )}
              <WinSparkLayer
                show={showConfetti && bWon && winnerSide !== 'tie'}
                prefersReduced={prefersReduced}
              />
              <div className="absolute inset-x-0 bottom-0 z-[8] bg-gradient-to-t from-black via-black/50 to-transparent p-3 text-center sm:p-4">
                <span className={`font-black uppercase italic tracking-tighter text-lg sm:text-xl transition-colors ${nameClassB}`}>
                  {fighterB.name}
                </span>
              </div>
              </div>
              {afterWipe && bWon && winnerSide !== 'tie' && !prefersReduced && (
                <svg
                  className="pointer-events-none absolute inset-0 z-[7] h-full w-full overflow-visible"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <rect
                    className="mog-winner-stroke-rect"
                    x="2"
                    y="2"
                    width="96"
                    height="96"
                    rx="6.67"
                    ry="5"
                    fill="none"
                    stroke="rgb(16 185 129)"
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    pathLength="100"
                    vectorEffect="nonScalingStroke"
                  />
                </svg>
              )}
            </div>
            {phase === 'vote' && (
              <button
                type="button"
                disabled={voteSubmitting || !user}
                onClick={(e) => {
                  if (voteSubmitting || !user) return;
                  addRipple(e, 'b');
                  handlePick('b');
                }}
                className={`relative mt-4 w-full max-w-[240px] rounded-xl border border-cyan-500/45 bg-zinc-900/95 py-3 font-sans text-xs font-bold uppercase tracking-[0.22em] text-cyan-200 shadow-lg shadow-black/40 transition hover:border-cyan-400/65 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 active:scale-[0.98] sm:max-w-[260px] disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-zinc-900/95 disabled:hover:border-cyan-500/45`}
              >
                {ripples
                  .filter((r) => r.id === 'b')
                  .map((r) => (
                    <span
                      key={r.key}
                      className="pointer-events-none absolute rounded-full border-2 border-cyan-400/50 mog-ripple-ring"
                      style={{ left: r.x, top: r.y, width: 48, height: 48, marginLeft: -24, marginTop: -24, zIndex: 40 }}
                    />
                  ))}
                Vote
              </button>
            )}
            {showScoreNumbers && (
              <div className="mt-4 flex flex-col items-center gap-1">
                <span className="font-sans text-[10px] uppercase tracking-widest text-zinc-500">AI overall</span>
                <span className={`text-4xl font-black italic tabular-nums transition-colors ${scoreClassB}`}>{displayB}</span>
                <span
                  className={`hidden text-[10px] uppercase tracking-widest ${
                    winnerSide === 'tie' ? 'text-zinc-500' : bWon ? 'text-emerald-500/80' : bLost ? 'text-slate-500' : 'text-zinc-500'
                  }`}
                >
                </span>
              </div>
            )}
          </div>
        </div>

        {phase === 'revealed' && (
          <div className="w-full max-w-2xl mt-10 space-y-6 opacity-100 transition-opacity duration-500">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 backdrop-blur-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Your vote</p>
                  <p className="text-white font-bold text-sm">
                    You picked{' '}
                    <span className="text-cyan-400 italic">
                      {userPick === 'a' ? fighterA.name : fighterB.name}
                    </span>
                  </p>
                  {winnerSide && winnerSide !== 'tie' && (
                    <p className="text-zinc-400 text-xs mt-2">
                      {userCorrect ? (
                        <span className="text-emerald-400 font-semibold">Same side as the AI overall score.</span>
                      ) : (
                        <span>
                          AI overall favored{' '}
                          <span className="font-semibold text-emerald-400">
                            {winnerSide === 'a' ? fighterA.name : fighterB.name}
                          </span>
                          .
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 text-zinc-500 text-xs">
                  <Users size={16} />
                  <span className="uppercase tracking-widest">Community</span>
                </div>
              </div>
              <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full bg-emerald-600/90 transition-[width] duration-1000 ease-out" style={{ width: `${pctA}%` }} />
                <div className="h-full bg-red-600/70 transition-[width] duration-1000 ease-out" style={{ width: `${pctB}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-[10px] uppercase tracking-widest text-zinc-500">
                <span>
                  {fighterA.name.split(' ')[0]} {pctA}% ({voteCounts.a})
                </span>
                <span>
                  {fighterB.name.split(' ')[0]} {pctB}% ({voteCounts.b})
                </span>
              </div>
            </div>

            <button 
              onClick={handleNextBattle}
              className="mt-8 mb-4 w-full md:w-auto px-12 py-4 rounded-full bg-gradient-to-r from-cyan-600 to-cyan-500 text-white font-black uppercase tracking-[0.2em] shadow-[0_0_20px_rgba(34,211,238,0.3)] hover:shadow-[0_0_30px_rgba(34,211,238,0.5)] hover:scale-105 transition-all mx-auto block"
            >
              Next Battle
            </button>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 backdrop-blur-md overflow-hidden">
              <button
                type="button"
                onClick={() => setShowMetrics((v) => !v)}
                className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-zinc-900/50 transition-colors"
              >
                <span className="text-zinc-300 font-sans text-xs uppercase tracking-widest">
                  AI breakdown
                </span>
                <ChevronDown
                  size={20}
                  className={`text-zinc-500 shrink-0 transition-transform duration-300 ${showMetrics ? 'rotate-180' : ''}`}
                />
              </button>
              {showMetrics && (
                <div className="px-5 pb-6 pt-0 border-t border-zinc-800/80">
                  <div className="flex flex-col gap-5 pt-5">
                    {metricRows.map((row, idx) => (
                      <div
                        key={row.key}
                        className="mog-metric-row-anim flex items-center gap-3 w-full"
                        style={{
                          animationDelay: `${80 + idx * 90}ms`,
                        }}
                      >
                        <div className="flex-1 flex flex-col items-end min-w-0">
                          <div className="h-2 w-full bg-zinc-800 rounded-full flex justify-end overflow-hidden max-w-[140px] sm:max-w-none">
                            <div
                              className={`h-full rounded-full ${barClass(row.scoreA, row.scoreB, 'a')}`}
                              style={{ width: `${Math.min(100, row.scoreA)}%` }}
                            />
                          </div>
                          <span
                            className={`text-[9px] mt-1 tabular-nums ${
                              row.scoreA > row.scoreB
                                ? 'text-emerald-400'
                                : row.scoreA < row.scoreB
                                  ? 'text-red-400'
                                  : 'text-zinc-400'
                            }`}
                          >
                            {row.scoreA}
                          </span>
                        </div>
                        <div className="w-[100px] sm:w-36 text-center shrink-0 px-1">
                          <span className="text-white font-bold text-[9px] sm:text-[10px] uppercase tracking-tighter leading-tight line-clamp-2">
                            {row.label}
                          </span>
                        </div>
                        <div className="flex-1 flex flex-col items-start min-w-0">
                          <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden max-w-[140px] sm:max-w-none">
                            <div
                              className={`h-full rounded-full ${barClass(row.scoreA, row.scoreB, 'b')}`}
                              style={{ width: `${Math.min(100, row.scoreB)}%` }}
                            />
                          </div>
                          <span
                            className={`text-[9px] mt-1 tabular-nums ${
                              row.scoreB > row.scoreA
                                ? 'text-emerald-400'
                                : row.scoreB < row.scoreA
                                  ? 'text-red-400'
                                  : 'text-zinc-400'
                            }`}
                          >
                            {row.scoreB}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="w-full max-w-5xl mx-auto mt-24 mb-16 relative z-10 px-4 md:px-0">
        <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
          <div>
            <h2 className="text-3xl font-black italic uppercase tracking-tighter text-white">Community Battles</h2>
            <p className="text-zinc-400 text-xs uppercase tracking-widest mt-1">Vote on user-submitted matchups</p>
          </div>
          <div className="flex items-center gap-4">
            <select
              value={battleSort}
              onChange={(e) => setBattleSort(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs font-bold uppercase tracking-widest px-4 py-2 rounded-xl outline-none"
            >
              <option value="votes">Most Voted</option>
              <option value="recent">Most Recent</option>
            </select>
            <button
              onClick={() => {
                if (!user) return alert('Sign in to submit a battle');
                // if (!user.scanHistory or something)... we handle modal later
                setShowSubmitModal(true);
              }}
              className="w-10 h-10 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 flex items-center justify-center hover:bg-cyan-500/40 transition-colors shadow-[0_0_15px_rgba(34,211,238,0.2)]"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sortedCommunityBattles.map(b => (
            <button
              key={b.id}
              onClick={() => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
                changeBattle(b);
              }}
              className="group bg-[#0c0d0e] border border-zinc-800 rounded-2xl overflow-hidden hover:border-cyan-500/50 transition-colors shadow-lg hover:shadow-[0_0_20px_rgba(34,211,238,0.1)] text-left"
            >
              <div className="flex h-32">
                <div className="w-1/2 h-full relative">
                  <img src={b.fighterA.imgSrc} alt={b.fighterA.name} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                  <span className="absolute bottom-2 left-2 text-[10px] font-black uppercase text-white truncate w-11/12">{b.fighterA.name}</span>
                </div>
                <div className="w-1/2 h-full relative">
                  <img src={b.fighterB.imgSrc} alt={b.fighterB.name} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                  <span className="absolute bottom-2 right-2 text-[10px] font-black uppercase text-white truncate text-right w-11/12">{b.fighterB.name}</span>
                </div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black border border-zinc-800 flex items-center justify-center z-10 font-black italic text-zinc-500 text-xs uppercase group-hover:text-cyan-400 group-hover:border-cyan-500/50 transition-colors">
                  VS
                </div>
              </div>
              <div className="p-3 bg-zinc-900/50 flex justify-between items-center text-[10px] uppercase font-bold text-zinc-500">
                <span>{(b.votesA || 0) + (b.votesB || 0)} Votes</span>
                <span className="text-cyan-600 group-hover:text-cyan-400">Vote Now</span>
              </div>
            </button>
          ))}
        </div>
      </div>
      
      {showSubmitModal && (
        <SubmitBattleModal
          show={showSubmitModal}
          onClose={() => setShowSubmitModal(false)}
          user={user}
          userPlan={userPlan}
          dashboardData={dashboardData}
          onSuccess={(newBattle) => {
            setShowSubmitModal(false);
            setCommunityBattles((prev) => [newBattle, ...prev]);
            loadCommunityBattles();
          }}
        />
      )}
    </div>
  );
};

const SubmitBattleModal = ({ show, onClose, user, userPlan, dashboardData, onSuccess }) => {
  const [fighterA, setFighterA] = useState(null);
  const [fighterB, setFighterB] = useState(null);
  const [includeSideA, setIncludeSideA] = useState(false);
  const [includeSideB, setIncludeSideB] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!show) return null;

  const scans = dashboardData?.scanHistory || [];
  const isPro = userPlan?.plan === 'pro';

  const handleSubmit = async () => {
    if (!fighterA || !fighterB) return alert('Select both fighters');
    if (fighterA === fighterB) return alert('Select two different scans');

    setSubmitting(true);
    try {
      const token = await user.getIdToken();
      const { postCommunityBattle } = await import('../api/mogBattleVotes');

      const idxA = scans.indexOf(fighterA) + 1;
      const idxB = scans.indexOf(fighterB) + 1;
      const payloadA = {
        ...fighterA,
        name: `Scan ${idxA}`,
        frontImage: fighterA.frontImage,
        finalRating: fighterA.finalRating,
        ...(isPro && includeSideA && fighterA.sideImage ? { sideImage: fighterA.sideImage } : {}),
      };
      const payloadB = {
        ...fighterB,
        name: `Scan ${idxB}`,
        frontImage: fighterB.frontImage,
        finalRating: fighterB.finalRating,
        ...(isPro && includeSideB && fighterB.sideImage ? { sideImage: fighterB.sideImage } : {}),
      };

      const { ok, data } = await postCommunityBattle(token, payloadA, payloadB);
      if (!ok) throw new Error('Submission failed');
      
      const { makeStats, tierFromRating100 } = await import('../data/celebrityData');
      const b = data.battle;
      const formatted = {
        ...b,
        fighterA: { ...b.fighterA, imgSrc: b.fighterA.frontImage, tier: tierFromRating100(b.fighterA.finalRating), stats: makeStats(b.fighterA.finalRating, 5) },
        fighterB: { ...b.fighterB, imgSrc: b.fighterB.frontImage, tier: tierFromRating100(b.fighterB.finalRating), stats: makeStats(b.fighterB.finalRating, 5) }
      };
      
      onSuccess(formatted);
    } catch(e) {
      console.error(e);
      alert('Failed to submit battle');
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#0c0d0e] border border-zinc-800 rounded-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
          <h2 className="text-xl font-black italic uppercase text-white">Create Community Battle</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">
          {scans.length < 2 ? (
            <p className="text-zinc-400 text-center py-10 text-sm uppercase tracking-widest">You need at least 2 scans in your history to create a battle.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-cyan-400 font-black uppercase text-sm mb-4">Select Fighter A</h3>
                <div className="grid grid-cols-2 gap-3">
                  {scans.map((s, i) => (
                    <div key={`a-${i}`} onClick={() => setFighterA(s)} className={`cursor-pointer rounded-xl overflow-hidden border-2 ${fighterA === s ? 'border-cyan-500' : 'border-zinc-800'} relative aspect-square`}>
                      <img src={s.frontImage} className="w-full h-full object-cover" alt="" />
                      <div className="absolute bottom-0 left-0 w-full bg-black/60 text-center text-[10px] font-bold text-white py-1">SCAN {i+1}</div>
                    </div>
                  ))}
                </div>
                {isPro && fighterA?.sideImage && (
                  <label className="mt-3 flex items-center gap-2 text-[11px] text-zinc-400 font-sans cursor-pointer">
                    <input type="checkbox" checked={includeSideA} onChange={(e) => setIncludeSideA(e.target.checked)} className="rounded border-zinc-600" />
                    Include side profile (Pro)
                  </label>
                )}
              </div>
              <div>
                <h3 className="text-red-400 font-black uppercase text-sm mb-4">Select Fighter B</h3>
                <div className="grid grid-cols-2 gap-3">
                  {scans.map((s, i) => (
                    <div key={`b-${i}`} onClick={() => setFighterB(s)} className={`cursor-pointer rounded-xl overflow-hidden border-2 ${fighterB === s ? 'border-red-500' : 'border-zinc-800'} relative aspect-square`}>
                      <img src={s.frontImage} className="w-full h-full object-cover" alt="" />
                      <div className="absolute bottom-0 left-0 w-full bg-black/60 text-center text-[10px] font-bold text-white py-1">SCAN {i+1}</div>
                    </div>
                  ))}
                </div>
                {isPro && fighterB?.sideImage && (
                  <label className="mt-3 flex items-center gap-2 text-[11px] text-zinc-400 font-sans cursor-pointer">
                    <input type="checkbox" checked={includeSideB} onChange={(e) => setIncludeSideB(e.target.checked)} className="rounded border-zinc-600" />
                    Include side profile (Pro)
                  </label>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="p-6 border-t border-zinc-800 flex justify-end">
          <button disabled={submitting || scans.length < 2} onClick={handleSubmit} className="px-8 py-3 rounded-full bg-cyan-500 text-black font-black uppercase tracking-widest text-xs hover:bg-cyan-400 disabled:opacity-50 transition-colors">
            {submitting ? 'Submitting...' : 'Submit Battle'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MogBattlePage;

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Users, ChevronDown } from 'lucide-react';
import {
  getMetricRowsForBattle,
  aiWinner,
  FEATURED_MOGBATTLE_IDS,
} from '../data/mogBattles';
import {
  fetchMogBattleTallies,
  fetchMyMogBattleVote,
  postMogBattleVote,
} from '../api/mogBattleVotes';

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

const BattleCard = ({ battle, user, isActive }) => {
  const prefersReduced = usePrefersReducedMotion();

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
    !countDone ? 'text-white' : winnerSide === 'tie' ? 'text-white' : aWon ? 'text-emerald-400' : aLost ? 'text-red-400' : 'text-white';

  const nameClassB =
    !countDone ? 'text-white' : winnerSide === 'tie' ? 'text-white' : bWon ? 'text-emerald-400' : bLost ? 'text-red-400' : 'text-white';

  const scoreClassA =
    !showScoreNumbers ? '' : !countDone ? 'text-zinc-300' : winnerSide === 'tie' ? 'text-cyan-400' : aWon ? 'text-emerald-400' : aLost ? 'text-red-400' : 'text-cyan-400';

  const scoreClassB =
    !showScoreNumbers ? '' : !countDone ? 'text-zinc-300' : winnerSide === 'tie' ? 'text-cyan-400' : bWon ? 'text-emerald-400' : bLost ? 'text-red-400' : 'text-cyan-400';

  const metricBarClassA =
    !revealedUI || winnerSide === 'tie'
      ? 'bg-cyan-400'
      : aWon
        ? 'bg-emerald-400'
        : 'bg-red-400';

  const metricBarClassB =
    !revealedUI || winnerSide === 'tie'
      ? 'bg-cyan-400'
      : bWon
        ? 'bg-emerald-400'
        : 'bg-red-400';

  const metricTextClassA =
    !revealedUI || winnerSide === 'tie'
      ? 'text-cyan-400'
      : aWon
        ? 'text-emerald-400'
        : 'text-red-400';

  const metricTextClassB =
    !revealedUI || winnerSide === 'tie'
      ? 'text-cyan-400'
      : bWon
        ? 'text-emerald-400'
        : 'text-red-400';

  const borderAClass =
    revealedUI && winnerSide !== 'tie'
      ? aWon
        ? prefersReduced
          ? 'border-emerald-500 shadow-[0_0_24px_rgba(16,185,129,0.25)]'
          : 'border-transparent'
        : 'border-red-500/60 shadow-[0_0_20px_rgba(239,68,68,0.28)]'
      : 'border-zinc-800';

  const borderBClass =
    revealedUI && winnerSide !== 'tie'
      ? bWon
        ? prefersReduced
          ? 'border-emerald-500 shadow-[0_0_24px_rgba(16,185,129,0.25)]'
          : 'border-transparent'
        : 'border-red-500/60 shadow-[0_0_20px_rgba(239,68,68,0.28)]'
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

  useEffect(() => {
    if (!battle?.id || !isActive) return undefined;
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
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [battle?.id, isActive]);

  useEffect(() => {
    if (!user || !battle || myVoteHydratedRef.current || !isActive) return undefined;
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
  }, [user?.uid, battle?.id, isActive]);

  const handlePick = async (side) => {
    if (phase !== 'vote') return;
    if (!user) {
      setVoteError('Sign in to cast your vote.');
      return;
    }
    setVoteSubmitting(true);
    setVoteError(null);
    const localKey = `mog-battle-vote-${user.uid}-${battle.id}`;

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
    if (phase !== 'vote' || !isActive) return undefined;
    const t = setTimeout(() => setVsFast(true), 4500);
    return () => clearTimeout(t);
  }, [phase, isActive]);

  useEffect(() => {
    if (phase !== 'vote') setSplitIntro(false);
  }, [phase]);

  useEffect(() => {
    if (prefersReduced) setSplitIntro(false);
  }, [prefersReduced]);

  useEffect(() => {
    if (prefersReduced || !splitIntro || !isActive) return undefined;
    const t = setTimeout(() => setSplitIntro(false), 780);
    return () => clearTimeout(t);
  }, [prefersReduced, splitIntro, isActive]);

  if (!battle || !fighterA || !fighterB) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0c0d0e] text-zinc-400 font-sans text-sm">
        Battle data unavailable.
      </div>
    );
  }

  const inSuspense = phase === 'revealing' && !afterWipe && !glitch && !wipe;
  const vsChargeClass =
    phase === 'vote' ? (vsFast && isActive ? 'mog-vs-charge-fast' : 'mog-vs-charge-slow') : inSuspense ? 'mog-vs-charge-suspense' : '';

  return (
    <div className="w-full h-full flex flex-col items-center justify-center py-10 px-4 sm:px-6 relative font-sans overflow-hidden">
      <div className="w-full max-w-5xl mx-auto flex flex-col items-center relative z-10 flex-shrink-0">
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
              </div>
            )}
          </div>
        </div>

        {phase === 'revealed' && (
          <div className="w-full max-w-2xl mt-10 space-y-4 opacity-100 transition-opacity duration-500">
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
                              className={`h-full rounded-full ${metricBarClassA}`}
                              style={{ width: `${Math.min(100, row.scoreA)}%` }}
                            />
                          </div>
                          <span className={`text-[9px] mt-1 tabular-nums ${metricTextClassA}`}>
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
                              className={`h-full rounded-full ${metricBarClassB}`}
                              style={{ width: `${Math.min(100, row.scoreB)}%` }}
                            />
                          </div>
                          <span className={`text-[9px] mt-1 tabular-nums ${metricTextClassB}`}>
                            {row.scoreB}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <div className="flex justify-center pt-6 pb-2">
              <div className="flex flex-col items-center opacity-50 animate-pulse">
                <ChevronDown className="w-8 h-8 text-cyan-500" />
                <span className="text-[9px] uppercase tracking-widest text-zinc-500 font-bold mt-1">Scroll</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BattleCard;

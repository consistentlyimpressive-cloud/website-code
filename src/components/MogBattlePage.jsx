import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Swords } from 'lucide-react';
import {
  getAllFeaturedBattles,
} from '../data/mogBattles';
import {
  fetchCommunityBattles,
} from '../api/mogBattleVotes';
import BattleCard from './BattleCard';

const MogBattlePage = ({ user, setCurrentPage, dashboardData, userPlan }) => {
  const [communityBattles, setCommunityBattles] = useState([]);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [activeBattleId, setActiveBattleId] = useState(null);

  const containerRef = useRef(null);
  const observerRef = useRef(null);

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
    const id = setInterval(loadCommunityBattles, 90_000);
    return () => clearInterval(id);
  }, [loadCommunityBattles]);

  const feedItems = useMemo(() => {
    const featured = getAllFeaturedBattles();
    const combined = [];
    
    // Interleave featured and community battles
    let i = 0, j = 0;
    while (i < featured.length || j < communityBattles.length) {
      if (i < featured.length) combined.push(featured[i++]);
      if (j < communityBattles.length) combined.push(communityBattles[j++]);
    }
    
    return combined;
  }, [communityBattles]);

  useEffect(() => {
    if (feedItems.length > 0 && !activeBattleId) {
      setActiveBattleId(feedItems[0].id);
    }
  }, [feedItems, activeBattleId]);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveBattleId(entry.target.getAttribute('data-id'));
          }
        });
      },
      { threshold: 0.6 }
    );

    const nodes = document.querySelectorAll('.mog-battle-snap-item');
    nodes.forEach((node) => observerRef.current.observe(node));

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [feedItems]);

  return (
    <div className="w-full flex-grow flex flex-col relative font-sans overflow-hidden bg-[#0c0d0e]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.05)_0%,transparent_70%)] pointer-events-none z-0" />
      
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

      {/* Snap-Y Scroll Container */}
      <div 
        ref={containerRef}
        className="w-full h-[100dvh] overflow-y-auto snap-y snap-mandatory relative z-10"
      >
        {/* Header - Fixed but inside the scroll context visually */}
        <div className="fixed top-24 left-0 w-full text-center z-50 pointer-events-none">
          <h1 className="text-4xl sm:text-6xl md:text-7xl font-black italic uppercase tracking-tighter bg-gradient-to-b from-cyan-400 to-blue-600 bg-clip-text text-transparent flex justify-center items-center gap-3 sm:gap-4 flex-wrap drop-shadow-lg">
            <Swords className="text-cyan-500 w-10 h-10 sm:w-12 sm:h-12 shrink-0 drop-shadow-md" /> Mog Battles
          </h1>
          <p className="text-zinc-300 font-sans text-xs sm:text-sm uppercase tracking-widest mt-3 block drop-shadow-md bg-black/40 inline-block px-4 py-1 rounded-full backdrop-blur-sm">
            Who mogs who? Cast your vote, then check the AI verdict.
          </p>
        </div>

        {feedItems.length === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-zinc-400 font-sans text-sm">
            Loading battles...
          </div>
        ) : (
          feedItems.map((battle) => (
            <div 
              key={battle.id} 
              data-id={battle.id}
              className="mog-battle-snap-item snap-start h-[100dvh] w-full shrink-0 flex items-center justify-center"
            >
              <BattleCard 
                battle={battle} 
                user={user} 
                isActive={activeBattleId === battle.id} 
              />
            </div>
          ))
        )}
      </div>

      {/* Floating Action Button */}
      <button
        onClick={() => {
          if (!user) return alert('Sign in to submit a battle');
          setShowSubmitModal(true);
        }}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-cyan-500 text-black flex items-center justify-center hover:bg-cyan-400 hover:scale-105 transition-all shadow-[0_0_20px_rgba(34,211,238,0.4)] group"
        aria-label="Create Community Battle"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="group-hover:rotate-90 transition-transform duration-300"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      </button>

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
            // Scroll to newly added item logic could go here
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

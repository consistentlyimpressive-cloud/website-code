import React from 'react';
import { Newspaper, Swords, Users, ChevronRight } from 'lucide-react';
import { COMMUNITY_SCANS } from '../data/communityScans';

/**
 * Compact “explore” strip for the free-tier results dashboard.
 */
export function DashboardHubPreviewsCompact({ setCurrentPage, hideCommunity = false, onOpenCommunityScan = null }) {
  const previewScans = COMMUNITY_SCANS.slice(0, 3);
  return (
    <div className="mt-12 pt-10 border-t border-zinc-800/80">
      <h3 className="text-sm font-black uppercase tracking-widest text-zinc-500 mb-6">Explore MogCheck</h3>
      <div className={hideCommunity ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'grid grid-cols-1 md:grid-cols-3 gap-4'}>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase tracking-widest">
            <Swords size={14} /> Mog Battles
          </div>
          <p className="text-zinc-500 text-[11px] font-sans leading-relaxed">Vote on matchups and climb the leaderboard.</p>
          <button
            type="button"
            onClick={() => setCurrentPage('mog-battles')}
            className="mt-auto flex items-center justify-center gap-2 py-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-[10px] font-bold uppercase tracking-widest hover:bg-cyan-500/20 transition-colors"
          >
            Go to Mog Battles <ChevronRight size={14} />
          </button>
        </div>
        {!hideCommunity && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-emerald-400/90 text-xs font-bold uppercase tracking-widest">
              <Users size={14} /> Community Scans
            </div>
            <div className="flex gap-1">
              {previewScans.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => (onOpenCommunityScan ? onOpenCommunityScan(s) : setCurrentPage('celebrity'))}
                  className="group relative flex-1 aspect-[3/4] rounded-lg overflow-hidden border border-zinc-700/50 text-left hover:border-emerald-400/40 transition-colors"
                >
                  <img src={s.dashboardData?.frontImage} alt="" className="w-full h-full object-cover object-top" />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setCurrentPage('celebrity')}
              className="mt-auto flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-500/15 transition-colors"
            >
              Go to Community Scans <ChevronRight size={14} />
            </button>
          </div>
        )}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-violet-400 text-xs font-bold uppercase tracking-widest">
            <Newspaper size={14} /> News &amp; Media
          </div>
          <p className="text-zinc-500 text-[11px] font-sans leading-relaxed">Updates, guides, and featured looksmax content.</p>
          <button
            type="button"
            onClick={() => setCurrentPage('news')}
            className="mt-auto flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-500/10 border border-violet-500/25 text-violet-300 text-[10px] font-bold uppercase tracking-widest hover:bg-violet-500/20 transition-colors"
          >
            Go to News &amp; Media <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

import React from 'react';
import { ArrowLeft, Clock, Monitor, User, Battery, Calendar, ChevronRight } from 'lucide-react';

const SettingsPage = ({ setCurrentPage, user, userPlan, lowPerfMode, setLowPerfMode, dashboardData }) => {
  const planName = userPlan?.plan === 'pro' ? 'Pro' : userPlan?.plan === 'single_scan' ? 'Single Scan' : 'Free';
  const credits = userPlan?.scanCredits || 0;
  let timeStr = 'N/A';
  if (userPlan?.updatedAt) {
    const d = new Date(userPlan.updatedAt.seconds ? userPlan.updatedAt.seconds * 1000 : userPlan.updatedAt);
    timeStr = d.toLocaleDateString();
  }

  return (
    <div className="min-h-screen bg-[#0c0d0e] pt-24 pb-12 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => setCurrentPage('dashboard')}
          className="flex items-center gap-2 text-zinc-400 hover:text-white mb-8 transition-colors text-sm uppercase tracking-widest font-sans"
        >
          <ArrowLeft size={16} /> Back to Dashboard
        </button>

        <h1 className="text-3xl md:text-4xl font-black italic uppercase tracking-tighter text-white mb-4">
          Account Settings
        </h1>
        <p className="text-zinc-500 text-sm font-sans mb-8">Profile, scans, subscription, and performance in one place.</p>

        <button
          type="button"
          onClick={() => setCurrentPage('profile')}
          className="w-full mb-8 flex items-center justify-between gap-4 rounded-2xl border border-cyan-500/25 bg-cyan-500/5 hover:bg-cyan-500/10 hover:border-cyan-500/40 transition-all px-5 py-4 text-left group"
        >
          <span className="flex items-center gap-3 min-w-0">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/15 border border-cyan-500/20 text-cyan-400">
              <User size={20} />
            </span>
            <span>
              <span className="block text-white font-bold uppercase tracking-widest text-sm">Profile &amp; scans</span>
              <span className="block text-zinc-500 text-xs font-sans mt-0.5 truncate">{user?.email || 'Sign in to manage scans'}</span>
            </span>
          </span>
          <ChevronRight size={18} className="text-zinc-500 group-hover:text-cyan-400 shrink-0 transition-colors" />
        </button>

        <div className="space-y-6">
          {/* Subscription & History */}
          <section className="bg-zinc-900/30 border border-zinc-800/80 rounded-2xl p-6">
            <h2 className="flex items-center gap-2 text-xl font-bold uppercase tracking-widest text-cyan-400 mb-4">
              <Battery size={20} /> Subscription
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-black/40 border border-zinc-800/50 rounded-xl p-4">
                <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Current Plan</p>
                <p className="text-xl font-black italic text-white uppercase">{planName}</p>
                {planName === 'Single Scan' && <p className="text-xs text-zinc-400 mt-1">Credits: {credits}</p>}
              </div>
              <div className="bg-black/40 border border-zinc-800/50 rounded-xl p-4">
                <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Last Updated</p>
                <p className="text-lg font-bold text-zinc-300 flex items-center gap-2">
                  <Calendar size={16} className="text-cyan-500" /> {timeStr}
                </p>
              </div>
            </div>
            
            <div className="mt-6 pt-6 border-t border-zinc-800/50">
              <h3 className="text-xs uppercase tracking-widest text-zinc-400 font-bold mb-3 flex items-center gap-2">
                <Clock size={14} /> Scan History Quick Stats
              </h3>
              <p className="text-zinc-500 text-sm">
                Total Scans: <span className="text-white font-bold">{dashboardData?.scanHistory?.length || 0}</span>
              </p>
            </div>
          </section>

          {/* Performance */}
          <section className="bg-zinc-900/30 border border-zinc-800/80 rounded-2xl p-6">
            <h2 className="flex items-center gap-2 text-xl font-bold uppercase tracking-widest text-cyan-400 mb-4">
              <Monitor size={20} /> Performance
            </h2>
            <label className="flex items-center justify-between cursor-pointer group">
              <div>
                <p className="text-white font-bold text-sm uppercase tracking-wide group-hover:text-cyan-400 transition-colors">Low Performance Mode</p>
                <p className="text-zinc-500 text-xs mt-1 max-w-sm">Disables animations and optimizes performance for older devices or slow connections.</p>
              </div>
              <div className="relative">
                <input type="checkbox" checked={lowPerfMode} onChange={e => setLowPerfMode(e.target.checked)} className="sr-only" />
                <div className={`block w-10 h-6 rounded-full transition-colors ${lowPerfMode ? 'bg-cyan-500' : 'bg-zinc-700'}`}></div>
                <div className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${lowPerfMode ? 'translate-x-4' : ''}`}></div>
              </div>
            </label>
          </section>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;

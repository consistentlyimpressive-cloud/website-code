import React, { useState, useEffect, useCallback } from 'react';
import { Target, Newspaper, Swords, Users, Crown, ChevronRight, Plus, Trash2, Edit2 } from 'lucide-react';
import { hasEffectiveProAccess } from '../utils/planAccess';
import { getApiBase } from '../utils/apiBase';
import { COMMUNITY_SCANS } from '../data/communityScans';
import { DashboardHubPreviewsCompact } from './DashboardHubPreviews';
import { getAllFeaturedBattles } from '../data/mogBattles';
import { fetchCommunityBattles } from '../api/mogBattleVotes';

const API_BASE = getApiBase();

const ProDashboardPage = ({ dashboardData, setCurrentPage, userPlan, user, onSignOut, setPendingUploadModel }) => {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('profiles');
  const [mogPreviewBattles, setMogPreviewBattles] = useState([]);

  const loadMogPreviews = useCallback(async () => {
    try {
      const featured = getAllFeaturedBattles().filter((b) => b && b.fighterA && b.fighterB).slice(0, 2);
      let community = [];
      try {
        const res = await fetchCommunityBattles();
        const list = (res.battles || []).filter((b) => b && b.fighterA && b.fighterB).slice(0, 2);
        community = list;
      } catch {
        /* ignore */
      }
      const merged = [];
      let i = 0;
      let j = 0;
      while (merged.length < 3 && (i < featured.length || j < community.length)) {
        if (i < featured.length) merged.push(featured[i++]);
        if (merged.length >= 3) break;
        if (j < community.length) merged.push(community[j++]);
      }
      setMogPreviewBattles(merged);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadMogPreviews();
  }, [loadMogPreviews]);

  useEffect(() => {
    const fetchProfiles = async () => {
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const res = await fetch(`${API_BASE}/api/user/profiles`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setProfiles(data.profiles || []);
        }
      } catch (e) {
        console.error('Failed to fetch profiles', e);
      } finally {
        setLoading(false);
      }
    };
    fetchProfiles();
  }, [user]);

  const handleCreateProfileAndScan = (model) => {
    if (setPendingUploadModel) setPendingUploadModel(model);
    if (model === '1' || model === '2') {
      setCurrentPage('upload-ultra');
    } else {
      setCurrentPage('upload-photo');
    }
  };

  const handleRenameProfile = async (e, id, currentName) => {
    e.stopPropagation();
    const name = prompt('Enter new profile name:', currentName);
    if (!name) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/profiles/${id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setProfiles(profiles.map((p) => (p.id === id ? { ...p, name } : p)));
      } else {
        const errBody = await res.json().catch(() => ({}));
        alert(errBody.error || `Could not rename profile (${res.status})`);
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteProfile = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this profile and ALL its scans?')) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/profiles/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setProfiles(profiles.filter((p) => p.id !== id));
      } else {
        const errBody = await res.json().catch(() => ({}));
        alert(errBody.error || `Could not delete profile (${res.status})`);
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const username = user?.email?.split('@')[0] || 'User';
  const isFreeModelScan = !hasEffectiveProAccess(user, userPlan);

  const navTabs = [
    { id: 'profiles', label: 'Profiles', icon: <Target size={16} /> },
    { id: 'news', label: 'News & Updates', icon: <Newspaper size={16} /> },
    { id: 'mog-battles', label: 'Mog Battles', icon: <Swords size={16} /> },
    { id: 'community', label: 'Community Scans', icon: <Users size={16} /> },
  ];

  const communityPreview = COMMUNITY_SCANS.slice(0, 4);

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#0a0a0b]">
      <aside className="w-64 border-r border-zinc-900 hidden md:flex flex-col bg-[#0a0a0b] h-[calc(100vh-5rem)] sticky top-20 shrink-0 z-40">
        <div className="p-6 border-b border-zinc-900">
          <p className="text-zinc-500 font-sans text-[10px] uppercase tracking-widest">Dashboard</p>
        </div>

        <div className="p-6">
          <p className="text-zinc-500 font-sans text-[10px] uppercase tracking-widest mb-4">Navigate</p>
          <nav className="flex flex-col gap-2">
            {navTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSection(tab.id)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl font-sans text-xs uppercase tracking-widest transition-all ${
                  activeSection === tab.id
                    ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50 border border-transparent'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-auto p-6 border-t border-zinc-900 flex flex-col gap-4">
          <button
            type="button"
            onClick={() => setCurrentPage('plans')}
            className="flex items-center justify-between px-4 py-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 transition-all font-sans text-xs uppercase tracking-widest group"
          >
            <span className="flex items-center gap-2">
              <Crown size={14} /> Upgrade
            </span>
            <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
          </button>

          <div className="flex items-center justify-between">
            <div className="flex flex-col min-w-0">
              <span className="text-white font-bold text-sm uppercase truncate">{username}</span>
              <span className="text-zinc-500 text-[10px] font-sans uppercase tracking-widest">
                {isFreeModelScan ? 'Free member' : 'Pro Member'}
              </span>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 p-6 md:p-10 max-w-[1200px] w-full mx-auto">
        <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter italic text-white mb-2">
          Welcome Back, {username}
        </h1>
        <p className="text-zinc-400 font-sans text-sm uppercase tracking-widest mb-12">
          {activeSection === 'profiles'
            ? 'Select a profile to view analysis and trajectory.'
            : 'Preview — use the buttons below to open the full page.'}
        </p>

        {activeSection === 'profiles' && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-zinc-900 pb-4">
              <h2 className="text-xl font-bold uppercase tracking-widest text-cyan-400">Your Profiles</h2>
            </div>

            {loading ? (
              <p className="text-zinc-500">Loading profiles...</p>
            ) : profiles.length === 0 ? (
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-8 text-center">
                <p className="text-zinc-400 mb-4">You don&apos;t have any profiles yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {profiles.map((p) => (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      const url = `/profile/${p.id}`;
                      window.history.pushState({}, '', url);
                      window.dispatchEvent(new Event('popstate'));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        const url = `/profile/${p.id}`;
                        window.history.pushState({}, '', url);
                        window.dispatchEvent(new Event('popstate'));
                      }
                    }}
                    className="bg-zinc-900/40 border border-zinc-800 hover:border-cyan-500/50 rounded-2xl p-6 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-[0_0_20px_rgba(34,211,238,0.1)] group flex flex-col"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <h3 className="text-xl font-black italic text-white group-hover:text-cyan-400 transition-colors">{p.name}</h3>
                      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button type="button" onClick={(e) => handleRenameProfile(e, p.id, p.name)} className="p-1 text-zinc-400 hover:text-white">
                          <Edit2 size={16} />
                        </button>
                        <button type="button" onClick={(e) => handleDeleteProfile(e, p.id)} className="p-1 text-red-400 hover:text-red-300">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-auto">
                      <p className="text-xs text-zinc-500 uppercase tracking-widest">Visibility: {p.visibility}</p>
                      <p className="text-xs text-zinc-500 uppercase tracking-widest mt-1">
                        Created: {p.createdAt?.seconds ? new Date(p.createdAt.seconds * 1000).toLocaleDateString() : '—'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-8 border border-zinc-800 bg-zinc-900/20 rounded-2xl p-6">
              <h3 className="text-lg font-bold uppercase tracking-widest text-white mb-4">Run a New Scan</h3>
              <div className="flex flex-wrap gap-4">
                <button
                  type="button"
                  onClick={() => handleCreateProfileAndScan('1')}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 transition-all uppercase tracking-widest text-sm font-bold"
                >
                  <Plus size={18} /> Ultra Scan (Pro)
                </button>
                <button
                  type="button"
                  onClick={() => handleCreateProfileAndScan('2')}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 transition-all uppercase tracking-widest text-sm font-bold"
                >
                  <Plus size={18} /> Fun Mode
                </button>
                <button
                  type="button"
                  onClick={() => handleCreateProfileAndScan('3')}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-all uppercase tracking-widest text-sm font-bold"
                >
                  <Plus size={18} /> Basic Scan (Free)
                </button>
              </div>
              <p className="text-xs text-zinc-500 mt-4">The correct AI model is pre-selected on the upload page. You can still change it there before analyzing.</p>
            </div>

            <DashboardHubPreviewsCompact setCurrentPage={setCurrentPage} />
          </div>
        )}

        {activeSection === 'news' && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/25 p-8 max-w-2xl">
            <div className="flex items-center gap-3 text-violet-400 mb-4">
              <Newspaper size={22} />
              <h2 className="text-xl font-black uppercase tracking-widest italic">News &amp; Media</h2>
            </div>
            <p className="text-zinc-400 font-sans text-sm leading-relaxed mb-6">
              Full feed: YouTube updates, articles, and MogCheck announcements — open the dedicated page for the live experience.
            </p>
            <button
              type="button"
              onClick={() => setCurrentPage('news')}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-500/15 border border-violet-500/35 text-violet-200 text-xs font-bold uppercase tracking-widest hover:bg-violet-500/25 transition-colors"
            >
              Go to News &amp; Media <ChevronRight size={16} />
            </button>
          </div>
        )}

        {activeSection === 'mog-battles' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-6">
              <h2 className="text-lg font-black uppercase tracking-widest text-cyan-400 mb-2 flex items-center gap-2">
                <Swords size={20} /> Mog Battles
              </h2>
              <p className="text-zinc-500 text-sm font-sans mb-6">Preview of recent matchups. Cast votes and climb the leaderboard on the full page.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                {mogPreviewBattles.length === 0 ? (
                  <p className="text-zinc-600 text-sm col-span-full">Loading battles…</p>
                ) : (
                  mogPreviewBattles.map((b) => (
                    <div key={b.id} className="rounded-xl overflow-hidden border border-zinc-800 bg-black/40 aspect-[4/3] relative">
                      <div className="absolute inset-0 flex">
                        <div className="flex-1 relative">
                          <img
                            src={b.fighterA?.frontImage || b.fighterA?.imgSrc}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover object-top"
                          />
                        </div>
                        <div className="w-px bg-zinc-800" />
                        <div className="flex-1 relative">
                          <img
                            src={b.fighterB?.frontImage || b.fighterB?.imgSrc}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover object-top"
                          />
                        </div>
                      </div>
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 to-transparent p-2 text-[10px] font-bold text-white uppercase tracking-widest text-center">
                        VS
                      </div>
                    </div>
                  ))
                )}
              </div>
              <button
                type="button"
                onClick={() => setCurrentPage('mog-battles')}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 text-xs font-bold uppercase tracking-widest hover:bg-cyan-500/25 transition-colors"
              >
                Go to Mog Battles <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {activeSection === 'community' && (
          <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-6">
            <h2 className="text-lg font-black uppercase tracking-widest text-emerald-400/90 mb-2 flex items-center gap-2">
              <Users size={20} /> Community Scans
            </h2>
            <p className="text-zinc-500 text-sm font-sans mb-6">A sample of community-rated scans. Browse the full gallery on the Scans page.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {communityPreview.map((scan) => (
                <div key={scan.id} className="aspect-[3/4] rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900">
                  <img src={scan.dashboardData?.frontImage} alt="" className="w-full h-full object-cover object-top" />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setCurrentPage('celebrity')}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-bold uppercase tracking-widest hover:bg-emerald-500/20 transition-colors"
            >
              Go to Community Scans <ChevronRight size={16} />
            </button>
          </div>
        )}
      </main>
    </div>
  );
};

export default ProDashboardPage;

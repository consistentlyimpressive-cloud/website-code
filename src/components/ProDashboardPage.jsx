import React, { useState, useEffect } from 'react';
import { Target, Newspaper, Swords, Users, Crown, Settings, ChevronRight, Plus, Trash2, Edit2 } from 'lucide-react';
import { hasEffectiveProAccess } from '../utils/planAccess';
import { getApiBase } from '../utils/apiBase';

const API_BASE = getApiBase();

const ProDashboardPage = ({ dashboardData, setCurrentPage, userPlan, user, onSignOut }) => {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);

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

  const handleCreateProfileAndScan = async (model = '1') => {
    // If they want to do a new scan, we can route them to upload-photo.
    // The upload page should let them select or create a profile.
    // For now, let's just route to upload-photo and pass the chosen model.
    if (model === '1') {
      setCurrentPage('upload-ultra');
    } else {
      // Fun modes
      setCurrentPage('upload-photo');
    }
  };

  const handleRenameProfile = async (e, id, currentName) => {
    e.stopPropagation();
    const name = prompt("Enter new profile name:", currentName);
    if (!name) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/profiles/${id}`, {
        method: 'PUT',
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name })
      });
      if (res.ok) {
        setProfiles(profiles.map(p => p.id === id ? { ...p, name } : p));
      }
    } catch(err) {
      alert(err.message);
    }
  };

  const handleDeleteProfile = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this profile and ALL its scans?")) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/profiles/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setProfiles(profiles.filter(p => p.id !== id));
      }
    } catch(err) {
      alert(err.message);
    }
  };

  const username = user?.email?.split('@')[0] || 'User';
  const isFreeModelScan = !hasEffectiveProAccess(user, userPlan);

  const navTabs = [
    { id: 'overview', label: 'Profiles', icon: <Target size={16} /> },
    { id: 'news', label: 'News & Updates', icon: <Newspaper size={16} /> },
    { id: 'mog-battles', label: 'Mog Battles', icon: <Swords size={16} /> },
    { id: 'community', label: 'Community Scans', icon: <Users size={16} /> },
  ];

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#0a0a0b]">
      {/* Sidebar */}
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
                onClick={() => setCurrentPage(tab.id === 'overview' ? 'dashboard' : tab.id)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl font-sans text-xs uppercase tracking-widest transition-all ${
                  tab.id === 'overview'
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
          <button onClick={() => setCurrentPage('plans')} className="flex items-center justify-between px-4 py-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 transition-all font-sans text-xs uppercase tracking-widest group">
            <span className="flex items-center gap-2"><Crown size={14} /> Upgrade</span>
            <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
          </button>

          <div className="flex items-center justify-between">
            <div className="flex flex-col min-w-0">
              <span className="text-white font-bold text-sm uppercase truncate">{username}</span>
              <span className="text-zinc-500 text-[10px] font-sans uppercase tracking-widest">{isFreeModelScan ? 'Free member' : 'Pro Member'}</span>
            </div>
            <button onClick={() => setCurrentPage('settings')} className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
              <Settings size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-10 max-w-[1200px] w-full mx-auto">
        <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter italic text-white mb-2">Welcome Back, {username}</h1>
        <p className="text-zinc-400 font-sans text-sm uppercase tracking-widest mb-12">Select a profile to view analysis and trajectory.</p>

        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between border-b border-zinc-900 pb-4">
            <h2 className="text-xl font-bold uppercase tracking-widest text-cyan-400">Your Profiles</h2>
          </div>

          {loading ? (
            <p className="text-zinc-500">Loading profiles...</p>
          ) : profiles.length === 0 ? (
            <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-8 text-center">
              <p className="text-zinc-400 mb-4">You don't have any profiles yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {profiles.map(p => (
                <div 
                  key={p.id}
                  onClick={() => {
                    const url = `/users/${username}/${p.id}`;
                    window.history.pushState({}, '', url);
                    window.dispatchEvent(new Event('popstate'));
                  }}
                  className="bg-zinc-900/40 border border-zinc-800 hover:border-cyan-500/50 rounded-2xl p-6 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-[0_0_20px_rgba(34,211,238,0.1)] group flex flex-col"
                >
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-xl font-black italic text-white group-hover:text-cyan-400 transition-colors">{p.name}</h3>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => handleRenameProfile(e, p.id, p.name)} className="p-1 text-zinc-400 hover:text-white"><Edit2 size={16} /></button>
                      <button onClick={(e) => handleDeleteProfile(e, p.id)} className="p-1 text-red-400 hover:text-red-300"><Trash2 size={16} /></button>
                    </div>
                  </div>
                  <div className="mt-auto">
                    <p className="text-xs text-zinc-500 uppercase tracking-widest">Visibility: {p.visibility}</p>
                    <p className="text-xs text-zinc-500 uppercase tracking-widest mt-1">
                      Created: {new Date(p.createdAt?.seconds * 1000).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create New Scan / Fun Modes */}
          <div className="mt-8 border border-zinc-800 bg-zinc-900/20 rounded-2xl p-6">
            <h3 className="text-lg font-bold uppercase tracking-widest text-white mb-4">Run a New Scan</h3>
            <div className="flex flex-wrap gap-4">
              <button 
                onClick={() => handleCreateProfileAndScan('1')}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 transition-all uppercase tracking-widest text-sm font-bold"
              >
                <Plus size={18} /> Ultra Scan (Pro)
              </button>
              <button 
                onClick={() => handleCreateProfileAndScan('2')}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 transition-all uppercase tracking-widest text-sm font-bold"
              >
                <Plus size={18} /> Fun Mode
              </button>
              <button 
                onClick={() => handleCreateProfileAndScan('3')}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-all uppercase tracking-widest text-sm font-bold"
              >
                <Plus size={18} /> Basic Scan (Free)
              </button>
            </div>
            <p className="text-xs text-zinc-500 mt-4">You will be prompted to select or create a profile during upload.</p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ProDashboardPage;

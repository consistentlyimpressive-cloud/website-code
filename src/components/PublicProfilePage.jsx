import React, { useState, useEffect, useMemo } from 'react';
import { Target, Activity, CheckCircle2, Hexagon, Shield, Globe, Lock, ArrowLeft, ArrowUpRight, TrendingUp, Trash2 } from 'lucide-react';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import { getApiBase } from '../utils/apiBase';
import { ConfirmDialog, ImageLightbox } from './ui/SiteModal';

const API_BASE = getApiBase();

const MetricBar = ({ label, score, max = 100, displayValue }) => (
  <div className="flex flex-col gap-2">
    <div className="flex justify-between items-end">
      <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-zinc-400 font-bold">{label}</span>
      <span className="font-mono text-sm text-cyan-400 tabular-nums font-bold drop-shadow-md">
        {displayValue || `${score}/${max}`}
      </span>
    </div>
    <div className="h-1.5 w-full bg-zinc-900/80 rounded-full overflow-hidden border border-zinc-800/50">
      <div
        className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 rounded-full shadow-[0_0_10px_rgba(34,211,238,0.5)] transition-all duration-1000 ease-out"
        style={{ width: `${(score / max) * 100}%` }}
      />
    </div>
  </div>
);

const FeatureHighlightCard = ({ type, feature }) => {
  const isBest = type === 'best';
  if (!feature) return null;
  const cardClass = isBest
    ? 'p-6 bg-green-900/10 border border-green-500/20 rounded-2xl relative overflow-hidden shadow-[0_0_30px_rgba(34,197,94,0.05)] cursor-default transition-all duration-300'
    : 'p-6 bg-red-900/10 border border-red-500/20 rounded-2xl relative overflow-hidden shadow-[0_0_30px_rgba(239,68,68,0.05)] cursor-default transition-all duration-300';
  const railClass = isBest
    ? 'absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-green-400 to-green-600'
    : 'absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-red-400 to-red-600';
  const labelClass = isBest
    ? 'text-green-500/50 text-[10px] uppercase font-black tracking-widest mb-1 block'
    : 'text-red-500/50 text-[10px] uppercase font-black tracking-widest mb-1 block';
  const titleClass = isBest
    ? 'text-green-400 font-bold uppercase text-sm tracking-widest mb-2'
    : 'text-red-400 font-bold uppercase text-sm tracking-widest mb-2';
  return (
    <div className={cardClass}>
      <div className={railClass} />
      <span className={labelClass}>{isBest ? 'Best Feature' : 'Primary Flaw'}</span>
      <h4 className={titleClass}>{feature.title}</h4>
      <p className="text-zinc-400 text-xs font-sans leading-relaxed">{feature.description}</p>
    </div>
  );
};

const PublicProfilePage = ({ routeParams, user }) => {
  const [profile, setProfile] = useState(null);
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedScanId, setSelectedScanId] = useState(null);
  const [activeSide, setActiveSide] = useState('front'); // 'front' or 'side'
  const [pendingProfileVisibility, setPendingProfileVisibility] = useState(null);
  const [pendingScanVisibility, setPendingScanVisibility] = useState(null);
  const [confirmDeleteScan, setConfirmDeleteScan] = useState(null);
  const [lightboxImage, setLightboxImage] = useState(null);

  const isOwner = Boolean(user?.uid && profile?.userId && user.uid === profile.userId);

  const navigateTo = (path) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new Event('popstate'));
  };

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const token = user ? await user.getIdToken() : null;
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        const uid = routeParams.uid || routeParams.username || user?.uid || '';
        const actualProfileId = routeParams.profileId || '';

        if (!uid || !actualProfileId) {
          throw new Error('Invalid profile link');
        }

        const res = await fetch(
          `${API_BASE}/api/public/profiles/${encodeURIComponent(uid)}/${encodeURIComponent(actualProfileId)}`,
          { headers }
        );
        if (!res.ok) {
          const errText = await res.json().catch(() => ({}));
          throw new Error(errText.error || await res.text() || 'Failed to fetch profile');
        }
        
        const data = await res.json();
        setProfile(data.profile);
        setScans(data.scans || []);
        const search = new URLSearchParams(window.location.search);
        const requestedScanId = search.get('scan');
        if (requestedScanId && data.scans?.some((scan) => scan.id === requestedScanId)) {
          setSelectedScanId(requestedScanId);
        } else if (data.scans?.length > 0) {
          setSelectedScanId(data.scans[0].id);
        }
      } catch (e) {
        setError(e.message || 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [routeParams, user]);

  const activeScan = useMemo(() => scans.find(s => s.id === selectedScanId) || scans[0], [scans, selectedScanId]);
  const hasSideScan = Boolean(activeScan?.sideImageUrl);

  useEffect(() => {
    if (activeSide === 'side' && !hasSideScan) {
      setActiveSide('front');
    }
  }, [activeSide, hasSideScan, activeScan?.id]);
  
  const parsedData = useMemo(() => {
    if (!activeScan?.payload) return null;
    return activeScan.payload; // This contains hexagonFront, personalizedFeedback, etc.
  }, [activeScan]);
  const activeScanVisibility = String(activeScan?.visibility || 'private').trim().toLowerCase() || 'private';

  const hexData = useMemo(() => {
    if (!parsedData) return [];
    const source = activeSide === 'front' ? parsedData.hexagonFront : parsedData.hexagonSide;
    if (!source) return [];
    return [
      { subject: 'Skin', A: source.Skin === 'N/A' ? 0 : source.Skin, isNA: source.Skin === 'N/A' },
      { subject: 'Bone', A: source.Bone === 'N/A' ? 0 : source.Bone, isNA: source.Bone === 'N/A' },
      { subject: 'Harmony', A: source.Harmony === 'N/A' ? 0 : source.Harmony, isNA: source.Harmony === 'N/A' },
      { subject: 'Symmetry', A: source.Symmetry === 'N/A' ? 0 : source.Symmetry, isNA: source.Symmetry === 'N/A' },
      { subject: 'Dimorphism', A: source.Dimorphism === 'N/A' ? 0 : source.Dimorphism, isNA: source.Dimorphism === 'N/A' },
    ];
  }, [parsedData, activeSide]);

  const commitProfileVisibility = async (vis) => {
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/profiles/${profile.id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: vis })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to update profile visibility');
      }
      setProfile({ ...profile, visibility: vis });
    } catch(e) {
      setError(e.message || 'Failed to update profile visibility');
    }
  };

  const handleUpdateVisibility = (vis) => {
    if (vis === 'community') {
      setPendingProfileVisibility(vis);
      return;
    }
    commitProfileVisibility(vis);
  };

  const commitScanVisibility = async (scanId, vis) => {
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/scans/${scanId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: vis })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to update scan visibility');
      setScans((prev) => prev.map((scan) => (
        scan.id === scanId ? { ...scan, visibility: vis } : scan
      )));
    } catch (e) {
      setError(e.message || 'Failed to update scan visibility');
    }
  };

  const handleUpdateScanVisibility = (scanId, vis) => {
    if (vis === 'community') {
      setPendingScanVisibility({ scanId, visibility: vis });
      return;
    }
    commitScanVisibility(scanId, vis);
  };

  const handleDeleteScan = async (scanId) => {
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/user/scans/${scanId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to delete scan');
      const newScans = scans.filter((x) => x.id !== scanId);
      setScans(newScans);
      if (selectedScanId === scanId) setSelectedScanId(newScans[0]?.id || null);
    } catch(err) {
      setError(err.message || 'Failed to delete scan');
    } finally {
      setConfirmDeleteScan(null);
    }
  };

  if (loading) return <div className="min-h-screen bg-[#0c0d0e] flex items-center justify-center"><p className="text-zinc-500 animate-pulse">Loading profile...</p></div>;
  if (error) return <div className="min-h-screen bg-[#0c0d0e] flex items-center justify-center"><p className="text-red-500">{error}</p></div>;
  if (!profile) return <div className="min-h-screen bg-[#0c0d0e] flex items-center justify-center"><p className="text-zinc-500">Profile not found.</p></div>;

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-zinc-200 py-24 px-4 sm:px-8 max-w-7xl mx-auto">
      <button onClick={() => navigateTo(isOwner ? '/dashboard' : '/')} className="text-zinc-500 hover:text-zinc-300 uppercase tracking-widest text-xs mb-8 flex items-center gap-2">
        <ArrowLeft size={16} /> {isOwner ? 'Back to Dashboard' : 'Back Home'}
      </button>

      <header className="mb-12 border-b border-zinc-900 pb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 className="text-4xl md:text-6xl font-black italic uppercase tracking-tighter text-white mb-2">{profile.name}</h1>
          <p className="text-zinc-500 uppercase tracking-widest text-sm">Created {new Date(profile.createdAt?.seconds * 1000).toLocaleDateString()}</p>
        </div>
        
        {isOwner && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-zinc-500">Scan-level publishing</p>
            <p className="mt-1 text-xs text-zinc-400">Use the active scan&apos;s visibility controls below to publish one scan at a time.</p>
          </div>
        )}
      </header>

      {/* Scans Selector */}
      {scans.length > 0 && (
        <div className="mb-12 overflow-x-auto pb-4 custom-scrollbar flex gap-4 items-center">
          {scans.map(s => (
            <div 
              key={s.id} 
              onClick={() => setSelectedScanId(s.id)}
              className={`shrink-0 w-32 h-40 rounded-xl overflow-hidden cursor-pointer border-2 transition-all relative group ${selectedScanId === s.id ? 'border-cyan-500' : 'border-zinc-800 hover:border-zinc-600'}`}
            >
              <img src={s.frontImageUrl} className="w-full h-full object-cover" />
              {isOwner && (
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteScan(s.id);
                  }}
                  className="absolute top-2 right-2 bg-black/80 text-red-400 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 hover:text-white"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {activeScan && parsedData ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 md:gap-12">
          {/* LEFT: Photos & Rating */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            <div className="relative rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl bg-zinc-950">
              <button
                type="button"
                onClick={() => setLightboxImage({
                  src: activeSide === 'side' && hasSideScan ? activeScan.sideImageUrl : activeScan.frontImageUrl,
                  subtitle: `${profile.name} · ${activeSide === 'side' && hasSideScan ? 'Side' : 'Front'} profile`,
                })}
                className="block w-full text-left"
              >
                <img src={activeSide === 'side' && hasSideScan ? activeScan.sideImageUrl : activeScan.frontImageUrl} className="w-full aspect-[3/4] object-cover" />
              </button>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent p-6 pt-24 flex justify-between items-end">
                <div>
                  <p className="text-[10px] text-cyan-400 uppercase tracking-widest font-bold mb-1">Overall Rating</p>
                  <p className="text-6xl font-black italic tracking-tighter text-white">{activeSide === 'side' && hasSideScan ? activeScan.sideRating : activeScan.finalRating}</p>
                  <p className="text-zinc-500 text-xs uppercase tracking-widest mt-1">{activeSide === 'side' && hasSideScan ? 'Side' : 'Front'} Profile</p>
                </div>
                <div className="flex bg-zinc-900/80 rounded-lg p-1 border border-zinc-700/50 backdrop-blur-md">
                  <button onClick={() => setActiveSide('front')} className={`px-3 py-1.5 text-xs font-bold uppercase tracking-widest rounded ${activeSide === 'front' ? 'bg-cyan-500 text-black' : 'text-zinc-400 hover:text-white'}`}>Front</button>
                  {hasSideScan && (
                    <button onClick={() => setActiveSide('side')} className={`px-3 py-1.5 text-xs font-bold uppercase tracking-widest rounded ${activeSide === 'side' ? 'bg-cyan-500 text-black' : 'text-zinc-400 hover:text-white'}`}>Side</button>
                  )}
                </div>
              </div>
            </div>
            
            <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4 flex justify-between items-center">
              <span className="text-xs text-zinc-500 uppercase tracking-widest">Model Used</span>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="text-xs font-bold text-cyan-400 bg-cyan-500/10 px-2 py-1 rounded uppercase tracking-widest">{activeScan.model || 'Unknown'}</span>
                <span className="text-xs font-bold text-zinc-300 bg-zinc-800 px-2 py-1 rounded uppercase tracking-widest">
                  {activeScan.cohesiveFrontSide ? 'Cohesive on' : 'Cohesive off'}
                </span>
              </div>
            </div>

            {isOwner && activeScan && (
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-xs text-zinc-500 uppercase tracking-widest">Scan Visibility</span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300">
                    {activeScanVisibility === 'community' ? 'Public' : activeScanVisibility}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => handleUpdateScanVisibility(activeScan.id, 'private')} className={`px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest ${activeScanVisibility === 'private' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300 border border-zinc-800'}`}>
                    Private
                  </button>
                  <button onClick={() => handleUpdateScanVisibility(activeScan.id, 'unlisted')} className={`px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest ${activeScanVisibility === 'unlisted' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300 border border-zinc-800'}`}>
                    Unlisted
                  </button>
                  <button onClick={() => handleUpdateScanVisibility(activeScan.id, 'community')} className={`px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest ${activeScanVisibility === 'community' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300 border border-zinc-800'}`}>
                    Public
                  </button>
                </div>
              </div>
            )}

            {parsedData.technicalSummary && (
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-6">
                <h3 className="text-lg font-black uppercase tracking-widest text-white mb-3">Overview</h3>
                <p className="text-zinc-300 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: String(parsedData.technicalSummary).replace(/\*\*(.*?)\*\*/g, '<b class="text-white">$1</b>') }} />
              </div>
            )}
          </div>

          {/* RIGHT: Analysis & Data */}
          <div className="lg:col-span-8 flex flex-col gap-12">
            
            {/* Hexagon Chart */}
            <section>
              <h2 className="text-2xl font-black italic uppercase tracking-widest text-white mb-6 flex items-center gap-3">
                <Hexagon className="text-cyan-400" /> Structure Hexagon
              </h2>
              <div className="bg-zinc-900/20 border border-zinc-800/80 rounded-2xl p-6 md:p-8 flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-cyan-500/5 animate-pulse mix-blend-overlay"></div>
                <div className="w-full max-w-sm aspect-square relative z-10">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="70%" data={hexData}>
                      <PolarGrid stroke="#27272a" strokeDasharray="3 3" />
                      <PolarAngleAxis dataKey="subject" tick={{ fill: '#a1a1aa', fontSize: 10, textAnchor: 'middle' }} />
                      <PolarRadiusAxis angle={30} domain={[0, 10]} tick={false} axisLine={false} />
                      <Radar name="Score" dataKey="A" stroke="#22d3ee" strokeWidth={2} fill="#22d3ee" fillOpacity={0.2} isAnimationActive={false} />
                    </RadarChart>
                  </ResponsiveContainer>
                  
                  {/* Overlay N/A text in red */}
                  {hexData.map((d, i) => d.isNA && (
                    <div key={i} className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="text-red-500 text-xs font-bold uppercase tracking-widest rotate-12 drop-shadow-md">N/A</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Personalized Feedback */}
            {parsedData.personalizedFeedback && parsedData.personalizedFeedback.length > 0 && (
              <section>
                <h2 className="text-2xl font-black italic uppercase tracking-widest text-white mb-6">Personalized Feedback</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {parsedData.personalizedFeedback.map((fb, idx) => {
                    // Replace **text** with <b>text</b>
                    const formattedDesc = fb.description.replace(/\*\*(.*?)\*\*/g, '<b class="text-white">$1</b>');
                    return (
                      <div key={idx} className="bg-zinc-900/40 border border-zinc-800 hover:border-cyan-500/30 rounded-xl p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_4px_20px_rgba(34,211,238,0.1)] group">
                        <h3 className="text-sm font-black uppercase tracking-widest text-cyan-400 mb-3">{fb.title}</h3>
                        <p className="text-zinc-400 text-sm leading-relaxed" dangerouslySetInnerHTML={{__html: formattedDesc}} />
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Structure Rectangles (Best/Flaw) */}
            <section>
              <h2 className="text-2xl font-black italic uppercase tracking-widest text-white mb-6">Structure Highlights</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <FeatureHighlightCard type="best" feature={activeSide === 'front' ? parsedData.bestFeatures?.[0] : parsedData.sideBestFeatures?.[0]} />
                <FeatureHighlightCard type="flaw" feature={activeSide === 'front' ? parsedData.primaryFlaws?.[0] : parsedData.sidePrimaryFlaws?.[0]} />
              </div>
            </section>

            {/* Protocols & Trajectory */}
            {parsedData.protocols && parsedData.protocols.length > 0 && (
              <section>
                <h2 className="text-2xl font-black italic uppercase tracking-widest text-white mb-6 flex items-center gap-3">
                  <TrendingUp className="text-cyan-400" /> Protocols & Trajectory
                </h2>
                <div className="flex flex-col gap-4">
                  {parsedData.protocols.map((p, i) => (
                    <div key={i} className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-5 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <span className="bg-cyan-500/10 text-cyan-400 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-widest">Protocol {i+1}</span>
                          <h4 className="text-white font-bold">{p.name}</h4>
                        </div>
                        <p className="text-zinc-400 text-sm leading-relaxed max-w-2xl">{p.description}</p>
                      </div>
                      <span className={`shrink-0 text-xs font-bold uppercase tracking-widest px-3 py-1 rounded border ${p.impact.includes('High') ? 'bg-red-500/10 text-red-400 border-red-500/20' : p.impact.includes('Medium') ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20'}`}>
                        {p.impact}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

          </div>
        </div>
      ) : (
        <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-12 text-center">
          <p className="text-zinc-400">Analysis data is not available for this scan.</p>
        </div>
      )}
      
      {/* Overview of Mog Battles and Community Scans at the bottom */}
      <div className="mt-24 pt-12 border-t border-zinc-900">
        <h2 className="text-2xl font-black italic uppercase tracking-widest text-white mb-6 text-center">Explore Community</h2>
        <div className="flex justify-center gap-6">
           <button onClick={() => navigateTo('/mog-battles')} className="text-cyan-400 hover:text-cyan-300 font-bold uppercase tracking-widest text-sm flex items-center gap-2 bg-cyan-500/10 px-6 py-3 rounded-xl border border-cyan-500/20 transition-all hover:bg-cyan-500/20">
             Mog Battles <ArrowUpRight size={16} />
           </button>
           <button onClick={() => navigateTo('/celebrity')} className="text-cyan-400 hover:text-cyan-300 font-bold uppercase tracking-widest text-sm flex items-center gap-2 bg-cyan-500/10 px-6 py-3 rounded-xl border border-cyan-500/20 transition-all hover:bg-cyan-500/20">
             Community Scans <ArrowUpRight size={16} />
           </button>
        </div>
      </div>

      {pendingProfileVisibility && (
        <ConfirmDialog
          title="Make Profile Public?"
          body="Are you sure? Making your profile public will make it much easier to discover around the site."
          confirmLabel="Make Public"
          tone="warning"
          onClose={() => setPendingProfileVisibility(null)}
          onConfirm={() => {
            commitProfileVisibility(pendingProfileVisibility);
            setPendingProfileVisibility(null);
          }}
        />
      )}

      {pendingScanVisibility && (
        <ConfirmDialog
          title="Make Scan Public?"
          body="Are you sure? Making your scan public will add it to the community scans."
          confirmLabel="Make Public"
          tone="warning"
          onClose={() => setPendingScanVisibility(null)}
          onConfirm={() => {
            commitScanVisibility(pendingScanVisibility.scanId, pendingScanVisibility.visibility);
            setPendingScanVisibility(null);
          }}
        />
      )}

      {confirmDeleteScan && (
        <ConfirmDialog
          title="Delete Scan?"
          body="This will remove the scan from this profile and delete its saved images."
          confirmLabel="Delete Scan"
          tone="danger"
          onClose={() => setConfirmDeleteScan(null)}
          onConfirm={() => handleDeleteScan(confirmDeleteScan)}
        />
      )}

      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          subtitle={lightboxImage.subtitle}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  );
};

export default PublicProfilePage;

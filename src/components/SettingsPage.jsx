import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Clock, User, Battery, Calendar, ChevronRight, Receipt } from 'lucide-react';
import { getApiBase } from '../utils/apiBase';
import { isProPlan, normalizePlanValue } from '../utils/planAccess';

const API_BASE = getApiBase();

const timestampToMillis = (value) => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) return numeric;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') {
    const nanos = typeof value?.nanoseconds === 'number' ? value.nanoseconds / 1e6 : 0;
    return value.seconds * 1000 + nanos;
  }
  const fallback = new Date(value).getTime();
  return Number.isFinite(fallback) ? fallback : 0;
};

const formatPlanTimeRemaining = (userPlan) => {
  const normalizedPlan = normalizePlanValue(userPlan?.plan);
  const isPro = isProPlan(userPlan);
  if (!isPro) return 'Not active';
  if (normalizedPlan === 'pro_infinite') return 'Infinite';
  const endMs = timestampToMillis(userPlan?.subscriptionCurrentPeriodEnd);
  const daysFromApi = Number(userPlan?.proDaysLeft);
  if (endMs > Date.now()) {
    const totalHours = Math.ceil((endMs - Date.now()) / 3600000);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    if (days > 0) return `${days} day${days === 1 ? '' : 's'}${hours > 0 ? ` ${hours}h` : ''} left`;
    return `${Math.max(1, hours)}h left`;
  }
  if (Number.isFinite(daysFromApi) && daysFromApi > 0) {
    return `${daysFromApi} day${daysFromApi === 1 ? '' : 's'} left`;
  }
  return 'Active';
};

const SettingsPage = ({ setCurrentPage, user, userPlan, dashboardData }) => {
  const normalizedPlan = normalizePlanValue(userPlan?.plan);
  const planName = userPlan?.planLabel || (isProPlan(userPlan) ? (normalizedPlan === 'pro_infinite' ? 'PRO - INFINITE' : normalizedPlan === 'pro_annual' ? 'PRO - ANNUAL' : 'PRO - MONTHLY') : userPlan?.plan === 'single_scan' ? 'Single Scan' : 'Free');
  const credits = userPlan?.scanCredits || 0;
  const planTimeRemaining = formatPlanTimeRemaining(userPlan);
  const [userScans, setUserScans] = useState([]);
  const [purchaseHistory, setPurchaseHistory] = useState([]);
  const [purchasesLoading, setPurchasesLoading] = useState(false);
  let timeStr = 'N/A';
  if (userPlan?.updatedAt) {
    const d = new Date(userPlan.updatedAt.seconds ? userPlan.updatedAt.seconds * 1000 : userPlan.updatedAt);
    timeStr = d.toLocaleDateString();
  }

  useEffect(() => {
    let cancelled = false;
    const fetchScans = async () => {
      if (!user) {
        setUserScans([]);
        setPurchaseHistory([]);
        return;
      }
      try {
        const token = await user.getIdToken();
        const [scansRes, purchasesRes] = await Promise.all([
          fetch(`${API_BASE}/api/user/scans`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API_BASE}/api/user/purchases`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        const data = await scansRes.json().catch(() => ({}));
        const purchasesData = await purchasesRes.json().catch(() => ({}));
        if (!cancelled) {
          setUserScans(scansRes.ok && Array.isArray(data.scans) ? data.scans : []);
          setPurchaseHistory(purchasesRes.ok && Array.isArray(purchasesData.purchases) ? purchasesData.purchases : []);
        }
      } catch {
        if (!cancelled) {
          setUserScans([]);
          setPurchaseHistory([]);
        }
      } finally {
        if (!cancelled) setPurchasesLoading(false);
      }
    };
    setPurchasesLoading(!!user);
    fetchScans();
    const handleFocus = () => fetchScans();
    window.addEventListener('focus', handleFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', handleFocus);
    };
  }, [user, userPlan?.plan, userPlan?.subscriptionId, userPlan?.subscriptionCurrentPeriodEnd]);

  const effectiveScans = useMemo(() => {
    if (userScans.length > 0) return userScans;
    return Array.isArray(dashboardData?.scanHistory) ? dashboardData.scanHistory : [];
  }, [dashboardData?.scanHistory, userScans]);

  const scansToday = useMemo(() => {
    const today = new Date().toDateString();
    return effectiveScans.filter((scan) => {
      const millis = timestampToMillis(scan.timestamp || scan.scannedAt || scan.createdAt);
      return millis && new Date(millis).toDateString() === today;
    }).length;
  }, [effectiveScans]);

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
        <p className="text-zinc-500 text-sm font-sans mb-8">Profile, scans, and subscription in one place.</p>

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
              <div className="bg-black/40 border border-zinc-800/50 rounded-xl p-4 sm:col-span-2">
                <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Plan Time Remaining</p>
                <p className="text-lg font-bold text-zinc-300 flex items-center gap-2">
                  <Clock size={16} className="text-cyan-500" /> {planTimeRemaining}
                </p>
                {userPlan?.subscriptionCurrentPeriodEnd && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Renews or expires on {new Date(timestampToMillis(userPlan.subscriptionCurrentPeriodEnd)).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
            
            <div className="mt-6 pt-6 border-t border-zinc-800/50">
              <h3 className="text-xs uppercase tracking-widest text-zinc-400 font-bold mb-3 flex items-center gap-2">
                <Clock size={14} /> Scan History Quick Stats
              </h3>
              <p className="text-zinc-500 text-sm">
                Total Scans: <span className="text-white font-bold">{effectiveScans.length}</span>
              </p>
              <p className="text-zinc-500 text-sm mt-1">
                Scans Today: <span className="text-white font-bold">{scansToday}</span>
              </p>
            </div>

            <div className="mt-6 pt-6 border-t border-zinc-800/50">
              <h3 className="text-xs uppercase tracking-widest text-zinc-400 font-bold mb-3 flex items-center gap-2">
                <Receipt size={14} /> Purchase History
              </h3>
              {purchasesLoading ? (
                <p className="text-zinc-500 text-sm">Loading purchases...</p>
              ) : purchaseHistory.length === 0 ? (
                <p className="text-zinc-500 text-sm">No purchases found yet.</p>
              ) : (
                <div className="space-y-2">
                  {purchaseHistory.map((purchase) => (
                    <div key={purchase.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/70 bg-black/30 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-zinc-100">{purchase.label || purchase.plan || 'Purchase'}</p>
                        <p className="mt-1 text-[10px] uppercase tracking-widest text-zinc-600">
                          {purchase.purchasedAt ? new Date(purchase.purchasedAt).toLocaleString() : 'Date unavailable'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-emerald-300">{purchase.amount ? `${purchase.currency || 'USD'} ${purchase.amount}` : '-'}</p>
                        <p className="text-[10px] uppercase tracking-widest text-zinc-600">{purchase.status || 'completed'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;

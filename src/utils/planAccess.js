/** Emails that get Pro-level product access regardless of Firestore `plan` (staff / admin testers). */
const ELEVATED_PRO_EMAILS = new Set([
  'serenity.eyb@gmail.com',
  'laithbu07@gmail.com',
  'admin@looksmaxxing.com',
]);

/**
 * True when the user should see Pro billing features: paid plan in Firestore, or elevated email / domain.
 */
export function hasEffectiveProAccess(user, userPlan) {
  const p = userPlan?.plan;
  if (p === 'pro' || p === 'single_scan') return true;
  const e = user?.email?.toLowerCase?.() ?? '';
  if (!e) return false;
  if (e.endsWith('@looksmaxxing.com')) return true;
  if (ELEVATED_PRO_EMAILS.has(e)) return true;
  return false;
}

/** Navbar badge: show "Admin" for this account (explicit staff label). */
const ADMIN_BADGE_EMAIL = 'serenity.eyb@gmail.com';

/** Staff / admin: always show Dashboard in nav and allow opening /dashboard without a prior scan. */
export function canAlwaysAccessDashboard(user) {
  const e = user?.email?.toLowerCase?.() ?? '';
  if (!e) return false;
  if (e.endsWith('@looksmaxxing.com')) return true;
  if (e === ADMIN_BADGE_EMAIL) return true;
  if (ELEVATED_PRO_EMAILS.has(e)) return true;
  return false;
}

/**
 * Label + styles for the signed-in plan chip (Firestore plan + staff overrides).
 */
export function getNavbarPlanChip(userPlan, user) {
  const e = user?.email?.toLowerCase?.() ?? '';
  if (e === ADMIN_BADGE_EMAIL) {
    return {
      label: 'Admin',
      className: 'text-violet-300 border-violet-500/40 bg-violet-500/10',
    };
  }

  const p = userPlan?.plan || 'free';
  if (p === 'pro') {
    return { label: 'Pro', className: 'text-yellow-300 border-yellow-500/40 bg-yellow-500/10' };
  }

  if (p === 'single_scan') {
    const c = userPlan?.scanCredits ?? 0;
    return {
      label: c > 0 ? `Scan - ${c}` : 'Pay per scan',
      className: 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10',
    };
  }

  return { label: 'Free', className: 'text-zinc-400 border-zinc-600/70 bg-zinc-800/90' };
}

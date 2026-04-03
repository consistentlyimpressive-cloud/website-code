import { celebrityData, tierFromRating100, makeStats } from './celebrityData';

export const MEGAN_FOX = {
  name: 'Megan Fox',
  rating: '87',
  tier: tierFromRating100(87),
  flags: ['us'],
  sex: 'Female',
  imgSrc: '/celebrities/megan-fox.png',
  technicalSummary:
    'High-trust fox-eye morphology with compact midface and strong cheekbone projection. Balanced vertical thirds with editorial-ready symmetry.',
  stats: makeStats(87, 11),
};

/** Active community battle — pre-analyzed AI scores live on each celebrity entry. */
export const CURRENT_MOGBATTLE_ID = 'megan-vs-madison';

/** Community vote totals live in Firestore via POST /api/mog-battle/vote (see src/api/mogBattleVotes.js). */

/** Portrait assets for the live Mog Battle (bundled under `public/`). */
const MOG_BATTLE_IMAGES = {
  'Megan Fox': '/celebrities/megan-fox.png',
  /** User-provided asset (synced under `public/celebrities/` and `public/mog-battles/`). */
  'Madison Beer': '/celebrities/madison-beer.png',
};

export function getCurrentBattle() {
  const a = MEGAN_FOX;
  const b = celebrityData.find((c) => c.name === 'Madison Beer');
  if (!a || !b) return null;
  return {
    id: CURRENT_MOGBATTLE_ID,
    fighterA: { ...a, imgSrc: MOG_BATTLE_IMAGES['Megan Fox'] ?? a.imgSrc },
    fighterB: { ...b, imgSrc: MOG_BATTLE_IMAGES['Madison Beer'] ?? b.imgSrc },
  };
}

/** Short labels for metric rows (first N stats from each celeb). */
export function getMetricRowsForBattle(fighterA, fighterB, count = 5) {
  const rows = [];
  const n = Math.min(count, fighterA.stats?.length || 0, fighterB.stats?.length || 0);
  for (let i = 0; i < n; i++) {
    const la = fighterA.stats[i]?.label || `Metric ${i + 1}`;
    const short =
      la.length > 42 ? `${la.slice(0, 40)}…` : la;
    rows.push({
      key: `m${i}`,
      label: short,
      scoreA: fighterA.stats[i].score,
      scoreB: fighterB.stats[i].score,
    });
  }
  return rows;
}

export function aiWinner(fighterA, fighterB) {
  const sa = Number(fighterA.rating);
  const sb = Number(fighterB.rating);
  if (Number.isNaN(sa) || Number.isNaN(sb)) return null;
  if (sa > sb) return 'a';
  if (sb > sa) return 'b';
  return 'tie';
}

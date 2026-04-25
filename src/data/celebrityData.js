/** 0–100 scale; tier bands match UI glow breakpoints (90 / 80 / 70 / 60). */
export const tierFromRating100 = (r) => {
  const n = Number(r);
  if (Number.isNaN(n)) return '—';
  if (n >= 90) return 'S-Tier';
  if (n >= 80) return 'A-Tier';
  if (n >= 70) return 'B-Tier';
  if (n >= 60) return 'C-Tier';
  return 'D-Tier';
};

/** Local assets under `/public/celebrities/` — bundled with the site (no Discord expiry). */
const IMG = {
  adrianaLima: '/celebrities/adriana-lima.png',
  jordanBarrett: '/celebrities/jordan-barrett.png',
  henryCavill: '/celebrities/henry-cavill.png',
  madisonBeer: '/celebrities/madison-beer.png',
  duaLipa: '/celebrities/dua-lipa.png',
  regeJeanPage: '/celebrities/rege-jean-page.png',
  tomHolland: '/celebrities/tom-holland.png',
  ellieKemper: '/celebrities/ellie-kemper.png',
  willSmith: '/celebrities/will-smith.png',
  noraLum: '/celebrities/nora-lum.png',
};

const METRIC_ROWS = [
  { category: 'Skeletal Structure & Harmony', label: 'Bigonial Width Index (0.835)' },
  { category: 'Skeletal Structure & Harmony', label: 'Upper Third Length (0.354)' },
  { category: 'Skeletal Structure & Harmony', label: 'Middle Third Length (0.428)' },
  { category: 'Skeletal Structure & Harmony', label: 'Lower Third Length (0.505)' },
  { category: 'Skeletal Structure & Harmony', label: 'Fwhr' },
  { category: 'Skeletal Structure & Harmony', label: 'Midface Ratio' },
  { category: 'Eye / Upper Third Area', label: 'Ipd Index' },
  { category: 'Eye / Upper Third Area', label: 'Eye Height Index (0.047)' },
  { category: 'Eye / Upper Third Area', label: 'Brow Compactness Index' },
  { category: 'Eye / Upper Third Area', label: 'Canthal Tilt Degrees (4.06°)' },
  { category: 'Nasal & Peri-Oral Area', label: 'Mouth Width Index (0.395)' },
  { category: 'Nasal & Peri-Oral Area', label: 'Nose Width Index (0.245)' },
  { category: 'Nasal & Peri-Oral Area', label: 'Philtrum Height Index (0.089)' },
  { category: 'Nasal & Peri-Oral Area', label: 'Total Lip Height Index (0.134)' },
];

/** Spread sub-scores around final rating (40–99) for consistent detail pages. */
export const makeStats = (center, salt = 0) =>
  METRIC_ROWS.map((row, i) => {
    const wobble = ((i * 17 + salt * 31) % 23) - 11;
    const score = Math.min(99, Math.max(40, Math.round(center + wobble)));
    return {
      ...row,
      score,
      displayValue: `${score}/100`,
    };
  });

export const celebrityData = [
  {
    name: 'Adriana Lima',
    rating: '88',
    tier: tierFromRating100(88),
    flags: ['br', 'pt', 'ch'],
    sex: 'Female',
    imgSrc: IMG.adrianaLima,
    technicalSummary:
      'Apex feline eye morphology (high positive canthal tilt + horizontally elongated aperture). Supported by extremely high, prominent cheekbones and proportioned facial thirds.',
    stats: makeStats(88, 1),
  },
  {
    name: 'Jordan Barrett',
    rating: '90',
    tier: tierFromRating100(90),
    flags: ['au', 'gb-eng'],
    sex: 'Male',
    imgSrc: IMG.jordanBarrett,
    technicalSummary:
      'Hyper-masculine skeletal basework with strong bizygomatic width and deep-set, positive canthal tilt. High-trust and high-dimorphism markers.',
    stats: makeStats(90, 2),
  },
  {
    name: 'Henry Cavill',
    rating: '85',
    tier: tierFromRating100(85),
    flags: ['gb-eng', 'ie'],
    sex: 'Male',
    imgSrc: IMG.henryCavill,
    technicalSummary:
      'Wide, squared mandible, pronounced supraorbital ridge, and harmonious midface ratio. Strong forward facial growth and balanced thirds.',
    stats: makeStats(85, 3),
  },
  {
    name: 'Madison Beer',
    rating: '84',
    tier: tierFromRating100(84),
    flags: ['us', 'gb-eng'],
    sex: 'Female',
    imgSrc: IMG.madisonBeer,
    technicalSummary:
      'Modern idealized lip-to-philtrum ratio and strong canthal tilt. Cohesive midface and jawline with high tissue quality.',
    stats: makeStats(84, 4),
  },
  {
    name: 'Dua Lipa',
    rating: '78',
    tier: tierFromRating100(78),
    flags: ['gb-eng', 'al'],
    sex: 'Female',
    imgSrc: IMG.duaLipa,
    technicalSummary:
      'Strong bone projection with balanced vertical thirds and defined periorbital frame. Stage presence and symmetry read well at distance.',
    stats: makeStats(78, 5),
  },
  {
    name: 'Regé-Jean Page',
    rating: '73',
    tier: tierFromRating100(73),
    flags: ['gb-eng', 'zw'],
    sex: 'Male',
    imgSrc: IMG.regeJeanPage,
    technicalSummary:
      'High-trust midface with full brows and balanced nasal proportions. Excellent overall harmony with refined jaw–chin transition.',
    stats: makeStats(86, 6),
  },
  {
    name: 'Tom Holland',
    rating: '63',
    tier: tierFromRating100(63),
    flags: ['gb-eng'],
    sex: 'Male',
    imgSrc: IMG.tomHolland,
    technicalSummary:
      'Neotenous features with softer dimorphism. Average jaw width and mild asymmetry; appeal is more cultural than pure bone metrics.',
    stats: makeStats(68, 7),
  },
  {
    name: 'Ellie Kemper',
    rating: '64',
    tier: tierFromRating100(64),
    flags: ['us'],
    sex: 'Female',
    imgSrc: IMG.ellieKemper,
    technicalSummary:
      'Approachable, high-trust smile and soft tissue. Midface ratios and projection land in the average–above-average band objectively.',
    stats: makeStats(64, 8),
  },
  {
    name: 'Will Smith',
    rating: '55',
    tier: tierFromRating100(55),
    flags: ['us'],
    sex: 'Male',
    imgSrc: IMG.willSmith,
    technicalSummary:
      'Charisma-forward presence; objective structure shows asymmetry and age-related soft-tissue changes compared to peak examples.',
    stats: makeStats(55, 9),
  },
  {
    name: 'Nora Lum',
    rating: '54',
    tier: tierFromRating100(54),
    flags: ['us', 'kr'],
    sex: 'Female',
    imgSrc: IMG.noraLum,
    technicalSummary:
      'Softer skeletal projection with rounded midface and approachable features. Metrics cluster in the mid tier with room for angularity gains.',
    stats: makeStats(54, 10),
  },
];

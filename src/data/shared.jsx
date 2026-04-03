/** Local assets in `public/metrics/` — Emma, Jordan, Chris, Sean (UUIDs verified; do not use image-4fd4134a — that file is a UI screenshot). */
/** Bump `?v=` if you replace PNGs so browsers pick up new files. */
const MV = '4';
/** Single `filter` so grayscale + zero saturation both apply (Tailwind would otherwise override). */
const metricImg = 'object-cover object-center scale-110 [filter:grayscale(100%)_saturate(0)]';
export const measureItems = [
  { title: "Health Indicators", imgSrc: `/metrics/health-indicators.png?v=${MV}`, imgClassName: metricImg, svg: (<div className="w-full h-full relative font-sans z-20"><div className="absolute top-[25%] left-4 bg-black/40 backdrop-blur-md border border-white/10 px-4 py-3 rounded-lg text-left opacity-0 group-hover:opacity-100 transition-all duration-500 transform-gpu"><div className="text-zinc-400 text-[10px] uppercase tracking-widest mb-1">Dermal Vitality</div><div className="text-green-400 text-xs font-bold">98.4% OPTIMAL</div></div><div className="absolute bottom-4 right-4 bg-black/40 backdrop-blur-md border border-white/10 px-4 py-3 rounded-lg text-right opacity-0 group-hover:opacity-100 transition-all duration-500 transform-gpu"><div className="text-zinc-400 text-[10px] uppercase tracking-widest mb-1">Facial Symmetry</div><div className="text-green-400 text-xs font-bold">HIGH 96.3%</div></div></div>) },
  { title: "Facial Harmony", imgSrc: `/metrics/facial-harmony.png?v=${MV}`, imgClassName: metricImg, svg: (<div className="w-full h-full relative font-sans z-20"><div className="absolute top-4 left-4 bg-black/40 backdrop-blur-md border border-white/10 px-4 py-3 rounded-lg text-left opacity-0 group-hover:opacity-100 transition-all duration-500 transform-gpu"><div className="text-zinc-400 text-[10px] uppercase tracking-widest mb-1">Convexity Angle</div><div className="text-emerald-400 text-xs font-bold">165° OPTIMAL</div></div><div className="absolute bottom-4 right-4 bg-black/40 backdrop-blur-md border border-white/10 px-4 py-3 rounded-lg text-right opacity-0 group-hover:opacity-100 transition-all duration-500 transform-gpu"><div className="text-zinc-400 text-[10px] uppercase tracking-widest mb-1">Nasal Bridge Index</div><div className="text-blue-400 text-xs font-bold">GRADE A</div></div></div>) },
  { title: "Dimorphism", imgSrc: `/metrics/dimorphism.png?v=${MV}`, imgClassName: metricImg, svg: (<div className="w-full h-full relative font-sans z-20"><div className="absolute top-[30%] left-4 bg-black/40 backdrop-blur-md border border-white/10 px-4 py-3 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-500 transform-gpu"><div className="text-zinc-400 text-[10px] uppercase tracking-widest mb-1">Low Set Brows</div><div className="text-white text-xs font-bold tracking-widest">DETECTED</div></div><div className="absolute bottom-4 right-4 bg-black/40 backdrop-blur-md border border-white/10 px-4 py-3 rounded-lg text-right opacity-0 group-hover:opacity-100 transition-all duration-500 transform-gpu"><div className="text-zinc-400 text-[10px] uppercase tracking-widest mb-1">Mandibular Angle</div><div className="text-emerald-400 text-xs font-bold">108°</div></div></div>) },
  { title: "Uniqueness", imgSrc: `/metrics/uniqueness.png?v=${MV}`, imgClassName: metricImg, svg: (<div className="w-full h-full relative font-sans z-20"><div className="absolute top-8 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-lg border border-white/20 px-6 py-4 rounded-xl text-center opacity-0 group-hover:opacity-100 transition-all duration-500 transform-gpu"><div className="text-zinc-400 text-[10px] uppercase tracking-widest mb-1">Facial Uniqueness</div><div className="text-purple-400 text-lg font-black italic">TOP 1%</div></div></div>) }
];

/** Local before/after slider assets (`public/comparisons/`). Bump `CV` when replacing pairings. */
const CV = '5';
export const compBefore1 = `/comparisons/before-1.png?v=${CV}`;
export const compAfter1 = `/comparisons/after-1.png?v=${CV}`;
export const compBefore2 = `/comparisons/before-2.png?v=${CV}`;
export const compAfter2 = `/comparisons/after-2.png?v=${CV}`;
export const compBefore3 = `/comparisons/before-3.png?v=${CV}`;
export const compAfter3 = `/comparisons/after-3.png?v=${CV}`;

/** Local portraits in `public/research/` — Marquardt = researcher headshot (not Sean). Bump `?v=` when replacing files. */
const RV = '4';
export const researchItems = [
  { label: "Link to study", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4866249/", text: "By Dr. Stephen Marquardt, an oral and maxillofacial surgeon.", imgSrc: `/research/study-marquardt.png?v=${RV}` },
  { label: "Link to study", url: "https://www.annualreviews.org/content/journals/10.1146/annurev.psych.57.102904.190208", text: "Dr. Gillian Rhodes, University of Western Australia.", imgSrc: `/research/study-rhodes.png?v=${RV}` },
  { label: "Link to study", url: "https://www.nature.com/articles/29772", text: "Dr. Kendra Schmid, Biostatistician at the University of Nebraska", imgSrc: `/research/study-schmid.png?v=${RV}` }
];

export const reviewsData = [
  { rating: 5, text: "I thought I was too old to see any real structural shift without surgery. Total cope. Once I got the actual harmony measurements and stopped guessing with my routine, things finally started clicking.", author: "hudson*******@gmail.com" },
  { rating: 5, text: "Honestly I was stuck for years just because I didn't get my own features. This breakdown was a reality check I actually needed. It stopped the guessing games and gaev me a clear plan to finally level up.", author: "kumar*******@gmail.com" },
  { rating: 5, text: "When I was 13 to 17 I struggled with confidence and I hated looking at myself in the mirror, my life turned around whn I started using the right looksmaxxing advice and putting in the work", author: "k.miller*******@outlook.com" }
];
/**
 * Parse final_engine.py stdout into dashboard fields (aligned with main.py).
 * Does not invent category scores: if CORE CATEGORY SCORES block is missing, categories stay null.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_SUMMARY = 'Could not generate technical summary.';
const SCORE_OFFSET_100 = 0;
const SCORE_OFFSET_10 = 0;
const MAX_TOPLINE_RATING = 95;
const BENCHMARK_FEATURE_KEYS = [
  'Bigonial',
  'IPD',
  'Mouth',
  'Nose',
  'Upper',
  'Middle',
  'Lower',
  'Eye',
  'Brow',
  'Philtrum',
  'Lip',
  'fWHR',
  'Midface',
  'Canthal',
];
const BENCHMARK_DISTANCE_WEIGHTS = {
  Bigonial: 1.0,
  IPD: 0.7,
  Mouth: 0.6,
  Nose: 0.8,
  Upper: 0.9,
  Middle: 1.25,
  Lower: 0.9,
  Eye: 0.8,
  Brow: 0.8,
  Philtrum: 1.0,
  Lip: 0.7,
  fWHR: 1.4,
  Midface: 1.5,
  Canthal: 1.0,
};
const BENCHMARK_SOURCE_FOLDERS = new Set([
  'Uncanny training',
  'Exatraggted But not uncanny',
  'The 3s',
  'The 4s',
  'The 5s',
  'The 6s',
  '7s',
  'The 8s',
]);

function loadGeminiBenchmarkCalibration() {
  const calibrationPath = path.join(__dirname, 'gemini-benchmark-calibration.json');
  if (!fs.existsSync(calibrationPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(calibrationPath, 'utf8'));
    if (!Array.isArray(data)) return [];
    return data.filter(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        entry.metrics &&
        Number.isFinite(Number(entry.target)) &&
        BENCHMARK_SOURCE_FOLDERS.has(entry.sourceFolder)
    );
  } catch (error) {
    console.error('[parse-analysis] benchmark calibration load error:', error.message);
    return [];
  }
}

function buildBenchmarkStats(entries) {
  const stats = {};
  for (const key of BENCHMARK_FEATURE_KEYS) {
    const values = entries
      .map((entry) => Number(entry?.metrics?.[key]))
      .filter((value) => Number.isFinite(value));
    const mean = average(values);
    if (mean == null) {
      stats[key] = { mean: 0, std: 1 };
      continue;
    }
    const variance = average(values.map((value) => (value - mean) ** 2)) || 0;
    stats[key] = {
      mean,
      std: Math.sqrt(variance) || 1,
    };
  }
  return stats;
}

const GEMINI_BENCHMARKS = loadGeminiBenchmarkCalibration();
const GEMINI_BENCHMARK_STATS = buildBenchmarkStats(GEMINI_BENCHMARKS);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function applyOffset100(value) {
  if (value == null || Number.isNaN(Number(value))) return value;
  return clamp(Number(value) + SCORE_OFFSET_100, 0, 100);
}

function applyOffset10(value) {
  if (value == null || value === 'N/A' || Number.isNaN(Number(value))) return value;
  return clamp(Number(value) + SCORE_OFFSET_10, 0, 10);
}

function capToplineRating(value) {
  if (value == null || value === 'N/A' || Number.isNaN(Number(value))) return value;
  return clamp(Number(value), 0, MAX_TOPLINE_RATING);
}

function offsetScoreMap(map, scale = 100) {
  if (!map || typeof map !== 'object') return map;
  const apply = scale === 10 ? applyOffset10 : applyOffset100;
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    out[key] = apply(value);
  }
  return out;
}

function average(values) {
  const nums = values
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

function normalizeImpactLabel(rawImpact) {
  const text = String(rawImpact || '').trim();
  if (!text) return 'Medium Impact';
  if (/extreme|critical|highest/i.test(text)) return 'Extreme Impact';
  if (/high/i.test(text)) return 'High Impact';
  if (/medium/i.test(text)) return 'Medium Impact';
  if (/low/i.test(text)) return 'Low Impact';
  return text;
}

function extractJsonObjects(raw) {
  const text = String(raw || '');
  const objects = [];
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            objects.push(JSON.parse(text.slice(start, i + 1)));
          } catch (_) {
            // Keep scanning; stdout can contain braces from provider errors.
          }
          break;
        }
      }
    }
  }
  return objects;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseJsonValueAfterKey(raw, key) {
  const text = String(raw || '');
  const pattern = new RegExp(`"${escapeRegExp(key)}"\\s*:`, 'i');
  const match = pattern.exec(text);
  if (!match) return undefined;

  let start = match.index + match[0].length;
  while (start < text.length && /\s/.test(text[start])) start += 1;
  const first = text[start];

  if (first === '{' || first === '[') {
    const closer = first === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === first) depth += 1;
      else if (ch === closer) {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch (_) {
            return undefined;
          }
        }
      }
    }
    return undefined;
  }

  if (first === '"') {
    let escaped = false;
    for (let i = start + 1; i < text.length; i += 1) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch (_) {
          return undefined;
        }
      }
    }
    return undefined;
  }

  const scalarMatch = text.slice(start).match(/^(null|true|false|-?\d+(?:\.\d+)?)/i);
  if (!scalarMatch) return undefined;
  try {
    return JSON.parse(scalarMatch[1].toLowerCase());
  } catch (_) {
    const numberValue = Number(scalarMatch[1]);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }
}

function parseJsonValueByAliases(raw, aliases = []) {
  for (const alias of aliases) {
    const value = parseJsonValueAfterKey(raw, alias);
    if (value !== undefined) return value;
  }
  return undefined;
}

function compactString(value, fallback = '') {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim();
}

function jsonFeatureArray(items, limit = 5) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item === 'string') {
        return { title: compactString(item).slice(0, 80), description: compactString(item).slice(0, 240) };
      }
      if (!item || typeof item !== 'object') return null;
      const title = compactString(item.title || item.name || item.label || 'Feature').slice(0, 80);
      const description = compactString(item.description || item.body || item.text || title).slice(0, 280);
      return title ? { title, description } : null;
    })
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeMetricScore(scoreValue) {
  const score = Number(scoreValue);
  if (!Number.isFinite(score)) return null;
  const score100 = score <= 10 ? score * 10 : score;
  return applyOffset100(score100);
}

function jsonBiometricArray(items, limit = 20, rawOutput = '') {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const label = compactString(item.label || item.name || item.metric);
      if (!label) return null;
      const value = item.value ?? item.rawValue ?? item.val;
      const explicitScore = normalizeMetricScore(item.score ?? item.rating);
      const deterministicScore = value != null && value !== ''
        ? deterministicBiometricScore(label, value, rawOutput)
        : null;
      const score = deterministicScore ?? explicitScore;
      const displayValue = Number.isFinite(score)
        ? `${Math.round(score)}/100`
        : compactString(value || '');
      return {
        label: value != null && value !== '' ? `${label} (${value})` : label,
        displayValue,
        score: Number.isFinite(score) ? score : null,
        impact: compactString(item.impact || ''),
        note: compactString(item.note || item.description || '').slice(0, 220),
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

function isOpenRouterGeminiOutput(rawOutput) {
  const text = String(rawOutput || '');
  return (
    /\[Using:\s*(?:google\/gemini-3\.1-pro-preview)(?=\s|\|)/i.test(text) ||
    /\[Using:\s*(?:Premium\s*2)(?=\s|\|)/i.test(text) ||
    /\[DEBUG\]\s*Model selected via API args:\s*(?:13|14)\b/i.test(text)
  );
}

function isPremium2Output(rawOutput) {
  const text = String(rawOutput || '');
  return (
    /\[Using:\s*Premium\s*2(?=\s|\|)/i.test(text) ||
    /\[DEBUG\]\s*Model selected via API args:\s*14\b/i.test(text)
  );
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function softenVisualMetricScore(label, score, note, categoryScore = null) {
  if (score == null || score === '') return score;
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return score;

  const normalized = normalizeMetricName(label);
  const text = `${label || ''} ${note || ''}`.toLowerCase();
  const category = Number(categoryScore);
  const hasCategory = Number.isFinite(category);
  const reassuringNegation = /\b(no|not|without|minimal|minor|little)\s+(?:(?:severe|major|visible|noticeable|glaring|active)\s+){0,3}(?:asymmetry|acne|blemish|texture|scarring|recession|flatness|weakness|issue|flaw|liability)\b/i;
  const reassuring =
    reassuringNegation.test(text) ||
    /\b(clear|smooth|healthy|balanced|good|solid|adequate|average|normal|decent|moderate|acceptable|not flat|not recessed|no glaring|no major)\b/i.test(text);
  const stronglyNegative =
    /\b(severe|severely|very|extremely|major|clearly|markedly|significant(?:ly)?|poor|bad|weak|recessed|flat|acne|scarred|asymmetric|thin neck|narrow neck|liability|detractor)\b/i.test(text) &&
    !reassuringNegation.test(text);

  if (stronglyNegative && !reassuring) return numeric;

  let floor = null;
  if (normalized.includes('skintexture')) floor = 70;
  else if (normalized.includes('symmetry')) floor = 72;
  else if (normalized.includes('maxillaryprojection')) floor = 68;
  else if (normalized.includes('neckwidth')) floor = 65;

  if (reassuring && hasCategory) floor = Math.max(floor ?? 0, Math.min(82, category - 4));
  if (reassuring) floor = Math.max(floor ?? 0, 68);
  if (/\b(strong|excellent|high|clear strength|standout)\b/i.test(text)) floor = Math.max(floor ?? 0, 76);

  return floor == null ? numeric : Math.round(clamp(Math.max(numeric, floor), 0, 100));
}

function findRawMetricEntry(rawValues, aliases = []) {
  const entries = Object.entries(rawValues || {});
  for (const alias of aliases) {
    const normalizedAlias = normalizeMetricName(alias);
    const match = entries.find(([label]) => normalizeMetricName(label).includes(normalizedAlias));
    if (match) {
      return { rawLabel: match[0], rawValue: match[1] };
    }
  }
  return { rawLabel: null, rawValue: undefined };
}

function findBiometricEntryByAliases(biometrics, aliases = [], excludeAliases = []) {
  const normalizedAliases = aliases.map((alias) => normalizeMetricName(alias)).filter(Boolean);
  const normalizedExcludes = excludeAliases.map((alias) => normalizeMetricName(alias)).filter(Boolean);
  return (Array.isArray(biometrics) ? biometrics : []).find((entry) => {
    const normalizedLabel = normalizeMetricName(entry?.label);
    if (!normalizedLabel) return false;
    if (normalizedExcludes.some((exclude) => normalizedLabel.includes(exclude))) return false;
    return normalizedAliases.some((alias) => normalizedLabel.includes(alias));
  }) || null;
}

function buildCanonicalMetricLabel(baseLabel, rawValue, includeRawValue = true) {
  const compactRaw = compactString(rawValue || '');
  if (!includeRawValue || !compactRaw) return baseLabel;
  return `${baseLabel} (${compactRaw})`;
}

function metricDisplayValueFromScore(score, fallback = '') {
  return Number.isFinite(Number(score)) ? `${Math.round(Number(score))}/100` : compactString(fallback || '');
}

const OPENROUTER_CANONICAL_FRONT_METRIC_SPECS = [
  { label: 'fWHR', rawAliases: ['fwhr'] },
  { label: 'Bigonial Width', rawAliases: ['bigonial width index', 'bigonial width'] },
  { label: 'Upper Third', rawAliases: ['upper third length'] },
  { label: 'Middle Third', rawAliases: ['middle third length'] },
  { label: 'Lower Third', rawAliases: ['lower third length'] },
  { label: 'Midface Ratio', rawAliases: ['midface ratio'] },
  { label: 'Chin Support (Visual)', aliases: ['chin support', 'chin support projection', 'chin projection'], categoryKey: 'Bone', includeRawValue: false, preferExistingScore: true },
  { label: 'IPD Index', rawAliases: ['ipd index geometric', 'ipd index'] },
  { label: 'Brow Compactness', rawAliases: ['brow compactness index'] },
  { label: 'Canthal Tilt', rawAliases: ['canthal tilt degrees', 'canthal tilt'] },
  { label: 'Eye Shape (Visual)', aliases: ['eye shape', 'uee', 'upper eyelid exposure', 'eyelid exposure', 'eye area', 'scleral show'], categoryKey: 'Eye Depth', includeRawValue: false, preferExistingScore: true },
  { label: 'Eye Width', aliases: ['eye width'], excludeAliases: ['index'], categoryKey: 'Eye Depth', rawAliases: ['eye width index horizontal'], preferExistingScore: true },
  { label: 'Eye Width Index (Horizontal)', rawAliases: ['eye width index horizontal'] },
  { label: 'Nose Width Index', rawAliases: ['nose width index'] },
  { label: 'Nose Bridge Definition (Visual)', aliases: ['nose bridge definition', 'nose bridge', 'nasal bridge', 'bridge definition', 'dorsum definition'], includeRawValue: false, preferExistingScore: true, requireExisting: true },
  { label: 'Philtrum Height', rawAliases: ['philtrum height index'] },
  { label: 'Mouth Width', rawAliases: ['mouth width index'] },
  { label: 'Total Lip Height Index', rawAliases: ['total lip height index'] },
  { label: 'Skin Texture (Visual)', aliases: ['skin texture', 'skin clarity'], categoryKey: 'Skin', includeRawValue: false, preferExistingScore: true },
  { label: 'Facial Fat (Visual)', aliases: ['facial fat', 'soft tissue definition', 'soft tissue fullness', 'soft tissue'], categoryKey: 'Facial Fat', includeRawValue: false, preferExistingScore: true },
  { label: 'Symmetry (Visual)', aliases: ['facial symmetry', 'symmetry'], categoryKey: 'Symmetry', includeRawValue: false, preferExistingScore: true },
  { label: 'Maxillary Projection (Visual)', aliases: ['maxillary projection', 'cheekbone projection', 'cheekbone prominence', 'maxillary', 'cheekbone'], categoryKey: 'Maxillary/Cheekbone Projection', includeRawValue: false, preferExistingScore: true },
  { label: 'Neck Width (Visual)', aliases: ['neck width', 'neck thickness', 'thin neck'], categoryKey: 'Dimorphism', includeRawValue: false, preferExistingScore: true },
];

function buildCanonicalOpenRouterFrontBiometrics({ biometrics, rawValues, categories, rawOutput }) {
  const canonical = [];
  for (const spec of OPENROUTER_CANONICAL_FRONT_METRIC_SPECS) {
    const lookupAliases = [
      ...(Array.isArray(spec.aliases) ? spec.aliases : []),
      ...(Array.isArray(spec.rawAliases) ? spec.rawAliases : []),
      spec.label,
    ];
    const existing = findBiometricEntryByAliases(biometrics, lookupAliases, spec.excludeAliases || []);
    if (spec.requireExisting && !existing) continue;
    const { rawLabel, rawValue } = findRawMetricEntry(rawValues, spec.rawAliases || []);
    const deterministicScore = rawLabel && rawValue !== undefined
      ? deterministicBiometricScore(rawLabel, rawValue, rawOutput)
      : null;
    const existingScore = Number(existing?.score);
    const categoryScore = spec.categoryKey ? Number(categories?.[spec.categoryKey]) : null;
    let score = spec.preferExistingScore
      ? firstFiniteNumber(existingScore, categoryScore, deterministicScore)
      : firstFiniteNumber(deterministicScore, existingScore, categoryScore);
    if (spec.includeRawValue === false) {
      score = softenVisualMetricScore(spec.label, score, existing?.note || existing?.description || '', categoryScore);
    }
    const label = buildCanonicalMetricLabel(
      spec.label,
      rawValue,
      spec.includeRawValue !== false
    );
    if ((!label || label === spec.label) && !Number.isFinite(score) && !existing && (rawValue === undefined || rawValue === null || rawValue === '')) {
      continue;
    }
    canonical.push({
      label,
      displayValue: metricDisplayValueFromScore(score, rawValue),
      score: Number.isFinite(Number(score)) ? Number(score) : null,
      impact: compactString(existing?.impact || ''),
      note: compactString(existing?.note || ''),
    });
  }
  return canonical;
}

function categoryAverage(categories, keys) {
  if (!categories || typeof categories !== 'object') return null;
  const values = keys
    .map((key) => Number(categories[key]))
    .filter((value) => Number.isFinite(value));
  return average(values);
}

function hasSeverePremium2Limiter(text) {
  const normalized = String(text || '')
    .replace(/\bno\s+(?:severe|major|clear|obvious)\s+(?:uncanny\s+)?cues?\b/gi, '')
    .replace(/\bno\s+(?:severe|major|clear|obvious)\s+(?:real\s+)?(?:facial\s+)?(?:bottlenecks?|flaws?|limitations?|issues?)\b/gi, '')
    .replace(/\bnot\s+(?:uncanny|synthetic)\b/gi, '');
  return /\b(?:severe|major|very weak|clearly weak|poor harmony|weak harmony|poor skin|visible aging|aged|skin laxity|nasolabial|major asymmetry|very asymmetric|puffy|bloated|high[-\s]?fat|recessed chin|weak chin|weak lower third|merely average|common read|average\/common|below average|low-tier|uncanny|synthetic)\b/i.test(normalized);
}

function rawMetricNumber(rawValues, aliases = []) {
  const entries = Object.entries(rawValues || {});
  for (const alias of aliases) {
    const normalizedAlias = normalizeMetricName(alias);
    const match = entries.find(([label]) => normalizeMetricName(label).includes(normalizedAlias));
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function correctPremium2JsonRating({ rawOutput, finalRating, data, categories, biometrics, rawValues, debugJustification }) {
  const rating = Number(finalRating);
  if (!isPremium2Output(rawOutput) || !Number.isFinite(rating)) {
    return finalRating;
  }

  const text = [
    data?.visualBucket,
    data?.facialFatDefinitionRead,
    data?.tier,
    data?.technicalSummary,
    data?.appealAssessment,
    data?.personalizedInterpretation,
    data?.mainLimitingFactor,
    debugJustification,
    ...(Array.isArray(data?.bestFeatures) ? data.bestFeatures.map((entry) => `${entry?.title || ''} ${entry?.description || ''}`) : []),
    ...(Array.isArray(data?.primaryFlaws) ? data.primaryFlaws.map((entry) => `${entry?.title || ''} ${entry?.description || ''}`) : []),
    ...(Array.isArray(data?.qualityFlags) ? data.qualityFlags : []),
    ...(Array.isArray(data?.confidenceFlags) ? data.confidenceFlags : []),
  ].filter(Boolean).join('\n');

  const eyeHeightIndex = rawMetricNumber(rawValues, ['Eye Height Index']);
  const upperThirdLength = rawMetricNumber(rawValues, ['Upper Third Length']);
  const midfaceRatio = rawMetricNumber(rawValues, ['Midface Ratio']);
  const philtrumHeight = rawMetricNumber(rawValues, ['Philtrum Height Index']);
  const mouthWidth = rawMetricNumber(rawValues, ['Mouth Width Index']);
  const fwhRatio = rawMetricNumber(rawValues, ['fWHR']);
  const noseWidth = rawMetricNumber(rawValues, ['Nose Width Index']);
  const ipdIndex = rawMetricNumber(rawValues, ['IPD Index']);
  const bigonialWidth = rawMetricNumber(rawValues, ['Bigonial Width Index']);
  const eyeDepthScore = Number(categories?.['Eye Depth']);
  const harmonyScore = Number(categories?.Harmony);
  const skinScore = Number(categories?.Skin);
  const eyeShapeMetric = findBiometricEntryByAliases(
    biometrics,
    ['eye shape', 'uee', 'upper eyelid exposure', 'eyelid exposure', 'scleral show', 'eye area'],
    ['eye width']
  );
  const eyeWidthMetric = findBiometricEntryByAliases(
    biometrics,
    ['eye width', 'horizontal eye width'],
    ['index']
  );
  const canthalTiltMetric = findBiometricEntryByAliases(
    biometrics,
    ['canthal tilt', 'canthal tilt degrees'],
    []
  );
  const philtrumMetric = findBiometricEntryByAliases(
    biometrics,
    ['philtrum height', 'philtrum height index', 'philtrum'],
    []
  );
  const noseBridgeMetric = findBiometricEntryByAliases(
    biometrics,
    ['nose bridge definition', 'nose bridge', 'nasal bridge', 'bridge definition', 'dorsum definition'],
    []
  );
  const eyeShapeScore = Number(eyeShapeMetric?.score);
  const eyeWidthScore = Number(eyeWidthMetric?.score);
  const canthalTiltScore = Number(canthalTiltMetric?.score);
  const philtrumScore = Number(philtrumMetric?.score);
  const hasSevereExposureText =
    /\b(?:significant|obvious|clear|marked|high|excessive|major|severe)\s+(?:upper\s+eyelid\s+exposure|uee|eyelid\s+exposure|lower\s+scleral\s+show|scleral\s+show)\b/i.test(text) ||
    /\b(?:upper\s+eyelid\s+exposure|uee|eyelid\s+exposure|lower\s+scleral\s+show|scleral\s+show)\b[^.\n]{0,90}\b(?:significant|obvious|clear|marked|high|excessive|major|severe|startled|exposed|round|vertically\s+tall)\b/i.test(text);
  const hasRoundExposedEyeRead =
    /\b(?:round(?:er|ness)?|vertically\s+tall|wide[-\s]?open|startled|exposed|bug[-\s]?eyed)\b[^.\n]{0,90}\b(?:eye|eyes|gaze|orbital|eyelid)\b/i.test(text) ||
    /\b(?:eye|eyes|gaze|orbital|eyelid)\b[^.\n]{0,90}\b(?:round(?:er|ness)?|vertically\s+tall|wide[-\s]?open|startled|exposed|bug[-\s]?eyed)\b/i.test(text);
  const hasLowerScleralShowText = /\blower\s+scleral\s+show\b/i.test(text);
  const hasSevereEyeBottleneckLanguage = /\b(?:severe|major|primary)\b[^.\n]{0,80}\b(?:eye|eyes|gaze|orbital|scleral|eyelid|uee)\b/i.test(text) ||
    /\b(?:eye|eyes|gaze|orbital|scleral|eyelid|uee)\b[^.\n]{0,80}\b(?:severe|major|primary|bottleneck|overrides?|60s[-\s]?level)\b/i.test(text);
  const measuredEyeShapeProblem = Number.isFinite(eyeHeightIndex) && eyeHeightIndex >= 0.082;
  const borderlineMeasuredEyeShapeProblem = Number.isFinite(eyeHeightIndex) && eyeHeightIndex >= 0.08;
  const weakEyeScore =
    (Number.isFinite(eyeDepthScore) && eyeDepthScore <= 68) ||
    (Number.isFinite(eyeShapeScore) && eyeShapeScore <= 60);
  const harmonyAlreadyLimited = Number.isFinite(harmonyScore) && harmonyScore <= 74;
  const hasLongUpperThirdText = /\b(?:long|elongated|disproportionately\s+long|significantly\s+long)\s+upper\s+third\b/i.test(text) ||
    /\bupper\s+third\b[^.\n]{0,90}\b(?:long|elongated|disproportionate|throws?\s+off|vertical\s+proportion)/i.test(text);
  const hasStackedVerticalProportionText =
    /\b(?:elongated|slightly\s+elongated|long)\s+midface\b/i.test(text) &&
    /\blong(?:er)?\s+philtrum\b/i.test(text);
  const hasSkinTextureLimiterText = /\b(?:skin\s+texture|blemishes|uneven\s+tone|minor\s+scarring)\b/i.test(text);
  const stackedLowMid50sPattern =
    Number.isFinite(upperThirdLength) &&
    upperThirdLength >= 0.56 &&
    Number.isFinite(philtrumHeight) &&
    philtrumHeight >= 0.12 &&
    Number.isFinite(eyeHeightIndex) &&
    eyeHeightIndex >= 0.078 &&
    (Number.isFinite(midfaceRatio) ? midfaceRatio >= 1.07 : hasStackedVerticalProportionText) &&
    (
      (Number.isFinite(mouthWidth) && mouthWidth <= 0.35) ||
      (Number.isFinite(fwhRatio) && fwhRatio <= 1.65)
    ) &&
    (
      (Number.isFinite(skinScore) && skinScore <= 58) ||
      hasSkinTextureLimiterText
    ) &&
    hasLongUpperThirdText &&
    hasStackedVerticalProportionText;
  const hasAfricanMaleNasalContext =
    /\b(?:african|sub[-\s]?saharan|black)\b/i.test(text) ||
    (/\bhigh[-\s]?fashion phenotype|striking|stylized\b/i.test(text) &&
      /\bprominent cheekbones?|cheekbone definition|lean definition\b/i.test(text));
  const hasNasalBridgePraise = /\b(?:strong|pronounced|defined|clear|structured)\s+(?:nose|nasal)\s+bridge\b/i.test(text) ||
    /\b(?:nose|nasal)\s+bridge\b[^.\n]{0,60}\b(?:strong|pronounced|defined|clear|structured)\b/i.test(text);
  const hasModerateOrLimitedNoseBridge = /\b(?:nose|nasal)\s+bridge\b[^.\n]{0,100}\b(?:moderate|lacks?|not\s+flat|not\s+overly\s+flat|not\s+sharp|not\s+pronounced|not\s+strong|limits?|limited|refinement)\b/i.test(text) ||
    /\b(?:moderate|lacks?|not\s+sharp|not\s+pronounced|not\s+strong|limited)\b[^.\n]{0,80}\b(?:nose|nasal)\s+bridge\b/i.test(text);
  const hasWeakOrMissingNoseBridge =
    hasModerateOrLimitedNoseBridge ||
    (!hasNasalBridgePraise &&
      (!noseBridgeMetric || !Number.isFinite(Number(noseBridgeMetric.score)) || Number(noseBridgeMetric.score) <= 68));
  const africanMaleNasalBridgeLow60sPattern =
    hasAfricanMaleNasalContext &&
    hasWeakOrMissingNoseBridge &&
    Number.isFinite(noseWidth) &&
    noseWidth >= 0.255 &&
    Number.isFinite(ipdIndex) &&
    ipdIndex >= 0.5 &&
    Number.isFinite(fwhRatio) &&
    fwhRatio <= 1.7 &&
    Number.isFinite(bigonialWidth) &&
    bigonialWidth <= 0.89 &&
    Number.isFinite(philtrumHeight) &&
    philtrumHeight >= 0.118 &&
    (
      /\b(?:narrow(?:er)?\s+(?:jaw|bigonial|fWHR)|tapered\s+(?:jaw|lower third)|wide[-\s]?set eyes|wide IPD)\b/i.test(text) ||
      (Number.isFinite(mouthWidth) && mouthWidth >= 0.385)
    );
  const hasEastAsianUpliftContext = /\b(?:east\s+asian|korean|japanese|chinese|soft(?:er)?\s+youthful\s+east\s+asian)\b/i.test(text);
  const hasNonEastAsianContext = /\b(?:south\s+asian|middle\s+eastern|african|sub[-\s]?saharan|black|caucasian|european|latino|hispanic)\b/i.test(text);
  const hasProtectedAsianCalibrationMetrics =
    Number.isFinite(philtrumHeight) &&
    philtrumHeight <= 0.085 &&
    Number.isFinite(noseWidth) &&
    noseWidth <= 0.225 &&
    Number.isFinite(fwhRatio) &&
    fwhRatio >= 1.68 &&
    Number.isFinite(midfaceRatio) &&
    midfaceRatio <= 0.95 &&
    Number.isFinite(bigonialWidth) &&
    bigonialWidth >= 0.89 &&
    Number.isFinite(ipdIndex) &&
    ipdIndex >= 0.455 &&
    ipdIndex <= 0.48;
  const allowPremium2Low60sUplift =
    hasEastAsianUpliftContext ||
    (hasProtectedAsianCalibrationMetrics && !hasNonEastAsianContext);

  if (rating >= 60 && rating <= 64) {
    if (stackedLowMid50sPattern) {
      return Math.min(rating, 54);
    }

    if (hasSeverePremium2Limiter(text)) return finalRating;

    const positiveMetricCount = (Array.isArray(biometrics) ? biometrics : [])
      .filter((entry) => Number(entry?.score) >= 68).length;
    const lowMetricCount = (Array.isArray(biometrics) ? biometrics : [])
      .filter((entry) => Number(entry?.score) < 55).length;
    const coreAverage = categoryAverage(categories, ['Harmony', 'Bone', 'Symmetry', 'Skin', 'Facial Fat']);
    const hasAttractiveLanguage = /\b(?:natural\/coherent high-tier|high-tier|solid foundation|solid base|decent jaw|good jaw|good eye spacing|positive canthal|clear skin|youthful|harmonious|pleasant|attractive)\b/i.test(text);
    const onlyMildLimiters = /\b(?:slight|slightly|mild|moderate|average|maxillary projection|brow compactness|narrow eye|eye width|presentation|grooming|hair|phone obstruction|lighting|not elite|higher tier|elite)\b/i.test(text);

    if (
      hasAttractiveLanguage &&
      onlyMildLimiters &&
      allowPremium2Low60sUplift &&
      positiveMetricCount >= 5 &&
      lowMetricCount <= 1 &&
      (coreAverage == null || coreAverage >= 60)
    ) {
      return Math.max(rating, 71);
    }

    return finalRating;
  }

  if (
    rating >= 66 &&
    africanMaleNasalBridgeLow60sPattern
  ) {
    return Math.min(rating, 62);
  }

  if (
    rating >= 66 &&
    hasSevereExposureText &&
    (hasRoundExposedEyeRead || measuredEyeShapeProblem) &&
    (weakEyeScore || harmonyAlreadyLimited)
  ) {
    const severeMeasuredEyeBottleneck =
      measuredEyeShapeProblem &&
      hasRoundExposedEyeRead &&
      Number.isFinite(eyeShapeScore) &&
      eyeShapeScore <= 55 &&
      Number.isFinite(eyeDepthScore) &&
      eyeDepthScore <= 66;
    const similarMeasuredEyeBottleneck =
      borderlineMeasuredEyeShapeProblem &&
      hasSevereExposureText &&
      hasRoundExposedEyeRead &&
      (hasLowerScleralShowText || hasSevereEyeBottleneckLanguage) &&
      ((Number.isFinite(eyeShapeScore) && eyeShapeScore <= 60) ||
        (Number.isFinite(eyeDepthScore) && eyeDepthScore <= 68));
    return Math.min(rating, severeMeasuredEyeBottleneck ? 62 : similarMeasuredEyeBottleneck ? 64 : 68);
  }

  if (rating >= 80) {
    const highScoreEyeLimiters = [
      /\b(?:upper\s+eyelid\s+exposure|uee|eyelid\s+exposure)\b/i.test(text),
      /\b(?:narrow(?:er)?\s+eye|eye\s+width|horizontally\s+narrow|smaller\s+eyes?)\b/i.test(text),
      Number.isFinite(eyeShapeScore) && eyeShapeScore <= 72,
      Number.isFinite(eyeWidthScore) && eyeWidthScore <= 70,
      Number.isFinite(canthalTiltScore) && canthalTiltScore <= 76,
      Number.isFinite(eyeDepthScore) && eyeDepthScore <= 75,
    ].filter(Boolean).length;
    const highScoreSecondaryLimiters = [
      /\b(?:long(?:er)?\s+philtrum|philtrum\b[^.\n]{0,80}\b(?:long|slightly|mild|limiting|deviation))\b/i.test(text),
      /\b(?:skin\s+texture|freckling|minor\s+texture|blemish|uneven\s+tone)\b/i.test(text) || (Number.isFinite(skinScore) && skinScore <= 80),
      /\b(?:neck\s+framing|moderate\s+neck|neck\s+width)\b/i.test(text),
      /\b(?:minor|slight|slightly|mild)\b[^.\n]{0,80}\b(?:flaw|limitation|deviation|texture|exposure|narrow|philtrum)\b/i.test(text),
      Number.isFinite(philtrumScore) && philtrumScore <= 74,
    ].filter(Boolean).length;
    const hasEliteOverreachLanguage =
      /\b(?:elite natural|elite placement|elite score|absolute elite|top tier|top-tier)\b/i.test(text);
    const lacksEliteEyeArea =
      highScoreEyeLimiters >= 3 &&
      (
        (Number.isFinite(eyeShapeScore) && eyeShapeScore <= 72) ||
        (Number.isFinite(eyeWidthScore) && eyeWidthScore <= 70) ||
        (Number.isFinite(eyeDepthScore) && eyeDepthScore <= 75)
      );

    if (
      hasEliteOverreachLanguage &&
      lacksEliteEyeArea &&
      highScoreSecondaryLimiters >= 3
    ) {
      return Math.min(rating, 73);
    }
  }

  if (rating >= 73 && rating <= 76) {
    const hasLowerFaceLimiters = /\b(?:long(?:er|ated)?\s+philtrum|philtrum|narrow mouth|mouth width|thin(?:ner)? lips?|lower[-\s]?third balance)\b/i.test(text);
    const hasEyeLimiters = /\b(?:upper eyelid exposure|uee|narrow eye|eye width|eye area|gaze intensity)\b/i.test(text);
    const hasPresentationLimiters = /\b(?:grooming|unkempt|presentation|mirror selfie|phone|obstruct|angle)\b/i.test(text);
    const hasStrongButNotEliteRead = /\b(?:strong 70s|solidly in the 70s|capped from the 80s|not elite|higher score|higher tier)\b/i.test(text);
    if (hasLowerFaceLimiters && hasEyeLimiters && hasPresentationLimiters && hasStrongButNotEliteRead) {
      return Math.round(clamp(rating - 5, 0, 100) * 10) / 10;
    }
  }

  return finalRating;
}

function normalizeScoreMap(map, applyOffset = true) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    if (value == null || value === 'N/A' || Number.isNaN(Number(value))) {
      out[key] = null;
    } else {
      out[key] = applyOffset ? applyOffset100(Number(value)) : Number(value);
    }
  }
  return Object.keys(out).length ? out : null;
}

function scoreNumber(value) {
  if (value == null) return null;
  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const score = Number(match[0]);
  return Number.isFinite(score) ? score : null;
}

function splitPipeScore(value, side = false) {
  const parts = String(value ?? '').split('|');
  const selected = side ? (parts[1] ?? parts[0]) : parts[0];
  if (/N\/A/i.test(selected || '')) return null;
  return scoreNumber(selected);
}

function normalizeDualScoreMap(map, side = false) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    const score = splitPipeScore(value, side);
    out[key.replace(/_/g, '/')] = Number.isFinite(score) ? score : null;
  }
  return Object.keys(out).length ? out : null;
}

function featureStringsToEntries(items, start = 0, limit = 5) {
  if (!Array.isArray(items)) return [];
  return items.slice(start, start + limit).map((item) => {
    const text = compactString(item);
    if (!text) return null;
    const [titlePart, ...descriptionParts] = text.split(/\s+-\s+/);
    const title = compactString(titlePart || text).slice(0, 80);
    const description = compactString(descriptionParts.join(' - ') || text).slice(0, 280);
    return title ? { title, description } : null;
  }).filter(Boolean);
}

function normalizeLegacyJsonDashboard(data) {
  if (!data || typeof data !== 'object') return data;
  if (!data.ANALYSIS && !data.DASHBOARD_DATA && !data.RATINGS) return data;

  const analysis = data.ANALYSIS || {};
  const dashboard = data.DASHBOARD_DATA || {};
  const ratings = data.RATINGS || {};
  const coreScores = analysis.CORE_CATEGORY_SCORES || {};
  const critical = analysis.CRITICAL_MARKERS || {};
  const best = Array.isArray(dashboard.BEST_FEATURES) ? dashboard.BEST_FEATURES : [];
  const flaws = Array.isArray(dashboard.PRIMARY_FLAWS) ? dashboard.PRIMARY_FLAWS : [];
  const biometrics = Object.entries(ratings).map(([name, score]) => ({
    name: titleCaseKey(name),
    score: scoreNumber(score),
  }));
  const protocols = Array.isArray(data.ACTIONABLE_PROTOCOLS)
    ? data.ACTIONABLE_PROTOCOLS.map((item, index) => {
        const text = compactString(item);
        const match = text.match(/^\s*(?:\d+\.\s*)?([^:]+):\s*(.+)$/);
        const name = compactString(match?.[1] || `Protocol ${index + 1}`);
        const rest = compactString(match?.[2] || text);
        return {
          name,
          description: rest || name,
          impact: normalizeImpactLabel(rest),
        };
      })
    : [];

  const bestFeatures = featureStringsToEntries(best, 0, 5);
  if (!bestFeatures.length && critical.BEST_FEATURE) {
    bestFeatures.push(...jsonFeatureArray([critical.BEST_FEATURE], 1));
  }
  const primaryFlaws = featureStringsToEntries(flaws, 0, 5);
  if (!primaryFlaws.length && critical.WORST_FEATURE) {
    primaryFlaws.push(...jsonFeatureArray([critical.WORST_FEATURE], 1));
  }

  return {
    sex: analysis.SEX,
    finalRating: scoreNumber(analysis.Final_Frontal_Rating),
    sideRating: scoreNumber(analysis.Final_Side_Rating),
    maxNaturalPotential: scoreNumber(analysis.Max_Natural_Potential),
    maxPotentialWithSurgery: scoreNumber(analysis.Max_Potential_with_Surgery),
    technicalSummary: analysis.Technical_Summary,
    appealAssessment: analysis.Appeal_Assessment,
    debugJustification: data.JUSTIFICATION,
    bestFeatures,
    primaryFlaws,
    sideBestFeatures: featureStringsToEntries(best, 5, 5),
    sidePrimaryFlaws: featureStringsToEntries(flaws, 5, 5),
    categories: normalizeDualScoreMap(coreScores, false),
    sideCategories: normalizeDualScoreMap(coreScores, true),
    hexagonFront: analysis.Hexagon_Chart_Ratings_front,
    hexagonSide: analysis.Hexagon_Chart_Ratings_side,
    personalizedFeedback: data.Personalised_feedback || data.Personalized_feedback,
    protocols,
    keyRatios: biometrics,
  };
}

function firstAliasValue(data, aliases = []) {
  if (!data || typeof data !== 'object') return undefined;
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(data, alias) && data[alias] !== undefined && data[alias] !== null && data[alias] !== '') {
      return data[alias];
    }
  }
  return undefined;
}

const FLEXIBLE_JSON_ALIAS_MAP = {
  finalRating: ['finalRating', 'final_rating', 'finalScore', 'final_score', 'overallScore', 'overall_score', 'frontalRating', 'frontal_rating', 'frontRating', 'front_rating', 'rating'],
  sideRating: ['sideRating', 'side_rating', 'profileRating', 'profile_rating'],
  maxNaturalPotential: ['maxNaturalPotential', 'max_natural_potential', 'naturalPotential', 'natural_potential'],
  maxPotentialWithSurgery: ['maxPotentialWithSurgery', 'max_potential_with_surgery', 'surgeryPotential', 'surgery_potential'],
  technicalSummary: ['technicalSummary', 'technical_summary', 'structuralOverview', 'structural_overview', 'summary'],
  appealAssessment: ['appealAssessment', 'appeal_assessment', 'personalizedInterpretation', 'personalized_interpretation', 'interpretation'],
  debugJustification: ['debugJustification', 'debug_justification', 'reportDebugJustification', 'report_debug_justification', 'justification'],
  bestFeatures: ['bestFeatures', 'best_features', 'strongestFeatures', 'strongest_features', 'pros'],
  primaryFlaws: ['primaryFlaws', 'primary_flaws', 'weakestFeatures', 'weakest_features', 'cons'],
  sideBestFeatures: ['sideBestFeatures', 'side_best_features'],
  sidePrimaryFlaws: ['sidePrimaryFlaws', 'side_primary_flaws'],
  personalizedFeedback: ['personalizedFeedback', 'personalized_feedback', 'personalisedFeedback', 'personalised_feedback'],
  keyRatios: ['keyRatios', 'key_ratios', 'metrics', 'facialMetrics', 'facial_metrics', 'ratios', 'biometrics'],
  sideKeyRatios: ['sideKeyRatios', 'side_key_ratios', 'sideMetrics', 'side_metrics', 'sideBiometrics', 'side_biometrics'],
  categories: ['categories', 'categorySignalRatings', 'category_signal_ratings', 'coreCategoryScores', 'core_category_scores'],
  sideCategories: ['sideCategories', 'side_categories', 'sideCategorySignalRatings', 'side_category_signal_ratings'],
  hexagonFront: ['hexagonFront', 'hexagon_front', 'hexagonChartFront', 'hexagon_chart_front'],
  hexagonSide: ['hexagonSide', 'hexagon_side', 'hexagonChartSide', 'hexagon_chart_side'],
  authenticityFlag: ['authenticityFlag', 'authenticity_flag'],
  uncannyFlag: ['uncannyFlag', 'uncanny_flag'],
};

function extractPartialFlexibleJsonDashboard(rawOutput) {
  const partial = {};
  for (const [target, aliases] of Object.entries(FLEXIBLE_JSON_ALIAS_MAP)) {
    const safeAliases = target === 'finalRating'
      ? aliases.filter((alias) => alias !== 'rating')
      : aliases;
    const value = parseJsonValueByAliases(rawOutput, safeAliases);
    if (value !== undefined) partial[target] = value;
  }
  for (const key of ['sex', 'tier', 'visualBucket', 'facialFatDefinitionRead']) {
    const value = parseJsonValueAfterKey(rawOutput, key);
    if (value !== undefined) partial[key] = value;
  }

  const hasUsefulField =
    partial.finalRating !== undefined ||
    partial.technicalSummary !== undefined ||
    partial.appealAssessment !== undefined ||
    Array.isArray(partial.keyRatios) ||
    Array.isArray(partial.bestFeatures) ||
    Array.isArray(partial.primaryFlaws);
  return hasUsefulField ? partial : null;
}

function normalizeFlexibleJsonDashboard(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const out = { ...data };

  for (const [target, aliases] of Object.entries(FLEXIBLE_JSON_ALIAS_MAP)) {
    if (out[target] !== undefined && out[target] !== null && out[target] !== '') continue;
    const value = firstAliasValue(data, aliases);
    if (value !== undefined) out[target] = value;
  }

  return out;
}

function isGemini31ProOutput(rawOutput) {
  return /\[Using:\s*(?:Gemini\s+3\.1\s+Pro|Expert\s+Mode\s*\(Very\s+Accurate\)|penis\s+goat|PENIS\s+GOAT\s+2|PENIS\s+GOAT\s+3)(?=\s|\|)/i.test(String(rawOutput || ''));
}

function buildGeminiJsonScoreCalibration(rawOutput, backendDir, rawFinalRating) {
  if (!isGemini31ProOutput(rawOutput) || !Number.isFinite(Number(rawFinalRating)) || !backendDir) return null;
  const rawValues = readMogReportRawValues(rawOutput, backendDir);
  const metrics = extractCalibrationMetrics(rawValues);
  const calibration = computeBenchmarkCalibrationAnalysis(metrics, Number(rawFinalRating));
  if (!calibration || !Number.isFinite(Number(calibration.rating))) return null;

  const modelRating = Number(rawFinalRating);
  const benchmarkRating = Number(calibration.rating);
  if (benchmarkRating >= modelRating) {
    return { adjustedRating: modelRating, calibration, applied: false };
  }

  const confidence = Number(calibration.confidence) || 0;
  const isAnchorBand = modelRating >= 66 && modelRating <= 69;
  const weight = isAnchorBand ? clamp(0.62 + confidence * 0.22, 0.62, 0.82) : clamp(0.35 + confidence * 0.25, 0.35, 0.65);
  const adjustedRating = Math.round((modelRating * (1 - weight) + benchmarkRating * weight) * 10) / 10;
  return {
    adjustedRating: Math.min(modelRating, adjustedRating),
    calibration,
    applied: true,
  };
}

function parseExperimentalJsonOutput(rawOutput, backendDir) {
  const candidates = extractJsonObjects(rawOutput)
    .filter((obj) => obj && typeof obj === 'object')
    .map((obj) => normalizeFlexibleJsonDashboard(normalizeLegacyJsonDashboard(obj)));
  const partialJson = extractPartialFlexibleJsonDashboard(rawOutput);
  if (partialJson) {
    candidates.push(normalizeFlexibleJsonDashboard(partialJson));
  }
  const data = candidates.find((obj) =>
    Object.prototype.hasOwnProperty.call(obj, 'finalRating') ||
    Array.isArray(obj.personalizedFeedback) ||
    Array.isArray(obj.protocols)
  );
  if (!data) return null;

  const rawFinalRating = data.finalRating == null || Number.isNaN(Number(data.finalRating))
    ? null
    : Number(data.finalRating);
  const geminiScoreCalibration = buildGeminiJsonScoreCalibration(rawOutput, backendDir, rawFinalRating);
  const calibratedRawFinalRating = geminiScoreCalibration?.adjustedRating ?? rawFinalRating;
  let finalRating = calibratedRawFinalRating == null || Number.isNaN(Number(calibratedRawFinalRating))
    ? null
    : capToplineRating(applyOffset100(Number(calibratedRawFinalRating)));
  const sideRating = data.sideRating == null || data.sideRating === 'N/A' || Number.isNaN(Number(data.sideRating))
    ? null
    : capToplineRating(applyOffset100(Number(data.sideRating)));
  const maxNaturalPotential = data.maxNaturalPotential == null || Number.isNaN(Number(data.maxNaturalPotential))
    ? null
    : capToplineRating(applyOffset100(Number(data.maxNaturalPotential)));
  const maxPotentialWithSurgery = data.maxPotentialWithSurgery == null || Number.isNaN(Number(data.maxPotentialWithSurgery))
    ? null
    : capToplineRating(applyOffset100(Number(data.maxPotentialWithSurgery)));
  const personalizedFeedback = jsonFeatureArray(data.personalizedFeedback, 5);
  const protocols = Array.isArray(data.protocols)
    ? data.protocols.map((item, index) => {
        if (!item || typeof item !== 'object') return null;
        const name = compactString(item.name || item.title || `Protocol ${index + 1}`).slice(0, 90);
        const description = compactString(item.description || item.body || item.text).slice(0, 320);
        if (!name || !description) return null;
        return {
          id: index + 1,
          name,
          description,
          impact: normalizeImpactLabel(item.impact),
          research: item.research ? compactString(item.research).slice(0, 180) : null,
        };
      }).filter(Boolean).slice(0, 25)
    : [];
  const bestFeatures = jsonFeatureArray(data.bestFeatures || data.strongestFeatures || data.pros, 5);
  const primaryFlaws = jsonFeatureArray(data.primaryFlaws || data.weakestFeatures || data.cons, 5);
  const normalizedCategories = normalizeScoreMap(data.categories);
  const normalizedSideCategories = normalizeScoreMap(data.sideCategories);
  let biometrics = jsonBiometricArray(data.keyRatios || data.metrics || data.facialMetrics || data.ratios || data.biometrics, 24, rawOutput);
  const rawValues = readMogReportRawValues(rawOutput, backendDir);
  for (const rawLabel of ['Eye Width Index (Horizontal)', 'Total Lip Height Index']) {
    const hasMetricAlready = biometrics.some((entry) => normalizeMetricName(entry?.label).includes(normalizeMetricName(rawLabel)));
    const rawValue = rawValues[rawLabel];
    if (hasMetricAlready || rawValue === undefined) continue;
    const score = deterministicBiometricScore(rawLabel, rawValue, rawOutput);
    biometrics.push({
      label: `${rawLabel} (${rawValue})`,
      displayValue: Number.isFinite(score) ? `${Math.round(score)}/100` : compactString(rawValue),
      score: Number.isFinite(score) ? score : null,
      impact: '',
      note: '',
    });
  }
  if (isOpenRouterGeminiOutput(rawOutput)) {
    biometrics = buildCanonicalOpenRouterFrontBiometrics({
      biometrics,
      rawValues,
      categories: normalizedCategories,
      rawOutput,
    });
  }
  const technicalSummary = compactString(data.technicalSummary || data.summary || data.mainLimitingFactor, DEFAULT_SUMMARY) || DEFAULT_SUMMARY;
  const interpretation = compactString(data.personalizedInterpretation || data.interpretation || '');
  const appealAssessment = compactString(data.appealAssessment || interpretation || data.tier || data.mainLimitingFactor);
  let debugJustification = compactString(data.debugJustification || data.reportDebugJustification || data.mainLimitingFactor);
  if (geminiScoreCalibration?.applied) {
    const calibration = geminiScoreCalibration.calibration;
    const calibrationNote = `Gemini parser anti-anchor: raw ${rawFinalRating} lowered toward local metric benchmark ${calibration.rating} (nearest ${calibration.nearestFolder || 'benchmark'} target ${calibration.nearestTarget}).`;
    debugJustification = compactString(`${debugJustification} ${calibrationNote}`).slice(0, 1200);
  }
  const premium2CorrectedRating = correctPremium2JsonRating({
    rawOutput,
    finalRating,
    data,
    categories: normalizedCategories,
    biometrics,
    rawValues,
    debugJustification,
  });
  if (premium2CorrectedRating !== finalRating) {
    const direction = Number(premium2CorrectedRating) > Number(finalRating) ? 'raised' : 'lowered';
    const correctionContext = [
      data?.technicalSummary,
      data?.appealAssessment,
      data?.mainLimitingFactor,
      ...(Array.isArray(data?.primaryFlaws) ? data.primaryFlaws.map((entry) => `${entry?.title || ''} ${entry?.description || ''}`) : []),
    ].filter(Boolean).join('\n');
    const exposedEyeCorrection = /(?:upper\s+eyelid\s+exposure|uee|scleral\s+show|round(?:er|ness)?|vertically\s+tall|startled|exposed)/i.test(correctionContext);
    const reason = direction === 'raised'
      ? 'the JSON described an attractive/solid-base face with only mild 80+ blockers, not true 60s-level bottlenecks'
      : Number(premium2CorrectedRating) <= 55
        ? 'the JSON and biometrics described stacked vertical proportion, philtrum, skin, width, and eye-shape bottlenecks consistent with a low-to-mid 50s result'
      : Number(premium2CorrectedRating) <= 62 && /(?:nose|nasal|bridge|wide[-\s]?set|fwhr|bigonial|philtrum|full lips?)/i.test(correctionContext)
        ? 'the JSON and biometrics described an African-male nasal/refinement pattern with broader nasal base, no strong bridge evidence, wide IPD, tapered lower-face width, and long philtrum, consistent with a low-60s result'
      : exposedEyeCorrection && Number(premium2CorrectedRating) <= 62
        ? 'the JSON and biometrics described a severe exposed/round eye-shape bottleneck with high measured eye height that should hold the result in the low 60s'
        : exposedEyeCorrection && Number(premium2CorrectedRating) <= 68
          ? 'the JSON and biometrics described a major exposed/round eye-shape bottleneck that should hold the result below 70'
        : 'the JSON described a strong-but-not-elite 70s face with stacked lower-face, eye-area, and presentation limiters';
    debugJustification = compactString(
      `${debugJustification} Premium 2 parser anti-anchor: raw ${finalRating} was ${direction} to ${premium2CorrectedRating} because ${reason}.`
    ).slice(0, 1200);
    finalRating = premium2CorrectedRating;
  }

  return {
    sex: compactString(data.sex || 'unknown') || null,
    finalRating,
    sideRating,
    maxNaturalPotential,
    maxPotentialWithSurgery,
    authenticityFlag: compactString(data.authenticityFlag || ''),
    uncannyFlag: compactString(data.uncannyFlag || ''),
    technicalSummary,
    appealAssessment,
    debugJustification,
    facialFatRead: null,
    bestFeatures,
    primaryFlaws,
    sideBestFeatures: jsonFeatureArray(data.sideBestFeatures, 5),
    sidePrimaryFlaws: jsonFeatureArray(data.sidePrimaryFlaws, 5),
    categories: normalizedCategories,
    sideCategories: normalizedSideCategories,
    hexagonFront: normalizeScoreMap(data.hexagonFront, false),
    hexagonSide: normalizeScoreMap(data.hexagonSide, false),
    personalizedFeedback,
    biometrics,
    sideBiometrics: jsonBiometricArray(data.sideKeyRatios || data.sideMetrics || data.sideBiometrics, 24, rawOutput),
    protocols,
    hasSubstantiveParse:
      finalRating != null ||
      bestFeatures.length > 0 ||
      primaryFlaws.length > 0 ||
      biometrics.length > 0 ||
      personalizedFeedback.length > 0 ||
      protocols.length > 0,
  };
}

function scoreMapFromBiometrics(biometrics) {
  const map = {};
  for (const item of biometrics || []) {
    if (!item?.label) continue;
    const key = String(item.label).replace(/\s*\([^)]*\)\s*$/, '').trim();
    const score = Number(item.score);
    if (!Number.isFinite(score)) continue;
    map[key] = score;
  }
  return map;
}

function normalizeMetricName(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function extractCalibrationMetrics(rawValues) {
  const metrics = {};
  for (const [label, raw] of Object.entries(rawValues || {})) {
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const normalized = normalizeMetricName(label);

    if (normalized.includes('bigonialwidthindex')) metrics.Bigonial = value;
    else if (normalized.includes('ipdindex')) metrics.IPD = value;
    else if (normalized.includes('mouthwidthindex')) metrics.Mouth = value;
    else if (normalized.includes('nosewidthindex')) metrics.Nose = value;
    else if (normalized.includes('upperthirdlength')) metrics.Upper = value;
    else if (normalized.includes('middlethirdlength')) metrics.Middle = value;
    else if (normalized.includes('lowerthirdlength')) metrics.Lower = value;
    else if (normalized.includes('eyeheightindex')) metrics.Eye = value;
    else if (normalized.includes('browcompactnessindex')) metrics.Brow = value;
    else if (normalized.includes('philtrumheightindex')) metrics.Philtrum = value;
    else if (normalized.includes('totallipheightindex')) metrics.Lip = value;
    else if (normalized.startsWith('fwhr')) metrics.fWHR = value;
    else if (normalized.includes('midfaceratio')) metrics.Midface = value;
    else if (normalized.includes('canthaltiltdegrees')) metrics.Canthal = value;
  }
  return metrics;
}

function metricLabelToBenchmarkKey(label) {
  const normalized = normalizeMetricName(label);
  if (normalized.includes('bigonialwidthindex')) return 'Bigonial';
  if (normalized.includes('ipdindex')) return 'IPD';
  if (normalized.includes('mouthwidthindex')) return 'Mouth';
  if (normalized.includes('nosewidthindex')) return 'Nose';
  if (normalized.includes('upperthirdlength')) return 'Upper';
  if (normalized.includes('middlethirdlength')) return 'Middle';
  if (normalized.includes('lowerthirdlength')) return 'Lower';
  if (normalized.includes('eyeheightindex')) return 'Eye';
  if (normalized.includes('browcompactnessindex')) return 'Brow';
  if (normalized.includes('philtrumheightindex')) return 'Philtrum';
  if (normalized.includes('totallipheightindex')) return 'Lip';
  if (normalized.startsWith('fwhr')) return 'fWHR';
  if (normalized.includes('midfaceratio')) return 'Midface';
  if (normalized.includes('canthaltiltdegrees')) return 'Canthal';
  return null;
}

function computeMetricBenchmarkScore(metricKey, rawValue, fallbackScore = null) {
  const inputValue = Number(rawValue);
  if (!metricKey || !Number.isFinite(inputValue) || !GEMINI_BENCHMARKS.length) {
    return Number.isFinite(Number(fallbackScore)) ? clamp(Number(fallbackScore), 0, 100) : null;
  }

  const std = Number(GEMINI_BENCHMARK_STATS?.[metricKey]?.std) || 1;
  const neighbors = GEMINI_BENCHMARKS
    .map((entry) => {
      const benchmarkValue = Number(entry?.metrics?.[metricKey]);
      if (!Number.isFinite(benchmarkValue)) return null;
      return {
        entry,
        distance: Math.abs((inputValue - benchmarkValue) / std),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance);

  if (!neighbors.length) {
    return Number.isFinite(Number(fallbackScore)) ? clamp(Number(fallbackScore), 0, 100) : null;
  }

  const topNeighbors = neighbors.slice(0, Math.min(6, neighbors.length));
  let weightedTargetSum = 0;
  let weightedTargetTotal = 0;

  for (const neighbor of topNeighbors) {
    const weight = 1 / (Math.max(neighbor.distance, 0.12) ** 2);
    weightedTargetSum += Number(neighbor.entry.target) * weight;
    weightedTargetTotal += weight;
  }

  if (!weightedTargetTotal) {
    return Number.isFinite(Number(fallbackScore)) ? clamp(Number(fallbackScore), 0, 100) : null;
  }

  const nearestDistance = topNeighbors[0]?.distance ?? 0;
  const benchmarkAverage = weightedTargetSum / weightedTargetTotal;
  const confidence = clamp(1 - nearestDistance / 1.45, 0, 1);

  // Keep single-metric bars a little more conservative than the full face,
  // but do not crush strong benchmark matches back into the low 60s.
  const neutralAnchor = benchmarkAverage >= 80 ? 68 : benchmarkAverage >= 70 ? 62 : 57;
  const benchmarkWeight = 0.76 + confidence * 0.16;
  let score = benchmarkAverage * benchmarkWeight + neutralAnchor * (1 - benchmarkWeight);
  score -= clamp((nearestDistance - 0.55) * 5.5, 0, 8);

  if (benchmarkAverage >= 80 && nearestDistance <= 0.18) {
    score = Math.max(score, benchmarkAverage - 4);
  } else if (benchmarkAverage >= 70 && nearestDistance <= 0.14) {
    score = Math.max(score, benchmarkAverage - 3);
  }

  if (Number.isFinite(Number(fallbackScore))) {
    score = score * 0.9 + Number(fallbackScore) * 0.1;
  }

  return Math.round(clamp(score, 25, 92));
}

function computeBenchmarkDistance(inputMetrics, benchmarkMetrics) {
  let weightedDistance = 0;
  let totalWeight = 0;
  let compared = 0;

  for (const key of BENCHMARK_FEATURE_KEYS) {
    const inputValue = Number(inputMetrics?.[key]);
    const benchmarkValue = Number(benchmarkMetrics?.[key]);
    if (!Number.isFinite(inputValue) || !Number.isFinite(benchmarkValue)) continue;

    const std = Number(GEMINI_BENCHMARK_STATS?.[key]?.std) || 1;
    const weight = BENCHMARK_DISTANCE_WEIGHTS[key] || 1;
    const delta = (inputValue - benchmarkValue) / std;
    weightedDistance += weight * delta * delta;
    totalWeight += weight;
    compared += 1;
  }

  if (compared < 6 || !totalWeight) return null;
  return Math.sqrt(weightedDistance / totalWeight);
}

function computeBenchmarkCalibrationAnalysis(rawMetrics, baselineRating = null) {
  if (!rawMetrics || !GEMINI_BENCHMARKS.length) return null;

  const neighbors = GEMINI_BENCHMARKS
    .map((entry) => ({
      entry,
      distance: computeBenchmarkDistance(rawMetrics, entry.metrics),
    }))
    .filter((item) => Number.isFinite(item.distance))
    .sort((a, b) => a.distance - b.distance);

  if (!neighbors.length) return null;

  const nearest = neighbors[0];
  const topNeighbors = neighbors.slice(0, Math.min(4, neighbors.length));
  let weightedTargetSum = 0;
  let weightedTargetTotal = 0;

  for (const neighbor of topNeighbors) {
    const weight = 1 / (Math.max(neighbor.distance, 0.08) ** 2);
    weightedTargetSum += Number(neighbor.entry.target) * weight;
    weightedTargetTotal += weight;
  }

  if (!weightedTargetTotal) return null;

  const benchmarkAverage = weightedTargetSum / weightedTargetTotal;
  const confidence = clamp(1 - nearest.distance / 1.75, 0, 1);
  const topNeighborTargets = topNeighbors
    .map((neighbor) => Number(neighbor.entry.target))
    .filter((value) => Number.isFinite(value));
  const highTierNeighborCount = topNeighborTargets.filter((value) => value >= 70).length;
  const lowTierNeighborCount = topNeighborTargets.filter((value) => value <= 55).length;

  let rating;
  if (!Number.isFinite(Number(baselineRating))) {
    rating = Math.round(clamp(benchmarkAverage, 25, 92) * 10) / 10;
    return {
      rating,
      confidence,
      nearestDistance: nearest.distance,
      nearestTarget: Number(nearest.entry.target),
      nearestFolder: nearest.entry.sourceFolder,
      nearestSource: nearest.entry.sourceImage,
      topNeighborTargets,
      highTierNeighborCount,
      lowTierNeighborCount,
    };
  }

  const benchmarkWeight = 0.15 + confidence * 0.7;
  rating = benchmarkAverage * benchmarkWeight + Number(baselineRating) * (1 - benchmarkWeight);

  if (confidence >= 0.85) {
    rating = clamp(rating, Number(nearest.entry.target) - 2, Number(nearest.entry.target) + 2);
  } else if (confidence >= 0.65) {
    if (Number(nearest.entry.target) < 60) {
      rating = Math.min(rating, Number(nearest.entry.target) + 3);
    }
    if (Number(nearest.entry.target) > 80) {
      rating = Math.max(rating, Number(nearest.entry.target) - 3);
    }
  }

  rating = Math.round(clamp(rating, 25, 92) * 10) / 10;
  return {
    rating,
    confidence,
    nearestDistance: nearest.distance,
    nearestTarget: Number(nearest.entry.target),
    nearestFolder: nearest.entry.sourceFolder,
    nearestSource: nearest.entry.sourceImage,
    topNeighborTargets,
    highTierNeighborCount,
    lowTierNeighborCount,
  };
}

function computeBenchmarkCalibratedRating(rawMetrics, baselineRating = null) {
  return computeBenchmarkCalibrationAnalysis(rawMetrics, baselineRating)?.rating ?? null;
}

const OBJECTIVE_METRIC_WEIGHTS = {
  'Bigonial Width Index': 0.9,
  'Ipd Index': 0.7,
  'Ipd Index (Geometric)': 0.7,
  'Mouth Width Index': 0.45,
  'Nose Width Index': 0.65,
  'Upper Third Length': 0.75,
  'Middle Third Length': 1.15,
  'Lower Third Length': 0.7,
  'Eye Width Index': 0.85,
  'Eye Width Index (Horizontal)': 0.85,
  'Eye Height Index': 0.9,
  'Brow Compactness Index': 1.05,
  'Philtrum Height Index': 1.15,
  'Total Lip Height Index': 0.8,
  'Fwhr': 1.3,
  'Midface Ratio': 1.45,
  'Canthal Tilt Degrees': 1.1,
};

function matchMetricWeight(label) {
  const normalized = String(label).toLowerCase();
  for (const [key, weight] of Object.entries(OBJECTIVE_METRIC_WEIGHTS)) {
    if (normalized.startsWith(key.toLowerCase())) return weight;
  }
  return 0.5;
}

function weightedAverageFromScoreMap(scoreMap) {
  const pairs = Object.entries(scoreMap || {}).filter(([, score]) => Number.isFinite(Number(score)));
  if (!pairs.length) return null;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const [label, score] of pairs) {
    const weight = matchMetricWeight(label);
    weightedSum += Number(score) * weight;
    totalWeight += weight;
  }
  if (!totalWeight) return null;
  return weightedSum / totalWeight;
}

function mapObjectiveAverageToFaceRating(avg) {
  if (!Number.isFinite(avg)) return null;
  if (avg <= 40) return 27 + (avg - 20) * 0.55;
  if (avg <= 50) return 38 + (avg - 40) * 0.7;
  if (avg <= 60) return 45 + (avg - 50) * 0.95;
  if (avg <= 70) return 54.5 + (avg - 60) * 1.1;
  if (avg <= 80) return 65.5 + (avg - 70) * 1.5;
  return 80.5 + (avg - 80) * 1.35;
}

function computeObjectiveFaceRating(metricScoreMap, categories) {
  const metricScores = Object.values(metricScoreMap || {})
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));

  const metricAvg = weightedAverageFromScoreMap(metricScoreMap);
  const categoryAvg = average([
    categories?.Harmony,
    categories?.Bone,
    categories?.Symmetry,
    categories?.Skin,
    categories?.Dimorphism,
    categories?.['Maxillary/Cheekbone Projection'],
    categories?.['Nose Projection'],
    categories?.['Facial Fat'],
    categories?.['Eye Depth'],
  ]);

  const combinedAvg =
    metricAvg != null && categoryAvg != null
      ? metricAvg * 0.78 + categoryAvg * 0.22
      : metricAvg ?? categoryAvg;

  if (combinedAvg == null) return null;

  let rating = mapObjectiveAverageToFaceRating(combinedAvg);
  const severeCount = metricScores.filter((score) => score < 45).length;
  const weakCount = metricScores.filter((score) => score < 55).length;
  const softCount = metricScores.filter((score) => score < 65).length;
  const eliteCount = metricScores.filter((score) => score >= 80).length;

  rating -= severeCount * 2.7;
  rating -= Math.max(0, weakCount - severeCount) * 0.95;
  rating -= Math.max(0, softCount - weakCount) * 0.2;
  rating += eliteCount * 0.35;

  if (combinedAvg >= 78 && severeCount === 0) rating += 2;
  if (combinedAvg >= 84 && weakCount <= 1) rating += 3;

  return Math.round(clamp(rating, 0, 100) * 10) / 10;
}

function computeMorphometricMatchedRating(metricScoreMap) {
  const avg = weightedAverageFromScoreMap(metricScoreMap);
  return avg == null ? null : Math.round(clamp(avg, 0, 100) * 10) / 10;
}

function hasHeavilyRecessedChin(rawOutput, sideScoreMap) {
  const chinScore = getScoreByLabel(sideScoreMap, 'Chin Projection');
  if (Number.isFinite(chinScore) && chinScore <= 45) return true;
  return /\b(?:heavily|severely|very|extremely|markedly|significantly)\s+recessed\s+chin\b/i.test(String(rawOutput || '')) ||
    /\bchin\b[^.\n]{0,80}\b(?:heavily|severely|very|extremely|markedly|significantly)\s+recessed\b/i.test(String(rawOutput || ''));
}

function averageFiniteScore(values) {
  const nums = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function getScoreByLabel(scoreMap, labelStartsWith) {
  const entries = Object.entries(scoreMap || {});
  const target = String(labelStartsWith || '').toLowerCase();
  for (const [label, score] of entries) {
    if (String(label).toLowerCase().startsWith(target) && Number.isFinite(Number(score))) {
      return Number(score);
    }
  }
  return null;
}

function scoreBigonialRatio(rawValue) {
  const ratio = Number(rawValue);
  if (!Number.isFinite(ratio)) return null;
  if (ratio < 0.75) return Math.round(clamp(35 + ((ratio - 0.6) / 0.15) * 25, 20, 60));
  if (ratio < 0.85) return Math.round(60 + ((ratio - 0.75) / 0.1) * 20);
  if (ratio <= 0.98) return Math.round(80 + ((ratio - 0.85) / 0.13) * 20);
  if (ratio <= 1) return Math.round(100 - ((ratio - 0.98) / 0.02) * 3);
  if (ratio <= 1.05) return Math.round(97 - ((ratio - 1) / 0.05) * 22);
  return Math.round(clamp(75 - ((ratio - 1.05) / 0.15) * 35, 25, 75));
}

function scoreIpdRatio(rawValue) {
  const ratio = Number(rawValue);
  if (!Number.isFinite(ratio)) return null;
  if (ratio >= 0.44 && ratio <= 0.48) {
    return Math.round(80 + (1 - Math.abs(ratio - 0.46) / 0.02) * 20);
  }
  if (ratio < 0.44) return Math.round(clamp(80 - ((0.44 - ratio) / 0.04) * 50, 20, 80));
  return Math.round(clamp(80 - ((ratio - 0.48) / 0.04) * 50, 20, 80));
}

function scoreMouthWidthRatio(rawValue) {
  const ratio = Number(rawValue);
  if (!Number.isFinite(ratio)) return null;
  if (ratio >= 0.36 && ratio <= 0.38) {
    return Math.round(92 + (1 - Math.abs(ratio - 0.37) / 0.01) * 8);
  }
  if (ratio < 0.36) return Math.round(clamp(92 - ((0.36 - ratio) / 0.04) * 62, 20, 92));
  return Math.round(clamp(92 - ((ratio - 0.38) / 0.04) * 62, 20, 92));
}

function scoreNoseWidthRatio(rawValue) {
  const ratio = Number(rawValue);
  if (!Number.isFinite(ratio)) return null;
  if (ratio >= 0.23 && ratio <= 0.3) return Math.round(90 + (1 - Math.abs(ratio - 0.265) / 0.035) * 10);
  if (ratio < 0.2) return Math.round(clamp(65 - ((0.2 - ratio) / 0.04) * 45, 20, 65));
  if (ratio < 0.23) return Math.round(65 + ((ratio - 0.2) / 0.03) * 25);
  if (ratio <= 0.32) return Math.round(90 - ((ratio - 0.3) / 0.02) * 15);
  if (ratio <= 0.34) return Math.round(75 - ((ratio - 0.32) / 0.02) * 25);
  return Math.round(clamp(50 - ((ratio - 0.34) / 0.06) * 30, 20, 50));
}

function scoreFwhrRatio(rawValue) {
  const ratio = Number(rawValue);
  if (!Number.isFinite(ratio)) return null;
  if (ratio >= 1.85 && ratio <= 2) return Math.round(95 + (1 - Math.abs(ratio - 1.925) / 0.075) * 5);
  if (ratio <= 1.5) return Math.round(clamp(42 - ((1.5 - ratio) / 0.2) * 22, 20, 42));
  if (ratio < 1.6) return Math.round(42 + ((ratio - 1.5) / 0.1) * 28);
  if (ratio < 1.7) return Math.round(70 + ((ratio - 1.6) / 0.1) * 10);
  if (ratio < 1.85) return Math.round(70 + ((ratio - 1.7) / 0.15) * 25);
  if (ratio <= 2.1) return Math.round(95 - ((ratio - 2) / 0.1) * 15);
  if (ratio <= 2.25) return Math.round(80 - ((ratio - 2.1) / 0.15) * 30);
  return Math.round(clamp(50 - ((ratio - 2.25) / 0.2) * 30, 20, 50));
}

function scoreMidfaceRatio(rawValue) {
  const ratio = Number(rawValue);
  if (!Number.isFinite(ratio)) return null;
  if (ratio >= 0.95 && ratio <= 1.05) return Math.round(95 + (1 - Math.abs(ratio - 1) / 0.05) * 5);
  if (ratio < 0.82) return Math.round(clamp(55 - ((0.82 - ratio) / 0.08) * 30, 25, 55));
  if (ratio < 0.9) return Math.round(55 + ((ratio - 0.82) / 0.08) * 25);
  if (ratio < 0.95) return Math.round(80 + ((ratio - 0.9) / 0.05) * 15);
  if (ratio <= 1.1) return Math.round(95 - ((ratio - 1.05) / 0.05) * 15);
  if (ratio <= 1.18) return Math.round(80 - ((ratio - 1.1) / 0.08) * 35);
  return Math.round(clamp(45 - ((ratio - 1.18) / 0.12) * 25, 20, 45));
}

function scoreRangeRatio(rawValue, goodLow, peak, goodHigh, lowFlaw, lowSevere, highFlaw, highSevere) {
  const ratio = Number(rawValue);
  if (!Number.isFinite(ratio)) return null;
  if (ratio >= goodLow && ratio <= goodHigh) {
    const edgeDistance = ratio <= peak ? peak - goodLow : goodHigh - peak;
    return Math.round(92 + (1 - Math.abs(ratio - peak) / edgeDistance) * 8);
  }
  if (ratio < lowSevere) return Math.round(clamp(45 - ((lowSevere - ratio) / Math.max(lowSevere * 0.5, 0.01)) * 25, 20, 45));
  if (ratio < lowFlaw) return Math.round(45 + ((ratio - lowSevere) / (lowFlaw - lowSevere)) * 30);
  if (ratio < goodLow) return Math.round(75 + ((ratio - lowFlaw) / (goodLow - lowFlaw)) * 17);
  if (ratio <= highFlaw) return Math.round(92 - ((ratio - goodHigh) / (highFlaw - goodHigh)) * 17);
  if (ratio <= highSevere) return Math.round(75 - ((ratio - highFlaw) / (highSevere - highFlaw)) * 30);
  return Math.round(clamp(45 - ((ratio - highSevere) / Math.max(highSevere * 0.5, 0.01)) * 25, 20, 45));
}

function scoreCanthalTilt(rawValue) {
  const degrees = Number(rawValue);
  if (!Number.isFinite(degrees)) return null;
  if (degrees >= 3 && degrees <= 8) return Math.round(94 + (1 - Math.abs(degrees - 5.5) / 2.5) * 6);
  if (degrees < -6) return Math.round(clamp(45 - ((-6 - degrees) / 6) * 25, 20, 45));
  if (degrees < -2) return Math.round(45 + ((degrees + 6) / 4) * 30);
  if (degrees < 3) return Math.round(75 + ((degrees + 2) / 5) * 19);
  if (degrees <= 10) return Math.round(94 - ((degrees - 8) / 2) * 9);
  if (degrees <= 12) return Math.round(85 - ((degrees - 10) / 2) * 15);
  return Math.round(clamp(70 - ((degrees - 12) / 8) * 30, 20, 70));
}

function hairlineCovered(raw) {
  return /\b(?:hairline|forehead|upper third)\b[^.\n]{0,80}\b(?:covered|obscured|hidden|blocked|occluded|covered by hair|bangs|fringe|hat|hood)\b/i.test(String(raw || '')) ||
    /\b(?:bangs|fringe|hat|hood)\b[^.\n]{0,80}\b(?:hairline|forehead|upper third)\b/i.test(String(raw || ''));
}

function deterministicBiometricScore(baseLabel, rawValue, rawOutput) {
  const normalized = normalizeMetricName(baseLabel);
  if (normalized.includes('bigonialwidthindex')) return scoreBigonialRatio(rawValue);
  if (normalized.includes('ipdindex')) return scoreIpdRatio(rawValue);
  if (normalized.includes('mouthwidthindex')) return scoreMouthWidthRatio(rawValue);
  if (normalized.includes('nosewidthindex')) return scoreNoseWidthRatio(rawValue);
  if (normalized.startsWith('fwhr')) return scoreFwhrRatio(rawValue);
  if (normalized.includes('midfaceratio')) return scoreMidfaceRatio(rawValue);
  if (normalized.includes('upperthirdlength')) return hairlineCovered(rawOutput) ? null : scoreRangeRatio(rawValue, 0.34, 0.385, 0.43, 0.3, 0.26, 0.46, 0.52);
  if (normalized.includes('middlethirdlength')) return scoreRangeRatio(rawValue, 0.4, 0.45, 0.5, 0.36, 0.32, 0.54, 0.6);
  if (normalized.includes('lowerthirdlength')) return scoreRangeRatio(rawValue, 0.42, 0.47, 0.52, 0.38, 0.34, 0.56, 0.62);
  if (normalized.includes('eyewidthindex')) return scoreRangeRatio(rawValue, 0.2, 0.22, 0.24, 0.18, 0.16, 0.26, 0.3);
  if (normalized.includes('eyeheightindex')) return scoreRangeRatio(rawValue, 0.055, 0.065, 0.075, 0.045, 0.035, 0.085, 0.1);
  if (normalized.includes('browcompactnessindex')) return scoreRangeRatio(rawValue, 0.08, 0.1, 0.12, 0.06, 0.045, 0.14, 0.18);
  if (normalized.includes('philtrumheightindex')) return scoreRangeRatio(rawValue, 0.08, 0.095, 0.11, 0.07, 0.055, 0.12, 0.14);
  if (normalized.includes('totallipheightindex')) return scoreRangeRatio(rawValue, 0.12, 0.15, 0.18, 0.1, 0.08, 0.22, 0.26);
  if (normalized.includes('canthaltiltdegrees')) return scoreCanthalTilt(rawValue);
  return null;
}

function isIpdMetricLabel(label) {
  const normalized = normalizeMetricName(label);
  return normalized.includes('ipdindex');
}

function isMouthWidthMetricLabel(label) {
  const normalized = normalizeMetricName(label);
  return normalized.includes('mouthwidthindex');
}

function buildStylizationSignalSummary(rawOutput, appealAssessment) {
  const text = `${rawOutput || ''}\n${appealAssessment || ''}`.toLowerCase();
  const appealText = String(appealAssessment || '').toLowerCase();
  const hasConventionalHarmonyCue =
    /\buniversally conventional\b|\byouthful\b|\brefined,\s*clean look\b|\bclean look\b|\bprioriti[sz]es harmony\b|\bharmony and symmetry over aggressive dimorphism\b|\bbalanced,\s*polished\b|\bapproachable\b|\bsoft,\s*youthful appeal\b/.test(appealText);
  const exaggeratedButCoherentCue =
    /\bexaggerated but coherent\b|\bexaggerated\s+yet\s+coherent\b|\boverbuilt but coherent\b/.test(text);
  const aggressiveLowerThirdCue =
    /\baggressive jawline\b|\bstriking,\s*aggressive jawline\b|\bsheer breadth of the lower third\b|\bbreadth of the lower third\b|\blower third breadth\b|\bwide lower-?third\b|\bpowerful,\s*wide lower-?third\b|\boverbuilt lower third\b|\blower third dominance\b|\bintensity of the jaw and brow ridge\b/.test(text);
  const extremeMasculinityCue =
    /\bhighly masculine\b|\bextreme masculinity\b|\bhyper-?masculine\b|\bstriking phenotype\b|\bbrutalist aesthetic\b/.test(text);
  const dimorphismPraiseCue =
    /\bextreme dimorphism\b|\bhigh dimorphism\b|\bhighly dimorphic\b|\belite in terms of breadth and definition\b|\belite breadth\b|\belite definition\b/.test(text);
  const hasNegatedUncannyCue =
    /\b(?:without|not|rather than|avoid(?:s|ing)?|avoids?|doesn't|does not|never)\b[^.\n]{0,48}\buncanny\b/.test(text) ||
    /\buncanny territory\b/.test(text) ||
    /\bnot uncanny\b/.test(text);
  const hasExplicitSyntheticCue =
    /\bsynthetic\s+look\b|\bsynthetic\s+appearance\b|\buncanny\s+look\b|\buncanny\s+appearance\b|\buncanny\s+aesthetic\b|\bartificial\s+look\b|\bai-generated\b|\bai generated\b|\bbiologically improbable\b|\bmannequin\b|\brender\b/.test(text);
  const hasSyntheticCue = hasExplicitSyntheticCue && !hasNegatedUncannyCue;
  const hasEditorialCue = /\beditorial\b|\bhigh-?fashion\b|\bmodern masculine\b/.test(text);
  const hasCoherentCue =
    hasConventionalHarmonyCue ||
    /\bpretty facial harmony\b|\bbroad demographic\b|\bbroad appeal\b|\bcoherent\b|\belite structural foundation\b|\bwithout crossing into uncanny\b/.test(text);
  const hasAggressiveCueRaw =
    /\bover-?dimorphic\b|\bbrutalist\b|\boverly aggressive\b|\bhyper-?masculine\b|\bfantasy male\b|\bextreme masculinity\b/.test(text) ||
    aggressiveLowerThirdCue ||
    extremeMasculinityCue ||
    dimorphismPraiseCue;
  const hasAggressiveCue =
    hasAggressiveCueRaw &&
    !(
      (hasCoherentCue || hasConventionalHarmonyCue) &&
      !hasSyntheticCue &&
      !exaggeratedButCoherentCue &&
      !aggressiveLowerThirdCue &&
      !extremeMasculinityCue &&
      !dimorphismPraiseCue
    );
  const hasDisharmonyCue = /\bmaxillary recession\b|\bmaxillary hypoplasia\b|\bmandibular dominance\b|\bconcave profile\b|\bnegative orbital vector\b|\blateral disharmony\b|\bclass iii\b|\brecessed maxilla\b/.test(text);

  return {
    text,
    exaggeratedButCoherentCue,
    aggressiveLowerThirdCue,
    extremeMasculinityCue,
    dimorphismPraiseCue,
    hasNegatedUncannyCue,
    hasExplicitSyntheticCue,
    hasSyntheticCue,
    hasEditorialCue,
    hasCoherentCue,
    hasConventionalHarmonyCue,
    hasAggressiveCue,
    hasDisharmonyCue,
  };
}

function hasConventionalAppealCue(appealAssessment) {
  const text = String(appealAssessment || '').toLowerCase();
  return /\buniversally conventional\b|\byouthful\b|\brefined,\s*clean look\b|\bclean look\b|\bprioriti[sz]es harmony\b|\bharmony and symmetry over aggressive dimorphism\b|\bbalanced,\s*polished\b|\bapproachable\b|\bsoft,\s*youthful appeal\b/.test(text);
}

function computeVisibleAgingPenalty(rawOutput, appealAssessment, debugJustification, technicalSummary) {
  const text = [
    debugJustification,
    appealAssessment,
    technicalSummary,
    rawOutput
  ].filter(Boolean).join('\n').toLowerCase();

  const hasNegatedAgingCue =
    /\b(?:no|without|minimal|little|low|not|barely)\b[^.\n]{0,60}\b(?:aging|age-related|nasolabial|wrinkle|fold|sagging|laxity|bald|hairline recession|receding hairline|thinning)\b/.test(text) ||
    /\b(?:aging|age-related|nasolabial|wrinkle|fold|sagging|laxity|bald|hairline recession|receding hairline|thinning)\b[^.\n]{0,60}\b(?:not visible|absent|minimal|minor|negligible)\b/.test(text);
  if (hasNegatedAgingCue) return 0;

  const agingCue =
    /\baging markers?\b|\bage-related\b|\bnasolabial folds?\b|\bmarionette\b|\bwrinkles?\b|\bskin laxity\b|\bsagging\b|\bsoft-tissue decline\b|\bsoft tissue decline\b|\borbital tiredness\b|\bunder-eye aging\b|\bworn\b|\bolder\b|\bbaldness\b|\bbald\b|\breced(?:ing|ed) hairline\b|\bhairline recession\b|\bdiffuse thinning\b|\bhigh hairline\b|\bweak hairline\b/.test(text);
  if (!agingCue) return 0;

  const agingWords = '(?:aging|age-related|nasolabial|fold|wrinkle|laxity|sagging|bald|hairline|recession|thinning|marionette|soft[-\\s]?tissue)';
  const heavyWords = '(?:heavily|strongly|major|severe|deep|pronounced|significant|materially|substantial)';
  const suppressWords = '(?:suppress(?:ed|es|ing)?|limit(?:ed|s|ing)?|drag(?:ged|s)?\\s+down|downward|penalty|penaliz(?:ed|es|ing)?|deduct(?:ed|s|ing)?|hurt(?:s|ing)?|lower(?:s|ed|ing)?)';
  const heavyCue = new RegExp(`\\b${heavyWords}\\b[^.\\n]{0,90}\\b${agingWords}\\b|\\b${agingWords}\\b[^.\\n]{0,90}\\b${heavyWords}\\b`).test(text);
  const suppressCue = new RegExp(`\\b${suppressWords}\\b[^.\\n]{0,90}\\b${agingWords}\\b|\\b${agingWords}\\b[^.\\n]{0,90}\\b${suppressWords}\\b`).test(text);
  const obviousAgingCue =
    /\b(?:visible|clear|obvious|noticeable)\b[^.\n]{0,70}\b(?:nasolabial folds?|wrinkles?|sagging|skin laxity|marionette|baldness|reced(?:ing|ed) hairline|hairline recession|diffuse thinning)\b/.test(text) ||
    /\b(?:deep|pronounced|severe|significant|substantial)\s+(?:nasolabial folds?|wrinkles?|sagging|skin laxity|marionette lines?|hairline recession|baldness|diffuse thinning)\b/.test(text);

  if (heavyCue && suppressCue) return 6;
  if (heavyCue && obviousAgingCue) return 5;
  if (suppressCue && obviousAgingCue) return 4;
  return 0;
}

function hasVisibleAgingFlaw(entries) {
  return (entries || []).some((entry) => {
    const text = `${entry?.title || ''} ${entry?.description || ''}`.toLowerCase();
    return /\baging\b|\bage-related\b|\bnasolabial\b|\bwrinkle\b|\bsagging\b|\blaxity\b|\bbald\b|\breced(?:ing|ed) hairline\b|\bhairline recession\b|\bthinning\b/.test(text);
  });
}

function isContradictoryAggressiveStyleFlaw(entry) {
  const text = `${entry?.title || ''} ${entry?.description || ''}`.toLowerCase();
  return /\bbrutalist\b|\boverbuilt\s*\/\s*editorial\b|\boverbuilt\b|\bover-?aggressive\b|\baggressive dimorphism\b|\btoo heavily on sharp\b|\bextreme dimorphism\b|\bhyper-?masculine\b/.test(text);
}

function isModerateBigonialStandaloneFlaw(entry, scoreMap, rawValues) {
  const text = `${entry?.title || ''} ${entry?.description || ''}`.toLowerCase();
  const looksBigonial =
    /\bbigonial\b|\blower face width\b|\bnarrow jaw\b|\bnarrow jawline\b|\bjaw relative to cheekbones\b|\blower third breadth\b|\btapered jawline\b/.test(text);
  if (!looksBigonial) return false;

  const rawIndex = Number(rawValues?.['Bigonial Width Index']);
  const hasExtremeRaw =
    Number.isFinite(rawIndex) &&
    (rawIndex < 0.75 || rawIndex > 1.05);

  return !hasExtremeRaw;
}

function isBalancedIpdStandaloneFlaw(entry, scoreMap, rawValues) {
  const text = `${entry?.title || ''} ${entry?.description || ''}`.toLowerCase();
  const looksIpd =
    /\bipd\b|\binterpupillary\b|\beye spacing\b|\bclose-set\b|\bclose set\b|\bwide-set\b|\bwide set\b|\bhypertelorism\b|\besotropia\b/.test(text);
  if (!looksIpd) return false;

  const rawIndex = Number(rawValues?.['Ipd Index (Geometric)'] ?? rawValues?.['Ipd Index']);
  const isBalanced = Number.isFinite(rawIndex) && rawIndex >= 0.44 && rawIndex <= 0.48;

  return isBalanced;
}

function isBalancedMouthStandaloneFlaw(entry, scoreMap, rawValues) {
  const text = `${entry?.title || ''} ${entry?.description || ''}`.toLowerCase();
  const looksMouth =
    /\bmouth\b|\blip width\b|\bnarrow lips\b|\bnarrow mouth\b|\bwide mouth\b|\boverly wide\b/.test(text);
  if (!looksMouth) return false;

  const rawIndex = Number(rawValues?.['Mouth Width Index']);
  const isBalanced = Number.isFinite(rawIndex) && rawIndex >= 0.36 && rawIndex <= 0.38;

  return isBalanced;
}

function parseFacialFatRead(rawOutput) {
  const match = String(rawOutput || '').match(/(?:\*\*)?Facial Fat\s*\/\s*Definition Read(?:\*\*)?\s*:\s*([^\n]+)/i);
  return match?.[1]?.replace(/\*/g, '').trim() || null;
}

function isFalseHighFatFlaw(entry, facialFatRead) {
  const read = String(facialFatRead || '').toLowerCase();
  if (!/\b(?:lean|normal|unclear|low body fat|low-body-fat|sharp|hollow|gaunt)\b/.test(read)) return false;

  const text = `${entry?.title || ''} ${entry?.description || ''}`.toLowerCase();
  return /\b(?:high facial fat|facial fat|body fat|high-fat|puffy|puffiness|bloated|bloating|fullness|facial fullness|soft tissue fullness|definition from fat|poor definition from fat)\b/.test(text);
}

function buildUncannyPrimaryFlawEntries(rawOutput, categories, appealAssessment) {
  const {
    text,
    exaggeratedButCoherentCue,
    aggressiveLowerThirdCue,
    extremeMasculinityCue,
    hasSyntheticCue,
    hasEditorialCue,
    hasCoherentCue,
    hasConventionalHarmonyCue,
    hasAggressiveCue,
    hasDisharmonyCue
  } =
    buildStylizationSignalSummary(rawOutput, appealAssessment);
  const entries = [];
  const harmony = Number(categories?.Harmony);
  const dimorphism = Number(categories?.Dimorphism);

  if (hasConventionalHarmonyCue && !hasSyntheticCue && !hasDisharmonyCue) {
    return [];
  }

  if (hasSyntheticCue) {
    entries.push({
      title: 'Synthetic / Uncanny Look',
      description: 'The face reads too designed and over-processed, which hurts natural facial harmony.'
    });
  }

  if ((hasAggressiveCue || (Number.isFinite(dimorphism) && dimorphism >= 86)) && (hasSyntheticCue || hasDisharmonyCue)) {
    entries.push({
      title: 'Over-aggressive Dimorphism',
      description: 'The jaw, brow, and lower-third intensity overpower the rest of the face and push the look into exaggerated territory.'
    });
  }

  if ((/\bbrutalist\b|\boverbuilt lower third\b|\blower third dominance\b|\bbottom-heavy\b|\bgigachad\b/.test(text)) && (hasSyntheticCue || hasDisharmonyCue)) {
    entries.push({
      title: 'Overbuilt Lower Third',
      description: 'The lower third is too carved and dominant relative to the midface, making the result feel less natural.'
    });
  }

  if (exaggeratedButCoherentCue && (aggressiveLowerThirdCue || extremeMasculinityCue || hasAggressiveCue)) {
    entries.push({
      title: 'Overbuilt / Editorial Read',
      description: 'The face reads more aggressively stylized than naturally harmonious, which narrows the appeal despite the striking structure.'
    });
  }

  if (hasAggressiveCue && !hasSyntheticCue && !hasCoherentCue) {
    entries.push({
      title: 'Brutalist Aesthetic',
      description: 'The face relies too heavily on sharp, aggressive dimorphism instead of balanced harmony.'
    });
  }

  if (
    (hasDisharmonyCue && (hasSyntheticCue || hasAggressiveCue)) ||
    (Number.isFinite(harmony) && harmony <= 58)
  ) {
    entries.push({
      title: 'Structural Disharmony',
      description: 'The strongest frontal traits are undermined by disharmony across the midface and side profile.'
    });
  }

  return entries.slice(0, 3);
}

function parseUncannyCueCount(rawOutput) {
  const match = String(rawOutput || '').match(/(?:\*\*)?Uncanny Cue Count(?:\*\*)?\s*:\s*(\d+)/i);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isFinite(count) ? Math.max(0, Math.min(6, count)) : null;
}

function titleCaseKey(s) {
  return s
    .replace(/_/g, ' ')
    .trim()
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function parseMogReportRawValuesFromText(content) {
  const rawValues = {};
  if (!content) return rawValues;
  try {
    for (const line of content.split('\n')) {
      const match = line.match(/[-*]*\s*([^:]+):\s*([+\-]?\d+(?:\.\d+)?)/);
      if (match) {
        const key = titleCaseKey(match[1]);
        rawValues[key] = match[2];
      }
    }
  } catch (e) {
    console.error('[parse-analysis] mog report parse error:', e.message);
  }
  return rawValues;
}

function readMogReportRawValues(rawOutput, backendDir) {
  const fromRawOutputMatch = String(rawOutput || '').match(
    /MOG-CHECK CLINICAL AUDIT REPORT[\s\S]*?(?:Canthal_Tilt_Degrees:[^\n]*)(?:\r?\n|$)/i
  );
  if (fromRawOutputMatch) {
    const parsed = parseMogReportRawValuesFromText(fromRawOutputMatch[0]);
    if (Object.keys(parsed).length) return parsed;
  }

  if (!backendDir) return {};
  const p = path.join(backendDir, 'mog_report.txt');
  if (!fs.existsSync(p)) return {};
  try {
    return parseMogReportRawValuesFromText(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('[parse-analysis] mog_report.txt read error:', e.message);
    return {};
  }
}

function parseFeatureBlock(block) {
  const out = [];
  if (!block) return out;
  for (let line of block.trim().split('\n')) {
    line = line.replace(/\*\*/g, '').trim();
    if (!line) continue;
    if (/^(?:#{2,}\s*|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|JUSTIFICATION\b|TECHNICAL SUMMARY\b|APPEAL ASSESSMENT\b|HEXAGON CHART RATINGS\b|CORE CATEGORY SCORES\b|CRITICAL MARKERS\b)/i.test(line)) {
      break;
    }
    if (!/^(\d+\.|-|\*)\s+/.test(line)) continue;
    const cleanLine = line.replace(/^(\d+\.|-|\*)\s+/, '');
    const colon = cleanLine.match(/^(.+?):\s+(.+)$/);
    if (colon) {
      const entry = { title: colon[1].trim(), description: colon[2].trim() };
      if (!isPlaceholderFeatureEntry(entry)) out.push(entry);
      continue;
    }
    const dash = cleanLine.split(/\s+-\s+/);
    if (dash.length >= 2) {
      const entry = { title: dash[0].trim(), description: dash.slice(1).join(' - ').trim() };
      if (!isPlaceholderFeatureEntry(entry)) out.push(entry);
    } else if (cleanLine.length > 5) {
      const entry = { title: 'Highlighted', description: cleanLine };
      if (!isPlaceholderFeatureEntry(entry)) out.push(entry);
    }
  }
  return out;
}

function trimFeatureDescription(value) {
  return String(value || '')
    .split(/\r?\n(?=\s*(?:#{2,}\s*|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|JUSTIFICATION\b|TECHNICAL SUMMARY\b|STRUCTURAL OVERVIEW\b|APPEAL ASSESSMENT\b|BEST FEATURE\b|WORST FEATURE\b|BEST FEATURES\b|PRIMARY FLAWS\b|HEXAGON CHART RATINGS\b|CORE CATEGORY SCORES\b|CRITICAL MARKERS\b))/i)[0]
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeFeatureSectionLeak(value) {
  return /###\s*(?:DASHBOARD_DATA|RATINGS|PERSONALISED\s+FEEDBACK|ACTIONABLE\s+PROTOCOLS|MOG_REPORT_REVISION)|\b(?:BEST FEATURES|PRIMARY FLAWS)\s*\(10\)|\bJUSTIFICATION\b/i.test(trimFeatureDescription(value));
}

function looksLikePlaceholderFeature(value) {
  const text = String(value || '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!text) return true;
  return (
    /\[(?:actual\s+)?(?:feature|flaw)\s+name\]/i.test(text) ||
    /\[(?:actual\s+)?(?:brief\s+)?(?:personalized\s+)?(?:explanation|reason)[^\]]*\]/i.test(text) ||
    /\bactual (?:feature|flaw) name\b/i.test(text) ||
    /\bactual personalized reason from this face\b/i.test(text) ||
    text === 'best feature' ||
    text === 'primary flaw'
  );
}

function isPlaceholderFeatureEntry(entry) {
  return looksLikePlaceholderFeature(entry?.title) || looksLikePlaceholderFeature(entry?.description);
}

function splitDashboardFeatureItems(value) {
  if (typeof value !== 'string') return [];
  const normalized = value
    .replace(/\r/g, '')
    .replace(/^\s*:?\s*\[/, '')
    .replace(/\]\.?\s*$/, '')
    .trim();
  const splitter = normalized.includes('\n')
    ? /\r?\n+/
    : normalized.includes(';')
      ? /\s*;\s*/
      : /\s*,\s*/;
  return normalized
    .split(splitter)
    .map((item) => item
      .replace(/^\s*(?:\d+\.\s*|[-*]\s*)/, '')
      .replace(/^\s*:?\s*\[+/, '')
      .replace(/\]+\.?\s*$/, '')
      .replace(/\.?\s*$/, '')
      .trim())
    .filter(Boolean);
}

function splitPrefixedDashboardEntries(block) {
  if (typeof block !== 'string') return [];
  return block
    .replace(/\r/g, '\n')
    .replace(/(?:^|[\t ]+)(?=(?:(?:\d+\.\s*)|(?:[-*]\s*))?\[\s*(?:FRONT|FRONTAL|SIDE)\s*\])/gi, '\n')
    .split(/\n+/)
    .map((item) => item.replace(/^\s*(?:(?:\d+\.\s*)|(?:[-*]\s*))?/, '').trim())
    .filter(Boolean);
}

function buildDashboardFeatureEntry(rawItem, type) {
  const cleaned = String(rawItem || '')
    .replace(/^\s*\[\s*(?:front|frontal|side)\s*\]\s*:?\s*/i, '')
    .replace(/^\s*(?:front|frontal|side)\s*:\s*/i, '')
    .replace(/^\[+/, '')
    .replace(/\]+$/, '')
    .trim();
  if (!cleaned) return null;

  const split = cleaned.match(/^(.{2,80}?)(?:\s+-\s+|:\s+)(.+)$/);
  if (split) {
    const entry = {
      title: split[1].trim(),
      description: split[2].trim(),
    };
    if (isPlaceholderFeatureEntry(entry)) return null;
    return looksLikeFeatureSectionLeak(`${entry.title} ${entry.description}`) ? null : entry;
  }

  const fallbackEntry = {
    title: cleaned,
    description:
      type === 'best'
        ? 'Flagged in the scan output as one of the strongest structural features.'
        : 'Flagged in the scan output as one of the main structural weaknesses.',
  };
  if (isPlaceholderFeatureEntry(fallbackEntry)) return null;
  return looksLikeFeatureSectionLeak(`${fallbackEntry.title} ${fallbackEntry.description}`) ? null : fallbackEntry;
}

function mergeFeatureEntries(existing, incoming, max = 5) {
  const merged = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set(merged.map((item) => `${trimFeatureDescription(item?.title || '')}::${trimFeatureDescription(item?.description || '')}`));
  const seenTitles = new Set(merged.map((item) => trimFeatureDescription(item?.title || '').toLowerCase()));
  for (const item of incoming || []) {
    if (!item) continue;
    const titleKey = trimFeatureDescription(item.title || '').toLowerCase();
    const key = `${trimFeatureDescription(item.title || '')}::${trimFeatureDescription(item.description || '')}`;
    if (!key.trim() || seen.has(key) || (titleKey && seenTitles.has(titleKey))) continue;
    seen.add(key);
    if (titleKey) seenTitles.add(titleKey);
    merged.push(item);
    if (merged.length >= max) break;
  }
  return merged.slice(0, max);
}

function parseDashboardFeatureSection(block, type) {
  if (typeof block !== 'string' || !block.trim()) {
    return { front: [], side: [] };
  }

  let frontItems = [];
  let sideItems = [];

  const prefixedEntries = splitPrefixedDashboardEntries(block)
    .map((line) => line.match(/^\[\s*(FRONT|FRONTAL|SIDE)\s*\]\s*([\s\S]+)$/i))
    .filter(Boolean);

  if (prefixedEntries.length) {
    frontItems = prefixedEntries
      .filter((entry) => /^front/i.test(entry[1]))
      .map((entry) => `[${entry[1]}] ${entry[2].trim()}`)
      .slice(0, 5);
    sideItems = prefixedEntries
      .filter((entry) => /^side/i.test(entry[1]))
      .map((entry) => `[${entry[1]}] ${entry[2].trim()}`)
      .slice(0, 5);
  } else {
    const combined = splitDashboardFeatureItems(block);
    const prefixedFront = combined.filter((item) => /^\s*(?:\[\s*front(?:al)?\s*\]|front(?:al)?\s*:)/i.test(item));
    const prefixedSide = combined.filter((item) => /^\s*(?:\[\s*side\s*\]|side\s*:)/i.test(item));
    if (prefixedFront.length || prefixedSide.length) {
      frontItems = prefixedFront.slice(0, 5);
      sideItems = prefixedSide.slice(0, 5);
    } else {
      frontItems = combined.slice(0, 5);
      sideItems = combined.slice(5, 10);
    }
  }

  return {
    front: frontItems.map((item) => buildDashboardFeatureEntry(item, type)).filter(Boolean).slice(0, 5),
    side: sideItems.map((item) => buildDashboardFeatureEntry(item, type)).filter(Boolean).slice(0, 5),
  };
}

function parseSingleHighlight(raw, regex, fallbackTitle) {
  const match = raw.match(regex);
  if (!match) return null;

  const clean = trimFeatureDescription(
    String(match[1] || '')
      .replace(/\*\*/g, '')
  ).trim();
  if (!clean) return null;

  const split = clean.match(/^([^:.]{3,80}?)(?:\s+-\s+|:\s+)(.+)$/);
  if (split) {
    const entry = {
      title: split[1].trim(),
      description: split[2].trim(),
    };
    return isPlaceholderFeatureEntry(entry) ? null : entry;
  }

  const entry = {
    title: fallbackTitle,
    description: clean,
  };
  return isPlaceholderFeatureEntry(entry) ? null : entry;
}

function parseSex(raw) {
  const match = raw.match(/###\s*ANALYSIS\s*\[?(MALE|FEMALE)\]?/i);
  if (match) return match[1].toUpperCase();

  const fallbackMatch = raw.match(/Sex:\s*(Male|Female)/i);
  if (fallbackMatch) return fallbackMatch[1].toUpperCase();

  return null;
}

function parseFinalRating(raw) {
  // Try frontal-specific first (dual output)
  const frontalPatterns = [
    /\*\*Final Frontal Rating:\s*(\d+(?:\.\d+)?)\s*\/\s*100\*\*/i,
    /\*\*Final Frontal Rating:\*\*\s*(\d+(?:\.\d+)?)\s*\/\s*100/i,
    /Final Frontal Rating:\s*\*?\*?\s*(\d+(?:\.\d+)?)\s*\/\s*100/i,
    /"(?:finalRating|final_rating|finalScore|final_score|overallScore|overall_score|frontalRating|frontal_rating|frontRating|front_rating)"\s*:\s*(\d+(?:\.\d+)?)/i
  ];
  for (const re of frontalPatterns) {
    const m = raw.match(re);
    if (m) {
      const n = parseFloat(m[1], 10);
      if (!Number.isNaN(n) && n >= 0 && n <= 100) return n;
    }
  }
  // Fall back to generic "Final Rating" (single-output / free models)
  const patterns = [
    /\*\*Final Rating:\s*(\d+(?:\.\d+)?)\s*\/\s*100\*\*/i,
    /\*\*Final Rating:\*\*\s*(\d+(?:\.\d+)?)\s*\/\s*100/i,
    /Final Rating:\s*\*?\*?\s*(\d+(?:\.\d+)?)\s*\/\s*100/i,
    /\*\*Final Rating:\s*(\d+(?:\.\d+)?)\s*\/\s*100/i,
    /Final Rating[:\s]+(\d+(?:\.\d+)?)(?:\s*\/\s*100)?/i
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m) {
      const n = parseFloat(m[1], 10);
      if (!Number.isNaN(n) && n >= 0 && n <= 100) return n;
    }
  }
  return null;
}

function parseSideRating(raw) {
  const patterns = [
    /\*\*Final Side Rating:\s*(\d+(?:\.\d+)?)\s*\/\s*100\*\*/i,
    /\*\*Final Side Rating:\*\*\s*(\d+(?:\.\d+)?)\s*\/\s*100/i,
    /Final Side Rating:\s*\*?\*?\s*(\d+(?:\.\d+)?)\s*\/\s*100/i
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m) {
      const n = parseFloat(m[1], 10);
      if (!Number.isNaN(n) && n >= 0 && n <= 100) return n;
    }
  }
  return null;
}

function parsePotentialRating(raw, label) {
  const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`\\*\\*${escaped}:\\s*(\\d+(?:\\.\\d+)?)\\s*\\/\\s*100\\*\\*`, 'i'),
    new RegExp(`\\*\\*${escaped}:\\*\\*\\s*(\\d+(?:\\.\\d+)?)\\s*\\/\\s*100`, 'i'),
    new RegExp(`${escaped}:\\s*\\*?\\*?\\s*(\\d+(?:\\.\\d+)?)\\s*\\/\\s*100`, 'i'),
    new RegExp(`${escaped}[:\\s]+(\\d+(?:\\.\\d+)?)(?:\\s*\\/\\s*100)?`, 'i')
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m) {
      const n = parseFloat(m[1], 10);
      if (!Number.isNaN(n) && n >= 0 && n <= 100) return n;
    }
  }
  return null;
}

function parseTechnicalSummary(raw) {
  const terminators =
    '(?=\\*\\*Appeal Assessment|\\*\\*(?:#1\\s*)?Best Feature|\\*\\*(?:#1\\s*)?Worst Feature|\\*\\*Hexagon Chart Ratings|\\*\\*CORE CATEGORY SCORES|\\*\\*CRITICAL MARKERS|###\\s*DASHBOARD_DATA|###\\s*MOG_REPORT|\\*\\*Max Natural Potential)';

  let m = raw.match(
    new RegExp(
      '\\*\\*Technical Summary:\\*\\*\\s*([\\s\\S]*?)' + terminators,
      'i'
    )
  );
  if (m) return m[1].trim();

  m = raw.match(/\*\*Technical Summary:\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n###\s|$)/i);
  if (m) return m[1].trim();

  m = raw.match(/Technical Summary:\s*\*?\*?\s*\n?([\s\S]*?)(?=\n\*\*[A-Z]|\n###\s|$)/i);
  if (m) return m[1].trim();

  m = raw.match(/Structural Overview:\s*\*?\*?\s*\n?([\s\S]*?)(?=\n\s*(?:\*{0,2}Best Feature\b|\*{0,2}Worst Feature\b|5\s+Primary Flaws\b|Primary Flaws\b|5\s+Best Features\b|Best Features\b|Final Rating\b|###\s)|$)/i);
  if (m) return m[1].trim();

  return null;
}

function parseAppealAssessment(raw) {
  const terminators =
    '(?=\\*\\*Structural Overview|\\*\\*Technical Summary|\\*\\*(?:#1\\s*)?Best Feature|\\*\\*(?:#1\\s*)?Worst Feature|\\*\\*Hexagon Chart Ratings|\\*\\*CORE CATEGORY SCORES|\\*\\*CRITICAL MARKERS|###\\s*DASHBOARD_DATA|###\\s*MOG_REPORT|\\*\\*Max Natural Potential)';

  let m = raw.match(
    new RegExp(
      '\\*\\*Appeal Assessment:\\*\\*\\s*([\\s\\S]*?)' + terminators,
      'i'
    )
  );
  if (m) return m[1].trim();

  m = raw.match(/Appeal Assessment:\s*\*?\*?\s*\n?([\s\S]*?)(?=\n\s*(?:\*{0,2}Structural Overview\b|\*{0,2}Technical Summary\b|\*{0,2}Best Feature\b|\*{0,2}Worst Feature\b|5\s+Primary Flaws\b|Primary Flaws\b|5\s+Best Features\b|Best Features\b|Final Rating\b|###\s)|$)/i);
  if (m) return m[1].trim();

  return null;
}

function parseDebugJustification(raw) {
  const patterns = [
    /\*\*Debug Rating Justification:\*\*\s*([\s\S]*?)(?=\n\s*(?:###|\*\*[A-Z][^*\n]*:\*\*)|$)/i,
    /Debug Rating Justification:\s*\*?\*?\s*\n?([\s\S]*?)(?=\n\s*(?:###|\*\*[A-Z][^*\n]*:\*\*)|$)/i,
    /\*\*JUSTIFICATION:\*\*\s*([\s\S]*?)(?=\n\s*(?:###|\*\*[A-Z][^*\n]*:\*\*)|$)/i,
    /JUSTIFICATION:\s*\*?\*?\s*\n?([\s\S]*?)(?=\n\s*(?:###|\*\*[A-Z][^*\n]*:\*\*)|$)/i
  ];
  for (const re of patterns) {
    const match = raw.match(re);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

function formatRatingForDebug(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const rounded = Math.round(Number(value) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function syncDebugJustificationRatings(debugJustification, finalRating, sideRating) {
  if (!debugJustification) return debugJustification;
  let text = String(debugJustification);

  const replaceRating = (labels, value) => {
    const formatted = formatRatingForDebug(value);
    if (formatted == null) return;
    labels.forEach((label) => {
      const labelPattern = label.replace(/\s+/g, '\\s+');
      text = text.replace(
        new RegExp(`\\b(${labelPattern}\\s*\\(\\s*)(\\d+(?:\\.\\d+)?)(\\s*(?:\\/\\s*100)?\\s*\\))`, 'ig'),
        `$1${formatted}$3`
      );
      text = text.replace(
        new RegExp(`\\b(${labelPattern}\\s*(?:is|:)?\\s*)(\\d+(?:\\.\\d+)?)(\\s*\\/\\s*100)?`, 'ig'),
        `$1${formatted}$3`
      );
    });
  };

  replaceRating(['Final Frontal Rating', 'Frontal Rating', 'Final Rating'], finalRating);
  replaceRating(['Final Side Rating', 'Side Rating'], sideRating);
  return text;
}

function parseHexagonChart(raw, type) {
  const regex = new RegExp(`\\*\\*Hexagon Chart Ratings \\(${type}\\)\\*\\*\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*|\\n###|$)`, 'i');
  const match = raw.match(regex);
  if (!match) return null;

  const hex = {
    Skin: null,
    Bone: null,
    Harmony: null,
    Symmetry: null,
    Dimorphism: null
  };

  const lines = match[1].trim().split('\n');
  for (let line of lines) {
    const m = line.match(/-\s*([^:]+):\s*(.+)/);
    if (m) {
      const key = titleCaseKey(m[1]);
      if (hex[key] !== undefined) {
        const val = m[2].trim().toUpperCase();
        if (val === 'N/A') {
          hex[key] = 'N/A';
        } else {
          const num = parseInt(val.match(/\d+/)?.[0], 10);
          hex[key] = !isNaN(num) ? num : null;
        }
      }
    }
  }
  return hex;
}

function parsePersonalizedFeedback(raw) {
  const match = raw.match(/###\s*Personalised feedback\s*\r?\n([\s\S]*?)(?=###\s*ACTIONABLE PROTOCOLS|###\s*MOG_REPORT_REVISION|$)/i);
  if (!match) return [];

  const text = match[1].trim();
  const feedback = [];

  const itemRegex = /(?:^|\n)\s*(\d+)\.\s+([\s\S]*?)(?=(?:\n\s*\d+\.\s+)|$)/g;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(text)) !== null) {
    const body = itemMatch[2].trim();
    if (!body) continue;
    const firstLineBreak = body.search(/\r?\n/);
    let title = firstLineBreak >= 0 ? body.slice(0, firstLineBreak).trim() : body;
    let description = firstLineBreak >= 0 ? body.slice(firstLineBreak).trim() : '';
    const titleSentence = title.match(/^(.{4,80}?)\.\s+(.+)$/);
    if (titleSentence) {
      title = titleSentence[1].trim();
      description = `${titleSentence[2].trim()}\n\n${description}`.trim();
    }
    if (!description && title.length > 100) {
      description = title;
      title = `Feedback ${feedback.length + 1}`;
    }
    if (!description) continue;
    feedback.push({
      id: parseInt(itemMatch[1], 10),
      title,
      description
    });
  }
  return feedback;
}

function parseRatingsUseThis(raw, rawValues) {
  const biometrics = [];
  const ratingsMatch = raw.match(
    /###\s*RATINGS\s*\(USE THIS\)\s*\r?\n([\s\S]*?)(?=###\s*Personalised feedback|###\s*ACTIONABLE PROTOCOLS|###\s*MOG_REPORT_REVISION|$)/i
  );
  if (!ratingsMatch) return biometrics;

  for (const line of ratingsMatch[1].trim().split('\n')) {
    const match = line.match(/[-*]*\s*([^:]+):\s*(\d+(?:\.\d+)?)\s*\/\s*100/i);
    if (!match) continue;
    const baseLabel = titleCaseKey(match[1]);
    const noteMatch = line.match(/\/\s*100\s*(?:[-–—:]\s*)?(.+)?$/i);
    const note = trimFeatureDescription(noteMatch?.[1] || '');
    let score = applyOffset100(parseFloat(match[2], 10));
    let finalLabel = baseLabel;
    const rawMetric = findRawMetricEntry(rawValues, [baseLabel]);
    if (rawMetric.rawValue !== undefined) {
      const rawValue = rawMetric.rawValue;
      const deterministicScore = deterministicBiometricScore(baseLabel, rawValue, raw);
      if (Number.isFinite(deterministicScore)) score = deterministicScore;
      if (/Degree|Angle|Tilt/i.test(baseLabel)) finalLabel = `${baseLabel} (${rawValue}°)`;
      else finalLabel = `${baseLabel} (${rawValue})`;
    }
    score = softenVisualMetricScore(baseLabel, score, note);
    biometrics.push({
      label: finalLabel,
      displayValue: `${Math.round(score)}/100`,
      score,
      ...(note ? { note } : {})
    });
  }

  return biometrics;
}

function parseAnalysisOutput(rawOutput, backendDir) {
  const experimentalJson = parseExperimentalJsonOutput(rawOutput, backendDir);
  if (experimentalJson) {
    return experimentalJson;
  }

  let finalRating = parseFinalRating(rawOutput);
  let sideRating = parseSideRating(rawOutput);
  let maxNaturalPotential = parsePotentialRating(rawOutput, 'Max Natural Potential');
  let maxPotentialWithSurgery = parsePotentialRating(rawOutput, 'Max Potential with Surgery');
  let sex = parseSex(rawOutput);
  const authenticityFlagMatch = String(rawOutput || '').match(/(?:\*\*)?Authenticity Flag(?:\*\*)?\s*:\s*([^\n]+)/i);
  let authenticityFlag = authenticityFlagMatch?.[1]?.replace(/\*/g, '').trim() || null;
  const uncannyFlagMatch = String(rawOutput || '').match(/(?:\*\*)?Uncanny Flag(?:\*\*)?\s*:\s*([^\n]+)/i);
  const uncannyCueCount = parseUncannyCueCount(rawOutput);
  let uncannyFlag = uncannyFlagMatch?.[1]?.replace(/\*/g, '').trim() || null;
  if (!uncannyFlag && uncannyCueCount != null && uncannyCueCount >= 3) {
    uncannyFlag = 'Synthetic uncanny face detected.';
  }

  finalRating = applyOffset100(finalRating);
  sideRating = applyOffset100(sideRating);
  maxNaturalPotential = applyOffset100(maxNaturalPotential);
  maxPotentialWithSurgery = applyOffset100(maxPotentialWithSurgery);
  let technicalSummary = parseTechnicalSummary(rawOutput);
  if (!technicalSummary || technicalSummary.length < 8) {
    technicalSummary = DEFAULT_SUMMARY;
  }
  const appealAssessment = parseAppealAssessment(rawOutput);
  let debugJustification = parseDebugJustification(rawOutput);
  const facialFatRead = parseFacialFatRead(rawOutput);

  const bestFeatures = [];
  const primaryFlaws = [];
  const sideBestFeatures = [];
  const sidePrimaryFlaws = [];

  const bestMatch = rawOutput.match(/BEST FEATURES[\s\d()]*[\*:]*([\s\S]*?)(?=PRIMARY FLAWS[\s\d()]*[\*:]*|FINAL RATING\b|###|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|DEBUG RATING JUSTIFICATION\b|JUSTIFICATION\b|$)/i);
  if (bestMatch) {
    const allBest = parseFeatureBlock(bestMatch[1]);
    for (const f of allBest) {
      if (/^\[SIDE\]/i.test(f.title)) {
        f.title = f.title.replace(/^\[SIDE\]\s*/i, '');
        sideBestFeatures.push(f);
      } else {
        f.title = f.title.replace(/^\[FRONT\]\s*/i, '');
        bestFeatures.push(f);
      }
    }

    const parsedDashboardBest = parseDashboardFeatureSection(bestMatch[1], 'best');
    const cleanBestFeatures = bestFeatures.filter((entry) => !looksLikeFeatureSectionLeak(`${entry?.title || ''} ${entry?.description || ''}`));
    const cleanSideBestFeatures = sideBestFeatures.filter((entry) => !looksLikeFeatureSectionLeak(`${entry?.title || ''} ${entry?.description || ''}`));
    const mergedBest = parsedDashboardBest.front.length > cleanBestFeatures.length
      ? mergeFeatureEntries(parsedDashboardBest.front, cleanBestFeatures)
      : mergeFeatureEntries(cleanBestFeatures, parsedDashboardBest.front);
    const mergedSideBest = parsedDashboardBest.side.length > cleanSideBestFeatures.length
      ? mergeFeatureEntries(parsedDashboardBest.side, cleanSideBestFeatures)
      : mergeFeatureEntries(cleanSideBestFeatures, parsedDashboardBest.side);
    bestFeatures.splice(0, bestFeatures.length, ...mergedBest);
    sideBestFeatures.splice(0, sideBestFeatures.length, ...mergedSideBest);
  }

  const flawMatch = rawOutput.match(/PRIMARY FLAWS[\s\d()]*[\*:]*([\s\S]*?)(?=BEST FEATURES[\s\d()]*[\*:]*|FINAL RATING\b|###|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|DEBUG RATING JUSTIFICATION\b|JUSTIFICATION\b|$)/i);
  if (flawMatch) {
    const allFlaws = parseFeatureBlock(flawMatch[1]);
    for (const f of allFlaws) {
      if (/^\[SIDE\]/i.test(f.title)) {
        f.title = f.title.replace(/^\[SIDE\]\s*/i, '');
        sidePrimaryFlaws.push(f);
      } else {
        f.title = f.title.replace(/^\[FRONT\]\s*/i, '');
        primaryFlaws.push(f);
      }
    }

    const parsedDashboardFlaws = parseDashboardFeatureSection(flawMatch[1], 'flaw');
    const cleanPrimaryFlaws = primaryFlaws.filter((entry) => !looksLikeFeatureSectionLeak(`${entry?.title || ''} ${entry?.description || ''}`));
    const cleanSidePrimaryFlaws = sidePrimaryFlaws.filter((entry) => !looksLikeFeatureSectionLeak(`${entry?.title || ''} ${entry?.description || ''}`));
    const mergedFlaws = parsedDashboardFlaws.front.length > cleanPrimaryFlaws.length
      ? mergeFeatureEntries(parsedDashboardFlaws.front, cleanPrimaryFlaws)
      : mergeFeatureEntries(cleanPrimaryFlaws, parsedDashboardFlaws.front);
    const mergedSideFlaws = parsedDashboardFlaws.side.length > cleanSidePrimaryFlaws.length
      ? mergeFeatureEntries(parsedDashboardFlaws.side, cleanSidePrimaryFlaws)
      : mergeFeatureEntries(cleanSidePrimaryFlaws, parsedDashboardFlaws.side);
    primaryFlaws.splice(0, primaryFlaws.length, ...mergedFlaws);
    sidePrimaryFlaws.splice(0, sidePrimaryFlaws.length, ...mergedSideFlaws);
  }

  if (bestFeatures.length === 0) {
    const bestHighlight = parseSingleHighlight(
      rawOutput,
      /(?:^|\n)\s*(?:[-*]\s*)?(?:\*{1,2}\s*)?(?:#1\s*)?BEST FEATURE(?:\s*\*{1,2})?\s*:?\s*([\s\S]*?)(?=(?:\n\s*(?:[-*]\s*)?(?:\*{1,2}\s*)?(?:#1\s*)?WORST FEATURE)|\n\s*(?:BEST FEATURES\b|PRIMARY FLAWS\b|FINAL RATING\b|###\s*DASHBOARD_DATA|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|DEBUG RATING JUSTIFICATION\b|JUSTIFICATION\b)|$)/i,
      'Best Feature'
    );
    if (bestHighlight) bestFeatures.push(bestHighlight);
  }

  if (primaryFlaws.length === 0) {
    const flawHighlight = parseSingleHighlight(
      rawOutput,
      /(?:^|\n)\s*(?:[-*]\s*)?(?:\*{1,2}\s*)?(?:#1\s*)?WORST FEATURE(?:\s*\*{1,2})?\s*:?\s*([\s\S]*?)(?=\n\s*(?:BEST FEATURES\b|PRIMARY FLAWS\b|FINAL RATING\b|###\s*DASHBOARD_DATA|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|DEBUG RATING JUSTIFICATION\b|JUSTIFICATION\b)|$)/i,
      'Primary Flaw'
    );
    if (flawHighlight) primaryFlaws.push(flawHighlight);
  }

  let categories = null;
  let sideCategories = null;
  const catMatch = rawOutput.match(
    /\*\*CORE CATEGORY SCORES.*?\n([\s\S]*?)(?=\*\*CRITICAL MARKERS|###\s*DASHBOARD_DATA|###\s*MOG_REPORT_REVISION|###\s*Personalised|###\s*ACTIONABLE)/i
  );
  if (catMatch) {
    const allKeys = ['Harmony', 'Bone', 'Symmetry', 'Skin', 'Dimorphism',
      'Maxillary/Cheekbone Projection', 'Nose Projection', 'Facial Fat', 'Eye Depth', 'Ear Shape'];
    categories = {};
    for (const k of allKeys) categories[k] = 50;

    const isDualFormat = catMatch[1].includes('|');
    if (isDualFormat) {
      sideCategories = {};
      for (const k of allKeys) sideCategories[k] = 50;
    }

    const lines = catMatch[1].split('\n');
    for (const line of lines) {
      for (const key of allKeys) {
        if (line.toLowerCase().includes(key.toLowerCase())) {
          if (isDualFormat) {
            const pipeMatch = line.match(/(?::\s*)?\b(\d+)\b(?:\/\d+)?\s*\|\s*\b(\d+|N\/A)\b/i);
            if (pipeMatch) {
              categories[key] = applyOffset100(parseInt(pipeMatch[1], 10));
              if (pipeMatch[2].toUpperCase() !== 'N/A') {
                sideCategories[key] = applyOffset100(parseInt(pipeMatch[2], 10));
              } else {
                sideCategories[key] = null;
              }
            }
          } else {
            const num = line.match(/(?::\s*)?\b(\d+)\b/);
            if (num) categories[key] = applyOffset100(parseInt(num[1], 10));
          }
        }
      }
    }
  }

  // Parse Hexagon Chart Ratings
  const hexagonFront = offsetScoreMap(parseHexagonChart(rawOutput, 'front'), 10);
  const hexagonSide = offsetScoreMap(parseHexagonChart(rawOutput, 'side'), 10);

  // Parse Personalized Feedback
  const personalizedFeedback = parsePersonalizedFeedback(rawOutput);

  const sideBiometrics = [];
  const sideRawMatch = rawOutput.match(/### SIDE_BIOMETRICS_RAW\r?\n([\s\S]*?)\r?\n### END_SIDE_BIOMETRICS_RAW/);
  if (sideRawMatch) {
    try {
      const sideJson = JSON.parse(sideRawMatch[1].trim());
      for (const [key, value] of Object.entries(sideJson)) {
        if (key === 'detailed_description') continue;
        if (typeof value === 'object' && value !== null) {
          const rawVal = value.val;
          let score = typeof value.score === 'number' ? value.score : 50;
          score = applyOffset100(score);
          const baseName = titleCaseKey(key);
          const isAngle = /angle|convexity|plane/i.test(baseName);
          const displayLabel = rawVal != null
            ? (isAngle ? `${baseName} (${rawVal}°)` : `${baseName} (${rawVal})`)
            : baseName;
          sideBiometrics.push({
            label: displayLabel,
            displayValue: `${Math.round(score)}/100`,
            score
          });
        }
      }
    } catch (e) {
      console.error('[parse-analysis] Side biometrics JSON parse error:', e.message);
    }
  }

  const biometrics = [];
  const rawValues = readMogReportRawValues(rawOutput, backendDir);
  const ratingsBiometrics = parseRatingsUseThis(rawOutput, rawValues);
  if (ratingsBiometrics.length > 0) {
    biometrics.push(...ratingsBiometrics);
  }
  const reportMatch = rawOutput.match(
    /###\s*MOG_REPORT_REVISION([\s\S]*?)(?:\*\*(?:Debug Rating Justification|JUSTIFICATION)|$)/i
  );
  if (reportMatch && biometrics.length === 0) {
    for (const line of reportMatch[1].trim().split('\n')) {
      const m = line.match(/[-*]*\s*([^:]+):\s*(\d+(?:\.\d+)?)/);
      if (!m) continue;
      const baseLabel = titleCaseKey(m[1]);
      let score = parseFloat(m[2], 10);
      // If the AI wrote the raw measurement (e.g. 0.822) instead of a 1-100 score, skip it
      if (score < 2) continue;
      score = applyOffset100(score);
      let finalLabel = baseLabel;
      const rawMetric = findRawMetricEntry(rawValues, [baseLabel]);
      if (rawMetric.rawValue !== undefined) {
        const val = rawMetric.rawValue;
        const deterministicScore = deterministicBiometricScore(baseLabel, val, rawOutput);
        if (Number.isFinite(deterministicScore)) score = deterministicScore;
        if (/Degree|Angle|Tilt/i.test(baseLabel)) finalLabel = `${baseLabel} (${val}°)`;
        else finalLabel = `${baseLabel} (${val})`;
      }
      biometrics.push({
        label: finalLabel,
        displayValue: `${Math.round(score)}/100`,
        score
      });
    }
  }

  const requiredRawMetricLabels = [
    'Eye Width Index (Horizontal)',
    'Total Lip Height Index',
  ];
  for (const rawLabel of requiredRawMetricLabels) {
    const hasMetricAlready = biometrics.some((entry) => normalizeMetricName(entry?.label).includes(normalizeMetricName(rawLabel)));
    const rawValue = rawValues[rawLabel];
    if (hasMetricAlready || rawValue === undefined) continue;
    const score = deterministicBiometricScore(rawLabel, rawValue, rawOutput);
    biometrics.push({
      label: `${rawLabel} (${rawValue})`,
      displayValue: Number.isFinite(score) ? `${Math.round(score)}/100` : compactString(rawValue),
      score: Number.isFinite(score) ? score : null,
    });
  }

  const frontScoreMap = scoreMapFromBiometrics(biometrics);
  const sideScoreMap = scoreMapFromBiometrics(sideBiometrics);
  const filteredPrimaryFlaws = primaryFlaws.filter(
    (entry) =>
      !isModerateBigonialStandaloneFlaw(entry, frontScoreMap, rawValues) &&
      !isBalancedIpdStandaloneFlaw(entry, frontScoreMap, rawValues) &&
      !isBalancedMouthStandaloneFlaw(entry, frontScoreMap, rawValues) &&
      !isFalseHighFatFlaw(entry, facialFatRead)
  );
  const filteredSidePrimaryFlaws = sidePrimaryFlaws.filter(
    (entry) =>
      !isModerateBigonialStandaloneFlaw(entry, frontScoreMap, rawValues) &&
      !isBalancedIpdStandaloneFlaw(entry, frontScoreMap, rawValues) &&
      !isBalancedMouthStandaloneFlaw(entry, frontScoreMap, rawValues) &&
      !isFalseHighFatFlaw(entry, facialFatRead)
  );
  primaryFlaws.splice(0, primaryFlaws.length, ...filteredPrimaryFlaws);
  sidePrimaryFlaws.splice(0, sidePrimaryFlaws.length, ...filteredSidePrimaryFlaws);
  const morphometricMatchedSideRating = computeMorphometricMatchedRating(sideScoreMap);
  if (morphometricMatchedSideRating != null) {
    sideRating = morphometricMatchedSideRating;
  } else {
    const objectiveSideRating = computeObjectiveFaceRating(sideScoreMap, sideCategories);
    if (objectiveSideRating != null) {
      sideRating = objectiveSideRating;
    }
  }
  if (sideRating != null && hasHeavilyRecessedChin(rawOutput, sideScoreMap)) {
    sideRating = Math.min(sideRating, 48);
  }

  const uncannyPrimaryFlaws = buildUncannyPrimaryFlawEntries(rawOutput, categories, appealAssessment);
  if (uncannyFlag) {
    uncannyPrimaryFlaws.unshift({
      title: 'Synthetic Uncanny Face Detected',
      description: 'Three or more uncanny cues were detected, making the facial read appear synthetic or overbuilt rather than naturally harmonious.'
    });
  }
  const nonHumanCue = /\b(?:non[-\s]?human|not\s+(?:a\s+)?(?:real|natural)\s+human|cartoon|cartoony|anime|drawn|inanimate|mannequin|biologically\s+impossible|clearly\s+ai[-\s]?generated|appears\s+ai[-\s]?generated|likely\s+ai[-\s]?generated)\b/i.test(
    `${rawOutput || ''}\n${appealAssessment || ''}`
  );
  if (!authenticityFlag && nonHumanCue) {
    authenticityFlag = 'Likely synthetic/non-human image - score capped.';
  }
  if (authenticityFlag) {
    if (finalRating != null) finalRating = Math.min(finalRating, 40);
    if (sideRating != null) sideRating = Math.min(sideRating, 40);
  }
  const visibleAgingPenalty = authenticityFlag ? 0 : computeVisibleAgingPenalty(rawOutput, appealAssessment, debugJustification, technicalSummary);
  if (visibleAgingPenalty > 0 && finalRating != null) {
    finalRating = Math.round(clamp(finalRating - visibleAgingPenalty, 0, 100) * 10) / 10;
  }
  if (visibleAgingPenalty > 0 && !hasVisibleAgingFlaw(primaryFlaws)) {
    primaryFlaws.unshift({
      title: visibleAgingPenalty >= 5 ? 'Pronounced Aging Markers' : 'Visible Aging Markers',
      description: 'Age-related cues such as nasolabial folds, skin laxity, baldness, or hairline recession are reducing the frontal rating.'
    });
  }
  if (uncannyPrimaryFlaws.length) {
    const mergedPrimary = mergeFeatureEntries(uncannyPrimaryFlaws, primaryFlaws, 5);
    primaryFlaws.splice(0, primaryFlaws.length, ...mergedPrimary);
    const mergedSidePrimary = mergeFeatureEntries(uncannyPrimaryFlaws, sidePrimaryFlaws, 5);
    sidePrimaryFlaws.splice(0, sidePrimaryFlaws.length, ...mergedSidePrimary);
  }
  if (hasConventionalAppealCue(appealAssessment) && !authenticityFlag) {
    const filteredPrimary = primaryFlaws.filter((entry) => !isContradictoryAggressiveStyleFlaw(entry));
    const filteredSidePrimary = sidePrimaryFlaws.filter((entry) => !isContradictoryAggressiveStyleFlaw(entry));
    primaryFlaws.splice(0, primaryFlaws.length, ...filteredPrimary);
    sidePrimaryFlaws.splice(0, sidePrimaryFlaws.length, ...filteredSidePrimary);
  }

  finalRating = capToplineRating(finalRating);
  sideRating = capToplineRating(sideRating);
  maxNaturalPotential = capToplineRating(maxNaturalPotential);
  maxPotentialWithSurgery = capToplineRating(maxPotentialWithSurgery);

  const protocols = [];
  const protoMatch = rawOutput.match(/###\s*ACTIONABLE PROTOCOLS\s*\r?\n([\s\S]*?)(?=###\s*MOG_REPORT_REVISION|$)/i);
  if (protoMatch) {
    for (const line of protoMatch[1].trim().split('\n')) {
      const m2 = line.match(/^\s*(\d+)\.\s*(.+?):\s*(.+)/);
      if (!m2) continue;

      const rest = m2[3];
      const impMatch = rest.match(/(?:\(([^)]*Impact[^)]*)\)|\[([^\]]*Impact[^\]]*)\])/i);
      const resMatch = rest.match(/\[RESEARCH:\s*(.+?)\]\s*$/i);
      const impactText = normalizeImpactLabel(impMatch ? (impMatch[1] || impMatch[2]) : '');

      protocols.push({
        id: parseInt(m2[1]),
        name: m2[2].trim(),
        description: rest
          .replace(/(?:\([^)]*Impact[^)]*\)|\[[^\]]*Impact[^\]]*\])/i, '')
          .replace(/\[RESEARCH:\s*.+?\]\s*$/i, '')
          .trim().replace(/\.$/, ''),
        impact: impactText || 'Medium Impact',
        research: resMatch ? resMatch[1].trim() : null
      });
    }
  }

  debugJustification = syncDebugJustificationRatings(debugJustification, finalRating, sideRating);

  const summaryIsReal = technicalSummary !== DEFAULT_SUMMARY && technicalSummary.trim().length >= 12;
  const hasSubstantiveParse =
    summaryIsReal ||
    bestFeatures.length > 0 ||
    primaryFlaws.length > 0 ||
    biometrics.length > 0 ||
    (finalRating != null && !Number.isNaN(finalRating)) ||
    categories != null ||
    hexagonFront != null ||
    personalizedFeedback.length > 0;

  return {
    sex,
    finalRating,
    sideRating,
    maxNaturalPotential,
    maxPotentialWithSurgery,
    authenticityFlag,
    uncannyFlag,
    technicalSummary,
    appealAssessment,
    debugJustification,
    facialFatRead,
    bestFeatures,
    primaryFlaws,
    sideBestFeatures,
    sidePrimaryFlaws,
    categories,
    sideCategories,
    hexagonFront,
    hexagonSide,
    personalizedFeedback,
    biometrics,
    sideBiometrics,
    protocols,
    hasSubstantiveParse
  };
}

module.exports = { parseAnalysisOutput, DEFAULT_SUMMARY };

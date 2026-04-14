/**
 * Parse final_engine.py stdout into dashboard fields (aligned with main.py).
 * Does not invent category scores: if CORE CATEGORY SCORES block is missing, categories stay null.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_SUMMARY = 'Could not generate technical summary.';
const SCORE_OFFSET_100 = -5;
const SCORE_OFFSET_10 = -0.5;
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

function loadGeminiBenchmarkCalibration() {
  const calibrationPath = path.join(__dirname, 'gemini-benchmark-calibration.json');
  if (!fs.existsSync(calibrationPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(calibrationPath, 'utf8'));
    if (!Array.isArray(data)) return [];
    return data.filter((entry) => entry && typeof entry === 'object' && entry.metrics && Number.isFinite(Number(entry.target)));
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

function computeBenchmarkCalibratedRating(rawMetrics, baselineRating = null) {
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

  if (!Number.isFinite(Number(baselineRating))) {
    return Math.round(clamp(benchmarkAverage, 25, 92) * 10) / 10;
  }

  const benchmarkWeight = 0.15 + confidence * 0.7;
  let rating = benchmarkAverage * benchmarkWeight + Number(baselineRating) * (1 - benchmarkWeight);

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

  return Math.round(clamp(rating, 25, 92) * 10) / 10;
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

  if (combinedAvg < 60) rating = Math.min(rating, 58);
  if (combinedAvg < 55) rating = Math.min(rating, 52);
  if (severeCount >= 3) rating = Math.min(rating, 56);
  if (severeCount >= 4) rating = Math.min(rating, 52);
  if (combinedAvg >= 78 && severeCount === 0) rating += 2;
  if (combinedAvg >= 84 && weakCount <= 1) rating += 3;

  return Math.round(clamp(rating, 25, 92) * 10) / 10;
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

function buildStylizationSignalSummary(rawOutput, appealAssessment) {
  const text = `${rawOutput || ''}\n${appealAssessment || ''}`.toLowerCase();
  const hasNegatedUncannyCue =
    /\b(?:without|not|rather than|avoid(?:s|ing)?|avoids?|doesn't|does not|never)\b[^.\n]{0,48}\buncanny\b/.test(text) ||
    /\buncanny territory\b/.test(text) ||
    /\bnot uncanny\b/.test(text);
  const hasExplicitSyntheticCue =
    /\bsynthetic\s+look\b|\bsynthetic\s+appearance\b|\buncanny\s+look\b|\buncanny\s+appearance\b|\buncanny\s+aesthetic\b|\bartificial\s+look\b|\bai-generated\b|\bai generated\b|\bbiologically improbable\b|\bmannequin\b|\brender\b/.test(text);
  const hasSyntheticCue = hasExplicitSyntheticCue && !hasNegatedUncannyCue;
  const hasEditorialCue = /\beditorial\b|\bhigh-?fashion\b|\bmodern masculine\b/.test(text);
  const hasCoherentCue =
    hasEditorialCue ||
    /\bpretty facial harmony\b|\bbroad demographic\b|\bbroad appeal\b|\bcoherent\b|\belite structural foundation\b|\bwithout crossing into uncanny\b/.test(text);
  const hasAggressiveCueRaw = /\bover-?dimorphic\b|\bbrutalist\b|\boverly aggressive\b|\bhyper-?masculine\b|\bfantasy male\b|\bextreme masculinity\b/.test(text);
  const hasAggressiveCue = hasAggressiveCueRaw && !(hasCoherentCue && !hasSyntheticCue);
  const hasDisharmonyCue = /\bmaxillary recession\b|\bmaxillary hypoplasia\b|\bmandibular dominance\b|\bconcave profile\b|\bnegative orbital vector\b|\blateral disharmony\b|\bclass iii\b|\brecessed maxilla\b/.test(text);

  return {
    text,
    hasNegatedUncannyCue,
    hasExplicitSyntheticCue,
    hasSyntheticCue,
    hasEditorialCue,
    hasCoherentCue,
    hasAggressiveCue,
    hasDisharmonyCue,
  };
}

function detectUncannyRatingCap(rawOutput, metricScoreMap, categories, sideCategories, appealAssessment, explicitFrontRating, explicitSideRating) {
  const {
    text,
    hasSyntheticCue,
    hasEditorialCue,
    hasCoherentCue,
    hasAggressiveCue,
    hasDisharmonyCue,
  } = buildStylizationSignalSummary(rawOutput, appealAssessment);
  let signalScore = 0;
  let stylizedCueScore = 0;

  if (hasSyntheticCue) {
    signalScore += 2;
    stylizedCueScore += 2;
  }
  if (/\bover-?dimorphic\b|\bbrutalist\b|\boverly aggressive\b|\bbottom-heavy\b|\btoo wide\b|\bover-?optimized\b/.test(text)) {
    signalScore += 1;
    stylizedCueScore += 1;
  }
  if (/\bexaggerated but coherent\b|\balpha aesthetics\b|\bstrong-?jawed\b|\bmale-model render\b/.test(text)) {
    stylizedCueScore += 1;
  }
  if (hasEditorialCue && !hasSyntheticCue && !hasDisharmonyCue) {
    stylizedCueScore = Math.max(0, stylizedCueScore - 1);
  }
  if (hasCoherentCue && !hasSyntheticCue && !hasDisharmonyCue) {
    stylizedCueScore = Math.max(0, stylizedCueScore - 1);
  }

  const harmony = Number(categories?.Harmony);
  const bone = Number(categories?.Bone);
  const dimorphism = Number(categories?.Dimorphism);
  const sideHarmony = Number(sideCategories?.Harmony);
  const bigonial = getScoreByLabel(metricScoreMap, 'bigonial width index');
  const fwhr = getScoreByLabel(metricScoreMap, 'fwhr');
  const maxillaryProjection = Number(
    categories?.['Maxillary/Cheekbone Projection'] ?? sideCategories?.['Maxillary/Cheekbone Projection']
  );
  const facialFat = Number(categories?.['Facial Fat']);
  let overbuiltMetricScore = 0;

  if (Number.isFinite(harmony) && harmony <= 60) signalScore += 1;
  if (Number.isFinite(dimorphism) && dimorphism >= 92) signalScore += 1;
  if (Number.isFinite(bigonial) && bigonial <= 55) signalScore += 1;
  if (Number.isFinite(fwhr) && fwhr <= 60) signalScore += 1;
  if (Number.isFinite(facialFat) && facialFat <= 20) signalScore += 1;
  if (Number.isFinite(harmony) && harmony <= 72) overbuiltMetricScore += 1;
  if (Number.isFinite(bone) && bone >= 85) overbuiltMetricScore += 1;
  if (Number.isFinite(dimorphism) && dimorphism >= 86) overbuiltMetricScore += 1;
  if (Number.isFinite(bigonial) && bigonial >= 88) overbuiltMetricScore += 1;
  if (Number.isFinite(fwhr) && fwhr >= 86) overbuiltMetricScore += 1;
  if (stylizedCueScore >= 2 && (hasSyntheticCue || hasDisharmonyCue)) signalScore += 1;
  if (hasDisharmonyCue) signalScore += 2;
  if (hasAggressiveCue) stylizedCueScore += 1;

  const coherentEditorialCase =
    hasEditorialCue &&
    !hasSyntheticCue &&
    !hasDisharmonyCue &&
    Number.isFinite(explicitFrontRating) &&
    explicitFrontRating >= 74 &&
    (
      !Number.isFinite(explicitSideRating) ||
      explicitSideRating >= 68
    );

  if (coherentEditorialCase) {
    return null;
  }

  const extremeOverbuilt =
    (stylizedCueScore >= 4 && overbuiltMetricScore >= 4) ||
    (stylizedCueScore >= 3 && overbuiltMetricScore >= 5);
  const aggressiveDisharmonyCase =
    (hasAggressiveCue || hasSyntheticCue) &&
    hasDisharmonyCue &&
    (
      (Number.isFinite(sideHarmony) && sideHarmony <= 45) ||
      (Number.isFinite(explicitSideRating) && explicitSideRating <= 45) ||
      (Number.isFinite(maxillaryProjection) && maxillaryProjection <= 45)
    );

  if (
    aggressiveDisharmonyCase ||
    extremeOverbuilt ||
    signalScore >= 8 ||
    (signalScore >= 7 && Number.isFinite(harmony) && harmony <= 68)
  ) {
    return 52;
  }
  if (
    signalScore >= 6 ||
    (signalScore >= 5 && Number.isFinite(harmony) && harmony <= 60) ||
    (stylizedCueScore >= 2 && overbuiltMetricScore >= 4) ||
    (stylizedCueScore >= 3 && overbuiltMetricScore >= 3)
  ) {
    return 56;
  }
  if (signalScore >= 4 || (stylizedCueScore >= 1 && overbuiltMetricScore >= 3)) {
    return 60;
  }
  return null;
}

function buildUncannyPrimaryFlawEntries(rawOutput, categories, appealAssessment) {
  const { text, hasSyntheticCue, hasEditorialCue, hasCoherentCue, hasAggressiveCue, hasDisharmonyCue } =
    buildStylizationSignalSummary(rawOutput, appealAssessment);
  const entries = [];
  const harmony = Number(categories?.Harmony);
  const dimorphism = Number(categories?.Dimorphism);

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

  if (hasAggressiveCue && !hasSyntheticCue && !hasCoherentCue) {
    entries.push({
      title: 'Brutalist Aesthetic',
      description: 'The face relies too heavily on sharp, aggressive dimorphism instead of balanced harmony.'
    });
  }

  if (hasDisharmonyCue || (Number.isFinite(harmony) && harmony <= 65)) {
    entries.push({
      title: 'Structural Disharmony',
      description: 'The strongest frontal traits are undermined by disharmony across the midface and side profile.'
    });
  }

  return entries.slice(0, 3);
}

function titleCaseKey(s) {
  return s
    .replace(/_/g, ' ')
    .trim()
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function readMogReportRawValues(backendDir) {
  const rawValues = {};
  const p = path.join(backendDir, 'mog_report.txt');
  if (!fs.existsSync(p)) return rawValues;
  try {
    const content = fs.readFileSync(p, 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/[-*]*\s*([^:]+):\s*([\d.\-]+)/);
      if (match) {
        const key = titleCaseKey(match[1]);
        rawValues[key] = match[2];
      }
    }
  } catch (e) {
    console.error('[parse-analysis] mog_report.txt read error:', e.message);
  }
  return rawValues;
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
      out.push({ title: colon[1].trim(), description: colon[2].trim() });
      continue;
    }
    const dash = cleanLine.split(/\s+-\s+/);
    if (dash.length >= 2) {
      out.push({ title: dash[0].trim(), description: dash.slice(1).join(' - ').trim() });
    } else if (cleanLine.length > 5) {
      out.push({ title: 'Highlighted', description: cleanLine });
    }
  }
  return out;
}

function trimFeatureDescription(value) {
  return String(value || '')
    .split(/\r?\n(?=\s*(?:#{2,}\s*|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|JUSTIFICATION\b|TECHNICAL SUMMARY\b|APPEAL ASSESSMENT\b|HEXAGON CHART RATINGS\b|CORE CATEGORY SCORES\b|CRITICAL MARKERS\b))/i)[0]
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeFeatureSectionLeak(value) {
  return /###\s*(?:DASHBOARD_DATA|RATINGS|PERSONALISED\s+FEEDBACK|ACTIONABLE\s+PROTOCOLS|MOG_REPORT_REVISION)|\b(?:BEST FEATURES|PRIMARY FLAWS)\s*\(10\)|\bJUSTIFICATION\b/i.test(trimFeatureDescription(value));
}

function splitDashboardFeatureItems(value) {
  if (typeof value !== 'string') return [];
  const normalized = value.replace(/\r/g, '');
  const splitter = normalized.includes('\n')
    ? /\r?\n+/
    : normalized.includes(';')
      ? /\s*;\s*/
      : /\s*,\s*/;
  return normalized
    .split(splitter)
    .map((item) => item.replace(/^\s*(?:\d+\.\s*|[-*]\s*)/, '').trim())
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
    .replace(/^\s*\[?(?:front|frontal|side)\]?\s*:?\s*/i, '')
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
    return looksLikeFeatureSectionLeak(`${entry.title} ${entry.description}`) ? null : entry;
  }

  const fallbackEntry = {
    title: cleaned,
    description:
      type === 'best'
        ? 'Flagged in the scan output as one of the strongest structural features.'
        : 'Flagged in the scan output as one of the main structural weaknesses.',
  };
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
    const prefixedFront = combined.filter((item) => /^\s*\[?\s*front(?:al)?\s*\]?/i.test(item));
    const prefixedSide = combined.filter((item) => /^\s*\[?\s*side\s*\]?/i.test(item));
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
    return {
      title: split[1].trim(),
      description: split[2].trim(),
    };
  }

  return {
    title: fallbackTitle,
    description: clean,
  };
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
    /Final Frontal Rating:\s*\*?\*?\s*(\d+(?:\.\d+)?)\s*\/\s*100/i
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

function parseTechnicalSummary(raw) {
  const terminators =
    '(?=\\*\\*Appeal Assessment|\\*\\*Hexagon Chart Ratings|\\*\\*CORE CATEGORY SCORES|\\*\\*CRITICAL MARKERS|###\\s*DASHBOARD_DATA|###\\s*MOG_REPORT|\\*\\*Max Natural Potential)';

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

  return null;
}

function parseAppealAssessment(raw) {
  const terminators =
    '(?=\\*\\*Hexagon Chart Ratings|\\*\\*CORE CATEGORY SCORES|\\*\\*CRITICAL MARKERS|###\\s*DASHBOARD_DATA|###\\s*MOG_REPORT|\\*\\*Max Natural Potential)';

  let m = raw.match(
    new RegExp(
      '\\*\\*Appeal Assessment:\\*\\*\\s*([\\s\\S]*?)' + terminators,
      'i'
    )
  );
  if (m) return m[1].trim();

  m = raw.match(/Appeal Assessment:\s*\*?\*?\s*\n?([\s\S]*?)(?=\n\*\*[A-Z]|\n###\s|$)/i);
  if (m) return m[1].trim();

  return null;
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
  
  // Split by numbered list items "1. TITLE"
  const parts = text.split(/(?=\n\s*\d+\.\s+[A-Z\s]+(?:\n|$))/i);
  
  // Handle case where split doesn't work perfectly on first item
  const firstMatch = text.match(/^\s*(\d+)\.\s+([A-Z\s]+)(?:\r?\n|$)/i);
  let processParts = parts;
  if (firstMatch && parts[0] && !parts[0].match(/^\s*\d+\.\s+[A-Z\s]+/)) {
      // The first split chunk might just be the whole text if regex failed, or preamble
      // Better robust parsing: find all "1. TITLE \n body"
      const itemsRegex = /(?:^|\n)\s*(\d+)\.\s+([^\n]+)\n([\s\S]*?)(?=(?:\n\s*\d+\.\s+[^\n]+)|$)/gi;
      let itemMatch;
      while ((itemMatch = itemsRegex.exec(text)) !== null) {
          feedback.push({
              id: parseInt(itemMatch[1]),
              title: itemMatch[2].trim(),
              description: itemMatch[3].trim()
          });
      }
      return feedback;
  }

  for (let p of parts) {
    const m = p.match(/^\s*(\d+)\.\s+([^\n]+)\n([\s\S]*)$/i);
    if (m) {
      feedback.push({
        id: parseInt(m[1]),
        title: m[2].trim(),
        description: m[3].trim()
      });
    }
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
    const score = applyOffset100(parseFloat(match[2], 10));
    let finalLabel = baseLabel;
    if (rawValues[baseLabel] !== undefined) {
      const rawValue = rawValues[baseLabel];
      if (/Degree|Angle|Tilt/i.test(baseLabel)) finalLabel = `${baseLabel} (${rawValue}°)`;
      else finalLabel = `${baseLabel} (${rawValue})`;
    }
    biometrics.push({
      label: finalLabel,
      displayValue: `${Math.round(score)}/100`,
      score
    });
  }

  return biometrics;
}

function parseAnalysisOutput(rawOutput, backendDir) {
  let finalRating = parseFinalRating(rawOutput);
  let sideRating = parseSideRating(rawOutput);
  let sex = parseSex(rawOutput);

  finalRating = applyOffset100(finalRating);
  sideRating = applyOffset100(sideRating);
  const explicitFrontRating = finalRating;
  const explicitSideRating = sideRating;

  let technicalSummary = parseTechnicalSummary(rawOutput);
  if (!technicalSummary || technicalSummary.length < 8) {
    technicalSummary = DEFAULT_SUMMARY;
  }
  const appealAssessment = parseAppealAssessment(rawOutput);

  const bestFeatures = [];
  const primaryFlaws = [];
  const sideBestFeatures = [];
  const sidePrimaryFlaws = [];

  const bestMatch = rawOutput.match(/BEST FEATURES[\s\d()]*[\*:]*([\s\S]*?)(?=PRIMARY FLAWS[\s\d()]*[\*:]*|###|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|JUSTIFICATION\b|$)/i);
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

  const flawMatch = rawOutput.match(/PRIMARY FLAWS[\s\d()]*[\*:]*([\s\S]*?)(?=###|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|JUSTIFICATION\b|$)/i);
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
      /(?:^|\n)\s*(?:[-*]\s*)?(?:\*{1,2}\s*)?#1\s*BEST FEATURE(?:\s*\*{1,2})?\s*:?\s*([\s\S]*?)(?=(?:\n\s*(?:[-*]\s*)?(?:\*{1,2}\s*)?#1\s*WORST FEATURE)|\n\s*(?:###\s*DASHBOARD_DATA|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|JUSTIFICATION\b)|$)/i,
      'Best Feature'
    );
    if (bestHighlight) bestFeatures.push(bestHighlight);
  }

  if (primaryFlaws.length === 0) {
    const flawHighlight = parseSingleHighlight(
      rawOutput,
      /(?:^|\n)\s*(?:[-*]\s*)?(?:\*{1,2}\s*)?#1\s*WORST FEATURE(?:\s*\*{1,2})?\s*:?\s*([\s\S]*?)(?=\n\s*(?:###\s*DASHBOARD_DATA|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|JUSTIFICATION\b)|$)/i,
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
  const rawValues = readMogReportRawValues(backendDir);
  const ratingsBiometrics = parseRatingsUseThis(rawOutput, rawValues);
  if (ratingsBiometrics.length > 0) {
    biometrics.push(...ratingsBiometrics);
  }
  const reportMatch = rawOutput.match(
    /###\s*MOG_REPORT_REVISION([\s\S]*?)(?:\*\*JUSTIFICATION|$)/i
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
      if (rawValues[baseLabel] !== undefined) {
        const val = rawValues[baseLabel];
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

  const frontScoreMap = scoreMapFromBiometrics(biometrics);
  const sideScoreMap = scoreMapFromBiometrics(sideBiometrics);
  const objectiveFrontRating = computeObjectiveFaceRating(frontScoreMap, categories);
  const objectiveSideRating = computeObjectiveFaceRating(sideScoreMap, sideCategories);
  const rawCalibrationMetrics = extractCalibrationMetrics(rawValues);
  const benchmarkFrontRating = computeBenchmarkCalibratedRating(
    rawCalibrationMetrics,
    objectiveFrontRating ?? finalRating
  );

  if (benchmarkFrontRating != null) {
    finalRating =
      explicitFrontRating != null
        ? Math.min(benchmarkFrontRating, explicitFrontRating)
        : benchmarkFrontRating;
  } else if (objectiveFrontRating != null) {
    finalRating =
      explicitFrontRating != null
        ? Math.min(objectiveFrontRating, explicitFrontRating)
        : objectiveFrontRating;
  }
  if (objectiveSideRating != null) {
    sideRating =
      explicitSideRating != null
        ? Math.min(objectiveSideRating, explicitSideRating)
        : objectiveSideRating;
  }

  const uncannyCap = detectUncannyRatingCap(
    rawOutput,
    frontScoreMap,
    categories,
    sideCategories,
    appealAssessment,
    explicitFrontRating,
    explicitSideRating
  );
  const uncannyPrimaryFlaws = buildUncannyPrimaryFlawEntries(rawOutput, categories, appealAssessment);
  if (uncannyCap != null) {
    if (finalRating != null) finalRating = Math.min(finalRating, uncannyCap);
    if (sideRating != null) sideRating = Math.min(sideRating, uncannyCap);
  }
  if (uncannyPrimaryFlaws.length) {
    const mergedPrimary = mergeFeatureEntries(uncannyPrimaryFlaws, primaryFlaws, 5);
    primaryFlaws.splice(0, primaryFlaws.length, ...mergedPrimary);
    const mergedSidePrimary = mergeFeatureEntries(uncannyPrimaryFlaws, sidePrimaryFlaws, 5);
    sidePrimaryFlaws.splice(0, sidePrimaryFlaws.length, ...mergedSidePrimary);
  }

  const protocols = [];
  const protoMatch = rawOutput.match(/###\s*ACTIONABLE PROTOCOLS\s*\r?\n([\s\S]*?)(?=###\s*MOG_REPORT_REVISION|$)/i);
  if (protoMatch) {
    for (const line of protoMatch[1].trim().split('\n')) {
      const m2 = line.match(/^\s*(\d+)\.\s*(.+?):\s*(.+)/);
      if (!m2) continue;

      const rest = m2[3];
      const impMatch = rest.match(/\(([^)]*Impact[^)]*)\)/i);
      const resMatch = rest.match(/\[RESEARCH:\s*(.+?)\]\s*$/i);

      protocols.push({
        id: parseInt(m2[1]),
        name: m2[2].trim(),
        description: rest
          .replace(/\([^)]*Impact[^)]*\)/i, '')
          .replace(/\[RESEARCH:\s*.+?\]\s*$/i, '')
          .trim().replace(/\.$/, ''),
        impact: impMatch ? impMatch[1].trim() : 'Medium Impact',
        research: resMatch ? resMatch[1].trim() : null
      });
    }
  }

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
    technicalSummary,
    appealAssessment,
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

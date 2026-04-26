/**
 * Parse final_engine.py stdout into dashboard fields (aligned with main.py).
 * Does not invent category scores: if CORE CATEGORY SCORES block is missing, categories stay null.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_SUMMARY = 'Could not generate technical summary.';
const SCORE_OFFSET_100 = -2;
const SCORE_OFFSET_10 = -0.2;
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
  if (ratio >= 0.88 && ratio <= 0.98) return Math.round(94 + (1 - Math.abs(ratio - 0.93) / 0.05) * 6);
  if (ratio < 0.82) return Math.round(clamp(60 - ((0.82 - ratio) / 0.08) * 35, 25, 60));
  if (ratio < 0.88) return Math.round(60 + ((ratio - 0.82) / 0.06) * 34);
  if (ratio <= 1.07) return Math.round(94 - ((ratio - 0.98) / 0.09) * 14);
  if (ratio <= 1.15) return Math.round(80 - ((ratio - 1.07) / 0.08) * 35);
  return Math.round(clamp(45 - ((ratio - 1.15) / 0.12) * 25, 20, 45));
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

  if (heavyCue && suppressCue) return 6;
  if (heavyCue) return 5;
  if (suppressCue) return 4;
  return 3;
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
      const match = line.match(/[-*]*\s*([^:]+):\s*([\d.\-]+)/);
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
    let score = applyOffset100(parseFloat(match[2], 10));
    let finalLabel = baseLabel;
    if (rawValues[baseLabel] !== undefined) {
      const rawValue = rawValues[baseLabel];
      score = deterministicBiometricScore(baseLabel, rawValue, raw) ?? score;
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

  const bestMatch = rawOutput.match(/BEST FEATURES[\s\d()]*[\*:]*([\s\S]*?)(?=PRIMARY FLAWS[\s\d()]*[\*:]*|###|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|DEBUG RATING JUSTIFICATION\b|JUSTIFICATION\b|$)/i);
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

  const flawMatch = rawOutput.match(/PRIMARY FLAWS[\s\d()]*[\*:]*([\s\S]*?)(?=###|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|DEBUG RATING JUSTIFICATION\b|JUSTIFICATION\b|$)/i);
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
      /(?:^|\n)\s*(?:[-*]\s*)?(?:\*{1,2}\s*)?#1\s*BEST FEATURE(?:\s*\*{1,2})?\s*:?\s*([\s\S]*?)(?=(?:\n\s*(?:[-*]\s*)?(?:\*{1,2}\s*)?#1\s*WORST FEATURE)|\n\s*(?:###\s*DASHBOARD_DATA|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|DEBUG RATING JUSTIFICATION\b|JUSTIFICATION\b)|$)/i,
      'Best Feature'
    );
    if (bestHighlight) bestFeatures.push(bestHighlight);
  }

  if (primaryFlaws.length === 0) {
    const flawHighlight = parseSingleHighlight(
      rawOutput,
      /(?:^|\n)\s*(?:[-*]\s*)?(?:\*{1,2}\s*)?#1\s*WORST FEATURE(?:\s*\*{1,2})?\s*:?\s*([\s\S]*?)(?=\n\s*(?:###\s*DASHBOARD_DATA|RATINGS\s*\(USE THIS\)|PERSONALI[ZS]ED FEEDBACK|ACTIONABLE PROTOCOLS|MOG_REPORT_REVISION|DEBUG RATING JUSTIFICATION\b|JUSTIFICATION\b)|$)/i,
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
      if (rawValues[baseLabel] !== undefined) {
        const val = rawValues[baseLabel];
        score = deterministicBiometricScore(baseLabel, val, rawOutput) ?? score;
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
  const objectiveSideRating = computeObjectiveFaceRating(sideScoreMap, sideCategories);
  if (objectiveSideRating != null) {
    sideRating = objectiveSideRating;
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

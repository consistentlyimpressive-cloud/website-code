/**
 * Parse final_engine.py stdout into dashboard fields (aligned with main.py).
 * Does not invent category scores: if CORE CATEGORY SCORES block is missing, categories stay null.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_SUMMARY = 'Could not generate technical summary.';

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
    '(?=\\*\\*Appeal Assessment|\\*\\*CORE CATEGORY SCORES|\\*\\*CRITICAL MARKERS|###\\s*DASHBOARD_DATA|###\\s*MOG_REPORT|\\*\\*Max Natural Potential)';

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

function parseAnalysisOutput(rawOutput, backendDir) {
  let finalRating = parseFinalRating(rawOutput);
  let sideRating = parseSideRating(rawOutput);
  let sex = parseSex(rawOutput);

  let technicalSummary = parseTechnicalSummary(rawOutput);
  if (!technicalSummary || technicalSummary.length < 8) {
    technicalSummary = DEFAULT_SUMMARY;
  }

  const bestFeatures = [];
  const primaryFlaws = [];
  const sideBestFeatures = [];
  const sidePrimaryFlaws = [];

  const bestMatch = rawOutput.match(/BEST FEATURES[\s\d()]*[\*:]*([\s\S]*?)(?=PRIMARY FLAWS[\s\d()]*[\*:]*|###|$)/i);
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
  }

  const flawMatch = rawOutput.match(/PRIMARY FLAWS[\s\d()]*[\*:]*([\s\S]*?)(?=$|###)/i);
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
  }

  let categories = null;
  let sideCategories = null;
  const catMatch = rawOutput.match(
    /\*\*CORE CATEGORY SCORES.*?\n([\s\S]*?)(?=\*\*CRITICAL MARKERS|###\s*DASHBOARD_DATA|###\s*MOG_REPORT_REVISION|###\s*ACTIONABLE)/i
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
              categories[key] = Math.min(100, Math.max(0, parseInt(pipeMatch[1], 10)));
              if (pipeMatch[2].toUpperCase() !== 'N/A') {
                sideCategories[key] = Math.min(100, Math.max(0, parseInt(pipeMatch[2], 10)));
              } else {
                sideCategories[key] = null;
              }
            }
          } else {
            const num = line.match(/(?::\s*)?\b(\d+)\b/);
            if (num) categories[key] = Math.min(100, Math.max(0, parseInt(num[1], 10)));
          }
        }
      }
    }
  }

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
          score = Math.min(100, Math.max(0, score));
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
  const reportMatch = rawOutput.match(
    /###\s*MOG_REPORT_REVISION([\s\S]*?)(?:\*\*JUSTIFICATION|$)/i
  );
  if (reportMatch) {
    for (const line of reportMatch[1].trim().split('\n')) {
      const m = line.match(/[-*]*\s*([^:]+):\s*(\d+(?:\.\d+)?)/);
      if (!m) continue;
      const baseLabel = titleCaseKey(m[1]);
      let score = parseFloat(m[2], 10);
      // If the AI wrote the raw measurement (e.g. 0.822) instead of a 1-100 score, skip it
      if (score < 2) continue;
      score = Math.min(100, Math.max(0, score));
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
    categories != null;

  return {
    sex,
    finalRating,
    sideRating,
    technicalSummary,
    bestFeatures,
    primaryFlaws,
    sideBestFeatures,
    sidePrimaryFlaws,
    categories,
    sideCategories,
    biometrics,
    sideBiometrics,
    protocols,
    hasSubstantiveParse
  };
}

module.exports = { parseAnalysisOutput, DEFAULT_SUMMARY };

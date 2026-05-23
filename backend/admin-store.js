const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, 'admin-data.json');
const KEY_HEALTH_STATE_FILE = path.join(__dirname, 'key-health-state.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ascend-admin';
const ADMIN_PASSWORD_FALLBACK = 'ascend-admin';

/** Firestore doc: system/adminStore — persists analyses + keyEvents across deploys */
const FIRESTORE_COLLECTION = 'system';
const FIRESTORE_DOC = 'adminStore';

const defaults = () => ({
  analyses: [],
  keyEvents: [],
  serverStartedAt: Date.now(),
});

let store = defaults();
let firestore = null;
let firestoreReady = false;

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function setFirestore(db) {
  firestore = db;
}

async function loadFromFirestore() {
  if (!firestore) return false;
  const snap = await firestore.collection(FIRESTORE_COLLECTION).doc(FIRESTORE_DOC).get();
  if (!snap.exists) return false;
  const raw = snap.data() || {};
  store = {
    ...defaults(),
    analyses: Array.isArray(raw.analyses) ? raw.analyses : [],
    keyEvents: Array.isArray(raw.keyEvents) ? raw.keyEvents : [],
    serverStartedAt: Date.now(),
  };
  return true;
}

function loadFromFile() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      store = { ...defaults(), ...raw, serverStartedAt: Date.now() };
      return true;
    }
  } catch (e) {
    console.error('[admin-store] Load file error:', e.message);
  }
  return false;
}

/**
 * Call once at startup after Firebase Admin is ready.
 * Order: try Firestore (if configured), else local JSON.
 */
async function init() {
  const preferFile = process.env.ADMIN_DATA_SOURCE === 'file';
  if (preferFile) {
    loadFromFile();
    firestoreReady = true;
    console.log('[admin-store] Using local file only (ADMIN_DATA_SOURCE=file)');
    return;
  }

  if (firestore) {
    try {
      const ok = await withTimeout(loadFromFirestore(), Number(process.env.ADMIN_STORE_FIRESTORE_TIMEOUT_MS || 2500), 'admin-store Firestore load');
      if (ok) {
        console.log('[admin-store] Loaded from Firestore');
        firestoreReady = true;
        return;
      }
    } catch (e) {
      console.warn('[admin-store] Firestore load failed, falling back to file:', e.message);
    }
  }

  loadFromFile();
  firestoreReady = true;
  if (!firestore) {
    console.log('[admin-store] Using local file (no Firestore)');
  } else {
    console.log('[admin-store] Firestore empty; seeded from file or defaults');
  }
}

async function saveToFirestore() {
  if (!firestore) return;
  try {
    await firestore.collection(FIRESTORE_COLLECTION).doc(FIRESTORE_DOC).set(
      {
        analyses: store.analyses,
        keyEvents: store.keyEvents,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (e) {
    console.error('[admin-store] Firestore save error:', e.message);
  }
}

function saveFile() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error('[admin-store] File save error:', e.message);
  }
}

function save() {
  saveFile();
  saveToFirestore().catch(() => {});
}

function logAnalysis({
  model,
  durationMs,
  coreDurationMs,
  coreAiDurationMs,
  scanRequestId,
  success,
  rating,
  sideRating,
  error,
  uid,
  platform,
}) {
  store.analyses.unshift({
    id: Date.now(),
    ts: new Date().toISOString(),
    model: String(model),
    durationMs: durationMs || null,
    coreDurationMs: coreDurationMs || durationMs || null,
    coreAiDurationMs: coreAiDurationMs || null,
    scanRequestId: scanRequestId || null,
    success: !!success,
    rating: rating ?? null,
    sideRating: sideRating ?? null,
    error: error || null,
    uid: uid || null,
    platform: platform || null,
  });
  if (store.analyses.length > 500) store.analyses.length = 500;
  save();
}

function parseKeyEventsFromStdout(stdout) {
  const events = [];
  const now = new Date().toISOString();

  for (const m of stdout.matchAll(/\[DEBUG\] Trying Google GenAI\/Gemma GEMINI_KEY_(\d+)/g)) {
    events.push({ ts: now, key: +m[1], type: 'attempt' });
  }
  for (const m of stdout.matchAll(/GEMINI_KEY_(\d+).*(?:429|RESOURCE_EXHAUSTED|quota exhausted)/gi)) {
    events.push({ ts: now, key: +m[1], type: 'exhausted' });
  }
  for (const m of stdout.matchAll(/GEMINI_KEY_(\d+) failed: (?!.*(?:429|RESOURCE_EXHAUSTED|quota exhausted))(.+)/gi)) {
    events.push({ ts: now, key: +m[1], type: 'error', detail: m[2].slice(0, 120) });
  }

  if (events.length) {
    store.keyEvents.push(...events);
    if (store.keyEvents.length > 2000) store.keyEvents = store.keyEvents.slice(-2000);
    save();
  }
  return events;
}

function parseDisabledGeminiKeys() {
  const rawDisabledKeys = String(process.env.GEMINI_DISABLED_KEYS || '1,3');
  return new Set(
    rawDisabledKeys
      .split(',')
      .map((part) => Number(String(part).trim()))
      .filter((value) => Number.isInteger(value) && value > 0)
  );
}

function readKeyHealthState() {
  try {
    if (!fs.existsSync(KEY_HEALTH_STATE_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(KEY_HEALTH_STATE_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function getKeyHealth() {
  const keys = {};
  const todayStr = new Date().toDateString();
  const todayEvents = store.keyEvents.filter((e) => new Date(e.ts).toDateString() === todayStr);
  const disabledKeys = parseDisabledGeminiKeys();
  const keyState = readKeyHealthState();
  const quarantines = keyState.quarantines && typeof keyState.quarantines === 'object' ? keyState.quarantines : {};
  const now = Date.now();

  for (const ev of todayEvents) {
    if (!keys[ev.key]) keys[ev.key] = { attempts: 0, exhausted: false, errors: 0, lastExhaustedAt: null, lastError: null };
    if (ev.type === 'attempt') keys[ev.key].attempts++;
    if (ev.type === 'exhausted') {
      keys[ev.key].exhausted = true;
      keys[ev.key].lastExhaustedAt = ev.ts;
    }
    if (ev.type === 'error') {
      keys[ev.key].errors++;
      keys[ev.key].lastError = ev.detail || null;
    }
  }

  const result = [];
  for (let i = 1; i <= 5; i++) {
    const k = keys[i] || { attempts: 0, exhausted: false, errors: 0, lastExhaustedAt: null, lastError: null };
    const quarantine = quarantines[String(i)] || null;
    const quarantineUntilMs = Number(quarantine?.untilMs || 0);
    const disabled = disabledKeys.has(i);
    const quarantined = !disabled && quarantineUntilMs > now;
    const status = disabled
      ? 'disabled'
      : quarantined
        ? 'quarantined'
        : k.exhausted
          ? 'quota'
          : k.errors > 0
            ? 'errors'
            : 'healthy';
    result.push({
      key: i,
      ...k,
      disabled,
      quarantined,
      status,
      quarantineReason: quarantine?.reason || null,
      quarantineDetail: quarantine?.detail || k.lastError || null,
      quarantineUntilMs: quarantined ? quarantineUntilMs : null,
      quarantineRemainingMs: quarantined ? Math.max(0, quarantineUntilMs - now) : 0,
    });
  }
  return result;
}

function getStats() {
  const now = Date.now();
  const todayStr = new Date().toDateString();
  const todayAnalyses = store.analyses.filter((a) => new Date(a.ts).toDateString() === todayStr);
  const weekAnalyses = store.analyses.filter((a) => now - new Date(a.ts).getTime() < 7 * 86400000);

  const successToday = todayAnalyses.filter((a) => a.success);
  const failToday = todayAnalyses.filter((a) => !a.success);
  const durations = successToday.filter((a) => a.durationMs).map((a) => a.durationMs);

  const hours = Array(24).fill(0);
  todayAnalyses.forEach((a) => {
    hours[new Date(a.ts).getHours()]++;
  });

  const modelCounts = { ultra: 0, free: 0 };
  store.analyses.forEach((a) => {
    if (['1', '2', '6', '7', '8', '9', '10', '11', '12', '13'].includes(a.model)) modelCounts.ultra++;
    else modelCounts.free++;
  });

  const uploadsDir = path.join(__dirname, 'uploads');
  let diskUsageMB = 0;
  try {
    if (fs.existsSync(uploadsDir)) {
      for (const f of fs.readdirSync(uploadsDir)) {
        diskUsageMB += fs.statSync(path.join(uploadsDir, f)).size;
      }
    }
  } catch (_) {}
  diskUsageMB = +(diskUsageMB / 1048576).toFixed(2);

  return {
    overview: {
      totalAll: store.analyses.length,
      totalToday: todayAnalyses.length,
      totalWeek: weekAnalyses.length,
      successToday: successToday.length,
      failToday: failToday.length,
      successRate:
        todayAnalyses.length > 0 ? Math.round((successToday.length / todayAnalyses.length) * 100) : 100,
      avgDurationMs:
        durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      uptimeMs: now - store.serverStartedAt,
      diskUsageMB,
    },
    keyHealth: getKeyHealth(),
    modelBreakdown: modelCounts,
    hourlyUsage: hours,
    recentAnalyses: store.analyses.slice(0, 50),
  };
}

function checkPassword(pw) {
  const value = String(pw || '');
  return value === ADMIN_PASSWORD || value === ADMIN_PASSWORD_FALLBACK;
}

const PUBLIC_ANALYSIS_BASE = 74;

function getPublicAnalysisDisplayNumber() {
  const successCount = store.analyses.filter((a) => a.success).length;
  return PUBLIC_ANALYSIS_BASE + successCount;
}

async function getFreshPublicAnalysisDisplayNumber() {
  if (!firestore) return getPublicAnalysisDisplayNumber();

  try {
    const snap = await withTimeout(
      firestore.collection(FIRESTORE_COLLECTION).doc(FIRESTORE_DOC).get(),
      Number(process.env.ADMIN_STORE_FIRESTORE_TIMEOUT_MS || 2500),
      'admin-store public stats Firestore load'
    );
    const raw = snap.exists ? snap.data() || {} : {};
    const analyses = Array.isArray(raw.analyses) ? raw.analyses : [];
    const successCount = analyses.filter((a) => a && a.success).length;
    return PUBLIC_ANALYSIS_BASE + successCount;
  } catch (e) {
    console.warn('[admin-store] Fresh public stats read failed, using memory:', e.message);
    return getPublicAnalysisDisplayNumber();
  }
}

module.exports = {
  init,
  setFirestore,
  logAnalysis,
  parseKeyEventsFromStdout,
  getStats,
  checkPassword,
  getPublicAnalysisDisplayNumber,
  getFreshPublicAnalysisDisplayNumber,
};

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config();
const rateLimit = require('express-rate-limit');
const { parseAnalysisOutput } = require('./parse-analysis-output');
const adminStore = require('./admin-store');
const {
  shouldSkipFirebaseStorage,
  sanitizeFirebaseError,
  isCredentialsConfigError,
  shouldUseFirebaseEmulator,
} = require('./firebase-errors');
const admin = require('firebase-admin');

const USE_FIREBASE_EMULATOR = shouldUseFirebaseEmulator();

/** Must be set before admin.firestore() / auth — `npm run dev` explicitly opts into emulator mode. */
if (USE_FIREBASE_EMULATOR && process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('[firebase] Firestore emulator:', process.env.FIRESTORE_EMULATOR_HOST);
} else if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.warn(
    '[firebase] FIRESTORE_EMULATOR_HOST is set but ignored because USE_FIREBASE_EMULATOR is not 1.'
  );
}
if (USE_FIREBASE_EMULATOR && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.log('[firebase] Auth emulator:', process.env.FIREBASE_AUTH_EMULATOR_HOST);
}

function firebaseConfigHelpMessage() {
  return USE_FIREBASE_EMULATOR
    ? 'This backend is in Firebase emulator mode. For live premium scans, start the API without USE_FIREBASE_EMULATOR and configure FIREBASE_SERVICE_ACCOUNT_JSON (or gcloud application-default credentials).'
    : 'Firebase Admin is not configured on this machine. Add FIREBASE_SERVICE_ACCOUNT_JSON to backend/.env, or run gcloud auth application-default login, then restart the API.';
}

function isRemoteBrowserRequest(req) {
  const haystack = `${req?.headers?.origin || ''} ${req?.headers?.host || ''}`.toLowerCase();
  return !/(localhost|127\.0\.0\.1)/i.test(haystack);
}


function initFirebaseAdmin() {
  if (admin.apps.length) return;
  const bucket =
    process.env.FIREBASE_STORAGE_BUCKET || 'mogcheck-net.firebasestorage.app';
  const projectId = process.env.FIREBASE_PROJECT_ID || 'mogcheck-net';
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const firestoreEmulator = USE_FIREBASE_EMULATOR && !!process.env.FIRESTORE_EMULATOR_HOST;

  if (json) {
    try {
      const cred = JSON.parse(json);
      admin.initializeApp({
        credential: admin.credential.cert(cred),
        projectId: cred.project_id || projectId,
        storageBucket: bucket,
      });
      console.log('[firebase] Initialized with FIREBASE_SERVICE_ACCOUNT_JSON');
      return;
    } catch (e) {
      console.error('[firebase] FIREBASE_SERVICE_ACCOUNT_JSON invalid:', e.message);
    }
  }

  /**
   * Firestore emulator + no service account: use project-only init.
   * Do NOT use applicationDefault() here — it loads partial ADC and then
   * admin.storage().bucket() / some APIs throw "Could not load the default credentials"
   * even though Firestore itself talks to the emulator.
   */
  if (firestoreEmulator && !process.env.FORCE_GOOGLE_ADC) {
    admin.initializeApp({
      projectId,
      storageBucket: bucket,
    });
    console.log(
      '[firebase] Emulator mode: project-only Admin init (no ADC). Firebase Storage uploads are skipped; Firestore uses the emulator.'
    );
    return;
  }

  if (USE_FIREBASE_EMULATOR && !process.env.FIRESTORE_EMULATOR_HOST) {
    console.warn(
      '[firebase] USE_FIREBASE_EMULATOR=1 but FIRESTORE_EMULATOR_HOST is missing. Falling back to live Firebase Admin init.'
    );
  }

  // Production or dev with emulator + explicit ADC request
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId,
      storageBucket: bucket,
    });
    console.log(
      '[firebase] Initialized with Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS or gcloud auth application-default login)'
    );
    return;
  } catch (e) {
    console.warn('[firebase] applicationDefault() not available:', e.message);
  }

  admin.initializeApp({
    projectId,
    storageBucket: bucket,
  });
  console.warn(
    '[firebase] Initialized with projectId only — set FIREBASE_SERVICE_ACCOUNT_JSON, run gcloud auth application-default login, or explicitly use USE_FIREBASE_EMULATOR=1 with FIRESTORE_EMULATOR_HOST for local dev.'
  );
}

/** Shared Firestore instance for webhooks, mog-battle votes, and other routes */
let firestore = null;
try {
  initFirebaseAdmin();
  firestore = admin.firestore();
  adminStore.setFirestore(firestore);
} catch (e) {
  console.error('[firebase] Failed to initialize admin SDK, continuing without it:', e.message);
}

function isQuotaExceededError(error) {
  const message = String(error?.message || error || '');
  return error?.code === 8 || /RESOURCE_EXHAUSTED|quota exceeded/i.test(message);
}

const FIRESTORE_QUOTA_COOLDOWN_MS = Number(process.env.FIRESTORE_QUOTA_COOLDOWN_MS || 15 * 60 * 1000);
let firestoreQuotaCooldownUntil = 0;

function isFirestoreQuotaCoolingDown() {
  return firestoreQuotaCooldownUntil > Date.now();
}

function noteFirestoreQuotaExceeded(context = 'unknown') {
  const wasCooling = isFirestoreQuotaCoolingDown();
  firestoreQuotaCooldownUntil = Date.now() + FIRESTORE_QUOTA_COOLDOWN_MS;
  if (!wasCooling) {
    console.warn(
      `[firestore] Quota exceeded during ${context}. Cooling down Firestore reads for ${Math.round(
        FIRESTORE_QUOTA_COOLDOWN_MS / 1000
      )}s. Local saved-scan fallback is disabled to prevent stale dashboard ratings.`
    );
  }
}

function firestoreQuotaCooldownWarning() {
  const remainingMs = Math.max(firestoreQuotaCooldownUntil - Date.now(), 0);
  const remainingMin = Math.max(1, Math.ceil(remainingMs / 60000));
  return `Firestore quota exceeded recently. Scan history is temporarily unavailable for about ${remainingMin} more minute(s).`;
}

const activeAnalysisByUser = new Map();
const analysisRecoveryByUser = new Map();

// Stale local scan fallbacks caused old parsed scores to reappear in dashboards.
// Keep real Firestore persistence, but never read/write local cached scans.
function listLocalCachedScans() {
  return [];
}

function getLocalCachedScan() {
  return null;
}

function upsertLocalCachedScan() {
  return;
}

function deleteLocalCachedScan() {
  return;
}

function getDayBounds(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function calculateDaysLeft(value) {
  const ms = timestampMs(value);
  if (!ms) return null;
  return Math.max(0, Math.ceil((ms - Date.now()) / 86400000));
}

const PRO_PLAN_VALUES = new Set(['pro', 'pro_monthly', 'pro_annual', 'pro_yearly', 'pro_infinite', 'quota_bypass']);

function normalizeUserPlan(plan) {
  const value = String(plan || 'free').trim().toLowerCase();
  if (value === 'pro yearly' || value === 'pro-annual' || value === 'pro annual') return 'pro_annual';
  if (value === 'pro monthly' || value === 'pro-monthly') return 'pro_monthly';
  if (value === 'pro infinite' || value === 'pro-infinite') return 'pro_infinite';
  if (value === 'pro_yearly') return 'pro_annual';
  return value || 'free';
}

function isProPlanValue(plan) {
  return PRO_PLAN_VALUES.has(normalizeUserPlan(plan));
}

function getPlanLabel(plan) {
  const normalized = normalizeUserPlan(plan);
  if (normalized === 'pro_monthly' || normalized === 'pro') return 'PRO - MONTHLY';
  if (normalized === 'pro_annual') return 'PRO - ANNUAL';
  if (normalized === 'pro_infinite' || normalized === 'quota_bypass') return 'PRO - INFINITE';
  if (normalized === 'single_scan') return '2 Scans';
  return 'FREE';
}

function getManualPlanPeriodEnd(plan) {
  const normalized = normalizeUserPlan(plan);
  if (normalized === 'pro_monthly') return new Date(Date.now() + 30 * 86400000).toISOString();
  if (normalized === 'pro_annual') return new Date(Date.now() + 365 * 86400000).toISOString();
  return null;
}

async function countSuccessfulScansToday(uid) {
  if (!uid) return 0;
  const { startMs, endMs } = getDayBounds();

  if (!firestore || isFirestoreQuotaCoolingDown()) return 0;

  try {
    const snap = await firestore
      .collection('users')
      .doc(uid)
      .collection('scans')
      .limit(100)
      .get();

    let count = 0;
    snap.forEach((doc) => {
      const scan = doc.data() || {};
      if (!scan || scan.success === false) return false;
      const ts = timestampMs(scan.timestamp || scan.scannedAt || scan.payload?.scannedAt || scan.createdAt);
      if (ts >= startMs && ts < endMs) count += 1;
      return true;
    });
    return count;
  } catch (error) {
    if (isQuotaExceededError(error)) noteFirestoreQuotaExceeded('fair-usage scan count');
    console.warn('[fair-usage] Failed to count today scans:', error.message || error);
    return 0;
  }
}

function calculateFairUsageDelay(scansToday) {
  if (scansToday < 8) return 0;

  const scansPastIncludedLimit = scansToday - 7;
  const compoundedDelayMs = (20 + scansPastIncludedLimit * 15) * 1000;
  return Math.min(compoundedDelayMs, 3 * 60 * 1000);
}

const SCAN_LIMIT_OVERRIDES_COLLECTION = 'scanLimitOverrides';

function getNextDailyResetMs() {
  return getDayBounds().endMs;
}

async function getScanLimitOverride(uid) {
  if (!uid || !firestore) return null;
  try {
    const snap = await firestore.collection(SCAN_LIMIT_OVERRIDES_COLLECTION).doc(uid).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    const expiresAtMs = timestampMs(data.expiresAt);
    if (expiresAtMs && expiresAtMs <= Date.now()) {
      firestore.collection(SCAN_LIMIT_OVERRIDES_COLLECTION).doc(uid).delete().catch(() => {});
      return null;
    }
    return data;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      console.warn('[scan-limits] Failed to read override: quota exhausted');
      return null;
    }
    throw error;
  }
}

async function setScanLimitOverride(uid, data) {
  if (!uid || !firestore) throw new Error('Firestore not available');
  await firestore.collection(SCAN_LIMIT_OVERRIDES_COLLECTION).doc(uid).set({
    ...data,
    uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function buildFairUsagePolicy(plan, uid, options = {}) {
  const normalizedPlan = normalizeUserPlan(plan);
  const eligible = isProPlanValue(normalizedPlan);

  if (options.adminExempt) {
    return {
      enabled: eligible,
      scansToday: 0,
      minimumDurationMs: 0,
      lowPriority: false,
      manualLimit: false,
      manualExempt: true,
      limitSource: 'admin',
      maxConcurrent: null,
      activeCount: uid && activeAnalysisByUser.has(uid) ? 1 : 0,
      badgeText: '',
    };
  }

  const scansToday = eligible && uid ? await countSuccessfulScansToday(uid) : 0;
  const override = eligible && uid ? await getScanLimitOverride(uid) : null;
  const autoMinimumDurationMs = eligible ? calculateFairUsageDelay(scansToday) : 0;
  const manualLimit = override?.mode === 'limit';
  const manualExempt = override?.mode === 'exempt';
  const minimumDurationMs = manualExempt
    ? 0
    : manualLimit
      ? Math.max(autoMinimumDurationMs, calculateFairUsageDelay(8))
      : autoMinimumDurationMs;
  const lowPriority = minimumDurationMs > 0;

  return {
    enabled: eligible,
    scansToday,
    minimumDurationMs,
    lowPriority,
    manualLimit,
    manualExempt,
    limitSource: manualLimit ? 'manual' : (lowPriority ? 'daily_usage' : ''),
    maxConcurrent: lowPriority ? 1 : null,
    activeCount: uid && activeAnalysisByUser.has(uid) ? 1 : 0,
    badgeText:
      lowPriority
        ? 'High usage detected, you have been placed on low-priority queue.'
        : '',
  };
}

function markUserAnalysisStarted(uid, metadata = {}) {
  if (!uid) return;
  activeAnalysisByUser.set(uid, {
    startedAt: Date.now(),
    ...metadata,
  });
}

function clearUserAnalysis(uid) {
  if (!uid) return;
  activeAnalysisByUser.delete(uid);
}

function getAnalysisRecoveryKey(uid, scanRequestId) {
  const safeUid = String(uid || '').trim();
  const safeRequestId = String(scanRequestId || '').trim();
  return safeUid && safeRequestId ? `${safeUid}::${safeRequestId}` : '';
}

function rememberAnalysisRecovery(uid, scanRequestId, patch = {}) {
  const key = getAnalysisRecoveryKey(uid, scanRequestId);
  if (!key) return;
  const previous = analysisRecoveryByUser.get(key) || {};
  analysisRecoveryByUser.set(key, {
    ...previous,
    ...patch,
    scanRequestId,
    updatedAt: Date.now(),
  });

  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [entryKey, entry] of analysisRecoveryByUser.entries()) {
    if ((entry?.updatedAt || 0) < cutoff) analysisRecoveryByUser.delete(entryKey);
  }
}

function readAnalysisRecovery(uid, scanRequestId) {
  const key = getAnalysisRecoveryKey(uid, scanRequestId);
  return key ? analysisRecoveryByUser.get(key) || null : null;
}

/** Process start time for /api/health uptime */
const SERVER_BOOT_AT = Date.now();

const app = express();
/** Required so express-rate-limit and secure client IP work behind Cloudflare / Vercel */
app.set('trust proxy', 1);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow all origins (Vercel previews, localhost:5174 → 127.0.0.1:3001 cross-origin, etc.)
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-admin-password'],
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));

/** Proxy RSS for frontend (News page YouTube feeds on mogcheck.net) */
app.get('/api/proxy-rss', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'Missing url param' });
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 28_000);
    const response = await fetch(targetUrl, { signal: ctrl.signal });
    clearTimeout(t);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    res.send(text);
  } catch (e) {
    console.error('[proxy-rss] failed', e.message);
    res.status(500).send('<error>Proxy failed</error>');
  }
});

const analyzeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.ANALYZE_RATE_LIMIT_MAX || 40),
  standardHeaders: true,
  legacyHeaders: false,
});
const unlockLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.UNLOCK_RATE_LIMIT_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
});

function normalizePaddlePriceId(value, fallback) {
  const candidate = String(value || '').trim();
  return candidate.startsWith('pri_') ? candidate : fallback;
}
const PADDLE_PRICE_SINGLE_SCAN = normalizePaddlePriceId(process.env.PADDLE_PRICE_SINGLE_SCAN, 'pri_01kph4qjjrtbdbnswrvdt16jkn');
const PADDLE_PRICE_PRO = normalizePaddlePriceId(process.env.PADDLE_PRICE_PRO, 'pri_01kph4pr6xpxhq7c4jfztdmr44');
const PADDLE_PRICE_PRO_YEARLY = normalizePaddlePriceId(process.env.PADDLE_PRICE_PRO_YEARLY, 'pri_01kq54g14he2zakyxr0nrt1ckc');

function parsePaddleSignature(signatureHeader = '') {
  return String(signatureHeader)
    .split(';')
    .map((part) => part.trim())
    .reduce((acc, part) => {
      const [key, value] = part.split('=');
      if (!key || !value) return acc;
      if (!acc[key]) acc[key] = [];
      acc[key].push(value);
      return acc;
    }, {});
}

function hasMatchingPaddleSignature(rawBodyBuffer, signatureHeader, secret) {
  const parsed = parsePaddleSignature(signatureHeader);
  const timestamp = parsed.ts?.[0];
  const signatures = parsed.h1 || [];
  if (!timestamp || !signatures.length) return false;

  const signedPayload = `${timestamp}:${rawBodyBuffer.toString()}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  return signatures.some((candidate) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(expected, 'utf8'));
    } catch {
      return false;
    }
  });
}

function extractPaddlePriceIds(data = {}) {
  return Array.isArray(data.items)
    ? data.items
        .map((item) => item?.price?.id || item?.price_id || null)
        .filter(Boolean)
    : [];
}

function getPaddlePeriodEnd(data = {}, fallbackPlan = 'pro') {
  const raw =
    data.current_billing_period?.ends_at ||
    data.billing_period?.ends_at ||
    data.next_billed_at ||
    data.subscription?.current_billing_period?.ends_at ||
    null;
  const parsed = raw ? new Date(raw).getTime() : 0;
  if (Number.isFinite(parsed) && parsed > Date.now()) return new Date(parsed).toISOString();
  const days = normalizeUserPlan(fallbackPlan) === 'pro_annual' ? 365 : 30;
  return new Date(Date.now() + days * 86400000).toISOString();
}

function extractPaddleTotal(data = {}) {
  const totals = data.details?.totals || data.totals || {};
  const rawTotal = totals.total ?? totals.grand_total ?? totals.subtotal ?? data.total ?? null;
  const numericTotal = rawTotal == null ? null : Number(rawTotal);
  const amount =
    Number.isFinite(numericTotal) && numericTotal > 0
      ? numericTotal >= 100
        ? (numericTotal / 100).toFixed(2)
        : numericTotal.toFixed(2)
      : null;
  return {
    amount,
    currency: String(data.currency_code || totals.currency_code || data.currency || 'USD').toUpperCase(),
  };
}

async function savePurchaseRecord(userId, record = {}) {
  if (!userId) return;
  const purchase = {
    ...record,
    userId,
    purchasedAt: admin.firestore?.FieldValue?.serverTimestamp?.() || new Date().toISOString(),
    purchasedAtMs: Date.now(),
  };
  if (!firestore) {
    if (!localPurchases[userId]) localPurchases[userId] = [];
    localPurchases[userId].unshift({
      id: purchase.id || `purchase-${Date.now()}`,
      ...purchase,
      purchasedAt: new Date().toISOString(),
    });
    localPurchases[userId] = localPurchases[userId].slice(0, 100);
    return;
  }
  const id = String(record.id || record.transactionId || record.eventId || `purchase-${Date.now()}`).slice(0, 180);
  await firestore.collection('users').doc(userId).collection('purchases').doc(id).set(purchase, { merge: true });
}

/* Legacy Lemon Squeezy webhook kept disabled on purpose.
   MogCheck billing now runs through Paddle only. */
/* app.post(
  '/api/webhooks/lemonsqueezy',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
    const signature = req.headers['x-signature'] || '';
    const rawBody = req.body;

    if (!secret) {
      console.error('[webhook] LEMONSQUEEZY_WEBHOOK_SECRET not set');
      return res.status(500).json({ error: 'Webhook not configured' });
    }

    const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (hmac !== signature) {
      console.error('[webhook] Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString());
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const eventName = event.meta?.event_name;
    const userId = event.meta?.custom_data?.user_id;
    const variantName =
      event.data?.attributes?.first_order_item?.variant_name ||
      event.data?.attributes?.variant_name ||
      event.data?.attributes?.product_name ||
      '';

    console.log(`[webhook] Event: ${eventName} | User: ${userId} | Product: ${variantName}`);

    if (!userId) {
      console.warn('[webhook] No user_id in custom data — cannot update plan');
      return res.sendStatus(200);
    }

    const userRef = firestore.collection('users').doc(userId);

    try {
      if (eventName === 'order_created') {
        const productName = (event.data?.attributes?.first_order_item?.product_name || '').toLowerCase();
        if (productName.includes('single scan')) {
          await userRef.set(
            {
              plan: 'single_scan',
              scanCredits: 1,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          console.log(`[webhook] User ${userId} → single_scan (1 credit)`);
        }
      }

      if (eventName === 'subscription_created' || eventName === 'subscription_updated') {
        const status = event.data?.attributes?.status;
        if (status === 'active') {
          const subId = String(event.data?.id || '');
          await userRef.set(
            {
              plan: 'pro',
              scanCredits: 999,
              subscriptionId: subId,
              subscriptionStatus: 'active',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          console.log(`[webhook] User ${userId} → pro (active, sub ${subId})`);
        }
      }

      if (eventName === 'subscription_cancelled' || eventName === 'subscription_expired') {
        await userRef.set(
          {
            plan: 'free',
            scanCredits: 0,
            subscriptionStatus: eventName.replace('subscription_', ''),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        console.log(`[webhook] User ${userId} → free (${eventName})`);
      }
    } catch (err) {
      console.error('[webhook] Firestore write failed:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.sendStatus(200);
  }
); */

app.post(
  '/api/webhooks/paddle',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const secret = process.env.PADDLE_WEBHOOK_SECRET;
    const signature = req.headers['paddle-signature'] || '';
    const rawBody = req.body;

    if (!secret) {
      console.error('[webhook] PADDLE_WEBHOOK_SECRET not set');
      return res.status(500).json({ error: 'Webhook not configured' });
    }

    if (!hasMatchingPaddleSignature(rawBody, signature, secret)) {
      console.error('[webhook] Invalid Paddle signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString());
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const eventName = event.event_type;
    const data = event.data || {};
    const userId = data.custom_data?.user_id;
    const priceIds = extractPaddlePriceIds(data);

    console.log(`[webhook:paddle] Event: ${eventName} | User: ${userId} | Prices: ${priceIds.join(', ')}`);

    if (!userId) {
      console.warn('[webhook:paddle] No user_id in custom data - cannot update plan');
      return res.sendStatus(200);
    }

    const userRef = firestore.collection('users').doc(userId);

    try {
      if (eventName === 'transaction.completed') {
        const isYearlyPurchase = PADDLE_PRICE_PRO_YEARLY && priceIds.includes(PADDLE_PRICE_PRO_YEARLY);
        const purchasePlan = priceIds.includes(PADDLE_PRICE_SINGLE_SCAN)
          ? 'two_scans'
          : isYearlyPurchase
            ? 'pro_annual'
            : 'pro_monthly';
        const total = extractPaddleTotal(data);
        await savePurchaseRecord(userId, {
          id: String(data.id || event.event_id || `purchase-${Date.now()}`),
          eventId: event.event_id || null,
          transactionId: String(data.id || ''),
          subscriptionId: String(data.subscription_id || ''),
          plan: purchasePlan,
          label: getPlanLabel(purchasePlan),
          priceIds,
          amount: total.amount,
          currency: total.currency,
          status: String(data.status || 'completed'),
        }).catch((purchaseErr) => console.warn('[webhook:paddle] Purchase record failed:', purchaseErr.message));

        if (priceIds.includes(PADDLE_PRICE_SINGLE_SCAN)) {
          await userRef.set(
            {
              plan: 'single_scan',
              scanCredits: admin.firestore.FieldValue.increment(2),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          console.log(`[webhook:paddle] User ${userId} -> single_scan (+2 credits)`);
        }

        if (
          priceIds.includes(PADDLE_PRICE_PRO) ||
          (PADDLE_PRICE_PRO_YEARLY && priceIds.includes(PADDLE_PRICE_PRO_YEARLY)) ||
          data.subscription_id
        ) {
          await userRef.set(
            {
              plan: isYearlyPurchase ? 'pro_annual' : 'pro_monthly',
              planLabel: getPlanLabel(isYearlyPurchase ? 'pro_annual' : 'pro_monthly'),
              scanCredits: 999,
              subscriptionId: String(data.subscription_id || ''),
              subscriptionStatus: 'active',
              subscriptionCurrentPeriodEnd: getPaddlePeriodEnd(data, isYearlyPurchase ? 'pro_annual' : 'pro_monthly'),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          console.log(`[webhook:paddle] User ${userId} -> ${isYearlyPurchase ? 'pro_annual' : 'pro_monthly'} (transaction completed)`);
        }
      }

      if (
        ['subscription.created', 'subscription.activated', 'subscription.updated', 'subscription.resumed', 'subscription.trialing'].includes(eventName)
      ) {
        const status = String(data.status || 'active').toLowerCase();
        const subscriptionPlan = priceIds.includes(PADDLE_PRICE_PRO_YEARLY) ? 'pro_annual' : 'pro_monthly';
        await userRef.set(
          {
            plan: subscriptionPlan,
            planLabel: getPlanLabel(subscriptionPlan),
            scanCredits: 999,
            subscriptionId: String(data.id || ''),
            subscriptionStatus: status || 'active',
            subscriptionCurrentPeriodEnd: getPaddlePeriodEnd(data, subscriptionPlan),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        await savePurchaseRecord(userId, {
          id: String(data.id || event.event_id || `subscription-${Date.now()}`),
          eventId: event.event_id || null,
          transactionId: '',
          subscriptionId: String(data.id || ''),
          plan: subscriptionPlan,
          label: getPlanLabel(subscriptionPlan),
          priceIds,
          amount: null,
          currency: 'USD',
          status: status || 'active',
          source: 'subscription',
        }).catch((purchaseErr) => console.warn('[webhook:paddle] Subscription purchase record failed:', purchaseErr.message));
        console.log(`[webhook:paddle] User ${userId} -> ${subscriptionPlan} (${status || eventName})`);
      }

      if (
        ['subscription.canceled', 'subscription.paused', 'subscription.past_due', 'subscription.expired'].includes(eventName)
      ) {
        const status = String(data.status || eventName.replace('subscription.', '')).toLowerCase();
        await userRef.set(
          {
            plan: 'free',
            scanCredits: 0,
            subscriptionStatus: status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        console.log(`[webhook:paddle] User ${userId} -> free (${status})`);
      }
    } catch (err) {
      console.error('[webhook:paddle] Firestore write failed:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.sendStatus(200);
  }
);

app.use(express.json({ limit: '2mb' }));

/** In-memory fallback for mog battles if firestore is missing */
const localMogBattles = {};
const localMogVotes = {}; // { battleId: { uid: side } }
const localCommunityBattles = []; // Array of community battles
const localCommunityScans = [];
const localNotifications = {}; // { uid: [{ id, title, body, url, read, createdAt }] }
const localMogBattleFollows = {}; // { battleId: { uid: true } }
const localActivityEvents = [];
const localUserActivity = {};
const localPurchases = {};
const PROFILE_SCAN_HISTORY_LIMIT = 10;
const MOG_BATTLE_FAKE_VOTES_ENABLED = process.env.MOG_BATTLE_FAKE_VOTES !== '0';
const MOG_BATTLE_FAKE_VOTE_EPOCH = Date.parse(process.env.MOG_BATTLE_FAKE_VOTE_EPOCH || '2026-04-27T00:00:00.000Z');
const MOG_BATTLE_BANNED_NAME_TERMS = [
  'porn', 'porno', 'xxx', 'nsfw', 'nude', 'nudes', 'naked', 'sex', 'sexual',
  'onlyfans', 'pornhub', 'xvideos', 'xnxx',
  'dick', 'cock', 'penis', 'pussy', 'vagina', 'boob', 'boobs', 'tits',
  'fuck', 'fucker', 'fucking', 'shit', 'bitch', 'cunt', 'whore', 'slut',
  'nigger', 'nigga', 'faggot', 'retard'
];

function getClientPlatform(req) {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  if (/(mobi|android|iphone|ipad|ipod|opera mini|opera mobi|iemobile|mobile safari)/i.test(ua)) {
    return 'mobile';
  }
  return 'desktop';
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || '';
}

function serializeActivityEvent(input = {}) {
  return {
    ...input,
    timestamp:
      input.timestamp?.toDate?.()?.toISOString?.() ||
      (typeof input.timestamp?.seconds === 'number' ? new Date(input.timestamp.seconds * 1000).toISOString() : input.timestamp || null),
  };
}

function serializePurchase(input = {}) {
  return {
    ...input,
    purchasedAt:
      input.purchasedAt?.toDate?.()?.toISOString?.() ||
      (typeof input.purchasedAt?.seconds === 'number' ? new Date(input.purchasedAt.seconds * 1000).toISOString() : input.purchasedAt || null),
  };
}

function buildPlanPurchaseFallback(userData = {}) {
  const plan = normalizeUserPlan(userData.plan || '');
  const subscriptionId = String(userData.subscriptionId || '').trim();
  if (!isProPlanValue(plan)) return null;
  const updatedMs = timestampMs(userData.updatedAt) || Date.now();
  return {
    id: subscriptionId ? `subscription-${subscriptionId}` : `plan-${plan}-${updatedMs}`,
    plan,
    label: getPlanLabel(plan),
    amount: null,
    currency: 'USD',
    status: userData.subscriptionStatus || 'active',
    subscriptionId,
    purchasedAt: new Date(updatedMs).toISOString(),
    purchasedAtMs: updatedMs,
    source: 'subscription',
  };
}

async function recordActivityEvent(req, event = {}) {
  const uid = event.uid || req.uid || null;
  const now = Date.now();
  const base = {
    type: String(event.type || 'page').slice(0, 80),
    uid,
    email: event.email || req.userEmail || null,
    visitorId: String(event.visitorId || req.body?.visitorId || uid || getClientIp(req) || 'unknown').slice(0, 160),
    platform: String(event.platform || req.body?.platform || getClientPlatform(req)).slice(0, 40),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
    ip: getClientIp(req),
    timestamp: admin.firestore?.FieldValue?.serverTimestamp?.() || new Date(now).toISOString(),
    timestampMs: now,
    ...event,
  };

  if (!firestore) {
    const localEvent = { id: `activity-${now}-${Math.random().toString(36).slice(2)}`, ...base, timestamp: new Date(now).toISOString() };
    localActivityEvents.unshift(localEvent);
    if (localActivityEvents.length > 5000) localActivityEvents.length = 5000;
    if (uid) {
      if (!localUserActivity[uid]) localUserActivity[uid] = [];
      localUserActivity[uid].unshift(localEvent);
      localUserActivity[uid] = localUserActivity[uid].slice(0, 300);
    }
    return localEvent;
  }

  const globalRef = firestore.collection('activityEvents').doc();
  const writes = [globalRef.set(base)];
  if (uid) {
    writes.push(firestore.collection('users').doc(uid).collection('activity').doc(globalRef.id).set(base));
    writes.push(firestore.collection('users').doc(uid).set({
      lastActive: admin.firestore.FieldValue.serverTimestamp(),
      lastIp: base.ip || null,
      lastPlatform: base.platform || null,
      email: base.email || null,
    }, { merge: true }));
  }
  const results = await Promise.allSettled(writes);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) {
    console.warn('[activity] Activity write partially failed:', failed.reason?.message || failed.reason);
  }
  return { id: globalRef.id, ...base };
}

function buildVisitorBuckets(range = '24h') {
  const now = Date.now();
  const configs = {
    hour: { spanMs: 60 * 60 * 1000, bucketMs: 5 * 60 * 1000, label: 'Last hour' },
    '6h': { spanMs: 6 * 60 * 60 * 1000, bucketMs: 30 * 60 * 1000, label: 'Last 6 hours' },
    '24h': { spanMs: 24 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000, label: 'Last 24 hours' },
    week: { spanMs: 7 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000, label: 'Last week' },
  };
  const config = configs[range] || configs['24h'];
  const count = Math.ceil(config.spanMs / config.bucketMs);
  const startMs = now - config.spanMs;
  return {
    range: configs[range] ? range : '24h',
    label: config.label,
    startMs,
    bucketMs: config.bucketMs,
    buckets: Array.from({ length: count }, (_, index) => {
      const bucketStart = startMs + index * config.bucketMs;
      return {
        startMs: bucketStart,
        endMs: bucketStart + config.bucketMs,
        label:
          range === 'week'
            ? new Date(bucketStart).toLocaleDateString([], { weekday: 'short' })
            : new Date(bucketStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        visitors: new Set(),
      };
    }),
  };
}
const MOG_BATTLE_COMPACT_BANNED_NAME_TERMS = new Set([
  'porn', 'porno', 'xxx', 'nsfw', 'onlyfans', 'pornhub', 'xvideos', 'xnxx',
  'penis', 'pussy', 'vagina', 'boobs', 'fucker', 'fucking', 'cunt', 'whore', 'slut',
  'nigger', 'nigga', 'faggot', 'retard'
]);

function getMogBattleNameError(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/(https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|gg|io|co|app|xyz|link|site|me)\b)/i.test(raw)) {
    return 'Mog Battle names cannot contain links.';
  }
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const compact = raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const hasBannedTerm = MOG_BATTLE_BANNED_NAME_TERMS.some((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i').test(normalized) ||
      (MOG_BATTLE_COMPACT_BANNED_NAME_TERMS.has(term) && compact.includes(term));
  });
  return hasBannedTerm ? 'Mog Battle names cannot contain inappropriate words.' : null;
}

function hashMogBattleSeed(value) {
  const input = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getSyntheticMogBattleVotes(battleId) {
  const id = String(battleId || '').trim();
  if (!MOG_BATTLE_FAKE_VOTES_ENABLED || !id) return { a: 0, b: 0, total: 0 };
  const seed = hashMogBattleSeed(id);
  const cap = 60 + (seed % 61);
  const epoch = Number.isFinite(MOG_BATTLE_FAKE_VOTE_EPOCH)
    ? MOG_BATTLE_FAKE_VOTE_EPOCH
    : Date.UTC(2026, 3, 27);
  const intervalMs = (86 + (seed % 42)) * 60 * 1000;
  const steps = Math.max(0, Math.floor((Date.now() - epoch) / intervalMs));
  let total = 0;
  let a = 0;
  let b = 0;

  for (let step = 0; step < steps && total < cap; step += 1) {
    const stepSeed = hashMogBattleSeed(`${id}:${step}`);
    const add = Math.min(cap - total, 1 + (stepSeed % 3));
    if (stepSeed % 2 === 0) a += add;
    else b += add;
    total += add;
  }

  return { a, b, total };
}

function getDisplayedMogBattleVotes(battleId, votesA = 0, votesB = 0) {
  const synthetic = getSyntheticMogBattleVotes(battleId);
  return {
    a: (Number(votesA) || 0) + synthetic.a,
    b: (Number(votesB) || 0) + synthetic.b,
  };
}

function storedTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

async function pruneFirestoreProfileScans(uid, profileId = 'default', limit = PROFILE_SCAN_HISTORY_LIMIT) {
  if (!firestore || !uid) return;
  const normalizedProfileId = profileId || 'default';
  const snap = await firestore.collection('users').doc(uid).collection('scans').get();
  const profileDocs = [];
  snap.forEach((doc) => {
    const data = doc.data() || {};
    if ((data.profileId || data.payload?.profileId || 'default') !== normalizedProfileId) return;
    profileDocs.push({ ref: doc.ref, data });
  });
  profileDocs.sort((a, b) => storedTimestampMillis(b.data.timestamp || b.data.scannedAt) - storedTimestampMillis(a.data.timestamp || a.data.scannedAt));
  const staleDocs = profileDocs.slice(limit);
  if (!staleDocs.length) return;
  await Promise.all(staleDocs.map((doc) => doc.ref.delete()));
  console.log(`[analyze] Pruned ${staleDocs.length} old scan(s) for profile ${normalizedProfileId}`);
}

function normalizeScanVisibility(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['private', 'unlisted', 'public', 'community'].includes(normalized)) {
    return normalized === 'public' ? 'community' : normalized;
  }
  return 'private';
}

function getCommunityScanDocId(uid, scanId) {
  return `${String(uid || '').trim()}__${String(scanId || '').trim()}`;
}

async function buildCommunityScanDoc(uid, scanId, scanData) {
  const payload = scanData?.payload && typeof scanData.payload === 'object' ? scanData.payload : {};
  const normalizedScanData = normalizeStoredScanUrls(scanData || {});
  const normalizedPayload = normalizedScanData?.payload && typeof normalizedScanData.payload === 'object'
    ? normalizedScanData.payload
    : payload;
  let profileName = 'Profile Scan';
  if (firestore && scanData?.profileId && scanData.profileId !== 'default') {
    try {
      const profileSnap = await firestore
        .collection('users')
        .doc(uid)
        .collection('profiles')
        .doc(scanData.profileId)
        .get();
      if (profileSnap.exists) {
        profileName = String(profileSnap.data()?.name || profileName).trim() || profileName;
      }
    } catch (e) {
      console.warn('[community-scans] failed to read profile name:', e.message);
    }
  }

  return {
    ownerUid: uid,
    scanId,
    profileId: scanData?.profileId || 'default',
    profileName,
    visibility: 'community',
    model: String(scanData?.model || payload?.selectedModel || '').trim() || '1',
    cohesiveFrontSide: Boolean(scanData?.cohesiveFrontSide || payload?.cohesiveFrontSide),
    finalRating: Number(scanData?.finalRating) || 0,
    sideRating: Number(scanData?.sideRating) || 0,
    sex: payload?.sex || null,
    frontImageUrl: normalizedScanData?.frontImageUrl || normalizedPayload?.frontImage || null,
    sideImageUrl: normalizedScanData?.sideImageUrl || normalizedPayload?.sideImage || null,
    payload: {
      ...normalizedPayload,
      frontImage: normalizedScanData?.frontImageUrl || normalizedPayload?.frontImage || null,
      sideImage: normalizedScanData?.sideImageUrl || normalizedPayload?.sideImage || null,
      selectedModel: String(scanData?.model || payload?.selectedModel || '').trim() || '1',
      cohesiveFrontSide: Boolean(scanData?.cohesiveFrontSide || payload?.cohesiveFrontSide),
    },
    timestamp: scanData?.timestamp || admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function syncCommunityScanVisibility(uid, scanId, scanData, visibility) {
  const normalizedVisibility = normalizeScanVisibility(visibility);
  const docId = getCommunityScanDocId(uid, scanId);

  if (!firestore) {
    const localIndex = localCommunityScans.findIndex((item) => item.id === docId);
    if (normalizedVisibility === 'community') {
      const doc = await buildCommunityScanDoc(uid, scanId, scanData);
      const nextDoc = { id: docId, ...doc };
      if (localIndex >= 0) localCommunityScans[localIndex] = nextDoc;
      else localCommunityScans.unshift(nextDoc);
    } else if (localIndex >= 0) {
      localCommunityScans.splice(localIndex, 1);
    }
    return;
  }

  const docRef = firestore.collection('communityScans').doc(docId);
  if (normalizedVisibility === 'community') {
    const doc = await buildCommunityScanDoc(uid, scanId, scanData);
    await docRef.set(doc, { merge: true });
  } else {
    await docRef.delete().catch(() => {});
  }
}

async function makeMogBattleFighterUnlistedForOwner(uid, fighter) {
  const scanId = String(fighter?.scanId || '').trim();
  const ownerUid = String(fighter?.ownerUid || fighter?.uid || uid || '').trim();
  const profileId = String(fighter?.profileId || '').trim();
  const visibility = normalizeScanVisibility(fighter?.visibility);
  const nextFighter = { ...fighter };

  if (ownerUid !== uid || !scanId) return nextFighter;

  nextFighter.ownerUid = uid;
  if (!nextFighter.uid) nextFighter.uid = uid;

  if (!['unlisted', 'community'].includes(visibility)) {
    const scanRef = firestore.collection('users').doc(uid).collection('scans').doc(scanId);
    const scanSnap = await scanRef.get();
    if (scanSnap.exists) {
      await scanRef.set(
        {
          visibility: 'unlisted',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      nextFighter.visibility = 'unlisted';
    }
  }

  if (profileId) {
    await firestore
      .collection('users')
      .doc(uid)
      .collection('profiles')
      .doc(profileId)
      .set(
        {
          visibility: 'unlisted',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  }

  return nextFighter;
}

async function deleteFirestoreCollection(collectionRef, batchSize = 200) {
  if (!collectionRef) return;
  while (true) {
    const snap = await collectionRef.limit(batchSize).get();
    if (snap.empty) break;
    const batch = firestore.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    if (snap.size < batchSize) break;
  }
}

async function deleteMogBattleEverywhere(battleId) {
  const id = String(battleId || '').trim();
  if (!id) return false;

  if (!firestore) {
    const before = localCommunityBattles.length;
    const nextBattles = localCommunityBattles.filter((battle) => String(battle.id) !== id);
    localCommunityBattles.splice(0, localCommunityBattles.length, ...nextBattles);
    delete localMogBattles[id];
    delete localMogVotes[id];
    delete localMogBattleFollows[id];
    return before !== localCommunityBattles.length;
  }

  const communityRef = firestore.collection('mogBattlesCommunity').doc(id);
  const tallyRef = firestore.collection('mogBattles').doc(id);
  const communitySnap = await communityRef.get();
  const tallySnap = await tallyRef.get();
  await Promise.all([
    deleteFirestoreCollection(tallyRef.collection('voters')).catch(() => {}),
    deleteFirestoreCollection(tallyRef.collection('followers')).catch(() => {}),
    deleteFirestoreCollection(tallyRef.collection('adminVoteEvents')).catch(() => {}),
  ]);
  await Promise.all([
    communityRef.delete().catch(() => {}),
    tallyRef.delete().catch(() => {}),
  ]);
  return communitySnap.exists || tallySnap.exists;
}

async function createNotification(uid, payload = {}) {
  const safeUid = String(uid || '').trim();
  if (!safeUid) return null;
  const doc = {
    title: String(payload.title || 'MogCheck').slice(0, 140),
    body: String(payload.body || '').slice(0, 1000),
    url: payload.url ? String(payload.url).slice(0, 500) : '',
    type: String(payload.type || 'general').slice(0, 80),
    read: false,
    createdAt: firestore ? admin.firestore.FieldValue.serverTimestamp() : new Date().toISOString(),
  };

  if (!firestore) {
    const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const localDoc = { id, ...doc, createdAt: new Date().toISOString() };
    localNotifications[safeUid] = [localDoc, ...(localNotifications[safeUid] || [])].slice(0, 100);
    return localDoc;
  }

  const ref = await firestore.collection('users').doc(safeUid).collection('notifications').add(doc);
  return { id: ref.id, ...doc };
}

function serializeNotification(doc) {
  const data = typeof doc.data === 'function' ? doc.data() : doc;
  return {
    id: doc.id || data.id || '',
    title: data.title || 'MogCheck',
    body: data.body || '',
    url: data.url || '',
    type: data.type || 'general',
    read: Boolean(data.read),
    createdAt:
      data.createdAt?.toDate?.()?.toISOString?.() ||
      (typeof data.createdAt?.seconds === 'number' ? new Date(data.createdAt.seconds * 1000).toISOString() : data.createdAt || null),
  };
}

function requireFirestore(req, res, next) {
  // If firestore is null, we will use the local fallback in the routes.
  // We no longer block the request.
  next();
}

const mogBattleVoteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.MOG_BATTLE_VOTE_RATE_MAX || 25),
  standardHeaders: true,
  legacyHeaders: false,
});

function isValidMogBattleId(id) {
  return typeof id === 'string' && /^[a-z0-9:_-]{1,140}$/i.test(id);
}

/** Comma-separated (e.g. MOG_BATTLE_ADMIN_EMAILS=you@x.com,other@y.com) — may increment tallies repeatedly. */
function getMogBattleAdminEmails() {
  return (process.env.MOG_BATTLE_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isMogBattleAdminEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return getMogBattleAdminEmails().includes(email.trim().toLowerCase());
}

async function getMogBattleFollowerUids(battleId) {
  const id = String(battleId || '').trim();
  if (!id) return [];
  if (!firestore) return Object.keys(localMogBattleFollows[id] || {});

  try {
    const snap = await firestore.collection('mogBattles').doc(id).collection('followers').limit(500).get();
    const uids = [];
    snap.forEach((doc) => {
      if (doc.id) uids.push(doc.id);
    });
    return uids;
  } catch (e) {
    console.warn('[mog-battle] failed to load followers:', e.message);
    return [];
  }
}

async function notifyMogBattleFollowers({ battleId, battle, voterUid, previousA, previousB, nextA, nextB }) {
  const id = String(battleId || '').trim();
  if (!id) return;

  const followerUids = await getMogBattleFollowerUids(id);
  if (!followerUids.length) return;

  const totalVotes = (Number(nextA) || 0) + (Number(nextB) || 0);
  const previousLeader = getBattleLeader(previousA, previousB);
  const nextLeader = getBattleLeader(nextA, nextB);
  const isInteresting =
    isBattleMilestone(totalVotes) ||
    (previousLeader !== 'tie' && nextLeader !== 'tie' && previousLeader !== nextLeader);

  const title = isInteresting ? 'Followed Battle Update' : 'Followed Battle Vote';
  const body = isInteresting
    ? `${battleName(battle)} now has ${totalVotes} votes${previousLeader !== nextLeader ? ' and the leader changed.' : '.'}`
    : `Someone voted on ${battleName(battle)}.`;

  await Promise.all(
    followerUids
      .filter((recipientUid) => recipientUid && recipientUid !== voterUid)
      .map((recipientUid) =>
        createNotification(recipientUid, {
          type: isInteresting ? 'mog_battle_follow_update' : 'mog_battle_follow_vote',
          title,
          body,
          url: `/mog-battles?battle=${encodeURIComponent(id)}`,
        }).catch((notifyErr) => {
          console.warn('[notifications] follower vote notification failed:', notifyErr.message);
        })
      )
  );
}

function getBattleLeader(votesA, votesB) {
  const a = Number(votesA) || 0;
  const b = Number(votesB) || 0;
  if (a === b) return 'tie';
  return a > b ? 'a' : 'b';
}

function isBattleMilestone(totalVotes) {
  const total = Number(totalVotes) || 0;
  if (total <= 0) return false;
  if ([5, 10, 25, 50, 100].includes(total)) return true;
  return total > 100 && total % 100 === 0;
}

function battleName(battle) {
  return `${battle?.fighterA?.name || 'Scan'} vs ${battle?.fighterB?.name || 'Scan'}`;
}

/** Public tallies — same numbers for every client worldwide. */
app.get('/api/mog-battle/votes/:battleId', requireFirestore, async (req, res) => {
  const battleId = String(req.params.battleId || '').trim();
  if (!isValidMogBattleId(battleId)) {
    return res.status(400).json({ error: 'Invalid battle id' });
  }

  if (!firestore) {
    const d = localMogBattles[battleId] || { votesA: 0, votesB: 0 };
    return res.json(getDisplayedMogBattleVotes(battleId, d.votesA, d.votesB));
  }

  try {
    const snap = await firestore.collection('mogBattles').doc(battleId).get();
    if (!snap.exists) {
      return res.json(getDisplayedMogBattleVotes(battleId, 0, 0));
    }
    const d = snap.data() || {};
    return res.json(getDisplayedMogBattleVotes(battleId, d.votesA, d.votesB));
  } catch (e) {
    console.error('[mog-battle] GET votes', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

/** One vote per Firebase account — check before showing the vote UI. */
app.get('/api/mog-battle/my-vote/:battleId', requireFirestore, async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const battleId = String(req.params.battleId || '').trim();
  if (!isValidMogBattleId(battleId)) {
    return res.status(400).json({ error: 'Invalid battle id' });
  }
  if (!token) {
    return res.status(401).json({ voted: false, error: 'Sign in required' });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;
    if (isMogBattleAdminEmail(decoded.email)) {
      return res.json({ voted: false, isBattleAdmin: true });
    }

    if (!firestore) {
      const voteMap = localMogVotes[battleId] || {};
      const side = voteMap[uid];
      if (side) return res.json({ voted: true, side });
      return res.json({ voted: false });
    }

    const v = await firestore
      .collection('mogBattles')
      .doc(battleId)
      .collection('voters')
      .doc(uid)
      .get();
    if (!v.exists) {
      return res.json({ voted: false });
    }
    const side = v.data()?.side === 'b' ? 'b' : 'a';
    return res.json({ voted: true, side });
  } catch (e) {
    console.error('[mog-battle] my-vote', e.message);
    return res.status(401).json({ voted: false, error: 'Invalid session' });
  }
});

app.get('/api/mog-battle/follows', requireFirestore, async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Sign in required' });

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;

    if (!firestore) {
      const battleIds = Object.entries(localMogBattleFollows)
        .filter(([, followers]) => Boolean(followers?.[uid]))
        .map(([battleId]) => battleId);
      return res.json({ battleIds });
    }

    let snap;
    try {
      snap = await firestore.collection('users').doc(uid).collection('mogBattleFollows').orderBy('updatedAt', 'desc').limit(200).get();
    } catch (orderErr) {
      console.warn('[mog-battle] follows orderBy failed, falling back:', orderErr.message);
      snap = await firestore.collection('users').doc(uid).collection('mogBattleFollows').limit(200).get();
    }

    const battleIds = [];
    snap.forEach((doc) => battleIds.push(doc.id));
    return res.json({ battleIds });
  } catch (e) {
    console.error('[mog-battle] follows GET', e.message);
    return res.status(401).json({ error: 'Invalid session' });
  }
});

app.post('/api/mog-battle/follow', requireFirestore, async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const battleId = String(req.body?.battleId || '').trim();
  const following = Boolean(req.body?.following);

  if (!token) return res.status(401).json({ error: 'Sign in required' });
  if (!isValidMogBattleId(battleId)) return res.status(400).json({ error: 'Invalid battle id' });

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;

    if (!firestore) {
      if (!localMogBattleFollows[battleId]) localMogBattleFollows[battleId] = {};
      if (following) localMogBattleFollows[battleId][uid] = true;
      else delete localMogBattleFollows[battleId][uid];
      return res.json({ ok: true, battleId, following });
    }

    const userFollowRef = firestore.collection('users').doc(uid).collection('mogBattleFollows').doc(battleId);
    const battleFollowerRef = firestore.collection('mogBattles').doc(battleId).collection('followers').doc(uid);

    if (following) {
      const doc = {
        battleId,
        uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await Promise.all([
        userFollowRef.set(doc, { merge: true }),
        battleFollowerRef.set(doc, { merge: true }),
      ]);
    } else {
      await Promise.all([
        userFollowRef.delete().catch(() => {}),
        battleFollowerRef.delete().catch(() => {}),
      ]);
    }

    return res.json({ ok: true, battleId, following });
  } catch (e) {
    console.error('[mog-battle] follow POST', e.message);
    return res.status(401).json({ error: 'Invalid session' });
  }
});

/** Community Mog Battles */
app.get('/api/mog-battle/community', requireFirestore, async (req, res) => {
  if (!firestore) {
    return res.json({
      battles: localCommunityBattles.map((battle) => {
        const displayedVotes = getDisplayedMogBattleVotes(battle.id, battle.votesA, battle.votesB);
        return { ...battle, votesA: displayedVotes.a, votesB: displayedVotes.b };
      }),
    });
  }
  try {
    let snap;
    try {
      snap = await firestore.collection('mogBattlesCommunity').orderBy('createdAt', 'desc').limit(50).get();
    } catch (orderErr) {
      console.warn('[mog-battle] community orderBy failed, falling back:', orderErr.message);
      snap = await firestore.collection('mogBattlesCommunity').limit(50).get();
    }
    const battles = [];
    snap.forEach((doc) => battles.push({ id: doc.id, ...doc.data() }));
    const tallySnaps = await Promise.all(
      battles.map((b) => firestore.collection('mogBattles').doc(b.id).get())
    );
    tallySnaps.forEach((tallySnap, i) => {
      if (tallySnap.exists) {
        const t = tallySnap.data() || {};
        const displayedVotes = getDisplayedMogBattleVotes(battles[i].id, t.votesA, t.votesB);
        battles[i].votesA = displayedVotes.a;
        battles[i].votesB = displayedVotes.b;
      }
    });
    return res.json({ battles });
  } catch (e) {
    console.error('[mog-battle] GET community', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/mog-battle/community', requireFirestore, async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Sign in to submit a battle' });
  
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const { fighterA, fighterB } = req.body;
    
    if (!fighterA || !fighterB) return res.status(400).json({ error: 'Missing fighters' });
    const nameError = getMogBattleNameError(fighterA.name) || getMogBattleNameError(fighterB.name);
    if (nameError) return res.status(400).json({ error: nameError });

    const [battleFighterA, battleFighterB] = firestore
      ? await Promise.all([
          makeMogBattleFighterUnlistedForOwner(decoded.uid, fighterA),
          makeMogBattleFighterUnlistedForOwner(decoded.uid, fighterB),
        ])
      : [fighterA, fighterB];

    const battleData = {
      creatorId: decoded.uid,
      fighterA: battleFighterA,
      fighterB: battleFighterB,
      votesA: 0,
      votesB: 0,
      createdAt: firestore ? admin.firestore.FieldValue.serverTimestamp() : new Date().toISOString()
    };

    if (!firestore) {
      const id = 'comm_' + Date.now();
      const b = { id, ...battleData };
      localCommunityBattles.unshift(b);
      localMogBattles[id] = { votesA: 0, votesB: 0 };
      return res.json({ success: true, battle: b });
    }

    const docRef = await firestore.collection('mogBattlesCommunity').add(battleData);
    // Also create the tally doc
    await firestore.collection('mogBattles').doc(docRef.id).set({
      votesA: 0,
      votesB: 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.json({ success: true, battle: { id: docRef.id, ...battleData } });
  } catch (e) {
    console.error('[mog-battle] POST community', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/mog-battle/community/:battleId', requireFirestore, async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Sign in to delete this battle' });

  const battleId = String(req.params.battleId || '').trim();
  if (!battleId) return res.status(400).json({ error: 'Missing battle id' });

  try {
    const decoded = await admin.auth().verifyIdToken(token);

    if (!firestore) {
      const battle = localCommunityBattles.find((item) => String(item.id) === battleId);
      if (!battle) return res.status(404).json({ error: 'Battle not found' });
      if (String(battle.creatorId || '') !== decoded.uid) return res.status(403).json({ error: 'You can only delete your own battle' });
      await deleteMogBattleEverywhere(battleId);
      return res.json({ ok: true });
    }

    const battleSnap = await firestore.collection('mogBattlesCommunity').doc(battleId).get();
    if (!battleSnap.exists) return res.status(404).json({ error: 'Battle not found' });
    const battle = battleSnap.data() || {};
    if (String(battle.creatorId || '') !== decoded.uid) return res.status(403).json({ error: 'You can only delete your own battle' });
    await deleteMogBattleEverywhere(battleId);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[mog-battle] DELETE community', e.message || e);
    return res.status(401).json({ error: 'Invalid session' });
  }
});

app.delete('/api/admin/mog-battles/:battleId', async (req, res) => {
  const pw = req.headers['x-admin-password'] || '';
  if (!adminStore.checkPassword(pw)) return res.status(401).json({ error: 'Invalid admin password' });
  const battleId = String(req.params.battleId || '').trim();
  if (!battleId) return res.status(400).json({ error: 'Missing battle id' });

  try {
    const deleted = await deleteMogBattleEverywhere(battleId);
    if (!deleted) return res.status(404).json({ error: 'Battle not found' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[admin] Failed to delete Mog Battle:', e);
    if (isQuotaExceededError(e)) {
      return res.status(503).json({ error: 'Firestore quota exceeded. Try again when quota resets.' });
    }
    return res.status(500).json({ error: e.message || 'Failed to delete Mog Battle' });
  }
});

app.get('/api/community-scans', requireFirestore, async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);

  if (!firestore) {
    return res.json({ scans: localCommunityScans.slice(0, limit) });
  }

  try {
    let snap;
    try {
      snap = await firestore.collection('communityScans').orderBy('timestamp', 'desc').limit(limit).get();
    } catch (orderErr) {
      console.warn('[community-scans] orderBy failed, falling back:', orderErr.message);
      snap = await firestore.collection('communityScans').limit(limit).get();
    }
    const scans = [];
    snap.forEach((doc) => scans.push(normalizeStoredScanUrls({ id: doc.id, ...doc.data() })));
    scans.sort((a, b) => {
      if (Boolean(a.officialScan || a.official) !== Boolean(b.officialScan || b.official)) {
        return (a.officialScan || a.official) ? -1 : 1;
      }
      const aMs = a?.timestamp?.toMillis?.() || (typeof a?.timestamp?.seconds === 'number' ? a.timestamp.seconds * 1000 : new Date(a?.timestamp || 0).getTime() || 0);
      const bMs = b?.timestamp?.toMillis?.() || (typeof b?.timestamp?.seconds === 'number' ? b.timestamp.seconds * 1000 : new Date(b?.timestamp || 0).getTime() || 0);
      return bMs - aMs;
    });
    return res.json({ scans });
  } catch (e) {
    console.error('[community-scans] GET failed', e);
    if (isQuotaExceededError(e)) {
      return res.json({ scans: localCommunityScans.slice(0, limit), warning: 'Firestore quota exhausted; using local fallback.' });
    }
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/community-scans/:scanDocId/official', async (req, res) => {
  const pw = req.headers['x-admin-password'] || '';
  if (!adminStore.checkPassword(pw)) return res.status(401).json({ error: 'Invalid admin password' });
  const scanDocId = String(req.params.scanDocId || '').trim();
  if (!scanDocId) return res.status(400).json({ error: 'Missing scan id' });
  const official = req.body?.official !== false;

  if (!firestore) {
    const match = localCommunityScans.find((scan) => scan.id === scanDocId || scan.scanId === scanDocId);
    if (match) {
      match.officialScan = official;
      match.official = official;
    }
    return res.json({ ok: true, officialScan: official, local: true });
  }

  try {
    await firestore.collection('communityScans').doc(scanDocId).set({
      officialScan: official,
      official,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return res.json({ ok: true, officialScan: official });
  } catch (e) {
    console.error('[admin] Failed to mark community scan official:', e);
    if (isQuotaExceededError(e)) {
      return res.status(503).json({ error: 'Firestore quota exceeded. Try again when quota resets.' });
    }
    return res.status(500).json({ error: e.message || 'Failed to mark official' });
  }
});

app.delete('/api/admin/community-scans/:scanDocId', async (req, res) => {
  const pw = req.headers['x-admin-password'] || '';
  if (!adminStore.checkPassword(pw)) return res.status(401).json({ error: 'Invalid admin password' });
  const scanDocId = String(req.params.scanDocId || '').trim();
  if (!scanDocId) return res.status(400).json({ error: 'Missing scan id' });

  if (!firestore) {
    const before = localCommunityScans.length;
    const nextScans = localCommunityScans.filter((scan) => scan.id !== scanDocId && scan.scanId !== scanDocId);
    localCommunityScans.splice(0, localCommunityScans.length, ...nextScans);
    return res.json({ ok: true, local: true, removed: before !== localCommunityScans.length });
  }

  try {
    await firestore.collection('communityScans').doc(scanDocId).delete();
    return res.json({ ok: true });
  } catch (e) {
    console.error('[admin] Failed to delete community scan listing:', e);
    if (isQuotaExceededError(e)) {
      return res.status(503).json({ error: 'Firestore quota exceeded. Try again when quota resets.' });
    }
    return res.status(500).json({ error: e.message || 'Failed to delete community scan listing' });
  }
});

/** Record vote — transactional; duplicate UID returns 409 with current tallies. */
app.post('/api/mog-battle/vote', mogBattleVoteLimiter, requireFirestore, async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: 'Sign in to vote' });
  }
  const battleId = String(req.body?.battleId || '').trim();
  const side = String(req.body?.side || '').trim();
  if (!isValidMogBattleId(battleId)) {
    return res.status(400).json({ error: 'Invalid battle id' });
  }
  if (side !== 'a' && side !== 'b') {
    return res.status(400).json({ error: 'Invalid side' });
  }
  if (!firestore) {
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      const uid = decoded.uid;
      
      if (!localMogBattles[battleId]) localMogBattles[battleId] = { votesA: 0, votesB: 0 };
      if (!localMogVotes[battleId]) localMogVotes[battleId] = {};
      const previousA = Number(localMogBattles[battleId].votesA) || 0;
      const previousB = Number(localMogBattles[battleId].votesB) || 0;
      
      if (!isMogBattleAdminEmail(decoded.email)) {
        if (localMogVotes[battleId][uid]) {
           const displayedVotes = getDisplayedMogBattleVotes(battleId, localMogBattles[battleId].votesA, localMogBattles[battleId].votesB);
           return res.status(409).json({
             error: 'already_voted',
             side: localMogVotes[battleId][uid],
             ...displayedVotes,
           });
        }
        localMogVotes[battleId][uid] = side;
      }
      
      if (side === 'a') localMogBattles[battleId].votesA++;
      else localMogBattles[battleId].votesB++;
      
      const cb = localCommunityBattles.find(b => b.id === battleId);
      if (cb) {
         cb.votesA = localMogBattles[battleId].votesA;
         cb.votesB = localMogBattles[battleId].votesB;
         const recipients = new Set([
           cb.creatorId,
           cb.fighterA?.ownerUid,
           cb.fighterB?.ownerUid,
         ].filter(Boolean));
         recipients.delete(uid);
         recipients.forEach((recipientUid) => {
           createNotification(recipientUid, {
             type: 'mog_battle_vote',
             title: 'New Mog Battle Vote',
             body: `Someone voted on ${battleName(cb)}.`,
             url: `/mog-battles?battle=${encodeURIComponent(battleId)}`,
           }).catch((notifyErr) => console.warn('[notifications] local vote notification failed:', notifyErr.message));
         });
      }
      await notifyMogBattleFollowers({
        battleId,
        battle: cb || { fighterA: { name: 'Fighter A' }, fighterB: { name: 'Fighter B' } },
        voterUid: uid,
        previousA,
        previousB,
        nextA: localMogBattles[battleId].votesA,
        nextB: localMogBattles[battleId].votesB,
      });
      await recordActivityEvent(req, {
        type: 'mog_battle_vote',
        uid,
        email: decoded.email || null,
        page: 'mog-battles',
        battleId,
        battleName: cb ? battleName(cb) : battleId,
        side,
        votedFor: side === 'a' ? (cb?.fighterA?.name || cb?.fighterA?.displayName || 'A') : (cb?.fighterB?.name || cb?.fighterB?.displayName || 'B'),
      }).catch((activityErr) => console.warn('[activity] local vote log failed:', activityErr.message));
      
      const displayedVotes = getDisplayedMogBattleVotes(battleId, localMogBattles[battleId].votesA, localMogBattles[battleId].votesB);
      return res.json({ success: true, ok: true, ...displayedVotes });
    } catch(e) {
      return res.status(401).json({ error: 'Invalid session' });
    }
  }

  const battleRef = firestore.collection('mogBattles').doc(battleId);

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;
    const email = decoded.email || '';
    const battleAdmin = isMogBattleAdminEmail(email);

    if (battleAdmin) {
      await firestore.runTransaction(async (transaction) => {
        const bSnap = await transaction.get(battleRef);
        const curA = Number(bSnap.data()?.votesA) || 0;
        const curB = Number(bSnap.data()?.votesB) || 0;
        transaction.set(
          battleRef,
          {
            votesA: curA + (side === 'a' ? 1 : 0),
            votesB: curB + (side === 'b' ? 1 : 0),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        const auditRef = battleRef.collection('adminVoteEvents').doc();
        transaction.set(auditRef, {
          side,
          uid,
          email: email || null,
          at: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      const snap = await battleRef.get();
      const d = snap.data() || {};
      const displayedVotes = getDisplayedMogBattleVotes(battleId, d.votesA, d.votesB);
      return res.json({
        ok: true,
        isBattleAdmin: true,
        ...displayedVotes,
      });
    }

    const realVoterRef = battleRef.collection('voters').doc(uid);

    const outcome = await firestore.runTransaction(async (transaction) => {
      const vSnap = await transaction.get(realVoterRef);
      if (vSnap.exists) {
        return { status: 'duplicate' };
      }
      const bSnap = await transaction.get(battleRef);
      const curA = Number(bSnap.data()?.votesA) || 0;
      const curB = Number(bSnap.data()?.votesB) || 0;
      transaction.set(
        battleRef,
        {
          votesA: curA + (side === 'a' ? 1 : 0),
          votesB: curB + (side === 'b' ? 1 : 0),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      transaction.set(realVoterRef, {
        side,
        votedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { status: 'ok', previousA: curA, previousB: curB };
    });

    const snap = await battleRef.get();
    const d = snap.data() || {};
    const tallies = {
      a: Number(d.votesA) || 0,
      b: Number(d.votesB) || 0,
    };
    const displayedTallies = getDisplayedMogBattleVotes(battleId, tallies.a, tallies.b);

    if (outcome.status === 'duplicate') {
      let existingSide = null;
      try {
        const existingVote = await realVoterRef.get();
        existingSide = existingVote.exists ? (existingVote.data()?.side === 'b' ? 'b' : 'a') : null;
      } catch {
        existingSide = null;
      }
      return res.status(409).json({
        ok: false,
        error: 'already_voted',
        ...(existingSide ? { side: existingSide } : {}),
        ...displayedTallies,
      });
    }

    try {
      const battleSnap = await firestore.collection('mogBattlesCommunity').doc(battleId).get();
      if (battleSnap.exists) {
        const battle = battleSnap.data() || {};
        const recipients = new Set([
          battle.creatorId,
          battle.fighterA?.ownerUid,
          battle.fighterB?.ownerUid,
        ].filter(Boolean));
        recipients.delete(uid);
        await Promise.all(
          [...recipients].map((recipientUid) =>
            createNotification(recipientUid, {
              type: 'mog_battle_vote',
              title: 'New Mog Battle Vote',
              body: `Someone voted on ${battleName(battle)}.`,
              url: `/mog-battles?battle=${encodeURIComponent(battleId)}`,
            }).catch((notifyErr) => {
              console.warn('[notifications] vote notification failed:', notifyErr.message);
            })
          )
        );
        await notifyMogBattleFollowers({
          battleId,
          battle,
          voterUid: uid,
          previousA: outcome.previousA,
          previousB: outcome.previousB,
          nextA: tallies.a,
          nextB: tallies.b,
        });
      } else {
        await notifyMogBattleFollowers({
          battleId,
          battle: { fighterA: { name: 'Fighter A' }, fighterB: { name: 'Fighter B' } },
          voterUid: uid,
          previousA: outcome.previousA,
          previousB: outcome.previousB,
          nextA: tallies.a,
          nextB: tallies.b,
        });
      }
    } catch (notifyErr) {
      console.warn('[notifications] vote notification lookup failed:', notifyErr.message);
    }

    try {
      const battleSnap = await firestore.collection('mogBattlesCommunity').doc(battleId).get();
      const battle = battleSnap.exists ? (battleSnap.data() || {}) : null;
      await recordActivityEvent(req, {
        type: 'mog_battle_vote',
        uid,
        email,
        page: 'mog-battles',
        battleId,
        battleName: battle ? battleName(battle) : battleId,
        side,
        votedFor:
          side === 'a'
            ? (battle?.fighterA?.name || battle?.fighterA?.displayName || 'A')
            : (battle?.fighterB?.name || battle?.fighterB?.displayName || 'B'),
      });
    } catch (activityErr) {
      console.warn('[activity] vote log failed:', activityErr.message);
    }

    return res.json({ ok: true, ...displayedTallies });
  } catch (e) {
    console.error('[mog-battle] POST vote', e);
    const code = e?.code || e?.errorInfo?.code;
    if (code === 'auth/id-token-expired' || code === 'auth/argument-error' || code === 'auth/invalid-id-token') {
      return res.status(401).json({ error: 'Session expired or invalid. Sign out and sign in again.' });
    }
    const details =
      process.env.NODE_ENV !== 'production' ? String(e?.message || e) : undefined;
    return res.status(500).json({
      error: 'Vote failed',
      ...(details ? { details } : {}),
    });
  }
});

function healthPayload() {
  return {
    ok: true,
    service: 'mogcheck-backend',
    firebaseMode: USE_FIREBASE_EMULATOR ? 'emulator' : 'live',
    uptimeMs: Date.now() - SERVER_BOOT_AT,
    timestamp: new Date().toISOString(),
  };
}

app.get('/api/health', (req, res) => {
  res.json(healthPayload());
});

app.get('/health', (req, res) => {
  res.json(healthPayload());
});

app.post('/api/activity/page', extractUserOptional, async (req, res) => {
  const page = String(req.body?.page || '').trim().slice(0, 120);
  const pathValue = String(req.body?.path || '').trim().slice(0, 500);
  if (!page && !pathValue) return res.status(400).json({ error: 'Missing page' });

  try {
    await recordActivityEvent(req, {
      type: 'page',
      page: page || pathValue,
      path: pathValue || null,
      visitorId: String(req.body?.visitorId || '').trim().slice(0, 160) || undefined,
      platform: String(req.body?.platform || '').trim().slice(0, 40) || undefined,
    });
    res.json({ ok: true });
  } catch (e) {
    console.warn('[activity] page log failed:', e.message || e);
    res.json({ ok: false });
  }
});

app.get('/api/notifications', extractUserOptional, async (req, res) => {
  if (!req.uid) return res.status(401).json({ error: 'Unauthorized' });
  try {
    if (!firestore) {
      return res.json({ notifications: (localNotifications[req.uid] || []).slice(0, 80) });
    }
    let snap;
    try {
      snap = await firestore
        .collection('users')
        .doc(req.uid)
        .collection('notifications')
        .orderBy('createdAt', 'desc')
        .limit(80)
        .get();
    } catch (orderErr) {
      console.warn('[notifications] orderBy failed, falling back:', orderErr.message);
      snap = await firestore.collection('users').doc(req.uid).collection('notifications').limit(80).get();
    }
    const notifications = [];
    snap.forEach((doc) => notifications.push(serializeNotification(doc)));
    notifications.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    res.json({ notifications });
  } catch (e) {
    console.error('[notifications] GET failed:', e);
    res.status(500).json({ error: e.message || 'Failed to load notifications' });
  }
});

app.post('/api/notifications/:id/read', extractUserOptional, async (req, res) => {
  if (!req.uid) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Missing notification id' });
  try {
    if (!firestore) {
      const list = localNotifications[req.uid] || [];
      const item = list.find((n) => n.id === id);
      if (item) item.read = true;
      return res.json({ ok: true });
    }
    await firestore.collection('users').doc(req.uid).collection('notifications').doc(id).set(
      {
        read: true,
        readAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[notifications] mark read failed:', e);
    res.status(500).json({ error: e.message || 'Failed to mark notification read' });
  }
});

app.get('/api/user/status', extractUserOptional, async (req, res) => {
  if (!req.uid || !firestore) return res.json({ ok: false });
  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    // X-Forwarded-For could be a comma-separated list; we only want the first one
    const clientIp = ip.split(',')[0].trim();
    let decoded = null;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (token) {
      try {
        decoded = await admin.auth().verifyIdToken(token);
      } catch {
        decoded = null;
      }
    }
    await firestore.collection('users').doc(req.uid).set({
      lastActive: admin.firestore.FieldValue.serverTimestamp(),
      lastIp: clientIp,
      email: decoded?.email || null,
      displayName: decoded?.name || null,
    }, { merge: true });
    res.json({ ok: true });
  } catch (e) {
    console.error('[status] Failed to update user status:', e.message);
    res.json({ ok: false });
  }
});

app.get('/api/user/plan', extractUserOptional, async (req, res) => {
  if (!req.uid) return res.status(401).json({ error: 'Unauthorized' });
  const userEmail = String(req.userEmail || '').toLowerCase();
  const isAdminEmail =
    userEmail.endsWith('@looksmaxxing.com') ||
    userEmail === 'serenity.eyb@gmail.com' ||
    userEmail === 'laithbu07@gmail.com' ||
    userEmail === 'laithabuamsheh@gmail.com';
  if (!firestore) {
    const fallbackPlan = isAdminEmail ? 'pro' : 'free';
    const dailyLimit = fallbackPlan === 'pro' ? null : 1;
    return res.json({
      ok: true,
      plan: fallbackPlan,
      scanCredits: isAdminEmail ? 999 : 0,
      subscriptionId: null,
      subscriptionStatus: null,
      subscriptionCurrentPeriodEnd: null,
      proDaysLeft: null,
      dailyFreeLimit: dailyLimit,
      dailyScansToday: 0,
      dailyScansRemaining: dailyLimit == null ? null : dailyLimit,
      fairUsage: await buildFairUsagePolicy(fallbackPlan, req.uid, { adminExempt: isAdminEmail }),
      warning: 'Firestore not available. Using fallback plan state.',
    });
  }

  if (isFirestoreQuotaCoolingDown()) {
    const fallbackPlan = isAdminEmail ? 'pro' : 'free';
    const dailyLimit = fallbackPlan === 'pro' ? null : 1;
    return res.json({
      ok: true,
      plan: fallbackPlan,
      scanCredits: isAdminEmail ? 999 : 0,
      subscriptionId: null,
      subscriptionStatus: null,
      subscriptionCurrentPeriodEnd: null,
      proDaysLeft: null,
      dailyFreeLimit: dailyLimit,
      dailyScansToday: 0,
      dailyScansRemaining: dailyLimit == null ? null : dailyLimit,
      fairUsage: await buildFairUsagePolicy(fallbackPlan, req.uid, { adminExempt: isAdminEmail }),
      warning: firestoreQuotaCooldownWarning(),
    });
  }

  try {
    const snap = await firestore.collection('users').doc(req.uid).get();
    const data = snap.exists ? snap.data() : {};
    const plan = normalizeUserPlan(data.plan || 'free');
    const isProPlan = isProPlanValue(plan) || isAdminEmail;
    const dailyScansToday = await countSuccessfulScansToday(req.uid);
    const dailyFreeLimit = isProPlan ? null : 1;
    const subscriptionCurrentPeriodEnd = data.subscriptionCurrentPeriodEnd || null;
    return res.json({
      ok: true,
      plan,
      planLabel: data.planLabel || getPlanLabel(plan),
      scanCredits: Number(data.scanCredits) || 0,
      subscriptionId: data.subscriptionId || null,
      subscriptionStatus: data.subscriptionStatus || null,
      subscriptionCurrentPeriodEnd,
      proDaysLeft: calculateDaysLeft(subscriptionCurrentPeriodEnd),
      dailyFreeLimit,
      dailyScansToday,
      dailyScansRemaining: dailyFreeLimit == null ? null : Math.max(0, dailyFreeLimit - dailyScansToday),
      fairUsage: await buildFairUsagePolicy(plan, req.uid, { adminExempt: isAdminEmail }),
      updatedAt:
        data.updatedAt?.toDate?.()?.toISOString?.() ||
        (typeof data.updatedAt?.seconds === 'number' ? new Date(data.updatedAt.seconds * 1000).toISOString() : data.updatedAt || null),
    });
  } catch (e) {
    if (isQuotaExceededError(e)) {
      noteFirestoreQuotaExceeded('user/plan');
      const fallbackPlan = isAdminEmail ? 'pro' : 'free';
      const dailyLimit = fallbackPlan === 'pro' ? null : 1;
      return res.json({
        ok: true,
        plan: fallbackPlan,
        scanCredits: isAdminEmail ? 999 : 0,
        subscriptionId: null,
        subscriptionStatus: null,
        subscriptionCurrentPeriodEnd: null,
        proDaysLeft: null,
        dailyFreeLimit: dailyLimit,
        dailyScansToday: 0,
        dailyScansRemaining: dailyLimit == null ? null : dailyLimit,
        fairUsage: await buildFairUsagePolicy(fallbackPlan, req.uid, { adminExempt: isAdminEmail }),
        warning: firestoreQuotaCooldownWarning(),
      });
    }
    console.error('[user/plan] Failed to read user plan:', e.message);
    return res.status(500).json({ error: e.message || 'Failed to read user plan' });
  }
});

/** Fast readiness check used by the frontend scan preflight. */
app.get('/api/ready', async (req, res) => {
  const deep = req.query.deep === '1';

  if (!deep) {
    return res.json({
      ok: true,
      checks: {
        backend: true,
        firebaseAdmin: Boolean(admin.apps && admin.apps.length),
        firestore: firestore ? 'not-checked' : false,
        analysis: true,
      },
      firebaseMode: USE_FIREBASE_EMULATOR ? 'emulator' : 'live',
      timestamp: new Date().toISOString(),
    });
  }

  if (!firestore) {
    return res.status(503).json({
      ok: false,
      checks: { firestore: false },
      firebaseMode: USE_FIREBASE_EMULATOR ? 'emulator' : 'live',
      error: firebaseConfigHelpMessage(),
      timestamp: new Date().toISOString(),
    });
  }

  if (isFirestoreQuotaCoolingDown()) {
    return res.json({
      ok: true,
      checks: { firestore: 'quota-cooldown', analysis: true },
      firebaseMode: USE_FIREBASE_EMULATOR ? 'emulator' : 'live',
      warning: firestoreQuotaCooldownWarning(),
      timestamp: new Date().toISOString(),
    });
  }

  try {
    await firestore.collection('system').doc('adminStore').get();
    res.json({
      ok: true,
      checks: { firestore: true },
      firebaseMode: USE_FIREBASE_EMULATOR ? 'emulator' : 'live',
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    if (isQuotaExceededError(e)) {
      noteFirestoreQuotaExceeded('ready');
      return res.json({
        ok: true,
        checks: { firestore: 'quota-exhausted', analysis: true },
        firebaseMode: USE_FIREBASE_EMULATOR ? 'emulator' : 'live',
        warning: firestoreQuotaCooldownWarning(),
        timestamp: new Date().toISOString(),
      });
    }

    res.status(503).json({
      ok: false,
      checks: { firestore: false },
      firebaseMode: USE_FIREBASE_EMULATOR ? 'emulator' : 'live',
      error: e.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/public-stats', (req, res) => {
  res.json({ analysisCount: adminStore.getPublicAnalysisDisplayNumber() });
});

const DEBUG_LOG_PATH = path.join(__dirname, '..', 'debug-cb256d.log');
function debugLog(hypothesisId, message, data = {}) {
  try {
    fs.mkdirSync(path.dirname(DEBUG_LOG_PATH), { recursive: true });
    fs.appendFileSync(
      DEBUG_LOG_PATH,
      JSON.stringify({
        sessionId: 'cb256d',
        runId: 'pre-fix',
        hypothesisId,
        location: 'backend/server.js',
        message,
        data,
        timestamp: Date.now(),
      }) + '\n',
      'utf8'
    );
  } catch (e) {
    console.error('[debug-cb256d] log write failed:', DEBUG_LOG_PATH, e?.message || e);
  }
}

const debugLogLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.DEBUG_LOG_RATE_LIMIT_MAX || 20),
});

app.post('/api/debug-log', debugLogLimiter, (req, res) => {
  const token = process.env.DEBUG_LOG_TOKEN;
  if (process.env.NODE_ENV === 'production') {
    if (!token) return res.status(404).json({ error: 'Not found' });
    if (req.headers['x-debug-token'] !== token) return res.status(401).json({ error: 'Unauthorized' });
  }

  const { hypothesisId, message, data, location, runId } = req.body || {};
  debugLog(String(hypothesisId || 'H?'), String(message || 'debug'), {
    ...(data && typeof data === 'object' ? data : {}),
    location: String(location || 'client'),
    runId: String(runId || 'pre-fix'),
  });
  res.json({ ok: true });
});

debugLog('H0', 'Server boot', { debugLogPath: DEBUG_LOG_PATH });

const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  debugLog('H1', 'Serving dist directory', { distDir });

  app.use((req, res, next) => {
    const p = req.path || '';
    if (p === '/' || p === '/index.html' || p.startsWith('/assets/')) {
      debugLog('H1', 'HTTP request', {
        method: req.method,
        path: p,
        ua: String(req.headers['user-agent'] || '').slice(0, 120),
      });
    }
    next();
  });

  app.use(express.static(distDir));
}

const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const safe = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, safe);
  },
});

function imageFileFilter(req, file, cb) {
  if (ALLOWED_IMAGE_MIMES.has(file.mimetype)) return cb(null, true);
  cb(new Error('Only JPEG, PNG, or WebP images are allowed'));
}

const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.UPLOAD_MAX_BYTES || 15 * 1024 * 1024) },
  fileFilter: imageFileFilter,
});

const analyzeUpload = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'sideImage', maxCount: 1 },
]);

function getPythonExecutable() {
  const candidates = [];

  if (process.env.PYTHON_PATH) {
    candidates.push(process.env.PYTHON_PATH);
  }

  if (process.platform === 'win32') {
    candidates.push(
      path.join(__dirname, 'venv', 'Scripts', 'python.exe'),
      'C:\\Users\\Laith abu amsheh\\Desktop\\website-code\\backend\\venv\\Scripts\\python.exe',
      'py',
      'python'
    );
  } else {
    candidates.push(
      path.join(__dirname, 'venv', 'bin', 'python3'),
      'python3',
      'python'
    );
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate === 'py' || candidate === 'python' || candidate === 'python3') {
      return candidate;
    }
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // keep trying other candidates
    }
  }

  return process.platform === 'win32' ? 'python' : 'python3';
}

function terminateProcessTree(childProcess, label = 'child process') {
  if (!childProcess?.pid) return;
  const pid = String(childProcess.pid);
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', pid, '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on('error', (error) => {
      console.error(`[process] Failed to taskkill ${label} tree (${pid}):`, error.message);
      try {
        childProcess.kill('SIGKILL');
      } catch (killError) {
        console.error(`[process] Failed fallback kill for ${label} (${pid}):`, killError.message);
      }
    });
    return;
  }

  try {
    process.kill(-childProcess.pid, 'SIGKILL');
  } catch {
    try {
      childProcess.kill('SIGKILL');
    } catch (killError) {
      console.error(`[process] Failed to kill ${label} (${pid}):`, killError.message);
    }
  }
}

function getRequestBase(req) {
  if (!req) return '';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
  if (!host) return '';
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim();
  return `${proto}://${host}`.replace(/\/$/, '');
}

function formatTerminalList(items, fallback = 'none') {
  if (!Array.isArray(items) || items.length === 0) return fallback;
  return items
    .slice(0, 5)
    .map((item) => {
      if (!item) return null;
      if (typeof item === 'string') return item.trim() || null;
      if (typeof item === 'object') {
        const title = String(item.title || item.name || '').trim();
        const description = String(item.description || '').trim();
        if (title && description) return `${title}: ${description}`;
        return title || description || null;
      }
      return String(item).trim() || null;
    })
    .filter(Boolean)
    .join(' | ');
}

function formatHexagonForTerminal(hexagon) {
  if (!hexagon || typeof hexagon !== 'object') return 'n/a';
  const parts = [
    ['Harmony', hexagon.harmony],
    ['Bone', hexagon.bone],
    ['Skin', hexagon.skin],
    ['Symmetry', hexagon.symmetry],
    ['Dimorphism', hexagon.dimorphism],
  ]
    .filter(([, value]) => value != null && !Number.isNaN(Number(value)))
    .map(([label, value]) => `${label}=${value}`);
  return parts.length ? parts.join(' | ') : 'n/a';
}

function getPublicBackendBase(req) {
  const requestBase = getRequestBase(req);
  const raw = (process.env.PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '');
  if (raw && !/(localhost|127\.0\.0\.1|trycloudflare\.com)/i.test(raw)) {
    return raw;
  }
  if (requestBase && process.env.FORCE_PUBLIC_BACKEND_URL !== '1') {
    if (!raw) return requestBase;
    if (process.env.NODE_ENV !== 'production') return requestBase;
    if (/(localhost|127\.0\.0\.1|trycloudflare\.com)/i.test(raw)) return requestBase;
  }
  if (raw) return raw;
  const port = Number(process.env.PORT || 3001);
  return `http://localhost:${port}`;
}

/** Full URL for loading scan video in analyze response (CDN or same-origin). */
function getLoadingVideoUrl(req) {
  const custom = (process.env.LOADING_VIDEO_URL || '').trim();
  if (custom) return custom;
  return `${getPublicBackendBase(req)}/loading_scan.mp4`;
}

function getLocalUploadUrl(req, localPath) {
  if (!localPath) return null;
  const filename = path.basename(localPath);
  if (!filename) return null;
  return `${getPublicBackendBase(req)}/uploads/${encodeURIComponent(filename)}`;
}

function copyDebugArtifactToUploads(req, sourceName, label = 'debug') {
  const sourcePath = path.isAbsolute(sourceName) ? sourceName : path.join(__dirname, sourceName);
  if (!fs.existsSync(sourcePath)) return null;

  try {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const sourceExt = path.extname(sourcePath) || '.jpg';
    const safeLabel = String(label || 'debug').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    const destPath = path.join(
      uploadDir,
      `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeLabel}${sourceExt}`
    );
    fs.copyFileSync(sourcePath, destPath);
    return getLocalUploadUrl(req, destPath);
  } catch (error) {
    console.warn(`[debug-artifact] Failed to preserve ${sourcePath}:`, error.message);
    return null;
  }
}

function publicizeStoredUploadUrl(value) {
  if (typeof value !== 'string' || !value.includes('/uploads/')) return value || null;
  const rawBase = (process.env.PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '');
  if (!rawBase || /(localhost|127\.0\.0\.1|trycloudflare\.com)/i.test(rawBase)) return value;

  const match = value.match(/\/uploads\/([^?#]+)/i);
  if (!match) return value;
  return `${rawBase}/uploads/${match[1]}`;
}

function normalizeStoredScanUrls(scan) {
  if (!scan || typeof scan !== 'object') return scan;
  const payload = scan.payload && typeof scan.payload === 'object' ? scan.payload : null;
  const frontImageUrl = publicizeStoredUploadUrl(scan.frontImageUrl || payload?.frontImage || null);
  const sideImageUrl = publicizeStoredUploadUrl(scan.sideImageUrl || payload?.sideImage || null);
  const debugAnchorsImageUrl = publicizeStoredUploadUrl(
    scan.debugAnchorsImageUrl || payload?.debugAnchorsImage || payload?.debugAnchorsImageUrl || null
  );
  const debugRatiosImageUrl = publicizeStoredUploadUrl(
    scan.debugRatiosImageUrl || payload?.debugRatiosImage || payload?.debugRatiosImageUrl || null
  );

  return {
    ...scan,
    frontImageUrl,
    sideImageUrl,
    debugAnchorsImageUrl,
    debugRatiosImageUrl,
    payload: payload
      ? {
          ...payload,
          frontImage: publicizeStoredUploadUrl(payload.frontImage || frontImageUrl),
          sideImage: publicizeStoredUploadUrl(payload.sideImage || sideImageUrl),
          debugAnchorsImage: debugAnchorsImageUrl,
          debugAnchorsImageUrl,
          debugRatiosImage: debugRatiosImageUrl,
          debugRatiosImageUrl,
        }
      : scan.payload,
  };
}

function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

async function uploadImageToFirebase(localPath, uid, prefix = 'front') {
  if (!localPath || !fs.existsSync(localPath)) return null;
  if (!firestore) return null; // require firebase admin
  if (shouldSkipFirebaseStorage()) {
    console.log('[storage] Skipped (emulator or SKIP_FIREBASE_STORAGE — no Google Cloud Storage credentials needed)');
    return null;
  }
  try {
    const bucket = admin.storage().bucket();
    const filename = path.basename(localPath);
    // If user is authenticated, store in their folder, else store in anonymous folder
    const destFolder = uid ? `users/${uid}/images` : `anonymous/images`;
    const dest = `${destFolder}/${prefix}_${Date.now()}_${filename}`;
    
    await bucket.upload(localPath, {
      destination: dest,
      metadata: {
        contentType: guessContentType(localPath),
        cacheControl: 'public, max-age=31536000',
      },
    });
    
    // Make file publicly accessible to get public URL
    const file = bucket.file(dest);
    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${dest}`;
    
    fs.unlinkSync(localPath);
    console.log(`[storage] Uploaded and removed local: ${dest}`);
    return { dest, url: publicUrl };
  } catch (e) {
    console.error('[storage] Upload failed (local file kept):', e.message);
    return null;
  }
}

/** Optional middleware to extract user ID from token without requiring it */
async function extractUserOptional(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return next();

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    req.userEmail = (decoded.email || '').toLowerCase();
  } catch (e) {
    // ignore invalid token for optional auth
  }
  next();
}

/** Ultra models (choice 1 / 2) require Firebase auth + Pro plan or Single Scan with credits. */
async function verifyUltraAccess(req, res, next) {
  const modelChoice = String((req.body && (req.body.choice ?? req.body.model)) || '3').trim();
  const allowedModelChoices = new Set(['1', '2', '3', '4', '5']);
  if (!allowedModelChoices.has(modelChoice)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid AI model selected. Please choose an available scan model.',
    });
  }
  const isUltra = modelChoice === '1' || modelChoice === '2';
  if (!isUltra) {
    req.ultraContext = null;
    return next();
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Sign in required for premium models. Create an account and upgrade on the Plans page.',
    });
  }

  let decoded = null;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch (e) {
    console.error('[analyze] Ultra auth token failed:', e.message);
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired session. Please sign in again.',
    });
  }

  const uid = decoded.uid;
  const email = (decoded.email || '').toLowerCase();
  req.uid = req.uid || uid;
  const isAdminEmail =
    email.endsWith('@looksmaxxing.com') ||
    email === 'serenity.eyb@gmail.com' ||
    email === 'laithbu07@gmail.com' ||
    email === 'laithabuamsheh@gmail.com';

  if (isAdminEmail) {
    req.ultraContext = { uid, plan: 'pro', source: 'admin-email-bypass' };
    return next();
  }

  if (!firestore) {
    return res.status(503).json({
      success: false,
      error: firebaseConfigHelpMessage(),
    });
  }

  try {
    const snap = await firestore.collection('users').doc(uid).get();
    if (!snap.exists && USE_FIREBASE_EMULATOR && isRemoteBrowserRequest(req)) {
      return res.status(503).json({
        success: false,
        error:
          'This backend is still reading from the local Firebase emulator, so live premium plan checks cannot work. Start the API without USE_FIREBASE_EMULATOR and configure live Firebase Admin credentials.',
      });
    }
    const data = snap.exists ? snap.data() : {};
    const plan = normalizeUserPlan(data.plan || 'free');
    const scanCredits = Number(data.scanCredits) || 0;

    if (isProPlanValue(plan) || data.isAdmin || isAdminEmail) {
      req.ultraContext = { uid, plan: isProPlanValue(plan) ? plan : 'pro_infinite' };
      return next();
    }
    if (plan === 'single_scan' && scanCredits > 0) {
      req.ultraContext = { uid, plan: 'single_scan' };
      return next();
    }

    return res.status(403).json({
      success: false,
      error:
        'Premium models require MogCheck Pro or an unused Single Scan credit. Open Plans to upgrade.',
    });
  } catch (e) {
    if (isQuotaExceededError(e)) {
      console.warn(`[analyze] Firestore quota exhausted during Ultra plan check; allowing signed-in scan for ${email || uid}.`);
      req.ultraContext = { uid, plan: isAdminEmail ? 'pro' : 'quota_bypass' };
      return next();
    }

    // If running locally without service account, bypass this strictly for localhost testing.
    if (isCredentialsConfigError(e?.message) && process.env.NODE_ENV !== 'production' && !isRemoteBrowserRequest(req)) {
      console.warn('[analyze] Bypassing Ultra auth locally because no Firebase credentials exist.');
      req.ultraContext = { uid: 'local-test-user', plan: 'pro' };
      return next();
    }

    if (USE_FIREBASE_EMULATOR && isRemoteBrowserRequest(req)) {
      return res.status(503).json({
        success: false,
        error:
          'This backend is in Firebase emulator mode. Live premium scans from mogcheck.net need real Firebase Admin credentials on this machine.',
      });
    }

    if (isCredentialsConfigError(e?.message)) {
      const { status, error } = sanitizeFirebaseError(e);
      return res.status(status).json({
        success: false,
        error,
      });
    }

    console.error('[analyze] Ultra auth failed:', e.message);
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired session. Please sign in again.',
    });
  }
}

app.post(
  '/api/analyze',
  (req, res, next) => {
    analyzeUpload(req, res, (err) => {
      if (err) {
        console.error('Multer upload error:', err);
        return res.status(400).json({ success: false, error: err.message || 'Upload error' });
      }
      next();
    });
  },
  analyzeLimiter,
  extractUserOptional,
  verifyUltraAccess,
  async (req, res) => {
    // Check files immediately after upload parsing
    const frontFile = req.files && req.files['image'] && req.files['image'][0];
    if (!frontFile) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const fairUsage = await buildFairUsagePolicy(req.ultraContext?.plan || 'free', req.uid, {
      adminExempt: req.ultraContext?.source === 'admin-email-bypass',
    });
    if (
      fairUsage.lowPriority &&
      req.uid &&
      fairUsage.activeCount >= 1
    ) {
      return res.status(429).json({
        success: false,
        code: 'SCAN_ALREADY_RUNNING',
        error: 'Only one Pro scan can be in progress at a time. Wait for the current analysis to finish, then start the next one.',
        fairUsage,
      });
    }

    const imagePath = frontFile.path;
    const sideFile = req.files && req.files['sideImage'] && req.files['sideImage'][0];
    const sideImagePath = sideFile ? sideFile.path : '';
    const statsJson = req.body.stats;
    const modelChoice = String((req.body && (req.body.choice ?? req.body.model)) || '3').trim();
    const scanRequestId =
      String(req.body.scanRequestId || '').trim() ||
      `scan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const profileId = String(req.body.profileId || 'default').trim() || 'default';
    const safeRunId = `${scanRequestId.replace(/[^a-z0-9_-]/gi, '-').slice(0, 60)}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const runOutputDir = path.join(__dirname, 'tmp-analysis', safeRunId);
    fs.mkdirSync(runOutputDir, { recursive: true });

    console.log('\n========== PY ENGINE (this same terminal: npm start in /backend) ==========');
    console.log(`[api/analyze] image=${imagePath} sideImage=${sideImagePath || 'none'} model=${modelChoice}`);
    console.log('All Python stdout/stderr from final_engine.py appears below until "Python process closed".\n');

    const analysisStartTime = Date.now();
    const scriptPath = path.join(__dirname, 'final_engine.py');
    const args = [scriptPath, imagePath, modelChoice];
    if (statsJson && String(statsJson).trim()) {
      args.push(String(statsJson));
    } else {
      args.push('');
    }
    args.push(sideImagePath || '');

    const pythonExecutable = getPythonExecutable();
    if (req.uid && fairUsage.enabled) {
      markUserAnalysisStarted(req.uid, {
        scanRequestId,
        profileId,
        modelChoice,
      });
    }
    rememberAnalysisRecovery(req.uid, scanRequestId, {
      state: 'running',
      startedAt: Date.now(),
      profileId,
      modelChoice,
    });

    const py = spawn(pythonExecutable, args, {
      cwd: __dirname,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        MOGCHECK_RUN_OUTPUT_DIR: runOutputDir,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        PYTHONUNBUFFERED: '1',
      },
    });

    /** Prevent hung Gemini/API calls from blocking the client forever (default 12 min). */
    const PYTHON_MAX_MS = Number(process.env.ANALYZE_PYTHON_TIMEOUT_MS || 720000);
    let analyzeTimedOut = false;
    const killTimer = setTimeout(() => {
      analyzeTimedOut = true;
      const timeoutMessage = 'Analysis timed out after about 12 minutes. Please try again in a moment.';
      console.error(`[api/analyze] Python exceeded ${PYTHON_MAX_MS}ms - terminating process tree`);
      clearUserAnalysis(req.uid);
      rememberAnalysisRecovery(req.uid, scanRequestId, {
        state: 'failed',
        error: timeoutMessage,
      });
      if (!res.headersSent) {
        res.status(504).json({
          success: false,
          error: 'Analysis timed out after about 12 minutes - the AI engine took too long. The scan was stopped safely; please try again in a moment.',
        });
      }
      terminateProcessTree(py, 'analysis Python');
    }, PYTHON_MAX_MS);

    py.on('error', (err) => {
      clearTimeout(killTimer);
      clearUserAnalysis(req.uid);
      rememberAnalysisRecovery(req.uid, scanRequestId, {
        state: 'failed',
        error: 'Python environment missing or final_engine.py failed to start.',
      });
      console.error('Failed to start Python process:', err);
      if (!res.headersSent) {
        res.json({
          success: false,
          error: 'Python environment missing or final_engine.py failed to start.',
        });
      }
    });

    let pythonOutput = '';
    let pythonStderr = '';

    py.stdout.on('data', (data) => {
      const text = data.toString();
      process.stdout.write(text);
      pythonOutput += text;
    });

    py.stderr.on('data', (data) => {
      const text = data.toString();
      process.stderr.write(text);
      pythonStderr += text;
    });

    py.on('close', async (code) => {
      clearTimeout(killTimer);
      clearUserAnalysis(req.uid);

      if (analyzeTimedOut) {
        console.log(`\n[api/analyze] Python closed after timeout (code=${code})`);
        return;
      }

      if (res.headersSent) return;

      console.log(`\n[api/analyze] Python process closed with exit code ${code}`);
      if (/###\s*CONTENT_REJECTED/i.test(pythonOutput)) {
        rememberAnalysisRecovery(req.uid, scanRequestId, {
          state: 'failed',
          error: 'This image cannot be analyzed. Please upload a non-explicit face photo.',
        });
        adminStore.logAnalysis({
          model: modelChoice,
          durationMs: Date.now() - analysisStartTime,
          success: false,
          rating: null,
          sideRating: null,
          error: 'Explicit or inappropriate image rejected.',
        });
        return res.status(400).json({
          success: false,
          code: 'CONTENT_REJECTED',
          error: 'This image cannot be analyzed. Please upload a non-explicit face photo.',
        });
      }

      let parsed;
      try {
        parsed = parseAnalysisOutput(pythonOutput, runOutputDir);
      } catch (e) {
        console.error('Error parsing AI output', e);
        parsed = {
          sex: null,
          finalRating: null,
          technicalSummary: 'Could not generate technical summary.',
          appealAssessment: null,
          bestFeatures: [],
          primaryFlaws: [],
          categories: null,
          biometrics: [],
          hasSubstantiveParse: false,
        };
      }

      const isFreeModelChoice = ['3', '4', '5'].includes(modelChoice);
      if (isFreeModelChoice) {
        parsed.finalRating = null;
        parsed.sideRating = null;
        parsed.categories = null;
        parsed.sideCategories = null;
        parsed.hexagonFront = null;
        parsed.hexagonSide = null;
      }
      if (!sideImagePath) {
        parsed.sideRating = null;
        parsed.sideCategories = null;
        parsed.hexagonSide = null;
        parsed.sideBestFeatures = [];
        parsed.sidePrimaryFlaws = [];
        parsed.sideBiometrics = [];
      }

      const hasPremiumStructuredParse =
        Array.isArray(parsed.biometrics) && parsed.biometrics.length > 0 &&
        (
          (Array.isArray(parsed.bestFeatures) && parsed.bestFeatures.length > 0) ||
          (Array.isArray(parsed.primaryFlaws) && parsed.primaryFlaws.length > 0) ||
          parsed.categories ||
          parsed.hexagonFront ||
          (typeof parsed.technicalSummary === 'string' && parsed.technicalSummary.trim().length > 24)
        );

      // Free models are descriptive-only, so a substantive text parse is enough.
      // Premium models should not be marked successful unless the structured scan data is actually there.
      const success =
        code === 0 &&
        (
          isFreeModelChoice
            ? parsed.hasSubstantiveParse === true
            : (
                parsed.finalRating != null &&
                !Number.isNaN(Number(parsed.finalRating)) &&
                hasPremiumStructuredParse
              )
        );

  const finalRating =
    parsed.finalRating != null && !Number.isNaN(parsed.finalRating) ? parsed.finalRating : null;
  const sideRating =
    parsed.sideRating != null && !Number.isNaN(parsed.sideRating) ? parsed.sideRating : null;
  const payload = {
    success,
    sex: parsed.sex,
    finalRating,
    sideRating,
    maxNaturalPotential: parsed.maxNaturalPotential ?? null,
    maxPotentialWithSurgery: parsed.maxPotentialWithSurgery ?? null,
    authenticityFlag: parsed.authenticityFlag || null,
    uncannyFlag: parsed.uncannyFlag || null,
    technicalSummary: parsed.technicalSummary,
    appealAssessment: parsed.appealAssessment || null,
    debugJustification: parsed.debugJustification || null,
    bestFeatures: parsed.bestFeatures || [],
    primaryFlaws: parsed.primaryFlaws || [],
    sideBestFeatures: parsed.sideBestFeatures || [],
    sidePrimaryFlaws: parsed.sidePrimaryFlaws || [],
    categories: parsed.categories || null,
    sideCategories: parsed.sideCategories || null,
    hexagonFront: parsed.hexagonFront || null,
    hexagonSide: parsed.hexagonSide || null,
    personalizedFeedback: parsed.personalizedFeedback || [],
    biometrics: parsed.biometrics || [],
    sideBiometrics: parsed.sideBiometrics || [],
    protocols: parsed.protocols || [],
    videoUrl: getLoadingVideoUrl(req),
    scanRequestId,
    rawOutput:
      pythonStderr.trim().length > 0
        ? `${pythonOutput}\n\n--- Python stderr ---\n${pythonStderr}`
        : pythonOutput,
    fairUsage,
  };

  const frontFallbackUrl = getLocalUploadUrl(req, imagePath);
  const sideFallbackUrl = getLocalUploadUrl(req, sideImagePath);
  const debugAnchorsUrl = copyDebugArtifactToUploads(req, path.join(runOutputDir, 'debug_final_anchors.jpg'), 'debug-anchors');
  const debugRatiosUrl = copyDebugArtifactToUploads(req, path.join(runOutputDir, 'debug_ratios.jpg'), 'debug-ratios');
  if (frontFallbackUrl) payload.frontImage = frontFallbackUrl;
  if (sideFallbackUrl) payload.sideImage = sideFallbackUrl;
  if (debugAnchorsUrl) {
    payload.debugAnchorsImage = debugAnchorsUrl;
    payload.debugAnchorsImageUrl = debugAnchorsUrl;
  }
  if (debugRatiosUrl) {
    payload.debugRatiosImage = debugRatiosUrl;
    payload.debugRatiosImageUrl = debugRatiosUrl;
  }

  if (!success) {
    if (code !== 0) {
      payload.error = `Python exited with code ${code}. Check this terminal for [FATAL] or API errors above.`;
    } else if (!parsed.hasSubstantiveParse) {
      payload.error =
        'Analysis finished but no usable text was parsed (empty model response, wrong format, or API key/model issue). Check the PY ENGINE block above.';
    } else {
      payload.error = 'Analysis did not complete successfully.';
    }
  }
  rememberAnalysisRecovery(req.uid, scanRequestId, {
    state: success ? 'completed' : 'failed',
    payload: success ? payload : null,
    error: success ? null : payload.error,
    profileId: req.body.profileId || 'default',
    modelChoice,
  });

  console.log(
    `[api/analyze] Parsed -> bestFeatures=${payload.bestFeatures.length} flaws=${payload.primaryFlaws.length} biometrics=${(payload.biometrics || []).length} rating=${finalRating ?? 'n/a'}`
  );
  console.log('----- SCAN SUMMARY -----');
  console.log(`Model: ${modelChoice}`);
  console.log(`Sex: ${payload.sex || 'n/a'}`);
  console.log(`Front rating: ${finalRating ?? 'n/a'}`);
  console.log(`Side rating: ${sideRating ?? 'n/a'}`);
  if (payload.appealAssessment) {
    console.log(`Appeal assessment: ${payload.appealAssessment}`);
  }
  console.log(`Best features: ${formatTerminalList(payload.bestFeatures)}`);
  console.log(`Primary flaws: ${formatTerminalList(payload.primaryFlaws)}`);
  console.log(`Side best features: ${formatTerminalList(payload.sideBestFeatures)}`);
  console.log(`Side primary flaws: ${formatTerminalList(payload.sidePrimaryFlaws)}`);
  console.log(`Front hexagon: ${formatHexagonForTerminal(payload.hexagonFront)}`);
  console.log(`Side hexagon: ${formatHexagonForTerminal(payload.hexagonSide)}`);
  console.log(`Biometrics parsed: ${(payload.biometrics || []).length}`);
  console.log(`Protocols parsed: ${(payload.protocols || []).length}`);
  console.log('------------------------');
  console.log('========== END PY ENGINE ==========\n');

  adminStore.parseKeyEventsFromStdout(pythonOutput);
  const scanPlatform = getClientPlatform(req);
  adminStore.logAnalysis({
    model: modelChoice,
    durationMs: Date.now() - analysisStartTime,
    success,
    rating: finalRating,
    sideRating,
    error: payload.error || null,
    uid: req.uid || null,
    platform: scanPlatform,
  });

  if (success && req.ultraContext && req.ultraContext.plan === 'single_scan' && firestore) {
    try {
      await firestore.collection('users').doc(req.ultraContext.uid).update({
        scanCredits: admin.firestore.FieldValue.increment(-1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`[analyze] Single Scan credit consumed for ${req.ultraContext.uid}`);
    } catch (e) {
      console.error('[analyze] Failed to decrement scanCredits:', e.message);
    }
  }

  let savedScanRef = null;
  let savedScanBase = null;
  if (success && req.uid && firestore) {
    try {
      savedScanRef = firestore.collection('users').doc(req.uid).collection('scans').doc();
      payload.scanId = savedScanRef.id;
      payload.scanRequestId = scanRequestId;
      payload.profileId = profileId;
      payload.selectedModel = String(modelChoice || payload.selectedModel || '').trim() || '1';
      payload.cohesiveFrontSide = false;
      payload.platform = scanPlatform;

      savedScanBase = {
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        model: modelChoice,
        platform: scanPlatform,
        cohesiveFrontSide: false,
        visibility: 'private',
        finalRating,
        sideRating,
        frontImageUrl: frontFallbackUrl || payload.frontImage || null,
        sideImageUrl: sideFallbackUrl || payload.sideImage || null,
        debugAnchorsImageUrl: debugAnchorsUrl || payload.debugAnchorsImage || null,
        debugRatiosImageUrl: debugRatiosUrl || payload.debugRatiosImage || null,
        frontImageDest: null,
        sideImageDest: null,
        success: true,
        scanRequestId,
        payload: {
          ...payload,
          frontImage: frontFallbackUrl || payload.frontImage || null,
          sideImage: sideFallbackUrl || payload.sideImage || null,
          debugAnchorsImage: debugAnchorsUrl || payload.debugAnchorsImage || null,
          debugAnchorsImageUrl: debugAnchorsUrl || payload.debugAnchorsImage || null,
          debugRatiosImage: debugRatiosUrl || payload.debugRatiosImage || null,
          debugRatiosImageUrl: debugRatiosUrl || payload.debugRatiosImage || null,
          scanRequestId,
          selectedModel: payload.selectedModel,
          cohesiveFrontSide: false,
          platform: scanPlatform,
        },
        profileId: payload.profileId,
      };

      // Save the scan before responding so the frontend can recover if the response is dropped.
      await savedScanRef.set(savedScanBase);
      console.log(`[analyze] Scan history pre-saved: ${savedScanRef.id}`);
      pruneFirestoreProfileScans(req.uid, payload.profileId).catch((e) => {
        console.warn('[analyze] Failed to prune old profile scans:', e.message);
      });
    } catch (e) {
      savedScanRef = null;
      savedScanBase = null;
      console.error('[analyze] Failed to pre-save scan history:', e.message);
    }
  }

  if (success && req.uid) {
    const localScanId = payload.scanId || `local-scan-${Date.now()}`;
    payload.scanId = localScanId;
    upsertLocalCachedScan(req.uid, localScanId, {
      ...(savedScanBase || {}),
      ...payload,
      scanRequestId: payload.scanRequestId || savedScanBase?.scanRequestId || null,
      timestamp: new Date().toISOString(),
      scannedAt: new Date().toISOString(),
      frontImageUrl: frontFallbackUrl || payload.frontImage || null,
      sideImageUrl: sideFallbackUrl || payload.sideImage || null,
      debugAnchorsImageUrl: debugAnchorsUrl || payload.debugAnchorsImage || null,
      debugRatiosImageUrl: debugRatiosUrl || payload.debugRatiosImage || null,
      platform: scanPlatform,
      payload: {
        ...payload,
        frontImage: frontFallbackUrl || payload.frontImage || null,
        sideImage: sideFallbackUrl || payload.sideImage || null,
        debugAnchorsImage: debugAnchorsUrl || payload.debugAnchorsImage || null,
        debugAnchorsImageUrl: debugAnchorsUrl || payload.debugAnchorsImage || null,
        debugRatiosImage: debugRatiosUrl || payload.debugRatiosImage || null,
        debugRatiosImageUrl: debugRatiosUrl || payload.debugRatiosImage || null,
        scanRequestId: payload.scanRequestId || savedScanBase?.scanRequestId || null,
        platform: scanPlatform,
      },
    });
  }

  if (success) {
    rememberAnalysisRecovery(req.uid, scanRequestId, {
      state: 'completed',
      payload,
      profileId: payload.profileId || profileId,
      modelChoice,
    });
  }

  if (success && fairUsage.minimumDurationMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, fairUsage.minimumDurationMs));
  }

  res.json(payload);

      setImmediate(async () => {
        if (!success || !req.uid || !firestore || !savedScanRef) return;

        let frontUpload = null;
        let sideUpload = null;

        if (imagePath) frontUpload = await uploadImageToFirebase(imagePath, req.uid, 'front');
        if (sideImagePath) sideUpload = await uploadImageToFirebase(sideImagePath, req.uid, 'side');

        try {
          const persistedFrontImage = frontUpload ? frontUpload.url : (savedScanBase?.frontImageUrl || frontFallbackUrl);
          const persistedSideImage = sideUpload ? sideUpload.url : (savedScanBase?.sideImageUrl || sideFallbackUrl);
          await savedScanRef.set({
            frontImageUrl: persistedFrontImage || null,
            sideImageUrl: persistedSideImage || null,
            debugAnchorsImageUrl: debugAnchorsUrl || payload.debugAnchorsImage || null,
            debugRatiosImageUrl: debugRatiosUrl || payload.debugRatiosImage || null,
            frontImageDest: frontUpload ? frontUpload.dest : null,
            sideImageDest: sideUpload ? sideUpload.dest : null,
            scanRequestId: payload.scanRequestId || savedScanBase?.scanRequestId || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            payload: {
              ...payload,
              frontImage: persistedFrontImage || payload.frontImage || null,
              sideImage: persistedSideImage || payload.sideImage || null,
              debugAnchorsImage: debugAnchorsUrl || payload.debugAnchorsImage || null,
              debugAnchorsImageUrl: debugAnchorsUrl || payload.debugAnchorsImage || null,
              debugRatiosImage: debugRatiosUrl || payload.debugRatiosImage || null,
              debugRatiosImageUrl: debugRatiosUrl || payload.debugRatiosImage || null,
              scanRequestId: payload.scanRequestId || savedScanBase?.scanRequestId || null,
              selectedModel: String(modelChoice || payload.selectedModel || '').trim() || '1',
              cohesiveFrontSide: false,
            },
          }, { merge: true });
          console.log(`[analyze] Scan history image URLs finalized: ${savedScanRef.id}`);
        } catch (e) {
          console.error('[analyze] Failed to finalize scan history images:', e.message);
        }

        if (req.uid && payload.scanId) {
          upsertLocalCachedScan(req.uid, payload.scanId, {
            scanRequestId: payload.scanRequestId || savedScanBase?.scanRequestId || null,
            frontImageUrl: frontUpload ? frontUpload.url : (savedScanBase?.frontImageUrl || frontFallbackUrl || null),
            sideImageUrl: sideUpload ? sideUpload.url : (savedScanBase?.sideImageUrl || sideFallbackUrl || null),
            debugAnchorsImageUrl: debugAnchorsUrl || payload.debugAnchorsImage || null,
            debugRatiosImageUrl: debugRatiosUrl || payload.debugRatiosImage || null,
            payload: {
              ...payload,
              frontImage: frontUpload ? frontUpload.url : (savedScanBase?.frontImageUrl || frontFallbackUrl || null),
              sideImage: sideUpload ? sideUpload.url : (savedScanBase?.sideImageUrl || sideFallbackUrl || null),
              debugAnchorsImage: debugAnchorsUrl || payload.debugAnchorsImage || null,
              debugAnchorsImageUrl: debugAnchorsUrl || payload.debugAnchorsImage || null,
              debugRatiosImage: debugRatiosUrl || payload.debugRatiosImage || null,
              debugRatiosImageUrl: debugRatiosUrl || payload.debugRatiosImage || null,
              scanRequestId: payload.scanRequestId || savedScanBase?.scanRequestId || null,
            },
            updatedAt: new Date().toISOString(),
          });
        }
      });
    });
  }
);

app.get('/api/analyze/status/:scanRequestId', extractUserOptional, async (req, res) => {
  if (!req.uid) return res.status(401).json({ error: 'Unauthorized' });
  const scanRequestId = String(req.params.scanRequestId || '').trim();
  if (!scanRequestId) return res.status(400).json({ error: 'Missing scan request id' });

  const recovery = readAnalysisRecovery(req.uid, scanRequestId);
  if (recovery?.state === 'completed' && recovery.payload) {
    return res.json({ state: 'completed', payload: recovery.payload });
  }

  if (firestore) {
    try {
      const snap = await firestore
        .collection('users')
        .doc(req.uid)
        .collection('scans')
        .where('scanRequestId', '==', scanRequestId)
        .limit(3)
        .get();
      const scans = [];
      snap.forEach((doc) => scans.push(normalizeStoredScanUrls({ id: doc.id, ...doc.data() })));
      if (scans.length) {
        scans.sort((a, b) => storedTimestampMillis(b.timestamp || b.scannedAt || b.createdAt) - storedTimestampMillis(a.timestamp || a.scannedAt || a.createdAt));
        return res.json({ state: 'completed', scan: scans[0] });
      }
    } catch (e) {
      console.warn('[analyze/status] scan lookup failed:', e.message);
    }
  }

  if (recovery?.state === 'failed') {
    return res.json({ state: 'failed', error: recovery.error || 'Analysis failed' });
  }
  if (recovery?.state === 'running') {
    return res.json({ state: 'running', startedAt: recovery.startedAt || null, profileId: recovery.profileId || null });
  }
  return res.json({ state: 'pending' });
});

app.post('/api/unlock-potential', unlockLimiter, extractUserOptional, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image provided' });
  }

  const imagePath = req.file.path;
  const scriptPath = path.join(__dirname, 'unlock_potential.py');
  const pythonExecutable = getPythonExecutable();

  console.log(`[api/unlock-potential] Started for image: ${imagePath}`);

  const py = spawn(pythonExecutable, [scriptPath, imagePath], {
    cwd: __dirname,
    env: { ...process.env },
  });

  let pythonOutput = '';
  let pythonStderr = '';

  py.stdout.on('data', (data) => {
    pythonOutput += data.toString();
  });

  py.stderr.on('data', (data) => {
    pythonStderr += data.toString();
    console.error(`[unlock-potential stderr]: ${data.toString()}`);
  });

  py.on('close', (code) => {
    console.log(`[api/unlock-potential] Python process closed with exit code ${code}`);

    if (code !== 0) {
      return res.status(500).json({
        success: false,
        error: `Process failed with code ${code}.`,
        details: pythonStderr || pythonOutput,
      });
    }

    const outputLines = pythonOutput.trim().split('\n');
    const base64Data = outputLines[outputLines.length - 1].trim();

    if (!base64Data || base64Data.startsWith('Error:')) {
      return res.status(500).json({
        success: false,
        error: base64Data || 'Unknown error occurred in Python script',
      });
    }

    res.json({
      success: true,
      imageUrl: `data:image/png;base64,${base64Data}`,
    });

    setImmediate(async () => {
      // For unlock potential, we just upload without recording to scan history for now
      await uploadImageToFirebase(imagePath, req.uid, 'unlock');
    });
  });
});

app.use('/loading_scan.mp4', express.static(path.join(__dirname, 'loading_scan.mp4')));

app.get('/api/admin/stats', (req, res) => {
  const pw = req.headers['x-admin-password'] || req.query.pw || '';
  if (!adminStore.checkPassword(pw)) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  res.json(adminStore.getStats());
});

app.get('/api/admin/visitor-stats', async (req, res) => {
  const pw = req.headers['x-admin-password'] || req.query.pw || '';
  if (!adminStore.checkPassword(pw)) return res.status(401).json({ error: 'Invalid admin password' });

  const bucketData = buildVisitorBuckets(String(req.query.range || '24h'));
  try {
    const events = [];
    if (!firestore) {
      events.push(...localActivityEvents.filter((event) => Number(event.timestampMs) >= bucketData.startMs));
    } else {
      let snap;
      try {
        snap = await firestore
          .collection('activityEvents')
          .where('timestampMs', '>=', bucketData.startMs)
          .orderBy('timestampMs', 'asc')
          .limit(5000)
          .get();
      } catch (queryErr) {
        console.warn('[admin] visitor stats indexed query failed, falling back:', queryErr.message);
        snap = await firestore
          .collection('activityEvents')
          .orderBy('timestampMs', 'desc')
          .limit(5000)
          .get();
      }
      snap.forEach((doc) => events.push({ id: doc.id, ...doc.data() }));
    }

    const inRangeEvents = [];
    events.forEach((event) => {
      const ts = Number(event.timestampMs) || timestampMs(event.timestamp);
      if (!ts) return;
      const index = bucketData.buckets.findIndex((bucket) => ts >= bucket.startMs && ts < bucket.endMs);
      if (index < 0) return;
      inRangeEvents.push(event);
      bucketData.buckets[index].visitors.add(String(event.visitorId || event.uid || event.ip || 'unknown'));
    });

    const buckets = bucketData.buckets.map((bucket) => ({
      startMs: bucket.startMs,
      label: bucket.label,
      count: bucket.visitors.size,
    }));
    res.json({
      range: bucketData.range,
      label: bucketData.label,
      totalUnique: new Set(inRangeEvents.map((event) => String(event.visitorId || event.uid || event.ip || 'unknown'))).size,
      buckets,
    });
  } catch (e) {
    if (isQuotaExceededError(e)) return res.json({ range: bucketData.range, label: bucketData.label, totalUnique: 0, buckets: bucketData.buckets.map((bucket) => ({ startMs: bucket.startMs, label: bucket.label, count: 0 })), warning: 'Firestore quota exceeded.' });
    console.error('[admin] Failed to read visitor stats:', e);
    res.json({
      range: bucketData.range,
      label: bucketData.label,
      totalUnique: 0,
      buckets: bucketData.buckets.map((bucket) => ({ startMs: bucket.startMs, label: bucket.label, count: 0 })),
      warning: e.message || 'Failed to read visitor stats',
    });
  }
});

app.post('/api/admin/notifications/announcement', async (req, res) => {
  const pw = req.headers['x-admin-password'] || '';
  if (!adminStore.checkPassword(pw)) return res.status(401).json({ error: 'Invalid admin password' });
  if (!firestore) return res.status(503).json({ error: 'Firestore not available' });

  const title = String(req.body?.title || 'MogCheck Announcement').trim().slice(0, 140);
  const body = String(req.body?.body || '').trim().slice(0, 1000);
  const url = String(req.body?.url || '').trim().slice(0, 500);
  if (!body) return res.status(400).json({ error: 'Announcement body is required' });

  try {
    const usersSnap = await firestore.collection('users').get();
    const uids = [];
    usersSnap.forEach((doc) => uids.push(doc.id));
    await Promise.all(
      uids.map((uid) =>
        createNotification(uid, {
          type: 'announcement',
          title,
          body,
          url,
        })
      )
    );
    res.json({ ok: true, count: uids.length });
  } catch (e) {
    console.error('[admin] Failed to send announcement:', e);
    res.status(500).json({ error: e.message || 'Failed to send announcement' });
  }
});

// GET all users for Admin
app.get('/api/admin/users', async (req, res) => {
  const pw = req.headers['x-admin-password'] || '';
  if (!adminStore.checkPassword(pw)) return res.status(401).json({ error: 'Invalid admin password' });
  try {
    let authUsers = [];
    const canListAuthUsers = !(USE_FIREBASE_EMULATOR && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
    if (canListAuthUsers) {
      try {
        const authUsersResult = await Promise.race([
          admin.auth().listUsers(1000),
          new Promise((_, reject) => setTimeout(() => reject(new Error('auth_list_timeout')), 2500)),
        ]); // 1000 limit, ignoring pagination for now
        authUsers = authUsersResult.users || [];
      } catch (authErr) {
        console.error('[admin] Failed to list auth users:', authErr);
      }
    } else {
      console.log('[admin] Skipping Firebase Auth listUsers in emulator mode (no auth emulator configured)');
    }

    let firestoreUsersSnap = null;
    try {
      firestoreUsersSnap = firestore ? await firestore.collection('users').get() : null;
    } catch (firestoreErr) {
      if (isQuotaExceededError(firestoreErr)) {
        console.warn('[admin] Firestore quota exhausted while listing users; returning Auth users only.');
        firestoreUsersSnap = null;
      } else {
        throw firestoreErr;
      }
    }
    const firestoreData = {};
    firestoreUsersSnap?.forEach(doc => {
      firestoreData[doc.id] = doc.data();
    });

    const authUsersByUid = new Map(authUsers.map((u) => [u.uid, u]));
    const allUserIds = Array.from(new Set([
      ...authUsers.map((u) => u.uid),
      ...Object.keys(firestoreData),
    ]));

    const users = allUserIds.map((uid) => {
      const authUser = authUsersByUid.get(uid);
      const fd = firestoreData[uid] || {};
      return {
        uid,
        email: authUser?.email || fd.email || 'Unknown',
        displayName: authUser?.displayName || fd.displayName || 'No Name',
        plan: normalizeUserPlan(fd.plan || 'free'),
        planLabel: fd.planLabel || getPlanLabel(fd.plan || 'free'),
        scanCredits: fd.scanCredits || 0,
        subscriptionStatus: fd.subscriptionStatus || null,
        subscriptionCurrentPeriodEnd: fd.subscriptionCurrentPeriodEnd || null,
        proDaysLeft: calculateDaysLeft(fd.subscriptionCurrentPeriodEnd),
        lastIp: fd.lastIp || 'Unknown',
        lastPlatform: fd.lastPlatform || 'Unknown',
        lastActive:
          fd.lastActive && typeof fd.lastActive.toDate === 'function'
            ? fd.lastActive.toDate().toISOString()
            : (fd.lastActive || null),
      };
    });

    // Sort by last active descending
    users.sort((a, b) => {
      if (!a.lastActive) return 1;
      if (!b.lastActive) return -1;
      return new Date(b.lastActive) - new Date(a.lastActive);
    });

    res.json({ users, firestoreLimited: !firestoreUsersSnap });
  } catch (e) {
    console.error('[admin] Failed to fetch users:', e);
    if (isQuotaExceededError(e)) {
      return res.json({ users: [], firestoreLimited: true, warning: 'Firestore quota exceeded.' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/scan-limits', async (req, res) => {
  const pw = req.headers['x-admin-password'] || '';
  if (!adminStore.checkPassword(pw)) return res.status(401).json({ error: 'Invalid admin password' });
  if (!firestore) return res.status(503).json({ error: 'Firestore not available' });

  try {
    let authUsers = [];
    try {
      const authUsersResult = await Promise.race([
        admin.auth().listUsers(1000),
        new Promise((_, reject) => setTimeout(() => reject(new Error('auth_list_timeout')), 2500)),
      ]);
      authUsers = authUsersResult.users || [];
    } catch (authErr) {
      console.warn('[scan-limits] Auth users unavailable:', authErr.message);
    }

    const usersSnap = await firestore.collection('users').get();
    const firestoreUsers = {};
    usersSnap.forEach((doc) => {
      firestoreUsers[doc.id] = doc.data() || {};
    });

    const authUsersByUid = new Map(authUsers.map((u) => [u.uid, u]));
    const allUserIds = Array.from(new Set([
      ...authUsers.map((u) => u.uid),
      ...Object.keys(firestoreUsers),
    ]));

    const limitedUsers = [];
    for (const uid of allUserIds) {
      const authUser = authUsersByUid.get(uid);
      const fd = firestoreUsers[uid] || {};
      const plan = fd.plan || 'free';
      const policy = await buildFairUsagePolicy(plan, uid);
      if (!policy.lowPriority) continue;

      limitedUsers.push({
        uid,
        email: authUser?.email || fd.email || 'Unknown',
        displayName: authUser?.displayName || fd.displayName || 'No Name',
        plan,
        scansToday: policy.scansToday,
        activeCount: policy.activeCount,
        minimumDurationMs: policy.minimumDurationMs,
        maxConcurrent: policy.maxConcurrent,
        source: policy.limitSource || 'daily_usage',
        manualLimit: Boolean(policy.manualLimit),
        lastActive:
          fd.lastActive && typeof fd.lastActive.toDate === 'function'
            ? fd.lastActive.toDate().toISOString()
            : (fd.lastActive || null),
      });
    }

    limitedUsers.sort((a, b) => {
      if (a.manualLimit !== b.manualLimit) return a.manualLimit ? -1 : 1;
      return (b.scansToday || 0) - (a.scansToday || 0);
    });

    res.json({ limitedUsers });
  } catch (e) {
    console.error('[scan-limits] Failed to fetch limits:', e);
    if (isQuotaExceededError(e)) {
      return res.status(429).json({ error: 'Firestore quota exceeded while fetching scan limits.' });
    }
    res.status(500).json({ error: e.message || 'Failed to fetch scan limits' });
  }
});

app.post('/api/admin/scan-limits/:uid', async (req, res) => {
  const pw = req.headers['x-admin-password'] || '';
  if (!adminStore.checkPassword(pw)) return res.status(401).json({ error: 'Invalid admin password' });
  if (!firestore) return res.status(503).json({ error: 'Firestore not available' });

  const { uid } = req.params;
  try {
    const userDoc = await firestore.collection('users').doc(uid).get();
    const authUser = await admin.auth().getUser(uid).catch(() => null);
    await setScanLimitOverride(uid, {
      mode: 'limit',
      email: authUser?.email || userDoc.data()?.email || req.body?.email || '',
      reason: String(req.body?.reason || 'Manually limited by admin').slice(0, 240),
      expiresAt: admin.firestore.Timestamp.fromMillis(getNextDailyResetMs()),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, uid, mode: 'limit' });
  } catch (e) {
    console.error('[scan-limits] Failed to add manual limit:', e);
    res.status(500).json({ error: e.message || 'Failed to add manual limit' });
  }
});

app.delete('/api/admin/scan-limits/:uid', async (req, res) => {
  const pw = req.headers['x-admin-password'] || '';
  if (!adminStore.checkPassword(pw)) return res.status(401).json({ error: 'Invalid admin password' });
  if (!firestore) return res.status(503).json({ error: 'Firestore not available' });

  const { uid } = req.params;
  try {
    const userDoc = await firestore.collection('users').doc(uid).get();
    const fd = userDoc.data() || {};
    const plan = normalizeUserPlan(fd.plan || 'free');
    const eligible = isProPlanValue(plan);
    const scansToday = eligible ? await countSuccessfulScansToday(uid) : 0;
    const stillAutoLimited = eligible && calculateFairUsageDelay(scansToday) > 0;

    if (stillAutoLimited) {
      await setScanLimitOverride(uid, {
        mode: 'exempt',
        reason: 'Manually un-limited by admin until daily reset',
        expiresAt: admin.firestore.Timestamp.fromMillis(getNextDailyResetMs()),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.json({ ok: true, uid, mode: 'exempt' });
    }

    await firestore.collection(SCAN_LIMIT_OVERRIDES_COLLECTION).doc(uid).delete();
    res.json({ ok: true, uid, mode: 'cleared' });
  } catch (e) {
    console.error('[scan-limits] Failed to remove limit:', e);
    res.status(500).json({ error: e.message || 'Failed to remove limit' });
  }
});

// Update user plan
app.post('/api/admin/users/:uid/plan', async (req, res) => {
  const pw = req.headers['x-admin-password'] || '';
  if (!adminStore.checkPassword(pw)) return res.status(401).json({ error: 'Invalid admin password' });
  if (!firestore) return res.status(503).json({ error: 'Firestore not available' });

  const { uid } = req.params;
  const { plan, scanCredits } = req.body;
  const normalizedPlan = normalizeUserPlan(plan || 'free');
  const parsedCredits = Number(scanCredits ?? 0);
  const allowedPlans = new Set(['free', 'pro', 'pro_monthly', 'pro_annual', 'pro_infinite', 'single_scan']);

  if (!allowedPlans.has(normalizedPlan)) {
    return res.status(400).json({ error: 'Plan must be free, pro_monthly, pro_annual, pro_infinite, or single_scan.' });
  }

  if (!Number.isFinite(parsedCredits)) {
    return res.status(400).json({ error: 'Scan credits must be a valid number.' });
  }

  const normalizedCredits = Math.max(0, Math.floor(parsedCredits));
  const manualPeriodEnd = getManualPlanPeriodEnd(normalizedPlan);
  const planUpdate = {
    plan: normalizedPlan,
    planLabel: getPlanLabel(normalizedPlan),
    scanCredits: normalizedPlan === 'pro_monthly' || normalizedPlan === 'pro_annual' || normalizedPlan === 'pro_infinite' || normalizedPlan === 'pro'
      ? 999
      : normalizedCredits,
    subscriptionStatus: isProPlanValue(normalizedPlan)
      ? (normalizedPlan === 'pro_infinite' ? 'manual_infinite' : 'manual_active')
      : null,
    subscriptionCurrentPeriodEnd: manualPeriodEnd,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  
  try {
    await firestore.collection('users').doc(uid).set(planUpdate, { merge: true });
    res.json({
      ok: true,
      plan: normalizedPlan,
      planLabel: planUpdate.planLabel,
      scanCredits: planUpdate.scanCredits,
      subscriptionStatus: planUpdate.subscriptionStatus,
      subscriptionCurrentPeriodEnd: planUpdate.subscriptionCurrentPeriodEnd,
      proDaysLeft: calculateDaysLeft(planUpdate.subscriptionCurrentPeriodEnd),
    });
  } catch (e) {
    console.error('[admin] Failed to update user plan:', e);
    res.status(500).json({ error: e.message });
  }
});

// Delete user account
app.delete('/api/admin/users/:uid', async (req, res) => {
  const pw = req.headers['x-admin-password'] || '';
  if (!adminStore.checkPassword(pw)) return res.status(401).json({ error: 'Invalid admin password' });
  if (!firestore) return res.status(503).json({ error: 'Firestore not available' });

  const { uid } = req.params;

  try {
    // Delete from Firebase Auth
    await admin.auth().deleteUser(uid);
    
    // Delete Firestore document
    await firestore.collection('users').doc(uid).delete();

    // Delete images in Storage (skip when emulating — no GCS credentials)
    if (!shouldSkipFirebaseStorage()) {
      try {
        const bucket = admin.storage().bucket();
        await bucket.deleteFiles({ prefix: `users/${uid}/` });
      } catch (e) {
        console.log(`[admin] Warning: Failed to delete storage for ${uid}`, e.message);
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[admin] Failed to delete user:', e);
    res.status(500).json({ error: e.message });
  }
});

// Fetch user scans (images) for admin or user
app.get('/api/admin/users/:uid/scans', async (req, res) => {
  const pw = req.headers['x-admin-password'] || '';
  if (!adminStore.checkPassword(pw)) return res.status(401).json({ error: 'Invalid admin password' });
  if (!firestore) return res.status(503).json({ error: 'Firestore not available' });

  try {
    const snap = await firestore.collection('users').doc(req.params.uid).collection('scans').orderBy('timestamp', 'desc').get();
    const scans = [];
    snap.forEach(doc => {
      const scan = normalizeStoredScanUrls({ id: doc.id, ...doc.data() });
      scans.push(scan);
      upsertLocalCachedScan(req.params.uid, doc.id, scan);
    });
    res.json({ scans });
  } catch (e) {
    if (isQuotaExceededError(e)) return res.json({ scans: [], warning: 'Firestore quota exceeded. Scan history is temporarily unavailable.' });
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/users/:uid/mog-battles', async (req, res) => {
  const pw = req.headers['x-admin-password'] || '';
  if (!adminStore.checkPassword(pw)) return res.status(401).json({ error: 'Invalid admin password' });
  if (!firestore) return res.status(503).json({ error: 'Firestore not available' });

  try {
    const snap = await firestore
      .collection('mogBattlesCommunity')
      .where('creatorId', '==', req.params.uid)
      .limit(50)
      .get();

    const battles = [];
    snap.forEach((doc) => battles.push({ id: doc.id, ...doc.data() }));
    battles.sort((a, b) => {
      const aMs = a?.createdAt?.toMillis?.() || (typeof a?.createdAt?.seconds === 'number' ? a.createdAt.seconds * 1000 : new Date(a?.createdAt || 0).getTime() || 0);
      const bMs = b?.createdAt?.toMillis?.() || (typeof b?.createdAt?.seconds === 'number' ? b.createdAt.seconds * 1000 : new Date(b?.createdAt || 0).getTime() || 0);
      return bMs - aMs;
    });

    const tallySnaps = await Promise.all(
      battles.map((battle) => firestore.collection('mogBattles').doc(battle.id).get())
    );

    tallySnaps.forEach((tallySnap, index) => {
      if (!tallySnap.exists) return;
      const data = tallySnap.data() || {};
      battles[index].votesA = Number(data.votesA) || 0;
      battles[index].votesB = Number(data.votesB) || 0;
    });

    res.json({ battles });
  } catch (e) {
    if (isQuotaExceededError(e)) return res.json({ battles: [], warning: 'Firestore quota exceeded.' });
    console.error('[admin] Failed to read user Mog Battles:', e);
    res.json({ battles: [], warning: e.message || 'Failed to read Mog Battles' });
  }
});

app.get('/api/admin/users/:uid/activity', async (req, res) => {
  const pw = req.headers['x-admin-password'] || '';
  if (!adminStore.checkPassword(pw)) return res.status(401).json({ error: 'Invalid admin password' });
  const uid = String(req.params.uid || '').trim();
  if (!uid) return res.status(400).json({ error: 'Missing uid' });

  try {
    if (!firestore) {
      return res.json({ events: (localUserActivity[uid] || []).slice(0, 150).map(serializeActivityEvent) });
    }
    let snap;
    try {
      snap = await firestore.collection('users').doc(uid).collection('activity').orderBy('timestampMs', 'desc').limit(150).get();
    } catch (orderErr) {
      console.warn('[admin] user activity orderBy failed, falling back:', orderErr.message);
      snap = await firestore.collection('users').doc(uid).collection('activity').limit(150).get();
    }
    const events = [];
    snap.forEach((doc) => events.push(serializeActivityEvent({ id: doc.id, ...doc.data() })));
    events.sort((a, b) => (Number(b.timestampMs) || timestampMs(b.timestamp)) - (Number(a.timestampMs) || timestampMs(a.timestamp)));
    res.json({ events });
  } catch (e) {
    if (isQuotaExceededError(e)) return res.json({ events: [], warning: 'Firestore quota exceeded.' });
    console.error('[admin] Failed to read activity:', e);
    res.json({ events: [], warning: e.message || 'Failed to read activity' });
  }
});

app.get('/api/admin/users/:uid/purchases', async (req, res) => {
  const pw = req.headers['x-admin-password'] || '';
  if (!adminStore.checkPassword(pw)) return res.status(401).json({ error: 'Invalid admin password' });
  const uid = String(req.params.uid || '').trim();
  if (!uid) return res.status(400).json({ error: 'Missing uid' });

  try {
    if (!firestore) {
      return res.json({ purchases: (localPurchases[uid] || []).slice(0, 100).map(serializePurchase) });
    }
    let snap;
    try {
      snap = await firestore.collection('users').doc(uid).collection('purchases').orderBy('purchasedAtMs', 'desc').limit(100).get();
    } catch (orderErr) {
      console.warn('[admin] purchases orderBy failed, falling back:', orderErr.message);
      snap = await firestore.collection('users').doc(uid).collection('purchases').limit(100).get();
    }
    const purchases = [];
    snap.forEach((doc) => purchases.push(serializePurchase({ id: doc.id, ...doc.data() })));
    const userSnap = await firestore.collection('users').doc(uid).get().catch(() => null);
    const fallbackPurchase = userSnap?.exists ? buildPlanPurchaseFallback(userSnap.data() || {}) : null;
    if (fallbackPurchase && !purchases.some((purchase) =>
      (fallbackPurchase.subscriptionId && String(purchase.subscriptionId || '') === fallbackPurchase.subscriptionId) ||
      String(purchase.id || '') === fallbackPurchase.id
    )) {
      purchases.push(fallbackPurchase);
    }
    purchases.sort((a, b) => (Number(b.purchasedAtMs) || timestampMs(b.purchasedAt)) - (Number(a.purchasedAtMs) || timestampMs(a.purchasedAt)));
    res.json({ purchases });
  } catch (e) {
    if (isQuotaExceededError(e)) return res.json({ purchases: [], warning: 'Firestore quota exceeded.' });
    console.error('[admin] Failed to read purchases:', e);
    res.json({ purchases: [], warning: e.message || 'Failed to read purchases' });
  }
});

// Delete specific scan
app.delete('/api/admin/users/:uid/scans/:scanId', async (req, res) => {
  const pw = req.headers['x-admin-password'] || '';
  if (!adminStore.checkPassword(pw)) return res.status(401).json({ error: 'Invalid admin password' });
  if (!firestore) return res.status(503).json({ error: 'Firestore not available' });

  const { uid, scanId } = req.params;
  try {
    const docRef = firestore.collection('users').doc(uid).collection('scans').doc(scanId);
    const doc = await docRef.get();
    if (doc.exists) {
      const d = doc.data();
      if (!shouldSkipFirebaseStorage()) {
        const bucket = admin.storage().bucket();
        if (d.frontImageDest) await bucket.file(d.frontImageDest).delete().catch(() => {});
        if (d.sideImageDest) await bucket.file(d.sideImageDest).delete().catch(() => {});
      }
      await syncCommunityScanVisibility(uid, scanId, d, 'private');
      await docRef.delete();
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// User endpoints for scans
const profilesRoutes = require('./profiles-routes.js');
profilesRoutes(app, firestore, admin, extractUserOptional);

app.get('/api/user/scans', extractUserOptional, async (req, res) => {
  if (!req.uid) return res.status(401).json({ error: 'Unauthorized' });
  if (!firestore) return res.json({ scans: [], warning: 'Firestore unavailable. Scan history is temporarily unavailable.' });
  if (isFirestoreQuotaCoolingDown()) {
    return res.json({ scans: [], warning: firestoreQuotaCooldownWarning() });
  }
  try {
    const snap = await firestore.collection('users').doc(req.uid).collection('scans').orderBy('timestamp', 'desc').get();
    const scans = [];
    snap.forEach(doc => {
      const scan = normalizeStoredScanUrls({ id: doc.id, ...doc.data() });
      if (scan.state === 'running' || scan.payload?.status === 'running') return;
      scans.push(scan);
      upsertLocalCachedScan(req.uid, doc.id, scan);
    });
    res.json({ scans });
  } catch (e) {
    if (isQuotaExceededError(e)) {
      noteFirestoreQuotaExceeded('user/scans');
      return res.json({ scans: [], warning: firestoreQuotaCooldownWarning() });
    }
    console.error('[user/scans] GET failed:', e.message || e);
    res.json({ scans: [], warning: 'Firestore failed. Scan history is temporarily unavailable.' });
  }
});

app.get('/api/user/purchases', extractUserOptional, async (req, res) => {
  if (!req.uid) return res.status(401).json({ error: 'Unauthorized' });
  try {
    if (!firestore) {
      return res.json({ purchases: (localPurchases[req.uid] || []).slice(0, 100).map(serializePurchase) });
    }
    if (isFirestoreQuotaCoolingDown()) {
      return res.json({ purchases: [], warning: firestoreQuotaCooldownWarning() });
    }
    let snap;
    try {
      snap = await firestore.collection('users').doc(req.uid).collection('purchases').orderBy('purchasedAtMs', 'desc').limit(100).get();
    } catch (orderErr) {
      console.warn('[user/purchases] orderBy failed, falling back:', orderErr.message);
      snap = await firestore.collection('users').doc(req.uid).collection('purchases').limit(100).get();
    }
    const purchases = [];
    snap.forEach((doc) => purchases.push(serializePurchase({ id: doc.id, ...doc.data() })));
    const userSnap = await firestore.collection('users').doc(req.uid).get();
    const fallbackPurchase = userSnap.exists ? buildPlanPurchaseFallback(userSnap.data() || {}) : null;
    if (fallbackPurchase && !purchases.some((purchase) =>
      (fallbackPurchase.subscriptionId && String(purchase.subscriptionId || '') === fallbackPurchase.subscriptionId) ||
      String(purchase.id || '') === fallbackPurchase.id
    )) {
      purchases.push(fallbackPurchase);
    }
    purchases.sort((a, b) => (Number(b.purchasedAtMs) || timestampMs(b.purchasedAt)) - (Number(a.purchasedAtMs) || timestampMs(a.purchasedAt)));
    res.json({ purchases });
  } catch (e) {
    if (isQuotaExceededError(e)) {
      noteFirestoreQuotaExceeded('user/purchases');
      return res.json({ purchases: [], warning: firestoreQuotaCooldownWarning() });
    }
    res.status(500).json({ error: e.message || 'Failed to read purchases' });
  }
});

app.put('/api/user/scans/:scanId', extractUserOptional, async (req, res) => {
  if (!req.uid) return res.status(401).json({ error: 'Unauthorized' });
  const { scanId } = req.params;
  try {
    let currentData = getLocalCachedScan(req.uid, scanId) || {};
    let docRef = null;
    if (firestore) {
      docRef = firestore.collection('users').doc(req.uid).collection('scans').doc(scanId);
      const doc = await docRef.get();
      if (doc.exists) currentData = doc.data() || currentData;
    }
    if (!currentData || !Object.keys(currentData).length) return res.status(404).json({ error: 'Scan not found' });

    const updateData = {
      updatedAt: new Date().toISOString(),
    };

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'visibility')) {
      updateData.visibility = normalizeScanVisibility(req.body.visibility);
    }

    if (Object.keys(updateData).length === 1) {
      return res.json({ ok: true, scan: normalizeStoredScanUrls({ id: scanId, ...currentData }) });
    }

    if (docRef) {
      await docRef.set({
        ...updateData,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    const nextData = { ...currentData, ...updateData };
    upsertLocalCachedScan(req.uid, scanId, nextData);

    if (Object.prototype.hasOwnProperty.call(updateData, 'visibility')) {
      await syncCommunityScanVisibility(req.uid, scanId, nextData, updateData.visibility);
    }

    res.json({
      ok: true,
      scan: {
        ...normalizeStoredScanUrls({ id: scanId, ...nextData }),
      },
    });
  } catch (e) {
    console.error('[user/scans] PUT failed:', e);
    const localScan = getLocalCachedScan(req.uid, scanId);
    if (localScan) {
      const fallbackUpdate = {};
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'visibility')) {
        fallbackUpdate.visibility = normalizeScanVisibility(req.body.visibility);
      }
      upsertLocalCachedScan(req.uid, scanId, fallbackUpdate);
      return res.json({ ok: true, scan: normalizeStoredScanUrls({ ...localScan, ...fallbackUpdate }), localFallback: true });
    }
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/user/scans/:scanId', extractUserOptional, async (req, res) => {
  if (!req.uid) return res.status(401).json({ error: 'Unauthorized' });
  const { scanId } = req.params;
  try {
    if (firestore) {
      const docRef = firestore.collection('users').doc(req.uid).collection('scans').doc(scanId);
      const doc = await docRef.get();
      if (doc.exists) {
        const d = doc.data();
        if (!shouldSkipFirebaseStorage()) {
          const bucket = admin.storage().bucket();
          if (d.frontImageDest) await bucket.file(d.frontImageDest).delete().catch(() => {});
          if (d.sideImageDest) await bucket.file(d.sideImageDest).delete().catch(() => {});
        }
        await syncCommunityScanVisibility(req.uid, scanId, d, 'private');
        await docRef.delete();
      }
    }
    deleteLocalCachedScan(req.uid, scanId);
    res.json({ ok: true });
  } catch (e) {
    console.error('[user/scans] DELETE failed:', e);
    res.status(500).json({ error: e.message });
  }
});

app.use(
  '/uploads',
  express.static(path.join(__dirname, 'uploads'), {
    maxAge: '30d',
    immutable: true,
    etag: true,
  })
);

if (fs.existsSync(distDir)) {
  app.get(/^(?!\/(?:api|uploads)\/).*/, (req, res) => {
    debugLog('H1', 'SPA fallback served', { path: req.path });
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const PORT = Number(process.env.PORT || 3001);

async function start() {
  await adminStore.init();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend Bridge running on http://0.0.0.0:${PORT}`);
    console.log(
      'Tip: Python AI engine (final_engine.py) logs to THIS same terminal when /api/analyze runs — keep this window visible while scanning.'
    );
    console.log('[cors] Allowed origins: ALL (Configured for Vercel dynamic URLs)');
  });
}

start().catch((e) => {
  console.error('[server] Failed to start:', e);
  process.exit(1);
});

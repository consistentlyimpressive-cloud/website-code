require('dotenv').config();

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
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

app.post(
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
);

app.use(express.json({ limit: '2mb' }));

/** In-memory fallback for mog battles if firestore is missing */
const localMogBattles = {};
const localMogVotes = {}; // { battleId: { uid: side } }
const localCommunityBattles = []; // Array of community battles

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
  return typeof id === 'string' && /^[a-z0-9-]{1,80}$/i.test(id);
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

/** Public tallies — same numbers for every client worldwide. */
app.get('/api/mog-battle/votes/:battleId', requireFirestore, async (req, res) => {
  const battleId = String(req.params.battleId || '').trim();
  if (!isValidMogBattleId(battleId)) {
    return res.status(400).json({ error: 'Invalid battle id' });
  }

  if (!firestore) {
    const d = localMogBattles[battleId] || { votesA: 0, votesB: 0 };
    return res.json({ a: d.votesA, b: d.votesB });
  }

  try {
    const snap = await firestore.collection('mogBattles').doc(battleId).get();
    if (!snap.exists) {
      return res.json({ a: 0, b: 0 });
    }
    const d = snap.data() || {};
    return res.json({
      a: Number(d.votesA) || 0,
      b: Number(d.votesB) || 0,
    });
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

/** Community Mog Battles */
app.get('/api/mog-battle/community', requireFirestore, async (req, res) => {
  if (!firestore) {
    return res.json({ battles: localCommunityBattles });
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
        battles[i].votesA = Number(t.votesA) || 0;
        battles[i].votesB = Number(t.votesB) || 0;
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

    const battleData = {
      creatorId: decoded.uid,
      fighterA,
      fighterB,
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
      
      if (!isMogBattleAdminEmail(decoded.email)) {
        if (localMogVotes[battleId][uid]) {
           return res.status(409).json({
             error: 'already_voted',
             side: localMogVotes[battleId][uid],
             a: Number(localMogBattles[battleId].votesA) || 0,
             b: Number(localMogBattles[battleId].votesB) || 0,
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
      }
      
      return res.json({ success: true });
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
      return res.json({
        ok: true,
        isBattleAdmin: true,
        a: Number(d.votesA) || 0,
        b: Number(d.votesB) || 0,
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
      return { status: 'ok' };
    });

    const snap = await battleRef.get();
    const d = snap.data() || {};
    const tallies = {
      a: Number(d.votesA) || 0,
      b: Number(d.votesB) || 0,
    };

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
        ...tallies,
      });
    }

    return res.json({ ok: true, ...tallies });
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

/** Deeper check: Firestore reachable (for orchestration readiness probes). */
app.get('/api/ready', async (req, res) => {
  try {
    await firestore.collection('system').doc('adminStore').get();
    res.json({
      ok: true,
      checks: { firestore: true },
      firebaseMode: USE_FIREBASE_EMULATOR ? 'emulator' : 'live',
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
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
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  if (process.platform === 'win32') {
    return path.join(__dirname, 'venv', 'Scripts', 'python.exe');
  }
  return path.join(__dirname, 'venv', 'bin', 'python3');
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

function getPublicBackendBase(req) {
  const requestBase = getRequestBase(req);
  const raw = (process.env.PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '');
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
  } catch (e) {
    // ignore invalid token for optional auth
  }
  next();
}

/** Ultra models (choice 1 / 2) require Firebase auth + Pro plan or Single Scan with credits. */
async function verifyUltraAccess(req, res, next) {
  const modelChoice = String((req.body && req.body.choice) || '3').trim();
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

  if (!firestore) {
    return res.status(503).json({
      success: false,
      error: firebaseConfigHelpMessage(),
    });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;
    const snap = await firestore.collection('users').doc(uid).get();
    if (!snap.exists && USE_FIREBASE_EMULATOR && isRemoteBrowserRequest(req)) {
      return res.status(503).json({
        success: false,
        error:
          'This backend is still reading from the local Firebase emulator, so live premium plan checks cannot work. Start the API without USE_FIREBASE_EMULATOR and configure live Firebase Admin credentials.',
      });
    }
    const data = snap.exists ? snap.data() : {};
    const plan = String(data.plan || 'free');
    const scanCredits = Number(data.scanCredits) || 0;

    const email = (decoded.email || '').toLowerCase();
    const isAdminEmail = 
      email.endsWith('@looksmaxxing.com') ||
      email === 'serenity.eyb@gmail.com' ||
      email === 'laithbu07@gmail.com' ||
      email === 'laithabuamsheh@gmail.com';

    if (plan === 'pro' || data.isAdmin || isAdminEmail) {
      req.ultraContext = { uid, plan: 'pro' };
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
  (req, res) => {
    // Check files immediately after upload parsing
    const frontFile = req.files && req.files['image'] && req.files['image'][0];
    if (!frontFile) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const imagePath = frontFile.path;
    const sideFile = req.files && req.files['sideImage'] && req.files['sideImage'][0];
    const sideImagePath = sideFile ? sideFile.path : '';
    const statsJson = req.body.stats;
    const modelChoice = String((req.body && req.body.choice) || '3').trim();

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
    if (sideImagePath) {
      args.push(sideImagePath);
    }

    const pythonExecutable = getPythonExecutable();

    const py = spawn(pythonExecutable, args, {
      cwd: __dirname,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });

    /** Prevent hung Gemini/API calls from blocking the client forever (default 8 min). */
    const PYTHON_MAX_MS = Number(process.env.ANALYZE_PYTHON_TIMEOUT_MS || 480000);
    let analyzeTimedOut = false;
    const killTimer = setTimeout(() => {
      analyzeTimedOut = true;
      console.error(`[api/analyze] Python exceeded ${PYTHON_MAX_MS}ms — terminating process`);
      try {
        py.kill('SIGKILL');
      } catch (e) {
        console.error('[api/analyze] Failed to kill Python:', e.message);
      }
    }, PYTHON_MAX_MS);

    py.on('error', (err) => {
      clearTimeout(killTimer);
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
      if (res.headersSent) return;

      if (analyzeTimedOut) {
        console.log(`\n[api/analyze] Python closed after timeout (code=${code})`);
        return res.status(504).json({
          success: false,
          error:
            'Analysis timed out — the AI engine took too long. Check backend/.env for API keys, your network, or try a smaller image. See the backend terminal for Python errors.',
        });
      }

      console.log(`\n[api/analyze] Python process closed with exit code ${code}`);

      let parsed;
      try {
        parsed = parseAnalysisOutput(pythonOutput, __dirname);
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

      // Treat as success if Python exited cleanly and we got either a full parse or at least a numeric rating
      const success =
        code === 0 &&
        (parsed.hasSubstantiveParse === true ||
          (parsed.finalRating != null && !Number.isNaN(Number(parsed.finalRating))));

  const finalRating =
    parsed.finalRating != null && !Number.isNaN(parsed.finalRating) ? parsed.finalRating : null;
  const sideRating =
    parsed.sideRating != null && !Number.isNaN(parsed.sideRating) ? parsed.sideRating : null;

  const payload = {
    success,
    sex: parsed.sex,
    finalRating,
    sideRating,
    technicalSummary: parsed.technicalSummary,
    appealAssessment: parsed.appealAssessment || null,
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
    rawOutput:
      pythonStderr.trim().length > 0
        ? `${pythonOutput}\n\n--- Python stderr ---\n${pythonStderr}`
        : pythonOutput,
  };

  const frontFallbackUrl = getLocalUploadUrl(req, imagePath);
  const sideFallbackUrl = getLocalUploadUrl(req, sideImagePath);
  if (frontFallbackUrl) payload.frontImage = frontFallbackUrl;
  if (sideFallbackUrl) payload.sideImage = sideFallbackUrl;

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

  console.log(
    `[api/analyze] Parsed → bestFeatures=${payload.bestFeatures.length} flaws=${payload.primaryFlaws.length} biometrics=${(payload.biometrics || []).length} rating=${finalRating ?? 'n/a'}`
  );
  console.log('========== END PY ENGINE ==========\n');

  adminStore.parseKeyEventsFromStdout(pythonOutput);
  adminStore.logAnalysis({
    model: modelChoice,
    durationMs: Date.now() - analysisStartTime,
    success,
    rating: finalRating,
    sideRating,
    error: payload.error || null,
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

  res.json(payload);

      setImmediate(async () => {
        let frontUpload = null;
        let sideUpload = null;

        if (imagePath) frontUpload = await uploadImageToFirebase(imagePath, req.uid, 'front');
        if (sideImagePath) sideUpload = await uploadImageToFirebase(sideImagePath, req.uid, 'side');

        if (success && req.uid && firestore) {
          try {
            const persistedFrontImage = frontUpload ? frontUpload.url : frontFallbackUrl;
            const persistedSideImage = sideUpload ? sideUpload.url : sideFallbackUrl;
            await firestore.collection('users').doc(req.uid).collection('scans').add({
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              model: modelChoice,
              finalRating,
              sideRating,
              frontImageUrl: persistedFrontImage || null,
              sideImageUrl: persistedSideImage || null,
              frontImageDest: frontUpload ? frontUpload.dest : null,
              sideImageDest: sideUpload ? sideUpload.dest : null,
              success: true,
              payload: {
                ...payload,
                frontImage: persistedFrontImage || payload.frontImage || null,
                sideImage: persistedSideImage || payload.sideImage || null,
              }, // NEW: save the full payload so profiles can fetch it later
              profileId: req.body.profileId || 'default' // NEW: associate with a profile
            });
          } catch (e) {
            console.error('[analyze] Failed to record scan history:', e.message);
          }
        }
      });
    });
  }
);

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

// GET all users for Admin
app.get('/api/admin/users', async (req, res) => {
  const pw = req.headers['x-admin-password'] || '';
  if (!adminStore.checkPassword(pw)) return res.status(401).json({ error: 'Invalid admin password' });
  if (!firestore) return res.status(503).json({ error: 'Firestore not available' });

  try {
    let authUsers = [];
    try {
      const authUsersResult = await admin.auth().listUsers(1000); // 1000 limit, ignoring pagination for now
      authUsers = authUsersResult.users || [];
    } catch (authErr) {
      console.error('[admin] Failed to list auth users:', authErr);
    }

    const firestoreUsersSnap = await firestore.collection('users').get();
    const firestoreData = {};
    firestoreUsersSnap.forEach(doc => {
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
        plan: fd.plan || 'free',
        scanCredits: fd.scanCredits || 0,
        lastIp: fd.lastIp || 'Unknown',
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

    res.json({ users });
  } catch (e) {
    console.error('[admin] Failed to fetch users:', e);
    res.status(500).json({ error: e.message });
  }
});

// Update user plan
app.post('/api/admin/users/:uid/plan', async (req, res) => {
  const pw = req.headers['x-admin-password'] || '';
  if (!adminStore.checkPassword(pw)) return res.status(401).json({ error: 'Invalid admin password' });
  if (!firestore) return res.status(503).json({ error: 'Firestore not available' });

  const { uid } = req.params;
  const { plan, scanCredits } = req.body;
  
  try {
    await firestore.collection('users').doc(uid).set({
      plan: String(plan || 'free'),
      scanCredits: Number(scanCredits || 0),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    res.json({ ok: true });
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
    snap.forEach(doc => scans.push({ id: doc.id, ...doc.data() }));
    res.json({ scans });
  } catch (e) {
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
    res.status(500).json({ error: e.message });
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
  if (!req.uid || !firestore) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const snap = await firestore.collection('users').doc(req.uid).collection('scans').orderBy('timestamp', 'desc').get();
    const scans = [];
    snap.forEach(doc => scans.push({ id: doc.id, ...doc.data() }));
    res.json({ scans });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/user/scans/:scanId', extractUserOptional, async (req, res) => {
  if (!req.uid || !firestore) return res.status(401).json({ error: 'Unauthorized' });
  const { scanId } = req.params;
  try {
    const docRef = firestore.collection('users').doc(req.uid).collection('scans').doc(scanId);
    const doc = await docRef.get();
    if (doc.exists) {
      const d = doc.data();
      if (!shouldSkipFirebaseStorage()) {
        const bucket = admin.storage().bucket();
        if (d.frontImageDest) await bucket.file(d.frontImageDest).delete().catch(() => {});
        if (d.sideImageDest) await bucket.file(d.sideImageDest).delete().catch(() => {});
      }
      await docRef.delete();
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

if (fs.existsSync(distDir)) {
  app.get(/^(?!\/api\/).*/, (req, res) => {
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

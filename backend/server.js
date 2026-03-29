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
const admin = require('firebase-admin');

function initFirebaseAdmin() {
  if (admin.apps.length) return;
  const bucket =
    process.env.FIREBASE_STORAGE_BUCKET || 'mogcheck-net.firebasestorage.app';
  const projectId = process.env.FIREBASE_PROJECT_ID || 'mogcheck-net';
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

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

  admin.initializeApp({
    projectId,
    storageBucket: bucket,
  });
  console.log('[firebase] Initialized with projectId (use ADC or service account in production)');
}

try {
  initFirebaseAdmin();
  const firestore = admin.firestore();
  adminStore.setFirestore(firestore);
} catch (e) {
  console.error('[firebase] Failed to initialize admin SDK, continuing without it:', e.message);
}

/** Process start time for /api/health uptime */
const SERVER_BOOT_AT = Date.now();

const app = express();

const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const corsOptions =
  corsOrigins.length > 0
    ? { origin: corsOrigins, credentials: true }
    : undefined;
app.use(cors(corsOptions));

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

function healthPayload() {
  return {
    ok: true,
    service: 'mogcheck-backend',
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

/** Deeper check: Firestore reachable (for orchestration readiness probes). */
app.get('/api/ready', async (req, res) => {
  try {
    await firestore.collection('system').doc('adminStore').get();
    res.json({
      ok: true,
      checks: { firestore: true },
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(503).json({
      ok: false,
      checks: { firestore: false },
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

function getPublicBackendBase() {
  const raw = (process.env.PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '');
  if (raw) return raw;
  const port = Number(process.env.PORT || 3001);
  return `http://localhost:${port}`;
}

/** Full URL for loading scan video in analyze response (CDN or same-origin). */
function getLoadingVideoUrl() {
  const custom = (process.env.LOADING_VIDEO_URL || '').trim();
  if (custom) return custom;
  return `${getPublicBackendBase()}/loading_scan.mp4`;
}

function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

async function maybeUploadAndDeleteLocal(localPath) {
  if (process.env.UPLOAD_TO_FIREBASE_STORAGE !== 'true') return;
  if (!localPath || !fs.existsSync(localPath)) return;
  try {
    const bucket = admin.storage().bucket();
    const dest = `uploads/${path.basename(localPath)}`;
    await bucket.upload(localPath, {
      destination: dest,
      metadata: {
        contentType: guessContentType(localPath),
        cacheControl: 'public, max-age=3600',
      },
    });
    fs.unlinkSync(localPath);
    console.log(`[storage] Uploaded and removed local: ${dest}`);
  } catch (e) {
    console.error('[storage] Upload failed (local file kept):', e.message);
  }
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

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;
    const snap = await firestore.collection('users').doc(uid).get();
    const data = snap.exists ? snap.data() : {};
    const plan = String(data.plan || 'free');
    const scanCredits = Number(data.scanCredits) || 0;

    if (plan === 'pro') {
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

    py.on('error', (err) => {
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
      if (res.headersSent) return;

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
          bestFeatures: [],
          primaryFlaws: [],
          categories: null,
          biometrics: [],
          hasSubstantiveParse: false,
        };
      }

      const success = code === 0 && parsed.hasSubstantiveParse === true;

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
    bestFeatures: parsed.bestFeatures || [],
    primaryFlaws: parsed.primaryFlaws || [],
    sideBestFeatures: parsed.sideBestFeatures || [],
    sidePrimaryFlaws: parsed.sidePrimaryFlaws || [],
    categories: parsed.categories || [],
    sideCategories: parsed.sideCategories || [],
    biometrics: parsed.biometrics?.length ? parsed.biometrics : undefined,
    sideBiometrics: parsed.sideBiometrics?.length ? parsed.sideBiometrics : undefined,
    protocols: parsed.protocols?.length ? parsed.protocols : undefined,
    videoUrl: getLoadingVideoUrl(),
    rawOutput:
      pythonStderr.trim().length > 0
        ? `${pythonOutput}\n\n--- Python stderr ---\n${pythonStderr}`
        : pythonOutput,
  };

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

  if (success && req.ultraContext && req.ultraContext.plan === 'single_scan') {
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

      setImmediate(() => {
        maybeUploadAndDeleteLocal(imagePath).catch(() => {});
        if (sideImagePath) maybeUploadAndDeleteLocal(sideImagePath).catch(() => {});
      });
    });
  }
);

app.post('/api/unlock-potential', unlockLimiter, upload.single('image'), (req, res) => {
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

    setImmediate(() => {
      maybeUploadAndDeleteLocal(imagePath).catch(() => {});
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

if (fs.existsSync(distDir)) {
  app.get(/^(?!\/api\/).*/, (req, res) => {
    debugLog('H1', 'SPA fallback served', { path: req.path });
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const PORT = Number(process.env.PORT || 10000);

async function start() {
  await adminStore.init();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend Bridge running on http://0.0.0.0:${PORT}`);
    console.log(
      'Tip: Python AI engine (final_engine.py) logs to THIS same terminal when /api/analyze runs — keep this window visible while scanning.'
    );
    if (corsOrigins.length) console.log('[cors] Allowed origins:', corsOrigins.join(', '));
    else console.log('[cors] No CORS_ORIGINS set — allowing all origins (set in production)');
  });
}

start().catch((e) => {
  console.error('[server] Failed to start:', e);
  process.exit(1);
});

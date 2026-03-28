require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { parseAnalysisOutput } = require('./parse-analysis-output');
const adminStore = require('./admin-store');

const app = express();
app.use(cors());
app.use(express.json());

// ---- Debug logging (cb256d) ----
// Write NDJSON runtime evidence (project folder so workspace tools always see it).
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
        timestamp: Date.now()
      }) + '\n',
      'utf8'
    );
  } catch (e) {
    console.error('[debug-cb256d] log write failed:', DEBUG_LOG_PATH, e?.message || e);
  }
}

// Same-origin debug ingest (browser-safe)
app.post('/api/debug-log', (req, res) => {
  const { hypothesisId, message, data, location, runId } = req.body || {};
  debugLog(
    String(hypothesisId || 'H?'),
    String(message || 'debug'),
    {
      ...(data && typeof data === 'object' ? data : {}),
      location: String(location || 'client'),
      runId: String(runId || 'pre-fix')
    }
  );
  res.json({ ok: true });
});

debugLog('H0', 'Server boot', { debugLogPath: DEBUG_LOG_PATH });

// ---- Serve the built frontend (dist/) ----
// The zip includes a production build in ../dist. Serve it from this backend so
// you can run one server and open the site in the browser.
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  // #region agent log cb256d H1
  debugLog('H1', 'Serving dist directory', { distDir });
  // #endregion

  app.use((req, res, next) => {
    const p = req.path || '';
    // #region agent log cb256d H1/H2
    if (p === '/' || p === '/index.html' || p.startsWith('/assets/')) {
      debugLog('H1', 'HTTP request', {
        method: req.method,
        path: p,
        ua: String(req.headers['user-agent'] || '').slice(0, 120)
      });
    }
    // #endregion
    next();
  });

  app.use(express.static(distDir));
}

// Set up storage for uploaded images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    if (file.fieldname === 'sideImage') {
      cb(null, 'testside.jpg');
    } else {
      cb(null, 'test.jpg');
    }
  }
});
const upload = multer({ storage });

const analyzeUpload = upload.fields([{ name: 'image', maxCount: 1 }, { name: 'sideImage', maxCount: 1 }]);
app.post('/api/analyze', (req, res, next) => {
  analyzeUpload(req, res, (err) => {
    if (err) {
      console.error('Multer upload error:', err);
      return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
    }
    next();
  });
}, (req, res) => {
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

  const pythonExecutable = path.join(__dirname, 'venv', 'Scripts', 'python.exe');

  const py = spawn(pythonExecutable, args, {
    cwd: __dirname,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1'
    }
  });

  py.on('error', (err) => {
    console.error('Failed to start Python process:', err);
    if (!res.headersSent) {
      res.json({ success: false, error: 'Python environment missing or final_engine.py failed to start.' });
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

  py.on('close', (code) => {
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
        hasSubstantiveParse: false
      };
    }

    // Require a real AI payload AND a clean Python exit. (Exit 0 alone was wrongly treated as success before.)
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
      bestFeatures: parsed.bestFeatures,
      primaryFlaws: parsed.primaryFlaws,
      sideBestFeatures: parsed.sideBestFeatures,
      sidePrimaryFlaws: parsed.sidePrimaryFlaws,
      categories: parsed.categories,
      sideCategories: parsed.sideCategories,
      biometrics: parsed.biometrics.length ? parsed.biometrics : undefined,
      sideBiometrics: parsed.sideBiometrics.length ? parsed.sideBiometrics : undefined,
      videoUrl: 'http://localhost:3001/loading_scan.mp4',
      rawOutput:
        pythonStderr.trim().length > 0
          ? `${pythonOutput}\n\n--- Python stderr ---\n${pythonStderr}`
          : pythonOutput
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
      error: payload.error || null
    });

    res.json(payload);
  });
});

app.post('/api/unlock-potential', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image provided' });
  }

  const imagePath = req.file.path;
  const scriptPath = path.join(__dirname, 'unlock_potential.py');
  const pythonExecutable = path.join(__dirname, 'venv', 'Scripts', 'python.exe');

  console.log(`[api/unlock-potential] Started for image: ${imagePath}`);

  const py = spawn(pythonExecutable, [scriptPath, imagePath], {
    cwd: __dirname,
    env: { ...process.env }
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
        details: pythonStderr || pythonOutput
      });
    }

    const outputLines = pythonOutput.trim().split('\n');
    // The base64 string should be the last printed line if there were prints before it, but our script only prints the base64 or an error
    const base64Data = outputLines[outputLines.length - 1].trim();

    if (!base64Data || base64Data.startsWith('Error:')) {
      return res.status(500).json({ 
        success: false, 
        error: base64Data || 'Unknown error occurred in Python script' 
      });
    }

    res.json({ 
      success: true, 
      imageUrl: `data:image/png;base64,${base64Data}` 
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

// SPA fallback for frontend routes
if (fs.existsSync(distDir)) {
  // Express v5 + path-to-regexp does not accept '*' string routes.
  // Use a regex to serve the SPA shell for any non-API route.
  app.get(/^(?!\/api\/).*/, (req, res) => {
    // #region agent log cb256d H1
    debugLog('H1', 'SPA fallback served', { path: req.path });
    // #endregion
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log(`Backend Bridge running on http://localhost:${PORT}`);
  console.log(
    'Tip: Python AI engine (final_engine.py) logs to THIS same terminal when /api/analyze runs — keep this window visible while scanning.'
  );
});

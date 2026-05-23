const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const admin = require('firebase-admin');

dotenv.config({ path: path.join(__dirname, '.env') });

const WRITE = process.argv.includes('--write');
const uploadsDir = path.join(__dirname, 'uploads');

function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function extractUploadFilename(value) {
  if (typeof value !== 'string' || !value.includes('/uploads/')) return null;
  const match = value.match(/\/uploads\/([^?#]+)/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function setNested(target, pathParts, value) {
  let node = target;
  for (let i = 0; i < pathParts.length - 1; i += 1) {
    const part = pathParts[i];
    if (!node[part] || typeof node[part] !== 'object') node[part] = {};
    node = node[part];
  }
  node[pathParts[pathParts.length - 1]] = value;
}

function collectUploadFields(scan) {
  const fields = [
    ['frontImageUrl'],
    ['sideImageUrl'],
    ['debugAnchorsImageUrl'],
    ['debugRatiosImageUrl'],
    ['payload', 'frontImage'],
    ['payload', 'frontImageUrl'],
    ['payload', 'sideImage'],
    ['payload', 'sideImageUrl'],
    ['payload', 'debugAnchorsImage'],
    ['payload', 'debugAnchorsImageUrl'],
    ['payload', 'debugRatiosImage'],
    ['payload', 'debugRatiosImageUrl'],
  ];

  return fields
    .map((parts) => {
      let value = scan;
      for (const part of parts) value = value && typeof value === 'object' ? value[part] : undefined;
      const filename = extractUploadFilename(value);
      return filename ? { parts, filename } : null;
    })
    .filter(Boolean);
}

function initFirebase() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing from backend/.env');
  const credential = JSON.parse(json);
  const projectId = credential.project_id || process.env.FIREBASE_PROJECT_ID || 'mogcheck-net';
  const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.FIREBASE_UPLOAD_BUCKET ||
    `${projectId}-uploads`;

  admin.initializeApp({
    credential: admin.credential.cert(credential),
    projectId,
    storageBucket: bucketName,
  });

  return {
    firestore: admin.firestore(),
    bucket: admin.storage().bucket(bucketName),
    bucketName,
  };
}

async function uploadOnce(bucket, cache, filename, uid) {
  if (cache.has(filename)) return cache.get(filename);

  const localPath = path.join(uploadsDir, filename);
  if (!fs.existsSync(localPath)) {
    cache.set(filename, null);
    return null;
  }

  const safeName = path.basename(filename);
  const dest = `users/${uid || 'legacy'}/images/recovered_${Date.now()}_${safeName}`;

  if (WRITE) {
    await bucket.upload(localPath, {
      destination: dest,
      metadata: {
        contentType: guessContentType(localPath),
        cacheControl: 'public, max-age=31536000',
      },
    });
    await bucket.file(dest).makePublic();
  }

  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${dest}`;
  cache.set(filename, publicUrl);
  return publicUrl;
}

async function scanCollection({ firestore, bucket, uploadCache, refsAndData, counters }, collectionRef, uid) {
  const snap = await collectionRef.get();
  for (const doc of snap.docs) {
    counters.docsChecked += 1;
    const current = doc.data() || {};
    const fields = collectUploadFields(current);
    if (!fields.length) continue;

    const next = cloneJson(current);
    let changed = false;

    for (const field of fields) {
      counters.uploadRefsFound += 1;
      const localPath = path.join(uploadsDir, field.filename);
      if (!fs.existsSync(localPath)) {
        counters.missingLocalFiles += 1;
        continue;
      }

      const url = await uploadOnce(bucket, uploadCache, field.filename, uid);
      if (!url) continue;
      setNested(next, field.parts, url);
      changed = true;
      counters.recoverableRefs += 1;
    }

    if (changed) refsAndData.push([doc.ref, next]);
  }
}

async function commitChunks(refsAndData) {
  let written = 0;
  for (let i = 0; i < refsAndData.length; i += 450) {
    const batch = admin.firestore().batch();
    const chunk = refsAndData.slice(i, i + 450);
    chunk.forEach(([ref, data]) => batch.set(ref, data, { merge: true }));
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

async function main() {
  const { firestore, bucket, bucketName } = initFirebase();
  if (!fs.existsSync(uploadsDir)) throw new Error(`Missing uploads directory: ${uploadsDir}`);

  const refsAndData = [];
  const uploadCache = new Map();
  const counters = {
    docsChecked: 0,
    uploadRefsFound: 0,
    recoverableRefs: 0,
    missingLocalFiles: 0,
  };

  const usersSnap = await firestore.collection('users').get();
  for (const userDoc of usersSnap.docs) {
    await scanCollection({
      firestore,
      bucket,
      uploadCache,
      refsAndData,
      counters,
    }, userDoc.ref.collection('scans'), userDoc.id);
  }

  await scanCollection({
    firestore,
    bucket,
    uploadCache,
    refsAndData,
    counters,
  }, firestore.collection('communityScans'), 'community');

  const written = WRITE ? await commitChunks(refsAndData) : 0;
  console.log(JSON.stringify({
    mode: WRITE ? 'write' : 'dry-run',
    bucket: bucketName,
    docsChecked: counters.docsChecked,
    uploadRefsFound: counters.uploadRefsFound,
    recoverableRefs: counters.recoverableRefs,
    missingLocalFiles: counters.missingLocalFiles,
    documentsToUpdate: refsAndData.length,
    documentsWritten: written,
    note: WRITE ? 'Updated Firestore URLs and uploaded matching local files.' : 'No writes made. Re-run with --write to repair recoverable images.',
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(admin.apps.map((app) => app.delete().catch(() => {})));
  });

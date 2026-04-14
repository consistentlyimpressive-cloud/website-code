const dotenv = require('dotenv');
const admin = require('firebase-admin');

dotenv.config({ path: '.env' });

const PUBLIC_BACKEND_URL = String(process.env.PUBLIC_BACKEND_URL || '')
  .trim()
  .replace(/\/$/, '');

function publicizeStoredUploadUrl(value) {
  if (typeof value !== 'string' || !value.includes('/uploads/')) return value || null;
  if (!PUBLIC_BACKEND_URL || /(localhost|127\.0\.0\.1|trycloudflare\.com)/i.test(PUBLIC_BACKEND_URL)) return value;
  const match = value.match(/\/uploads\/([^?#]+)/i);
  if (!match) return value;
  return `${PUBLIC_BACKEND_URL}/uploads/${match[1]}`;
}

function normalizeScan(scan) {
  const payload = scan.payload && typeof scan.payload === 'object' ? scan.payload : null;
  const next = { ...scan };
  next.frontImageUrl = publicizeStoredUploadUrl(scan.frontImageUrl || payload?.frontImage || null);
  next.sideImageUrl = publicizeStoredUploadUrl(scan.sideImageUrl || payload?.sideImage || null);
  if (payload) {
    next.payload = {
      ...payload,
      frontImage: publicizeStoredUploadUrl(payload.frontImage || next.frontImageUrl),
      sideImage: publicizeStoredUploadUrl(payload.sideImage || next.sideImageUrl),
    };
  }
  return next;
}

function changed(before, after) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function initFirebase() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing from backend/.env');
  const credential = JSON.parse(json);
  admin.initializeApp({
    credential: admin.credential.cert(credential),
    projectId: credential.project_id || process.env.FIREBASE_PROJECT_ID || 'mogcheck-net',
  });
  return admin.firestore();
}

async function commitChunks(firestore, refsAndData) {
  let count = 0;
  for (let i = 0; i < refsAndData.length; i += 450) {
    const batch = firestore.batch();
    refsAndData.slice(i, i + 450).forEach(([ref, data]) => batch.set(ref, data, { merge: true }));
    await batch.commit();
    count += Math.min(450, refsAndData.length - i);
  }
  return count;
}

async function main() {
  if (!PUBLIC_BACKEND_URL) throw new Error('PUBLIC_BACKEND_URL is missing.');
  const firestore = initFirebase();
  const updates = [];

  const usersSnap = await firestore.collection('users').get();
  for (const userDoc of usersSnap.docs) {
    const scansSnap = await userDoc.ref.collection('scans').get();
    scansSnap.forEach((scanDoc) => {
      const current = scanDoc.data() || {};
      const next = normalizeScan(current);
      if (changed(current, next)) updates.push([scanDoc.ref, next]);
    });
  }

  const communitySnap = await firestore.collection('communityScans').get();
  communitySnap.forEach((scanDoc) => {
    const current = scanDoc.data() || {};
    const next = normalizeScan(current);
    if (changed(current, next)) updates.push([scanDoc.ref, next]);
  });

  const written = await commitChunks(firestore, updates);
  console.log(`Repaired ${written} scan image URL document(s).`);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(admin.apps.map((app) => app.delete().catch(() => {})));
  });

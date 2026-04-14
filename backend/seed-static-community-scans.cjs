const fs = require('fs');
const path = require('path');
const vm = require('vm');
const dotenv = require('dotenv');
const admin = require('firebase-admin');

dotenv.config({ path: path.join(__dirname, '.env') });

function loadStaticCommunityScans() {
  const communityScansPath = path.resolve(__dirname, '..', 'src', 'data', 'communityScans.js');
  const source = fs
    .readFileSync(communityScansPath, 'utf8')
    .replace(/export\s+const\s+COMMUNITY_SCANS\s*=/, 'exports.COMMUNITY_SCANS =');

  const sandbox = { exports: {} };
  vm.runInNewContext(source, sandbox, { filename: communityScansPath });

  if (!Array.isArray(sandbox.exports.COMMUNITY_SCANS)) {
    throw new Error('COMMUNITY_SCANS export was not found.');
  }

  return sandbox.exports.COMMUNITY_SCANS;
}

function initFirebase() {
  if (admin.apps.length) return admin.firestore();

  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing from backend/.env');
  }

  const credential = JSON.parse(json);
  admin.initializeApp({
    credential: admin.credential.cert(credential),
    projectId: credential.project_id || process.env.FIREBASE_PROJECT_ID || 'mogcheck-net',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'mogcheck-net.firebasestorage.app',
  });

  return admin.firestore();
}

function toCommunityDoc(entry, index) {
  const payload = entry.dashboardData || {};
  const rating = Number(payload.finalRating) || 0;
  const sideRating = Number(payload.sideRating) || rating;
  const scanId = String(entry.id || `static-community-${index + 1}`);
  const profileName = `Community Scan ${index + 1}`;

  const hydratedPayload = {
    ...payload,
    scanId,
    profileId: 'static-community',
    profileName,
    displayName: 'Community Scan',
    selectedModel: String(payload.selectedModel || '1'),
    visibility: 'community',
  };

  return {
    ownerUid: 'static-community',
    scanId,
    profileId: 'static-community',
    profileName,
    displayName: 'Community Scan',
    tier: entry.tier || '',
    visibility: 'community',
    model: String(payload.selectedModel || '1'),
    cohesiveFrontSide: Boolean(payload.cohesiveFrontSide),
    finalRating: rating,
    sideRating,
    sex: payload.sex || null,
    frontImageUrl: payload.frontImage || null,
    sideImageUrl: payload.sideImage || null,
    frontImage: payload.frontImage || null,
    sideImage: payload.sideImage || null,
    dashboardData: hydratedPayload,
    payload: hydratedPayload,
    source: 'static-community-scans',
    isStaticSeed: true,
    timestamp: admin.firestore.Timestamp.fromMillis(Date.now() - index * 1000),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function main() {
  const firestore = initFirebase();
  const scans = loadStaticCommunityScans();
  const batch = firestore.batch();

  scans.forEach((entry, index) => {
    const docId = String(entry.id || `static-community-${index + 1}`);
    batch.set(firestore.collection('communityScans').doc(docId), toCommunityDoc(entry, index), { merge: true });
  });

  await batch.commit();
  console.log(`Seeded ${scans.length} static community scans into Firestore.`);
  scans.forEach((entry, index) => {
    const rating = Number(entry.dashboardData?.finalRating) || 0;
    const sideRating = Number(entry.dashboardData?.sideRating) || rating;
    console.log(`${index + 1}. ${entry.id}: front ${rating}/100, side ${sideRating}/100`);
  });
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(admin.apps.map((app) => app.delete().catch(() => {})));
  });

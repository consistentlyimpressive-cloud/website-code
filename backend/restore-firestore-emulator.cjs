const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const admin = require('firebase-admin');

const DEFAULT_PROJECT_ID = 'mogcheck-net';
const DEFAULT_EMULATOR_HOST = '127.0.0.1:8080';

function getCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn('[restore-emulator] FIREBASE_SERVICE_ACCOUNT_JSON is invalid:', error.message);
    return null;
  }
}

async function readCollection(collectionRef) {
  const snap = await collectionRef.get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

function withCommunityTimestamp(doc) {
  if (doc?.data?.timestamp) return doc;
  return {
    ...doc,
    data: {
      ...doc.data,
      timestamp: doc?.data?.updatedAt || admin.firestore.Timestamp.now(),
    },
  };
}

const COMMUNITY_IMAGE_FIXES = {
  'official-tom-holland-6': '/celebrities/tom-holland.png',
  'official-ellie-kemper-7': '/celebrities/ellie-kemper.png',
  'official-reg-jean-page-5': '/celebrities/rege-jean-page.png',
  'yREGOC6qwfWSOWy9WChsXK7F5I63__dk9R1KXbCUci5URJ2BFV':
    'https://api.mogcheck.net/uploads/community-harry-styles1.jpg',
  'yREGOC6qwfWSOWy9WChsXK7F5I63__jnINhTsZpOM7d5iClllN':
    'https://api.mogcheck.net/uploads/community-elon-musk.webp',
  'yREGOC6qwfWSOWy9WChsXK7F5I63__NOzHfLMNLsNo5yH39iwL':
    'https://api.mogcheck.net/uploads/community-sam-altman.webp',
  'yREGOC6qwfWSOWy9WChsXK7F5I63__cOFDbuV8GE7XD5dXSKg0':
    'https://api.mogcheck.net/uploads/community-lacy.webp',
  'yREGOC6qwfWSOWy9WChsXK7F5I63__WN3jzCuw4xHzGVQbB1iI':
    'https://api.mogcheck.net/uploads/community-cillian-murphy.png',
  'yREGOC6qwfWSOWy9WChsXK7F5I63__jy0qiJ5jXlcBIdsaldQe':
    'https://api.mogcheck.net/uploads/community-joe-rogan.jpg',
  'yREGOC6qwfWSOWy9WChsXK7F5I63__I9dtlC9PXC3DFxaNq6Z9':
    'https://api.mogcheck.net/uploads/community-elon-musk.webp',
  'yREGOC6qwfWSOWy9WChsXK7F5I63__WP7CAaqp245GqbUyhbP6':
    'https://api.mogcheck.net/uploads/1776345675682-db11a4b33adaca30-restored.png',
};

function withCommunityMediaFallback(doc) {
  const data = doc?.data || {};
  const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
  const fixedImage = COMMUNITY_IMAGE_FIXES[doc.id];
  const payloadFront = payload.frontImage || payload.frontImageUrl || null;
  const currentFront = data.frontImageUrl || data.frontImage || payloadFront;
  const debugFallback =
    payload.debugAnchorsImageUrl ||
    payload.debugAnchorsImage ||
    data.debugAnchorsImageUrl ||
    data.debugAnchorsImage ||
    null;
  const shouldUseDebugFallback =
    !fixedImage &&
    debugFallback &&
    /^https:\/\/storage\.googleapis\.com\/mogcheck-net-uploads\//i.test(String(currentFront || ''));
  const nextFront = fixedImage || (shouldUseDebugFallback ? debugFallback : currentFront);

  if (!nextFront || nextFront === currentFront) return doc;

  return {
    ...doc,
    data: {
      ...data,
      frontImageUrl: nextFront,
      frontImage: nextFront,
      payload: {
        ...payload,
        frontImage: nextFront,
        frontImageUrl: nextFront,
      },
    },
  };
}

async function collectLiveData(liveDb) {
  const communityScans = (await readCollection(liveDb.collection('communityScans')))
    .map(withCommunityTimestamp)
    .map(withCommunityMediaFallback)
    .filter((doc) => {
      const data = doc?.data || {};
      const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
      return Boolean(data.frontImageUrl || data.frontImage || payload.frontImage || payload.frontImageUrl);
    });
  const mogBattlesCommunity = await readCollection(liveDb.collection('mogBattlesCommunity'));
  const usersBase = await readCollection(liveDb.collection('users'));
  const users = [];

  for (const user of usersBase) {
    const userRef = liveDb.collection('users').doc(user.id);
    users.push({
      ...user,
      profiles: await readCollection(userRef.collection('profiles')),
      scans: await readCollection(userRef.collection('scans')),
    });
  }

  return { communityScans, mogBattlesCommunity, users };
}

async function writeDoc(ref, data, counters) {
  await ref.set(data, { merge: true });
  counters.writes += 1;
}

async function restoreToEmulator(data, emulatorHost, projectId) {
  process.env.FIRESTORE_EMULATOR_HOST = emulatorHost;
  const emulatorApp = admin.initializeApp({ projectId }, 'emulator');
  const emulatorDb = emulatorApp.firestore();
  const counters = { writes: 0 };

  for (const doc of data.communityScans) {
    await writeDoc(emulatorDb.collection('communityScans').doc(doc.id), doc.data, counters);
  }

  for (const doc of data.mogBattlesCommunity) {
    await writeDoc(emulatorDb.collection('mogBattlesCommunity').doc(doc.id), doc.data, counters);
  }

  for (const user of data.users) {
    const userRef = emulatorDb.collection('users').doc(user.id);
    await writeDoc(userRef, user.data, counters);
    for (const profile of user.profiles) {
      await writeDoc(userRef.collection('profiles').doc(profile.id), profile.data, counters);
    }
    for (const scan of user.scans) {
      await writeDoc(userRef.collection('scans').doc(scan.id), scan.data, counters);
    }
  }

  return counters;
}

async function main() {
  if (process.env.MOGCHECK_RESTORE_FIRESTORE_EMULATOR === '0') {
    console.log('[restore-emulator] Skipped because MOGCHECK_RESTORE_FIRESTORE_EMULATOR=0');
    return;
  }

  const credential = getCredential();
  if (!credential) {
    console.warn('[restore-emulator] Skipped: backend/.env has no valid FIREBASE_SERVICE_ACCOUNT_JSON.');
    return;
  }

  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || DEFAULT_EMULATOR_HOST;
  const projectId = credential.project_id || process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;

  delete process.env.FIRESTORE_EMULATOR_HOST;
  const liveApp = admin.initializeApp(
    {
      credential: admin.credential.cert(credential),
      projectId,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'mogcheck-net.firebasestorage.app',
    },
    'live'
  );

  const liveDb = liveApp.firestore();
  const data = await collectLiveData(liveDb);
  const counters = await restoreToEmulator(data, emulatorHost, projectId);

  console.log(
    `[restore-emulator] Restored ${data.communityScans.length} community scans, ${data.users.length} users, ` +
      `${data.users.reduce((sum, user) => sum + user.profiles.length, 0)} profiles, ` +
      `${data.users.reduce((sum, user) => sum + user.scans.length, 0)} scans ` +
      `(${counters.writes} writes).`
  );
}

main()
  .catch((error) => {
    console.warn('[restore-emulator] Restore failed:', error.message || error);
  })
  .finally(() => {
    process.exit(0);
  });

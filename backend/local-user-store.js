const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, 'local-user-store.json');
const PROFILE_SCAN_HISTORY_LIMIT = 10;

function defaults() {
  return { users: {} };
}

let cache = defaults();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function load() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      cache = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      if (!cache || typeof cache !== 'object' || typeof cache.users !== 'object') {
        cache = defaults();
      }
    }
  } catch (error) {
    console.error('[local-user-store] load failed:', error.message);
    cache = defaults();
  }
}

function save() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.error('[local-user-store] save failed:', error.message);
  }
}

function ensureUser(uid) {
  const safeUid = String(uid || '').trim();
  if (!safeUid) return null;
  if (!cache.users[safeUid]) {
    cache.users[safeUid] = {
      profiles: {},
      scans: {},
    };
  }
  return cache.users[safeUid];
}

function timestampValue(value) {
  if (!value) return 0;
  if (typeof value === 'string') {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  return 0;
}

function normalizeProfile(uid, id, profile = {}) {
  return {
    id,
    userId: uid,
    name: profile.name || 'New Profile',
    visibility: profile.visibility || 'private',
    createdAt: profile.createdAt || new Date().toISOString(),
    updatedAt: profile.updatedAt || new Date().toISOString(),
  };
}

function normalizeScan(uid, scanId, scan = {}) {
  const payload = scan.payload && typeof scan.payload === 'object' ? scan.payload : {};
  return {
    ...scan,
    id: scanId,
    scanId,
    userId: uid,
    timestamp: scan.timestamp || scan.scannedAt || new Date().toISOString(),
    scannedAt: scan.scannedAt || scan.timestamp || new Date().toISOString(),
    visibility: scan.visibility || 'private',
    profileId: scan.profileId || 'default',
    success: scan.success !== false,
    payload,
  };
}

function upsertProfile(uid, id, profile) {
  const user = ensureUser(uid);
  if (!user || !id) return null;
  const previous = user.profiles[id] || {};
  user.profiles[id] = normalizeProfile(uid, id, {
    ...previous,
    ...clone(profile || {}),
    createdAt: previous.createdAt || profile?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  save();
  return clone(user.profiles[id]);
}

function deleteProfile(uid, id) {
  const user = ensureUser(uid);
  if (!user || !id) return;
  delete user.profiles[id];
  for (const scanId of Object.keys(user.scans)) {
    if ((user.scans[scanId]?.profileId || 'default') === id) {
      delete user.scans[scanId];
    }
  }
  save();
}

function listProfiles(uid) {
  const user = ensureUser(uid);
  if (!user) return [];
  const scans = Object.values(user.scans || {});
  const profiles = Object.entries(user.profiles || {}).map(([id, profile]) => {
    const profileScans = scans
      .filter((scan) => (scan.profileId || 'default') === id)
      .sort((a, b) => timestampValue(b.timestamp || b.scannedAt) - timestampValue(a.timestamp || a.scannedAt));
    return {
      ...normalizeProfile(uid, id, profile),
      latestScan: profileScans[0] || null,
      scanCount: profileScans.length,
    };
  });

  if (!profiles.length && scans.length) {
    return [{
      id: 'default',
      userId: uid,
      name: 'New Profile',
      visibility: 'private',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      latestScan: scans.sort((a, b) => timestampValue(b.timestamp || b.scannedAt) - timestampValue(a.timestamp || a.scannedAt))[0] || null,
      scanCount: scans.length,
    }];
  }

  return profiles.sort((a, b) => timestampValue(b.updatedAt) - timestampValue(a.updatedAt));
}

function upsertScan(uid, scanId, scan) {
  const user = ensureUser(uid);
  if (!user || !scanId) return null;
  const previous = user.scans[scanId] || {};
  const next = normalizeScan(uid, scanId, {
    ...previous,
    ...clone(scan || {}),
    scannedAt: scan?.scannedAt || previous.scannedAt || new Date().toISOString(),
    timestamp: scan?.timestamp || previous.timestamp || new Date().toISOString(),
  });
  user.scans[scanId] = next;

  const profileId = next.profileId || 'default';
  if (!user.profiles[profileId]) {
    user.profiles[profileId] = normalizeProfile(uid, profileId, {
      name: next.payload?.profileName || next.profileName || 'New Profile',
      visibility: 'private',
      createdAt: next.scannedAt,
      updatedAt: next.scannedAt,
    });
  } else {
    user.profiles[profileId].updatedAt = new Date().toISOString();
  }

  const profileScanEntries = Object.entries(user.scans || {})
    .filter(([, item]) => (item?.profileId || 'default') === profileId)
    .sort(([, a], [, b]) => timestampValue(b.timestamp || b.scannedAt) - timestampValue(a.timestamp || a.scannedAt));
  profileScanEntries.slice(PROFILE_SCAN_HISTORY_LIMIT).forEach(([oldScanId]) => {
    delete user.scans[oldScanId];
  });

  save();
  return clone(next);
}

function replaceScans(uid, scans = []) {
  const user = ensureUser(uid);
  if (!user) return [];

  const grouped = {};
  for (const rawScan of Array.isArray(scans) ? scans : []) {
    const scanId = String(rawScan?.id || rawScan?.scanId || '').trim();
    if (!scanId) continue;
    const normalized = normalizeScan(uid, scanId, clone(rawScan));
    const profileId = normalized.profileId || 'default';
    if (!grouped[profileId]) grouped[profileId] = [];
    grouped[profileId].push(normalized);
  }

  const nextScans = {};
  Object.values(grouped).forEach((entries) => {
    entries
      .sort((a, b) => timestampValue(b.timestamp || b.scannedAt) - timestampValue(a.timestamp || a.scannedAt))
      .slice(0, PROFILE_SCAN_HISTORY_LIMIT)
      .forEach((scan) => {
        nextScans[scan.scanId] = scan;
      });
  });

  user.scans = nextScans;

  Object.values(nextScans).forEach((scan) => {
    const profileId = scan.profileId || 'default';
    if (!user.profiles[profileId]) {
      user.profiles[profileId] = normalizeProfile(uid, profileId, {
        name: scan.payload?.profileName || scan.profileName || 'New Profile',
        visibility: 'private',
        createdAt: scan.scannedAt,
        updatedAt: scan.scannedAt,
      });
    } else {
      user.profiles[profileId].updatedAt = new Date().toISOString();
    }
  });

  save();
  return listScans(uid);
}

function getScan(uid, scanId) {
  const user = ensureUser(uid);
  if (!user || !scanId || !user.scans[scanId]) return null;
  return clone(user.scans[scanId]);
}

function listScans(uid) {
  const user = ensureUser(uid);
  if (!user) return [];
  return Object.values(user.scans || {})
    .map((scan) => clone(scan))
    .sort((a, b) => timestampValue(b.timestamp || b.scannedAt) - timestampValue(a.timestamp || a.scannedAt));
}

function deleteScan(uid, scanId) {
  const user = ensureUser(uid);
  if (!user || !scanId) return;
  delete user.scans[scanId];
  save();
}

function deleteUser(uid) {
  const safeUid = String(uid || '').trim();
  if (!safeUid || !cache.users[safeUid]) return;
  delete cache.users[safeUid];
  save();
}

load();

module.exports = {
  upsertProfile,
  deleteProfile,
  listProfiles,
  upsertScan,
  replaceScans,
  getScan,
  listScans,
  deleteScan,
  deleteUser,
};

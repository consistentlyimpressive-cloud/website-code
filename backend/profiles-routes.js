const { sanitizeFirebaseError, shouldSkipFirebaseStorage } = require('./firebase-errors');
const localUserStore = require('./local-user-store');
const adminStore = require('./admin-store');

function isPublicScanVisibility(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'public' || normalized === 'community' || normalized === 'unlisted';
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
  return {
    ...scan,
    frontImageUrl,
    sideImageUrl,
    payload: payload
      ? {
          ...payload,
          frontImage: publicizeStoredUploadUrl(payload.frontImage || frontImageUrl),
          sideImage: publicizeStoredUploadUrl(payload.sideImage || sideImageUrl),
        }
      : scan.payload,
  };
}

module.exports = function(app, firestore, admin, extractUserOptional) {

  app.get('/api/user/profiles', extractUserOptional, async (req, res) => {
    if (!req.uid) return res.status(401).json({ error: 'Unauthorized' });
    if (!firestore) {
      return res.json({ profiles: localUserStore.listProfiles(req.uid), profilesUnavailable: false, reason: 'local_fallback' });
    }
    try {
      const snap = await firestore.collection('users').doc(req.uid).collection('profiles').orderBy('createdAt', 'desc').get();
      const profiles = [];
      snap.forEach(doc => {
        const profile = { id: doc.id, ...doc.data() };
        profiles.push(profile);
        localUserStore.upsertProfile(req.uid, doc.id, profile);
      });
      if (profiles.length === 0) {
        const scanSnap = await firestore.collection('users').doc(req.uid).collection('scans').limit(200).get();
        const derivedProfiles = new Map();
        scanSnap.forEach(doc => {
          const scan = doc.data() || {};
          const profileId = String(scan.profileId || scan.payload?.profileId || 'default').trim() || 'default';
          const existing = derivedProfiles.get(profileId) || {
            id: profileId,
            name: profileId === 'default' ? 'Default Profile' : (scan.profileName || scan.payload?.profileName || 'Profile'),
            visibility: 'private',
            scanCount: 0,
            createdAt: scan.createdAt || scan.timestamp || scan.scannedAt || null,
            derivedFromScans: true,
          };
          existing.scanCount += 1;
          derivedProfiles.set(profileId, existing);
        });
        profiles.push(...derivedProfiles.values());
        profiles.forEach(profile => localUserStore.upsertProfile(req.uid, profile.id, profile));
      }
      res.json({ profiles });
    } catch (e) {
      console.error('[profiles] GET failed:', e.message || e);
      res.json({
        profiles: localUserStore.listProfiles(req.uid),
        profilesUnavailable: false,
        reason: 'local_fallback_after_firestore_error',
        warning: e.message || 'Firestore failed',
      });
    }
  });

  app.post('/api/user/profiles', extractUserOptional, async (req, res) => {
    if (!req.uid) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const { name, visibility } = req.body;
      const localId = `local-profile-${Date.now()}`;
      let responseId = localId;
      if (firestore) {
        const docRef = await firestore.collection('users').doc(req.uid).collection('profiles').add({
          name: name || 'New Profile',
          visibility: visibility || 'private',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        responseId = docRef.id;
      }
      localUserStore.upsertProfile(req.uid, responseId, {
        name: name || 'New Profile',
        visibility: visibility || 'private',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      res.json({ id: responseId, name, visibility });
    } catch (e) {
      console.error('[profiles] POST failed:', e.message || e);
      const fallbackId = `local-profile-${Date.now()}`;
      localUserStore.upsertProfile(req.uid, fallbackId, {
        name: req.body?.name || 'New Profile',
        visibility: req.body?.visibility || 'private',
      });
      res.json({ id: fallbackId, name: req.body?.name || 'New Profile', visibility: req.body?.visibility || 'private', localFallback: true });
    }
  });

  app.put('/api/user/profiles/:profileId', extractUserOptional, async (req, res) => {
    if (!req.uid) return res.status(401).json({ error: 'Unauthorized' });
    const { profileId } = req.params;
    try {
      const { name, visibility } = req.body;
      const updateData = { updatedAt: new Date().toISOString() };
      if (name) updateData.name = name;
      if (visibility) updateData.visibility = visibility;

      if (firestore) {
        await firestore.collection('users').doc(req.uid).collection('profiles').doc(profileId).update({
          ...updateData,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      localUserStore.upsertProfile(req.uid, profileId, updateData);
      res.json({ ok: true });
    } catch (e) {
      console.error('[profiles] PUT failed:', e.message || e);
      localUserStore.upsertProfile(req.uid, profileId, {
        name: req.body?.name,
        visibility: req.body?.visibility,
        updatedAt: new Date().toISOString(),
      });
      res.json({ ok: true, localFallback: true });
    }
  });

  app.delete('/api/user/profiles/:profileId', extractUserOptional, async (req, res) => {
    if (!req.uid) return res.status(401).json({ error: 'Unauthorized' });
    const { profileId } = req.params;
    try {
      if (firestore) {
        await firestore.collection('users').doc(req.uid).collection('profiles').doc(profileId).delete();

        const scansSnap = await firestore.collection('users').doc(req.uid).collection('scans').where('profileId', '==', profileId).get();

        for (const doc of scansSnap.docs) {
          const d = doc.data();
          if (!shouldSkipFirebaseStorage()) {
            const bucket = admin.storage().bucket();
            if (d.frontImageDest) await bucket.file(d.frontImageDest).delete().catch(() => {});
            if (d.sideImageDest) await bucket.file(d.sideImageDest).delete().catch(() => {});
          }
          await doc.ref.delete(); // Delete scan
        }
      }
      localUserStore.deleteProfile(req.uid, profileId);
      res.json({ ok: true });
    } catch (e) {
      console.error('[profiles] DELETE failed:', e.message || e);
      localUserStore.deleteProfile(req.uid, profileId);
      res.json({ ok: true, localFallback: true });
    }
  });

  app.get('/api/public/profiles/:uid/:profileId', extractUserOptional, async (req, res) => {
    if (!firestore) return res.status(500).json({ error: 'Firestore not configured' });
    const { uid, profileId } = req.params;
    const requestedScanId = String(req.query?.scan || '').trim();
    try {
      const profileDoc = await firestore.collection('users').doc(uid).collection('profiles').doc(profileId).get();
      if (!profileDoc.exists) return res.status(404).json({ error: 'Profile not found' });
      
      const profile = profileDoc.data();
      const isOwner = req.uid === uid;
      
      if (profile.visibility === 'private' && !isOwner) {
        if (!requestedScanId) {
          return res.status(403).json({ error: 'This profile is private' });
        }

        const scanDoc = await firestore.collection('users').doc(uid).collection('scans').doc(requestedScanId).get();
        if (!scanDoc.exists) return res.status(404).json({ error: 'Scan not found' });
        const scan = normalizeStoredScanUrls({ id: scanDoc.id, ...scanDoc.data() });
        if ((scan.profileId || 'default') !== profileId || !isPublicScanVisibility(scan.visibility)) {
          return res.status(403).json({ error: 'This scan is private' });
        }

        return res.json({
          profile: { id: profileDoc.id, userId: uid, ...profile, visibility: 'private' },
          scans: [scan],
        });
      }
      
      const scansSnap = await firestore.collection('users').doc(uid).collection('scans')
        .where('profileId', '==', profileId)
        .orderBy('timestamp', 'desc')
        .get();
        
      const scans = [];
      scansSnap.forEach(doc => {
        const scan = normalizeStoredScanUrls({ id: doc.id, ...doc.data() });
        if (scan.state === 'running' || scan.payload?.status === 'running') return;
        if (isOwner || isPublicScanVisibility(scan.visibility)) scans.push(scan);
      });
      
      res.json({ profile: { id: profileDoc.id, userId: uid, ...profile }, scans });
    } catch (e) {
      const { status, error } = sanitizeFirebaseError(e);
      console.error('[profiles] public GET failed:', e.message || e);
      res.status(status).json({ error });
    }
  });

  app.get('/api/public/scans/:uid/:scanId', extractUserOptional, async (req, res) => {
    const { uid, scanId } = req.params;
    const buildLocalPublicScanResponse = () => {
      const localScan = localUserStore.getScan(uid, scanId);
      if (!localScan) return null;
      const scan = normalizeStoredScanUrls(localScan);
      const isOwner = req.uid === uid;
      const adminPassword = req.headers['x-admin-password'] || '';
      const hasAdminAccess = String(req.query?.admin || '').trim() === '1' && adminStore.checkPassword(adminPassword);
      if (!isOwner && !hasAdminAccess && !isPublicScanVisibility(scan.visibility)) {
        return { status: 403, body: { error: 'This scan is private' } };
      }
      const profile = localUserStore.listProfiles(uid).find((item) => item.id === (scan.profileId || 'default')) || {
        id: scan.profileId || 'default',
        userId: uid,
        name: scan.payload?.profileName || scan.profileName || 'Shared Scan',
        visibility: 'private',
      };
      return { status: 200, body: { profile: { ...profile, userId: uid }, scans: [scan] } };
    };

    if (!firestore) {
      const localResponse = buildLocalPublicScanResponse();
      if (localResponse) return res.status(localResponse.status).json(localResponse.body);
      return res.status(404).json({ error: 'Scan not found' });
    }

    try {
      const scanDoc = await firestore.collection('users').doc(uid).collection('scans').doc(scanId).get();
      if (!scanDoc.exists) return res.status(404).json({ error: 'Scan not found' });

      const scan = normalizeStoredScanUrls({ id: scanDoc.id, ...scanDoc.data() });
      const isOwner = req.uid === uid;
      const adminPassword = req.headers['x-admin-password'] || '';
      const hasAdminAccess = String(req.query?.admin || '').trim() === '1' && adminStore.checkPassword(adminPassword);
      if (!isOwner && !hasAdminAccess && !isPublicScanVisibility(scan.visibility)) {
        return res.status(403).json({ error: 'This scan is private' });
      }

      let profile = {
        id: scan.profileId || 'default',
        userId: uid,
        name: scan.payload?.profileName || scan.profileName || 'Shared Scan',
        visibility: 'private',
      };

      if (scan.profileId && scan.profileId !== 'default') {
        const profileDoc = await firestore.collection('users').doc(uid).collection('profiles').doc(scan.profileId).get();
        if (profileDoc.exists) {
          profile = {
            id: profileDoc.id,
            userId: uid,
            ...profileDoc.data(),
          };
        }
      }

      res.json({ profile, scans: [scan] });
    } catch (e) {
      const localResponse = buildLocalPublicScanResponse();
      if (localResponse) return res.status(localResponse.status).json(localResponse.body);
      const { status, error } = sanitizeFirebaseError(e);
      console.error('[profiles] public scan GET failed:', e.message || e);
      res.status(status).json({ error });
    }
  });
};

const { sanitizeFirebaseError, shouldSkipFirebaseStorage } = require('./firebase-errors');

module.exports = function(app, firestore, admin, extractUserOptional) {

  app.get('/api/user/profiles', extractUserOptional, async (req, res) => {
    if (!req.uid) return res.status(401).json({ error: 'Unauthorized' });
    if (!firestore) {
      return res.json({ profiles: [], profilesUnavailable: true, reason: 'firestore_not_configured' });
    }
    try {
      const snap = await firestore.collection('users').doc(req.uid).collection('profiles').orderBy('createdAt', 'desc').get();
      const profiles = [];
      snap.forEach(doc => profiles.push({ id: doc.id, ...doc.data() }));
      res.json({ profiles });
    } catch (e) {
      const { status, error } = sanitizeFirebaseError(e);
      console.error('[profiles] GET failed:', e.message || e);
      res.status(status).json({ error });
    }
  });

  app.post('/api/user/profiles', extractUserOptional, async (req, res) => {
    if (!req.uid) return res.status(401).json({ error: 'Unauthorized' });
    if (!firestore) {
      return res.status(503).json({
        error: 'Profiles need Firestore on the API. Set FIREBASE_SERVICE_ACCOUNT_JSON (or run the Firestore emulator) and restart the backend.',
      });
    }
    try {
      const { name, visibility } = req.body;
      const docRef = await firestore.collection('users').doc(req.uid).collection('profiles').add({
        name: name || 'New Profile',
        visibility: visibility || 'private',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      res.json({ id: docRef.id, name, visibility });
    } catch (e) {
      const { status, error } = sanitizeFirebaseError(e);
      console.error('[profiles] POST failed:', e.message || e);
      res.status(status).json({ error });
    }
  });

  app.put('/api/user/profiles/:profileId', extractUserOptional, async (req, res) => {
    if (!req.uid) return res.status(401).json({ error: 'Unauthorized' });
    if (!firestore) {
      return res.status(503).json({
        error: 'Profiles need Firestore credentials. Set FIREBASE_SERVICE_ACCOUNT_JSON in backend/.env or use the Firestore emulator.',
      });
    }
    const { profileId } = req.params;
    try {
      const { name, visibility } = req.body;
      const updateData = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (name) updateData.name = name;
      if (visibility) updateData.visibility = visibility;
      
      await firestore.collection('users').doc(req.uid).collection('profiles').doc(profileId).update(updateData);
      res.json({ ok: true });
    } catch (e) {
      const { status, error } = sanitizeFirebaseError(e);
      console.error('[profiles] PUT failed:', e.message || e);
      res.status(status).json({ error });
    }
  });

  app.delete('/api/user/profiles/:profileId', extractUserOptional, async (req, res) => {
    if (!req.uid) return res.status(401).json({ error: 'Unauthorized' });
    if (!firestore) {
      return res.status(503).json({ error: 'Firestore not available on this server.' });
    }
    const { profileId } = req.params;
    try {
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
      res.json({ ok: true });
    } catch (e) {
      const { status, error } = sanitizeFirebaseError(e);
      console.error('[profiles] DELETE failed:', e.message || e);
      res.status(status).json({ error });
    }
  });

  app.get('/api/public/profiles/:uid/:profileId', extractUserOptional, async (req, res) => {
    if (!firestore) return res.status(500).json({ error: 'Firestore not configured' });
    const { uid, profileId } = req.params;
    try {
      const profileDoc = await firestore.collection('users').doc(uid).collection('profiles').doc(profileId).get();
      if (!profileDoc.exists) return res.status(404).json({ error: 'Profile not found' });
      
      const profile = profileDoc.data();
      const isOwner = req.uid === uid;
      
      if (profile.visibility === 'private' && !isOwner) {
        return res.status(403).json({ error: 'This profile is private' });
      }
      
      const scansSnap = await firestore.collection('users').doc(uid).collection('scans')
        .where('profileId', '==', profileId)
        .orderBy('timestamp', 'desc')
        .get();
        
      const scans = [];
      scansSnap.forEach(doc => scans.push({ id: doc.id, ...doc.data() }));
      
      res.json({ profile: { id: profileDoc.id, userId: uid, ...profile }, scans });
    } catch (e) {
      const { status, error } = sanitizeFirebaseError(e);
      console.error('[profiles] public GET failed:', e.message || e);
      res.status(status).json({ error });
    }
  });
};

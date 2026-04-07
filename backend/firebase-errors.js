/**
 * Map Firebase / Google Cloud errors to safe client-facing messages.
 * Raw messages like "Could not load the default credentials" must never be alert()'d to users.
 */
function isCredentialsConfigError(msg) {
  const s = String(msg || '');
  return (
    /default credentials/i.test(s) ||
    /Could not load/i.test(s) ||
    /application default credentials/i.test(s) ||
    /Could not refresh access token/i.test(s) ||
    /invalid_grant/i.test(s)
  );
}

function sanitizeFirebaseError(err) {
  const raw = String(err?.message || err || '');
  if (isCredentialsConfigError(raw)) {
    return {
      status: 503,
      error:
        'Firebase Admin is not configured on this machine. Add FIREBASE_SERVICE_ACCOUNT_JSON to backend/.env (Firebase Console → Project settings → Service accounts), or run: gcloud auth application-default login — then restart the API.',
    };
  }
  return {
    status: 500,
    error:
      process.env.NODE_ENV === 'production'
        ? 'A database error occurred. Please try again later.'
        : raw,
  };
}

/** Real GCS bucket() needs a service account; skip when using Firestore emulator locally. */
function shouldSkipFirebaseStorage() {
  return !!process.env.FIRESTORE_EMULATOR_HOST || process.env.SKIP_FIREBASE_STORAGE === '1';
}

module.exports = { sanitizeFirebaseError, isCredentialsConfigError, shouldSkipFirebaseStorage };

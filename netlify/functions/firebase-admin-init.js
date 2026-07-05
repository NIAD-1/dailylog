// Shared Firebase Admin SDK initialization for all Netlify functions
// Supports two modes:
//   1. Local dev:  Place serviceAccountKey.json in this folder
//   2. Netlify:    Set FIREBASE_SERVICE_ACCOUNT env var (paste entire JSON as one string)
const admin = require('firebase-admin');

if (!admin.apps.length) {
  let credential;

  // Option 1: Single env var containing the full service account JSON
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    credential = admin.credential.cert(serviceAccount);
  }
  // Option 2: Local JSON file (for development/testing)
  else {
    try {
      const serviceAccount = require('./serviceAccountKey.json');
      credential = admin.credential.cert(serviceAccount);
    } catch (e) {
      console.error('No Firebase credentials found. Set FIREBASE_SERVICE_ACCOUNT env var or place serviceAccountKey.json in netlify/functions/');
      throw e;
    }
  }

  admin.initializeApp({ credential });
}

const db = admin.firestore();
module.exports = { admin, db };

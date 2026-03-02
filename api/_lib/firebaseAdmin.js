import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const parseServiceAccountFromEnv = () => {
  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (typeof base64 === 'string' && base64.trim()) {
    const raw = Buffer.from(base64.trim(), 'base64').toString('utf8');
    return JSON.parse(raw);
  }

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (typeof rawJson === 'string' && rawJson.trim()) {
    return JSON.parse(rawJson);
  }

  return null;
};

const resolveApp = () => {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const serviceAccount = parseServiceAccountFromEnv();
  if (serviceAccount) {
    return initializeApp({
      credential: cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
    });
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
};

const app = resolveApp();

export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);

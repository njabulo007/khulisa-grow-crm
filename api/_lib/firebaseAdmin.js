import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

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

const resolveStorageBucketName = (serviceAccount) => {
  const envBucket =
    typeof process.env.FIREBASE_STORAGE_BUCKET === 'string' ? process.env.FIREBASE_STORAGE_BUCKET.trim() : '';
  if (envBucket) return envBucket;

  const legacyBucket =
    typeof process.env.GCLOUD_STORAGE_BUCKET === 'string' ? process.env.GCLOUD_STORAGE_BUCKET.trim() : '';
  if (legacyBucket) return legacyBucket;

  const serviceAccountBucket =
    serviceAccount && typeof serviceAccount.storage_bucket === 'string' ? serviceAccount.storage_bucket.trim() : '';
  if (serviceAccountBucket) return serviceAccountBucket;

  const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount?.project_id;
  return projectId ? `${projectId}.appspot.com` : undefined;
};

const resolveApp = () => {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const serviceAccount = parseServiceAccountFromEnv();
  const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount?.project_id;
  const storageBucket = resolveStorageBucketName(serviceAccount);
  if (serviceAccount) {
    return initializeApp({
      credential: cert(serviceAccount),
      projectId,
      ...(storageBucket ? { storageBucket } : {}),
    });
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId,
    ...(storageBucket ? { storageBucket } : {}),
  });
};

const app = resolveApp();

export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);
export const adminStorage = getStorage(app);

const resolvedBucketName =
  typeof app.options.storageBucket === 'string' && app.options.storageBucket.trim()
    ? app.options.storageBucket.trim()
    : resolveStorageBucketName(null);

export const adminStorageBucket = resolvedBucketName ? adminStorage.bucket(resolvedBucketName) : null;

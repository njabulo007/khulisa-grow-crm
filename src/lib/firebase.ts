import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const isFirebaseConfigured =
  Boolean(firebaseConfig.apiKey) &&
  Boolean(firebaseConfig.authDomain) &&
  Boolean(firebaseConfig.projectId) &&
  Boolean(firebaseConfig.appId);

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let firestoreDb: Firestore | null = null;
let storageBucket: FirebaseStorage | null = null;

if (isFirebaseConfigured) {
  firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
  firebaseAuth = getAuth(firebaseApp);
  firestoreDb = getFirestore(firebaseApp);
  storageBucket = getStorage(firebaseApp);
} else if (import.meta.env.DEV) {
  // Firebase is optional in local dev until env vars are configured.
  console.warn("Firebase is not configured. Set VITE_FIREBASE_* env vars to enable it.");
}

export {
  firebaseApp,
  firebaseAuth,
  firestoreDb,
  firebaseConfig,
  isFirebaseConfigured,
  storageBucket,
};

// Firebase aliases used by service modules.
export const app = firebaseApp as FirebaseApp;
export const auth = firebaseAuth as Auth;
export const db = firestoreDb as Firestore;
export const storage = storageBucket as FirebaseStorage;

export const getFirebaseServices = () => {
  if (!firebaseApp || !firebaseAuth || !firestoreDb || !storageBucket) {
    throw new Error("Firebase is not configured. Missing required VITE_FIREBASE_* variables.");
  }

  return {
    app: firebaseApp,
    auth: firebaseAuth,
    db: firestoreDb,
    storage: storageBucket,
  };
};

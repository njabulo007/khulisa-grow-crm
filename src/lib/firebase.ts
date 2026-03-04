import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getAnalytics, type Analytics } from "firebase/analytics";
import { getAuth, type Auth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getFunctions, type Functions } from "firebase/functions";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const configuredStorageBucket = (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined)?.trim();

const firebaseConfig: FirebaseOptions = {
  apiKey: "AIzaSyAD1uR5c0p8OCqSZ33aYJY_DHQOcEsmzDk",
  authDomain: "khulisa-grow-crm.firebaseapp.com",
  projectId: "khulisa-grow-crm",
  storageBucket: configuredStorageBucket || "khulisa-grow-crm.appspot.com",
  messagingSenderId: "874376416901",
  appId: "1:874376416901:web:c13ef7d229a6af705763ec",
  measurementId: "G-GJP436QCX6",
};

const isFirebaseConfigured =
  Boolean(firebaseConfig.apiKey) &&
  Boolean(firebaseConfig.authDomain) &&
  Boolean(firebaseConfig.projectId) &&
  Boolean(firebaseConfig.appId);

let firebaseApp: FirebaseApp | null = null;
let firebaseAnalytics: Analytics | null = null;
let firebaseAuth: Auth | null = null;
let firestoreDb: Firestore | null = null;
let storageBucket: FirebaseStorage | null = null;
let firebaseFunctions: Functions | null = null;

const initializeDbWithIndexedDbCache = (appInstance: FirebaseApp): Firestore => {
  try {
    return initializeFirestore(appInstance, {
      // IndexedDB is used only as a local cache; Cloud Firestore remains source of truth.
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (error) {
    console.warn("[Firebase] Falling back to default Firestore cache initialization.", error);
    return getFirestore(appInstance);
  }
};

if (isFirebaseConfigured) {
  firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
  if (typeof window !== "undefined") {
    firebaseAnalytics = getAnalytics(firebaseApp);
  }
  firebaseAuth = getAuth(firebaseApp);
  firestoreDb = initializeDbWithIndexedDbCache(firebaseApp);
  storageBucket = getStorage(firebaseApp);
  // Keep storage retries bounded so uploads fail/recover faster on weak networks.
  storageBucket.maxUploadRetryTime = 2 * 60 * 1000;
  storageBucket.maxOperationRetryTime = 60 * 1000;
  firebaseFunctions = getFunctions(firebaseApp);
}

export {
  firebaseApp,
  firebaseAnalytics,
  firebaseAuth,
  firestoreDb,
  firebaseConfig,
  isFirebaseConfigured,
  storageBucket,
  firebaseFunctions,
};

// Firebase aliases used by service modules.
export const app = firebaseApp as FirebaseApp;
export const analytics = firebaseAnalytics as Analytics;
export const auth = firebaseAuth as Auth;
export const db = firestoreDb as Firestore;
export const storage = storageBucket as FirebaseStorage;
export const functions = firebaseFunctions as Functions;

export const getFirebaseServices = () => {
  if (!firebaseApp || !firebaseAuth || !firestoreDb || !storageBucket || !firebaseFunctions) {
    throw new Error("Firebase is not configured. Missing required VITE_FIREBASE_* variables.");
  }

  return {
    app: firebaseApp,
    analytics: firebaseAnalytics,
    auth: firebaseAuth,
    db: firestoreDb,
    storage: storageBucket,
    functions: firebaseFunctions,
  };
};

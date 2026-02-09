import { User, UserRole } from '@/types/models';
import { auth, db } from '@/lib/firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  User as FirebaseUser,
} from 'firebase/auth';
import { collection, doc, getDoc, getDocs, limit, query, setDoc, where } from 'firebase/firestore';
import {
  LocalStorageCollection,
  STORAGE_KEYS,
  generateId,
  getTimestamp,
  readStoredValue,
  removeStoredValue,
  writeStoredValue,
} from './storage';

export const DEV_AUTH_PASSWORD = 'khulisa123';

export type Role = 'owner' | 'agent';

export interface AppUser {
  id: string;
  uid: string;
  email: string | null;
  displayName: string | null;
  role: Role;
}

export interface AppUserProfile {
  id: string;
  uid: string;
  email: string;
  displayName: string | null;
  role: Role;
  hasAppUserId: boolean;
}

const OWNER_EMAILS = new Set(['njabulo@khulisamedia.co.za', 'njabulod007@gmail.com']);

function getFallbackRoleForEmail(email?: string | null): Role {
  if (!email) return 'agent';
  return OWNER_EMAILS.has(email.trim().toLowerCase()) ? 'owner' : 'agent';
}

function pickRole(data: Record<string, unknown>): Role | null {
  const rawRole = data.role || data.userRole || data.Role || data.user_role;
  if (rawRole === 'owner' || rawRole === 'agent') return rawRole;
  return null;
}

function pickAppUserId(data: Record<string, unknown>): string | null {
  if (typeof data.appUserId !== 'string') return null;
  const normalized = data.appUserId.trim();
  return normalized || null;
}

function getFirebaseAuthErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  switch (code) {
    case 'auth/invalid-credential':
      return 'Invalid email/password for this Firebase project (khulisa-grow-crm). Confirm the user exists in Firebase Authentication -> Users.';
    case 'auth/wrong-password':
      return 'Wrong password for this account.';
    case 'auth/user-not-found':
      return 'No user found for this email in Firebase Authentication.';
    case 'auth/invalid-email':
      return 'Email address format is invalid.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Check internet connection and try again.';
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is disabled in Firebase Auth.';
    case 'auth/email-already-in-use':
      return 'This email is already in use.';
    case 'auth/weak-password':
      return 'Password is too weak. Use at least 6 characters.';
    default:
      return code ? `Firebase login failed (${code}).` : 'Firebase login failed.';
  }
}

async function mapUser(firebaseUser: FirebaseUser | null): Promise<AppUser | null> {
  if (!firebaseUser) return null;

  let role: Role = getFallbackRoleForEmail(firebaseUser.email);
  let displayName = firebaseUser.displayName;
  let appUserId: string | null = null;

  try {
    // Read extra data (role) from Firestore: users/{uid}
    const profileRef = doc(db, 'users', firebaseUser.uid);
    const profileSnap = await getDoc(profileRef);
    if (profileSnap.exists()) {
      const data = profileSnap.data() as Record<string, unknown>;
      const candidateRole = pickRole(data);
      if (candidateRole) {
        role = candidateRole;
      }
      const candidateAppUserId = pickAppUserId(data);
      if (candidateAppUserId) {
        appUserId = candidateAppUserId;
      }
      if (!displayName && typeof data.displayName === 'string') {
        displayName = data.displayName;
      }
      if (!displayName && typeof data.name === 'string') {
        displayName = data.name;
      }
    } else if (firebaseUser.email) {
      // Fallback for projects storing profile docs by email instead of uid.
      const emailQuery = query(collection(db, 'users'), where('email', '==', firebaseUser.email), limit(1));
      const uidQuery = query(collection(db, 'users'), where('uid', '==', firebaseUser.uid), limit(1));
      const [emailSnapshot, uidSnapshot] = await Promise.all([getDocs(emailQuery), getDocs(uidQuery)]);
      const first = emailSnapshot.docs[0] || uidSnapshot.docs[0];
      if (first) {
        const data = first.data() as Record<string, unknown>;
        const candidateRole = pickRole(data);
        if (candidateRole) {
          role = candidateRole;
        }
        const candidateAppUserId = pickAppUserId(data);
        if (candidateAppUserId) {
          appUserId = candidateAppUserId;
        }
        if (!displayName && typeof data.displayName === 'string') {
          displayName = data.displayName;
        }
        if (!displayName && typeof data.name === 'string') {
          displayName = data.name;
        }
      }
    }
  } catch {
    // Continue with fallback role/display values when profile read is blocked.
  }

  role = role || getFallbackRoleForEmail(firebaseUser.email);

  return {
    id: appUserId || firebaseUser.uid,
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName,
    role,
  };
}

export const AuthService = {
  async signupWithPassword(email: string, password: string, displayName?: string): Promise<AppUser> {
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
      const trimmedDisplayName = displayName?.trim();
      if (trimmedDisplayName) {
        await updateProfile(cred.user, { displayName: trimmedDisplayName });
      }

      const role = getFallbackRoleForEmail(normalizedEmail);
      try {
        await setDoc(
          doc(db, 'users', cred.user.uid),
          {
            uid: cred.user.uid,
            appUserId: cred.user.uid,
            email: normalizedEmail,
            displayName: trimmedDisplayName || cred.user.displayName || null,
            role,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch {
        // Continue even when profile doc write is blocked; auth account is already created.
      }

      const user = await mapUser(cred.user);
      if (!user) throw new Error('Could not map user');
      return user;
    } catch (error) {
      throw new Error(getFirebaseAuthErrorMessage(error));
    }
  },

  async loginWithPassword(email: string, password: string): Promise<AppUser> {
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      const user = await mapUser(cred.user);
      if (!user) throw new Error('Could not map user');
      return user;
    } catch (error) {
      throw new Error(getFirebaseAuthErrorMessage(error));
    }
  },

  async logout(): Promise<void> {
    await signOut(auth);
  },

  async ensureUserProfile(payload: {
    uid: string;
    email: string;
    displayName: string | null;
    role: Role;
    appUserId: string;
  }): Promise<void> {
    const normalizedEmail = payload.email.trim().toLowerCase();
    const normalizedAppUserId = payload.appUserId.trim();
    if (!payload.uid.trim() || !normalizedEmail || !normalizedAppUserId) return;

    try {
      await setDoc(
        doc(db, 'users', payload.uid.trim()),
        {
          uid: payload.uid.trim(),
          appUserId: normalizedAppUserId,
          email: normalizedEmail,
          displayName: payload.displayName || null,
          name: payload.displayName || null,
          role: payload.role,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch {
      // Best-effort synchronization; local session should continue even if this write fails.
    }
  },

  async listUserProfiles(): Promise<AppUserProfile[]> {
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const profiles: AppUserProfile[] = [];

      snapshot.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data() as Record<string, unknown>;
        const normalizedUid =
          typeof data.uid === 'string' && data.uid.trim() ? data.uid.trim() : docSnapshot.id;
        const normalizedEmail =
          typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
        if (!normalizedUid || !normalizedEmail) return;

        const role = pickRole(data) || getFallbackRoleForEmail(normalizedEmail);
        const displayNameRaw =
          typeof data.displayName === 'string'
            ? data.displayName
            : typeof data.name === 'string'
              ? data.name
              : '';
        const normalizedDisplayName = displayNameRaw.trim() || null;
        const appUserId = pickAppUserId(data);

        profiles.push({
          id: appUserId || normalizedUid,
          uid: normalizedUid,
          email: normalizedEmail,
          displayName: normalizedDisplayName,
          role,
          hasAppUserId: Boolean(appUserId),
        });
      });

      return profiles;
    } catch (error) {
      console.error('[AuthService] Failed to load user profiles from Firestore users collection.', error);
      throw new Error('Failed to load user profiles from Firestore.');
    }
  },

  subscribeToAuthChanges(callback: (user: AppUser | null) => void): () => void {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const user = await mapUser(firebaseUser);
      callback(user);
    });
    return unsubscribe;
  },
};

export interface AuthService {
  // User profile source (local now, Firestore profile docs later)
  getAll: () => User[];
  getById: (id: string) => User | undefined;
  create: (user: Omit<User, 'createdAt' | 'updatedAt'> & { id?: string }) => User;
  update: (id: string, updates: Partial<User>) => User | null;
  remove: (id: string) => boolean;
  // Session helpers used by AuthContext
  getCurrentUser: () => User | null;
  getCurrentRole: () => UserRole;
  // Dev login now; map to signInWithEmailAndPassword for Firebase Auth
  loginWithPassword: (email: string, password: string) => User | null;
  setCurrentUser: (userId: string) => void;
  // Dev-only role switching for demos/testing
  switchRole: (role: UserRole) => User;
  // Map to Firebase signOut during migration
  clearCurrentUser: () => void;
  seedIfMissing: (seedUsers: User[], defaultUserId?: string, initializeSession?: boolean) => void;
}

class LocalAuthService implements AuthService {
  // TODO: Replace with Firebase Auth (signInWithEmailAndPassword/signOut/onAuthStateChanged)
  // and user profile reads from Firestore while keeping the AuthService interface stable.
  private readonly users = new LocalStorageCollection<User>(STORAGE_KEYS.users);

  private getUserByRole(role: UserRole): User | undefined {
    const users = this.users.getAll().filter((user) => user.isActive !== false);
    if (users.length === 0) return undefined;
    const preferredName = role === 'owner' ? 'njabulo' : 'lindiwe';
    const preferred = users.find((user) => user.role === role && user.name.toLowerCase().includes(preferredName));
    if (preferred) return preferred;

    const byRole = users.find((user) => user.role === role);
    if (byRole) return byRole;

    return users[0];
  }

  getCurrentRole(): UserRole {
    const storedRole = readStoredValue(STORAGE_KEYS.role);
    if (storedRole === 'owner' || storedRole === 'agent') {
      return storedRole;
    }
    return 'owner';
  }

  getAll(): User[] {
    return this.users.getAll();
  }

  getById(id: string): User | undefined {
    return this.users.getById(id);
  }

  create(user: Omit<User, 'createdAt' | 'updatedAt'> & { id?: string }): User {
    const normalizedId =
      typeof user.id === 'string' && user.id.trim().length > 0 ? user.id.trim() : generateId();
    const { id: _ignored, ...payload } = user;
    return this.users.create({
      ...payload,
      id: normalizedId,
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    });
  }

  update(id: string, updates: Partial<User>): User | null {
    return this.users.update(id, { ...updates, updatedAt: getTimestamp() });
  }

  remove(id: string): boolean {
    const removed = this.users.remove(id);
    if (!removed) return false;
    if (readStoredValue(STORAGE_KEYS.currentUser) === id) {
      removeStoredValue(STORAGE_KEYS.currentUser);
    }
    return true;
  }

  getCurrentUser(): User | null {
    const userId = readStoredValue(STORAGE_KEYS.currentUser);
    if (!userId) return null;
    const user = this.getById(userId);
    return user || null;
  }

  loginWithPassword(email: string, password: string): User | null {
    const normalizedEmail = email.trim().toLowerCase();
    const user = this.users
      .getAll()
      .find((candidate) => candidate.email.toLowerCase() === normalizedEmail);
    if (!user) return null;
    if (user.isActive === false) return null;
    if (password !== DEV_AUTH_PASSWORD) return null;
    this.setCurrentUser(user.id);
    return user;
  }

  setCurrentUser(userId: string): void {
    const user = this.getById(userId);
    if (!user) return;
    writeStoredValue(STORAGE_KEYS.role, user.role);
    writeStoredValue(STORAGE_KEYS.currentUser, userId);
  }

  switchRole(role: UserRole): User {
    const user = this.getUserByRole(role);
    if (!user) {
      throw new Error('No users available for role switching.');
    }
    writeStoredValue(STORAGE_KEYS.role, role);
    writeStoredValue(STORAGE_KEYS.currentUser, user.id);
    return user;
  }

  clearCurrentUser(): void {
    removeStoredValue(STORAGE_KEYS.currentUser);
    removeStoredValue(STORAGE_KEYS.role);
  }

  seedIfMissing(seedUsers: User[], defaultUserId?: string, initializeSession = false): void {
    this.users.seedIfMissing(seedUsers);
    if (!initializeSession) return;
    if (this.getCurrentUser()) return;
    if (defaultUserId) {
      this.setCurrentUser(defaultUserId);
      return;
    }
    const fallbackRole = this.getCurrentRole();
    const fallbackUser = this.getUserByRole(fallbackRole);
    if (fallbackUser) this.setCurrentUser(fallbackUser.id);
  }
}

export const authService: AuthService = new LocalAuthService();

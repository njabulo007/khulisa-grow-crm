import { User, UserRole } from '@/types/models';
import { auth, db } from '@/lib/firebase';
import { authenticatedPost } from './apiClient';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  User as FirebaseUser,
} from 'firebase/auth';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
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
  isActive: boolean;
}

function getFallbackRoleForEmail(_email?: string | null): Role {
  return 'agent';
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
      return 'Email or password is incorrect. Please try again.';
    case 'auth/wrong-password':
      return 'Email or password is incorrect. Please try again.';
    case 'auth/user-not-found':
      return 'Email or password is incorrect. Please try again.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'We could not connect right now. Check your internet and try again.';
    case 'auth/operation-not-allowed':
      return 'Sign-in is currently unavailable. Please contact support.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try logging in instead.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    default:
      return 'Unable to sign in right now. Please try again.';
  }
}

const pendingMappings = new WeakMap<FirebaseUser, Promise<AppUser | null>>();

function mapUser(firebaseUser: FirebaseUser | null): Promise<AppUser | null> {
  if (!firebaseUser) return Promise.resolve(null);
  const pending = pendingMappings.get(firebaseUser);
  if (pending) return pending;
  const mapping = (async (): Promise<AppUser> => {
    const profile = await authenticatedPost<{ uid: string; role: Role; appUserId: string; displayName: string | null }>(
      '/api/auth/ensure-role', {}, firebaseUser,
    );
    await firebaseUser.getIdToken(true);
    const token = await firebaseUser.getIdTokenResult();
    if (profile.uid !== firebaseUser.uid || token.claims.role !== profile.role
      || typeof token.claims.appUserId !== 'string' || token.claims.appUserId !== profile.appUserId) {
      throw new Error('Your role could not be synchronized. Please sign in again.');
    }
    return {
      id: profile.appUserId, uid: firebaseUser.uid, email: firebaseUser.email,
      displayName: profile.displayName || firebaseUser.displayName, role: profile.role,
    };
  })().finally(() => pendingMappings.delete(firebaseUser));
  pendingMappings.set(firebaseUser, mapping);
  return mapping;
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

      const user = await mapUser(cred.user);
      if (!user) throw new Error('Could not map user');
      return user;
    } catch (error) {
      if (error instanceof Error && !('code' in error)) throw error;
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
      if (error instanceof Error && !('code' in error)) throw error;
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
          displayName: payload.displayName || null,
          name: payload.displayName || null,
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
      const profiles = new Map<string, AppUserProfile>();
      const canonicalIds = new Set(snapshot.docs.map((item) => item.id));

      snapshot.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data() as Record<string, unknown>;
        const normalizedUid =
          typeof data.uid === 'string' && data.uid.trim() ? data.uid.trim() : docSnapshot.id;
        const normalizedEmail =
          typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
        if (!normalizedUid || !normalizedEmail) return;
        if (normalizedUid !== docSnapshot.id && canonicalIds.has(normalizedUid)) return;

        const role = pickRole(data) || getFallbackRoleForEmail(normalizedEmail);
        const displayNameRaw =
          typeof data.displayName === 'string'
            ? data.displayName
            : typeof data.name === 'string'
              ? data.name
              : '';
        const normalizedDisplayName = displayNameRaw.trim() || null;
        const appUserId = pickAppUserId(data);

        profiles.set(normalizedUid, {
          id: appUserId || normalizedUid,
          uid: normalizedUid,
          email: normalizedEmail,
          displayName: normalizedDisplayName,
          role,
          hasAppUserId: Boolean(appUserId),
          isActive: data.isActive !== false,
        });
      });

      return [...profiles.values()];
    } catch (error) {
      console.error('[AuthService] Failed to load user profiles from Firestore users collection.', error);
      throw new Error('Failed to load user profiles from Firestore.');
    }
  },

  async updateAgentRosterState(uid: string, isActive: boolean): Promise<void> {
    const targetUid = uid.trim();
    if (!targetUid || targetUid === auth.currentUser?.uid) throw new Error('You cannot archive your own account.');
    await setDoc(doc(db, 'users', targetUid), { isActive, updatedAt: getTimestamp() }, { merge: true });
    authService.getAll().filter((user) => user.uid === targetUid || user.id === targetUid)
      .forEach((user) => authService.update(user.id, { isActive }));
    window.dispatchEvent(new CustomEvent('crm:data-changed'));
  },

  async updateUserRole(uid: string, role: Role): Promise<void> {
    await authenticatedPost('/api/auth/set-role', { uid: uid.trim(), role });

    const localUsers = new LocalStorageCollection<User>(STORAGE_KEYS.users);
    const localUser = localUsers.getAll().find((candidate) => candidate.uid === uid.trim() || candidate.id === uid.trim());
    if (localUser) {
      localUsers.update(localUser.id, {
        role,
        commissionRate: role === 'owner' ? 0 : localUser.commissionRate,
      });
    }
  },

  subscribeToAuthChanges(callback: (user: AppUser | null) => void, onError?: (message: string) => void): () => void {
    let active = true;
    let generation = 0;
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const requestGeneration = ++generation;
      void mapUser(firebaseUser)
        .then((user) => {
          if (active && generation === requestGeneration) callback(user);
        })
        .catch((error) => {
          if (!active || generation !== requestGeneration) return;
          console.error('[AuthService] Failed to map the authenticated user.', error);
          onError?.(error instanceof Error ? error.message : 'Your role could not be recovered. Please sign in again.');
          callback(null);
        });
    });
    return () => { active = false; generation += 1; unsubscribe(); };
  },
};

export interface AuthService {
  // Local cache used to hydrate the domain model after Firebase authentication.
  getAll: () => User[];
  getById: (id: string) => User | undefined;
  create: (user: Omit<User, 'createdAt' | 'updatedAt'> & { id?: string }) => User;
  update: (id: string, updates: Partial<User>) => User | null;
  remove: (id: string) => boolean;
  // Session helpers used by AuthContext
  getCurrentUser: () => User | null;
  getCurrentRole: () => UserRole;
  // Legacy local helpers retained for seed/bootstrap compatibility.
  loginWithPassword: (email: string, password: string) => User | null;
  setCurrentUser: (userId: string) => void;
  clearCurrentUser: () => void;
  seedIfMissing: (seedUsers: User[], defaultUserId?: string, initializeSession?: boolean) => void;
}

class LocalAuthService implements AuthService {
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
    return this.users.getById(id) || this.users.getAll().find((user) => user.uid === id);
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

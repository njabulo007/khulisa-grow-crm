import { User, UserRole } from '@/types/models';
import { getFirebaseServices, isFirebaseConfigured } from '@/lib/firebase';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
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
  email: string | null;
  displayName: string | null;
  role: Role;
}

async function mapUser(firebaseUser: FirebaseUser | null): Promise<AppUser | null> {
  if (!firebaseUser) return null;

  const { db } = getFirebaseServices();

  // Read extra data (role) from Firestore: users/{uid}
  const profileRef = doc(db, 'users', firebaseUser.uid);
  const profileSnap = await getDoc(profileRef);

  let role: Role = 'agent'; // default if not found
  if (profileSnap.exists()) {
    const data = profileSnap.data() as { role?: string };
    if (data.role === 'owner' || data.role === 'agent') {
      role = data.role;
    }
  }

  return {
    id: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: firebaseUser.displayName,
    role,
  };
}

export const AuthService = {
  async loginWithPassword(email: string, password: string): Promise<AppUser> {
    const { auth } = getFirebaseServices();
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const user = await mapUser(cred.user);
    if (!user) throw new Error('Could not map user');
    return user;
  },

  async logout(): Promise<void> {
    if (!isFirebaseConfigured) return;
    const { auth } = getFirebaseServices();
    await signOut(auth);
  },

  subscribeToAuthChanges(callback: (user: AppUser | null) => void): () => void {
    if (!isFirebaseConfigured) {
      callback(null);
      return () => {};
    }

    const { auth } = getFirebaseServices();
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        const user = await mapUser(firebaseUser);
        callback(user);
      } catch (error) {
        console.error('Failed to map Firebase auth user:', error);
        callback(null);
      }
    });
    return unsubscribe;
  },
};

export interface AuthService {
  // User profile source (local now, Firestore profile docs later)
  getAll: () => User[];
  getById: (id: string) => User | undefined;
  create: (user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>) => User;
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

  create(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): User {
    return this.users.create({
      ...user,
      id: generateId(),
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

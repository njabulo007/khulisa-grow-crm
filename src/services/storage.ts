import { auth, db } from '@/lib/firebase';
import {
  collection as firestoreCollectionRef,
  deleteDoc,
  documentId,
  doc as firestoreDocRef,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  setDoc,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

export interface StorageDriver {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

const memoryStorage = new Map<string, string>();

const memoryDriver: StorageDriver = {
  getItem: (key) => (memoryStorage.has(key) ? memoryStorage.get(key)! : null),
  setItem: (key, value) => {
    memoryStorage.set(key, value);
  },
  removeItem: (key) => {
    memoryStorage.delete(key);
  },
};

const resolveStorage = (): StorageDriver => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return memoryDriver;
};

export const STORAGE_KEYS = {
  // Firestore is now the source of truth for CRM entities.
  // Keep only auth/session and UI preference keys in localStorage.
  users: 'khulisa_users',
  currentUser: 'khulisa_current_user',
  role: 'khulisa_role',
  theme: 'khulisa_theme',
} as const;

// Legacy keys from the localStorage-only CRM storage model.
// These are obsolete once Firestore-backed services are active.
export const OBSOLETE_CRM_STORAGE_KEYS = [
  'khulisa_leads',
  'khulisa_clients',
  'khulisa_projects',
  'khulisa_invoices',
  'khulisa_payments',
  'khulisa_commissions',
  'khulisa_activities',
] as const;

export const generateId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2);

export const getTimestamp = (): string => new Date().toISOString();

export const hasStoredValue = (key: string): boolean => resolveStorage().getItem(key) !== null;

export const readStoredValue = (key: string): string | null => resolveStorage().getItem(key);

export const writeStoredValue = (key: string, value: string): void => {
  resolveStorage().setItem(key, value);
};

export const removeStoredValue = (key: string): void => {
  resolveStorage().removeItem(key);
};

export const readCollection = <T>(key: string): T[] => {
  const raw = readStoredValue(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

export const writeCollection = <T>(key: string, value: T[]): void => {
  writeStoredValue(key, JSON.stringify(value));
};

export class LocalStorageCollection<T extends { id: string }> {
  // Legacy adapter kept for auth/theme compatibility during migration.
  // Core CRM entities should use FirestoreCollection.
  private cache: T[] | null = null;

  constructor(private readonly storageKey: string) {}

  private ensureCache(): T[] {
    if (this.cache) return this.cache;
    this.cache = readCollection<T>(this.storageKey);
    return this.cache;
  }

  private persist(next: T[]): void {
    this.cache = next;
    writeCollection(this.storageKey, next);
  }

  seedIfMissing(seedData: T[]): void {
    if (hasStoredValue(this.storageKey)) return;
    this.persist([...seedData]);
  }

  getAll(): T[] {
    return [...this.ensureCache()];
  }

  getById(id: string): T | undefined {
    return this.ensureCache().find((item) => item.id === id);
  }

  create(item: T): T {
    const next = [...this.ensureCache(), item];
    this.persist(next);
    return item;
  }

  update(id: string, updates: Partial<T>): T | null {
    const items = this.ensureCache();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return null;

    const updated = { ...items[index], ...updates } as T;
    const next = [...items];
    next[index] = updated;
    this.persist(next);
    return updated;
  }

  remove(id: string): boolean {
    const items = this.ensureCache();
    const filtered = items.filter((item) => item.id !== id);
    if (filtered.length === items.length) return false;
    this.persist(filtered);
    return true;
  }
}

const isTimestampLike = (value: unknown): value is { toDate: () => Date } =>
  typeof value === 'object' &&
  value !== null &&
  'toDate' in value &&
  typeof (value as { toDate?: unknown }).toDate === 'function';

const normalizeFromFirestore = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeFromFirestore(item));
  }
  if (isTimestampLike(value)) {
    return value.toDate().toISOString();
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, nested]) => {
      acc[key] = normalizeFromFirestore(nested);
      return acc;
    }, {});
  }
  return value;
};

export const normalizeForFirestore = (value: unknown): unknown => {
  if (value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForFirestore(item));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, nested]) => {
      const normalized = normalizeForFirestore(nested);
      if (normalized !== undefined) {
        acc[key] = normalized;
      }
      return acc;
    }, {});
  }
  return value;
};

export class FirestoreCollection<T extends { id: string }> {
  private readonly collectionRef;

  constructor(private readonly collectionName: string) {
    if (!collectionName || !collectionName.trim()) {
      throw new Error('Firestore collection name is required.');
    }
    this.collectionRef = firestoreCollectionRef(db, collectionName);
  }

  private mapSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): T {
    const normalized = normalizeFromFirestore(snapshot.data()) as Record<string, unknown>;
    return {
      ...normalized,
      id: snapshot.id,
    } as T;
  }

  async getAll(): Promise<T[]> {
    const snapshot = await getDocs(this.collectionRef);
    return snapshot.docs.map((docSnapshot) => this.mapSnapshot(docSnapshot));
  }

  async getAllWhere(field: string, value: unknown): Promise<T[]> {
    const snapshot = await getDocs(query(this.collectionRef, where(field, '==', value)));
    return snapshot.docs.map((docSnapshot) => this.mapSnapshot(docSnapshot));
  }

  async getAllWhereFields(fields: Record<string, unknown>): Promise<T[]> {
    const snapshot = await getDocs(query(this.collectionRef,
      ...Object.entries(fields).map(([field, value]) => where(field, '==', value))));
    return snapshot.docs.map((docSnapshot) => this.mapSnapshot(docSnapshot));
  }

  async getAllWhereIn(field: string, values: string[]): Promise<T[]> {
    const normalizedValues = Array.from(new Set(values.filter((value) => value.trim())));
    if (normalizedValues.length === 0) return [];

    const results: T[] = [];
    for (let index = 0; index < normalizedValues.length; index += 10) {
      const chunk = normalizedValues.slice(index, index + 10);
      const snapshot = await getDocs(query(this.collectionRef, where(field, 'in', chunk)));
      results.push(...snapshot.docs.map((docSnapshot) => this.mapSnapshot(docSnapshot)));
    }
    return results;
  }

  async getByIds(ids: string[]): Promise<T[]> {
    const normalizedIds = Array.from(new Set(ids.filter((id) => id.trim())));
    if (normalizedIds.length === 0) return [];

    const results: T[] = [];
    for (let index = 0; index < normalizedIds.length; index += 10) {
      const chunk = normalizedIds.slice(index, index + 10);
      const snapshot = await getDocs(query(this.collectionRef, where(documentId(), 'in', chunk)));
      results.push(...snapshot.docs.map((docSnapshot) => this.mapSnapshot(docSnapshot)));
    }
    return results;
  }

  async getById(id: string): Promise<T | undefined> {
    const snapshot = await getDoc(firestoreDocRef(this.collectionRef, id));
    if (!snapshot.exists()) return undefined;
    const normalized = normalizeFromFirestore(snapshot.data()) as Record<string, unknown>;
    return {
      ...normalized,
      id: snapshot.id,
    } as T;
  }

  async create(item: T): Promise<T> {
    const { id, ...rest } = item;
    await setDoc(firestoreDocRef(this.collectionRef, id), normalizeForFirestore(rest) as Record<string, unknown>, {
      merge: false,
    });
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('crm:data-changed'));
    return item;
  }

  async update(id: string, updates: Partial<T>): Promise<T | null> {
    const existing = await this.getById(id);
    if (!existing) return null;
    const merged = {
      ...existing,
      ...updates,
      id,
    } as T;
    const { id: _, ...rest } = merged;
    await setDoc(firestoreDocRef(this.collectionRef, id), normalizeForFirestore(rest) as Record<string, unknown>, {
      merge: false,
    });
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('crm:data-changed'));
    return merged;
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;
    await deleteDoc(firestoreDocRef(this.collectionRef, id));
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('crm:data-changed'));
    return true;
  }

  async removeWhere(field: string, value: unknown): Promise<number> {
    const snapshot = await getDocs(query(this.collectionRef, where(field, '==', value)));
    if (snapshot.empty) return 0;
    const batch = writeBatch(db);
    snapshot.docs.forEach((entry) => batch.delete(entry.ref));
    await batch.commit();
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('crm:data-changed'));
    return snapshot.size;
  }

  async seedIfMissing(seedData: T[]): Promise<void> {
    const snapshot = await getDocs(query(this.collectionRef, limit(1)));
    if (!snapshot.empty) return;
    if (seedData.length === 0) return;

    const batch = writeBatch(db);
    seedData.forEach((entry) => {
      const { id, ...rest } = entry;
      batch.set(
        firestoreDocRef(this.collectionRef, id),
        normalizeForFirestore(rest) as Record<string, unknown>,
        { merge: false },
      );
    });
    await batch.commit();
  }
}

export type AuthenticatedRole = 'owner' | 'agent';

export const getCurrentAuthUid = (): string | null => auth?.currentUser?.uid || null;

export const getCurrentAuthKeys = async (): Promise<string[]> => {
  const currentUser = auth?.currentUser;
  if (!currentUser) return [];

  const keys = new Set([currentUser.uid]);
  const claims = (await currentUser.getIdTokenResult()).claims;
  if (typeof claims.appUserId === 'string' && claims.appUserId.trim()) keys.add(claims.appUserId.trim());
  return Array.from(keys);
};

export const getCurrentAuthRole = async (): Promise<AuthenticatedRole> => {
  const currentUser = auth?.currentUser;
  if (!currentUser) throw new Error('Please sign in to load CRM records.');
  const tokenResult = await currentUser.getIdTokenResult();
  const role = tokenResult.claims.role;
  if (role !== 'owner' && role !== 'agent') throw new Error('Your role could not be verified. Please sign in again.');
  return role;
};

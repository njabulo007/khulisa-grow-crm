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
  users: 'khulisa_users',
  leads: 'khulisa_leads',
  clients: 'khulisa_clients',
  projects: 'khulisa_projects',
  invoices: 'khulisa_invoices',
  payments: 'khulisa_payments',
  commissions: 'khulisa_commissions',
  activities: 'khulisa_activities',
  currentUser: 'khulisa_current_user',
  role: 'khulisa_role',
  theme: 'khulisa_theme',
} as const;

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
  // Local development adapter. Firestore-backed services should replace usage of this class,
  // while preserving public service interfaces consumed by hooks/pages.
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

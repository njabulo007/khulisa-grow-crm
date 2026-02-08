import { Client } from '@/types/models';
import { LocalStorageCollection, STORAGE_KEYS, generateId, getTimestamp } from './storage';

export interface ClientService {
  getAll: () => Client[];
  getById: (id: string) => Client | undefined;
  create: (client: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>) => Client;
  update: (id: string, updates: Partial<Client>) => Client | null;
  remove: (id: string) => boolean;
  seedIfMissing: (seedData: Client[]) => void;
}

class LocalClientService implements ClientService {
  // TODO: Replace LocalStorageCollection calls with Firestore collection/doc calls.
  // Keep the ClientService method signatures unchanged to avoid UI-level refactors.
  private readonly collection = new LocalStorageCollection<Client>(STORAGE_KEYS.clients);

  getAll(): Client[] {
    return this.collection.getAll();
  }

  getById(id: string): Client | undefined {
    return this.collection.getById(id);
  }

  create(client: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>): Client {
    return this.collection.create({
      ...client,
      id: generateId(),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    });
  }

  update(id: string, updates: Partial<Client>): Client | null {
    return this.collection.update(id, { ...updates, updatedAt: getTimestamp() });
  }

  remove(id: string): boolean {
    return this.collection.remove(id);
  }

  seedIfMissing(seedData: Client[]): void {
    this.collection.seedIfMissing(seedData);
  }
}

export const clientService: ClientService = new LocalClientService();

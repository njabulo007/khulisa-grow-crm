import { Client } from '@/types/models';
import { FirestoreCollection, generateId, getTimestamp } from './storage';

export interface ClientService {
  getAll: () => Promise<Client[]>;
  getById: (id: string) => Promise<Client | undefined>;
  create: (client: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Client>;
  update: (id: string, updates: Partial<Client>) => Promise<Client | null>;
  remove: (id: string) => Promise<boolean>;
  seedIfMissing: (seedData: Client[]) => Promise<void>;
}

class FirestoreClientService implements ClientService {
  // TODO: Keep this service boundary stable and swap internals with richer Firestore queries as needed.
  private readonly collection = new FirestoreCollection<Client>('clients');

  async getAll(): Promise<Client[]> {
    return this.collection.getAll();
  }

  async getById(id: string): Promise<Client | undefined> {
    return this.collection.getById(id);
  }

  async create(client: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>): Promise<Client> {
    const created = {
      ...client,
      id: generateId(),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    };
    return this.collection.create(created);
  }

  async update(id: string, updates: Partial<Client>): Promise<Client | null> {
    return this.collection.update(id, { ...updates, updatedAt: getTimestamp() });
  }

  async remove(id: string): Promise<boolean> {
    return this.collection.remove(id);
  }

  async seedIfMissing(seedData: Client[]): Promise<void> {
    await this.collection.seedIfMissing(seedData);
  }
}

export const clientService: ClientService = new FirestoreClientService();

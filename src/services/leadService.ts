import { Lead } from '@/types/models';
import { LocalStorageCollection, STORAGE_KEYS, generateId, getTimestamp } from './storage';

export interface LeadService {
  getAll: () => Lead[];
  getById: (id: string) => Lead | undefined;
  getByAgent: (agentId: string) => Lead[];
  create: (lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>) => Lead;
  update: (id: string, updates: Partial<Lead>) => Lead | null;
  remove: (id: string) => boolean;
  seedIfMissing: (seedData: Lead[]) => void;
}

class LocalLeadService implements LeadService {
  // TODO: Replace LocalStorageCollection calls with Firestore collection/doc calls.
  // Keep the LeadService method signatures unchanged to avoid UI-level refactors.
  private readonly collection = new LocalStorageCollection<Lead>(STORAGE_KEYS.leads);

  getAll(): Lead[] {
    return this.collection.getAll();
  }

  getById(id: string): Lead | undefined {
    return this.collection.getById(id);
  }

  getByAgent(agentId: string): Lead[] {
    return this.collection.getAll().filter((lead) => lead.assignedTo === agentId);
  }

  create(lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>): Lead {
    return this.collection.create({
      ...lead,
      id: generateId(),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    });
  }

  update(id: string, updates: Partial<Lead>): Lead | null {
    return this.collection.update(id, { ...updates, updatedAt: getTimestamp() });
  }

  remove(id: string): boolean {
    return this.collection.remove(id);
  }

  seedIfMissing(seedData: Lead[]): void {
    this.collection.seedIfMissing(seedData);
  }
}

export const leadService: LeadService = new LocalLeadService();

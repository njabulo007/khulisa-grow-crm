import { Lead } from '@/types/models';
import { FirestoreCollection, generateId, getTimestamp } from './storage';
import { notificationService } from './notificationService';

export interface LeadService {
  getAll: () => Promise<Lead[]>;
  getById: (id: string) => Promise<Lead | undefined>;
  getByAgent: (agentId: string) => Promise<Lead[]>;
  create: (lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Lead>;
  update: (id: string, updates: Partial<Lead>) => Promise<Lead | null>;
  remove: (id: string) => Promise<boolean>;
  seedIfMissing: (seedData: Lead[]) => Promise<void>;
}

class FirestoreLeadService implements LeadService {
  // TODO: Keep this service boundary stable and swap internals with richer Firestore queries as needed.
  private readonly collection = new FirestoreCollection<Lead>('leads');

  private async notifyAssignment(lead: Lead, previousAssignedTo?: string): Promise<void> {
    const nextAssignedTo = lead.assignedTo?.trim();
    if (!nextAssignedTo) return;
    if (previousAssignedTo && previousAssignedTo === nextAssignedTo) return;
    // Skip notifying on self-assigned lead creation by the same agent.
    if (!previousAssignedTo && lead.createdBy === nextAssignedTo) return;

    await notificationService.createForUser(nextAssignedTo, {
      type: 'lead_assigned',
      leadId: lead.id,
      title: 'New lead assigned',
      message: `You've been assigned a new lead: ${lead.businessName}`,
    });
  }

  async getAll(): Promise<Lead[]> {
    return this.collection.getAll();
  }

  async getById(id: string): Promise<Lead | undefined> {
    return this.collection.getById(id);
  }

  async getByAgent(agentId: string): Promise<Lead[]> {
    const leads = await this.collection.getAll();
    return leads.filter((lead) => lead.assignedTo === agentId);
  }

  async create(lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>): Promise<Lead> {
    const created = {
      ...lead,
      id: generateId(),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    };
    const persisted = await this.collection.create(created);
    await this.notifyAssignment(persisted);
    return persisted;
  }

  async update(id: string, updates: Partial<Lead>): Promise<Lead | null> {
    const existing = await this.collection.getById(id);
    if (!existing) return null;

    const updated = await this.collection.update(id, { ...updates, updatedAt: getTimestamp() });
    if (updated) {
      await this.notifyAssignment(updated, existing.assignedTo);
    }
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    return this.collection.remove(id);
  }

  async seedIfMissing(seedData: Lead[]): Promise<void> {
    await this.collection.seedIfMissing(seedData);
  }
}

export const leadService: LeadService = new FirestoreLeadService();

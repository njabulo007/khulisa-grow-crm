import { deleteCrmRecord } from './deletionService';
import { Client } from '@/types/models';
import {
  FirestoreCollection,
  generateId,
  getCurrentAuthKeys,
  getCurrentAuthRole,
  getTimestamp,
} from './storage';

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
  private readonly leads = new FirestoreCollection<{ id: string; assignedTo?: string }>('leads');
  private readonly projects = new FirestoreCollection<{ id: string; clientId?: string; assignedTo?: string }>('projects');

  async getAll(): Promise<Client[]> {
    if ((await getCurrentAuthRole()) === 'owner') return this.collection.getAll();
    const authKeys = await getCurrentAuthKeys();
    if (authKeys.length === 0) return [];

    const [assignedLeads, assignedProjects] = await Promise.all([
      this.leads.getAllWhereIn('assignedTo', authKeys),
      this.projects.getAllWhereIn('assignedTo', authKeys),
    ]);
    // Each query has one known lead; related-document rule reads then stay
    // inside Firestore's per-query access-call budget even for large portfolios.
    const leadClients = (await Promise.all(assignedLeads.map(lead =>
      this.collection.getAllWhere('leadId', lead.id),
    ))).flat();
    const projectClientIds = [...new Set(assignedProjects.map(project => project.clientId).filter(Boolean))] as string[];
    const visibleProjectClients = (await Promise.all(projectClientIds.map(id => this.collection.getById(id))))
      .filter((client): client is Client => !!client);

    const byId = new Map<string, Client>();
    const managedClients = (await Promise.all(authKeys.map(key => this.collection.getAllWhere('contactManagerId', key).catch(error=>{if(error?.code !== 'permission-denied' && error?.code !== 'firestore/permission-denied')throw error;console.warn('[Client manager access] Publish updated Firestore rules to enable dedicated assignments.');return [];})))).flat();
    [...leadClients, ...visibleProjectClients, ...managedClients].forEach((client) => byId.set(client.id, client));
    return Array.from(byId.values());
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
    return deleteCrmRecord('client', id);
  }

  async seedIfMissing(seedData: Client[]): Promise<void> {
    await this.collection.seedIfMissing(seedData);
  }
}

export const clientService: ClientService = new FirestoreClientService();

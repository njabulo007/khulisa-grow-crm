import { Activity } from '@/types/models';
import { resolveAgentIdForInvoice } from '@/lib/invoiceAgentResolver';
import { FirestoreCollection, generateId, getTimestamp } from './storage';
import { authService } from './authService';
import { clientService } from './clientService';
import { invoiceService } from './invoiceService';
import { leadService } from './leadService';
import { notificationService } from './notificationService';
import { projectService } from './projectService';

export interface ActivityService {
  getAll: () => Promise<Activity[]>;
  getById: (id: string) => Promise<Activity | undefined>;
  getByEntity: (entityType: string, entityId: string) => Promise<Activity[]>;
  create: (activity: Omit<Activity, 'id' | 'createdAt'>) => Promise<Activity>;
  update: (id: string, updates: Partial<Activity>) => Promise<Activity | null>;
  remove: (id: string) => Promise<boolean>;
  seedIfMissing: (seedData: Activity[]) => Promise<void>;
}

class FirestoreActivityService implements ActivityService {
  // TODO: Keep this service boundary stable and swap internals with richer Firestore queries as needed.
  private readonly collection = new FirestoreCollection<Activity>('activities');

  private async resolveRecipients(activity: Omit<Activity, 'id' | 'createdAt'>): Promise<Set<string>> {
    const recipients = new Set<string>();
    const owners = authService
      .getAll()
      .filter((user) => user.role === 'owner' && user.isActive !== false)
      .map((user) => user.id);
    owners.forEach((ownerId) => recipients.add(ownerId));

    if (activity.entityType === 'lead') {
      const lead = await leadService.getById(activity.entityId);
      if (lead?.assignedTo) recipients.add(lead.assignedTo);
    }

    if (activity.entityType === 'client') {
      const client = await clientService.getById(activity.entityId);
      if (client?.leadId) {
        const lead = await leadService.getById(client.leadId);
        if (lead?.assignedTo) recipients.add(lead.assignedTo);
      }
    }

    if (activity.entityType === 'project') {
      const project = await projectService.getById(activity.entityId);
      if (project?.assignedTo) recipients.add(project.assignedTo);
    }

    if (activity.entityType === 'invoice') {
      const invoice = await invoiceService.getById(activity.entityId);
      if (invoice) {
        const [projects, leads, clients] = await Promise.all([
          projectService.getAll(),
          leadService.getAll(),
          clientService.getAll(),
        ]);
        const agentId = resolveAgentIdForInvoice(invoice, projects, leads, clients);
        if (agentId) recipients.add(agentId);
      }
    }

    if (activity.createdBy) {
      recipients.delete(activity.createdBy);
    }

    return recipients;
  }

  private async notifyActivity(activity: Activity): Promise<void> {
    const recipients = await this.resolveRecipients(activity);
    if (recipients.size === 0) return;

    const actorName = authService.getById(activity.createdBy)?.name || 'A team member';
    const title = `${activity.entityType[0].toUpperCase()}${activity.entityType.slice(1)} activity`;
    const message = `${actorName}: ${activity.description}`;

    const notificationData = {
      type: 'activity' as const,
      title,
      message,
      leadId: activity.entityType === 'lead' ? activity.entityId : undefined,
      clientId: activity.entityType === 'client' ? activity.entityId : undefined,
      projectId: activity.entityType === 'project' ? activity.entityId : undefined,
      invoiceId: activity.entityType === 'invoice' ? activity.entityId : undefined,
    };

    await Promise.all(
      Array.from(recipients).map((recipientId) =>
        notificationService.createForUser(recipientId, notificationData)
      )
    );
  }

  async getAll(): Promise<Activity[]> {
    return this.collection.getAll();
  }

  async getById(id: string): Promise<Activity | undefined> {
    return this.collection.getById(id);
  }

  async getByEntity(entityType: string, entityId: string): Promise<Activity[]> {
    const activities = await this.collection.getAll();
    return activities
      .filter((activity) => activity.entityType === entityType && activity.entityId === entityId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async create(activity: Omit<Activity, 'id' | 'createdAt'>): Promise<Activity> {
    const created = {
      ...activity,
      id: generateId(),
      createdAt: getTimestamp(),
    };
    const persisted = await this.collection.create(created);
    await this.notifyActivity(persisted);
    return persisted;
  }

  async update(id: string, updates: Partial<Activity>): Promise<Activity | null> {
    return this.collection.update(id, updates);
  }

  async remove(id: string): Promise<boolean> {
    return this.collection.remove(id);
  }

  async seedIfMissing(seedData: Activity[]): Promise<void> {
    await this.collection.seedIfMissing(seedData);
  }
}

export const activityService: ActivityService = new FirestoreActivityService();

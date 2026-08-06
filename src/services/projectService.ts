import { getPackageById, resolvePackageId } from '@/config/packages';
import {
  getAutoProjectStatusFromMilestones,
  normalizeProjectMilestones,
  normalizeProjectStatus,
} from '@/lib/projectMilestones';
import { Project } from '@/types/models';
import { authService } from './authService';
import { notificationService } from './notificationService';
import { FirestoreCollection, generateId, getTimestamp } from './storage';

const DEADLINE_ATTENTION_WINDOW_MS = 1000 * 60 * 60 * 24 * 7;

const parseDateMs = (value?: string): number | null => {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

const getDueDateKey = (value: string): string => new Date(value).toISOString().slice(0, 10);

const isClosedStatus = (status: Project['status']): boolean =>
  status === 'completed' || status === 'delivered';

export interface ProjectService {
  getAll: () => Promise<Project[]>;
  getById: (id: string) => Promise<Project | undefined>;
  getByClient: (clientId: string) => Promise<Project[]>;
  getByAgent: (agentId: string) => Promise<Project[]>;
  create: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Project>;
  update: (id: string, updates: Partial<Project>) => Promise<Project | null>;
  remove: (id: string) => Promise<boolean>;
  seedIfMissing: (seedData: Project[]) => Promise<void>;
}

class FirestoreProjectService implements ProjectService {
  // TODO: Keep this service boundary stable and swap internals with richer Firestore queries as needed.
  private readonly collection = new FirestoreCollection<Project & { packageType?: string }>('projects');

  private normalizeProject(project: Project & { packageType?: string }): Project {
    const packageId = resolvePackageId(project.packageId ?? project.packageType);
    const pkg = getPackageById(packageId);
    const milestones = normalizeProjectMilestones(project.milestones, packageId);

    return {
      ...project,
      packageId,
      packageName: pkg?.name,
      packagePrice: pkg?.price,
      status: normalizeProjectStatus(project.status),
      milestones,
    };
  }

  private async notifyDeadline(project: Project, previousDueDate?: string): Promise<void> {
    if (!project.dueDate || isClosedStatus(project.status)) return;
    if (previousDueDate === project.dueDate) return;

    const dueMs = parseDateMs(project.dueDate);
    if (dueMs === null) return;

    const nowMs = Date.now();
    if (dueMs - nowMs > DEADLINE_ATTENTION_WINDOW_MS) return;

    const recipients = new Set<string>();
    if (project.assignedTo?.trim()) recipients.add(project.assignedTo.trim());
    authService
      .getAll()
      .filter((user) => user.role === 'owner' && user.isActive !== false)
      .forEach((owner) => recipients.add(owner.id));
    if (recipients.size === 0) return;

    const dateKey = getDueDateKey(project.dueDate);
    const isOverdue = dueMs < nowMs;
    const dueText = new Date(project.dueDate).toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    await Promise.all(
      Array.from(recipients).map(async (recipientId) => {
        const existingNotifications = await notificationService.getForUser(recipientId);
        if (
          existingNotifications.some(
            (entry) =>
              entry.type === 'project_deadline' &&
              entry.projectId === project.id &&
              entry.message.includes(dateKey)
          )
        ) {
          return;
        }

        await notificationService.createForUser(recipientId, {
          type: 'project_deadline',
          projectId: project.id,
          clientId: project.clientId,
          title: isOverdue ? 'Project deadline overdue' : 'Project deadline due soon',
          message: `${project.name} is ${isOverdue ? 'overdue' : 'due'} on ${dueText}. Ref: ${dateKey}`,
        });
      })
    );
  }

  async getAll(): Promise<Project[]> {
    const projects = await this.collection.getAll();
    return projects.map((project) => this.normalizeProject(project));
  }

  async getById(id: string): Promise<Project | undefined> {
    const project = await this.collection.getById(id);
    return project ? this.normalizeProject(project) : undefined;
  }

  async getByClient(clientId: string): Promise<Project[]> {
    const projects = await this.getAll();
    return projects.filter((project) => project.clientId === clientId);
  }

  async getByAgent(agentId: string): Promise<Project[]> {
    const projects = await this.getAll();
    return projects.filter((project) => project.assignedTo === agentId);
  }

  async create(project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project> {
    const packageId = resolvePackageId(project.packageId);
    const pkg = getPackageById(packageId);
    const milestones = normalizeProjectMilestones(project.milestones, packageId);
    const status = normalizeProjectStatus(project.status);

    const created = await this.collection.create({
      ...project,
      packageId,
      packageName: pkg?.name,
      packagePrice: pkg?.price,
      status,
      milestones,
      id: generateId(),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    });
    const normalized = this.normalizeProject(created);
    await this.notifyDeadline(normalized);
    return normalized;
  }

  async update(id: string, updates: Partial<Project>): Promise<Project | null> {
    const current = await this.getById(id);
    if (!current) return null;

    const nextPackageId = updates.packageId ? resolvePackageId(updates.packageId) : current.packageId;
    const normalizedUpdates: Partial<Project> = {
      ...updates,
      updatedAt: getTimestamp(),
    };

    if (updates.packageId) {
      const pkg = getPackageById(nextPackageId);
      normalizedUpdates.packageId = nextPackageId;
      normalizedUpdates.packageName = pkg?.name;
      normalizedUpdates.packagePrice = pkg?.price;
    }

    if (updates.status) {
      normalizedUpdates.status = normalizeProjectStatus(updates.status);
    }

    if (updates.milestones) {
      const normalizedMilestones = normalizeProjectMilestones(updates.milestones, nextPackageId);
      normalizedUpdates.milestones = normalizedMilestones;
      if (!updates.status) {
        normalizedUpdates.status = getAutoProjectStatusFromMilestones(
          normalizedMilestones,
          normalizeProjectStatus(current.status),
        );
      }
    }

    const updated = await this.collection.update(id, normalizedUpdates);
    if (!updated) return null;

    const normalized = this.normalizeProject(updated);
    await this.notifyDeadline(normalized, current.dueDate);
    return normalized;
  }

  async remove(id: string): Promise<boolean> {
    return this.collection.remove(id);
  }

  async seedIfMissing(seedData: Project[]): Promise<void> {
    await this.collection.seedIfMissing(seedData);
  }
}

export const projectService: ProjectService = new FirestoreProjectService();

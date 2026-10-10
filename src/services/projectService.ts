import { clientService } from './clientService';
import { resolveDeliveryStatus } from '@/lib/projectDeliveryPermissions';
import { saveProjectWithClientAccess } from './clientAccessService';
import { deleteCrmRecord } from './deletionService';
import { getPackageById, resolvePackageId } from '@/config/packages';
import {
  getAutoProjectStatusFromMilestones,
  normalizeProjectMilestones,
  normalizeProjectStatus,
} from '@/lib/projectMilestones';
import { Project } from '@/types/models';
import { authService } from './authService';
import { notificationService } from './notificationService';
import { FirestoreCollection, generateId, getCurrentAuthKeys, getCurrentAuthRole, getTimestamp } from './storage';

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
    const milestones = Array.isArray(project.milestones) && project.milestones.length ? normalizeProjectMilestones(project.milestones, packageId) : [];

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
          dedupeKey: `project-deadline:${project.id}:${dateKey}`,
        });
      })
    );
  }

  async getAll(): Promise<Project[]> {
    if ((await getCurrentAuthRole()) === 'owner') return (await this.collection.getAll()).map(p=>this.normalizeProject(p));
    const keys=await getCurrentAuthKeys();
    const assigned=await this.collection.getAllWhereIn('assignedTo',keys);
    const managed=(await clientService.getAll()).filter(c=>c.contactManagerId&&keys.includes(c.contactManagerId));
    const related=(await Promise.all(managed.map(c=>this.collection.getAllWhere('clientId',c.id)))).flat();
    return [...new Map([...assigned,...related].map(p=>[p.id,p])).values()].map(p=>this.normalizeProject(p));
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
    const projects = await this.collection.getAllWhere('assignedTo', agentId);
    return projects.map((project) => this.normalizeProject(project));
  }

  async create(project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project> {
    const packageId = resolvePackageId(project.packageId);
    const pkg = getPackageById(packageId);
    const milestones = normalizeProjectMilestones(project.milestones, packageId);
    const status = normalizeProjectStatus(project.status);

    const nextProject: Project = {
      ...project,
      packageId,
      packageName: pkg?.name,
      packagePrice: pkg?.price,
      status,
      milestones,
      id: generateId(),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    };
    if (await getCurrentAuthRole() === 'owner') await saveProjectWithClientAccess(nextProject);
    else await this.collection.create(nextProject);
    const normalized = this.normalizeProject(nextProject);
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
        const nextStatus = getAutoProjectStatusFromMilestones(normalizedMilestones, normalizeProjectStatus(current.status));
        normalizedUpdates.status = resolveDeliveryStatus(nextStatus, current.status, await getCurrentAuthRole());
      }
    }

    let updated: Project | null;
    if ((updates.assignedTo !== undefined || updates.clientId !== undefined) && await getCurrentAuthRole() === 'owner') {
      updated = { ...current, ...normalizedUpdates };
      await saveProjectWithClientAccess(updated, current.clientId, normalizedUpdates);
    } else updated = await this.collection.update(id, normalizedUpdates);
    if (!updated) return null;

    const normalized = this.normalizeProject(updated);
    await this.notifyDeadline(normalized, current.dueDate);
    return normalized;
  }

  async remove(id: string): Promise<boolean> {
    return deleteCrmRecord('project', id);
  }

  async seedIfMissing(seedData: Project[]): Promise<void> {
    await this.collection.seedIfMissing(seedData);
  }
}

export const projectService: ProjectService = new FirestoreProjectService();

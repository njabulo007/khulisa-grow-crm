import { getPackageById, resolvePackageId } from '@/config/packages';
import {
  getAutoProjectStatusFromMilestones,
  normalizeProjectMilestones,
  normalizeProjectStatus,
} from '@/lib/projectMilestones';
import { Project } from '@/types/models';
import { FirestoreCollection, generateId, getTimestamp } from './storage';

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
    return this.normalizeProject(created);
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
    return updated ? this.normalizeProject(updated) : null;
  }

  async remove(id: string): Promise<boolean> {
    return this.collection.remove(id);
  }

  async seedIfMissing(seedData: Project[]): Promise<void> {
    await this.collection.seedIfMissing(seedData);
  }
}

export const projectService: ProjectService = new FirestoreProjectService();

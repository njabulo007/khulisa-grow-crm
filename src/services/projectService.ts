import { getPackageById, resolvePackageId } from '@/config/packages';
import { Project } from '@/types/models';
import { LocalStorageCollection, STORAGE_KEYS, generateId, getTimestamp } from './storage';

export interface ProjectService {
  getAll: () => Project[];
  getById: (id: string) => Project | undefined;
  getByClient: (clientId: string) => Project[];
  getByAgent: (agentId: string) => Project[];
  create: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => Project;
  update: (id: string, updates: Partial<Project>) => Project | null;
  remove: (id: string) => boolean;
  seedIfMissing: (seedData: Project[]) => void;
}

class LocalProjectService implements ProjectService {
  // TODO: Replace LocalStorageCollection calls with Firestore collection/doc calls.
  // Keep the ProjectService method signatures unchanged to avoid UI-level refactors.
  private readonly collection = new LocalStorageCollection<Project & { packageType?: string }>(STORAGE_KEYS.projects);

  private normalizeProject(project: Project & { packageType?: string }): Project {
    const packageId = resolvePackageId(project.packageId ?? project.packageType);
    const pkg = getPackageById(packageId);
    return {
      ...project,
      packageId,
      packageName: pkg?.name,
      packagePrice: pkg?.price,
    };
  }

  getAll(): Project[] {
    return this.collection.getAll().map((project) => this.normalizeProject(project));
  }

  getById(id: string): Project | undefined {
    const project = this.collection.getById(id);
    return project ? this.normalizeProject(project) : undefined;
  }

  getByClient(clientId: string): Project[] {
    return this.getAll().filter((project) => project.clientId === clientId);
  }

  getByAgent(agentId: string): Project[] {
    return this.getAll().filter((project) => project.assignedTo === agentId);
  }

  create(project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Project {
    const packageId = resolvePackageId(project.packageId);
    const pkg = getPackageById(packageId);
    const created = this.collection.create({
      ...project,
      packageId,
      packageName: pkg?.name,
      packagePrice: pkg?.price,
      id: generateId(),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    });
    return this.normalizeProject(created);
  }

  update(id: string, updates: Partial<Project>): Project | null {
    const normalizedUpdates: Partial<Project> = {
      ...updates,
      updatedAt: getTimestamp(),
    };
    if (updates.packageId) {
      const nextPackageId = resolvePackageId(updates.packageId);
      const pkg = getPackageById(nextPackageId);
      normalizedUpdates.packageId = nextPackageId;
      normalizedUpdates.packageName = pkg?.name;
      normalizedUpdates.packagePrice = pkg?.price;
    }

    const updated = this.collection.update(id, normalizedUpdates);
    return updated ? this.normalizeProject(updated) : null;
  }

  remove(id: string): boolean {
    return this.collection.remove(id);
  }

  seedIfMissing(seedData: Project[]): void {
    this.collection.seedIfMissing(seedData);
  }
}

export const projectService: ProjectService = new LocalProjectService();

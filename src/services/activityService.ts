import { Activity } from '@/types/models';
import { FirestoreCollection, generateId, getTimestamp } from './storage';

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
    return this.collection.create(created);
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

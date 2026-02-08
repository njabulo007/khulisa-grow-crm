import { Activity } from '@/types/models';
import { LocalStorageCollection, STORAGE_KEYS, generateId, getTimestamp } from './storage';

export interface ActivityService {
  getAll: () => Activity[];
  getById: (id: string) => Activity | undefined;
  getByEntity: (entityType: string, entityId: string) => Activity[];
  create: (activity: Omit<Activity, 'id' | 'createdAt'>) => Activity;
  update: (id: string, updates: Partial<Activity>) => Activity | null;
  remove: (id: string) => boolean;
  seedIfMissing: (seedData: Activity[]) => void;
}

class LocalActivityService implements ActivityService {
  // TODO: Replace LocalStorageCollection calls with Firestore collection/doc calls.
  // Keep the ActivityService method signatures unchanged to avoid UI-level refactors.
  private readonly collection = new LocalStorageCollection<Activity>(STORAGE_KEYS.activities);

  getAll(): Activity[] {
    return this.collection.getAll();
  }

  getById(id: string): Activity | undefined {
    return this.collection.getById(id);
  }

  getByEntity(entityType: string, entityId: string): Activity[] {
    return this.collection
      .getAll()
      .filter((activity) => activity.entityType === entityType && activity.entityId === entityId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  create(activity: Omit<Activity, 'id' | 'createdAt'>): Activity {
    return this.collection.create({
      ...activity,
      id: generateId(),
      createdAt: getTimestamp(),
    });
  }

  update(id: string, updates: Partial<Activity>): Activity | null {
    return this.collection.update(id, updates);
  }

  remove(id: string): boolean {
    return this.collection.remove(id);
  }

  seedIfMissing(seedData: Activity[]): void {
    this.collection.seedIfMissing(seedData);
  }
}

export const activityService: ActivityService = new LocalActivityService();

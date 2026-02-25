import { BASE_AGENT_RATE } from '@/config/commission';
import { GlobalSettings } from '@/types/models';
import { FirestoreCollection, getTimestamp } from './storage';

const GLOBAL_SETTINGS_ID = 'global';
const DEFAULT_MANUAL_COMMISSION_RATE = Math.round(BASE_AGENT_RATE * 100);

const clampCommissionRatePercent = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_MANUAL_COMMISSION_RATE;
  return Math.min(100, Math.max(0, Math.round(value * 100) / 100));
};

const normalizeGlobalSettings = (input?: Partial<GlobalSettings>): GlobalSettings => ({
  id: GLOBAL_SETTINGS_ID,
  commissionMode: input?.commissionMode === 'manual' ? 'manual' : 'automatic',
  defaultManualCommissionRate: clampCommissionRatePercent(
    input?.defaultManualCommissionRate ?? DEFAULT_MANUAL_COMMISSION_RATE
  ),
  createdAt: input?.createdAt || getTimestamp(),
  updatedAt: input?.updatedAt || getTimestamp(),
});

export interface SettingsService {
  getGlobal: () => Promise<GlobalSettings>;
  updateGlobal: (
    updates: Partial<Pick<GlobalSettings, 'commissionMode' | 'defaultManualCommissionRate'>>
  ) => Promise<GlobalSettings>;
}

class FirestoreSettingsService implements SettingsService {
  private readonly collection = new FirestoreCollection<GlobalSettings>('settings');

  async getGlobal(): Promise<GlobalSettings> {
    try {
      const existing = await this.collection.getById(GLOBAL_SETTINGS_ID);
      if (existing) return normalizeGlobalSettings(existing);

      const created = normalizeGlobalSettings({
        id: GLOBAL_SETTINGS_ID,
        createdAt: getTimestamp(),
        updatedAt: getTimestamp(),
      });
      await this.collection.create(created);
      return created;
    } catch (error) {
      console.error('[SettingsService] Falling back to default settings.', error);
      return normalizeGlobalSettings();
    }
  }

  async updateGlobal(
    updates: Partial<Pick<GlobalSettings, 'commissionMode' | 'defaultManualCommissionRate'>>
  ): Promise<GlobalSettings> {
    const current = await this.getGlobal();
    const next: GlobalSettings = normalizeGlobalSettings({
      ...current,
      ...updates,
      createdAt: current.createdAt,
      updatedAt: getTimestamp(),
    });

    const updated = await this.collection.update(GLOBAL_SETTINGS_ID, next);
    if (updated) return normalizeGlobalSettings(updated);

    await this.collection.create(next);
    return next;
  }
}

export const settingsService: SettingsService = new FirestoreSettingsService();

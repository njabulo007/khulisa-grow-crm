import { COMMISSION_RATE } from '@/config/commission';
import { getPackageById, resolvePackageId } from '@/config/packages';
import { Commission } from '@/types/models';
import { LocalStorageCollection, STORAGE_KEYS, generateId, getTimestamp } from './storage';

export interface CommissionService {
  getAll: () => Commission[];
  getById: (id: string) => Commission | undefined;
  getByAgent: (agentId: string) => Commission[];
  getByInvoice: (invoiceId: string) => Commission | undefined;
  create: (commission: Omit<Commission, 'id' | 'createdAt' | 'updatedAt'>) => Commission;
  update: (id: string, updates: Partial<Commission>) => Commission | null;
  remove: (id: string) => boolean;
  seedIfMissing: (seedData: Commission[]) => void;
}

class LocalCommissionService implements CommissionService {
  // TODO: Replace LocalStorageCollection calls with Firestore collection/doc calls.
  // Keep the CommissionService method signatures unchanged to avoid UI-level refactors.
  private readonly collection = new LocalStorageCollection<
    Commission & { amount?: number; paidOutAt?: string; packageType?: string }
  >(STORAGE_KEYS.commissions);

  private roundCurrency(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private normalizeCommission(
    commission: Commission & { amount?: number; paidOutAt?: string; packageType?: string }
  ): Commission {
    const packageId = resolvePackageId(commission.packageId ?? commission.packageType);
    const pkg = getPackageById(packageId);
    const normalizedRate = COMMISSION_RATE;
    const normalizedAmount = pkg
      ? this.roundCurrency(pkg.price * normalizedRate)
      : commission.commissionAmount ?? commission.amount ?? 0;

    return {
      ...commission,
      packageId,
      packageName: pkg?.name,
      packagePrice: pkg?.price,
      commissionAmount: normalizedAmount,
      rate: normalizedRate,
      paidOutDate: commission.paidOutDate ?? commission.paidOutAt,
    };
  }

  getAll(): Commission[] {
    return this.collection.getAll().map((commission) => this.normalizeCommission(commission));
  }

  getById(id: string): Commission | undefined {
    const commission = this.collection.getById(id);
    return commission ? this.normalizeCommission(commission) : undefined;
  }

  getByAgent(agentId: string): Commission[] {
    return this.getAll().filter((commission) => commission.agentId === agentId);
  }

  getByInvoice(invoiceId: string): Commission | undefined {
    return this.getAll().find((commission) => commission.invoiceId === invoiceId);
  }

  create(commission: Omit<Commission, 'id' | 'createdAt' | 'updatedAt'>): Commission {
    const packageId = resolvePackageId(commission.packageId);
    const pkg = getPackageById(packageId);

    const created = this.collection.create({
      ...commission,
      packageId,
      packageName: pkg?.name,
      packagePrice: pkg?.price,
      commissionAmount: pkg ? this.roundCurrency(pkg.price * COMMISSION_RATE) : commission.commissionAmount,
      rate: COMMISSION_RATE,
      id: generateId(),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    });
    return this.normalizeCommission(created);
  }

  update(id: string, updates: Partial<Commission>): Commission | null {
    const normalizedUpdates: Partial<Commission> = {
      ...updates,
      updatedAt: getTimestamp(),
    };
    if (updates.packageId) {
      const packageId = resolvePackageId(updates.packageId);
      const pkg = getPackageById(packageId);
      normalizedUpdates.packageId = packageId;
      normalizedUpdates.packageName = pkg?.name;
      normalizedUpdates.packagePrice = pkg?.price;
    }
    if (typeof updates.rate === 'number') {
      normalizedUpdates.rate = COMMISSION_RATE;
    }
    if (normalizedUpdates.packageId) {
      const pkg = getPackageById(normalizedUpdates.packageId);
      if (pkg) {
        normalizedUpdates.commissionAmount = this.roundCurrency(pkg.price * COMMISSION_RATE);
        normalizedUpdates.rate = COMMISSION_RATE;
      }
    }
    const updated = this.collection.update(id, normalizedUpdates);
    return updated ? this.normalizeCommission(updated) : null;
  }

  remove(id: string): boolean {
    return this.collection.remove(id);
  }

  seedIfMissing(seedData: Commission[]): void {
    this.collection.seedIfMissing(seedData);
  }
}

export const commissionService: CommissionService = new LocalCommissionService();

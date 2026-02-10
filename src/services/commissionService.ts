import { COMMISSION_RATE } from '@/config/commission';
import { getPackageById, resolvePackageId } from '@/config/packages';
import { Commission } from '@/types/models';
import { FirestoreCollection, generateId, getTimestamp } from './storage';

export interface CommissionService {
  getAll: () => Promise<Commission[]>;
  getById: (id: string) => Promise<Commission | undefined>;
  getByAgent: (agentId: string) => Promise<Commission[]>;
  getByInvoice: (invoiceId: string) => Promise<Commission | undefined>;
  getByInvoiceId: (invoiceId: string) => Promise<Commission[]>;
  create: (commission: Omit<Commission, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Commission>;
  update: (id: string, updates: Partial<Commission>) => Promise<Commission | null>;
  remove: (id: string) => Promise<boolean>;
  seedIfMissing: (seedData: Commission[]) => Promise<void>;
}

class FirestoreCommissionService implements CommissionService {
  // TODO: Keep this service boundary stable and swap internals with richer Firestore queries as needed.
  private readonly collection = new FirestoreCollection<
    Commission & { amount?: number; paidOutAt?: string; packageType?: string }
  >('commissions');

  private roundCurrency(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private normalizeCommission(
    commission: Commission & { amount?: number; paidOutAt?: string; packageType?: string }
  ): Commission {
    const packageId = resolvePackageId(commission.packageId ?? commission.packageType);
    const pkg = getPackageById(packageId);
    const normalizedRate =
      typeof commission.rate === 'number' && Number.isFinite(commission.rate)
        ? commission.rate
        : COMMISSION_RATE;
    const normalizedAmount =
      typeof commission.commissionAmount === 'number' && Number.isFinite(commission.commissionAmount)
        ? commission.commissionAmount
        : typeof commission.amount === 'number' && Number.isFinite(commission.amount)
          ? commission.amount
          : pkg
            ? this.roundCurrency(pkg.price * normalizedRate)
            : 0;

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

  async getAll(): Promise<Commission[]> {
    const commissions = await this.collection.getAll();
    return commissions.map((commission) => this.normalizeCommission(commission));
  }

  async getById(id: string): Promise<Commission | undefined> {
    const commission = await this.collection.getById(id);
    return commission ? this.normalizeCommission(commission) : undefined;
  }

  async getByAgent(agentId: string): Promise<Commission[]> {
    const commissions = await this.getAll();
    return commissions.filter((commission) => commission.agentId === agentId);
  }

  async getByInvoice(invoiceId: string): Promise<Commission | undefined> {
    const commissions = await this.getAll();
    return commissions.find((commission) => commission.invoiceId === invoiceId);
  }

  async getByInvoiceId(invoiceId: string): Promise<Commission[]> {
    const commissions = await this.getAll();
    return commissions.filter((commission) => commission.invoiceId === invoiceId);
  }

  async create(commission: Omit<Commission, 'id' | 'createdAt' | 'updatedAt'>): Promise<Commission> {
    const packageId = resolvePackageId(commission.packageId);
    const pkg = getPackageById(packageId);
    const normalizedRate =
      typeof commission.rate === 'number' && Number.isFinite(commission.rate)
        ? commission.rate
        : COMMISSION_RATE;
    const normalizedAmount =
      typeof commission.commissionAmount === 'number' && Number.isFinite(commission.commissionAmount)
        ? commission.commissionAmount
        : pkg
          ? this.roundCurrency(pkg.price * normalizedRate)
          : 0;

    const created = await this.collection.create({
      ...commission,
      packageId,
      packageName: pkg?.name,
      packagePrice: pkg?.price,
      commissionAmount: normalizedAmount,
      rate: normalizedRate,
      id: generateId(),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    });
    return this.normalizeCommission(created);
  }

  async update(id: string, updates: Partial<Commission>): Promise<Commission | null> {
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
    if (
      normalizedUpdates.packageId &&
      typeof normalizedUpdates.commissionAmount !== 'number'
    ) {
      const pkg = getPackageById(normalizedUpdates.packageId);
      if (pkg) {
        let rateForCalculation: number;
        if (typeof normalizedUpdates.rate === 'number' && Number.isFinite(normalizedUpdates.rate)) {
          rateForCalculation = normalizedUpdates.rate;
        } else {
          const existing = await this.collection.getById(id);
          rateForCalculation =
            typeof existing?.rate === 'number' && Number.isFinite(existing.rate)
              ? existing.rate
              : COMMISSION_RATE;
        }
        normalizedUpdates.commissionAmount = this.roundCurrency(pkg.price * rateForCalculation);
        normalizedUpdates.rate = rateForCalculation;
      }
    }
    const updated = await this.collection.update(id, normalizedUpdates);
    return updated ? this.normalizeCommission(updated) : null;
  }

  async remove(id: string): Promise<boolean> {
    return this.collection.remove(id);
  }

  async seedIfMissing(seedData: Commission[]): Promise<void> {
    await this.collection.seedIfMissing(seedData);
  }
}

export const commissionService: CommissionService = new FirestoreCommissionService();

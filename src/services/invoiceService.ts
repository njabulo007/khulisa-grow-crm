import { Invoice } from '@/types/models';
import { getPackageById, resolvePackageId } from '@/config/packages';
import { LocalStorageCollection, STORAGE_KEYS, generateId, getTimestamp } from './storage';
import { projectService } from './projectService';

export interface InvoiceService {
  getAll: () => Invoice[];
  getById: (id: string) => Invoice | undefined;
  getByClient: (clientId: string) => Invoice[];
  getNextNumber: () => string;
  create: (invoice: Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>) => Invoice;
  update: (id: string, updates: Partial<Invoice>) => Invoice | null;
  remove: (id: string) => boolean;
  seedIfMissing: (seedData: Invoice[]) => void;
}

class LocalInvoiceService implements InvoiceService {
  // TODO: Replace LocalStorageCollection calls with Firestore collection/doc calls.
  // Keep the InvoiceService method signatures unchanged to avoid UI-level refactors.
  private readonly collection = new LocalStorageCollection<Invoice & { packageType?: string }>(STORAGE_KEYS.invoices);

  private resolvePackageSnapshot(
    projectId?: string,
    packageIdValue?: string
  ): { packageId?: Invoice['packageId']; packageName?: Invoice['packageName']; packagePrice?: number } {
    const fromProject = projectId ? projectService.getById(projectId)?.packageId : undefined;
    const rawPackageId = packageIdValue ?? fromProject;
    if (!rawPackageId) return {};
    const packageId = resolvePackageId(rawPackageId);
    const pkg = getPackageById(packageId);
    return {
      packageId,
      packageName: pkg?.name,
      packagePrice: pkg?.price,
    };
  }

  private normalizeInvoice(invoice: Invoice & { packageType?: string }): Invoice {
    const packageSnapshot = this.resolvePackageSnapshot(
      invoice.projectId,
      invoice.packageId ?? invoice.packageType
    );

    return {
      ...invoice,
      ...packageSnapshot,
    };
  }

  getAll(): Invoice[] {
    return this.collection.getAll().map((invoice) => this.normalizeInvoice(invoice));
  }

  getById(id: string): Invoice | undefined {
    const invoice = this.collection.getById(id);
    return invoice ? this.normalizeInvoice(invoice) : undefined;
  }

  getByClient(clientId: string): Invoice[] {
    return this.collection.getAll().filter((invoice) => invoice.clientId === clientId);
  }

  getNextNumber(): string {
    const year = new Date().getFullYear();
    const count = this.collection
      .getAll()
      .filter((invoice) => invoice.invoiceNumber.startsWith(`KM-${year}`)).length + 1;
    return `KM-${year}-${count.toString().padStart(4, '0')}`;
  }

  create(invoice: Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>): Invoice {
    const packageSnapshot = this.resolvePackageSnapshot(invoice.projectId, invoice.packageId);
    const created = this.collection.create({
      ...invoice,
      ...packageSnapshot,
      id: generateId(),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    });
    return this.normalizeInvoice(created);
  }

  update(id: string, updates: Partial<Invoice>): Invoice | null {
    const current = this.collection.getById(id);
    if (!current) return null;

    const nextProjectId = updates.projectId ?? current.projectId;
    const nextPackageId = updates.packageId ?? current.packageId;
    const packageSnapshot = this.resolvePackageSnapshot(nextProjectId, nextPackageId);

    const updated = this.collection.update(id, {
      ...updates,
      ...packageSnapshot,
      updatedAt: getTimestamp(),
    });

    return updated ? this.normalizeInvoice(updated) : null;
  }

  remove(id: string): boolean {
    return this.collection.remove(id);
  }

  seedIfMissing(seedData: Invoice[]): void {
    this.collection.seedIfMissing(seedData);
  }
}

export const invoiceService: InvoiceService = new LocalInvoiceService();

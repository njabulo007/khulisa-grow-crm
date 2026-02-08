import { Invoice } from '@/types/models';
import { getPackageById, resolvePackageId } from '@/config/packages';
import { FirestoreCollection, generateId, getTimestamp } from './storage';
import { projectService } from './projectService';

export interface InvoiceService {
  getAll: () => Promise<Invoice[]>;
  getById: (id: string) => Promise<Invoice | undefined>;
  getByClient: (clientId: string) => Promise<Invoice[]>;
  getNextNumber: () => Promise<string>;
  create: (invoice: Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Invoice>;
  update: (id: string, updates: Partial<Invoice>) => Promise<Invoice | null>;
  remove: (id: string) => Promise<boolean>;
  seedIfMissing: (seedData: Invoice[]) => Promise<void>;
}

class FirestoreInvoiceService implements InvoiceService {
  // TODO: Keep this service boundary stable and swap internals with richer Firestore queries as needed.
  private readonly collection = new FirestoreCollection<Invoice & { packageType?: string }>('invoices');

  private async resolvePackageSnapshot(
    projectId?: string,
    packageIdValue?: string
  ): Promise<{ packageId?: Invoice['packageId']; packageName?: Invoice['packageName']; packagePrice?: number }> {
    const project = projectId ? await projectService.getById(projectId) : undefined;
    const fromProject = project?.packageId;
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

  private async normalizeInvoice(invoice: Invoice & { packageType?: string }): Promise<Invoice> {
    const packageSnapshot = await this.resolvePackageSnapshot(
      invoice.projectId,
      invoice.packageId ?? invoice.packageType
    );

    return {
      ...invoice,
      ...packageSnapshot,
    };
  }

  async getAll(): Promise<Invoice[]> {
    const invoices = await this.collection.getAll();
    return Promise.all(invoices.map((invoice) => this.normalizeInvoice(invoice)));
  }

  async getById(id: string): Promise<Invoice | undefined> {
    const invoice = await this.collection.getById(id);
    return invoice ? this.normalizeInvoice(invoice) : undefined;
  }

  async getByClient(clientId: string): Promise<Invoice[]> {
    const invoices = await this.getAll();
    return invoices.filter((invoice) => invoice.clientId === clientId);
  }

  async getNextNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const invoices = await this.collection.getAll();
    const count = invoices
      .filter((invoice) => invoice.invoiceNumber.startsWith(`KM-${year}`)).length + 1;
    return `KM-${year}-${count.toString().padStart(4, '0')}`;
  }

  async create(invoice: Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>): Promise<Invoice> {
    const packageSnapshot = await this.resolvePackageSnapshot(invoice.projectId, invoice.packageId);
    const created = await this.collection.create({
      ...invoice,
      ...packageSnapshot,
      id: generateId(),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    });
    return this.normalizeInvoice(created);
  }

  async update(id: string, updates: Partial<Invoice>): Promise<Invoice | null> {
    const current = await this.collection.getById(id);
    if (!current) return null;

    const nextProjectId = updates.projectId ?? current.projectId;
    const nextPackageId = updates.packageId ?? current.packageId;
    const packageSnapshot = await this.resolvePackageSnapshot(nextProjectId, nextPackageId);

    const updated = await this.collection.update(id, {
      ...updates,
      ...packageSnapshot,
      updatedAt: getTimestamp(),
    });

    return updated ? this.normalizeInvoice(updated) : null;
  }

  async remove(id: string): Promise<boolean> {
    return this.collection.remove(id);
  }

  async seedIfMissing(seedData: Invoice[]): Promise<void> {
    await this.collection.seedIfMissing(seedData);
  }
}

export const invoiceService: InvoiceService = new FirestoreInvoiceService();

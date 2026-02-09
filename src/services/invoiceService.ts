import { Invoice } from '@/types/models';
import { getPackageById, resolvePackageId } from '@/config/packages';
import { resolveAgentIdForInvoice } from '@/lib/invoiceAgentResolver';
import { FirestoreCollection, generateId, getTimestamp } from './storage';
import { clientService } from './clientService';
import { leadService } from './leadService';
import { notificationService } from './notificationService';
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

  private async notifyInvoicePaid(nextInvoice: Invoice, previousStatus: Invoice['status'] | null): Promise<void> {
    if (nextInvoice.status !== 'paid') return;
    if (previousStatus === 'paid') return;

    const [projects, leads, clients] = await Promise.all([
      projectService.getAll(),
      leadService.getAll(),
      clientService.getAll(),
    ]);
    const agentId = resolveAgentIdForInvoice(nextInvoice, projects, leads, clients);
    if (!agentId) return;

    const existingNotifications = await notificationService.getForUser(agentId);
    if (
      existingNotifications.some(
        (entry) => entry.type === 'invoice_paid' && entry.invoiceId === nextInvoice.id
      )
    ) {
      return;
    }

    const clientName = clients.find((entry) => entry.id === nextInvoice.clientId)?.businessName || 'client';
    const packageName =
      nextInvoice.packageName ||
      getPackageById(nextInvoice.packageId)?.name ||
      (nextInvoice.projectId
        ? getPackageById(projects.find((entry) => entry.id === nextInvoice.projectId)?.packageId)?.name
        : undefined) ||
      'the selected package';

    await notificationService.createForUser(agentId, {
      type: 'invoice_paid',
      invoiceId: nextInvoice.id,
      clientId: nextInvoice.clientId,
      title: 'Client payment received',
      message: `Client ${clientName} has paid for ${packageName}. Your commission is now available.`,
    });
  }

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
    const normalized = await this.normalizeInvoice(created);
    await this.notifyInvoicePaid(normalized, null);
    return normalized;
  }

  async update(id: string, updates: Partial<Invoice>): Promise<Invoice | null> {
    const current = await this.collection.getById(id);
    if (!current) return null;
    const previousStatus = current.status;

    const nextProjectId = updates.projectId ?? current.projectId;
    const nextPackageId = updates.packageId ?? current.packageId;
    const packageSnapshot = await this.resolvePackageSnapshot(nextProjectId, nextPackageId);

    const updated = await this.collection.update(id, {
      ...updates,
      ...packageSnapshot,
      updatedAt: getTimestamp(),
    });

    if (!updated) return null;

    const normalized = await this.normalizeInvoice(updated);
    await this.notifyInvoicePaid(normalized, previousStatus);
    return normalized;
  }

  async remove(id: string): Promise<boolean> {
    return this.collection.remove(id);
  }

  async seedIfMissing(seedData: Invoice[]): Promise<void> {
    await this.collection.seedIfMissing(seedData);
  }
}

export const invoiceService: InvoiceService = new FirestoreInvoiceService();

import { Invoice, Payment } from '@/types/models';
import { getPackageById, resolvePackageId } from '@/config/packages';
import { resolveAgentIdForInvoice } from '@/lib/invoiceAgentResolver';
import { deriveInvoicePaymentSummary, InvoicePaymentSummary } from '@/lib/invoicePayments';
import { buildProjectLookup, getInvoiceEffectiveTotals } from '@/lib/invoiceTotals';
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
  getPaymentSummary: (invoiceId: string) => Promise<InvoicePaymentSummary | null>;
  refreshPaymentSummary: (invoiceId: string) => Promise<InvoicePaymentSummary | null>;
  create: (invoice: Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Invoice>;
  update: (id: string, updates: Partial<Invoice>) => Promise<Invoice | null>;
  remove: (id: string) => Promise<boolean>;
  seedIfMissing: (seedData: Invoice[]) => Promise<void>;
}

class FirestoreInvoiceService implements InvoiceService {
  private readonly collection = new FirestoreCollection<Invoice & { packageType?: string }>('invoices');
  private readonly paymentsCollection = new FirestoreCollection<Payment>('payments');

  private async notifyInvoicePaid(nextInvoice: Invoice, previousStatus: Invoice['status'] | null): Promise<void> {
    if (nextInvoice.status !== 'paid' || previousStatus === 'paid') return;

    const [projects, leads, clients] = await Promise.all([
      projectService.getAll(),
      leadService.getAll(),
      clientService.getAll(),
    ]);
    const agentId = resolveAgentIdForInvoice(nextInvoice, projects, leads, clients);
    if (!agentId) return;

    const existingNotifications = await notificationService.getForUser(agentId);
    if (existingNotifications.some((entry) => entry.type === 'invoice_paid' && entry.invoiceId === nextInvoice.id)) return;

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
    const rawPackageId = packageIdValue ?? project?.packageId;
    if (!rawPackageId) return {};
    const packageId = resolvePackageId(rawPackageId);
    const pkg = getPackageById(packageId);
    return { packageId, packageName: pkg?.name, packagePrice: pkg?.price };
  }

  private async normalizeInvoice(invoice: Invoice & { packageType?: string }): Promise<Invoice> {
    const packageSnapshot = await this.resolvePackageSnapshot(invoice.projectId, invoice.packageId ?? invoice.packageType);
    return { ...invoice, ...packageSnapshot };
  }

  private async getPaymentSummaryForInvoice(
    invoice: Invoice,
    projects?: Awaited<ReturnType<typeof projectService.getAll>>,
    payments?: Payment[],
  ): Promise<InvoicePaymentSummary> {
    const [resolvedProjects, resolvedPayments] = await Promise.all([
      projects ? Promise.resolve(projects) : projectService.getAll(),
      payments ? Promise.resolve(payments) : this.paymentsCollection.getAll(),
    ]);

    const totals = getInvoiceEffectiveTotals(invoice, buildProjectLookup(resolvedProjects));
    const amountPaid = resolvedPayments
      .filter((payment) => payment.invoiceId === invoice.id)
      .reduce((sum, payment) => sum + payment.amount, 0);

    return deriveInvoicePaymentSummary(invoice, totals.total, amountPaid, new Date());
  }

  async getPaymentSummary(invoiceId: string): Promise<InvoicePaymentSummary | null> {
    const invoice = await this.collection.getById(invoiceId);
    if (!invoice) return null;
    const normalized = await this.normalizeInvoice(invoice);
    return this.getPaymentSummaryForInvoice(normalized);
  }

  async refreshPaymentSummary(invoiceId: string): Promise<InvoicePaymentSummary | null> {
    const summary = await this.getPaymentSummary(invoiceId);
    if (!summary) return null;

    await this.update(invoiceId, {
      amountPaid: summary.amountPaid,
      status: summary.status,
    });

    return summary;
  }

  async getAll(): Promise<Invoice[]> {
    const [invoices, projects, payments] = await Promise.all([
      this.collection.getAll(),
      projectService.getAll(),
      this.paymentsCollection.getAll(),
    ]);

    const normalized = await Promise.all(invoices.map((invoice) => this.normalizeInvoice(invoice)));
    return Promise.all(
      normalized.map(async (invoice) => {
        const summary = await this.getPaymentSummaryForInvoice(invoice, projects, payments);
        return { ...invoice, amountPaid: summary.amountPaid, status: summary.status };
      })
    );
  }

  async getById(id: string): Promise<Invoice | undefined> {
    const invoice = await this.collection.getById(id);
    if (!invoice) return undefined;

    const normalized = await this.normalizeInvoice(invoice);
    const summary = await this.getPaymentSummaryForInvoice(normalized);
    return { ...normalized, amountPaid: summary.amountPaid, status: summary.status };
  }

  async getByClient(clientId: string): Promise<Invoice[]> {
    const invoices = await this.getAll();
    return invoices.filter((invoice) => invoice.clientId === clientId);
  }

  async getNextNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const invoices = await this.collection.getAll();
    const count = invoices.filter((invoice) => invoice.invoiceNumber.startsWith(`KM-${year}`)).length + 1;
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
    const summary = await this.getPaymentSummaryForInvoice(normalized);
    const withSummary = { ...normalized, amountPaid: summary.amountPaid, status: summary.status };
    await this.notifyInvoicePaid(withSummary, null);
    return withSummary;
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
    const summary = await this.getPaymentSummaryForInvoice(normalized);
    const withSummary = { ...normalized, amountPaid: summary.amountPaid, status: summary.status };
    await this.notifyInvoicePaid(withSummary, previousStatus);
    return withSummary;
  }

  async remove(id: string): Promise<boolean> {
    return this.collection.remove(id);
  }

  async seedIfMissing(seedData: Invoice[]): Promise<void> {
    await this.collection.seedIfMissing(seedData);
  }
}

export const invoiceService: InvoiceService = new FirestoreInvoiceService();

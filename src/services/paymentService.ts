import { Payment } from '@/types/models';
import { buildProjectLookup, getInvoiceEffectiveTotals } from '@/lib/invoiceTotals';
import { FirestoreCollection, generateId, getTimestamp } from './storage';
import { invoiceService } from './invoiceService';
import { projectService } from './projectService';

export interface PaymentService {
  getAll: () => Promise<Payment[]>;
  getById: (id: string) => Promise<Payment | undefined>;
  getByInvoice: (invoiceId: string) => Promise<Payment[]>;
  getByInvoiceId: (invoiceId: string) => Promise<Payment[]>;
  create: (payment: Omit<Payment, 'id' | 'createdAt'>) => Promise<Payment>;
  update: (id: string, updates: Partial<Payment>) => Promise<Payment | null>;
  remove: (id: string) => Promise<boolean>;
  seedIfMissing: (seedData: Payment[]) => Promise<void>;
}

class FirestorePaymentService implements PaymentService {
  // TODO: Keep this service boundary stable and swap internals with richer Firestore queries as needed.
  private readonly collection = new FirestoreCollection<Payment>('payments');

  async getAll(): Promise<Payment[]> {
    return this.collection.getAll();
  }

  async getById(id: string): Promise<Payment | undefined> {
    return this.collection.getById(id);
  }

  async getByInvoice(invoiceId: string): Promise<Payment[]> {
    const payments = await this.collection.getAll();
    return payments.filter((payment) => payment.invoiceId === invoiceId);
  }

  async getByInvoiceId(invoiceId: string): Promise<Payment[]> {
    return this.getByInvoice(invoiceId);
  }

  async create(payment: Omit<Payment, 'id' | 'createdAt'>): Promise<Payment> {
    const created = {
      ...payment,
      id: generateId(),
      createdAt: getTimestamp(),
    };
    const persisted = await this.collection.create(created);

    // Keep invoice payment fields in sync so paid transitions can trigger downstream rules/notifications.
    const invoice = await invoiceService.getById(payment.invoiceId);
    if (invoice) {
      const [paymentsForInvoice, allProjects] = await Promise.all([
        this.getByInvoice(payment.invoiceId),
        projectService.getAll(),
      ]);
      const amountPaid = paymentsForInvoice.reduce((sum, entry) => sum + entry.amount, 0);
      const totals = getInvoiceEffectiveTotals(invoice, buildProjectLookup(allProjects));
      const isFullyPaid = amountPaid >= totals.total;
      const nextStatus = isFullyPaid ? 'paid' : invoice.status;
      await invoiceService.update(invoice.id, {
        amountPaid,
        status: nextStatus,
      });
    }

    return persisted;
  }

  async update(id: string, updates: Partial<Payment>): Promise<Payment | null> {
    return this.collection.update(id, updates);
  }

  async remove(id: string): Promise<boolean> {
    return this.collection.remove(id);
  }

  async seedIfMissing(seedData: Payment[]): Promise<void> {
    await this.collection.seedIfMissing(seedData);
  }
}

export const paymentService: PaymentService = new FirestorePaymentService();

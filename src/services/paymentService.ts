import { Payment } from '@/types/models';
import { syncCommissionsFromInvoices } from './commissionRules';
import { FirestoreCollection, generateId, getTimestamp } from './storage';
import { invoiceService } from './invoiceService';

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
    await invoiceService.refreshPaymentSummary(payment.invoiceId);
    await syncCommissionsFromInvoices();
    return persisted;
  }

  async update(id: string, updates: Partial<Payment>): Promise<Payment | null> {
    const current = await this.getById(id);
    if (!current) return null;

    const updated = await this.collection.update(id, updates);
    if (!updated) return null;

    await invoiceService.refreshPaymentSummary(current.invoiceId);
    if (updated.invoiceId && updated.invoiceId !== current.invoiceId) {
      await invoiceService.refreshPaymentSummary(updated.invoiceId);
    }
    await syncCommissionsFromInvoices();

    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const current = await this.getById(id);
    if (!current) return false;

    const removed = await this.collection.remove(id);
    if (removed) {
      await invoiceService.refreshPaymentSummary(current.invoiceId);
      await syncCommissionsFromInvoices();
    }
    return removed;
  }

  async seedIfMissing(seedData: Payment[]): Promise<void> {
    await this.collection.seedIfMissing(seedData);
  }
}

export const paymentService: PaymentService = new FirestorePaymentService();


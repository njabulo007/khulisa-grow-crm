import { authenticatedPost } from './apiClient';
import { Payment } from '@/types/models';
import { assertValid, validatePayment } from '@/lib/domainValidation';
import { FirestoreCollection, generateId, getCurrentAuthRole, getTimestamp } from './storage';
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
  private readonly paymentAttempts = new Map<string, string>();
  private readonly collection = new FirestoreCollection<Payment>('payments');

  async getAll(): Promise<Payment[]> {
    if ((await getCurrentAuthRole()) === 'owner') return this.collection.getAll();
    const accessibleInvoices = await invoiceService.getAll();
    return (await Promise.all(accessibleInvoices.map(invoice => this.collection.getAllWhere('invoiceId', invoice.id)))).flat();
  }

  async getById(id: string): Promise<Payment | undefined> {
    return this.collection.getById(id);
  }

  async getByInvoice(invoiceId: string): Promise<Payment[]> {
    return this.collection.getAllWhere('invoiceId', invoiceId);
  }

  async getByInvoiceId(invoiceId: string): Promise<Payment[]> {
    return this.getByInvoice(invoiceId);
  }

  async create(payment: Omit<Payment, 'id' | 'createdAt'>): Promise<Payment> {
    assertValid(validatePayment(payment));
    const key = JSON.stringify(payment);
    const requestId = this.paymentAttempts.get(key) || crypto.randomUUID();
    this.paymentAttempts.set(key, requestId);
    const persisted = await authenticatedPost<Payment>('/api/notifications/push', { kind: 'workflow', action: 'payment', requestId, ...payment });
    this.paymentAttempts.delete(key);
    window.dispatchEvent(new CustomEvent('crm:data-changed'));
    return persisted;
  }

  async update(id: string, updates: Partial<Payment>): Promise<Payment | null> {
    const current = await this.getById(id);
    if (!current) return null;
    assertValid(validatePayment({ ...current, ...updates }));

    const updated = await this.collection.update(id, updates);
    if (!updated) return null;

    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const current = await this.getById(id);
    if (!current) return false;

    const removed = await this.collection.remove(id);
    return removed;
  }

  async seedIfMissing(seedData: Payment[]): Promise<void> {
    await this.collection.seedIfMissing(seedData);
  }
}

export const paymentService: PaymentService = new FirestorePaymentService();


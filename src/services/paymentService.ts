import { Payment } from '@/types/models';
import { FirestoreCollection, generateId, getTimestamp } from './storage';

export interface PaymentService {
  getAll: () => Promise<Payment[]>;
  getById: (id: string) => Promise<Payment | undefined>;
  getByInvoice: (invoiceId: string) => Promise<Payment[]>;
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

  async create(payment: Omit<Payment, 'id' | 'createdAt'>): Promise<Payment> {
    const created = {
      ...payment,
      id: generateId(),
      createdAt: getTimestamp(),
    };
    return this.collection.create(created);
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

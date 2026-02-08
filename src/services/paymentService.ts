import { Payment } from '@/types/models';
import { LocalStorageCollection, STORAGE_KEYS, generateId, getTimestamp } from './storage';

export interface PaymentService {
  getAll: () => Payment[];
  getById: (id: string) => Payment | undefined;
  getByInvoice: (invoiceId: string) => Payment[];
  create: (payment: Omit<Payment, 'id' | 'createdAt'>) => Payment;
  update: (id: string, updates: Partial<Payment>) => Payment | null;
  remove: (id: string) => boolean;
  seedIfMissing: (seedData: Payment[]) => void;
}

class LocalPaymentService implements PaymentService {
  // TODO: Replace LocalStorageCollection calls with Firestore collection/doc calls.
  // Keep the PaymentService method signatures unchanged to avoid UI-level refactors.
  private readonly collection = new LocalStorageCollection<Payment>(STORAGE_KEYS.payments);

  getAll(): Payment[] {
    return this.collection.getAll();
  }

  getById(id: string): Payment | undefined {
    return this.collection.getById(id);
  }

  getByInvoice(invoiceId: string): Payment[] {
    return this.collection.getAll().filter((payment) => payment.invoiceId === invoiceId);
  }

  create(payment: Omit<Payment, 'id' | 'createdAt'>): Payment {
    return this.collection.create({
      ...payment,
      id: generateId(),
      createdAt: getTimestamp(),
    });
  }

  update(id: string, updates: Partial<Payment>): Payment | null {
    return this.collection.update(id, updates);
  }

  remove(id: string): boolean {
    return this.collection.remove(id);
  }

  seedIfMissing(seedData: Payment[]): void {
    this.collection.seedIfMissing(seedData);
  }
}

export const paymentService: PaymentService = new LocalPaymentService();

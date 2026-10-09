import type { DeletionOptions } from '@/services/deletionService';
import { useCallback, useEffect, useState } from 'react';
import { invoiceService } from '@/services';
import { Invoice } from '@/types/models';

type InvoiceCreateInput = Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>;
type InvoiceUpdateInput = Partial<Invoice>;

export interface UseInvoicesResult {
  invoices: Invoice[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getById: (id: string) => Promise<Invoice | undefined>;
  getByClient: (clientId: string) => Promise<Invoice[]>;
  getNextNumber: () => Promise<string>;
  createInvoice: (invoice: InvoiceCreateInput) => Promise<Invoice>;
  updateInvoice: (id: string, updates: InvoiceUpdateInput) => Promise<Invoice | null>;
  removeInvoice: (id: string, options?: DeletionOptions) => Promise<boolean>;
}

export function useInvoices(): UseInvoicesResult {
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const next = await invoiceService.getAll();
      setInvoices(next);
      setError(null);
    } catch (error) {
      console.error('[useInvoices] Failed to load invoices.', error);
      setInvoices([]);
      setError('Unable to load invoices. Try again; if this continues, ask the owner to check your access.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const getById = useCallback((id: string) => invoiceService.getById(id), []);

  const getByClient = useCallback((clientId: string) => invoiceService.getByClient(clientId), []);

  const getNextNumber = useCallback(() => invoiceService.getNextNumber(), []);

  const createInvoice = useCallback(
    async (invoice: InvoiceCreateInput) => {
      const created = await invoiceService.create(invoice);
      await refresh();
      return created;
    },
    [refresh]
  );

  const updateInvoice = useCallback(
    async (id: string, updates: InvoiceUpdateInput) => {
      const updated = await invoiceService.update(id, updates);
      await refresh();
      return updated;
    },
    [refresh]
  );

  const removeInvoice = useCallback(
    async (id: string, options?: DeletionOptions) => {
      const removed = await invoiceService.remove(id, options);
      await refresh();
      return removed;
    },
    [refresh]
  );

  return {
    invoices,
    isLoading,
    error,
    refresh,
    getById,
    getByClient,
    getNextNumber,
    createInvoice,
    updateInvoice,
    removeInvoice,
  };
}

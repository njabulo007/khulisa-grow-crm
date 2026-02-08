import { useCallback, useState } from 'react';
import { invoiceService } from '@/services';
import { Invoice } from '@/types/models';

type InvoiceCreateInput = Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>;
type InvoiceUpdateInput = Partial<Invoice>;

export interface UseInvoicesResult {
  invoices: Invoice[];
  refresh: () => void;
  getById: (id: string) => Invoice | undefined;
  getByClient: (clientId: string) => Invoice[];
  getNextNumber: () => string;
  createInvoice: (invoice: InvoiceCreateInput) => Invoice;
  updateInvoice: (id: string, updates: InvoiceUpdateInput) => Invoice | null;
  removeInvoice: (id: string) => boolean;
}

export function useInvoices(): UseInvoicesResult {
  const [invoices, setInvoices] = useState<Invoice[]>(() => invoiceService.getAll());

  const refresh = useCallback(() => {
    setInvoices(invoiceService.getAll());
  }, []);

  const getById = useCallback((id: string) => invoiceService.getById(id), []);

  const getByClient = useCallback((clientId: string) => invoiceService.getByClient(clientId), []);

  const getNextNumber = useCallback(() => invoiceService.getNextNumber(), []);

  const createInvoice = useCallback(
    (invoice: InvoiceCreateInput) => {
      const created = invoiceService.create(invoice);
      refresh();
      return created;
    },
    [refresh]
  );

  const updateInvoice = useCallback(
    (id: string, updates: InvoiceUpdateInput) => {
      const updated = invoiceService.update(id, updates);
      refresh();
      return updated;
    },
    [refresh]
  );

  const removeInvoice = useCallback(
    (id: string) => {
      const removed = invoiceService.remove(id);
      refresh();
      return removed;
    },
    [refresh]
  );

  return {
    invoices,
    refresh,
    getById,
    getByClient,
    getNextNumber,
    createInvoice,
    updateInvoice,
    removeInvoice,
  };
}

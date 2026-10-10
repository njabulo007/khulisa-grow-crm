import { authenticatedPost } from './apiClient';

export interface PaymentFollowUp {
  id: string;
  invoiceId: string;
  clientId: string;
  followUpDate: string;
  notes: string;
  balance: number;
  invoiceNumber: string;
  clientName: string;
}

const request = <T>(action: string, payload = {}) => authenticatedPost<T>('/api/notifications/push', {
  kind: 'payment-follow-up', action, ...payload,
});

export const paymentFollowUpService = {
  list: (invoiceId?: string, all = false) => request<{ followUps: PaymentFollowUp[]; backgroundConfigured: boolean }>('list', { ...(invoiceId ? {invoiceId} : {}), ...(all ? {all} : {}) }),
  save: (invoiceId: string, followUpDate: string, notes: string) => request('save', { invoiceId, followUpDate, notes }),
  cancel: (invoiceId: string) => request('cancel', { invoiceId }),
  check: () => request<{ notified: number; stopped: number; failed: number }>('check'),
};

export const paymentFollowUpToday = () => new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);

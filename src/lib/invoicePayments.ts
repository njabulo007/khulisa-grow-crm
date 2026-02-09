import { Invoice, InvoiceStatus } from '@/types/models';

export interface InvoicePaymentSummary {
  total: number;
  amountPaid: number;
  balance: number;
  status: InvoiceStatus;
}

const roundCurrency = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const deriveInvoicePaymentSummary = (
  invoice: Pick<Invoice, 'status' | 'dueDate'>,
  total: number,
  amountPaid: number,
  now: Date = new Date(),
): InvoicePaymentSummary => {
  const normalizedTotal = roundCurrency(Math.max(total, 0));
  const normalizedAmountPaid = roundCurrency(Math.max(amountPaid, 0));
  const balance = roundCurrency(Math.max(normalizedTotal - normalizedAmountPaid, 0));

  const dueDate = new Date(invoice.dueDate);
  const isOverdue = dueDate.getTime() < now.getTime();

  const status: InvoiceStatus =
    balance <= 0
      ? 'paid'
      : normalizedAmountPaid > 0
        ? 'partially-paid'
        : invoice.status === 'draft'
          ? 'draft'
          : isOverdue
            ? 'overdue'
            : 'sent';

  return {
    total: normalizedTotal,
    amountPaid: normalizedAmountPaid,
    balance,
    status,
  };
};

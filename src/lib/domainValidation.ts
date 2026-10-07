import { LEAD_SOURCES, LEAD_STAGES, type Invoice, type Lead, type Payment } from '@/types/models';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const isValidDate = (value: string): boolean => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  // JavaScript silently rolls dates such as February 30 into March.
  return !/^\d{4}-\d{2}-\d{2}$/.test(value) || parsed.toISOString().slice(0, 10) === value;
};

const isValidEmail = (value: string): boolean =>
  !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const result = (errors: string[]): ValidationResult => ({ valid: errors.length === 0, errors });

export const validateLead = (lead: Partial<Lead>): ValidationResult => {
  const errors: string[] = [];
  if (lead.businessName !== undefined && (typeof lead.businessName !== 'string' || !lead.businessName.trim())) errors.push('Business name is required.');
  if (lead.contactName !== undefined && (typeof lead.contactName !== 'string' || !lead.contactName.trim())) errors.push('Contact name is required.');
  if (lead.email !== undefined && (typeof lead.email !== 'string' || !isValidEmail(lead.email.trim()))) errors.push('Lead email is invalid.');
  if (lead.phone !== undefined && (typeof lead.phone !== 'string' || lead.phone.trim().length > 50)) errors.push('Lead phone number is invalid or too long.');
  if (lead.estimatedValue !== undefined && (!Number.isFinite(lead.estimatedValue) || lead.estimatedValue < 0)) {
    errors.push('Estimated value must be a non-negative number.');
  }
  if (lead.followUpDate !== undefined && (typeof lead.followUpDate !== 'string' || (lead.followUpDate && !isValidDate(lead.followUpDate)))) errors.push('Follow-up date is invalid.');
  if (lead.assignedTo !== undefined && (typeof lead.assignedTo !== 'string' || !lead.assignedTo.trim())) errors.push('Lead assignee is required.');
  if (lead.stage !== undefined && !Object.prototype.hasOwnProperty.call(LEAD_STAGES, lead.stage)) errors.push('Lead stage is invalid.');
  if (lead.source !== undefined && !Object.prototype.hasOwnProperty.call(LEAD_SOURCES, lead.source)) errors.push('Lead source is invalid.');
  return result(errors);
};

export const validatePayment = (payment: Partial<Payment>): ValidationResult => {
  const errors: string[] = [];
  if (payment.invoiceId !== undefined && !payment.invoiceId.trim()) errors.push('Invoice is required for a payment.');
  if (payment.amount !== undefined && (!Number.isFinite(payment.amount) || payment.amount <= 0)) {
    errors.push('Payment amount must be greater than zero.');
  }
  if (payment.paidAt !== undefined && !isValidDate(payment.paidAt)) errors.push('Payment date is invalid.');
  return result(errors);
};

export const validateInvoice = (invoice: Partial<Invoice>): ValidationResult => {
  const errors: string[] = [];
  if (invoice.invoiceNumber !== undefined && !invoice.invoiceNumber.trim()) errors.push('Invoice number is required.');
  if (invoice.clientId !== undefined && !invoice.clientId.trim()) errors.push('Invoice client is required.');
  if (invoice.total !== undefined && (!Number.isFinite(invoice.total) || invoice.total < 0)) {
    errors.push('Invoice total must be a non-negative number.');
  }
  if (invoice.subtotal !== undefined && (!Number.isFinite(invoice.subtotal) || invoice.subtotal < 0)) {
    errors.push('Invoice subtotal must be a non-negative number.');
  }
  if (invoice.dueDate && !isValidDate(invoice.dueDate)) errors.push('Invoice due date is invalid.');
  if (invoice.issuedDate && !isValidDate(invoice.issuedDate)) errors.push('Invoice issue date is invalid.');
  if (invoice.items && invoice.items.some((item) => !item.description.trim() || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.total) || item.total < 0)) {
    errors.push('Invoice items must have valid descriptions, quantities, and totals.');
  }
  return result(errors);
};

export const assertValid = (validation: ValidationResult): void => {
  if (!validation.valid) throw new Error(validation.errors.join(' '));
};

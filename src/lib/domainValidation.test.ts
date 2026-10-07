import { describe, expect, it } from 'vitest';
import { validateInvoice, validateLead, validatePayment } from './domainValidation';

describe('domain validation', () => {
  it('accepts a valid lead', () => {
    expect(validateLead({
      businessName: 'Khulisa Foods',
      contactName: 'Amina Ndlovu',
      email: 'amina@example.com',
      phone: '+27 82 000 0000',
      assignedTo: 'agent-1',
      estimatedValue: 3500,
      followUpDate: '2026-10-05',
    })).toEqual({ valid: true, errors: [] });
  });

  it('rejects malformed lead values', () => {
    const validation = validateLead({
      businessName: '',
      contactName: '',
      email: 'not-an-email',
      estimatedValue: -1,
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toHaveLength(4);
  });

  it('uses the same strict email check for new/edited leads and accepts an empty optional email', () => {
    for (const email of ['invalid', 'client@@example.com', 'client@example.com extra']) {
      expect(validateLead({ email }).errors).toContain('Lead email is invalid.');
    }
    expect(validateLead({ email: '' }).valid).toBe(true);
    expect(validateLead({ email: ' client@example.com ' }).valid).toBe(true);
  });

  it('validates stage/source values and malformed legacy field types without crashing', () => {
    expect(validateLead({ stage: 'invalid' as never, source: '__proto__' as never }).valid).toBe(false);
    expect(validateLead({ email: null as never, contactName: 123 as never }).errors).toHaveLength(2);
    expect(validateLead({ stage: 'negotiation' }).valid).toBe(true);
  });

  it('rejects impossible follow-up dates instead of rolling them into the next month', () => {
    expect(validateLead({ followUpDate: '2026-02-30' }).valid).toBe(false);
    expect(validateLead({ followUpDate: '2026-02-28' }).valid).toBe(true);
    expect(validateLead({ followUpDate: '' }).valid).toBe(true);
  });

  it('rejects zero or negative payments', () => {
    expect(validatePayment({ invoiceId: 'invoice-1', amount: 0 }).valid).toBe(false);
    expect(validatePayment({ invoiceId: 'invoice-1', amount: -50 }).valid).toBe(false);
    expect(validatePayment({ invoiceId: 'invoice-1', amount: 500, paidAt: '2026-10-02' }).valid).toBe(true);
  });

  it('rejects invoice items without usable quantities or descriptions', () => {
    const validation = validateInvoice({
      invoiceNumber: 'KM-2026-0001',
      clientId: 'client-1',
      items: [{ id: 'item-1', description: '', quantity: 0, unitPrice: 100, total: -1 }],
      subtotal: 0,
      total: 0,
      dueDate: '2026-10-10',
      issuedDate: '2026-10-02',
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Invoice items must have valid descriptions, quantities, and totals.');
  });
});

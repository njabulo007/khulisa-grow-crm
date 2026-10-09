import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ role: vi.fn(), all: vi.fn(), query: vi.fn(), projects: vi.fn(), clients: vi.fn(), projectById: vi.fn() }));
vi.mock('./deletionService', () => ({ deleteCrmRecord: vi.fn() }));
vi.mock('./storage', () => ({
  getCurrentAuthRole: mocks.role, generateId: vi.fn(), getTimestamp: vi.fn(),
  FirestoreCollection: class {
    constructor(private name: string) {}
    getAll() { return mocks.all(this.name); }
    getAllWhere(field: string, value: string) { return mocks.query(this.name, field, value); }
    getAllWhereIn() { throw new Error('Mixed related-document query exceeds the access-call budget'); }
  },
}));
vi.mock('./projectService', () => ({ projectService: { getAll: mocks.projects, getById: mocks.projectById } }));
vi.mock('./clientService', () => ({ clientService: { getAll: mocks.clients } }));
vi.mock('./leadService', () => ({ leadService: {} }));
vi.mock('./notificationService', () => ({ notificationService: {} }));
import { invoiceService } from './invoiceService';
const invoice = { id: 'invoice', projectId: 'assigned-project', clientId: 'client', items: [{ total: 1500 }], subtotal: 1500, total: 1500, dueDate: '2099-01-01', status: 'sent', packageId: 'digital-starter-presence' };
beforeEach(() => {
  vi.clearAllMocks(); mocks.role.mockResolvedValue('agent');
  mocks.projects.mockResolvedValue([{ id: 'assigned-project', packageId: 'digital-starter-presence' }]);
  mocks.clients.mockResolvedValue([{ id: 'client' }]);
  mocks.projectById.mockRejectedValue({ code: 'permission-denied' });
  mocks.query.mockImplementation(async name => name === 'payments' ? [{ invoiceId: 'invoice', amount: 500 }] : [invoice]);
});
it('queries one authorized project/client/invoice at a time, deduplicates invoices and retains actual payments', async () => {
  const records = await invoiceService.getAll(); expect(records).toHaveLength(1);
  expect(records[0].amountPaid).toBe(500); expect(records[0].status).toBe('partially-paid');
  expect(mocks.query).toHaveBeenCalledWith('invoices', 'projectId', 'assigned-project');
  expect(mocks.query).toHaveBeenCalledWith('invoices', 'clientId', 'client');
  expect(mocks.query).toHaveBeenCalledWith('payments', 'invoiceId', 'invoice');
  expect(mocks.projectById).not.toHaveBeenCalled();
});
it('does not fetch an unassigned project when the invoice is accessible through its client', async () => {
  mocks.projects.mockResolvedValue([]);
  mocks.query.mockImplementation(async name => name === 'payments' ? [] : [{ ...invoice, projectId: 'another-agents-project', packageId: undefined }]);
  const records = await invoiceService.getAll(); expect(records).toHaveLength(1); expect(records[0].amountPaid).toBe(0);
  expect(mocks.projectById).not.toHaveBeenCalled();
});
it('retains owner collection reads and payment summary behavior', async () => {
  mocks.role.mockResolvedValue('owner'); mocks.all.mockImplementation(async name => name === 'payments' ? [{ invoiceId: 'invoice', amount: 1500 }] : [invoice]);
  const records = await invoiceService.getAll(); expect(records[0].status).toBe('paid');
  expect(mocks.clients).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled();
});
it('reports a genuine denied invoice request rather than returning an empty portfolio', async () => {
  const error = { code: 'permission-denied' }; mocks.query.mockRejectedValue(error);
  await expect(invoiceService.getAll()).rejects.toBe(error);
});

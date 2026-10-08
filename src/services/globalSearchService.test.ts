import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ leads: vi.fn(), clients: vi.fn(), projects: vi.fn(), invoices: vi.fn() }));
vi.mock('./leadService', () => ({ leadService: { getAll: mocks.leads } }));
vi.mock('./clientService', () => ({ clientService: { getAll: mocks.clients } }));
vi.mock('./projectService', () => ({ projectService: { getAll: mocks.projects } }));
vi.mock('./invoiceService', () => ({ invoiceService: { getAll: mocks.invoices } }));
import { loadGlobalSearchData } from './globalSearchService';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.leads.mockResolvedValue([{ id: 'lead' }]); mocks.clients.mockResolvedValue([{ id: 'client' }]);
  mocks.projects.mockResolvedValue([{ id: 'project' }]); mocks.invoices.mockResolvedValue([{ id: 'invoice' }]);
});
it('a denied client or invoice request does not reject the search load or discard accessible results', async () => {
  mocks.clients.mockRejectedValue({ code: 'permission-denied' }); mocks.invoices.mockRejectedValue({ code: 'permission-denied' });
  const result = await loadGlobalSearchData();
  expect(result.leads).toEqual([{ id: 'lead' }]); expect(result.projects).toEqual([{ id: 'project' }]);
  expect(result.clients).toEqual([]); expect(result.invoices).toEqual([]);
  expect(result.unavailable).toEqual(['Clients', 'Invoices']);
});
it('a retry replaces unavailable categories with newly accessible results', async () => {
  mocks.clients.mockRejectedValueOnce({ code: 'permission-denied' });
  expect((await loadGlobalSearchData()).unavailable).toEqual(['Clients']);
  const retry = await loadGlobalSearchData(); expect(retry.unavailable).toEqual([]); expect(retry.clients).toHaveLength(1);
});

import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ leads: vi.fn(), projects: vi.fn(), commissions: vi.fn(), client: vi.fn(), allClients: vi.fn() }));
vi.mock('./leadService', () => ({ leadService: { getAll: mocks.leads } }));
vi.mock('./projectService', () => ({ projectService: { getAll: mocks.projects } }));
vi.mock('./commissionService', () => ({ commissionService: { getAll: mocks.commissions } }));
vi.mock('./clientService', () => ({ clientService: { getById: mocks.client, getAll: mocks.allClients } }));
import { loadAgentDashboardData, agentDashboardErrorMessage } from './agentDashboardService';
const user = { id: 'legacy-agent', uid: 'agent-uid' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.leads.mockResolvedValue([{ id: 'lead', assignedTo: 'agent-uid' }, { id: 'private-lead', assignedTo: 'other' }]);
  mocks.projects.mockResolvedValue([{ id: 'project', assignedTo: 'legacy-agent', clientId: 'client' }, { id: 'second', assignedTo: 'agent-uid', clientId: 'client' }, { id: 'private-project', assignedTo: 'other', clientId: 'private-client' }]);
  mocks.commissions.mockResolvedValue([{ id: 'commission', agentId: 'legacy-agent', commissionAmount: 100 }, { id: 'private-commission', agentId: 'other' }]);
  mocks.client.mockResolvedValue({ id: 'client', businessName: 'Assigned client' });
});
it('loads only linked client documents, deduplicates reads and retains UID and signed-alias assignments', async () => {
  const result = await loadAgentDashboardData(user);
  expect(result.myLeads.map(record => record.id)).toEqual(['lead']);
  expect(result.myProjects.map(record => record.id)).toEqual(['project', 'second']);
  expect(result.myCommissions.map(record => record.id)).toEqual(['commission']);
  expect(result.clientsById).toEqual({ client: 'Assigned client' });
  expect(result.clientDetailsUnavailable).toBe(false);
  expect(mocks.client).toHaveBeenCalledExactlyOnceWith('client');
  expect(mocks.allClients).not.toHaveBeenCalled();
});
it('a denied client lookup does not discard loaded leads, projects or actual commission amounts', async () => {
  mocks.client.mockRejectedValue({ code: 'permission-denied' });
  const result = await loadAgentDashboardData(user);
  expect(result.myLeads).toHaveLength(1); expect(result.myProjects).toHaveLength(2);
  expect(result.myCommissions[0].commissionAmount).toBe(100);
  expect(result.clientDetailsUnavailable).toBe(true); expect(result.clientsById).toEqual({});
});
it('keeps accessible client names when another linked client is missing or denied', async () => {
  mocks.projects.mockResolvedValue([{ assignedTo: 'agent-uid', clientId: 'client' }, { assignedTo: 'agent-uid', clientId: 'missing' }]);
  mocks.client.mockImplementation(async id => id === 'client' ? { businessName: 'Assigned client' } : undefined);
  const result = await loadAgentDashboardData(user);
  expect(result.clientsById).toEqual({ client: 'Assigned client' }); expect(result.clientDetailsUnavailable).toBe(true);
});
it('does not replace denied core data with misleading empty statistics', async () => {
  const error = { code: 'permission-denied' }; mocks.commissions.mockRejectedValue(error);
  await expect(loadAgentDashboardData(user)).rejects.toBe(error);
  expect(mocks.client).not.toHaveBeenCalled();
  expect(agentDashboardErrorMessage(error)).toContain('Firestore rules');
});
it('an agent with no assigned projects needs no client access or collection query', async () => {
  mocks.projects.mockResolvedValue([]);
  const result = await loadAgentDashboardData(user);
  expect(result.clientDetailsUnavailable).toBe(false); expect(mocks.client).not.toHaveBeenCalled();
});
it('distinguishes access, session and index failures from connectivity errors', () => {
  expect(agentDashboardErrorMessage({ code: 'firestore/permission-denied' })).toContain('refresh your access');
  expect(agentDashboardErrorMessage({ code: 'failed-precondition' })).toContain('index');
  expect(agentDashboardErrorMessage(new Error('Your role could not be verified.'))).toContain('session');
  expect(agentDashboardErrorMessage({ code: 'unavailable' })).toContain('connection');
});

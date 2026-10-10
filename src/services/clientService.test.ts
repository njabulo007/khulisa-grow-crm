import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ role: vi.fn(), keys: vi.fn(), all: vi.fn(), query: vi.fn(), ids: vi.fn() }));
vi.mock('./deletionService', () => ({ deleteCrmRecord: vi.fn() }));
vi.mock('./storage', () => ({
  getCurrentAuthRole: mocks.role, getCurrentAuthKeys: mocks.keys, generateId: vi.fn(), getTimestamp: vi.fn(),
  FirestoreCollection: class {
    constructor(private name: string) {}
    getAll() { return mocks.all(this.name); }
    getAllWhereIn(field: string, values: string[]) { return mocks.query(this.name, field, values); }
    getById(id: string) { return mocks.ids(this.name, id); }
    getAllWhere(field: string, value: string) { return mocks.query(this.name, field, value); }
  },
}));
import { clientService } from './clientService';

describe('client visibility queries', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.keys.mockResolvedValue(['uid', 'legacy']); });
  it('returns every client for the owner regardless of who created or owns the linked records', async () => {
    mocks.role.mockResolvedValue('owner');
    mocks.all.mockResolvedValue([{ id: 'athi-client' }, { id: 'njabulo-client' }, { id: 'unassigned-client' }]);
    expect(await clientService.getAll()).toHaveLength(3);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.keys).not.toHaveBeenCalled();
  });
  it('returns only clients linked to assigned leads or projects, deduplicating shared links', async () => {
    mocks.role.mockResolvedValue('agent');
    mocks.query.mockImplementation(async (name) => name === 'leads' ? [{ id: 'lead' }] : name === 'projects' ? [{ id: 'project', clientId: 'shared' }, { id: 'second-project', clientId: 'project-client' }, { id: 'duplicate', clientId: 'shared' }] : [{ id: 'shared' }, { id: 'lead-client' }]);
    mocks.ids.mockImplementation(async (_name, id) => ({ id }));
    expect((await clientService.getAll()).map((client) => client.id)).toEqual(['shared', 'lead-client', 'project-client']);
    expect(mocks.query).toHaveBeenCalledWith('leads', 'assignedTo', ['uid', 'legacy']);
    expect(mocks.query).toHaveBeenCalledWith('projects', 'assignedTo', ['uid', 'legacy']);
    expect(mocks.query).toHaveBeenCalledWith('clients', 'leadId', 'lead');
    expect(mocks.ids).toHaveBeenCalledWith('clients', 'shared');
    expect(mocks.ids).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls.every((call) => call[1] !== 'createdBy')).toBe(true);
  });
  it('reports authentication failure instead of showing an incomplete agent-scoped owner list', async () => {
    mocks.role.mockRejectedValue(new Error('Session expired'));
    await expect(clientService.getAll()).rejects.toThrow('Session expired');
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

it('keeps related-document checks bounded with more than ten assigned leads and projects', async () => {
  mocks.role.mockResolvedValue('agent');
  const leads = Array.from({ length: 15 }, (_, i) => ({ id: `lead-${i}` }));
  const projects = Array.from({ length: 15 }, (_, i) => ({ id: `project-${i}`, clientId: `project-client-${i}` }));
  mocks.query.mockImplementation(async (name, field, value) => {
    if (name === 'leads') return leads;
    if (name === 'projects') return projects;
    expect(typeof value).toBe('string'); if (field === 'contactManagerId') return []; expect(field).toBe('leadId');
    return [{ id: `client-${value}` }];
  });
  mocks.ids.mockImplementation(async (_name, id) => ({ id }));
  expect(await clientService.getAll()).toHaveLength(30);
  expect(mocks.query.mock.calls.filter(([name, field]) => name === 'clients' && field === 'leadId')).toHaveLength(15);
  expect(mocks.ids).toHaveBeenCalledTimes(15);
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ role: vi.fn(), keys: vi.fn(), all: vi.fn(), query: vi.fn(), ids: vi.fn() }));
vi.mock('./deletionService', () => ({ deleteCrmRecord: vi.fn() }));
vi.mock('./storage', () => ({
  getCurrentAuthRole: mocks.role, getCurrentAuthKeys: mocks.keys, generateId: vi.fn(), getTimestamp: vi.fn(),
  FirestoreCollection: class {
    constructor(private name: string) {}
    getAll() { return mocks.all(this.name); }
    getAllWhereIn(field: string, values: string[]) { return mocks.query(this.name, field, values); }
    getByIds(values: string[]) { return mocks.ids(this.name, values); }
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
    mocks.query.mockImplementation(async (name) => name === 'leads' ? [{ id: 'lead' }] : name === 'projects' ? [{ id: 'project', clientId: 'shared' }] : [{ id: 'shared' }, { id: 'lead-client' }]);
    mocks.ids.mockResolvedValue([{ id: 'shared' }, { id: 'project-client' }]);
    expect((await clientService.getAll()).map((client) => client.id)).toEqual(['shared', 'lead-client', 'project-client']);
    expect(mocks.query).toHaveBeenCalledWith('leads', 'assignedTo', ['uid', 'legacy']);
    expect(mocks.query).toHaveBeenCalledWith('projects', 'assignedTo', ['uid', 'legacy']);
    expect(mocks.query.mock.calls.every((call) => call[1] !== 'createdBy')).toBe(true);
  });
  it('reports authentication failure instead of showing an incomplete agent-scoped owner list', async () => {
    mocks.role.mockRejectedValue(new Error('Session expired'));
    await expect(clientService.getAll()).rejects.toThrow('Session expired');
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

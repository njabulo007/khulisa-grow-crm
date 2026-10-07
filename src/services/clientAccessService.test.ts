import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ role: vi.fn(), query: vi.fn(), set: vi.fn(), update: vi.fn(), commit: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`,
  writeBatch: () => ({ set: mocks.set, update: mocks.update, commit: mocks.commit }),
}));
vi.mock('./storage', () => ({
  getCurrentAuthRole: mocks.role, getTimestamp: () => 'now', normalizeForFirestore: (value: unknown) => value,
  FirestoreCollection: class { getAllWhere(field: string, id: string) { return mocks.query(field, id); } },
}));
import { saveProjectWithClientAccess } from './clientAccessService';
import type { Project } from '@/types/models';

describe('project assignment with client access', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.role.mockResolvedValue('owner'); mocks.commit.mockResolvedValue(undefined); });
  it('moves the project and updates both clients in the same commit without replacing other project fields', async () => {
    const project = { id: 'moving', clientId: 'new-client', assignedTo: 'new-agent' } as Project;
    mocks.query.mockImplementation(async (_field, id) => id === 'old-client'
      ? [{ id: 'moving', assignedTo: 'old-agent' }, { id: 'remaining', assignedTo: 'old-agent' }]
      : [{ id: 'existing', assignedTo: 'another-agent' }]);
    const updates = { clientId: project.clientId, assignedTo: project.assignedTo };
    await saveProjectWithClientAccess(project, 'old-client', updates);
    expect(mocks.set).toHaveBeenCalledWith('projects/moving', updates, { merge: true });
    expect(mocks.update).toHaveBeenCalledWith('clients/old-client', { projectAccess: { 'old-agent': 'remaining' }, updatedAt: 'now' });
    expect(mocks.update).toHaveBeenCalledWith('clients/new-client', { projectAccess: { 'another-agent': 'existing', 'new-agent': 'moving' }, updatedAt: 'now' });
    expect(mocks.commit).toHaveBeenCalledTimes(1);
  });
  it('rejects agent attempts to change access grants', async () => {
    mocks.role.mockResolvedValue('agent');
    await expect(saveProjectWithClientAccess({} as Project)).rejects.toThrow('Only owners');
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it('propagates a failed atomic save so the UI cannot report success', async () => {
    mocks.query.mockResolvedValue([]);
    mocks.commit.mockRejectedValue(new Error('Permission denied'));
    await expect(saveProjectWithClientAccess({ id: 'p', clientId: 'c', assignedTo: 'agent' } as Project)).rejects.toThrow('Permission denied');
  });
});

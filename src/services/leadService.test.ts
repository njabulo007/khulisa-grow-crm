import { beforeEach, expect, it, vi } from 'vitest';
import type { Lead } from '@/types/models';

const mocks = vi.hoisted(() => ({ getById: vi.fn(), update: vi.fn(), create: vi.fn() }));
vi.mock('./storage', () => ({
  FirestoreCollection: class {
    getById = mocks.getById;
    update = mocks.update;
    create = mocks.create;
  },
  generateId: () => 'new-lead', getTimestamp: () => '2026-10-07T10:00:00.000Z',
  getCurrentAuthRole: vi.fn(), getCurrentAuthKeys: vi.fn(),
}));
vi.mock('./deletionService', () => ({ deleteCrmRecord: vi.fn() }));
vi.mock('./authService', () => ({ authService: { getById: vi.fn() } }));
vi.mock('./clientService', () => ({ clientService: {} }));
vi.mock('./projectService', () => ({ projectService: {} }));
vi.mock('./settingsService', () => ({ settingsService: {} }));
vi.mock('./notificationService', () => ({ notificationService: {} }));
import { leadService } from './leadService';

const oldLead: Lead = {
  id: 'lead-one', businessName: 'Business', contactName: 'Client', email: 'unknown',
  phone: '', source: 'referral', stage: 'won', assignedTo: 'agent', notes: '',
  estimatedValue: 1500, clientId: 'client-one', createdBy: 'agent', createdAt: '', updatedAt: '',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getById.mockResolvedValue(oldLead);
  mocks.update.mockImplementation(async (_id, patch) => ({ ...oldLead, ...patch }));
});

it.each(['new', 'contacted', 'proposal', 'negotiation', 'lost'] as const)(
  'allows moving a historical lead back to %s without changing its invalid stored email or client link', async stage => {
    const saved = await leadService.update(oldLead.id, { stage });
    expect(saved?.stage).toBe(stage);
    expect(saved?.email).toBe('unknown');
    expect(saved?.clientId).toBe('client-one');
    expect(mocks.update).toHaveBeenCalledWith(oldLead.id, { stage, updatedAt: expect.any(String) });
  },
);

it('allows notes updates on historical data, but rejects an explicitly supplied invalid email', async () => {
  await expect(leadService.update(oldLead.id, { notes: 'Follow up next week' })).resolves.toMatchObject({ notes: 'Follow up next week' });
  mocks.update.mockClear();
  await expect(leadService.update(oldLead.id, { email: 'bad@@example.com' })).rejects.toThrow('Lead email is invalid');
  expect(mocks.update).not.toHaveBeenCalled();
});

it('allows correcting or clearing the old email', async () => {
  await expect(leadService.update(oldLead.id, { email: 'client@example.com' })).resolves.toMatchObject({ email: 'client@example.com' });
  await expect(leadService.update(oldLead.id, { email: '' })).resolves.toMatchObject({ email: '' });
});

it('rejects malformed contact data on new leads before persisting', async () => {
  await expect(leadService.create({ ...oldLead, email: 'bad@@example.com', stage: 'new' })).rejects.toThrow('Lead email is invalid');
  expect(mocks.create).not.toHaveBeenCalled();
});

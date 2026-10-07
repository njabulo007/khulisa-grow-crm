import { beforeEach, expect, it, vi } from 'vitest';
import type { Lead } from '@/types/models';

vi.mock('./leadService', () => ({ leadService: { update: vi.fn() } }));
vi.mock('./leadConversionService', () => ({ leadConversionService: { convert: vi.fn() } }));
vi.mock('./activityService', () => ({ activityService: { create: vi.fn() } }));
import { leadService } from './leadService';
import { leadConversionService } from './leadConversionService';
import { activityService } from './activityService';
import { changeLeadStage, leadStageErrorMessage } from './leadStageService';

const lead = { id: 'lead-one', stage: 'negotiation' } as Lead;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(leadService.update).mockResolvedValue(lead);
});

it('uses server conversion for Won and preserves its actual error', async () => {
  const error = new Error('The linked client is missing.');
  vi.mocked(leadConversionService.convert).mockRejectedValue(error);
  await expect(changeLeadStage(lead, 'won', 'agent')).rejects.toBe(error);
  expect(leadStageErrorMessage(error)).toBe('The linked client is missing.');
  expect(leadService.update).not.toHaveBeenCalled();
  expect(activityService.create).not.toHaveBeenCalled();
});

it('does not report a failed status update when only activity logging fails', async () => {
  vi.mocked(activityService.create).mockRejectedValue(new Error('Activity permission denied'));
  await expect(changeLeadStage(lead, 'proposal', 'agent')).resolves.toEqual({ activitySaved: false });
  expect(leadService.update).toHaveBeenCalledWith('lead-one', { stage: 'proposal' });
});

it('does not create activity when the lead update fails or the lead was deleted', async () => {
  vi.mocked(leadService.update).mockResolvedValue(null);
  await expect(changeLeadStage(lead, 'proposal', 'agent')).rejects.toThrow('no longer exists');
  expect(activityService.create).not.toHaveBeenCalled();
  vi.mocked(leadService.update).mockRejectedValue(new Error('Write failed'));
  await expect(changeLeadStage(lead, 'proposal', 'agent')).rejects.toThrow('Write failed');
});

it('distinguishes Firebase permission failure from a connection failure', () => {
  expect(leadStageErrorMessage({ code: 'permission-denied' })).toContain('published Firestore rules');
  expect(leadStageErrorMessage({ code: 'unavailable' })).toContain('unreachable');
});

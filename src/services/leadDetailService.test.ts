import { expect, it, vi } from 'vitest';
vi.mock('./leadService', () => ({ leadService: { getById: vi.fn() } }));
vi.mock('./activityService', () => ({ activityService: { getByEntity: vi.fn() } }));
import { leadService } from './leadService';
import { activityService } from './activityService';
import { loadLeadDetail } from './leadDetailService';

it('keeps the lead accessible when only its activity query fails', async () => {
  vi.mocked(leadService.getById).mockResolvedValue({ id: 'lead-one' } as never);
  vi.mocked(activityService.getByEntity).mockRejectedValue(new Error('Missing index'));
  await expect(loadLeadDetail('lead-one')).resolves.toEqual({
    lead: { id: 'lead-one' }, activities: [], activityHistoryUnavailable: true,
  });
});

it('preserves a lead access failure instead of presenting it as a missing lead', async () => {
  const error = new Error('Permission denied');
  vi.mocked(leadService.getById).mockRejectedValue(error);
  vi.mocked(activityService.getByEntity).mockResolvedValue([]);
  await expect(loadLeadDetail('lead-one')).rejects.toBe(error);
});

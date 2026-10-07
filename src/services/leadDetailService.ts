import { activityService } from './activityService';
import { leadService } from './leadService';

export async function loadLeadDetail(id: string) {
  const [lead, activities] = await Promise.allSettled([
    leadService.getById(id), activityService.getByEntity('lead', id),
  ]);
  if (lead.status === 'rejected') throw lead.reason;
  if (activities.status === 'rejected') console.error('[LeadDetail] Activity history unavailable.', activities.reason);
  return {
    lead: lead.value,
    activities: activities.status === 'fulfilled' ? activities.value : [],
    activityHistoryUnavailable: activities.status === 'rejected',
  };
}

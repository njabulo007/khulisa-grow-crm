import { authenticatedPost } from './apiClient';

const request = (action: string, payload: object) => authenticatedPost('/api/notifications/push', {
  kind: 'lead-follow-up', action, ...payload,
});

export const leadFollowUpService = {
  save: (leadId: string, followUpDate: string) => request('save', { leadId, followUpDate }),
  complete: (leadId: string, type: string, description: string, nextFollowUpDate: string, requestId: string) =>
    request('complete', { leadId, type, description, nextFollowUpDate, requestId }),
};

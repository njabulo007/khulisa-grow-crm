import { Lead, LeadStage, LEAD_STAGES } from '@/types/models';
import { assertValid, validateLead } from '@/lib/domainValidation';
import { activityService } from './activityService';
import { leadConversionService } from './leadConversionService';
import { leadService } from './leadService';

export async function changeLeadStage(lead: Lead, stage: LeadStage, actorId: string) {
  assertValid(validateLead({ stage }));
  if (stage === 'won') {
    await leadConversionService.convert({ leadId: lead.id, createProject: false });
    return { activitySaved: true };
  }
  const saved = await leadService.update(lead.id, { stage });
  if (!saved) throw new Error('This lead no longer exists. Refresh the leads list.');
  try {
    await activityService.create({
      type: 'status-change', entityType: 'lead', entityId: lead.id,
      description: `Lead status changed from ${LEAD_STAGES[lead.stage].label} to ${LEAD_STAGES[stage].label}`,
      metadata: { from: lead.stage, to: stage }, createdBy: actorId,
    });
    return { activitySaved: true };
  } catch (error) {
    console.error('[LeadStage] Lead saved but activity logging failed.', error);
    return { activitySaved: false };
  }
}

export function leadStageErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'permission-denied' || code === 'firestore/permission-denied') {
    return 'Firebase denied this lead update. Check your account access and the published Firestore rules.';
  }
  if (code === 'unavailable' || code === 'firestore/unavailable') {
    return 'Firebase is currently unreachable. Check your connection and retry.';
  }
  return error instanceof Error ? error.message : 'Lead status could not be updated. Please retry.';
}

import { authenticatedPost } from './apiClient';
import type { PackageId } from '@/config/packages';

interface ConvertLeadPayload {
  leadId: string;
  createProject: boolean;
  projectName?: string;
  packageId?: PackageId;
  location?: string;
  industry?: string;
}

interface ConvertLeadResult {
  leadId: string;
  clientId: string;
  projectId?: string;
}

export const leadConversionService = {
  async convert(payload: ConvertLeadPayload): Promise<ConvertLeadResult> {
    return authenticatedPost<ConvertLeadResult>('/api/leads/convert', payload);
  },
};

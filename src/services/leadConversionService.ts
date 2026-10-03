import { functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
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
    const convertLead = httpsCallable<ConvertLeadPayload, ConvertLeadResult>(functions, 'convertLead');
    const result = await convertLead(payload);
    return result.data;
  },
};

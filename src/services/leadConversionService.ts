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
    try {
      const convertLead = httpsCallable<ConvertLeadPayload, ConvertLeadResult>(functions, 'convertLead');
      const result = await convertLead(payload);
      return result.data;
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      if (code === 'functions/not-found' || code === 'functions/unavailable' || code === 'functions/network-request-failed') {
        throw new Error('Lead conversion service is unavailable. Deploy the Firebase Functions and try again.');
      }
      if (code === 'functions/permission-denied') {
        throw new Error('You no longer have permission to convert this lead. Please sign in again.');
      }
      throw error;
    }
  },
};

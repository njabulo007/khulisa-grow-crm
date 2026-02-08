import { useCallback, useState } from 'react';
import { leadService } from '@/services';
import { Lead } from '@/types/models';

type LeadCreateInput = Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>;
type LeadUpdateInput = Partial<Lead>;

export interface UseLeadsResult {
  leads: Lead[];
  refresh: () => void;
  getById: (id: string) => Lead | undefined;
  getByAgent: (agentId: string) => Lead[];
  createLead: (lead: LeadCreateInput) => Lead;
  updateLead: (id: string, updates: LeadUpdateInput) => Lead | null;
  removeLead: (id: string) => boolean;
}

export function useLeads(): UseLeadsResult {
  const [leads, setLeads] = useState<Lead[]>(() => leadService.getAll());

  const refresh = useCallback(() => {
    setLeads(leadService.getAll());
  }, []);

  const getById = useCallback((id: string) => leadService.getById(id), []);

  const getByAgent = useCallback((agentId: string) => leadService.getByAgent(agentId), []);

  const createLead = useCallback(
    (lead: LeadCreateInput) => {
      const created = leadService.create(lead);
      refresh();
      return created;
    },
    [refresh]
  );

  const updateLead = useCallback(
    (id: string, updates: LeadUpdateInput) => {
      const updated = leadService.update(id, updates);
      refresh();
      return updated;
    },
    [refresh]
  );

  const removeLead = useCallback(
    (id: string) => {
      const removed = leadService.remove(id);
      refresh();
      return removed;
    },
    [refresh]
  );

  return {
    leads,
    refresh,
    getById,
    getByAgent,
    createLead,
    updateLead,
    removeLead,
  };
}

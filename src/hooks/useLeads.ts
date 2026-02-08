import { useCallback, useEffect, useState } from 'react';
import { leadService } from '@/services';
import { Lead } from '@/types/models';

type LeadCreateInput = Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>;
type LeadUpdateInput = Partial<Lead>;

export interface UseLeadsResult {
  leads: Lead[];
  isLoading: boolean;
  refresh: () => Promise<void>;
  getById: (id: string) => Promise<Lead | undefined>;
  getByAgent: (agentId: string) => Promise<Lead[]>;
  createLead: (lead: LeadCreateInput) => Promise<Lead>;
  updateLead: (id: string, updates: LeadUpdateInput) => Promise<Lead | null>;
  removeLead: (id: string) => Promise<boolean>;
}

export function useLeads(): UseLeadsResult {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const next = await leadService.getAll();
      setLeads(next);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const getById = useCallback((id: string) => leadService.getById(id), []);

  const getByAgent = useCallback((agentId: string) => leadService.getByAgent(agentId), []);

  const createLead = useCallback(
    async (lead: LeadCreateInput) => {
      const created = await leadService.create(lead);
      await refresh();
      return created;
    },
    [refresh]
  );

  const updateLead = useCallback(
    async (id: string, updates: LeadUpdateInput) => {
      const updated = await leadService.update(id, updates);
      await refresh();
      return updated;
    },
    [refresh]
  );

  const removeLead = useCallback(
    async (id: string) => {
      const removed = await leadService.remove(id);
      await refresh();
      return removed;
    },
    [refresh]
  );

  return {
    leads,
    isLoading,
    refresh,
    getById,
    getByAgent,
    createLead,
    updateLead,
    removeLead,
  };
}

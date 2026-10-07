import { useAuth } from '@/contexts/AuthContext';
import { useCallback, useEffect, useRef, useState } from 'react';
import { leadService } from '@/services';
import { Lead } from '@/types/models';

type LeadCreateInput = Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>;
type LeadUpdateInput = Partial<Lead>;

export interface UseLeadsResult {
  leads: Lead[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getById: (id: string) => Promise<Lead | undefined>;
  getByAgent: (agentId: string) => Promise<Lead[]>;
  createLead: (lead: LeadCreateInput) => Promise<Lead>;
  updateLead: (id: string, updates: LeadUpdateInput) => Promise<Lead | null>;
  removeLead: (id: string) => Promise<boolean>;
}

export function useLeads(): UseLeadsResult {
  const { user } = useAuth();
  const latestLoad = useRef(0);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const loadId = ++latestLoad.current;
    setIsLoading(true);
    try {
      const next = await leadService.getAll();
      if (loadId !== latestLoad.current) return;
      setLeads(next);
      setError(null);
    } catch (loadError) {
      if (loadId !== latestLoad.current) return;
      console.error('[useLeads] Failed to load leads.', loadError);
      setError('Unable to load leads. Check your connection and try again.');
    } finally {
      if (loadId === latestLoad.current) setIsLoading(false);
    }
  }, []);

  const invalidate = useCallback(() => { latestLoad.current++; }, []);

  useEffect(() => {
    setLeads([]);
    setError(null);
    void refresh();
    const handleFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('crm:data-changed', refresh);
    window.addEventListener('focus', handleFocus);
    return () => {
      invalidate();
      window.removeEventListener('crm:data-changed', refresh);
      window.removeEventListener('focus', handleFocus);
    };
  }, [refresh, invalidate, user?.uid, user?.id, user?.role]);

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
    error,
    refresh,
    getById,
    getByAgent,
    createLead,
    updateLead,
    removeLead,
  };
}

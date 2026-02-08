import { useCallback, useEffect, useState } from 'react';
import { commissionService } from '@/services';
import { Commission } from '@/types/models';

type CommissionCreateInput = Omit<Commission, 'id' | 'createdAt' | 'updatedAt'>;
type CommissionUpdateInput = Partial<Commission>;

export interface UseCommissionsResult {
  commissions: Commission[];
  isLoading: boolean;
  refresh: () => Promise<void>;
  getById: (id: string) => Promise<Commission | undefined>;
  getByAgent: (agentId: string) => Promise<Commission[]>;
  getByInvoice: (invoiceId: string) => Promise<Commission | undefined>;
  createCommission: (commission: CommissionCreateInput) => Promise<Commission>;
  updateCommission: (id: string, updates: CommissionUpdateInput) => Promise<Commission | null>;
  removeCommission: (id: string) => Promise<boolean>;
}

export function useCommissions(): UseCommissionsResult {
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const next = await commissionService.getAll();
      setCommissions(next);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const getById = useCallback((id: string) => commissionService.getById(id), []);

  const getByAgent = useCallback((agentId: string) => commissionService.getByAgent(agentId), []);

  const getByInvoice = useCallback((invoiceId: string) => commissionService.getByInvoice(invoiceId), []);

  const createCommission = useCallback(
    async (commission: CommissionCreateInput) => {
      const created = await commissionService.create(commission);
      await refresh();
      return created;
    },
    [refresh]
  );

  const updateCommission = useCallback(
    async (id: string, updates: CommissionUpdateInput) => {
      const updated = await commissionService.update(id, updates);
      await refresh();
      return updated;
    },
    [refresh]
  );

  const removeCommission = useCallback(
    async (id: string) => {
      const removed = await commissionService.remove(id);
      await refresh();
      return removed;
    },
    [refresh]
  );

  return {
    commissions,
    isLoading,
    refresh,
    getById,
    getByAgent,
    getByInvoice,
    createCommission,
    updateCommission,
    removeCommission,
  };
}

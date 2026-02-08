import { useCallback, useState } from 'react';
import { commissionService } from '@/services';
import { Commission } from '@/types/models';

type CommissionCreateInput = Omit<Commission, 'id' | 'createdAt' | 'updatedAt'>;
type CommissionUpdateInput = Partial<Commission>;

export interface UseCommissionsResult {
  commissions: Commission[];
  refresh: () => void;
  getById: (id: string) => Commission | undefined;
  getByAgent: (agentId: string) => Commission[];
  getByInvoice: (invoiceId: string) => Commission | undefined;
  createCommission: (commission: CommissionCreateInput) => Commission;
  updateCommission: (id: string, updates: CommissionUpdateInput) => Commission | null;
  removeCommission: (id: string) => boolean;
}

export function useCommissions(): UseCommissionsResult {
  const [commissions, setCommissions] = useState<Commission[]>(() => commissionService.getAll());

  const refresh = useCallback(() => {
    setCommissions(commissionService.getAll());
  }, []);

  const getById = useCallback((id: string) => commissionService.getById(id), []);

  const getByAgent = useCallback((agentId: string) => commissionService.getByAgent(agentId), []);

  const getByInvoice = useCallback((invoiceId: string) => commissionService.getByInvoice(invoiceId), []);

  const createCommission = useCallback(
    (commission: CommissionCreateInput) => {
      const created = commissionService.create(commission);
      refresh();
      return created;
    },
    [refresh]
  );

  const updateCommission = useCallback(
    (id: string, updates: CommissionUpdateInput) => {
      const updated = commissionService.update(id, updates);
      refresh();
      return updated;
    },
    [refresh]
  );

  const removeCommission = useCallback(
    (id: string) => {
      const removed = commissionService.remove(id);
      refresh();
      return removed;
    },
    [refresh]
  );

  return {
    commissions,
    refresh,
    getById,
    getByAgent,
    getByInvoice,
    createCommission,
    updateCommission,
    removeCommission,
  };
}

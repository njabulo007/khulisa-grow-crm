import { useCallback, useEffect, useState } from 'react';
import { clientService } from '@/services';
import { Client } from '@/types/models';

type ClientCreateInput = Omit<Client, 'id' | 'createdAt' | 'updatedAt'>;
type ClientUpdateInput = Partial<Client>;

export interface UseClientsResult {
  clients: Client[];
  isLoading: boolean;
  refresh: () => Promise<void>;
  getById: (id: string) => Promise<Client | undefined>;
  createClient: (client: ClientCreateInput) => Promise<Client>;
  updateClient: (id: string, updates: ClientUpdateInput) => Promise<Client | null>;
  removeClient: (id: string) => Promise<boolean>;
}

export function useClients(): UseClientsResult {
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const next = await clientService.getAll();
      setClients(next);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const getById = useCallback((id: string) => clientService.getById(id), []);

  const createClient = useCallback(
    async (client: ClientCreateInput) => {
      const created = await clientService.create(client);
      await refresh();
      return created;
    },
    [refresh]
  );

  const updateClient = useCallback(
    async (id: string, updates: ClientUpdateInput) => {
      const updated = await clientService.update(id, updates);
      await refresh();
      return updated;
    },
    [refresh]
  );

  const removeClient = useCallback(
    async (id: string) => {
      const removed = await clientService.remove(id);
      await refresh();
      return removed;
    },
    [refresh]
  );

  return {
    clients,
    isLoading,
    refresh,
    getById,
    createClient,
    updateClient,
    removeClient,
  };
}

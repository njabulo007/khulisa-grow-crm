import { useCallback, useState } from 'react';
import { clientService } from '@/services';
import { Client } from '@/types/models';

type ClientCreateInput = Omit<Client, 'id' | 'createdAt' | 'updatedAt'>;
type ClientUpdateInput = Partial<Client>;

export interface UseClientsResult {
  clients: Client[];
  refresh: () => void;
  getById: (id: string) => Client | undefined;
  createClient: (client: ClientCreateInput) => Client;
  updateClient: (id: string, updates: ClientUpdateInput) => Client | null;
  removeClient: (id: string) => boolean;
}

export function useClients(): UseClientsResult {
  const [clients, setClients] = useState<Client[]>(() => clientService.getAll());

  const refresh = useCallback(() => {
    setClients(clientService.getAll());
  }, []);

  const getById = useCallback((id: string) => clientService.getById(id), []);

  const createClient = useCallback(
    (client: ClientCreateInput) => {
      const created = clientService.create(client);
      refresh();
      return created;
    },
    [refresh]
  );

  const updateClient = useCallback(
    (id: string, updates: ClientUpdateInput) => {
      const updated = clientService.update(id, updates);
      refresh();
      return updated;
    },
    [refresh]
  );

  const removeClient = useCallback(
    (id: string) => {
      const removed = clientService.remove(id);
      refresh();
      return removed;
    },
    [refresh]
  );

  return {
    clients,
    refresh,
    getById,
    createClient,
    updateClient,
    removeClient,
  };
}

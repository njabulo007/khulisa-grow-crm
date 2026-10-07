import { useAuth } from '@/contexts/AuthContext';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clientService } from '@/services';
import { Client } from '@/types/models';

type ClientCreateInput = Omit<Client, 'id' | 'createdAt' | 'updatedAt'>;
type ClientUpdateInput = Partial<Client>;

export interface UseClientsResult {
  clients: Client[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getById: (id: string) => Promise<Client | undefined>;
  createClient: (client: ClientCreateInput) => Promise<Client>;
  updateClient: (id: string, updates: ClientUpdateInput) => Promise<Client | null>;
  removeClient: (id: string) => Promise<boolean>;
}

export function useClients(): UseClientsResult {
  const { user } = useAuth();
  const latestLoad = useRef(0);
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const loadId = ++latestLoad.current;
    setIsLoading(true);
    try {
      const next = await clientService.getAll();
      if (loadId !== latestLoad.current) return;
      setClients(next);
      setError(null);
    } catch (loadError) {
      if (loadId !== latestLoad.current) return;
      console.error('[useClients] Failed to load clients.', loadError);
      setError('Unable to load clients. Check your connection and try again.');
    } finally {
      if (loadId === latestLoad.current) setIsLoading(false);
    }
  }, []);

  const invalidate = useCallback(() => { latestLoad.current++; }, []);

  useEffect(() => {
    setClients([]);
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
    error,
    refresh,
    getById,
    createClient,
    updateClient,
    removeClient,
  };
}

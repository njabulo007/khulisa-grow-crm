import { authenticatedPost } from './apiClient';

export type DeletionOptions = { forceLinked?: boolean };
export async function deleteCrmRecord(type: 'lead' | 'client' | 'project' | 'invoice', id: string, options: DeletionOptions = {}): Promise<boolean> {
  const result = await authenticatedPost<{ removed: boolean }>('/api/records/delete', { type, id, ...options });
  if (result.removed !== true) throw new Error('The server did not confirm deletion. Refresh and retry.');
  window.dispatchEvent(new CustomEvent('crm:data-changed'));
  return true;
}

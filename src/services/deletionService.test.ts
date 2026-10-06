import { afterEach, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('./apiClient', () => ({ authenticatedPost: post }));
import { deleteCrmRecord } from './deletionService';

afterEach(() => vi.restoreAllMocks());

it('passes explicit financial consent to the API and refreshes the CRM only after confirmation', async () => {
  const event = vi.spyOn(window, 'dispatchEvent');
  post.mockResolvedValue({ removed: true });
  await expect(deleteCrmRecord('invoice', 'invoice-1', { forceLinked: true })).resolves.toBe(true);
  expect(post).toHaveBeenCalledWith('/api/records/delete', { type: 'invoice', id: 'invoice-1', forceLinked: true });
  expect(event).toHaveBeenCalledWith(expect.objectContaining({ type: 'crm:data-changed' }));
});

it('does not announce successful deletion when cleanup fails', async () => {
  const event = vi.spyOn(window, 'dispatchEvent');
  post.mockRejectedValue(new Error('Some portal files could not be deleted.'));
  await expect(deleteCrmRecord('project', 'project-1')).rejects.toThrow('portal files');
  expect(event).not.toHaveBeenCalled();
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ currentUser: { getIdToken: vi.fn() } }));
vi.mock('@/lib/firebase', () => ({ auth: session }));
import { authenticatedPost } from './apiClient';
import { leadConversionService } from './leadConversionService';
import { paymentFollowUpService } from './paymentFollowUpService';

describe('authenticated Vercel requests', () => {
  beforeEach(() => { session.currentUser.getIdToken.mockResolvedValue('signed-token'); });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('sends conversions to Vercel with the Firebase bearer token', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ clientId: 'client-1' }) });
    vi.stubGlobal('fetch', fetch);
    const payload = { leadId: 'lead-1', createProject: false };
    await expect(leadConversionService.convert(payload)).resolves.toEqual({ clientId: 'client-1' });
    expect(fetch).toHaveBeenCalledWith('/api/leads/convert', expect.objectContaining({
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer signed-token' },
      body: JSON.stringify(payload),
    }));
  });

  it('schedules a personal payment follow-up through the existing authenticated endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ followUp: { id: 'reminder' } }) });
    vi.stubGlobal('fetch', fetch);
    await paymentFollowUpService.save('invoice-one', '2026-10-09', '**Call** client');
    expect(fetch).toHaveBeenCalledWith('/api/notifications/push', expect.objectContaining({
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer signed-token' },
      body: JSON.stringify({ kind: 'payment-follow-up', action: 'save', invoiceId: 'invoice-one', followUpDate: '2026-10-09', notes: '**Call** client' }),
    }));
  });

  it('keeps server permission errors visible to the user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'You cannot convert this lead.' }) }));
    await expect(authenticatedPost('/api/leads/convert')).rejects.toThrow('You cannot convert this lead.');
  });

  it('identifies a missing API deployment when the SPA fallback returns HTML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError(); } }));
    await expect(authenticatedPost('/api/auth/ensure-role')).rejects.toThrow('Deploy the latest API routes');
  });
});

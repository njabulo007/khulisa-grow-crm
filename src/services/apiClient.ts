import { auth } from '@/lib/firebase';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');

export async function authenticatedPost<T>(path: string, payload: unknown = {}, currentUser = auth.currentUser): Promise<T> {
  if (!currentUser) throw new Error('Please sign in again.');
  const token = await currentUser.getIdToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload), signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(data?.error || 'The server request failed. Please retry.'), { status: response.status });
    if (!data || typeof data !== 'object') throw new Error('The CRM API is unavailable. Deploy the latest API routes to Vercel.');
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('The request timed out. Refresh to check the result, then retry if needed.');
    throw error;
  } finally { clearTimeout(timeout); }
}

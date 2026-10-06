import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getToken: vi.fn(), setDoc: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ app: {}, db: {} }));
vi.mock('firebase/messaging', () => ({ isSupported: async () => true, getMessaging: () => ({}), getToken: mocks.getToken }));
vi.mock('firebase/firestore', () => ({ doc: () => 'token-document', serverTimestamp: () => 'timestamp', setDoc: mocks.setDoc }));
import { pushService } from './pushService';

beforeEach(() => {
  vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'public-vapid-key');
  vi.stubGlobal('Notification', { permission: 'granted' });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('navigator', { userAgent: 'Android Chrome', serviceWorker: { getRegistration: async () => ({ scope: '/' }) } });
  mocks.getToken.mockResolvedValue('device-token'); mocks.setDoc.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('does not report registration merely because browser permission was granted', async () => {
  vi.stubEnv('VITE_FIREBASE_VAPID_KEY', '');
  await expect(pushService.registerForUser('agent', false)).resolves.toBe('missing-vapid-key');
  expect(mocks.getToken).not.toHaveBeenCalled();
});
it('registers the Android device token against the actual CRM recipient', async () => {
  await expect(pushService.registerForUser('agent', false)).resolves.toBe('registered');
  expect(mocks.getToken).toHaveBeenCalledWith({}, expect.objectContaining({ vapidKey: 'public-vapid-key' }));
  expect(mocks.setDoc).toHaveBeenCalledWith('token-document', expect.objectContaining({ userId: 'agent', token: 'device-token', platform: 'android' }), { merge: true });
});

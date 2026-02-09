import { app, db } from '@/lib/firebase';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';

type PushRegistrationResult =
  | 'registered'
  | 'unsupported'
  | 'permission-blocked'
  | 'permission-required'
  | 'missing-vapid-key'
  | 'token-unavailable'
  | 'error';

const PUSH_TOKENS_COLLECTION = 'push_tokens';

const sanitizeDocId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 500);

const getRuntimePlatform = (): string => {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
};

const ensureServiceWorkerReady = async (): Promise<ServiceWorkerRegistration | null> => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;

  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
};

class PushService {
  async registerForUser(userId: string, requestPermission: boolean): Promise<PushRegistrationResult> {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return 'unsupported';
    }

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
    if (!vapidKey || !vapidKey.trim()) {
      return 'missing-vapid-key';
    }

    const supported = await isSupported().catch(() => false);
    if (!supported) return 'unsupported';

    const permission = window.Notification.permission;
    if (permission === 'denied') return 'permission-blocked';
    if (permission === 'default' && !requestPermission) return 'permission-required';

    let nextPermission: NotificationPermission = permission;
    if (permission === 'default' && requestPermission) {
      nextPermission = await window.Notification.requestPermission();
      if (nextPermission !== 'granted') return 'permission-blocked';
    }

    if (nextPermission !== 'granted') return 'permission-required';

    try {
      const registration = await ensureServiceWorkerReady();
      if (!registration) return 'unsupported';

      const messaging = getMessaging(app);
      const token = await getToken(messaging, {
        vapidKey: vapidKey.trim(),
        serviceWorkerRegistration: registration,
      });

      if (!token) return 'token-unavailable';

      const docId = sanitizeDocId(token);
      await setDoc(
        doc(db, PUSH_TOKENS_COLLECTION, docId),
        {
          userId,
          token,
          permission: nextPermission,
          platform: getRuntimePlatform(),
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      return 'registered';
    } catch (error) {
      console.error('[PushService] Failed to register push token.', error);
      return 'error';
    }
  }
}

export const pushService = new PushService();
export type { PushRegistrationResult };

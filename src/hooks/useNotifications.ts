import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { notificationService } from '@/services';
import { pushService } from '@/services/pushService';
import type { PushRegistrationResult } from '@/services/pushService';
import { toast } from 'sonner';
import { Notification } from '@/types/notification';
import { paymentFollowUpService } from '@/services/paymentFollowUpService';

export type DesktopNotificationPermission = NotificationPermission | 'unsupported';

export interface UseNotificationsResult {
  notifications: Notification[];
  unreadCount: number;
  desktopPermission: DesktopNotificationPermission;
  pushStatus: PushRegistrationResult | null;
  requestDesktopPermission: () => Promise<DesktopNotificationPermission>;
  markAsRead: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

const getDesktopPermission = (): DesktopNotificationPermission => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return window.Notification.permission;
};

export function useNotifications(): UseNotificationsResult {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [desktopPermission, setDesktopPermission] = useState<DesktopNotificationPermission>(getDesktopPermission());
  const [pushStatus, setPushStatus] = useState<PushRegistrationResult | null>(null);

  useEffect(() => {
    let active = true;
    setPushStatus(null);
    if (user?.id) void pushService.registerForUser(user.id, false).then((status) => { if (active) setPushStatus(status); });
    return () => { active = false; };
  }, [user?.id]);
  useEffect(() => {
    if (!user?.id || pushStatus === null) return;
    let lastCheck = 0;
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 300_000) return;
      lastCheck = Date.now();
      void paymentFollowUpService.check().catch(error => console.error('[Payment follow-up] Due check failed.', error));
    };
    check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => { window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [user?.id, user?.uid, pushStatus]);
  const hasHydratedRef = useRef(false);
  const previousUnreadIdsRef = useRef<Set<string>>(new Set());
  const notificationAudioRef = useRef<HTMLAudioElement | null>(null);
  const userInteractedRef = useRef(false);
  const pendingSoundRef = useRef(false);

  const getNotificationAudio = useCallback(() => {
    if (typeof window === 'undefined') return null;
    if (!notificationAudioRef.current) {
      const audio = new Audio('/sounds/notification.wav');
      audio.preload = 'auto';
      audio.volume = 1;
      notificationAudioRef.current = audio;
    }
    return notificationAudioRef.current;
  }, []);

  const tryPlayNotificationSound = useCallback(() => {
    const audio = getNotificationAudio();
    if (!audio) return;
    audio.currentTime = 0;
    audio.muted = false;
    audio.volume = 1;
    void audio
      .play()
      .then(() => {
        pendingSoundRef.current = false;
      })
      .catch(() => {
        pendingSoundRef.current = true;
      });
  }, [getNotificationAudio]);

  const playNotificationSound = useCallback(() => {
    if (!userInteractedRef.current) {
      pendingSoundRef.current = true;
      return;
    }
    tryPlayNotificationSound();
  }, [tryPlayNotificationSound]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const onUserInteraction = () => {
      userInteractedRef.current = true;
      if (!pendingSoundRef.current) return;
      tryPlayNotificationSound();
    };

    window.addEventListener('pointerdown', onUserInteraction);
    window.addEventListener('keydown', onUserInteraction);
    window.addEventListener('touchstart', onUserInteraction);

    return () => {
      window.removeEventListener('pointerdown', onUserInteraction);
      window.removeEventListener('keydown', onUserInteraction);
      window.removeEventListener('touchstart', onUserInteraction);
    };
  }, [tryPlayNotificationSound]);

  useEffect(() => {
    const updatePermission = () => {
      setDesktopPermission(getDesktopPermission());
    };
    updatePermission();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', updatePermission);
      return () => {
        document.removeEventListener('visibilitychange', updatePermission);
      };
    }
    return undefined;
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setNotifications([]);
      hasHydratedRef.current = false;
      previousUnreadIdsRef.current = new Set();
      pendingSoundRef.current = false;
      return;
    }

    const unsubscribe = notificationService.subscribeForUser(user.id, (nextNotifications) => {
      const unreadIds = new Set(
        nextNotifications
          .filter((notification) => !notification.isRead)
          .map((notification) => notification.id)
      );
      const newlyUnread = nextNotifications.filter(
        (notification) => !notification.isRead && !previousUnreadIdsRef.current.has(notification.id)
      );

      if (hasHydratedRef.current) {
        if (newlyUnread.length > 0) {
          playNotificationSound();

          const permission = getDesktopPermission();
          setDesktopPermission(permission);
          if (permission === 'granted' && typeof window !== 'undefined' && 'Notification' in window) {
            newlyUnread.slice(0, 3).forEach((notification) => {
              try {
                const browserNotification = new window.Notification(notification.title, {
                  body: notification.message,
                  tag: `khulisa-notification-${notification.id}`,
                });

                browserNotification.onclick = () => {
                  window.focus();
                  if (notification.invoiceId) {
                    window.location.assign(`/invoices/${notification.invoiceId}`);
                    return;
                  }
                  if (notification.clientId) {
                    window.location.assign(`/clients/${encodeURIComponent(notification.clientId)}${notification.type === 'client_feedback' ? '#client-feedback' : notification.type === 'client_opportunity' ? '#client-growth' : notification.type === 'client_health' ? '#client-health' : notification.type === 'client_request' ? '#client-requests' : notification.type === 'client_follow_up' ? '#client-activity' : ''}`);
                    return;
                  }
                  if (notification.projectId) {
                    window.location.assign(`/projects/${notification.projectId}`);
                    return;
                  }
                  if (notification.leadId) {
                    window.location.assign(`/leads/${notification.leadId}`);
                  }
                };
              } catch {
                // Ignore browser notification failures.
              }
            });
          }
        }
      } else {
        hasHydratedRef.current = true;
      }

      previousUnreadIdsRef.current = unreadIds;
      setNotifications(nextNotifications);
    });

    return () => {
      unsubscribe();
    };
  }, [playNotificationSound, user?.id]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.isRead).length,
    [notifications]
  );

  const markAsRead = useCallback(async (id: string) => {
    await notificationService.markAsRead(id);
  }, []);

  const dismiss = useCallback(async (id: string) => {
    await notificationService.dismiss(id);
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!user?.id) return;
    await notificationService.markAllAsRead(user.id);
  }, [user?.id]);

  const requestDesktopPermission = useCallback(async (): Promise<DesktopNotificationPermission> => {
    const permission = getDesktopPermission();
    if (permission === 'unsupported') return permission;
    const nextPermission = permission === 'granted' ? permission : await window.Notification.requestPermission();
    setDesktopPermission(nextPermission);
    if (nextPermission === 'granted' && user?.id) {
      const status = await pushService.registerForUser(user.id, true);
      setPushStatus(status);
      if (status === 'registered') toast.success('Background push registration is active.');
      else if (status === 'missing-vapid-key') toast.error('Background push needs VITE_FIREBASE_VAPID_KEY in Vercel, followed by redeployment.');
      else toast.error(`Background push registration failed (${status}). Check notification permissions and retry.`);
    }
    return nextPermission;
  }, [user?.id]);

  return {
    notifications,
    unreadCount,
    desktopPermission,
    pushStatus,
    requestDesktopPermission,
    markAsRead,
    dismiss,
    markAllAsRead,
  };
}

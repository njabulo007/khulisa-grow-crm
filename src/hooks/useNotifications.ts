import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { notificationService } from '@/services';
import { Notification } from '@/types/notification';

export type DesktopNotificationPermission = NotificationPermission | 'unsupported';

export interface UseNotificationsResult {
  notifications: Notification[];
  unreadCount: number;
  desktopPermission: DesktopNotificationPermission;
  requestDesktopPermission: () => Promise<DesktopNotificationPermission>;
  markAsRead: (id: string) => Promise<void>;
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
  const hasHydratedRef = useRef(false);
  const previousUnreadIdsRef = useRef<Set<string>>(new Set());

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
          const audio = new Audio('/sounds/notification.mp3');
          void audio.play().catch(() => undefined);

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
  }, [user?.id]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.isRead).length,
    [notifications]
  );

  const markAsRead = useCallback(async (id: string) => {
    await notificationService.markAsRead(id);
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!user?.id) return;
    await notificationService.markAllAsRead(user.id);
  }, [user?.id]);

  const requestDesktopPermission = useCallback(async (): Promise<DesktopNotificationPermission> => {
    const permission = getDesktopPermission();
    if (permission === 'unsupported') return permission;
    if (permission === 'granted') return permission;

    const nextPermission = await window.Notification.requestPermission();
    setDesktopPermission(nextPermission);
    return nextPermission;
  }, []);

  return {
    notifications,
    unreadCount,
    desktopPermission,
    requestDesktopPermission,
    markAsRead,
    markAllAsRead,
  };
}

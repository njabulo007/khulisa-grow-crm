import { db } from '@/lib/firebase';
import { Notification } from '@/types/notification';
import {
  addDoc,
  collection,
  doc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

export interface NotificationService {
  getForUser: (userId: string) => Promise<Notification[]>;
  createForUser: (
    userId: string,
    data: Omit<Notification, 'id' | 'userId' | 'isRead' | 'createdAt'> & { dedupeKey?: string }
  ) => Promise<string>;
  markAsRead: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  markAllAsRead: (userId: string) => Promise<void>;
  subscribeForUser: (
    userId: string,
    callback: (notifications: Notification[]) => void
  ) => () => void;
}

const toDate = (value: unknown): Date => {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
};

const sortByCreatedAtDesc = (items: Notification[]): Notification[] =>
  [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

const dedupeNotifications = (items: Notification[]): Notification[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const isIdempotentEvent =
      item.type === 'lead_assigned' ||
      item.type === 'invoice_paid' ||
      item.type === 'invoice_due' ||
      item.type === 'lead_follow_up' ||
      item.type === 'project_deadline';
    if (!isIdempotentEvent) return true;

    const eventKey = [
      item.type,
      item.leadId || '',
      item.invoiceId || '',
      item.clientId || '',
      item.projectId || '',
      item.type === 'lead_follow_up' || item.type === 'project_deadline' ? item.message : '',
    ].join('|');
    if (seen.has(eventKey)) return false;
    seen.add(eventKey);
    return true;
  });
};

const getDedupeDocumentId = (userId: string, dedupeKey: string): string => {
  let hash = 2166136261;
  for (const character of `${userId}:${dedupeKey}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `dedupe_${(hash >>> 0).toString(16)}`;
};

class FirestoreNotificationService implements NotificationService {
  private readonly collectionRef = collection(db, 'notifications');

  private mapSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): Notification {
    const data = snapshot.data() as Record<string, unknown>;
    const type =
      data.type === 'invoice_paid' ||
      data.type === 'invoice_due' ||
      data.type === 'activity' ||
      data.type === 'project_deadline' ||
      data.type === 'lead_follow_up' ||
      data.type === 'chat'
        ? data.type
        : 'lead_assigned';
    return {
      id: snapshot.id,
      userId: String(data.userId || ''),
      type,
      leadId: typeof data.leadId === 'string' ? data.leadId : undefined,
      invoiceId: typeof data.invoiceId === 'string' ? data.invoiceId : undefined,
      clientId: typeof data.clientId === 'string' ? data.clientId : undefined,
      projectId: typeof data.projectId === 'string' ? data.projectId : undefined,
      title: String(data.title || ''),
      message: String(data.message || ''),
      isRead: Boolean(data.isRead),
      createdAt: toDate(data.createdAt),
    };
  }

  async getForUser(userId: string): Promise<Notification[]> {
    try {
      const notificationsQuery = query(
        this.collectionRef,
        where('userId', '==', userId),
      );
      const snapshot = await getDocs(notificationsQuery);
      return dedupeNotifications(sortByCreatedAtDesc(snapshot.docs.map((docSnapshot) => this.mapSnapshot(docSnapshot))));
    } catch (error) {
      console.error('[NotificationService] Failed to fetch notifications for user.', error);
      return [];
    }
  }

  async createForUser(
    userId: string,
    data: Omit<Notification, 'id' | 'userId' | 'isRead' | 'createdAt'> & { dedupeKey?: string }
  ): Promise<string> {
    const { dedupeKey, ...notificationData } = data;
    const payload = {
      userId,
      type: notificationData.type,
      leadId: notificationData.leadId || null,
      invoiceId: notificationData.invoiceId || null,
      clientId: notificationData.clientId || null,
      projectId: notificationData.projectId || null,
      title: notificationData.title,
      message: notificationData.message,
      isRead: false,
      createdAt: serverTimestamp(),
    };

    if (dedupeKey?.trim()) {
      const notificationRef = doc(this.collectionRef, getDedupeDocumentId(userId, dedupeKey));
      await setDoc(notificationRef, payload, { merge: true });
      return notificationRef.id;
    }

    const created = await addDoc(this.collectionRef, payload);
    return created.id;
  }

  async markAsRead(id: string): Promise<void> {
    await updateDoc(doc(this.collectionRef, id), { isRead: true });
  }

  async dismiss(id: string): Promise<void> {
    await deleteDoc(doc(this.collectionRef, id));
  }

  async markAllAsRead(userId: string): Promise<void> {
    const unreadQuery = query(
      this.collectionRef,
      where('userId', '==', userId),
    );
    const snapshot = await getDocs(unreadQuery);
    const unreadDocs = snapshot.docs.filter((docSnapshot) => docSnapshot.data().isRead !== true);
    if (unreadDocs.length === 0) return;

    const batch = writeBatch(db);
    unreadDocs.forEach((docSnapshot) => {
      batch.update(docSnapshot.ref, { isRead: true });
    });
    await batch.commit();
  }

  subscribeForUser(
    userId: string,
    callback: (notifications: Notification[]) => void
  ): () => void {
    const notificationsQuery = query(
      this.collectionRef,
      where('userId', '==', userId),
    );

    return onSnapshot(
      notificationsQuery,
      (snapshot) => {
        callback(dedupeNotifications(sortByCreatedAtDesc(snapshot.docs.map((docSnapshot) => this.mapSnapshot(docSnapshot)))));
      },
      (error) => {
        console.error('[NotificationService] Failed to subscribe to user notifications.', error);
        callback([]);
      }
    );
  }
}

// Notifications summary:
// - Collection: notifications
// - Shape: { userId, type, leadId?, invoiceId?, clientId?, projectId?, title, message, isRead, createdAt }
// - Current producers:
//   - lead assignment/reassignment events (type = lead_assigned)
//   - lead follow-up due/overdue events (type = lead_follow_up)
//   - project due/overdue events (type = project_deadline)
//   - invoice fully paid events for agents (type = invoice_paid)
//   - invoice due/overdue events for agents (type = invoice_due)
//   - activity and WhatsApp/chat events for relevant users (type = activity/chat)
export const notificationService: NotificationService = new FirestoreNotificationService();

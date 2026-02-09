import { db } from '@/lib/firebase';
import { Notification } from '@/types/notification';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
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
    data: Omit<Notification, 'id' | 'userId' | 'isRead' | 'createdAt'>
  ) => Promise<string>;
  markAsRead: (id: string) => Promise<void>;
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

class FirestoreNotificationService implements NotificationService {
  private readonly collectionRef = collection(db, 'notifications');

  private mapSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): Notification {
    const data = snapshot.data() as Record<string, unknown>;
    const type = data.type === 'invoice_paid' ? 'invoice_paid' : 'lead_assigned';
    return {
      id: snapshot.id,
      userId: String(data.userId || ''),
      type,
      leadId: typeof data.leadId === 'string' ? data.leadId : undefined,
      invoiceId: typeof data.invoiceId === 'string' ? data.invoiceId : undefined,
      clientId: typeof data.clientId === 'string' ? data.clientId : undefined,
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
        orderBy('createdAt', 'desc'),
      );
      const snapshot = await getDocs(notificationsQuery);
      return snapshot.docs.map((docSnapshot) => this.mapSnapshot(docSnapshot));
    } catch {
      return [];
    }
  }

  async createForUser(
    userId: string,
    data: Omit<Notification, 'id' | 'userId' | 'isRead' | 'createdAt'>
  ): Promise<string> {
    const created = await addDoc(this.collectionRef, {
      userId,
      type: data.type,
      leadId: data.leadId || null,
      invoiceId: data.invoiceId || null,
      clientId: data.clientId || null,
      title: data.title,
      message: data.message,
      isRead: false,
      createdAt: serverTimestamp(),
    });
    return created.id;
  }

  async markAsRead(id: string): Promise<void> {
    await updateDoc(doc(this.collectionRef, id), { isRead: true });
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
      orderBy('createdAt', 'desc'),
    );

    return onSnapshot(notificationsQuery, (snapshot) => {
      callback(snapshot.docs.map((docSnapshot) => this.mapSnapshot(docSnapshot)));
    }, () => {
      callback([]);
    });
  }
}

// Notifications summary:
// - Collection: notifications
// - Shape: { userId, type, leadId?, invoiceId?, clientId?, title, message, isRead, createdAt }
// - Current producers:
//   - lead assignment/reassignment events (type = lead_assigned)
//   - invoice fully paid events for agents (type = invoice_paid)
export const notificationService: NotificationService = new FirestoreNotificationService();

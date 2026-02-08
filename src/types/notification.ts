export type NotificationType = 'lead_assigned';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  leadId?: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: Date;
}

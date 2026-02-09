export type NotificationType = 'lead_assigned' | 'invoice_paid';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  leadId?: string;
  invoiceId?: string;
  clientId?: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: Date;
}

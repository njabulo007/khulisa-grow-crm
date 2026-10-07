export type NotificationType = 'lead_assigned' | 'invoice_paid' | 'invoice_due' | 'activity' | 'project_deadline' | 'lead_follow_up' | 'chat';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  leadId?: string;
  invoiceId?: string;
  clientId?: string;
  projectId?: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: Date;
  pushStatus?: string;
  pushErrorCodes?: string[];
  pushSentCount?: number;
  pushTargetCount?: number;
}

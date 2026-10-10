export type NotificationType = 'client_feedback' | 'client_opportunity' | 'client_health' | 'client_follow_up' | 'client_request' | 'lead_assigned' | 'invoice_paid' | 'invoice_due' | 'payment_follow_up' | 'activity' | 'project_deadline' | 'lead_follow_up' | 'chat';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  requestId?: string;
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

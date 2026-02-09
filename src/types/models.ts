// Khulisa CRM - Data Models
// Designed for easy Firebase/Firestore migration
import type { PackageId, PackageName } from '@/config/packages';

export type UserRole = 'owner' | 'agent';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive?: boolean;
  phone?: string;
  avatar?: string;
  commissionRate: number; // Default commission rate percentage
  createdAt: string;
  updatedAt: string;
}

export type LeadStage = 'new' | 'contacted' | 'proposal' | 'negotiation' | 'won' | 'lost';
export type LeadSource = 'facebook' | 'google' | 'referral' | 'walk-in' | 'other';

export interface Lead {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  source: LeadSource;
  stage: LeadStage;
  assignedTo: string; // User ID
  notes: string;
  followUpDate?: string;
  estimatedValue: number;
  clientId?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface Client {
  id: string;
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  location: string;
  industry: string;
  contractSigned: boolean;
  onboardingCompleted: boolean;
  leadId?: string; // Original lead ID if converted
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export type ProjectStatus = 'not-started' | 'in-progress' | 'completed' | 'on-hold' | 'waiting-client' | 'delivered';

export interface ProjectMilestone {
  id: string;
  title?: string;
  description?: string;
  isCompleted?: boolean;
  completedAt?: string;
  // Legacy fields retained for backwards compatibility while existing project docs normalize.
  name?: string;
  completed?: boolean;
}

export interface Project {
  id: string;
  name: string;
  clientId: string;
  packageId: PackageId;
  packageName?: PackageName;
  packagePrice?: number;
  status: ProjectStatus;
  milestones: ProjectMilestone[];
  dueDate: string;
  startDate: string;
  assignedTo: string;
  driveLink?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export type InvoiceStatus = 'draft' | 'sent' | 'partially-paid' | 'overdue' | 'paid';

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  clientId: string;
  projectId?: string;
  packageId?: PackageId;
  packageName?: PackageName;
  packagePrice?: number;
  items: InvoiceItem[];
  subtotal: number;
  tax?: number; // Legacy Firestore field; ignored in invoice totals.
  total: number;
  amountPaid: number;
  status: InvoiceStatus;
  dueDate: string;
  issuedDate: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export type PaymentMethod = 'eft' | 'cash' | 'card' | 'other';

export interface Payment {
  id: string;
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  reference: string;
  paidAt: string;
  createdAt: string;
  createdBy: string;
}

export type CommissionStatus = 'pending' | 'earned' | 'paid-out';

export interface Commission {
  id: string;
  agentId: string;
  invoiceId: string;
  projectId?: string;
  packageId: PackageId;
  packageName?: PackageName;
  packagePrice?: number;
  commissionAmount: number;
  rate: number; // Decimal (0.15 = 15%)
  status: CommissionStatus;
  earnedDate?: string;
  paidOutDate?: string;
  createdAt: string;
  updatedAt: string;
}

export type ActivityType = 'note' | 'call' | 'email' | 'whatsapp' | 'meeting' | 'status-change' | 'payment';

export interface Activity {
  id: string;
  type: ActivityType;
  entityType: 'lead' | 'client' | 'project' | 'invoice';
  entityId: string;
  description: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  createdBy: string;
}

// Lead stage display info
export const LEAD_STAGES: Record<LeadStage, { label: string; color: string }> = {
  new: { label: 'New', color: 'info' },
  contacted: { label: 'Contacted', color: 'primary' },
  proposal: { label: 'Proposal Sent', color: 'warning' },
  negotiation: { label: 'Negotiation', color: 'accent' },
  won: { label: 'Won', color: 'success' },
  lost: { label: 'Lost', color: 'destructive' },
};

export const LEAD_SOURCES: Record<LeadSource, string> = {
  facebook: 'Facebook',
  google: 'Google',
  referral: 'Referral',
  'walk-in': 'Walk-in',
  other: 'Other',
};

export const PROJECT_STATUSES: Record<ProjectStatus, { label: string; color: string }> = {
  'not-started': { label: 'Not Started', color: 'muted' },
  'in-progress': { label: 'In Progress', color: 'info' },
  completed: { label: 'Completed', color: 'success' },
  'on-hold': { label: 'On Hold', color: 'destructive' },
  'waiting-client': { label: 'In Progress', color: 'info' },
  delivered: { label: 'Completed', color: 'success' },
};

export const INVOICE_STATUSES: Record<InvoiceStatus, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'muted' },
  sent: { label: 'Sent', color: 'info' },
  'partially-paid': { label: 'Partially Paid', color: 'warning' },
  overdue: { label: 'Overdue', color: 'destructive' },
  paid: { label: 'Paid', color: 'success' },
};



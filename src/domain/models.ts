import type { PackageId, PackageName } from '@/config/packages';

export type EntityId = string;
export type ISODateString = string;

export interface DomainMetadata {
  [key: string]: unknown;
}

export enum UserRole {
  Owner = 'owner',
  Agent = 'agent',
}

export enum LeadSource {
  Facebook = 'Facebook',
  Google = 'Google',
  Referral = 'Referral',
  WalkIn = 'Walk-in',
  Other = 'Other',
}

export enum LeadStage {
  New = 'New',
  Contacted = 'Contacted',
  ProposalSent = 'Proposal Sent',
  Negotiation = 'Negotiation',
  Won = 'Won',
  Lost = 'Lost',
}

export enum ClientStatus {
  Prospect = 'Prospect',
  Onboarding = 'Onboarding',
  Contract = 'Contract',
}

export enum ProjectStatus {
  NotStarted = 'Not Started',
  InProgress = 'In Progress',
  WaitingOnClient = 'Waiting on Client',
  Delivered = 'Delivered',
  OnHold = 'On Hold',
}

export enum InvoiceStatus {
  Draft = 'Draft',
  Sent = 'Sent',
  Overdue = 'Overdue',
  Paid = 'Paid',
}

export enum CurrencyCode {
  ZAR = 'ZAR',
}

export enum PaymentMethod {
  EFT = 'EFT',
  Cash = 'Cash',
  Card = 'Card',
  Other = 'Other',
}

export enum CommissionStatus {
  Pending = 'Pending',
  Earned = 'Earned',
  PaidOut = 'Paid Out',
}

export enum ActivityEntityType {
  Lead = 'lead',
  Client = 'client',
  Project = 'project',
  Invoice = 'invoice',
  Payment = 'payment',
  Commission = 'commission',
  User = 'user',
}

export enum ActivityType {
  Note = 'Note',
  Call = 'Call',
  Email = 'Email',
  WhatsApp = 'WhatsApp',
  Meeting = 'Meeting',
  StatusChange = 'Status Change',
  Payment = 'Payment',
  System = 'System',
}

export interface User extends DomainMetadata {
  id: EntityId;
  name: string;
  role: UserRole;
  email: string;
  isActive?: boolean;
  avatarColor?: string;
}

export interface Lead extends DomainMetadata {
  id: EntityId;
  businessName: string;
  contactName: string;
  phone: string;
  email: string;
  source: LeadSource | string;
  estimatedValue: number;
  stage: LeadStage;
  ownerId: EntityId;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  followUpDate?: ISODateString;
  notes?: string;
  clientId?: EntityId;
}

export interface Client extends DomainMetadata {
  id: EntityId;
  businessName: string;
  industry: string;
  contactName: string;
  phone: string;
  email: string;
  locationCity: string;
  locationArea: string;
  status: ClientStatus;
  totalSpent: number;
  activeProjectsCount: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface ProjectChecklistItem extends DomainMetadata {
  id: EntityId;
  label: string;
  done: boolean;
}

export interface Project extends DomainMetadata {
  id: EntityId;
  clientId: EntityId;
  name: string;
  packageId: PackageId;
  packageName?: PackageName;
  packagePrice?: number;
  status: ProjectStatus;
  startDate: ISODateString;
  dueDate: ISODateString;
  assignedToId: EntityId;
  checklist: ProjectChecklistItem[];
}

export interface InvoiceLineItem extends DomainMetadata {
  id: EntityId;
  description: string;
  qty: number;
  unitPrice: number;
}

export interface Invoice extends DomainMetadata {
  id: EntityId;
  clientId: EntityId;
  projectId?: EntityId;
  packageId?: PackageId;
  packageName?: PackageName;
  packagePrice?: number;
  number: string;
  issueDate: ISODateString;
  dueDate: ISODateString;
  status: InvoiceStatus;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  total: number;
  amountPaid: number;
  currency: CurrencyCode;
}

export interface Payment extends DomainMetadata {
  id: EntityId;
  invoiceId: EntityId;
  amount: number;
  date: ISODateString;
  method: PaymentMethod | string;
  reference: string;
}

export interface Commission extends DomainMetadata {
  id: EntityId;
  agentId: EntityId;
  invoiceId: EntityId;
  packageId: PackageId;
  packageName?: PackageName;
  packagePrice?: number;
  commissionAmount: number;
  status: CommissionStatus;
  earnedDate?: ISODateString;
  paidOutDate?: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface Activity extends DomainMetadata {
  id: EntityId;
  entityType: ActivityEntityType;
  entityId: EntityId;
  type: ActivityType | string;
  message: string;
  createdAt: ISODateString;
  userId: EntityId;
}

export const DEFAULT_CURRENCY: CurrencyCode = CurrencyCode.ZAR;

export const USER_ROLES = Object.freeze(Object.values(UserRole));
export const LEAD_SOURCES = Object.freeze(Object.values(LeadSource));
export const LEAD_STAGES = Object.freeze(Object.values(LeadStage));
export const CLIENT_STATUSES = Object.freeze(Object.values(ClientStatus));
export const PROJECT_STATUSES = Object.freeze(Object.values(ProjectStatus));
export const INVOICE_STATUSES = Object.freeze(Object.values(InvoiceStatus));
export const PAYMENT_METHODS = Object.freeze(Object.values(PaymentMethod));
export const COMMISSION_STATUSES = Object.freeze(Object.values(CommissionStatus));
export const ACTIVITY_ENTITY_TYPES = Object.freeze(Object.values(ActivityEntityType));
export const ACTIVITY_TYPES = Object.freeze(Object.values(ActivityType));

const includesValue = (values: readonly string[], value: string): boolean => values.includes(value);

export const isUserRole = (value: string): value is UserRole => includesValue(USER_ROLES, value);
export const isLeadSource = (value: string): value is LeadSource => includesValue(LEAD_SOURCES, value);
export const isLeadStage = (value: string): value is LeadStage => includesValue(LEAD_STAGES, value);
export const isClientStatus = (value: string): value is ClientStatus => includesValue(CLIENT_STATUSES, value);
export const isProjectStatus = (value: string): value is ProjectStatus => includesValue(PROJECT_STATUSES, value);
export const isInvoiceStatus = (value: string): value is InvoiceStatus => includesValue(INVOICE_STATUSES, value);
export const isPaymentMethod = (value: string): value is PaymentMethod => includesValue(PAYMENT_METHODS, value);
export const isCommissionStatus = (value: string): value is CommissionStatus => includesValue(COMMISSION_STATUSES, value);
export const isActivityEntityType = (value: string): value is ActivityEntityType =>
  includesValue(ACTIVITY_ENTITY_TYPES, value);
export const isActivityType = (value: string): value is ActivityType => includesValue(ACTIVITY_TYPES, value);

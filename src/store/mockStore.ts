// Khulisa CRM - Compatibility Store
// Thin wrappers over service layer for legacy pages.

import {
  Activity,
  Client,
  Commission,
  Invoice,
  Lead,
  Payment,
  Project,
  User,
} from '@/types/models';
import {
  activityService,
  authService,
  clientService,
  commissionService,
  generateId,
  getTimestamp,
  invoiceService,
  leadService,
  paymentService,
  projectService,
  themeService,
} from '@/services';
import { seedAppData } from '@/seed';

export { generateId, getTimestamp };

export function initializeStore(): void {
  seedAppData();
}

export const userStore = {
  getAll: (): User[] => authService.getAll(),
  getById: (id: string): User | undefined => authService.getById(id),
  getCurrentUser: (): User | null => authService.getCurrentUser(),
  setCurrentUser: (userId: string): void => {
    authService.setCurrentUser(userId);
  },
  create: (user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): User => authService.create(user),
  update: (id: string, updates: Partial<User>): User | null => authService.update(id, updates),
};

export const leadStore = {
  getAll: (): Lead[] => leadService.getAll(),
  getById: (id: string): Lead | undefined => leadService.getById(id),
  getByAgent: (agentId: string): Lead[] => leadService.getByAgent(agentId),
  create: (lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>): Lead => leadService.create(lead),
  update: (id: string, updates: Partial<Lead>): Lead | null => leadService.update(id, updates),
  delete: (id: string): boolean => leadService.remove(id),
};

export const clientStore = {
  getAll: (): Client[] => clientService.getAll(),
  getById: (id: string): Client | undefined => clientService.getById(id),
  create: (client: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>): Client => clientService.create(client),
  update: (id: string, updates: Partial<Client>): Client | null => clientService.update(id, updates),
  delete: (id: string): boolean => clientService.remove(id),
};

export const projectStore = {
  getAll: (): Project[] => projectService.getAll(),
  getById: (id: string): Project | undefined => projectService.getById(id),
  getByClient: (clientId: string): Project[] => projectService.getByClient(clientId),
  getByAgent: (agentId: string): Project[] => projectService.getByAgent(agentId),
  create: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Project => projectService.create(project),
  update: (id: string, updates: Partial<Project>): Project | null => projectService.update(id, updates),
  delete: (id: string): boolean => projectService.remove(id),
};

export const invoiceStore = {
  getAll: (): Invoice[] => invoiceService.getAll(),
  getById: (id: string): Invoice | undefined => invoiceService.getById(id),
  getByClient: (clientId: string): Invoice[] => invoiceService.getByClient(clientId),
  create: (invoice: Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>): Invoice => invoiceService.create(invoice),
  update: (id: string, updates: Partial<Invoice>): Invoice | null => invoiceService.update(id, updates),
  delete: (id: string): boolean => invoiceService.remove(id),
  getNextNumber: (): string => invoiceService.getNextNumber(),
};

export const paymentStore = {
  getAll: (): Payment[] => paymentService.getAll(),
  getById: (id: string): Payment | undefined => paymentService.getById(id),
  getByInvoice: (invoiceId: string): Payment[] => paymentService.getByInvoice(invoiceId),
  create: (payment: Omit<Payment, 'id' | 'createdAt'>): Payment => paymentService.create(payment),
};

export const commissionStore = {
  getAll: (): Commission[] => commissionService.getAll(),
  getById: (id: string): Commission | undefined => commissionService.getById(id),
  getByAgent: (agentId: string): Commission[] => commissionService.getByAgent(agentId),
  getByInvoice: (invoiceId: string): Commission | undefined => commissionService.getByInvoice(invoiceId),
  create: (commission: Omit<Commission, 'id' | 'createdAt' | 'updatedAt'>): Commission =>
    commissionService.create(commission),
  update: (id: string, updates: Partial<Commission>): Commission | null => commissionService.update(id, updates),
};

export const activityStore = {
  getAll: (): Activity[] => activityService.getAll(),
  getByEntity: (entityType: string, entityId: string): Activity[] => activityService.getByEntity(entityType, entityId),
  create: (activity: Omit<Activity, 'id' | 'createdAt'>): Activity => activityService.create(activity),
};

export const themeStore = {
  get: (): 'light' | 'dark' => themeService.get(),
  set: (theme: 'light' | 'dark'): void => {
    themeService.set(theme);
  },
};

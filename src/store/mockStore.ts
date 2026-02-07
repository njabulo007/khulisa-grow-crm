// Khulisa CRM - Mock Data Store
// This simulates a database and will be replaced with Firebase Firestore

import {
  User,
  Lead,
  Client,
  Project,
  Invoice,
  Payment,
  Commission,
  Activity,
} from '@/types/models';

// Storage keys
const STORAGE_KEYS = {
  users: 'khulisa_users',
  leads: 'khulisa_leads',
  clients: 'khulisa_clients',
  projects: 'khulisa_projects',
  invoices: 'khulisa_invoices',
  payments: 'khulisa_payments',
  commissions: 'khulisa_commissions',
  activities: 'khulisa_activities',
  currentUser: 'khulisa_current_user',
  theme: 'khulisa_theme',
};

// Helper to generate IDs
export const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

// Helper to get current timestamp
export const getTimestamp = (): string => new Date().toISOString();

// Generic storage functions
function getFromStorage<T>(key: string): T[] {
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : [];
}

function saveToStorage<T>(key: string, data: T[]): void {
  localStorage.setItem(key, JSON.stringify(data));
}

// Initialize with seed data if empty
export function initializeStore(): void {
  if (!localStorage.getItem(STORAGE_KEYS.users)) {
    saveToStorage(STORAGE_KEYS.users, seedUsers);
    saveToStorage(STORAGE_KEYS.leads, seedLeads);
    saveToStorage(STORAGE_KEYS.clients, seedClients);
    saveToStorage(STORAGE_KEYS.projects, seedProjects);
    saveToStorage(STORAGE_KEYS.invoices, seedInvoices);
    saveToStorage(STORAGE_KEYS.payments, seedPayments);
    saveToStorage(STORAGE_KEYS.commissions, seedCommissions);
    saveToStorage(STORAGE_KEYS.activities, seedActivities);
    localStorage.setItem(STORAGE_KEYS.currentUser, seedUsers[0].id);
  }
}

// User store
export const userStore = {
  getAll: (): User[] => getFromStorage<User>(STORAGE_KEYS.users),
  getById: (id: string): User | undefined => 
    getFromStorage<User>(STORAGE_KEYS.users).find(u => u.id === id),
  getCurrentUser: (): User | null => {
    const userId = localStorage.getItem(STORAGE_KEYS.currentUser);
    return userId ? userStore.getById(userId) || null : null;
  },
  setCurrentUser: (userId: string): void => {
    localStorage.setItem(STORAGE_KEYS.currentUser, userId);
  },
  create: (user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): User => {
    const newUser: User = {
      ...user,
      id: generateId(),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    };
    const users = getFromStorage<User>(STORAGE_KEYS.users);
    users.push(newUser);
    saveToStorage(STORAGE_KEYS.users, users);
    return newUser;
  },
  update: (id: string, updates: Partial<User>): User | null => {
    const users = getFromStorage<User>(STORAGE_KEYS.users);
    const index = users.findIndex(u => u.id === id);
    if (index === -1) return null;
    users[index] = { ...users[index], ...updates, updatedAt: getTimestamp() };
    saveToStorage(STORAGE_KEYS.users, users);
    return users[index];
  },
};

// Lead store
export const leadStore = {
  getAll: (): Lead[] => getFromStorage<Lead>(STORAGE_KEYS.leads),
  getById: (id: string): Lead | undefined =>
    getFromStorage<Lead>(STORAGE_KEYS.leads).find(l => l.id === id),
  getByAgent: (agentId: string): Lead[] =>
    getFromStorage<Lead>(STORAGE_KEYS.leads).filter(l => l.assignedTo === agentId),
  create: (lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>): Lead => {
    const newLead: Lead = {
      ...lead,
      id: generateId(),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    };
    const leads = getFromStorage<Lead>(STORAGE_KEYS.leads);
    leads.push(newLead);
    saveToStorage(STORAGE_KEYS.leads, leads);
    return newLead;
  },
  update: (id: string, updates: Partial<Lead>): Lead | null => {
    const leads = getFromStorage<Lead>(STORAGE_KEYS.leads);
    const index = leads.findIndex(l => l.id === id);
    if (index === -1) return null;
    leads[index] = { ...leads[index], ...updates, updatedAt: getTimestamp() };
    saveToStorage(STORAGE_KEYS.leads, leads);
    return leads[index];
  },
  delete: (id: string): boolean => {
    const leads = getFromStorage<Lead>(STORAGE_KEYS.leads);
    const filtered = leads.filter(l => l.id !== id);
    if (filtered.length === leads.length) return false;
    saveToStorage(STORAGE_KEYS.leads, filtered);
    return true;
  },
};

// Client store
export const clientStore = {
  getAll: (): Client[] => getFromStorage<Client>(STORAGE_KEYS.clients),
  getById: (id: string): Client | undefined =>
    getFromStorage<Client>(STORAGE_KEYS.clients).find(c => c.id === id),
  create: (client: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>): Client => {
    const newClient: Client = {
      ...client,
      id: generateId(),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    };
    const clients = getFromStorage<Client>(STORAGE_KEYS.clients);
    clients.push(newClient);
    saveToStorage(STORAGE_KEYS.clients, clients);
    return newClient;
  },
  update: (id: string, updates: Partial<Client>): Client | null => {
    const clients = getFromStorage<Client>(STORAGE_KEYS.clients);
    const index = clients.findIndex(c => c.id === id);
    if (index === -1) return null;
    clients[index] = { ...clients[index], ...updates, updatedAt: getTimestamp() };
    saveToStorage(STORAGE_KEYS.clients, clients);
    return clients[index];
  },
  delete: (id: string): boolean => {
    const clients = getFromStorage<Client>(STORAGE_KEYS.clients);
    const filtered = clients.filter(c => c.id !== id);
    if (filtered.length === clients.length) return false;
    saveToStorage(STORAGE_KEYS.clients, filtered);
    return true;
  },
};

// Project store
export const projectStore = {
  getAll: (): Project[] => getFromStorage<Project>(STORAGE_KEYS.projects),
  getById: (id: string): Project | undefined =>
    getFromStorage<Project>(STORAGE_KEYS.projects).find(p => p.id === id),
  getByClient: (clientId: string): Project[] =>
    getFromStorage<Project>(STORAGE_KEYS.projects).filter(p => p.clientId === clientId),
  getByAgent: (agentId: string): Project[] =>
    getFromStorage<Project>(STORAGE_KEYS.projects).filter(p => p.assignedTo === agentId),
  create: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Project => {
    const newProject: Project = {
      ...project,
      id: generateId(),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    };
    const projects = getFromStorage<Project>(STORAGE_KEYS.projects);
    projects.push(newProject);
    saveToStorage(STORAGE_KEYS.projects, projects);
    return newProject;
  },
  update: (id: string, updates: Partial<Project>): Project | null => {
    const projects = getFromStorage<Project>(STORAGE_KEYS.projects);
    const index = projects.findIndex(p => p.id === id);
    if (index === -1) return null;
    projects[index] = { ...projects[index], ...updates, updatedAt: getTimestamp() };
    saveToStorage(STORAGE_KEYS.projects, projects);
    return projects[index];
  },
  delete: (id: string): boolean => {
    const projects = getFromStorage<Project>(STORAGE_KEYS.projects);
    const filtered = projects.filter(p => p.id !== id);
    if (filtered.length === projects.length) return false;
    saveToStorage(STORAGE_KEYS.projects, filtered);
    return true;
  },
};

// Invoice store
export const invoiceStore = {
  getAll: (): Invoice[] => getFromStorage<Invoice>(STORAGE_KEYS.invoices),
  getById: (id: string): Invoice | undefined =>
    getFromStorage<Invoice>(STORAGE_KEYS.invoices).find(i => i.id === id),
  getByClient: (clientId: string): Invoice[] =>
    getFromStorage<Invoice>(STORAGE_KEYS.invoices).filter(i => i.clientId === clientId),
  create: (invoice: Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>): Invoice => {
    const newInvoice: Invoice = {
      ...invoice,
      id: generateId(),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    };
    const invoices = getFromStorage<Invoice>(STORAGE_KEYS.invoices);
    invoices.push(newInvoice);
    saveToStorage(STORAGE_KEYS.invoices, invoices);
    return newInvoice;
  },
  update: (id: string, updates: Partial<Invoice>): Invoice | null => {
    const invoices = getFromStorage<Invoice>(STORAGE_KEYS.invoices);
    const index = invoices.findIndex(i => i.id === id);
    if (index === -1) return null;
    invoices[index] = { ...invoices[index], ...updates, updatedAt: getTimestamp() };
    saveToStorage(STORAGE_KEYS.invoices, invoices);
    return invoices[index];
  },
  delete: (id: string): boolean => {
    const invoices = getFromStorage<Invoice>(STORAGE_KEYS.invoices);
    const filtered = invoices.filter(i => i.id !== id);
    if (filtered.length === invoices.length) return false;
    saveToStorage(STORAGE_KEYS.invoices, filtered);
    return true;
  },
  getNextNumber: (): string => {
    const invoices = getFromStorage<Invoice>(STORAGE_KEYS.invoices);
    const year = new Date().getFullYear();
    const count = invoices.filter(i => i.invoiceNumber.startsWith(`KM-${year}`)).length + 1;
    return `KM-${year}-${count.toString().padStart(4, '0')}`;
  },
};

// Payment store
export const paymentStore = {
  getAll: (): Payment[] => getFromStorage<Payment>(STORAGE_KEYS.payments),
  getById: (id: string): Payment | undefined =>
    getFromStorage<Payment>(STORAGE_KEYS.payments).find(p => p.id === id),
  getByInvoice: (invoiceId: string): Payment[] =>
    getFromStorage<Payment>(STORAGE_KEYS.payments).filter(p => p.invoiceId === invoiceId),
  create: (payment: Omit<Payment, 'id' | 'createdAt'>): Payment => {
    const newPayment: Payment = {
      ...payment,
      id: generateId(),
      createdAt: getTimestamp(),
    };
    const payments = getFromStorage<Payment>(STORAGE_KEYS.payments);
    payments.push(newPayment);
    saveToStorage(STORAGE_KEYS.payments, payments);
    return newPayment;
  },
};

// Commission store
export const commissionStore = {
  getAll: (): Commission[] => getFromStorage<Commission>(STORAGE_KEYS.commissions),
  getById: (id: string): Commission | undefined =>
    getFromStorage<Commission>(STORAGE_KEYS.commissions).find(c => c.id === id),
  getByAgent: (agentId: string): Commission[] =>
    getFromStorage<Commission>(STORAGE_KEYS.commissions).filter(c => c.agentId === agentId),
  getByInvoice: (invoiceId: string): Commission | undefined =>
    getFromStorage<Commission>(STORAGE_KEYS.commissions).find(c => c.invoiceId === invoiceId),
  create: (commission: Omit<Commission, 'id' | 'createdAt' | 'updatedAt'>): Commission => {
    const newCommission: Commission = {
      ...commission,
      id: generateId(),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    };
    const commissions = getFromStorage<Commission>(STORAGE_KEYS.commissions);
    commissions.push(newCommission);
    saveToStorage(STORAGE_KEYS.commissions, commissions);
    return newCommission;
  },
  update: (id: string, updates: Partial<Commission>): Commission | null => {
    const commissions = getFromStorage<Commission>(STORAGE_KEYS.commissions);
    const index = commissions.findIndex(c => c.id === id);
    if (index === -1) return null;
    commissions[index] = { ...commissions[index], ...updates, updatedAt: getTimestamp() };
    saveToStorage(STORAGE_KEYS.commissions, commissions);
    return commissions[index];
  },
};

// Activity store (audit log)
export const activityStore = {
  getAll: (): Activity[] => getFromStorage<Activity>(STORAGE_KEYS.activities),
  getByEntity: (entityType: string, entityId: string): Activity[] =>
    getFromStorage<Activity>(STORAGE_KEYS.activities)
      .filter(a => a.entityType === entityType && a.entityId === entityId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  create: (activity: Omit<Activity, 'id' | 'createdAt'>): Activity => {
    const newActivity: Activity = {
      ...activity,
      id: generateId(),
      createdAt: getTimestamp(),
    };
    const activities = getFromStorage<Activity>(STORAGE_KEYS.activities);
    activities.push(newActivity);
    saveToStorage(STORAGE_KEYS.activities, activities);
    return newActivity;
  },
};

// Theme store
export const themeStore = {
  get: (): 'light' | 'dark' => {
    const theme = localStorage.getItem(STORAGE_KEYS.theme);
    return (theme as 'light' | 'dark') || 'light';
  },
  set: (theme: 'light' | 'dark'): void => {
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  },
};

// Seed data
const seedUsers: User[] = [
  {
    id: 'user_owner',
    email: 'owner@khulisa.co.za',
    name: 'Thabo Mokoena',
    role: 'owner',
    phone: '+27 82 123 4567',
    commissionRate: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'user_agent1',
    email: 'sipho@khulisa.co.za',
    name: 'Sipho Ndlovu',
    role: 'agent',
    phone: '+27 83 234 5678',
    commissionRate: 15,
    createdAt: '2024-01-15T00:00:00Z',
    updatedAt: '2024-01-15T00:00:00Z',
  },
  {
    id: 'user_agent2',
    email: 'naledi@khulisa.co.za',
    name: 'Naledi Dlamini',
    role: 'agent',
    phone: '+27 84 345 6789',
    commissionRate: 12,
    createdAt: '2024-02-01T00:00:00Z',
    updatedAt: '2024-02-01T00:00:00Z',
  },
];

const seedLeads: Lead[] = [
  {
    id: 'lead_1',
    businessName: 'Mama Joy Catering',
    contactName: 'Joy Mahlangu',
    email: 'joy@mamajoy.co.za',
    phone: '+27 71 111 2222',
    source: 'facebook',
    stage: 'new',
    assignedTo: 'user_agent1',
    notes: 'Interested in website and social media setup',
    followUpDate: '2026-02-10',
    estimatedValue: 8500,
    createdAt: '2026-02-01T10:00:00Z',
    updatedAt: '2026-02-01T10:00:00Z',
    createdBy: 'user_agent1',
  },
  {
    id: 'lead_2',
    businessName: 'Bongani Auto Repairs',
    contactName: 'Bongani Zulu',
    email: 'bongani@autofixza.co.za',
    phone: '+27 72 222 3333',
    source: 'google',
    stage: 'contacted',
    assignedTo: 'user_agent1',
    notes: 'Needs Google My Business and basic website',
    followUpDate: '2026-02-08',
    estimatedValue: 5500,
    createdAt: '2026-01-28T14:00:00Z',
    updatedAt: '2026-02-02T09:00:00Z',
    createdBy: 'user_agent1',
  },
  {
    id: 'lead_3',
    businessName: 'Thembi Fashion Boutique',
    contactName: 'Thembi Khumalo',
    email: 'thembi@thembifashion.co.za',
    phone: '+27 73 333 4444',
    source: 'referral',
    stage: 'proposal',
    assignedTo: 'user_agent2',
    notes: 'E-commerce website with payment integration',
    followUpDate: '2026-02-07',
    estimatedValue: 18000,
    createdAt: '2026-01-20T11:00:00Z',
    updatedAt: '2026-02-03T15:00:00Z',
    createdBy: 'user_agent2',
  },
  {
    id: 'lead_4',
    businessName: 'Soweto Plumbing Services',
    contactName: 'David Molefe',
    email: 'david@sowetoplumbing.co.za',
    phone: '+27 74 444 5555',
    source: 'walk-in',
    stage: 'negotiation',
    assignedTo: 'user_agent1',
    notes: 'Interested in full package - website, GMB, ads',
    followUpDate: '2026-02-06',
    estimatedValue: 12000,
    createdAt: '2026-01-15T09:00:00Z',
    updatedAt: '2026-02-04T10:00:00Z',
    createdBy: 'user_owner',
  },
  {
    id: 'lead_5',
    businessName: 'Kasi Fresh Produce',
    contactName: 'Lindiwe Mthembu',
    email: 'lindiwe@kasifresh.co.za',
    phone: '+27 75 555 6666',
    source: 'facebook',
    stage: 'won',
    assignedTo: 'user_agent2',
    notes: 'Closed deal for website and social media management',
    estimatedValue: 9500,
    createdAt: '2026-01-10T08:00:00Z',
    updatedAt: '2026-01-25T16:00:00Z',
    createdBy: 'user_agent2',
  },
  {
    id: 'lead_6',
    businessName: 'Township Tours SA',
    contactName: 'Mandla Sithole',
    email: 'mandla@townshiptours.co.za',
    phone: '+27 76 666 7777',
    source: 'google',
    stage: 'lost',
    assignedTo: 'user_agent1',
    notes: 'Budget constraints - might revisit later',
    estimatedValue: 15000,
    createdAt: '2026-01-05T12:00:00Z',
    updatedAt: '2026-01-20T14:00:00Z',
    createdBy: 'user_agent1',
  },
];

const seedClients: Client[] = [
  {
    id: 'client_1',
    businessName: 'Kasi Fresh Produce',
    ownerName: 'Lindiwe Mthembu',
    email: 'lindiwe@kasifresh.co.za',
    phone: '+27 75 555 6666',
    location: 'Soweto, Johannesburg',
    industry: 'Food & Beverage',
    contractSigned: true,
    onboardingCompleted: true,
    leadId: 'lead_5',
    createdAt: '2026-01-25T16:00:00Z',
    updatedAt: '2026-01-30T10:00:00Z',
    createdBy: 'user_agent2',
  },
  {
    id: 'client_2',
    businessName: 'Mzansi Tech Solutions',
    ownerName: 'Kagiso Moabi',
    email: 'kagiso@mzansitech.co.za',
    phone: '+27 82 888 9999',
    location: 'Alexandra, Johannesburg',
    industry: 'Technology',
    contractSigned: true,
    onboardingCompleted: true,
    createdAt: '2025-12-01T09:00:00Z',
    updatedAt: '2026-01-15T11:00:00Z',
    createdBy: 'user_owner',
  },
  {
    id: 'client_3',
    businessName: 'Ubuntu Hair Salon',
    ownerName: 'Nomvula Cele',
    email: 'nomvula@ubuntuhair.co.za',
    phone: '+27 83 777 8888',
    location: 'Tembisa, Johannesburg',
    industry: 'Beauty & Personal Care',
    contractSigned: true,
    onboardingCompleted: false,
    createdAt: '2026-01-20T14:00:00Z',
    updatedAt: '2026-02-01T09:00:00Z',
    createdBy: 'user_agent1',
  },
];

const seedProjects: Project[] = [
  {
    id: 'project_1',
    name: 'Kasi Fresh - Website & Social',
    clientId: 'client_1',
    packageType: 'Basic Website',
    status: 'in-progress',
    milestones: [
      { id: 'm1', name: 'Design approval', completed: true, completedAt: '2026-01-28T10:00:00Z' },
      { id: 'm2', name: 'Website development', completed: true, completedAt: '2026-02-02T15:00:00Z' },
      { id: 'm3', name: 'Social media setup', completed: false },
      { id: 'm4', name: 'Content upload', completed: false },
      { id: 'm5', name: 'Final review', completed: false },
    ],
    dueDate: '2026-02-15',
    startDate: '2026-01-26',
    assignedTo: 'user_agent2',
    driveLink: 'https://drive.google.com/drive/folders/example1',
    notes: 'Client prefers green color scheme',
    createdAt: '2026-01-25T16:30:00Z',
    updatedAt: '2026-02-02T15:00:00Z',
    createdBy: 'user_agent2',
  },
  {
    id: 'project_2',
    name: 'Mzansi Tech - Monthly Retainer',
    clientId: 'client_2',
    packageType: 'Monthly Retainer',
    status: 'in-progress',
    milestones: [
      { id: 'm1', name: 'February social posts', completed: false },
      { id: 'm2', name: 'Website maintenance', completed: true, completedAt: '2026-02-01T12:00:00Z' },
      { id: 'm3', name: 'Analytics report', completed: false },
    ],
    dueDate: '2026-02-28',
    startDate: '2026-02-01',
    assignedTo: 'user_agent1',
    notes: 'Ongoing monthly retainer for social and website maintenance',
    createdAt: '2025-12-05T10:00:00Z',
    updatedAt: '2026-02-01T12:00:00Z',
    createdBy: 'user_owner',
  },
  {
    id: 'project_3',
    name: 'Ubuntu Hair - GMB & Ads Setup',
    clientId: 'client_3',
    packageType: 'Google My Business Setup',
    status: 'waiting-client',
    milestones: [
      { id: 'm1', name: 'GMB verification', completed: true, completedAt: '2026-01-25T11:00:00Z' },
      { id: 'm2', name: 'Photo shoot', completed: false },
      { id: 'm3', name: 'GMB optimization', completed: false },
      { id: 'm4', name: 'Google Ads setup', completed: false },
    ],
    dueDate: '2026-02-20',
    startDate: '2026-01-22',
    assignedTo: 'user_agent1',
    notes: 'Waiting for client to provide photos',
    createdAt: '2026-01-20T14:30:00Z',
    updatedAt: '2026-02-03T09:00:00Z',
    createdBy: 'user_agent1',
  },
];

const seedInvoices: Invoice[] = [
  {
    id: 'invoice_1',
    invoiceNumber: 'KM-2026-0001',
    clientId: 'client_1',
    projectId: 'project_1',
    items: [
      { id: 'item1', description: 'Basic Website Design & Development', quantity: 1, unitPrice: 6500, total: 6500 },
      { id: 'item2', description: 'Social Media Setup (3 platforms)', quantity: 1, unitPrice: 3000, total: 3000 },
    ],
    subtotal: 9500,
    tax: 1425,
    total: 10925,
    amountPaid: 10925,
    status: 'paid',
    dueDate: '2026-02-10',
    issuedDate: '2026-01-25',
    createdAt: '2026-01-25T17:00:00Z',
    updatedAt: '2026-02-01T10:00:00Z',
    createdBy: 'user_agent2',
  },
  {
    id: 'invoice_2',
    invoiceNumber: 'KM-2026-0002',
    clientId: 'client_2',
    projectId: 'project_2',
    items: [
      { id: 'item1', description: 'Monthly Retainer - February 2026', quantity: 1, unitPrice: 5000, total: 5000 },
    ],
    subtotal: 5000,
    tax: 750,
    total: 5750,
    amountPaid: 0,
    status: 'sent',
    dueDate: '2026-02-15',
    issuedDate: '2026-02-01',
    createdAt: '2026-02-01T08:00:00Z',
    updatedAt: '2026-02-01T08:00:00Z',
    createdBy: 'user_owner',
  },
  {
    id: 'invoice_3',
    invoiceNumber: 'KM-2026-0003',
    clientId: 'client_3',
    projectId: 'project_3',
    items: [
      { id: 'item1', description: 'Google My Business Setup', quantity: 1, unitPrice: 2500, total: 2500 },
      { id: 'item2', description: 'Google Ads Setup & First Month', quantity: 1, unitPrice: 3500, total: 3500 },
    ],
    subtotal: 6000,
    tax: 900,
    total: 6900,
    amountPaid: 3450,
    status: 'sent',
    dueDate: '2026-02-05',
    issuedDate: '2026-01-22',
    notes: '50% deposit paid',
    createdAt: '2026-01-22T15:00:00Z',
    updatedAt: '2026-01-22T16:00:00Z',
    createdBy: 'user_agent1',
  },
];

const seedPayments: Payment[] = [
  {
    id: 'payment_1',
    invoiceId: 'invoice_1',
    amount: 10925,
    method: 'eft',
    reference: 'KASI-FRESH-001',
    paidAt: '2026-02-01T10:00:00Z',
    createdAt: '2026-02-01T10:00:00Z',
    createdBy: 'user_agent2',
  },
  {
    id: 'payment_2',
    invoiceId: 'invoice_3',
    amount: 3450,
    method: 'eft',
    reference: 'UBUNTU-DEP-001',
    paidAt: '2026-01-22T16:00:00Z',
    createdAt: '2026-01-22T16:00:00Z',
    createdBy: 'user_agent1',
  },
];

const seedCommissions: Commission[] = [
  {
    id: 'commission_1',
    agentId: 'user_agent2',
    invoiceId: 'invoice_1',
    projectId: 'project_1',
    amount: 1638.75, // 15% of 10925
    rate: 15,
    status: 'earned',
    createdAt: '2026-02-01T10:00:00Z',
    updatedAt: '2026-02-01T10:00:00Z',
  },
  {
    id: 'commission_2',
    agentId: 'user_agent1',
    invoiceId: 'invoice_3',
    projectId: 'project_3',
    amount: 1035, // 15% of 6900
    rate: 15,
    status: 'pending',
    createdAt: '2026-01-22T16:00:00Z',
    updatedAt: '2026-01-22T16:00:00Z',
  },
];

const seedActivities: Activity[] = [
  {
    id: 'activity_1',
    type: 'note',
    entityType: 'lead',
    entityId: 'lead_1',
    description: 'Initial contact via Facebook. Client interested in growing their catering business online.',
    createdAt: '2026-02-01T10:30:00Z',
    createdBy: 'user_agent1',
  },
  {
    id: 'activity_2',
    type: 'call',
    entityType: 'lead',
    entityId: 'lead_2',
    description: 'Discussed package options. Will send proposal.',
    createdAt: '2026-02-02T09:00:00Z',
    createdBy: 'user_agent1',
  },
  {
    id: 'activity_3',
    type: 'status-change',
    entityType: 'lead',
    entityId: 'lead_5',
    description: 'Lead status changed from Negotiation to Won',
    metadata: { from: 'negotiation', to: 'won' },
    createdAt: '2026-01-25T16:00:00Z',
    createdBy: 'user_agent2',
  },
  {
    id: 'activity_4',
    type: 'payment',
    entityType: 'invoice',
    entityId: 'invoice_1',
    description: 'Payment of R10,925.00 received via EFT',
    metadata: { amount: 10925, method: 'eft' },
    createdAt: '2026-02-01T10:00:00Z',
    createdBy: 'user_agent2',
  },
];

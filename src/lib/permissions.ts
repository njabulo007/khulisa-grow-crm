import { Client, Commission, Invoice, Lead, Project, User } from '@/types/models';

export const isOwnerUser = (user: User | null | undefined): boolean => user?.role === 'owner';
export const isAgentUser = (user: User | null | undefined): boolean => user?.role === 'agent';

export const getAgentLinkedClientIds = (
  userId: string,
  leads: Lead[],
  clients: Client[],
  projects: Project[]
): Set<string> => {
  const linkedLeadIds = new Set(leads.filter((lead) => lead.assignedTo === userId).map((lead) => lead.id));
  const clientIdsFromLeads = clients
    .filter((client) => client.leadId && linkedLeadIds.has(client.leadId))
    .map((client) => client.id);
  const clientIdsFromProjects = projects
    .filter((project) => project.assignedTo === userId)
    .map((project) => project.clientId);
  return new Set([...clientIdsFromLeads, ...clientIdsFromProjects]);
};

export const canAccessLead = (user: User | null | undefined, lead: Lead | null | undefined): boolean => {
  if (!user || !lead) return false;
  return isOwnerUser(user) || lead.assignedTo === user.id;
};

export const canAccessProject = (user: User | null | undefined, project: Project | null | undefined): boolean => {
  if (!user || !project) return false;
  return isOwnerUser(user) || project.assignedTo === user.id;
};

export const canAccessClient = (
  user: User | null | undefined,
  client: Client | null | undefined,
  leads: Lead[],
  clients: Client[],
  projects: Project[]
): boolean => {
  if (!user || !client) return false;
  if (isOwnerUser(user)) return true;
  return getAgentLinkedClientIds(user.id, leads, clients, projects).has(client.id);
};

export const canAccessInvoice = (
  user: User | null | undefined,
  invoice: Invoice | null | undefined,
  leads: Lead[],
  clients: Client[],
  projects: Project[]
): boolean => {
  if (!user || !invoice) return false;
  if (isOwnerUser(user)) return true;

  if (invoice.projectId) {
    const project = projects.find((item) => item.id === invoice.projectId);
    if (project && project.assignedTo === user.id) return true;
  }

  return getAgentLinkedClientIds(user.id, leads, clients, projects).has(invoice.clientId);
};

export const canAccessCommission = (
  user: User | null | undefined,
  commission: Commission | null | undefined
): boolean => {
  if (!user || !commission) return false;
  return isOwnerUser(user) || commission.agentId === user.id;
};

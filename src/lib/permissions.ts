import { Client, Commission, Invoice, Lead, Project, User } from '@/types/models';

export const matchesUserIdentity = (user: User | null | undefined, value: string | null | undefined): boolean =>
  Boolean(user && value && (value === user.id || value === user.uid));

export const isOwnerUser = (user: User | null | undefined): boolean => user?.role === 'owner';
export const isAgentUser = (user: User | null | undefined): boolean => user?.role === 'agent';

export const getAgentLinkedClientIds = (
  userId: string,
  leads: Lead[],
  clients: Client[],
  projects: Project[],
  authUid?: string
): Set<string> => {
  const keys = new Set([userId, ...(authUid ? [authUid] : [])]);
  const linkedLeadIds = new Set(leads.filter((lead) => keys.has(lead.assignedTo)).map((lead) => lead.id));
  const clientIdsFromLeads = clients
    .filter((client) => client.leadId && linkedLeadIds.has(client.leadId))
    .map((client) => client.id);
  const clientIdsFromProjects = projects
    .filter((project) => keys.has(project.assignedTo))
    .map((project) => project.clientId);
  return new Set([...clientIdsFromLeads, ...clientIdsFromProjects]);
};

export const canAccessLead = (user: User | null | undefined, lead: Lead | null | undefined): boolean => {
  if (!user || !lead) return false;
  return isOwnerUser(user) || matchesUserIdentity(user, lead.assignedTo);
};

export const canAccessProject = (user: User | null | undefined, project: Project | null | undefined): boolean => {
  if (!user || !project) return false;
  return isOwnerUser(user) || matchesUserIdentity(user, project.assignedTo);
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
  return getAgentLinkedClientIds(user.id, leads, clients, projects, user.uid).has(client.id);
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
    if (project && matchesUserIdentity(user, project.assignedTo)) return true;
  }

  return getAgentLinkedClientIds(user.id, leads, clients, projects, user.uid).has(invoice.clientId);
};

export const canAccessCommission = (
  user: User | null | undefined,
  commission: Commission | null | undefined
): boolean => {
  if (!user || !commission) return false;
  return isOwnerUser(user) || matchesUserIdentity(user, commission.agentId);
};

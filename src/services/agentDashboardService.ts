import { clientService } from './clientService';
import { commissionService } from './commissionService';
import { leadService } from './leadService';
import { projectService } from './projectService';
import type { User } from '@/types/models';

export async function loadAgentDashboardData(user: Pick<User, 'id' | 'uid'>) {
  // These services constrain Firestore queries to the signed-in account.
  // Keep the assignment check here too before loading linked client details.
  const keys = new Set([user.id, user.uid].filter(Boolean));
  const [leads, projects, commissions] = await Promise.all([
    leadService.getAll(), projectService.getAll(), commissionService.getAll(),
  ]);
  const myLeads = leads.filter(lead => keys.has(lead.assignedTo));
  const myProjects = projects.filter(project => keys.has(project.assignedTo));
  const myCommissions = commissions.filter(commission => keys.has(commission.agentId));
  const clientIds = [...new Set(myProjects.map(project => project.clientId).filter(Boolean))];
  // Individual document reads avoid collection-query proof/access-call limits.
  // Client names are optional labels, not a prerequisite for the agent's KPIs.
  const clients = await Promise.allSettled(clientIds.map(id => clientService.getById(id)));
  const clientsById: Record<string, string> = {};
  let clientDetailsUnavailable = false;
  clients.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) clientsById[clientIds[index]] = result.value.businessName;
    else {
      clientDetailsUnavailable = true;
      if (result.status === 'rejected') console.warn('[AgentDashboard] Linked client unavailable.', {
        code: typeof result.reason?.code === 'string' ? result.reason.code : 'unknown',
      });
    }
  });
  return { myLeads, myProjects, myCommissions, clientsById, clientDetailsUnavailable };
}

export function agentDashboardErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code.includes('permission-denied')) return 'Your dashboard data could not be accessed. Sign out and sign back in to refresh your access. If this continues, ask the owner to check your account and published Firestore rules.';
  if (code.includes('failed-precondition')) return 'A required dashboard query could not run. Ask the owner to check the Firestore index reported in the browser console.';
  if (code.includes('unauthenticated') || (error instanceof Error && /sign in|role could not be verified/i.test(error.message))) return 'Your session needs refreshing. Sign out and sign back in to load your dashboard.';
  return 'Unable to load your dashboard. Check your connection and try again.';
}

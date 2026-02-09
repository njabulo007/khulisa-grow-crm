import { Client, Invoice, Lead, Project } from '@/types/models';

export function resolveAgentIdForInvoice(
  invoice: Invoice,
  projects: Project[],
  leads: Lead[],
  clients: Client[],
): string | null {
  const invoiceWithOptionalAgent = invoice as Invoice & { agentId?: string };
  const directAgentId = invoiceWithOptionalAgent.agentId?.trim();
  if (directAgentId) return directAgentId;

  if (invoice.projectId) {
    const project = projects.find((entry) => entry.id === invoice.projectId);
    if (project?.assignedTo) return project.assignedTo;
  }

  const client = clients.find((entry) => entry.id === invoice.clientId);
  const linkedLead = leads.find((lead) => {
    if (lead.clientId === invoice.clientId) return true;
    if (client?.leadId && lead.id === client.leadId) return true;
    return false;
  });
  if (linkedLead?.assignedTo) return linkedLead.assignedTo;

  return null;
}

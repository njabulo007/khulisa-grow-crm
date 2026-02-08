import { COMMISSION_RATE } from '@/config/commission';
import { getPackageById, type PackageId } from '@/config/packages';
import { Commission, CommissionStatus, Invoice } from '@/types/models';
import { authService } from './authService';
import { clientService } from './clientService';
import { commissionService } from './commissionService';
import { invoiceService } from './invoiceService';
import { leadService } from './leadService';
import { projectService } from './projectService';

const roundCurrency = (value: number): number => Math.round(value * 100) / 100;

const resolveAgentIdForInvoice = (
  invoice: Invoice,
  agentIds: Set<string>,
  projectsById: Map<string, Awaited<ReturnType<typeof projectService.getAll>>[number]>,
  leads: Awaited<ReturnType<typeof leadService.getAll>>,
  clients: Awaited<ReturnType<typeof clientService.getAll>>,
): string | null => {
  if (invoice.projectId) {
    const project = projectsById.get(invoice.projectId);
    if (project && agentIds.has(project.assignedTo)) return project.assignedTo;
  }

  const client = clients.find((entry) => entry.id === invoice.clientId);
  const relatedLeads = leads.filter((lead) => {
    if (lead.clientId === invoice.clientId) return true;
    if (client?.leadId && lead.id === client.leadId) return true;
    return false;
  });

  const linkedAgentLead = relatedLeads.find((lead) => agentIds.has(lead.assignedTo));
  if (linkedAgentLead) return linkedAgentLead.assignedTo;
  return null;
};

const getBaseStatusForInvoice = (invoice: Invoice): CommissionStatus =>
  invoice.status === 'paid' ? 'earned' : 'pending';

const resolvePackageIdForInvoice = (
  invoice: Invoice,
  projectsById: Map<string, Awaited<ReturnType<typeof projectService.getAll>>[number]>,
): PackageId | null => {
  if (!invoice.projectId) return null;
  const project = projectsById.get(invoice.projectId);
  return project?.packageId || null;
};

const resolveEarnedDate = (
  invoice: Invoice,
  existing: Commission | undefined,
  nextStatus: CommissionStatus
): string | undefined => {
  if (nextStatus !== 'earned' && nextStatus !== 'paid-out') return existing?.earnedDate;
  if (existing?.earnedDate) return existing.earnedDate;
  return invoice.updatedAt;
};

export async function syncCommissionsFromInvoices(): Promise<void> {
  // TODO: Replace implementation with Firebase-triggered commission rules.
  const [users, invoices, projects, clients, leads] = await Promise.all([
    authService.getAll(),
    invoiceService.getAll(),
    projectService.getAll(),
    clientService.getAll(),
    leadService.getAll(),
  ]);
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const agentIds = new Set(users.filter((user) => user.role === 'agent').map((user) => user.id));

  const rate = COMMISSION_RATE;

  for (const invoice of invoices) {
    const agentId = resolveAgentIdForInvoice(invoice, agentIds, projectsById, leads, clients);
    const packageId = resolvePackageIdForInvoice(invoice, projectsById);
    if (!agentId) continue;
    if (!packageId) continue;

    const pkg = getPackageById(packageId);
    if (!pkg) continue;

    const expectedAmount = roundCurrency(pkg.price * rate);
    const baseStatus = getBaseStatusForInvoice(invoice);
    const existing = await commissionService.getByInvoice(invoice.id);

    if (!existing) {
      await commissionService.create({
        agentId,
        invoiceId: invoice.id,
        projectId: invoice.projectId,
        packageId,
        packageName: pkg.name,
        packagePrice: pkg.price,
        commissionAmount: expectedAmount,
        rate,
        status: baseStatus,
        earnedDate: baseStatus === 'earned' ? invoice.updatedAt : undefined,
      });
      continue;
    }

    const nextStatus: CommissionStatus = existing.status === 'paid-out' ? 'paid-out' : baseStatus;
    const nextEarnedDate = resolveEarnedDate(invoice, existing, nextStatus);
    const needsUpdate =
      existing.agentId !== agentId ||
      existing.projectId !== invoice.projectId ||
      existing.packageId !== packageId ||
      existing.packageName !== pkg.name ||
      existing.packagePrice !== pkg.price ||
      existing.commissionAmount !== expectedAmount ||
      existing.rate !== rate ||
      existing.status !== nextStatus ||
      existing.earnedDate !== nextEarnedDate;

    if (!needsUpdate) continue;

    await commissionService.update(existing.id, {
      agentId,
      projectId: invoice.projectId,
      packageId,
      packageName: pkg.name,
      packagePrice: pkg.price,
      commissionAmount: expectedAmount,
      rate,
      status: nextStatus,
      earnedDate: nextEarnedDate,
    });
  }
}

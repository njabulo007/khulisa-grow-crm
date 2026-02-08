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
  agentIds: Set<string>
): string | null => {
  if (invoice.projectId) {
    const project = projectService.getById(invoice.projectId);
    if (project && agentIds.has(project.assignedTo)) return project.assignedTo;
  }

  const client = clientService.getById(invoice.clientId);
  const leads = leadService.getAll().filter((lead) => {
    if (lead.clientId === invoice.clientId) return true;
    if (client?.leadId && lead.id === client.leadId) return true;
    return false;
  });

  const linkedAgentLead = leads.find((lead) => agentIds.has(lead.assignedTo));
  if (linkedAgentLead) return linkedAgentLead.assignedTo;
  return null;
};

const getBaseStatusForInvoice = (invoice: Invoice): CommissionStatus =>
  invoice.status === 'paid' ? 'earned' : 'pending';

const resolvePackageIdForInvoice = (invoice: Invoice): PackageId | null => {
  if (!invoice.projectId) return null;
  const project = projectService.getById(invoice.projectId);
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

export function syncCommissionsFromInvoices(): void {
  // TODO: Replace implementation with Firebase-triggered commission rules.
  const users = authService.getAll();
  const agentIds = new Set(users.filter((user) => user.role === 'agent').map((user) => user.id));

  const invoices = invoiceService.getAll();
  const rate = COMMISSION_RATE;

  invoices.forEach((invoice) => {
    const agentId = resolveAgentIdForInvoice(invoice, agentIds);
    const packageId = resolvePackageIdForInvoice(invoice);
    if (!agentId) return;
    if (!packageId) return;

    const pkg = getPackageById(packageId);
    if (!pkg) return;

    const expectedAmount = roundCurrency(pkg.price * rate);
    const baseStatus = getBaseStatusForInvoice(invoice);
    const existing = commissionService.getByInvoice(invoice.id);

    if (!existing) {
      commissionService.create({
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
      return;
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

    if (!needsUpdate) return;

    commissionService.update(existing.id, {
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
  });
}

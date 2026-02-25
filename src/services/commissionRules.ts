import { getCommissionRateForAgent } from '@/config/commission';
import { getPackageById, type PackageId } from '@/config/packages';
import { Commission, CommissionStatus, Invoice } from '@/types/models';
import { authService } from './authService';
import { clientService } from './clientService';
import { commissionService } from './commissionService';
import { invoiceService } from './invoiceService';
import { leadService } from './leadService';
import { projectService } from './projectService';
import { settingsService } from './settingsService';

const roundCurrency = (value: number): number => Math.round(value * 100) / 100;
const normalizeCommissionRatePercent = (value: number, fallbackPercent: number): number => {
  const baseline = Number.isFinite(fallbackPercent) ? fallbackPercent : 0;
  if (!Number.isFinite(value)) return Math.max(0, Math.min(100, baseline));
  const resolved = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, resolved));
};
const rateFromPercent = (percent: number): number =>
  Math.round((percent / 100 + Number.EPSILON) * 10000) / 10000;
const toTimestamp = (value?: string): number => {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};
const getCommissionOrderTimestamp = (invoice: Invoice): number =>
  invoice.status === 'paid' ? toTimestamp(invoice.updatedAt) : toTimestamp(invoice.createdAt);
const sortInvoicesForCommission = (left: Invoice, right: Invoice): number => {
  const byOrder = getCommissionOrderTimestamp(left) - getCommissionOrderTimestamp(right);
  if (byOrder !== 0) return byOrder;

  const byCreated = toTimestamp(left.createdAt) - toTimestamp(right.createdAt);
  if (byCreated !== 0) return byCreated;

  return left.id.localeCompare(right.id);
};

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
  const [globalSettings, users, invoices, projects, clients, leads, existingCommissions] = await Promise.all([
    settingsService.getGlobal(),
    authService.getAll(),
    invoiceService.getAll(),
    projectService.getAll(),
    clientService.getAll(),
    leadService.getAll(),
    commissionService.getAll(),
  ]);
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const usersById = new Map(users.map((user) => [user.id, user]));
  const agentIds = new Set(users.filter((user) => user.role === 'agent').map((user) => user.id));
  const existingByInvoiceId = new Map(existingCommissions.map((commission) => [commission.invoiceId, commission]));
  const paidSalesCountByAgent = new Map<string, number>();
  const invoicesByCommissionOrder = [...invoices].sort(sortInvoicesForCommission);

  for (const invoice of invoicesByCommissionOrder) {
    const agentId = resolveAgentIdForInvoice(invoice, agentIds, projectsById, leads, clients);
    const packageId = resolvePackageIdForInvoice(invoice, projectsById);
    if (!agentId) continue;
    if (!packageId) continue;

    const paidSalesBeforeInvoice = paidSalesCountByAgent.get(agentId) || 0;
    const paidSalesIncludingCurrent =
      invoice.status === 'paid' ? paidSalesBeforeInvoice + 1 : paidSalesBeforeInvoice;
    const manualRatePercent = normalizeCommissionRatePercent(
      usersById.get(agentId)?.commissionRate ?? globalSettings.defaultManualCommissionRate,
      globalSettings.defaultManualCommissionRate,
    );
    const rate =
      globalSettings.commissionMode === 'manual'
        ? rateFromPercent(manualRatePercent)
        : getCommissionRateForAgent({
            agentEmail: usersById.get(agentId)?.email,
            paidSalesCount: paidSalesIncludingCurrent,
          });

    const pkg = getPackageById(packageId);
    if (!pkg) continue;

    const expectedAmount = roundCurrency(pkg.price * rate);
    const baseStatus = getBaseStatusForInvoice(invoice);
    const existing = existingByInvoiceId.get(invoice.id);

    if (!existing) {
      const created = await commissionService.create({
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
      existingByInvoiceId.set(invoice.id, created);
      if (invoice.status === 'paid') {
        paidSalesCountByAgent.set(agentId, paidSalesIncludingCurrent);
      }
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

    if (!needsUpdate) {
      if (invoice.status === 'paid') {
        paidSalesCountByAgent.set(agentId, paidSalesIncludingCurrent);
      }
      continue;
    }

    const updated = await commissionService.update(existing.id, {
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
    if (updated) {
      existingByInvoiceId.set(invoice.id, updated);
    }
    if (invoice.status === 'paid') {
      paidSalesCountByAgent.set(agentId, paidSalesIncludingCurrent);
    }
  }
}

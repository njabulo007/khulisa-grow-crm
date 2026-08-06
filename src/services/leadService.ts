import {
  formatCommissionRatePercent,
  getCommissionRateForAgent,
} from '@/config/commission';
import { resolveAgentIdForInvoice } from '@/lib/invoiceAgentResolver';
import { GlobalSettings, Invoice, Lead } from '@/types/models';
import { authService } from './authService';
import { clientService } from './clientService';
import { projectService } from './projectService';
import { FirestoreCollection, generateId, getTimestamp } from './storage';
import { notificationService } from './notificationService';
import { settingsService } from './settingsService';

const normalizeCommissionRatePercent = (value: number, fallbackPercent: number): number => {
  const baseline = Number.isFinite(fallbackPercent) ? fallbackPercent : 0;
  if (!Number.isFinite(value)) return Math.max(0, Math.min(100, baseline));
  const resolved = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, resolved));
};

const rateFromPercent = (percent: number): number =>
  Math.round((percent / 100 + Number.EPSILON) * 10000) / 10000;

const DEADLINE_ATTENTION_WINDOW_MS = 1000 * 60 * 60 * 24 * 7;

const parseDateMs = (value?: string): number | null => {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

const getDueDateKey = (value: string): string => new Date(value).toISOString().slice(0, 10);

export interface LeadService {
  getAll: () => Promise<Lead[]>;
  getById: (id: string) => Promise<Lead | undefined>;
  getByAgent: (agentId: string) => Promise<Lead[]>;
  create: (lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Lead>;
  update: (id: string, updates: Partial<Lead>) => Promise<Lead | null>;
  remove: (id: string) => Promise<boolean>;
  seedIfMissing: (seedData: Lead[]) => Promise<void>;
}

class FirestoreLeadService implements LeadService {
  // TODO: Keep this service boundary stable and swap internals with richer Firestore queries as needed.
  private readonly collection = new FirestoreCollection<Lead>('leads');
  private readonly invoicesCollection = new FirestoreCollection<Invoice & { packageType?: string }>('invoices');

  private roundCurrency(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  private async getCurrentCommissionRateForAgent(
    agentId: string,
    globalSettings?: GlobalSettings
  ): Promise<number> {
    const settings = globalSettings ?? (await settingsService.getGlobal());
    if (settings.commissionMode === 'manual') {
      const manualRatePercent = normalizeCommissionRatePercent(
        authService.getById(agentId)?.commissionRate ?? settings.defaultManualCommissionRate,
        settings.defaultManualCommissionRate,
      );
      return rateFromPercent(manualRatePercent);
    }

    const agentEmail = authService.getById(agentId)?.email;
    const [invoices, projects, leads, clients] = await Promise.all([
      this.invoicesCollection.getAll(),
      projectService.getAll(),
      this.collection.getAll(),
      clientService.getAll(),
    ]);

    const paidSalesCount = invoices.reduce((count, invoice) => {
      if (invoice.status !== 'paid') return count;
      const resolvedAgentId = resolveAgentIdForInvoice(invoice, projects, leads, clients);
      return resolvedAgentId === agentId ? count + 1 : count;
    }, 0);

    return getCommissionRateForAgent({
      agentEmail,
      paidSalesCount,
    });
  }

  private async buildLeadAssignmentMessage(lead: Lead, nextAssignedTo: string): Promise<string> {
    const agent = authService.getById(nextAssignedTo);
    const fallbackRate = getCommissionRateForAgent({ agentEmail: agent?.email, paidSalesCount: 0 });
    let rate = fallbackRate;

    try {
      const globalSettings = await settingsService.getGlobal();
      if (globalSettings.commissionMode === 'manual') {
        const manualRatePercent = normalizeCommissionRatePercent(
          agent?.commissionRate ?? globalSettings.defaultManualCommissionRate,
          globalSettings.defaultManualCommissionRate,
        );
        rate = rateFromPercent(manualRatePercent);
      } else {
        rate = await this.getCurrentCommissionRateForAgent(nextAssignedTo, globalSettings);
      }
    } catch (error) {
      console.error('[LeadService] Failed to calculate dynamic commission rate for assignment notification.', error);
    }

    const estimatedValue = Number.isFinite(lead.estimatedValue) ? Math.max(0, lead.estimatedValue) : 0;
    const potentialCommission = this.roundCurrency(estimatedValue * rate);

    return `You've been assigned a new lead: ${lead.businessName}. Potential commission: ${this.formatCurrency(potentialCommission)}.`;
  }

  private async notifyAssignment(lead: Lead, previousAssignedTo?: string): Promise<void> {
    const nextAssignedTo = lead.assignedTo?.trim();
    if (!nextAssignedTo) return;
    if (previousAssignedTo && previousAssignedTo === nextAssignedTo) return;
    // Skip notifying on self-assigned lead creation by the same agent.
    if (!previousAssignedTo && lead.createdBy === nextAssignedTo) return;

    const message = await this.buildLeadAssignmentMessage(lead, nextAssignedTo);

    await notificationService.createForUser(nextAssignedTo, {
      type: 'lead_assigned',
      leadId: lead.id,
      title: 'New lead assigned',
      message,
    });
  }

  private async notifyFollowUpDue(lead: Lead, previousFollowUpDate?: string): Promise<void> {
    const assignedTo = lead.assignedTo?.trim();
    if (!assignedTo || !lead.followUpDate) return;
    if (previousFollowUpDate === lead.followUpDate) return;

    const followUpMs = parseDateMs(lead.followUpDate);
    if (followUpMs === null) return;

    const nowMs = Date.now();
    if (followUpMs - nowMs > DEADLINE_ATTENTION_WINDOW_MS) return;

    const dateKey = getDueDateKey(lead.followUpDate);
    const existingNotifications = await notificationService.getForUser(assignedTo);
    if (
      existingNotifications.some(
        (entry) =>
          entry.type === 'lead_follow_up' &&
          entry.leadId === lead.id &&
          entry.message.includes(dateKey)
      )
    ) {
      return;
    }

    const isOverdue = followUpMs < nowMs;
    const dueText = new Date(lead.followUpDate).toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    await notificationService.createForUser(assignedTo, {
      type: 'lead_follow_up',
      leadId: lead.id,
      title: isOverdue ? 'Lead follow-up overdue' : 'Lead follow-up due soon',
      message: `${lead.businessName} follow-up is ${isOverdue ? 'overdue' : 'due'} on ${dueText}. Ref: ${dateKey}`,
    });
  }

  async getAll(): Promise<Lead[]> {
    return this.collection.getAll();
  }

  async getById(id: string): Promise<Lead | undefined> {
    return this.collection.getById(id);
  }

  async getByAgent(agentId: string): Promise<Lead[]> {
    const leads = await this.collection.getAll();
    return leads.filter((lead) => lead.assignedTo === agentId);
  }

  async create(lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>): Promise<Lead> {
    const created = {
      ...lead,
      id: generateId(),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    };
    const persisted = await this.collection.create(created);
    await this.notifyAssignment(persisted);
    await this.notifyFollowUpDue(persisted);
    return persisted;
  }

  async update(id: string, updates: Partial<Lead>): Promise<Lead | null> {
    const existing = await this.collection.getById(id);
    if (!existing) return null;

    const updated = await this.collection.update(id, { ...updates, updatedAt: getTimestamp() });
    if (updated) {
      await this.notifyAssignment(updated, existing.assignedTo);
      await this.notifyFollowUpDue(updated, existing.followUpDate);
    }
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    return this.collection.remove(id);
  }

  async seedIfMissing(seedData: Lead[]): Promise<void> {
    await this.collection.seedIfMissing(seedData);
  }
}

export const leadService: LeadService = new FirestoreLeadService();

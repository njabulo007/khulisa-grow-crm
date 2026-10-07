import type { Client, Invoice, Lead, Project, User } from "@/types/models";
import { resolveAgentIdForInvoice } from "./invoiceAgentResolver";
import { matchesUserIdentity } from "./permissions";
import { buildProjectLookup, getInvoiceEffectiveTotals } from "./invoiceTotals";

export function getAgentPerformance(
  users: User[],
  leads: Lead[],
  clients: Client[],
  projects: Project[],
  invoices: Invoice[],
) {
  const lookup = buildProjectLookup(projects);
  const agents = [
    ...new Map(
      users
        .filter((user) => user.role === "agent" && user.isActive !== false)
        .map((user) => [user.uid || user.id, user]),
    ).values(),
  ];
  return agents
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      dealsWon: leads.filter(
        (lead) =>
          lead.stage === "won" && matchesUserIdentity(agent, lead.assignedTo),
      ).length,
      revenue: invoices
        .filter(
          (invoice) =>
            invoice.status === "paid" &&
            matchesUserIdentity(
              agent,
              resolveAgentIdForInvoice(invoice, projects, leads, clients),
            ),
        )
        .reduce(
          (sum, invoice) =>
            sum + getInvoiceEffectiveTotals(invoice, lookup).total,
          0,
        ),
    }))
    .sort(
      (a, b) =>
        b.dealsWon - a.dealsWon ||
        b.revenue - a.revenue ||
        a.name.localeCompare(b.name),
    );
}

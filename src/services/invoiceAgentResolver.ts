import { resolveAgentIdForInvoice } from '@/lib/invoiceAgentResolver';
import { clientService } from './clientService';
import { invoiceService } from './invoiceService';
import { leadService } from './leadService';
import { projectService } from './projectService';

export async function getAgentIdForInvoice(invoiceId: string): Promise<string | null> {
  const invoice = await invoiceService.getById(invoiceId);
  if (!invoice) return null;

  const [projects, leads, clients] = await Promise.all([
    projectService.getAll(),
    leadService.getAll(),
    clientService.getAll(),
  ]);

  return resolveAgentIdForInvoice(invoice, projects, leads, clients);
}

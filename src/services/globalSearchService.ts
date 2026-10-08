import { leadService } from './leadService';
import { clientService } from './clientService';
import { projectService } from './projectService';
import { invoiceService } from './invoiceService';

export async function loadGlobalSearchData() {
  const results = await Promise.allSettled([
    leadService.getAll(), clientService.getAll(), projectService.getAll(), invoiceService.getAll(),
  ]);
  const [leads, clients, projects, invoices] = results;
  const labels = ['Leads', 'Clients', 'Projects', 'Invoices'];
  const unavailable = results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return [];
    console.warn('[CRM search] Records unavailable.', { category: labels[index], code: result.reason?.code || 'unknown' });
    return [labels[index]];
  });
  return {
    leads: leads.status === 'fulfilled' ? leads.value : [],
    clients: clients.status === 'fulfilled' ? clients.value : [],
    projects: projects.status === 'fulfilled' ? projects.value : [],
    invoices: invoices.status === 'fulfilled' ? invoices.value : [],
    unavailable,
  };
}

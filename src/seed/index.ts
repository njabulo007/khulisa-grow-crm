import {
  activityService,
  authService,
  clientService,
  commissionService,
  invoiceService,
  leadService,
  paymentService,
  projectService,
} from '@/services';
import {
  seedActivities,
  seedClients,
  seedCommissions,
  seedInvoices,
  seedLeads,
  seedPayments,
  seedProjects,
  seedUsers,
} from './data';

const canonicalSeedUserProfiles: Record<string, { name: string; email: string; isActive: boolean }> = {
  user_owner: {
    name: 'Njabulo Dlamini',
    email: 'njabulo@khulisamedia.co.za',
    isActive: true,
  },
  user_agent1: {
    name: 'Lindiwe Ndlovu',
    email: 'lindiwe@khulisamedia.co.za',
    isActive: true,
  },
  user_agent2: {
    name: 'Sipho Dlamini',
    email: 'sipho@khulisamedia.co.za',
    isActive: true,
  },
};

export function seedAppData(): void {
  // TODO: Replace bootstrapping with Firebase initial provisioning.
  authService.seedIfMissing(seedUsers, seedUsers[0]?.id, false);
  Object.entries(canonicalSeedUserProfiles).forEach(([userId, profile]) => {
    authService.update(userId, profile);
  });
  leadService.seedIfMissing(seedLeads);
  clientService.seedIfMissing(seedClients);
  projectService.seedIfMissing(seedProjects);
  invoiceService.seedIfMissing(seedInvoices);
  paymentService.seedIfMissing(seedPayments);
  commissionService.seedIfMissing(seedCommissions);
  activityService.seedIfMissing(seedActivities);
}

export {
  seedUsers,
  seedLeads,
  seedClients,
  seedProjects,
  seedInvoices,
  seedPayments,
  seedCommissions,
  seedActivities,
};

import { OBSOLETE_CRM_STORAGE_KEYS, STORAGE_KEYS, hasStoredValue, removeStoredValue, writeStoredValue } from '@/services/storage';
import { seedActivities, seedClients, seedCommissions, seedInvoices, seedLeads, seedPayments, seedProjects, seedUsers } from './data';

const DEMO_DATA_PURGE_KEY = 'khulisa_demo_data_purged_v3';

export function seedAppData(): void {
  // One-time cleanup of legacy demo/session state so sign-in starts fresh on Firebase Auth.
  if (hasStoredValue(DEMO_DATA_PURGE_KEY)) return;

  [
    STORAGE_KEYS.users,
    STORAGE_KEYS.currentUser,
    STORAGE_KEYS.role,
    ...OBSOLETE_CRM_STORAGE_KEYS,
  ].forEach((key) => removeStoredValue(key));

  writeStoredValue(DEMO_DATA_PURGE_KEY, 'true');
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

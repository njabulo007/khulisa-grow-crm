import { adminAuth, adminDb } from './firebaseAdmin.js';
import { createMigrationHandlers } from './migrationHandlers.js';
export const migration = createMigrationHandlers({ auth: adminAuth, db: adminDb });

import { migration } from './migration.js';

// Portal and Blob routes share the revocation-aware, canonical owner check.
export const requireOwner = migration.requireOwner;

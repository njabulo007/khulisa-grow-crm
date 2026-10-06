import { adminDb, adminMessaging } from '../_lib/firebaseAdmin.js';
import { migration } from '../_lib/migration.js';
import { createPushHandler } from '../_lib/pushHandlers.js';

export default createPushHandler({ db: adminDb, messaging: adminMessaging, authenticate: migration.authenticate, requireOwner: migration.requireOwner });

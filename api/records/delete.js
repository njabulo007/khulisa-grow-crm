import { requestAttachmentStorage } from '../_lib/requestAttachmentStorage.js';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../_lib/firebaseAdmin.js';
import { migration } from '../_lib/migration.js';
import { deletePortalMediaFiles } from '../_lib/projectShareMedia.js';
import { createDeletionHandler } from '../_lib/deletionHandlers.js';

export default createDeletionHandler({
  db: adminDb, authenticate: migration.authenticate, requireOwner: migration.requireOwner,
  deleteRequestFile: requestAttachmentStorage.remove, deleteMedia: deletePortalMediaFiles, deleteField: () => FieldValue.delete(),
});

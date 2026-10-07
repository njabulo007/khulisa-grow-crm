import { adminDb } from '../_lib/firebaseAdmin.js';
import { createHttpError, handleRouteError, json, methodNotAllowed, parseBody } from '../_lib/http.js';
import {
  CLIENTS_COLLECTION,
  PROJECT_SHARES_COLLECTION,
  PROJECTS_COLLECTION,
  computeShareStatus,
  isProjectClosed,
  nowIso,
  parseOptionalIsoDate,
  sanitizeMilestones,
  tokenHash,
} from '../_lib/projectShareCore.js';
import { normalizePortalMedia } from '../_lib/projectShareMedia.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  try {
    const payload = parseBody(req);
    const token = typeof payload.token === 'string' ? payload.token.trim() : '';
    if (!token) {
      throw createHttpError(400, 'token is required.');
    }

    const shareSnapshot = await adminDb
      .collection(PROJECT_SHARES_COLLECTION)
      .where('tokenHash', '==', tokenHash(token))
      .limit(1)
      .get();
    if (shareSnapshot.empty) {
      throw createHttpError(404, 'Share link is invalid.');
    }

    const shareDoc = shareSnapshot.docs[0];
    const share = shareDoc.data() || {};
    const shareStatus = computeShareStatus(share);
    if (shareStatus !== 'active') {
      if (shareStatus === 'expired' && share.status !== 'expired') {
        await shareDoc.ref.update({
          status: 'expired',
          updatedAt: nowIso(),
        });
      }
      throw createHttpError(403, shareStatus === 'revoked' ? 'Share link is no longer active.' : 'Share link has expired.');
    }

    const projectId = typeof share.projectId === 'string' ? share.projectId.trim() : '';
    if (!projectId) {
      throw createHttpError(409, 'Share link is missing project reference.');
    }

    const projectSnapshot = await adminDb.collection(PROJECTS_COLLECTION).doc(projectId).get();
    if (!projectSnapshot.exists) {
      throw createHttpError(404, 'Linked project no longer exists.');
    }

    const project = projectSnapshot.data() || {};
    if (project._deleting) throw createHttpError(403, 'This project is being deleted.');
    const projectStatus = typeof project.status === 'string' ? project.status : 'not-started';
    if (isProjectClosed(projectStatus)) {
      await shareDoc.ref.update({
        status: 'expired',
        revokedAt: nowIso(),
        revokedBy: 'system:project-closed',
        updatedAt: nowIso(),
      });
      throw createHttpError(403, 'Project has been closed. This link is no longer available.');
    }

    const clientId = typeof project.clientId === 'string' ? project.clientId.trim() : '';
    if (!clientId) {
      throw createHttpError(409, 'Project is missing linked client.');
    }

    const clientSnapshot = await adminDb.collection(CLIENTS_COLLECTION).doc(clientId).get();
    if (!clientSnapshot.exists) {
      throw createHttpError(404, 'Linked client no longer exists.');
    }

    const client = clientSnapshot.data() || {};
    if (client._deleting) throw createHttpError(403, 'This client is being deleted.');
    let contact = null;
    if (typeof project.assignedTo === 'string' && project.assignedTo && !project.assignedTo.includes('/')) {
      let profile = await adminDb.collection('users').doc(project.assignedTo).get();
      if (!profile.exists) {
        const matches = await adminDb.collection('users').where('appUserId', '==', project.assignedTo).limit(1).get();
        profile = matches.docs[0];
      }
      const person = profile?.data();
      if (person?.isActive !== false && typeof person?.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email)) {
        contact = { name: person.displayName || person.name || 'Khulisa Media', email: person.email };
      }
    }
    await shareDoc.ref.update({
      lastViewedAt: nowIso(),
      updatedAt: nowIso(),
    });

    return json(res, 200, {
      share: {
        id: shareDoc.id,
        expiresAt: parseOptionalIsoDate(share.expiresAt),
        status: 'active',
        media: normalizePortalMedia(share.media),
      },
      client: {
        id: clientSnapshot.id,
        businessName: typeof client.businessName === 'string' ? client.businessName : 'Client',
      },
      project: {
        id: projectSnapshot.id,
        name: typeof project.name === 'string' ? project.name : 'Project',
        status: projectStatus,
        packageName: typeof project.packageName === 'string' ? project.packageName : null,
        packageId: typeof project.packageId === 'string' ? project.packageId : null,
        startDate: parseOptionalIsoDate(project.startDate),
        dueDate: parseOptionalIsoDate(project.dueDate),
        notes: '',
        clientUpdate: typeof project.clientUpdate === 'string' ? project.clientUpdate : '',
        contact,
        driveLink: typeof project.driveLink === 'string' ? project.driveLink : null,
        milestones: sanitizeMilestones(project.milestones),
        updatedAt: parseOptionalIsoDate(project.updatedAt),
      },
    });
  } catch (error) {
    return handleRouteError(res, error, 'Portal link could not be resolved.');
  }
}

import { adminAuth, adminDb } from './firebaseAdmin.js';
import { createHttpError } from './http.js';
import { OWNER_EMAILS } from './projectShareCore.js';

const getRoleFromData = (data) => {
  if (!data || typeof data !== 'object') return null;
  const rawRole = data.role || data.userRole || data.Role || data.user_role;
  if (rawRole === 'owner' || rawRole === 'agent') return rawRole;
  return null;
};

export const requireOwner = async (req) => {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) {
    throw createHttpError(401, 'You must be signed in.');
  }

  const idToken = authorization.slice(7).trim();
  if (!idToken) {
    throw createHttpError(401, 'You must be signed in.');
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch {
    throw createHttpError(401, 'Your session is invalid. Please sign in again.');
  }

  const uid = decoded.uid;
  let role = 'agent';

  try {
    const userDoc = await adminDb.collection('users').doc(uid).get();
    if (userDoc.exists) {
      const candidate = getRoleFromData(userDoc.data() || {});
      if (candidate) role = candidate;
    }
  } catch {
    // Continue with email fallback.
  }

  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (OWNER_EMAILS.has(email)) {
    role = 'owner';
  }

  if (role !== 'owner') {
    throw createHttpError(403, 'Only owners can manage client share links.');
  }

  return { uid, email, role };
};

import { adminAuth } from './firebaseAdmin.js';
import { createHttpError } from './http.js';

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
  const role = decoded.role === 'owner' ? 'owner' : 'agent';
  if (role !== 'owner') {
    throw createHttpError(403, 'Only owners can manage client share links.');
  }

  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  return { uid, email, role };
};

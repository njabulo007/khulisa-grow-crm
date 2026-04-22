import { del } from '@vercel/blob';
import { createHttpError, handleRouteError, json, methodNotAllowed, parseBody } from '../_lib/http.js';
import { requireOwner } from '../_lib/requireOwner.js';

const VERCEL_BLOB_STORAGE_PREFIX = 'vercel-blob:';

const extractBlobUrl = (storagePath) => {
  if (typeof storagePath !== 'string') return null;
  const trimmed = storagePath.trim();
  if (!trimmed.startsWith(VERCEL_BLOB_STORAGE_PREFIX)) return null;
  const candidate = trimmed.slice(VERCEL_BLOB_STORAGE_PREFIX.length).trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  try {
    await requireOwner(req);
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw createHttpError(500, 'Vercel Blob is not configured. Missing BLOB_READ_WRITE_TOKEN.');
    }
    const payload = parseBody(req);
    const blobUrl = extractBlobUrl(payload.storagePath);
    if (!blobUrl) {
      throw createHttpError(400, 'A valid Vercel Blob storagePath is required.');
    }

    await del(blobUrl);
    return json(res, 200, { ok: true });
  } catch (error) {
    return handleRouteError(res, error, 'Failed to delete uploaded media.');
  }
}

import { put } from '@vercel/blob';
import { adminDb } from '../_lib/firebaseAdmin.js';
import { createHttpError, handleRouteError, json, methodNotAllowed } from '../_lib/http.js';
import { PROJECT_SHARES_COLLECTION, computeShareStatus } from '../_lib/projectShareCore.js';
import { requireOwner } from '../_lib/requireOwner.js';

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const asTrimmed = (value) => (typeof value === 'string' ? value.trim() : '');

const sanitizeFileName = (rawName) => {
  const cleaned = asTrimmed(rawName)
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!cleaned) return 'project-file';
  return cleaned.slice(0, 120);
};

const buildBlobPath = ({ projectId, shareId, fileName }) => {
  const safeFileName = sanitizeFileName(fileName);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `project-portals/${projectId}/${shareId}/${Date.now()}-${randomPart}-${safeFileName}`;
};

const readBodyBuffer = async (req) => {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > MAX_UPLOAD_BYTES) {
      throw createHttpError(413, 'File too large. Max size is 4MB.');
    }
    if (!req.body.length) {
      throw createHttpError(400, 'Upload payload is empty.');
    }
    return req.body;
  }

  if (typeof req.body === 'string') {
    const body = Buffer.from(req.body);
    if (body.length > MAX_UPLOAD_BYTES) {
      throw createHttpError(413, 'File too large. Max size is 4MB.');
    }
    if (!body.length) {
      throw createHttpError(400, 'Upload payload is empty.');
    }
    return body;
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += next.length;
    if (total > MAX_UPLOAD_BYTES) {
      throw createHttpError(413, 'File too large. Max size is 4MB.');
    }
    chunks.push(next);
  }

  if (!total) {
    throw createHttpError(400, 'Upload payload is empty.');
  }
  return Buffer.concat(chunks, total);
};

const getQueryParam = (req, key) => {
  const host = req.headers.host || 'localhost';
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const requestUrl = new URL(req.url || '/', `${protocol}://${host}`);
  return asTrimmed(requestUrl.searchParams.get(key));
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

    const shareId = getQueryParam(req, 'shareId');
    if (!shareId) {
      throw createHttpError(400, 'shareId is required.');
    }

    const projectId = getQueryParam(req, 'projectId');
    if (!projectId) {
      throw createHttpError(400, 'projectId is required.');
    }

    const fileName = getQueryParam(req, 'fileName');
    if (!fileName) {
      throw createHttpError(400, 'fileName is required.');
    }

    const shareRef = adminDb.collection(PROJECT_SHARES_COLLECTION).doc(shareId);
    const snapshot = await shareRef.get();
    if (!snapshot.exists) {
      throw createHttpError(404, 'Share link not found.');
    }

    const share = snapshot.data() || {};
    const linkedProjectId = asTrimmed(share.projectId);
    if (!linkedProjectId || linkedProjectId !== projectId) {
      throw createHttpError(409, 'Share link does not match this project.');
    }

    if (computeShareStatus(share) !== 'active') {
      throw createHttpError(409, 'Only active share links can receive media uploads.');
    }

    const payload = await readBodyBuffer(req);
    const mimeType = asTrimmed(req.headers['x-file-type']) || asTrimmed(req.headers['content-type']) || 'application/octet-stream';
    const blob = await put(buildBlobPath({ projectId, shareId, fileName }), payload, {
      access: 'public',
      addRandomSuffix: false,
      contentType: mimeType,
    });

    return json(res, 200, {
      url: blob.url,
      storagePath: `vercel-blob:${blob.url}`,
      mimeType,
      sizeBytes: payload.length,
    });
  } catch (error) {
    return handleRouteError(res, error, 'Failed to upload media file.');
  }
}

import crypto from 'crypto';
import { del } from '@vercel/blob';
import { adminStorageBucket } from './firebaseAdmin.js';
import { createHttpError } from './http.js';
import { nowIso, parseOptionalIsoDate } from './projectShareCore.js';

const MAX_MEDIA_ITEMS_PER_SHARE = 24;
const MAX_MEDIA_NAME_LENGTH = 180;
const MAX_STORAGE_PATH_LENGTH = 1024;
const MAX_MIME_TYPE_LENGTH = 120;
const MAX_MEDIA_SIZE_BYTES = 50 * 1024 * 1024;
const VERCEL_BLOB_STORAGE_PREFIX = 'vercel-blob:';

const asTrimmedString = (value, maxLength) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, maxLength);
};

const coerceHttpUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const coerceStoragePath = (value) => {
  const path = asTrimmedString(value, MAX_STORAGE_PATH_LENGTH);
  if (!path) return null;
  if (path.includes('..')) return null;
  if (path.startsWith('/') || path.startsWith('\\')) return null;
  return path;
};

const extractVercelBlobUrl = (storagePath) => {
  if (typeof storagePath !== 'string') return null;
  const raw = storagePath.trim();
  if (!raw.startsWith(VERCEL_BLOB_STORAGE_PREFIX)) return null;
  return coerceHttpUrl(raw.slice(VERCEL_BLOB_STORAGE_PREFIX.length));
};

const coerceSizeBytes = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 0 || value > MAX_MEDIA_SIZE_BYTES) return null;
    return Math.floor(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_MEDIA_SIZE_BYTES) {
      return Math.floor(parsed);
    }
  }
  return null;
};

const normalizeMediaEntry = (entry, index) => {
  if (!entry || typeof entry !== 'object') return null;

  const id = asTrimmedString(entry.id, 64) || `pm-${index + 1}`;
  const name = asTrimmedString(entry.name, MAX_MEDIA_NAME_LENGTH) || 'Project file';
  const url = coerceHttpUrl(entry.url);
  const storagePath = coerceStoragePath(entry.storagePath);
  if (!url || !storagePath) return null;

  const mimeType = asTrimmedString(entry.mimeType, MAX_MIME_TYPE_LENGTH) || null;
  const sizeBytes = coerceSizeBytes(entry.sizeBytes);
  const createdAt = parseOptionalIsoDate(entry.createdAt);

  return {
    id,
    name,
    url,
    storagePath,
    mimeType,
    sizeBytes,
    createdAt,
  };
};

export const normalizePortalMedia = (media) => {
  if (!Array.isArray(media)) return [];
  const normalized = media
    .map((entry, index) => normalizeMediaEntry(entry, index))
    .filter((entry) => !!entry);

  return normalized.slice(0, MAX_MEDIA_ITEMS_PER_SHARE);
};

export const assertPortalMediaCapacity = (existingMedia) => {
  if (existingMedia.length >= MAX_MEDIA_ITEMS_PER_SHARE) {
    throw createHttpError(
      409,
      `Portal media limit reached (${MAX_MEDIA_ITEMS_PER_SHARE} files). Remove old media by revoking and regenerating the link.`,
    );
  }
};

export const buildPortalMediaFromPayload = (payload) => {
  const name = asTrimmedString(payload.fileName, MAX_MEDIA_NAME_LENGTH) || 'Project file';
  const url = coerceHttpUrl(payload.url);
  const storagePath = coerceStoragePath(payload.storagePath);
  if (!url) {
    throw createHttpError(400, 'A valid media URL is required.');
  }
  if (!storagePath) {
    throw createHttpError(400, 'A valid storagePath is required.');
  }

  const mimeType = asTrimmedString(payload.mimeType, MAX_MIME_TYPE_LENGTH) || null;
  const sizeBytes = coerceSizeBytes(payload.sizeBytes);

  return {
    id: `pm_${crypto.randomBytes(8).toString('hex')}`,
    name,
    url,
    storagePath,
    mimeType,
    sizeBytes,
    createdAt: nowIso(),
  };
};

export const deletePortalMediaFiles = async (media) => {
  const normalized = normalizePortalMedia(media);
  if (!normalized.length) {
    return { requested: 0, deleted: 0, failed: 0 };
  }
  const vercelBlobUrls = [];
  const firebaseEntries = [];
  normalized.forEach((entry) => {
    const blobUrl = extractVercelBlobUrl(entry.storagePath);
    if (blobUrl) {
      vercelBlobUrls.push(blobUrl);
      return;
    }
    firebaseEntries.push(entry);
  });

  const tasks = [];
  if (vercelBlobUrls.length > 0) {
    const uniqueUrls = [...new Set(vercelBlobUrls)];
    tasks.push(...uniqueUrls.map((url) => del(url)));
  }
  if (firebaseEntries.length > 0) {
    if (!adminStorageBucket) {
      tasks.push(...firebaseEntries.map(() => Promise.reject(new Error('Firebase Storage bucket unavailable.'))));
    } else {
      tasks.push(
        ...firebaseEntries.map((entry) => adminStorageBucket.file(entry.storagePath).delete({ ignoreNotFound: true })),
      );
    }
  }

  const settled = await Promise.allSettled(tasks);

  let deleted = 0;
  let failed = 0;
  settled.forEach((result) => {
    if (result.status === 'fulfilled') deleted += 1;
    else failed += 1;
  });

  return {
    requested: normalized.length,
    deleted,
    failed,
  };
};

export const revokeShareAndDeleteMedia = async ({ shareRef, shareData, revokedBy, now }) => {
  const revokedAt = typeof now === 'string' && now.trim() ? now.trim() : nowIso();
  const media = normalizePortalMedia(shareData?.media);
  const deletion = await deletePortalMediaFiles(media);

  await shareRef.update({
    status: 'revoked',
    revokedAt,
    revokedBy: revokedBy || 'system',
    updatedAt: revokedAt,
    media: [],
    mediaDeletedAt: revokedAt,
    mediaDeletedCount: deletion.deleted,
  });

  return deletion;
};

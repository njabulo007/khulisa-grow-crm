import crypto from 'crypto';

export const OWNER_EMAILS = new Set(['njabulo@khulisamedia.co.za', 'njabulod007@gmail.com']);
export const PROJECT_SHARES_COLLECTION = 'project_shares';
export const PROJECTS_COLLECTION = 'projects';
export const CLIENTS_COLLECTION = 'clients';

export const nowIso = () => new Date().toISOString();

const normalizeDateInput = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString();
  }
  if (typeof value.toDate === 'function') {
    const converted = value.toDate();
    if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
      return converted.toISOString();
    }
  }
  return null;
};

export const parseOptionalIsoDate = (value) => normalizeDateInput(value);

export const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export const isProjectClosed = (status) => status === 'completed' || status === 'delivered';

export const computeShareStatus = (share) => {
  const expiresAt = parseOptionalIsoDate(share.expiresAt);
  const revokedAt = parseOptionalIsoDate(share.revokedAt);
  const status = typeof share.status === 'string' ? share.status : 'active';

  if (status === 'revoked' || revokedAt) return 'revoked';
  if (status === 'expired') return 'expired';
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return 'expired';
  return 'active';
};

export const sanitizeMilestones = (milestones) => {
  if (!Array.isArray(milestones)) return [];
  return milestones.map((milestone, index) => {
    const entry = milestone && typeof milestone === 'object' ? milestone : {};
    const title = typeof entry.title === 'string' && entry.title.trim()
      ? entry.title.trim()
      : typeof entry.name === 'string' && entry.name.trim()
        ? entry.name.trim()
        : `Milestone ${index + 1}`;
    const description = typeof entry.description === 'string' ? entry.description.trim() : '';
    const isCompleted = entry.isCompleted === true || entry.completed === true;
    return {
      id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `m-${index + 1}`,
      title,
      description: description || null,
      isCompleted,
      completedAt: parseOptionalIsoDate(entry.completedAt),
    };
  });
};

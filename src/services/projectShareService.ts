import { auth } from '@/lib/firebase';
import { storage } from '@/lib/firebase';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';

export type ProjectShareStatus = 'active' | 'revoked' | 'expired';

export interface ProjectShareMediaRecord {
  id: string;
  name: string;
  url: string;
  storagePath: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string | null;
}

export interface ProjectShareRecord {
  id: string;
  projectId: string;
  clientId: string;
  status: ProjectShareStatus;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string | null;
  lastViewedAt: string | null;
  media: ProjectShareMediaRecord[];
}

export interface ProjectShareCreateResult {
  shareId: string;
  token: string;
  url: string;
  projectId: string;
  clientId: string;
  expiresAt: string;
  status: ProjectShareStatus;
}

export interface PublicProjectPortalData {
  share: {
    id: string;
    expiresAt: string | null;
    status: ProjectShareStatus;
    media: ProjectShareMediaRecord[];
  };
  client: {
    id: string;
    businessName: string;
  };
  project: {
    id: string;
    name: string;
    status: string;
    packageName: string | null;
    packageId: string | null;
    startDate: string | null;
    dueDate: string | null;
    notes: string;
    driveLink: string | null;
    milestones: Array<{
      id: string;
      title: string;
      description: string | null;
      isCompleted: boolean;
      completedAt: string | null;
    }>;
    updatedAt: string | null;
  };
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').trim();

const getApiUrl = (path: string): string => {
  if (API_BASE) {
    return `${API_BASE.replace(/\/$/, '')}${path}`;
  }
  return path;
};

const sanitizeFileName = (rawName: string): string => {
  const cleaned = rawName
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!cleaned) return 'project-file';
  return cleaned.slice(0, 120);
};

const createStoragePath = (projectId: string, shareId: string, fileName: string): string => {
  const safeFileName = sanitizeFileName(fileName);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `project-portals/${projectId}/${shareId}/${Date.now()}-${randomPart}-${safeFileName}`;
};

const getAuthHeader = async (): Promise<string> => {
  if (!auth?.currentUser) {
    throw new Error('Please sign in again and retry.');
  }
  const token = await auth.currentUser.getIdToken();
  if (!token) {
    throw new Error('Please sign in again and retry.');
  }
  return `Bearer ${token}`;
};

const requestJson = async <T>(
  path: string,
  payload: Record<string, unknown>,
  includeAuth: boolean
): Promise<T> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (includeAuth) {
    headers.Authorization = await getAuthHeader();
  }

  const response = await fetch(getApiUrl(path), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // Keep parsing best-effort and fallback below.
  }

  if (!response.ok) {
    if (data && typeof data === 'object' && 'error' in data) {
      throw new Error(String((data as { error?: string }).error || 'Request failed.'));
    }
    throw new Error('Request failed.');
  }

  return data as T;
};

const asErrorMessage = (error: unknown): string => {
  if (error && typeof error === 'object') {
    const code = 'code' in error ? String(error.code || '') : '';
    const message = 'message' in error ? String(error.message || '') : '';
    const normalizedCode = code.trim().toLowerCase();
    const normalizedMessage = message.trim().toLowerCase();

    if (normalizedCode === 'functions/permission-denied') {
      return 'You do not have permission for this action.';
    }
    if (normalizedCode === 'functions/unauthenticated') {
      return 'Please sign in again and retry.';
    }
    if (normalizedCode === 'functions/not-found') {
      return 'Project sharing functions are not deployed yet.';
    }
    if (normalizedCode === 'functions/unavailable' || normalizedCode === 'functions/deadline-exceeded') {
      return 'Project sharing service is temporarily unavailable. Try again shortly.';
    }
    if (normalizedCode === 'functions/internal') {
      return 'Project sharing functions are unavailable. Deploy latest functions and retry.';
    }

    if (normalizedMessage.includes('internal')) {
      return 'Project sharing functions are unavailable. Deploy latest functions and retry.';
    }
    if (normalizedMessage.includes('not found')) {
      return 'Project sharing functions are not deployed yet.';
    }
    if (message) {
      return message;
    }
  }
  return 'Unexpected error.';
};

export const projectShareService = {
  async create(projectId: string, expiresAt?: string): Promise<ProjectShareCreateResult> {
    try {
      const data = await requestJson<ProjectShareCreateResult>(
        '/api/project-shares/create',
        { projectId, expiresAt },
        true
      );
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      return {
        ...data,
        url: origin ? `${origin}/p/${data.token}` : `/p/${data.token}`,
      };
    } catch (error) {
      throw new Error(asErrorMessage(error));
    }
  },

  async list(projectId: string): Promise<ProjectShareRecord[]> {
    try {
      const response = await requestJson<{ shares: ProjectShareRecord[] }>(
        '/api/project-shares/list',
        { projectId },
        true
      );
      return Array.isArray(response.shares) ? response.shares : [];
    } catch (error) {
      throw new Error(asErrorMessage(error));
    }
  },

  async revoke(shareId: string): Promise<void> {
    try {
      await requestJson<{ ok: boolean }>('/api/project-shares/revoke', { shareId }, true);
    } catch (error) {
      throw new Error(asErrorMessage(error));
    }
  },

  async addMedia(projectId: string, shareId: string, file: File): Promise<ProjectShareMediaRecord> {
    const objectRef = ref(storage, createStoragePath(projectId, shareId, file.name));
    try {
      await uploadBytes(objectRef, file, {
        contentType: file.type || 'application/octet-stream',
      });
      const url = await getDownloadURL(objectRef);
      const response = await requestJson<{ media: ProjectShareMediaRecord }>(
        '/api/project-shares/media-add',
        {
          shareId,
          projectId,
          fileName: file.name,
          url,
          storagePath: objectRef.fullPath,
          mimeType: file.type || null,
          sizeBytes: Number.isFinite(file.size) ? file.size : null,
        },
        true
      );
      return response.media;
    } catch (error) {
      try {
        await deleteObject(objectRef);
      } catch {
        // Best-effort rollback of orphaned uploads.
      }
      throw new Error(asErrorMessage(error));
    }
  },

  async resolve(token: string): Promise<PublicProjectPortalData> {
    try {
      return await requestJson<PublicProjectPortalData>('/api/project-shares/resolve', { token }, false);
    } catch (error) {
      throw new Error(asErrorMessage(error));
    }
  },
};

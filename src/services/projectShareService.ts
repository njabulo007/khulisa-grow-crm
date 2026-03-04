import { auth } from '@/lib/firebase';

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
const API_REQUEST_TIMEOUT_MS = 45_000;
const MEDIA_ADD_TIMEOUT_MS = 120_000;
const MEDIA_UPLOAD_TIMEOUT_MS = 4 * 60_000;
const MEDIA_UPLOAD_DELETE_TIMEOUT_MS = 20_000;

const getApiUrl = (path: string): string => {
  if (API_BASE) {
    return `${API_BASE.replace(/\/$/, '')}${path}`;
  }
  return path;
};

interface AddMediaOptions {
  onProgress?: (percent: number) => void;
  onStatusChange?: (status: 'preparing' | 'uploading' | 'finalizing' | 'slow-network' | 'retrying') => void;
}

interface RequestOptions {
  timeoutMs?: number;
}

const getAuthHeader = async (): Promise<string> => {
  if (!auth?.currentUser) {
    throw new Error('Please sign in again and retry.');
  }
  const token = await Promise.race([
    auth.currentUser.getIdToken(),
    new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error('Session refresh timed out. Please sign in again.')), 15_000);
    }),
  ]);
  if (!token) {
    throw new Error('Please sign in again and retry.');
  }
  return `Bearer ${token}`;
};

interface PortalUploadResponse {
  url: string;
  storagePath: string;
  mimeType: string | null;
  sizeBytes: number | null;
}

const uploadPortalMediaFile = async (
  projectId: string,
  shareId: string,
  file: File,
  options?: AddMediaOptions
): Promise<PortalUploadResponse> => {
  options?.onStatusChange?.('uploading');
  options?.onProgress?.(8);

  const authHeader = await getAuthHeader();
  const params = new URLSearchParams({
    projectId,
    shareId,
    fileName: file.name,
  });
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId =
    controller && MEDIA_UPLOAD_TIMEOUT_MS > 0
      ? setTimeout(() => controller.abort(), MEDIA_UPLOAD_TIMEOUT_MS)
      : null;

  let response: Response;
  try {
    response = await fetch(getApiUrl(`/api/project-shares/media-upload?${params.toString()}`), {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        ...(file.type ? { 'x-file-type': file.type } : {}),
      },
      body: file,
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new Error('Upload timed out. Please retry.');
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Keep parsing best-effort and fallback below.
  }

  if (!response.ok) {
    if (payload && typeof payload === 'object' && 'error' in payload) {
      throw new Error(String((payload as { error?: string }).error || 'Upload failed.'));
    }
    throw new Error('Upload failed.');
  }

  const uploaded = payload as Partial<PortalUploadResponse> | null;
  if (!uploaded?.url || !uploaded?.storagePath) {
    throw new Error('Upload succeeded but response is missing file metadata.');
  }

  options?.onProgress?.(96);
  return {
    url: uploaded.url,
    storagePath: uploaded.storagePath,
    mimeType: uploaded.mimeType ?? file.type ?? null,
    sizeBytes: typeof uploaded.sizeBytes === 'number' ? uploaded.sizeBytes : file.size,
  };
};

const requestJson = async <T>(
  path: string,
  payload: Record<string, unknown>,
  includeAuth: boolean,
  requestOptions?: RequestOptions
): Promise<T> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (includeAuth) {
    headers.Authorization = await getAuthHeader();
  }

  const timeoutMs = requestOptions?.timeoutMs ?? API_REQUEST_TIMEOUT_MS;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  if (controller && timeoutMs > 0) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  let response: Response;
  try {
    response = await fetch(getApiUrl(path), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new Error('The request timed out. Please retry.');
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

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

const deleteUploadedPortalMedia = async (storagePath: string): Promise<void> => {
  await requestJson<{ ok: boolean }>(
    '/api/project-shares/media-delete',
    { storagePath },
    true,
    { timeoutMs: MEDIA_UPLOAD_DELETE_TIMEOUT_MS }
  );
};

const asErrorMessage = (error: unknown): string => {
  if (error && typeof error === 'object') {
    const code = 'code' in error ? String(error.code || '') : '';
    const message = 'message' in error ? String(error.message || '') : '';
    const normalizedCode = code.trim().toLowerCase();
    const normalizedMessage = message.trim().toLowerCase();
    const looksLikeCorsPreflightFailure =
      normalizedMessage.includes('cors') ||
      normalizedMessage.includes('preflight') ||
      normalizedMessage.includes('xmlhttprequest') ||
      normalizedMessage.includes('access control');

    if (normalizedCode.startsWith('storage/')) {
      if (normalizedCode === 'storage/unauthorized') {
        return 'Storage permission denied. Check Firebase Storage rules for signed-in owners.';
      }
      if (normalizedCode === 'storage/canceled') {
        return 'Upload was canceled.';
      }
      if (normalizedCode === 'storage/retry-limit-exceeded') {
        return 'Upload retry limit exceeded. Check network and retry.';
      }
      if (normalizedCode === 'storage/quota-exceeded') {
        return 'Storage quota exceeded. Upgrade Firebase plan or clear space.';
      }
      if (normalizedCode === 'storage/unknown') {
        if (looksLikeCorsPreflightFailure) {
          return 'Storage upload blocked by bucket CORS/preflight. Apply storage.cors.json to your real bucket (for this project likely gs://khulisa-grow-crm.firebasestorage.app), then retry.';
        }
        return message || 'Storage upload failed unexpectedly.';
      }
      return message || 'Storage upload failed.';
    }

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

  async addMedia(
    projectId: string,
    shareId: string,
    file: File,
    options?: AddMediaOptions
  ): Promise<ProjectShareMediaRecord> {
    options?.onStatusChange?.('preparing');
    const uploadFile = file;
    let uploadedStoragePath: string | null = null;
    try {
      const uploaded = await uploadPortalMediaFile(projectId, shareId, uploadFile, options);
      uploadedStoragePath = uploaded.storagePath;
      options?.onStatusChange?.('finalizing');
      const response = await requestJson<{ media: ProjectShareMediaRecord }>(
        '/api/project-shares/media-add',
        {
          shareId,
          projectId,
          fileName: uploadFile.name,
          url: uploaded.url,
          storagePath: uploaded.storagePath,
          mimeType: uploaded.mimeType,
          sizeBytes: uploaded.sizeBytes,
        },
        true,
        { timeoutMs: MEDIA_ADD_TIMEOUT_MS }
      );
      options?.onProgress?.(100);
      return response.media;
    } catch (error) {
      try {
        if (uploadedStoragePath) {
          await deleteUploadedPortalMedia(uploadedStoragePath);
        }
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

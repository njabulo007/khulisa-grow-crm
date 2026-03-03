import { auth } from '@/lib/firebase';
import { storage } from '@/lib/firebase';
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';

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
const MEDIA_GET_URL_TIMEOUT_MS = 45_000;
const MEDIA_UPLOAD_SLOW_THRESHOLD_MS = 25_000;
const MEDIA_UPLOAD_RESUME_AFTER_MS = 40_000;
const MEDIA_UPLOAD_HARD_TIMEOUT_MS = 3 * 60_000;
const MEDIA_UPLOAD_MAX_RESUME_ATTEMPTS = 2;
const MEDIA_UPLOAD_MAX_ATTEMPTS = 2;
const IMAGE_OPTIMIZE_MIN_BYTES = 750 * 1024;
const IMAGE_OPTIMIZE_MAX_DIMENSION = 1920;

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

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  return await new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
};

const loadImageElement = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Image could not be processed.'));
    };
    img.src = objectUrl;
  });

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> =>
  new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });

const optimizeImageIfNeeded = async (file: File): Promise<File> => {
  const mime = (file.type || '').toLowerCase();
  const isOptimizableImage = mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/webp';
  if (!isOptimizableImage || file.size < IMAGE_OPTIMIZE_MIN_BYTES || typeof window === 'undefined') {
    return file;
  }

  try {
    const image = await withTimeout(loadImageElement(file), 8_000, 'Image optimization timed out.');
    const largestSide = Math.max(image.naturalWidth, image.naturalHeight);
    if (largestSide <= IMAGE_OPTIMIZE_MAX_DIMENSION) {
      return file;
    }

    const scale = IMAGE_OPTIMIZE_MAX_DIMENSION / largestSide;
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return file;
    }

    context.drawImage(image, 0, 0, width, height);
    const outputType = mime === 'image/webp' ? 'image/webp' : 'image/jpeg';
    const blob = await canvasToBlob(canvas, outputType, 0.8);
    if (!blob || blob.size >= file.size * 0.92) {
      return file;
    }

    return new File([blob], file.name, {
      type: outputType,
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
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

  async addMedia(
    projectId: string,
    shareId: string,
    file: File,
    options?: AddMediaOptions
  ): Promise<ProjectShareMediaRecord> {
    options?.onStatusChange?.('preparing');
    const uploadFile = await optimizeImageIfNeeded(file);
    const objectRef = ref(storage, createStoragePath(projectId, shareId, uploadFile.name));
    try {
      options?.onStatusChange?.('uploading');
      let uploadCompleted = false;
      let uploadError: unknown = null;

      for (let attempt = 1; attempt <= MEDIA_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
        if (attempt > 1) {
          options?.onStatusChange?.('retrying');
          options?.onProgress?.(Math.max(5, Math.min(90, 5 * attempt)));
        }

        try {
          const uploadTask = uploadBytesResumable(objectRef, uploadFile, {
            contentType: uploadFile.type || 'application/octet-stream',
          });
          await new Promise<void>((resolve, reject) => {
            let settled = false;
            let hardTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
            let slowNetworkTimer: ReturnType<typeof setTimeout> | null = null;
            let resumeTimer: ReturnType<typeof setTimeout> | null = null;
            let resumeAttempts = 0;

            const clearTimers = () => {
              if (hardTimeoutTimer) {
                clearTimeout(hardTimeoutTimer);
                hardTimeoutTimer = null;
              }
              if (slowNetworkTimer) {
                clearTimeout(slowNetworkTimer);
                slowNetworkTimer = null;
              }
              if (resumeTimer) {
                clearTimeout(resumeTimer);
                resumeTimer = null;
              }
            };

            const armSlowNetworkTimer = () => {
              if (slowNetworkTimer) {
                clearTimeout(slowNetworkTimer);
              }
              slowNetworkTimer = setTimeout(() => {
                if (settled) return;
                options?.onStatusChange?.('slow-network');
              }, MEDIA_UPLOAD_SLOW_THRESHOLD_MS);
            };

            const armResumeTimer = () => {
              if (resumeTimer) {
                clearTimeout(resumeTimer);
              }
              resumeTimer = setTimeout(() => {
                if (settled) return;
                if (resumeAttempts >= MEDIA_UPLOAD_MAX_RESUME_ATTEMPTS) return;
                resumeAttempts += 1;
                options?.onStatusChange?.('slow-network');
                try {
                  uploadTask.pause();
                  setTimeout(() => {
                    try {
                      uploadTask.resume();
                    } catch {
                      // Ignore and let timeout/retry handle it.
                    }
                  }, 300);
                } catch {
                  // Ignore and let timeout/retry handle it.
                }
                armSlowNetworkTimer();
                armResumeTimer();
              }, MEDIA_UPLOAD_RESUME_AFTER_MS);
            };

            hardTimeoutTimer = setTimeout(() => {
              if (settled) return;
              settled = true;
              uploadTask.cancel();
              reject(new Error('Upload timed out. Please retry.'));
            }, MEDIA_UPLOAD_HARD_TIMEOUT_MS);

            armSlowNetworkTimer();
            armResumeTimer();

            uploadTask.on(
              'state_changed',
              (snapshot) => {
                armSlowNetworkTimer();
                armResumeTimer();
                if (typeof options?.onProgress === 'function') {
                  const progress =
                    snapshot.totalBytes > 0
                      ? Math.min(100, Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100))
                      : 0;
                  options.onProgress(Math.min(95, Math.max(1, progress)));
                }
              },
              (error) => {
                if (settled) return;
                settled = true;
                clearTimers();
                reject(error);
              },
              () => {
                if (settled) return;
                settled = true;
                clearTimers();
                options?.onProgress?.(96);
                resolve();
              }
            );
          });
          uploadCompleted = true;
          uploadError = null;
          break;
        } catch (error) {
          uploadError = error;
          if (attempt >= MEDIA_UPLOAD_MAX_ATTEMPTS) {
            throw error;
          }
        }
      }

      if (!uploadCompleted) {
        throw uploadError instanceof Error ? uploadError : new Error('Upload failed. Please retry.');
      }

      options?.onStatusChange?.('finalizing');
      const url = await withTimeout(
        getDownloadURL(objectRef),
        MEDIA_GET_URL_TIMEOUT_MS,
        'Upload completed but URL generation timed out. Please retry.'
      );
      const response = await requestJson<{ media: ProjectShareMediaRecord }>(
        '/api/project-shares/media-add',
        {
          shareId,
          projectId,
          fileName: uploadFile.name,
          url,
          storagePath: objectRef.fullPath,
          mimeType: uploadFile.type || null,
          sizeBytes: Number.isFinite(uploadFile.size) ? uploadFile.size : null,
        },
        true,
        { timeoutMs: MEDIA_ADD_TIMEOUT_MS }
      );
      options?.onProgress?.(100);
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

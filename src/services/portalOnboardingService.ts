import { authenticatedPost } from "./apiClient";
export interface OnboardingFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
}
export interface OnboardingData {
  legacyCompleted?: boolean;
  projectId: string;
  status: string;
  version: number;
  templateIds: string[];
  answers: Record<string, string>;
  files: OnboardingFile[];
  feedback: string;
  submission: number;
  submittedAt: string | null;
  updatedAt: string | null;
  missing: string[];
  editable: boolean;
}
export interface OnboardingRevision {
  submission: number;
  answers: Record<string, string>;
  files: OnboardingFile[];
  templateIds: string[];
  submittedAt: string;
}
export async function publicOnboarding<T = OnboardingData>(
  token: string,
  action: string,
  payload: object = {},
  onProgress?: (percent: number) => void,
): Promise<T> {
  const base = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}/api/project-shares/resolve`);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.timeout = 60000;
    if (onProgress)
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable)
          onProgress(Math.min(95, Math.round((e.loaded / e.total) * 95)));
      };
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300)
          throw new Error(result.error || "Your change could not be saved.");
        onProgress?.(100);
        resolve(result);
      } catch (e) {
        reject(e);
      }
    };
    xhr.onerror = () =>
      reject(new Error("Connection lost. Keep your answers and retry."));
    xhr.ontimeout = () =>
      reject(
        new Error(
          "This is taking longer than expected. Retry with the same details.",
        ),
      );
    xhr.send(
      JSON.stringify({ token, action: `onboarding-${action}`, ...payload }),
    );
  });
}
export const staffOnboarding = <T = OnboardingData>(
  projectId: string,
  action: string,
  payload: object = {},
) =>
  authenticatedPost<T>("/api/notifications/push", {
    kind: "portal-onboarding",
    projectId,
    action,
    ...payload,
  });
export const fileBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
export function downloadOnboardingFile(file: {
  name: string;
  mimeType: string;
  base64: string;
}) {
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0)),
    url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

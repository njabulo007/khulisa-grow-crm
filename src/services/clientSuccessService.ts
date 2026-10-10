import { authenticatedPost } from "./apiClient";

export interface ClientFollowUp {
  id: string;
  clientId: string;
  clientName: string;
  followUpDate: string;
  waitingForResponse: boolean;
  notes: string;
  lastContactAt: string | null;
  userUid: string;
  mine: boolean;
}
export type RequestStatus =
  "received" | "in-progress" | "ready-for-review" | "completed";
export type RequestPriority = "low" | "normal" | "high" | "urgent";
export interface ClientRequest {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  description: string;
  category: string;
  priority: RequestPriority;
  status: RequestStatus;
  ownerUpdate: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  canEditFiles: boolean;
  attachments: Array<{
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  pendingAttachments: Array<{ id: string; name: string }>;
}
export const REQUEST_STAGES: Record<RequestStatus, string> = {
  received: "Received",
  "in-progress": "In Progress",
  "ready-for-review": "Ready for Review",
  completed: "Completed",
};
export const REQUEST_PRIORITIES: Record<RequestPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};
const request = <T>(kind: string, action: string, payload = {}) =>
  authenticatedPost<T>("/api/notifications/push", { kind, action, ...payload });
export const clientFollowUpService = {
  list: (clientId?: string, cursor?: string) =>
    request<{ followUps: ClientFollowUp[]; cursor: string | null }>(
      "client-follow-up",
      "list",
      { ...(clientId ? { clientId } : {}), ...(cursor ? { cursor } : {}) },
    ),
  save: (
    clientId: string,
    followUpDate: string,
    waitingForResponse: boolean,
    notes: string,
  ) =>
    request("client-follow-up", "save", {
      clientId,
      followUpDate,
      waitingForResponse,
      notes,
    }),
  cancel: (clientId: string) =>
    request("client-follow-up", "cancel", { clientId }),
  complete: (payload: {
    clientId: string;
    requestId: string;
    type: string;
    description: string;
    nextFollowUpDate: string;
    waitingForResponse: boolean;
    notes: string;
  }) => request("client-follow-up", "complete", payload),
};
export const newClientRequestId = () => `${Date.now()}_${crypto.randomUUID()}`;
export const clientRequestService = {
  list: (clientId?: string, cursor?: string) =>
    request<{ requests: ClientRequest[]; cursor: string | null }>(
      "client-request",
      "list",
      { ...(clientId ? { clientId } : {}), ...(cursor ? { cursor } : {}) },
    ),
  create: (payload: {
    clientId: string;
    requestId: string;
    title: string;
    description: string;
    category: string;
    priority: RequestPriority;
  }) => request<{ requestId: string }>("client-request", "create", payload),
  updateStatus: (
    record: ClientRequest,
    status: RequestStatus,
    ownerUpdate: string,
  ) =>
    request("client-request", "status", {
      requestId: record.id,
      version: record.version,
      status,
      ownerUpdate,
    }),
  async upload(requestId: string, attachmentId: string, file: File) {
    if (file.size > 2 * 1024 * 1024 || !file.size)
      throw new Error("Each attachment must be between 1 byte and 2 MB.");
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () =>
        reject(new Error("The attachment could not be read."));
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.readAsDataURL(file);
    });
    return request("client-request", "upload", {
      requestId,
      attachmentId,
      name: file.name,
      mimeType: file.type || "text/plain",
      content,
    });
  },
  removeAttachment: (requestId: string, attachmentId: string) =>
    request("client-request", "remove-attachment", { requestId, attachmentId }),
  async download(requestId: string, attachmentId: string) {
    const file = await request<{
      content: string;
      name: string;
      mimeType: string;
    }>("client-request", "download", { requestId, attachmentId });
    const url = URL.createObjectURL(
      new Blob(
        [
          Uint8Array.from(atob(file.content), (character) =>
            character.charCodeAt(0),
          ),
        ],
        { type: file.mimeType },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
export const clientWorkChanged = () =>
  window.dispatchEvent(new CustomEvent("crm:client-work-changed"));

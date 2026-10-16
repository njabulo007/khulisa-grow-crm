import { authenticatedPost } from "./apiClient";
import { publicProjectRequest } from "./portalOnboardingService";
export interface WorkspaceVersion {
  visibility: string;
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  number: number;
}
export interface WorkspaceFile {
  id: string;
  category: string;
  milestoneId: string;
  attention: boolean;
  visibility: string;
  origin: string;
  updatedAt: string;
  versions: WorkspaceVersion[];
  pending: { name: string; leaseUntil: number } | null;
  removing: boolean;
  canDelete: boolean;
  canReplace: boolean;
}
export interface ConversationMessage {
  unavailableAttachments?: boolean;
  attachmentVersions?: Record<string, string>;
  id: string;
  sender: "client" | "team";
  senderName: string;
  content: string;
  attachments: string[];
  createdAt: string;
}
export interface Conversation {
  id: string;
  title: string;
  status: string;
  waitingOn: string;
  version: number;
  updatedAt: string;
  assignedTo?: string;
  responsibility: string;
  lastSender: string;
  lastMessage: string;
  readAt?: string;
  messages?: ConversationMessage[];
}
export interface TrackedMilestone {
  id: string;
  title: string;
  description: string;
  status: string;
  isCompleted: boolean;
  completedAt: string | null;
  expectedDate: string;
  responsibleParty: string;
  dependsOn: string[];
  clientAction: string;
  order: number;
}
export interface WorkspaceData {
  version: number;
  files: WorkspaceFile[];
  onboardingFiles: Array<{
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  threads: Conversation[];
  cursor: string | null;
  milestones: TrackedMilestone[];
  milestoneVersion: number;
  projectStatus: string;
}
export function workspaceRequest<T = WorkspaceData>(
  { projectId, token }: { projectId?: string; token?: string },
  action: string,
  payload: object = {},
  onProgress?: (n: number) => void,
): Promise<T> {
  return projectId
    ? authenticatedPost<T>("/api/notifications/push", {
        kind: "project-workspace",
        projectId,
        action,
        ...payload,
      })
    : publicProjectRequest<T>(
        token,
        `workspace-${action}`,
        payload,
        onProgress,
      );
}

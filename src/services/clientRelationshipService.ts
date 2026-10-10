import { authenticatedPost } from "./apiClient";
export const FEEDBACK_DECISIONS = {
  approved: "Approved",
  rejected: "Rejected",
  "changes-requested": "Changes Requested",
} as const;
export const OPPORTUNITY_TYPES = {
  "additional-service": "Additional service",
  renewal: "Renewal",
  referral: "Referral",
} as const;
export const OPPORTUNITY_STAGES = {
  proposed: "Proposed",
  "needs-changes": "Needs Changes",
  approved: "Approved",
  declined: "Declined",
} as const;
export interface FeedbackInput {
  title: string;
  deliverableVersion: string;
  decision: keyof typeof FEEDBACK_DECISIONS;
  decisionDate: string;
  decidedBy: string;
  notes: string;
}
export interface FeedbackRecord extends FeedbackInput {
  id: string;
  clientId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface GrowthInput {
  title: string;
  type: keyof typeof OPPORTUNITY_TYPES;
  proposal: string;
  suggestedScope: string;
  suggestedPrice: number | null;
  targetDate: string;
}
export interface GrowthRecord extends GrowthInput {
  id: string;
  clientId: string;
  clientName?: string;
  version: number;
  status: keyof typeof OPPORTUNITY_STAGES;
  approvedScope: string;
  approvedPrice: number | null;
  ownerNote: string;
  canEditProposal: boolean;
  linkedInvoiceId?: string;
  proposedByName?: string;
  updatedAt: string;
}
const request = <T>(
  kind: "feedback" | "opportunity",
  action: string,
  payload: object,
) =>
  authenticatedPost<T>("/api/notifications/push", {
    kind: `client-${kind}`,
    action,
    ...payload,
  });
export const clientRelationshipService = {
  list: <T>(
    kind: "feedback" | "opportunity",
    clientId?: string,
    cursor?: string,
  ) =>
    request<{ records: T[]; cursor: string | null }>(kind, "list", {
      ...(clientId ? { clientId } : {}),
      ...(cursor ? { cursor } : {}),
    }),
  history: (
    kind: "feedback" | "opportunity",
    clientId: string,
    recordId: string,
    cursor?: string,
  ) =>
    request<{
      revisions: Array<FeedbackRecord | GrowthRecord>;
      cursor: string | null;
    }>(kind, "history", { clientId, recordId, ...(cursor ? { cursor } : {}) }),
  saveFeedback: (
    payload: FeedbackInput & {
      clientId: string;
      requestId: string;
      recordId?: string;
      version?: number;
    },
  ) =>
    request<FeedbackRecord>(
      "feedback",
      payload.recordId ? "revise" : "create",
      payload,
    ),
  saveGrowth: (
    payload: GrowthInput & {
      clientId: string;
      requestId: string;
      recordId?: string;
      version?: number;
    },
  ) =>
    request<GrowthRecord>(
      "opportunity",
      payload.recordId ? "revise" : "create",
      payload,
    ),
  reviewGrowth: (payload: {
    clientId: string;
    recordId: string;
    version: number;
    requestId: string;
    status: "approved" | "needs-changes" | "declined";
    approvedScope: string;
    approvedPrice: number | null;
    ownerNote: string;
  }) => request<GrowthRecord>("opportunity", "review", payload),
};

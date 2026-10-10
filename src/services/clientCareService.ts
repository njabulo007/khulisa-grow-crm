import { authenticatedPost } from "./apiClient";
export const HEALTH_LABELS = {
  healthy: "Healthy",
  "needs-attention": "Needs Attention",
  "at-risk": "At Risk",
} as const;
export const CHECKLIST_ITEMS = {
  logo: "Logo and brand assets",
  content: "Website content",
  access: "Access credentials",
  contract: "Signed contract",
  requirements: "Client requirements",
} as const;
export const CHECKLIST_STATES = {
  outstanding: "Outstanding",
  requested: "Requested",
  received: "Received",
  "not-required": "Not Required",
} as const;
export type HealthStatus = keyof typeof HEALTH_LABELS;
export type Checklist = Record<
  keyof typeof CHECKLIST_ITEMS,
  { status: keyof typeof CHECKLIST_STATES; notes: string }
>;
export interface ClientCare {
  version: number;
  health: {
    status: HealthStatus;
    reason: string;
    updatedAt: string;
    updatedBy: string;
  } | null;
  lastContactAt: string | null;
  escalation: {
    status: "open" | "resolved";
    reason: string;
    raisedAt: string;
    resolution?: string;
    resolvedAt?: string;
  } | null;
  checklist: Checklist;
  legacyCompleted: boolean;
  onboardingCompleted: boolean;
  completedItems: number;
}
export type CareSummary = ClientCare & { clientId: string; clientName: string };
export const contactDate = (value: string | null) => {
  if (!value) return "";
  if (value.length === 10) return value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const field = (name: string) =>
    parts.find((part) => part.type === name)?.value;
  return `${field("year")}-${field("month")}-${field("day")}`;
};
const request = <T>(action: string, payload: object) =>
  authenticatedPost<T>("/api/notifications/push", {
    kind: "client-care",
    action,
    ...payload,
  });
export const clientCareService = {
  get: (clientId: string) => request<ClientCare>("get", { clientId }),
  summary: (clientIds: string[]) =>
    request<{ clients: CareSummary[] }>("summary", { clientIds }),
  update: (action: "health" | "onboarding" | "resolve", payload: object) =>
    request<ClientCare>(action, payload),
};

import type { Project, ProjectStatus, User } from "@/types/models";
import { canAccessProject } from "./permissions";

export const AGENT_DELIVERY_STATUSES: ProjectStatus[] = [
  "not-started",
  "in-progress",
  "on-hold",
  "waiting-client",
];
const isClosed = (project: Project) =>
  ["completed", "delivered"].includes(project.status);

export const canEditProjectMilestones = (
  user: User | null | undefined,
  project: Project,
) =>
  canAccessProject(user, project) &&
  (user?.role === "owner" || !isClosed(project));

export const canChangeProjectDeliveryStatus = (
  user: User | null | undefined,
  project: Project,
  status: ProjectStatus,
) =>
  canAccessProject(user, project) &&
  (user?.role === "owner" ||
    (!isClosed(project) && AGENT_DELIVERY_STATUSES.includes(status)));

export const resolveDeliveryStatus = (
  calculated: ProjectStatus,
  current: ProjectStatus,
  role: User["role"],
): ProjectStatus => {
  if (role === "owner") return calculated;
  if (["completed", "delivered"].includes(current)) return current;
  return calculated === "completed" ? "in-progress" : calculated;
};

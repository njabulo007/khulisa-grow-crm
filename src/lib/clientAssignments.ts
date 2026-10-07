import type { Project } from '@/types/models';

// Store a project reference, rather than a permanent agent grant. Rules can
// recheck its current assignee even after reassignment or deletion.
export function getClientProjectAccess(projects: Pick<Project, 'id' | 'assignedTo'>[]): Record<string, string> {
  return Object.fromEntries(projects.filter((project) => project.id && project.assignedTo)
    .map((project) => [project.assignedTo, project.id]));
}

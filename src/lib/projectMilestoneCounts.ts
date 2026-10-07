import type { PackageId } from '@/config/packages';
import type { ProjectMilestone } from '@/types/models';

export interface ProjectMilestoneCounts {
  completed: number;
  total: number;
  progress: number;
}

export const getScopedProjectMilestoneCounts = (
  milestones: ProjectMilestone[] | null | undefined,
  _packageId: PackageId,
): ProjectMilestoneCounts => {
  const recorded = Array.isArray(milestones) ? milestones : [];
  const completed = recorded.filter((milestone) => Boolean(milestone.isCompleted ?? milestone.completed)).length;
  const total = recorded.length;
  return { completed, total, progress: total ? Math.round(completed / total * 100) : 0 };
};

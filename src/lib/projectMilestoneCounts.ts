import {milestoneSummary} from '../../shared/projectTracking.js';
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
  const {completed,total,progress}=milestoneSummary(recorded);
  return {completed,total,progress};
};

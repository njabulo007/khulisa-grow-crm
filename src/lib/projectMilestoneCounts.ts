import { getPackageCombinedFeatures, type PackageId } from '@/config/packages';
import type { ProjectMilestone } from '@/types/models';

const normalizeChecklistText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface ProjectMilestoneCounts {
  completed: number;
  total: number;
  progress: number;
}

export const getScopedProjectMilestoneCounts = (
  milestones: ProjectMilestone[] | null | undefined,
  packageId: PackageId,
): ProjectMilestoneCounts => {
  const normalizedMilestones = (Array.isArray(milestones) ? milestones : []).map((milestone, index) => ({
    title: String(milestone.title || milestone.name || `Milestone ${index + 1}`).trim(),
    isCompleted: Boolean(milestone.isCompleted ?? milestone.completed),
  }));
  const scopeFeatures = getPackageCombinedFeatures(packageId);

  if (scopeFeatures.length === 0) {
    const completed = normalizedMilestones.filter((milestone) => milestone.isCompleted).length;
    const total = normalizedMilestones.length;
    return { completed, total, progress: total > 0 ? Math.round((completed / total) * 100) : 0 };
  }

  const scopedCompletion = scopeFeatures.map((feature) => {
    const featureKey = normalizeChecklistText(feature);
    const matchedMilestone = normalizedMilestones.find((milestone) => {
      const milestoneKey = normalizeChecklistText(milestone.title);
      return (
        milestoneKey === featureKey ||
        milestoneKey.includes(featureKey) ||
        featureKey.includes(milestoneKey)
      );
    });
    return matchedMilestone?.isCompleted === true;
  });

  const completed = scopedCompletion.filter(Boolean).length;
  const total = scopedCompletion.length;
  return { completed, total, progress: total > 0 ? Math.round((completed / total) * 100) : 0 };
};

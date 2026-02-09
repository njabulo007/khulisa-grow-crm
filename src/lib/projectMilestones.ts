import { type PackageId } from '@/config/packages';
import { ProjectMilestone, ProjectStatus } from '@/types/models';
import { generateId } from '@/services/storage';

const PACKAGE_MILESTONE_TEMPLATES: Record<PackageId, Array<{ title: string; description?: string }>> = {
  'digital-starter-presence': [
    { title: 'Website or landing page complete' },
    { title: 'Google Business Profile setup complete' },
    { title: 'Branding refresh complete' },
  ],
  'local-growth-engine': [
    { title: 'Website complete' },
    { title: 'Google Business Profile optimisation complete' },
    { title: 'Local SEO setup complete' },
    { title: 'Facebook setup or refresh complete' },
  ],
  'business-brand-expansion': [
    { title: 'Website complete' },
    { title: 'Google Business Profile optimisation complete' },
    { title: 'Local SEO setup complete' },
    { title: 'Facebook setup or refresh complete' },
    { title: 'Ads campaign setup complete' },
    { title: 'Ads running and optimised' },
    { title: 'Reporting delivered' },
  ],
};

const LEGACY_TO_CURRENT_STATUS: Partial<Record<ProjectStatus, ProjectStatus>> = {
  'waiting-client': 'in-progress',
  delivered: 'completed',
};

export const normalizeProjectStatus = (status: ProjectStatus | string | null | undefined): ProjectStatus => {
  if (!status) return 'not-started';
  if (status === 'not-started' || status === 'in-progress' || status === 'completed' || status === 'on-hold') {
    return status;
  }
  if (status === 'waiting-client' || status === 'delivered') {
    return LEGACY_TO_CURRENT_STATUS[status] || 'not-started';
  }
  return 'not-started';
};

export const normalizeProjectMilestone = (
  milestone: Partial<ProjectMilestone> | null | undefined
): ProjectMilestone => {
  const title = String(milestone?.title || milestone?.name || 'Milestone').trim() || 'Milestone';
  const isCompleted = Boolean(milestone?.isCompleted ?? milestone?.completed);

  return {
    id: String(milestone?.id || generateId()),
    title,
    description: milestone?.description,
    isCompleted,
    completedAt: isCompleted ? milestone?.completedAt : undefined,
    // Legacy aliases retained so older UI paths continue to work while data migrates.
    name: title,
    completed: isCompleted,
  };
};

export const createProjectMilestonesForPackage = (packageId: PackageId): ProjectMilestone[] =>
  PACKAGE_MILESTONE_TEMPLATES[packageId].map((template) => {
    const title = template.title;
    return {
      id: generateId(),
      title,
      description: template.description,
      isCompleted: false,
      name: title,
      completed: false,
    };
  });

export const normalizeProjectMilestones = (
  milestones: ProjectMilestone[] | null | undefined,
  packageId: PackageId,
): ProjectMilestone[] => {
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return createProjectMilestonesForPackage(packageId);
  }
  return milestones.map((milestone) => normalizeProjectMilestone(milestone));
};

export const getAutoProjectStatusFromMilestones = (
  milestones: ProjectMilestone[],
  fallbackStatus: ProjectStatus,
): ProjectStatus => {
  if (fallbackStatus === 'on-hold') return 'on-hold';
  if (milestones.length === 0) return fallbackStatus;

  const completedCount = milestones.filter((milestone) => normalizeProjectMilestone(milestone).isCompleted).length;
  if (completedCount === 0) return 'not-started';
  if (completedCount === milestones.length) return 'completed';
  return 'in-progress';
};

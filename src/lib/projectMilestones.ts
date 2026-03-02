import { type PackageId } from '@/config/packages';
import { ProjectMilestone, ProjectStatus } from '@/types/models';
import { generateId } from '@/services/storage';

const PACKAGE_MILESTONE_TEMPLATES: Record<PackageId, Array<{ title: string; description?: string }>> = {
  'digital-starter-presence': [
    {
      title: '1 page website or landing page delivered',
      description: 'Publish the agreed page with brand-consistent structure and mobile readiness.',
    },
    {
      title: 'Google My Business setup complete (Basic)',
      description: 'Create or claim the profile with core business details and contact data.',
    },
    {
      title: 'Basic branding refresh complete',
      description: 'Apply logo touch-up and consistent visual style across deliverables.',
    },
    {
      title: 'WhatsApp enquiry button integrated',
      description: 'Ensure click-to-chat works correctly across mobile and desktop.',
    },
    {
      title: 'Flyer or promo graphic delivered',
      description: 'Provide final client-ready artwork in approved format.',
    },
  ],
  'local-growth-engine': [
    {
      title: '4-5 page website delivered',
      description: 'Launch all planned pages with conversion-focused structure.',
    },
    {
      title: 'Full Google My Business optimisation complete',
      description: 'Optimise profile content, categories, imagery, and operating details.',
    },
    {
      title: 'Local SEO setup complete',
      description: 'Implement local SEO fundamentals for visibility in nearby searches.',
    },
    {
      title: 'Facebook page setup or refresh complete',
      description: 'Configure page branding, business details, and content readiness.',
    },
    {
      title: 'Business photography assets optimised',
      description: 'Prepare and optimise selected product or business images for web/social use.',
    },
    {
      title: 'Contact forms and WhatsApp integration complete',
      description: 'Validate enquiry flows, routing, and response pathways.',
    },
    {
      title: 'Professional business email activated',
      description: 'Configure and test yourname@yourbusiness.co.za account access and sending.',
    },
  ],
  'business-brand-expansion': [
    {
      title: '4-5 page website delivered',
      description: 'Launch all planned pages with conversion-focused structure.',
    },
    {
      title: 'Full Google My Business optimisation complete',
      description: 'Optimise profile content, categories, imagery, and operating details.',
    },
    {
      title: 'Local SEO setup complete',
      description: 'Implement local SEO fundamentals for visibility in nearby searches.',
    },
    {
      title: 'Facebook page setup or refresh complete',
      description: 'Configure page branding, business details, and content readiness.',
    },
    {
      title: 'Business photography assets optimised',
      description: 'Prepare and optimise selected product or business images for web/social use.',
    },
    {
      title: 'Contact forms and WhatsApp integration complete',
      description: 'Validate enquiry flows, routing, and response pathways.',
    },
    {
      title: 'Professional business email activated',
      description: 'Configure and test yourname@yourbusiness.co.za account access and sending.',
    },
    {
      title: 'Paid Facebook advertising management launched',
      description: 'Set up ads manager structure and campaign control for ongoing management.',
    },
    {
      title: 'R1,500 ad spend allocation configured',
      description: 'Apply the included spend budget to approved campaign setup.',
    },
    {
      title: 'Campaign targeting and optimisation active',
      description: 'Validate targeting, creative rotation, and performance tuning.',
    },
    {
      title: 'Conversion tracking and performance summary delivered',
      description: 'Capture results and provide client-facing performance insights.',
    },
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

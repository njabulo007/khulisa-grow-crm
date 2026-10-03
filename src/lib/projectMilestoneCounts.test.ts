import { describe, expect, it } from 'vitest';
import { getScopedProjectMilestoneCounts } from './projectMilestoneCounts';

describe('getScopedProjectMilestoneCounts', () => {
  it('uses the package scope instead of legacy extra milestones', () => {
    const milestones = Array.from({ length: 15 }, (_, index) => ({
      id: `milestone-${index + 1}`,
      title: `Legacy milestone ${index + 1}`,
      isCompleted: index < 4,
    }));

    const result = getScopedProjectMilestoneCounts(milestones, 'business-brand-expansion');

    expect(result.total).toBe(11);
    expect(result.completed).toBe(0);
    expect(result.progress).toBe(0);
  });
});

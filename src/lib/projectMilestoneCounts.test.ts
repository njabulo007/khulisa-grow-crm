import { describe, expect, it } from 'vitest';
import { getScopedProjectMilestoneCounts } from './projectMilestoneCounts';

describe('getScopedProjectMilestoneCounts', () => {
  it('counts recorded and custom milestones consistently with the project and portal', () => {
    const milestones = Array.from({ length: 15 }, (_, index) => ({
      id: `milestone-${index + 1}`,
      title: `Legacy milestone ${index + 1}`,
      isCompleted: index < 4,
    }));

    const result = getScopedProjectMilestoneCounts(milestones, 'business-brand-expansion');

    expect(result.total).toBe(15);
    expect(result.completed).toBe(4);
    expect(result.progress).toBe(27);
  });
});

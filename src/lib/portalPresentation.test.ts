import { describe, expect, it } from 'vitest';
import { portalDeadline, safePortalUrl, summarizePortalMilestones } from './portalPresentation';

describe('client portal presentation', () => {
  it('uses only recorded milestone completion, including custom deliverables', () => {
    expect(summarizePortalMilestones([{ isCompleted: true }, { isCompleted: false }, { isCompleted: true }]))
      .toEqual({ total: 3, completed: 2, remaining: 1, progress: 67 });
    expect(summarizePortalMilestones([]).progress).toBe(0);
  });
  it('rejects executable and malformed file links', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,test', 'not a link', null]) expect(safePortalUrl(url)).toBeNull();
    expect(safePortalUrl('https://example.com/file.pdf')).toBe('https://example.com/file.pdf');
  });
  it('uses calendar days and avoids overdue warnings for completed or paused projects', () => {
    const now = new Date(2026, 9, 7, 15);
    expect(portalDeadline(new Date(2026, 9, 7, 0).toISOString(), 'in-progress', now)).toBe('Target date is today');
    expect(portalDeadline('2026-01-01', 'completed', now)).toBe('Project complete');
    expect(portalDeadline('2026-01-01', 'on-hold', now)).toBe('Timeline paused');
    expect(portalDeadline(null, 'in-progress', now)).toBe('Timeline to be confirmed');
  });
});

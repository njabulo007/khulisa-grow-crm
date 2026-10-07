export function safePortalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function summarizePortalMilestones<T extends { isCompleted: boolean }>(
  milestones: T[],
) {
  const total = milestones.length;
  const completed = milestones.filter((item) => item.isCompleted).length;
  return {
    total,
    completed,
    remaining: total - completed,
    progress: total ? Math.round((completed / total) * 100) : 0,
  };
}

export function portalDeadline(
  dueDate: string | null,
  status: string,
  now = new Date(),
): string {
  if (["completed", "delivered"].includes(status)) return "Project complete";
  if (status === "on-hold") return "Timeline paused";
  if (!dueDate) return "Timeline to be confirmed";
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return "Timeline to be confirmed";
  const todayKey = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const dueKey = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
  const days = Math.round((dueKey - todayKey) / 86400000);
  if (days < 0)
    return `${Math.abs(days)} day${days === -1 ? "" : "s"} past target`;
  return days === 0
    ? "Target date is today"
    : `${days} day${days === 1 ? "" : "s"} until target`;
}

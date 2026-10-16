export const MILESTONE_STATUSES = {
  "not-started": "Not Started",
  "in-progress": "In Progress",
  "awaiting-client": "Awaiting Client",
  "under-review": "Under Review",
  completed: "Completed",
  blocked: "Blocked",
};
export const FILE_CATEGORIES = {
  "client-uploads": "Client Uploads",
  "brand-assets": "Brand Assets",
  "website-content": "Website Content",
  "project-previews": "Project Previews",
  "final-deliverables": "Final Deliverables",
};
export const milestoneStatus = (m) =>
  Object.hasOwn(MILESTONE_STATUSES, m?.status)
    ? m.status
    : (m?.isCompleted ?? m?.completed)
      ? "completed"
      : "not-started";
export function milestoneSummary(milestones = []) {
  const total = milestones.length,
    completed = milestones.filter(
      (m) => milestoneStatus(m) === "completed",
    ).length;
  return {
    total,
    completed,
    remaining: total - completed,
    progress: total ? Math.round((completed / total) * 100) : 0,
  };
}
export function orderedMilestones(milestones = []) {
  return milestones
    .map((m, i) => ({ ...m, order: Number.isFinite(m.order) ? m.order : i }))
    .sort((a, b) => a.order - b.order);
}
export function nextProjectMilestone(
  milestones = [],
  projectStatus = "in-progress",
) {
  if (["completed", "delivered"].includes(projectStatus)) return null;
  const ordered = orderedMilestones(milestones),
    done = new Set(
      ordered
        .filter((m) => milestoneStatus(m) === "completed")
        .map((m) => m.id),
    );
  const open = ordered.filter((m) => milestoneStatus(m) !== "completed");
  const next =
    open.find((m) => (m.dependsOn || []).every((id) => done.has(id))) ||
    open[0];
  if (!next) return null;
  const waiting = (next.dependsOn || []).filter((id) => !done.has(id));
  return {
    ...next,
    status: waiting.length ? "blocked" : milestoneStatus(next),
    waitingFor: waiting,
    responsibleParty: waiting.length
      ? "team"
      : milestoneStatus(next) === "awaiting-client"
        ? next.responsibleParty === "both"
          ? "both"
          : "client"
        : next.responsibleParty ||
          (milestoneStatus(next) === "under-review" ? "both" : "team"),
  };
}
export function validMilestoneGraph(milestones) {
  const ids = new Set(milestones.map((m) => m.id));
  if (ids.size !== milestones.length) return false;
  const visiting = new Set(),
    done = new Set();
  function visit(id) {
    if (visiting.has(id)) return false;
    if (done.has(id)) return true;
    const m = milestones.find((m) => m.id === id);
    if (!m) return false;
    visiting.add(id);
    for (const parent of m.dependsOn || [])
      if (!ids.has(parent) || !visit(parent)) return false;
    visiting.delete(id);
    done.add(id);
    return true;
  }
  return milestones.every((m) => visit(m.id));
}

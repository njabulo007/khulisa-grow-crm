import { describe, expect, it } from "vitest";
import {
  canChangeProjectDeliveryStatus,
  canEditProjectMilestones,
  resolveDeliveryStatus,
} from "./projectDeliveryPermissions";
import type { Project, User } from "@/types/models";

describe("assigned agent delivery permissions", () => {
  const agent = { id: "legacy", uid: "uid", role: "agent" } as User;
  const owner = { id: "owner", role: "owner" } as User;
  const project = { assignedTo: "uid", status: "in-progress" } as Project;
  it("allows both approved assignment identities, rejecting another agent", () => {
    expect(canEditProjectMilestones(agent, project)).toBe(true);
    expect(
      canEditProjectMilestones(agent, { ...project, assignedTo: agent.id }),
    ).toBe(true);
    expect(
      canEditProjectMilestones(agent, { ...project, assignedTo: "another" }),
    ).toBe(false);
  });
  it("allows operational status changes but reserves completion and reopening for the owner", () => {
    expect(
      canChangeProjectDeliveryStatus(agent, project, "waiting-client"),
    ).toBe(true);
    expect(canChangeProjectDeliveryStatus(agent, project, "completed")).toBe(
      false,
    );
    expect(
      canEditProjectMilestones(agent, { ...project, status: "completed" }),
    ).toBe(false);
    expect(
      canChangeProjectDeliveryStatus(
        agent,
        { ...project, status: "completed" },
        "in-progress",
      ),
    ).toBe(false);
    expect(canChangeProjectDeliveryStatus(owner, project, "completed")).toBe(
      true,
    );
  });
  it("keeps an agent’s completed checklist pending owner handover and preserves finalized projects", () => {
    expect(resolveDeliveryStatus("completed", "in-progress", "agent")).toBe(
      "in-progress",
    );
    expect(resolveDeliveryStatus("completed", "in-progress", "owner")).toBe(
      "completed",
    );
    expect(resolveDeliveryStatus("in-progress", "completed", "agent")).toBe(
      "completed",
    );
  });
});

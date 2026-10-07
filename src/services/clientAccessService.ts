import { doc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getClientProjectAccess } from "@/lib/clientAssignments";
import type { Client, Project } from "@/types/models";
import {
  FirestoreCollection,
  getCurrentAuthRole,
  getTimestamp,
  normalizeForFirestore,
} from "./storage";

const clients = new FirestoreCollection<Client>("clients");
const projects = new FirestoreCollection<Project>("projects");

export async function saveProjectWithClientAccess(
  project: Project,
  previousClientId?: string,
  updates?: Partial<Project>,
): Promise<void> {
  if ((await getCurrentAuthRole()) !== "owner")
    throw new Error("Only owners can change project assignments.");
  const clientIds = [
    ...new Set([project.clientId, previousClientId].filter(Boolean)),
  ] as string[];
  const access = await Promise.all(
    clientIds.map(async (id) => {
      const linked = await projects.getAllWhere("clientId", id);
      const next = linked.filter((entry) => entry.id !== project.id);
      if (id === project.clientId) next.push(project);
      return { id, projectAccess: getClientProjectAccess(next) };
    }),
  );
  const batch = writeBatch(db);
  // The update is atomic: an assigned project and its client visibility arrive together.
  batch.set(
    doc(db, "projects", project.id),
    normalizeForFirestore(updates || project) as Record<string, unknown>,
    { merge: true },
  );
  access.forEach(({ id, projectAccess }) =>
    batch.update(doc(db, "clients", id), {
      projectAccess,
      updatedAt: getTimestamp(),
    }),
  );
  await batch.commit();
  window.dispatchEvent(new CustomEvent("crm:data-changed"));
}

export async function repairClientProjectAccess(): Promise<number> {
  if ((await getCurrentAuthRole()) !== "owner")
    throw new Error("Only owners can repair client assignments.");
  const [allClients, allProjects] = await Promise.all([
    clients.getAll(),
    projects.getAll(),
  ]);
  const changes = allClients.flatMap((client) => {
    const projectAccess = getClientProjectAccess(
      allProjects.filter((project) => project.clientId === client.id),
    );
    const existing = client.projectAccess || {};
    if (
      Object.keys(existing).length === Object.keys(projectAccess).length &&
      Object.entries(projectAccess).every(
        ([key, value]) => existing[key] === value,
      )
    )
      return [];
    return [{ clientId: client.id, projectAccess }];
  });
  for (let offset = 0; offset < changes.length; offset += 400) {
    const batch = writeBatch(db);
    changes
      .slice(offset, offset + 400)
      .forEach(({ clientId, projectAccess }) => {
        batch.update(doc(db, "clients", clientId), {
          projectAccess,
          updatedAt: getTimestamp(),
        });
      });
    await batch.commit();
  }
  if (changes.length) window.dispatchEvent(new CustomEvent("crm:data-changed"));
  return changes.length;
}

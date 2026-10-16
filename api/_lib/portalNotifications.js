import crypto from "node:crypto";
export function createPortalNotifier({ db, auth, sendPush }) {
  return async (response, { verified = false, onboarding = false, workspace = false } = {}) => {
    const project = await db
      .collection("projects")
      .doc(response.projectId)
      .get();
    if (!project.exists || project.data()._deleting) return;
    const client = await db
      .collection("clients")
      .doc(project.data().clientId)
      .get();
    if (!client.exists || client.data()._deleting) return;
    let recipients;
    if (verified) {
      const key = client.data().contactManagerId || project.data().assignedTo;
      if (!key) return;
      const direct = await db.collection("users").doc(key).get();
      recipients = direct.exists
        ? [direct]
        : (
            await db
              .collection("users")
              .where("appUserId", "==", key)
              .limit(1)
              .get()
          ).docs;
    } else
      recipients = (
        await db.collection("users").where("role", "==", "owner").get()
      ).docs;
    if (onboarding || workspace) {
      const key = client.data().contactManagerId || project.data().assignedTo;
      if (typeof key === "string" && key && !key.includes("/")) {
        const direct = await db.collection("users").doc(key).get();
        const managers = direct.exists
          ? [direct]
          : (
              await db
                .collection("users")
                .where("appUserId", "==", key)
                .limit(1)
                .get()
            ).docs;
        recipients = [
          ...new Map(
            [...recipients, ...managers].map((p) => [p.id, p]),
          ).values(),
        ];
      }
    }
    let failed = false;
    for (const profile of recipients) {
      try {
        const person = profile.data();
        if (person.accessDisabled === true || person.isActive === false)
          continue;
        const account = await auth.getUser(person.uid || profile.id);
        if (account.disabled) continue;
        const userId =
          account.customClaims?.appUserId || person.appUserId || profile.id;
        const notificationId = `portal_${crypto.createHash("sha256").update(`${response.id}:${verified}:${userId}`).digest("hex")}`;
        const ref = db.collection("notifications").doc(notificationId);
        await db.runTransaction(async (tx) => {
          const saved = await tx.get(ref);
          if (!saved.exists)
            tx.set(ref, {
              userId,
              type: "client_request",
              projectId: response.projectId,
              clientId: project.data().clientId,
              title: workspace ? response.title || "Project workspace updated" : onboarding
                ? "Client onboarding updated"
                : verified
                  ? "Client response verified"
                  : "Client portal response received",
              message: workspace ? "A project file, milestone or conversation has changed. Open the project collaboration panels." : onboarding
                ? "Client onboarding has changed. Open the project onboarding panel to review details."
                : verified
                  ? "The verified response is now in client history. Open the project for details."
                  : "A client response is waiting for verification. Open the project review panel.",
              isRead: false,
              createdAt: new Date().toISOString(),
            });
        });
        await sendPush(notificationId, userId);
      } catch {
        failed = true;
      }
    }
    if (failed) throw new Error("One or more portal notices need retrying.");
  };
}

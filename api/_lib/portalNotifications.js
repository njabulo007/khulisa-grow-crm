import crypto from "node:crypto";
export function createPortalNotifier({ db, auth, sendPush }) {
  return async (response, { verified = false } = {}) => {
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
    for (const profile of recipients) {
      const person = profile.data();
      if (person.accessDisabled === true) continue;
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
            title: verified
              ? "Client response verified"
              : "Client portal response received",
            message: verified
              ? "The verified response is now in client history. Open the project for details."
              : "A client response is waiting for verification. Open the project review panel.",
            isRead: false,
            createdAt: new Date().toISOString(),
          });
      });
      await sendPush(notificationId, userId);
    }
  };
}

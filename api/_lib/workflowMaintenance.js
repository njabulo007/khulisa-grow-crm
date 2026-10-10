import { FieldPath } from "firebase-admin/firestore";
// Bounded daily sweeps avoid a full-collection scan or paid Firestore TTL service.
export async function sweepWorkflowHistory(db, now = Date.now()) {
  const marker = db.collection("_maintenance").doc("workflow-retention"),
    saved = await marker.get(),
    data = saved.data() || {};
  const updates = { updatedAt: new Date(now).toISOString() };
  let deleted = 0;
  for (const [collection, size, days] of [
    ["notifications", 100, 30],
    ["_portal_limits", 50, 2],
  ]) {
    let query = db
      .collection(collection)
      .orderBy(FieldPath.documentId(), "asc");
    if (data[collection]) query = query.startAfter(data[collection]);
    const page = await query.limit(size + 1).get(),
      docs = page.docs.slice(0, size),
      batch = db.batch();
    let writes = 0;
    for (const doc of docs) {
      const record = doc.data();
      const value =
        collection === "notifications" ? record.createdAt : record.expiresAt;
      const time = value?.toDate ? value.toDate().getTime() : Date.parse(value);
      if (
        Number.isFinite(time) &&
        time < (collection === "notifications" ? now - days * 86400000 : now)
      ) {
        batch.delete(doc.ref);
        writes++;
        deleted++;
      }
    }
    if (writes) await batch.commit();
    updates[collection] = page.docs.length > size ? docs.at(-1).id : "";
  }
  await marker.set(updates, { merge: true });
  return { deleted };
}

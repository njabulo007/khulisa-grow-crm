import crypto from "node:crypto";
import { createHttpError, json, parseBody, methodNotAllowed } from "./http.js";
import { PACKAGE_CATALOG } from "./packages.js";
const id = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const round = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const money = (v) =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  v > 0 &&
  v <= 1e9 &&
  Math.abs(round(v) - v) < 1e-7;
const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
export function createWorkflowHandler({
  db,
  auth,
  requireOwner,
  now = () => Date.now(),
}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
    try {
      const actor = await requireOwner(req);
      const p = parseBody(req),
        timestamp = new Date(now()).toISOString();
      if (p.action === "reserve-number") {
        const year = new Date(now()).getUTCFullYear();
        const result = await db.runTransaction(async (tx) => {
          const ref = db.collection("_invoice_counters").doc(String(year));
          const counter = await tx.get(ref);
          const invoices = await tx.get(db.collection("invoices"));
          const maximum = invoices.docs.reduce((max, d) => {
            const match = String(d.data().invoiceNumber || "").match(
              new RegExp(`^KM-${year}-(\\d+)$`),
            );
            return Math.max(max, match ? Number(match[1]) : 0);
          }, 0);
          const next = Math.max(Number(counter.data()?.last || 0), maximum) + 1;
          tx.set(ref, { last: next, updatedAt: timestamp });
          return `KM-${year}-${String(next).padStart(4, "0")}`;
        });
        return json(res, 200, { invoiceNumber: result });
      }
      if (p.action === "growth-invoice") {
        if (!id(p.opportunityId))
          throw createHttpError(400, "Select an opportunity.");
        const result = await db.runTransaction(async (tx) => {
          const ref = db
              .collection("client_opportunities")
              .doc(p.opportunityId),
            doc = await tx.get(ref),
            op = doc.data();
          if (!op || op.status !== "approved" || !money(op.approvedPrice))
            throw createHttpError(
              409,
              "An approved opportunity with a positive price is required.",
            );
          const client = await tx.get(
            db.collection("clients").doc(op.clientId),
          );
          if (!client.exists || client.data()._deleting)
            throw createHttpError(404, "Client unavailable.");
          if (op.linkedInvoiceId) return { invoiceId: op.linkedInvoiceId };
          const year = new Date(now()).getUTCFullYear(),
            counterRef = db.collection("_invoice_counters").doc(String(year));
          const counter = await tx.get(counterRef),
            invoices = await tx.get(db.collection("invoices"));
          const maximum = invoices.docs.reduce((max, d) => {
            const m = String(d.data().invoiceNumber || "").match(
              new RegExp(`^KM-${year}-(\\d+)$`),
            );
            return Math.max(max, m ? Number(m[1]) : 0);
          }, 0);
          const next = Math.max(Number(counter.data()?.last || 0), maximum) + 1,
            invoiceId = `growth_${p.opportunityId}`;
          tx.set(db.collection("invoices").doc(invoiceId), {
            clientId: op.clientId,
            invoiceNumber: `KM-${year}-${String(next).padStart(4, "0")}`,
            items: [
              {
                id: "scope",
                description: op.approvedScope,
                quantity: 1,
                unitPrice: op.approvedPrice,
                total: op.approvedPrice,
              },
            ],
            subtotal: op.approvedPrice,
            total: op.approvedPrice,
            amountPaid: 0,
            status: "draft",
            issuedDate: timestamp,
            dueDate: new Date(now() + 14 * 86400000).toISOString(),
            notes: `Approved opportunity: ${op.title}`,
            createdAt: timestamp,
            updatedAt: timestamp,
            createdBy: actor.uid,
            opportunityId: p.opportunityId,
          });
          tx.set(counterRef, { last: next, updatedAt: timestamp });
          tx.update(ref, { linkedInvoiceId: invoiceId, updatedAt: timestamp });
          return { invoiceId };
        });
        return json(res, 200, result);
      }
      if (p.action === "commission-rates") {
        if (!Array.isArray(p.rates) || p.rates.length > 100)
          throw createHttpError(400, "Invalid team rates.");
        const result = await db.runTransaction(async (tx) => {
          const targets = [];
          for (const item of p.rates) {
            if (
              !id(item.uid) ||
              typeof item.rate !== "number" ||
              !Number.isFinite(item.rate) ||
              item.rate < 0 ||
              item.rate > 100
            )
              throw createHttpError(
                400,
                "Rates must be percentages between 0 and 100.",
              );
            const ref = db.collection("users").doc(item.uid),
              snap = await tx.get(ref);
            if (!snap.exists || snap.data().role !== "agent")
              throw createHttpError(400, "Select an existing agent.");
            targets.push({ ref, rate: round(item.rate) });
          }
          for (const item of targets)
            tx.update(item.ref, {
              commissionRate: item.rate,
              commissionRateUnit: "percent",
              updatedAt: timestamp,
            });
          return { saved: true };
        });
        return json(res, 200, result);
      }
      if (p.action === "disable-access" || p.action === "restore-access") {
        if (!id(p.uid) || p.uid === actor.uid)
          throw createHttpError(400, "You cannot change your own access.");
        const ref = db.collection("users").doc(p.uid),
          target = await ref.get();
        if (!target.exists || target.data().role !== "agent")
          throw createHttpError(400, "Only agent access can be changed here.");
        const disabled = p.action === "disable-access";
        // Deny Firestore first; restore only after Firebase Auth is enabled.
        if (disabled)
          await ref.update({ accessDisabled: true, updatedAt: timestamp });
        await auth.updateUser(p.uid, { disabled });
        await auth.revokeRefreshTokens(p.uid);
        if (!disabled)
          await ref.update({ accessDisabled: false, updatedAt: timestamp });
        return json(res, 200, { disabled });
      }
      if (p.action === "payout") {
        if (
          !id(p.commissionId) ||
          typeof p.reference !== "string" ||
          !p.reference.trim() ||
          p.reference.length > 180
        )
          throw createHttpError(
            400,
            "Add the bank or payout receipt reference.",
          );
        const result = await db.runTransaction(async (tx) => {
          const ref = db.collection("commissions").doc(p.commissionId),
            snapshot = await tx.get(ref),
            commission = snapshot.data();
          if (!commission)
            throw createHttpError(404, "Commission unavailable.");
          if (commission.status === "paid-out") {
            if (commission.payoutReference !== p.reference.trim())
              throw createHttpError(
                409,
                "This commission was already settled with another reference.",
              );
            return { paidOut: true };
          }
          const invoice = await tx.get(
            db.collection("invoices").doc(commission.invoiceId),
          );
          const payments = await tx.get(
            db
              .collection("payments")
              .where("invoiceId", "==", commission.invoiceId),
          );
          const total = (invoice.data()?.items || []).reduce(
              (sum, item) =>
                sum + Number(item.quantity) * Number(item.unitPrice),
              0,
            ),
            paid = payments.docs.reduce(
              (sum, item) => sum + Number(item.data().amount || 0),
              0,
            );
          if (
            commission.status !== "earned" ||
            !invoice.exists ||
            invoice.data()._deleting ||
            !money(total) ||
            paid < total
          )
            throw createHttpError(
              409,
              "Commission payout requires a fully paid invoice and earned commission.",
            );
          tx.update(ref, {
            status: "paid-out",
            paidOutDate: timestamp,
            payoutReference: p.reference.trim(),
            paidOutBy: actor.uid,
            updatedAt: timestamp,
          });
          return { paidOut: true };
        });
        return json(res, 200, result);
      }
      if (p.action === "payment") {
        if (
          !id(p.invoiceId) ||
          !id(p.requestId) ||
          !money(p.amount) ||
          !["eft", "cash", "card", "other"].includes(p.method) ||
          typeof p.reference !== "string" ||
          p.reference.trim().length < 1 ||
          p.reference.length > 180 ||
          typeof p.paidAt !== "string" ||
          !Number.isFinite(Date.parse(p.paidAt)) ||
          Date.parse(p.paidAt) > now() + 86400000
        )
          throw createHttpError(
            400,
            "Enter a valid amount, date, method and payment reference.",
          );
        const result = await db.runTransaction(async (tx) => {
          const invoiceRef = db.collection("invoices").doc(p.invoiceId);
          const paymentRef = db
            .collection("payments")
            .doc(
              `payment_${hash(`${actor.uid}:${p.invoiceId}:${p.requestId}`)}`,
            );
          const invoiceDoc = await tx.get(invoiceRef),
            previous = await tx.get(paymentRef);
          if (!invoiceDoc.exists || invoiceDoc.data()._deleting)
            throw createHttpError(404, "Invoice is unavailable.");
          const invoice = invoiceDoc.data();
          if (previous.exists) {
            const saved = previous.data();
            if (
              saved.amount !== p.amount ||
              saved.reference !== p.reference.trim() ||
              saved.method !== p.method ||
              saved.paidAt !== p.paidAt
            )
              throw createHttpError(
                409,
                "This payment attempt already has different details.",
              );
            return { ...saved, id: previous.id };
          }
          if (invoice.status === "draft")
            throw createHttpError(
              409,
              "Issue the invoice before recording payment.",
            );
          const client = await tx.get(
            db.collection("clients").doc(invoice.clientId),
          );
          if (!client.exists || client.data()._deleting)
            throw createHttpError(409, "Client is unavailable.");
          const project = invoice.projectId
            ? await tx.get(db.collection("projects").doc(invoice.projectId))
            : null;
          const payments = await tx.get(
            db.collection("payments").where("invoiceId", "==", p.invoiceId),
          );
          const duplicate = payments.docs.find(
            (d) =>
              d.data().reference === p.reference.trim() &&
              d.data().paidAt === p.paidAt &&
              d.data().method === p.method,
          );
          if (duplicate) {
            if (duplicate.data().amount !== p.amount)
              throw createHttpError(
                409,
                "This receipt reference is already recorded with a different amount.",
              );
            return { ...duplicate.data(), id: duplicate.id };
          }
          const commissions = await tx.get(
            db.collection("commissions").where("invoiceId", "==", p.invoiceId),
          );
          const total = round(
            (invoice.items || []).reduce(
              (sum, item) =>
                sum + Number(item.quantity) * Number(item.unitPrice),
              0,
            ),
          );
          const paid = round(
            payments.docs.reduce(
              (sum, d) => sum + Number(d.data().amount || 0),
              0,
            ),
          );
          if (!money(total) || p.amount > round(total - paid))
            throw createHttpError(
              409,
              "Payment exceeds the remaining balance. Refresh the invoice.",
            );
          let agentId = project?.data()?.assignedTo;
          if (!agentId && client.data().leadId)
            agentId = (
              await tx.get(db.collection("leads").doc(client.data().leadId))
            ).data()?.assignedTo;
          const userQuery = agentId
            ? await tx.get(
                db
                  .collection("users")
                  .where("appUserId", "==", agentId)
                  .limit(1),
              )
            : null;
          const userDirect = agentId
            ? await tx.get(db.collection("users").doc(agentId))
            : null;
          const person = userDirect?.exists
            ? userDirect.data()
            : userQuery?.docs[0]?.data();
          const settings =
            (await tx.get(db.collection("settings").doc("global"))).data() ||
            {};
          const earned = agentId
            ? await tx.get(
                db.collection("commissions").where("agentId", "==", agentId),
              )
            : null;
          const amountPaid = round(paid + p.amount),
            fullyPaid = amountPaid >= total;
          const pkgId = invoice.packageId || project?.data()?.packageId,
            pkg = PACKAGE_CATALOG[pkgId];
          const existing = commissions.docs[0];
          const paidSales =
            (earned?.docs || []).filter(
              (d) =>
                d.data().invoiceId !== p.invoiceId &&
                ["earned", "paid-out"].includes(d.data().status),
            ).length + (fullyPaid ? 1 : 0);
          const manual =
            typeof person?.commissionRate === "number"
              ? person.commissionRateUnit === "percent" ||
                person.commissionRate > 1
                ? person.commissionRate
                : person.commissionRate * 100
              : (settings.defaultManualCommissionRate ?? 15);
          const rate =
            settings.commissionMode === "manual"
              ? Math.max(0, Math.min(100, manual)) / 100
              : person?.email?.toLowerCase() === "njabulo@gmail.com"
                ? 0.3
                : paidSales > 6
                  ? 0.2
                  : 0.15;
          const payment = {
            invoiceId: p.invoiceId,
            amount: p.amount,
            method: p.method,
            reference: p.reference.trim(),
            paidAt: p.paidAt,
            createdAt: timestamp,
            createdBy: actor.uid,
          };
          tx.set(paymentRef, payment);
          tx.update(invoiceRef, {
            amountPaid,
            status: fullyPaid ? "paid" : "partially-paid",
            updatedAt: timestamp,
          });
          if (
            person?.role === "agent" &&
            pkg &&
            existing?.data().status !== "paid-out"
          ) {
            const ref =
              existing?.ref ||
              db.collection("commissions").doc(`invoice_${p.invoiceId}`);
            const base = existing?.data() || {};
            tx.set(ref, {
              ...base,
              invoiceId: p.invoiceId,
              agentId,
              ...(invoice.projectId ? { projectId: invoice.projectId } : {}),
              packageId: pkgId,
              packageName: pkg.name,
              packagePrice: invoice.packagePrice ?? pkg.price,
              rate: base.rate ?? rate,
              commissionAmount:
                base.commissionAmount ??
                round((invoice.packagePrice ?? pkg.price) * rate),
              status: fullyPaid ? "earned" : "pending",
              ...(fullyPaid ? { earnedDate: base.earnedDate || p.paidAt } : {}),
              createdAt: base.createdAt || timestamp,
              updatedAt: timestamp,
            });
          }
          tx.set(db.collection("activities").doc(`payment_${paymentRef.id}`), {
            type: "payment",
            entityType: "invoice",
            entityId: p.invoiceId,
            createdBy: actor.uid,
            createdAt: timestamp,
            description: `Payment received: R ${p.amount.toFixed(2)} · ${p.reference.trim()}`,
          });
          return { ...payment, id: paymentRef.id };
        });
        return json(res, 200, result);
      }
      throw createHttpError(400, "Unknown workflow action.");
    } catch (error) {
      console.error("[CRM workflow]", {
        action: parseBody(req).action,
        code: error.code || error.status || "unknown",
      });
      return json(res, error.status || 500, {
        error: error.status
          ? error.message
          : "This action could not be completed. Please retry.",
      });
    }
  };
}

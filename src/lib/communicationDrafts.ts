export const COMMUNICATION_TEMPLATES = {
  "check-in": "Client check-in",
  "missing-materials": "Missing materials",
  progress: "Progress update",
  payment: "Payment reminder",
} as const;
export type CommunicationTemplate = keyof typeof COMMUNICATION_TEMPLATES;
export interface DraftInvoice {
  id: string;
  invoiceNumber: string;
  dueDate: string;
  outstanding: number;
}
export function whatsappRecipient(value: string) {
  let phone = value.trim().replace(/[\s()-]/g, "");
  if (!/^\+?\d+$/.test(phone)) return null;
  if (phone.startsWith("+")) phone = phone.slice(1);
  else if (phone.startsWith("00")) phone = phone.slice(2);
  else if (/^0\d{9}$/.test(phone)) phone = `27${phone.slice(1)}`;
  if (/^270\d{9}$/.test(phone)) phone = `27${phone.slice(3)}`;
  return /^\d{8,15}$/.test(phone) ? phone : null;
}
export function buildCommunicationDraft({
  template,
  clientName,
  contactName,
  senderName,
  missingMaterials = [],
  invoice,
}: {
  template: CommunicationTemplate;
  clientName: string;
  contactName: string;
  senderName: string;
  missingMaterials?: string[];
  invoice?: DraftInvoice;
}) {
  const greeting = `Hi ${contactName || clientName},`;
  const signature = `Kind regards,\n${senderName ? `${senderName}\n` : ""}Khulisa Media`;
  let subject = `Checking in — ${clientName}`;
  let message = `How are things going with ${clientName}? Is there anything you need help with, or anything you would like us to review? Please let us know and we can agree on the next steps.`;
  if (template === "missing-materials") {
    subject = `Onboarding materials — ${clientName}`;
    message = missingMaterials.length
      ? `To keep work on ${clientName} moving, could you please help us with these outstanding items?\n\n${missingMaterials.map((item) => `• ${item}`).join("\n")}\n\nPlease let us know when they will be available. For account access, please send an invitation through the relevant platform rather than a password.`
      : "Our onboarding checklist has no outstanding materials. Please let us know if any content or requirements have changed.";
  } else if (template === "progress") {
    subject = `Progress update — ${clientName}`;
    message = `Here is the latest update for ${clientName}:\n\n[Add completed work, next steps, and the expected date]\n\nPlease let us know if you have any questions or feedback.`;
  } else if (template === "payment") {
    if (
      !invoice ||
      !Number.isFinite(invoice.outstanding) ||
      invoice.outstanding <= 0
    )
      throw new Error(
        "Choose an unpaid sent invoice before preparing a payment reminder.",
      );
    const amount = new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
    }).format(invoice.outstanding);
    subject = `Payment reminder — ${invoice.invoiceNumber}`;
    message = `A friendly reminder that invoice ${invoice.invoiceNumber} has an outstanding balance of ${amount}, with a due date of ${invoice.dueDate.slice(0, 10)}.\n\nPlease use the banking details on the invoice and quote ${invoice.invoiceNumber} as the payment reference. If you have already paid, please share proof of payment so we can reconcile it. Let us know if you need a copy of the invoice.`;
  }
  return { subject, body: `${greeting}\n\n${message}\n\n${signature}` };
}
export const hasDraftPlaceholders = (value: string) =>
  /\[(?:add|insert|enter|replace)\b[^\]\n]*\]/i.test(value);

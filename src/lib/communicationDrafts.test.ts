import { describe, expect, it } from "vitest";
import {
  buildCommunicationDraft,
  hasDraftPlaceholders,
  whatsappRecipient,
} from "./communicationDrafts";
const client = {
  clientName: "Client One",
  contactName: "Athi",
  senderName: "Manager",
};
describe("client communication drafts", () => {
  it("uses client and sender details without inventing an approval or delivery commitment", () => {
    const draft = buildCommunicationDraft({ ...client, template: "check-in" });
    expect(draft.body).toContain("Hi Athi,");
    expect(draft.body).toContain("Client One");
    expect(draft.body).toContain("Manager\nKhulisa Media");
    expect(hasDraftPlaceholders(draft.body)).toBe(false);
  });
  it("requires the manager to complete progress details before sending", () => {
    const draft = buildCommunicationDraft({ ...client, template: "progress" });
    expect(hasDraftPlaceholders(draft.body)).toBe(true);
    expect(hasDraftPlaceholders("[Khulisa Media] [Invoice KM-001]")).toBe(
      false,
    );
    expect(
      hasDraftPlaceholders(
        draft.body.replace(
          "[Add completed work, next steps, and the expected date]",
          "Homepage draft ready. Please review tomorrow.",
        ),
      ),
    ).toBe(false);
  });
  it("lists the missing checklist items and asks for platform invitations rather than passwords", () => {
    const draft = buildCommunicationDraft({
      ...client,
      template: "missing-materials",
      missingMaterials: ["Website content", "Access credentials"],
    });
    expect(draft.body).toContain("• Website content\n• Access credentials");
    expect(draft.body).toContain("rather than a password");
    const complete = buildCommunicationDraft({
      ...client,
      template: "missing-materials",
    });
    expect(complete.body).toContain("no outstanding materials");
  });
  it("uses the remaining invoice balance and reference without asserting an invoice is overdue", () => {
    const draft = buildCommunicationDraft({
      ...client,
      template: "payment",
      invoice: {
        id: "i1",
        invoiceNumber: "KM-001",
        dueDate: "2026-10-20",
        outstanding: 1250.5,
      },
    });
    expect(draft.body).toContain("KM-001");
    expect(draft.body).toContain("2026-10-20");
    expect(draft.body.replace(/\s/g, "")).toContain("R1");
    expect(draft.body).not.toContain("overdue");
    expect(() =>
      buildCommunicationDraft({ ...client, template: "payment" }),
    ).toThrow("unpaid");
    expect(() =>
      buildCommunicationDraft({
        ...client,
        template: "payment",
        invoice: {
          id: "i1",
          invoiceNumber: "KM-001",
          dueDate: "2026-10-20",
          outstanding: 0,
        },
      }),
    ).toThrow("unpaid");
  });
  it("normalises South African and international phone numbers and rejects extensions or multiple recipients", () => {
    expect(whatsappRecipient("082 123 4567")).toBe("27821234567");
    expect(whatsappRecipient("+27 (0)82-123-4567")).toBe("27821234567");
    expect(whatsappRecipient("0044 7700 900123")).toBe("447700900123");
    expect(whatsappRecipient("0821234567 ext 2")).toBe(null);
    expect(whatsappRecipient("0821234567;0831234567")).toBe(null);
    expect(whatsappRecipient("")).toBe(null);
  });
});

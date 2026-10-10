import { expect, it } from "vitest";
import { applyDraftOverride } from "./communicationOverrides";
it("shared drafts substitute supplied public fields and flag missing fields before sending", () => {
  expect(
    applyDraftOverride(
      { subject: "Default", body: "Default" },
      {
        subject: "Invoice {invoiceNumber}",
        body: "Hi {contactName}, balance {outstanding}. {unknown}",
      },
      { invoiceNumber: "KM-1", contactName: "Athi", outstanding: "R 900" },
    ),
  ).toEqual({
    subject: "Invoice KM-1",
    body: "Hi Athi, balance R 900. [Add unknown]",
  });
});

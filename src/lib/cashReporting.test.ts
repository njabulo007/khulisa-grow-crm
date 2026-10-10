import { describe, it, expect } from "vitest";
import {
  cashByMonth,
  closedLeadWinRate,
  southAfricanMonth,
} from "./cashReporting";
import type { Payment } from "@/types/models";
describe("cash reporting", () => {
  it("counts partial receipts in their South African payment month rather than invoice issue month", () => {
    const payments = [
      { invoiceId: "one", amount: 200, paidAt: "2026-09-30T23:00:00Z" },
      { invoiceId: "one", amount: 300, paidAt: "2026-11-01T10:00:00Z" },
    ] as Payment[];
    expect(cashByMonth(payments)).toEqual({
      "2026-10": { revenue: 200, invoiceCount: 1 },
      "2026-11": { revenue: 300, invoiceCount: 1 },
    });
    expect(southAfricanMonth("invalid")).toBe("");
  });
  it("uses closed deals for win rate and handles no decisions", () => {
    expect(closedLeadWinRate(1, 1)).toBe(50);
    expect(closedLeadWinRate(0, 0)).toBe(0);
  });
});

import type { Payment } from "@/types/models";
export const southAfricanMonth = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}`;
};
export const cashByMonth = (payments: Payment[]) =>
  payments.reduce<Record<string, { revenue: number; invoiceCount: number }>>(
    (result, payment) => {
      const key = southAfricanMonth(payment.paidAt);
      if (!key || !Number.isFinite(payment.amount) || payment.amount <= 0)
        return result;
      result[key] ||= { revenue: 0, invoiceCount: 0 };
      result[key].revenue += payment.amount;
      result[key].invoiceCount++;
      return result;
    },
    {},
  );
export const closedLeadWinRate = (won: number, lost: number) =>
  won + lost ? Math.round((won / (won + lost)) * 100) : 0;

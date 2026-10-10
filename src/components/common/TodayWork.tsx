import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { leadService, clientService } from "@/services";
import {
  clientFollowUpService,
  clientRequestService,
} from "@/services/clientSuccessService";
import {
  paymentFollowUpService,
  paymentFollowUpToday,
} from "@/services/paymentFollowUpService";
import {
  clientRelationshipService,
  type GrowthRecord,
} from "@/services/clientRelationshipService";
import { clientCareService } from "@/services/clientCareService";
type Item = {
  key: string;
  title: string;
  detail: string;
  href: string;
  due: string;
  weight: number;
};
export function TodayWork() {
  const { user, isOwner } = useAuth();
  const [items, setItems] = useState<Item[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true);
  const [limited, setLimited] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    const load = async () => {
      setBusy(true);
      const today = paymentFollowUpToday();
      const results = await Promise.allSettled([
        leadService.getAll(),
        clientFollowUpService.list(),
        paymentFollowUpService.list(undefined, isOwner),
        clientRequestService.list(),
        clientRelationshipService.list<GrowthRecord>("opportunity"),
        clientService.getAll(),
        isOwner
          ? clientRequestService.list(undefined, undefined, "urgent")
          : Promise.resolve(null),
      ]);
      if (!live) return;
      const next: Item[] = [];
      let partial = false,
        more = false;
      const value = <T,>(index: number): T | null => {
        const r = results[index];
        if (r.status === "rejected") {
          partial = true;
          return null;
        }
        return r.value as T;
      };
      const leads =
        value<Awaited<ReturnType<typeof leadService.getAll>>>(0) || [];
      for (const l of leads)
        if (
          !["won", "lost"].includes(l.stage) &&
          l.followUpDate?.slice(0, 10) <= today
        )
          next.push({
            key: `lead-${l.id}`,
            title: l.businessName,
            detail: "Lead follow-up",
            href: `/leads/${l.id}#lead-follow-up`,
            due: l.followUpDate!.slice(0, 10),
            weight: 2,
          });
      const contacts =
        value<Awaited<ReturnType<typeof clientFollowUpService.list>>>(1);
      more ||= !!contacts?.cursor;
      for (const c of contacts?.followUps || [])
        if (c.followUpDate <= today || c.waitingForResponse)
          next.push({
            key: `contact-${c.id}`,
            title: c.clientName,
            detail: c.waitingForResponse
              ? "Waiting for client response"
              : "Client check-in",
            href: `/clients/${c.clientId}#client-follow-ups`,
            due: c.followUpDate,
            weight: 2,
          });
      for (const p of value<
        Awaited<ReturnType<typeof paymentFollowUpService.list>>
      >(2)?.followUps || [])
        if (p.followUpDate <= today)
          next.push({
            key: `payment-${p.id}`,
            title: p.clientName,
            detail: `Payment follow-up · ${p.invoiceNumber} · R ${p.balance.toFixed(2)}`,
            href: `/invoices/${p.invoiceId}#payment-follow-up`,
            due: p.followUpDate,
            weight: 1,
          });
      const requests =
        value<Awaited<ReturnType<typeof clientRequestService.list>>>(3);
      more ||= !!requests?.cursor;
      const urgent =
        value<Awaited<ReturnType<typeof clientRequestService.list>>>(6);
      const unique = new Map(
        [...(requests?.requests || []), ...(urgent?.requests || [])].map(
          (r) => [r.id, r],
        ),
      );
      for (const r of unique.values())
        if (
          r.status !== "completed" &&
          (isOwner ||
            r.status === "ready-for-review" ||
            (r.dueDate && r.dueDate <= today))
        )
          next.push({
            key: `request-${r.id}`,
            title: r.title,
            detail: `${r.clientName} · ${r.status.replace(/-/g, " ")} · ${r.priority}`,
            href: `/clients/${r.clientId}#client-requests`,
            due: r.dueDate || "",
            weight:
              r.priority === "urgent"
                ? 0
                : r.status === "ready-for-review"
                  ? 1
                  : 3,
          });
      const growth =
        value<
          Awaited<
            ReturnType<typeof clientRelationshipService.list<GrowthRecord>>
          >
        >(4);
      more ||= !!growth?.cursor;
      for (const g of growth?.records || [])
        if (
          (isOwner && g.status === "proposed") ||
          (!isOwner && g.status === "needs-changes")
        )
          next.push({
            key: `growth-${g.id}`,
            title: g.title,
            detail: `${g.clientName || "Client"} · ${isOwner ? "Scope and pricing approval" : "Proposal needs changes"}`,
            href: `/clients/${g.clientId}#client-growth`,
            due: g.targetDate || "",
            weight: 3,
          });
      const clients =
        value<Awaited<ReturnType<typeof clientService.getAll>>>(5) || [];
      more ||= clients.length > 50;
      try {
        const care = clients.length
          ? await clientCareService.summary(
              clients.slice(0, 50).map((c) => c.id),
            )
          : null;
        if (!live) return;
        for (const c of care?.clients || [])
          if (
            c.escalation?.status === "open" ||
            c.health?.status === "at-risk" ||
            !c.onboardingCompleted
          )
            next.push({
              key: `care-${c.clientId}`,
              title: c.clientName,
              detail:
                c.escalation?.status === "open"
                  ? "Concern escalated"
                  : c.health?.status === "at-risk"
                    ? "Client at risk"
                    : "Onboarding materials outstanding",
              href: `/clients/${c.clientId}#${c.escalation?.status === "open" || c.health?.status === "at-risk" ? "client-health" : "client-onboarding"}`,
              due: "",
              weight: c.escalation?.status === "open" ? 0 : 4,
            });
      } catch {
        partial = true;
      }
      if (!live) return;
      setItems(
        next.sort(
          (a, b) =>
            a.weight - b.weight ||
            (a.due || "9999").localeCompare(b.due || "9999"),
        ),
      );
      setLimited(more);
      setError(
        partial
          ? "Some queues could not be loaded. Retry or open the relevant section."
          : "",
      );
      setBusy(false);
    };
    void load();
    const invalidate = () => setRefresh((v) => v + 1);
    window.addEventListener("crm:client-work-changed", invalidate);
    window.addEventListener("crm:data-changed", invalidate);
    return () => {
      live = false;
      window.removeEventListener("crm:client-work-changed", invalidate);
      window.removeEventListener("crm:data-changed", invalidate);
    };
  }, [user?.uid, user?.id, isOwner, refresh]);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Today’s work</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            {isOwner
              ? "Decisions, client blockers and your work queue."
              : "Your next contacts, client responses and reviews."}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setRefresh((v) => v + 1)}
        >
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <p role="alert" className="text-sm text-destructive-text">
            {error}
          </p>
        )}
        {busy && !items.length ? (
          <p>Loading your work…</p>
        ) : !items.length ? (
          <p className="text-muted-foreground">
            No actions in the loaded queues. Review upcoming work in Client
            Success.
          </p>
        ) : (
          items.slice(0, 12).map((i) => (
            <Link
              key={i.key}
              to={i.href}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 hover:bg-muted/50"
            >
              <div className="min-w-0">
                <p className="font-medium break-words">{i.title}</p>
                <p className="text-sm text-muted-foreground">{i.detail}</p>
              </div>
              <span
                className={
                  i.due && i.due < paymentFollowUpToday()
                    ? "text-destructive-text text-sm"
                    : "text-muted-foreground text-sm"
                }
              >
                {i.due
                  ? i.due < paymentFollowUpToday()
                    ? "Overdue · " + i.due
                    : i.due === paymentFollowUpToday()
                      ? "Today"
                      : i.due
                  : "Action needed"}
              </span>
            </Link>
          ))
        )}
        <p className="text-xs text-muted-foreground">
          {items.length} actions loaded
          {items.length > 12 ? " · showing the first 12" : ""}.{" "}
          {limited
            ? "Some queues have additional pages; open their full views to load more."
            : ""}
        </p>
        <Button asChild variant="link">
          <Link to="/client-success">Open Client Success</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

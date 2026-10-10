import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { clientRequestService } from "@/services/clientSuccessService";
import {
  clientRelationshipService,
  type GrowthRecord,
} from "@/services/clientRelationshipService";
export function OperationalReports() {
  const [summary, setSummary] = useState<{
      open: number;
      review: number;
      urgent: number;
      proposals: number;
      days: number | null;
      limited: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    void Promise.all([
      clientRequestService.list(),
      clientRelationshipService.list<GrowthRecord>("opportunity"),
    ])
      .then(([requests, growth]) => {
        if (!live) return;
        const completed = requests.requests.filter(
          (r) => r.status === "completed",
        );
        const duration = completed
          .map((r) =>
            Math.max(0, Date.parse(r.updatedAt) - Date.parse(r.createdAt)),
          )
          .filter(Number.isFinite);
        setSummary({
          open: requests.requests.filter((r) => r.status !== "completed")
            .length,
          review: requests.requests.filter(
            (r) => r.status === "ready-for-review",
          ).length,
          urgent: requests.requests.filter(
            (r) => r.priority === "urgent" && r.status !== "completed",
          ).length,
          proposals: growth.records.filter((g) => g.status === "proposed")
            .length,
          days: duration.length
            ? Math.round(
                (duration.reduce((s, v) => s + v, 0) /
                  duration.length /
                  86400000) *
                  10,
              ) / 10
            : null,
          limited: !!requests.cursor || !!growth.cursor,
        });
        setError("");
      })
      .catch(() => {
        if (live) setError("Operational summary could not be loaded.");
      });
    return () => {
      live = false;
    };
  }, [retry]);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Operational overview</CardTitle>
        <Button variant="outline" onClick={() => setRetry((v) => v + 1)}>
          Refresh summary
        </Button>
      </CardHeader>
      <CardContent>
        {error && (
          <p role="alert" className="text-sm text-destructive-text">
            {error}
          </p>
        )}
        {summary && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {[
                ["Open requests", summary.open],
                ["Waiting for review", summary.review],
                ["Urgent open requests", summary.urgent],
                ["Scope/pricing decisions", summary.proposals],
                ["Completion age (days)", summary.days ?? "—"],
              ].map(([label, value]) => (
                <div className="rounded-lg border p-4" key={label}>
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="mt-2 text-2xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Based on loaded records
              {summary.limited
                ? " (more pages available in Client Success)"
                : ""}
              . Completion age uses the latest recorded update on completed
              requests. See Client Success for health and onboarding blockers.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

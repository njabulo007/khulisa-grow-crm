import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { clientService } from "@/services";
import {
  clientCareService,
  contactDate,
  HEALTH_LABELS,
  type CareSummary,
} from "@/services/clientCareService";
import { healthTone } from "@/lib/clientCarePresentation";
import { NoteContent } from "./NoteContent";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
const FILTERS = {
  attention: "Needs attention",
  risk: "At Risk",
  escalated: "Escalated",
  onboarding: "Onboarding incomplete",
  unreviewed: "Not assessed",
  all: "All",
} as const;
export function ClientHealthOverview() {
  const { user, isOwner } = useAuth();
  const [records, setRecords] = useState<CareSummary[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(0);
  const [filter, setFilter] = useState<keyof typeof FILTERS>("attention");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const load = useCallback(async (next?: { ids: string[]; offset: number }) => {
    const version = ++generation.current;
    setLoading(true);
    try {
      const clientIds =
        next?.ids || (await clientService.getAll()).map((client) => client.id);
      const offset = next?.offset || 0;
      const data = await clientCareService.summary(
        clientIds.slice(offset, offset + 50),
      );
      if (version !== generation.current) return;
      setIds(clientIds);
      setLoaded(offset + 50);
      setRecords((current) =>
        next ? [...current, ...data.clients] : data.clients,
      );
      setError("");
    } catch (e) {
      if (version === generation.current)
        setError(
          e instanceof Error ? e.message : "Client health could not be loaded.",
        );
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    setRecords([]);
    setIds([]);
    void load();
    const invalidate = () => {
      generation.current++;
    };
    return invalidate;
  }, [load, user?.uid]);
  const matches = (record: CareSummary, view: keyof typeof FILTERS) =>
    view === "all" ||
    (view === "attention"
      ? ["needs-attention", "at-risk"].includes(record.health?.status || "") ||
        record.escalation?.status === "open"
      : view === "risk"
        ? record.health?.status === "at-risk"
        : view === "escalated"
          ? record.escalation?.status === "open"
          : view === "onboarding"
            ? !record.onboardingCompleted
            : !record.health);
  const visible = records
    .filter((record) => matches(record, filter))
    .sort(
      (a, b) =>
        Number(b.escalation?.status === "open") -
          Number(a.escalation?.status === "open") ||
        Number(b.health?.status === "at-risk") -
          Number(a.health?.status === "at-risk") ||
        a.clientName.localeCompare(b.clientName),
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {isOwner ? "Client health and escalations" : "My client health"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Review concerns, recent contact, and onboarding blockers. Open a
          client to update health or the checklist.
        </p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(FILTERS).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={filter === key ? "default" : "outline"}
              aria-pressed={filter === key}
              onClick={() => setFilter(key as keyof typeof FILTERS)}
            >
              {label} (
              {
                records.filter((record) =>
                  matches(record, key as keyof typeof FILTERS),
                ).length
              }
              )
            </Button>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-destructive-text">
            {error}
          </p>
        )}
        {loading && (
          <p className="text-sm text-muted-foreground">
            Loading client health…
          </p>
        )}
        {!loading && !error && !visible.length && (
          <p className="text-sm text-muted-foreground">
            No clients in this view.
          </p>
        )}
        {visible.map((record) => (
          <div
            key={record.clientId}
            className="space-y-3 rounded-lg border p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link
                className="font-semibold text-primary-text hover:underline"
                to={`/clients/${encodeURIComponent(record.clientId)}#client-health`}
              >
                {record.clientName}
              </Link>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${healthTone(record.health?.status)}`}
              >
                {record.health
                  ? HEALTH_LABELS[record.health.status]
                  : "Not assessed"}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Last contact:{" "}
              {contactDate(record.lastContactAt) || "Not recorded"} ·
              Onboarding: {record.completedItems}/5 ready
            </p>
            {record.escalation?.status === "open" && (
              <p className="text-sm font-medium text-warning-text">
                Escalated · awaiting owner review
              </p>
            )}
            {(record.health?.reason || record.escalation?.reason) && (
              <details>
                <summary className="cursor-pointer text-sm text-primary-text">
                  View reason
                </summary>
                <NoteContent
                  text={
                    record.escalation?.status === "open"
                      ? record.escalation.reason
                      : record.health?.reason || ""
                  }
                />
              </details>
            )}
            <Link
              className="text-sm text-primary-text hover:underline"
              to={`/clients/${encodeURIComponent(record.clientId)}#client-onboarding`}
            >
              Review onboarding checklist
            </Link>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            disabled={loading}
            onClick={() => void load()}
          >
            Refresh client health
          </Button>
          {loaded < ids.length && (
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void load({ ids, offset: loaded })}
            >
              Load more clients
            </Button>
          )}
        </div>
        {loaded < ids.length && (
          <p className="text-xs text-muted-foreground">
            Counts and filters cover loaded clients. Load more to include the
            rest.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

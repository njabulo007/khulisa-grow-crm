import { useEffect, useRef, useState } from "react";
import {
  clientRelationshipService,
  FEEDBACK_DECISIONS,
  OPPORTUNITY_STAGES,
  type FeedbackRecord,
  type GrowthRecord,
} from "@/services/clientRelationshipService";
import { Button } from "@/components/ui/button";
import { NoteContent } from "./NoteContent";
export function RelationshipHistory({
  kind,
  clientId,
  recordId,
  version,
}: {
  kind: "feedback" | "opportunity";
  clientId: string;
  recordId: string;
  version: number;
}) {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<Array<FeedbackRecord | GrowthRecord>>(
    [],
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const load = async (next?: string) => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const data = await clientRelationshipService.history(
        kind,
        clientId,
        recordId,
        next,
      );
      if (current !== generation.current) return;
      setRecords((previous) =>
        next ? [...previous, ...data.revisions] : data.revisions,
      );
      setCursor(data.cursor);
      setError("");
    } catch (e) {
      if (current === generation.current)
        setError(
          e instanceof Error ? e.message : "History could not be loaded.",
        );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    setOpen(false);
    setRecords([]);
    const invalidate = () => {
      generation.current++;
    };
    return invalidate;
  }, [version, recordId, clientId]);
  return (
    <div className="space-y-3">
      <Button
        size="sm"
        variant="ghost"
        disabled={loading}
        onClick={() => {
          setOpen((current) => !current);
          if (!open) void load();
        }}
      >
        {open ? "Hide revision history" : "View revision history"}
      </Button>
      {open && (
        <div className="space-y-3 border-l-2 border-border pl-4">
          {loading && (
            <p className="text-sm text-muted-foreground">Loading history…</p>
          )}
          {error && (
            <p role="alert" className="text-destructive-text">
              {error}
            </p>
          )}
          {records.map((record) => (
            <details key={record.id} className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Revision {record.version} ·{" "}
                {"decision" in record
                  ? FEEDBACK_DECISIONS[record.decision]
                  : OPPORTUNITY_STAGES[record.status]}{" "}
                ·{" "}
                {new Date(record.updatedAt).toLocaleString("en-ZA", {
                  timeZone: "Africa/Johannesburg",
                })}
              </summary>
              {"decision" in record ? (
                <div className="space-y-2 pt-3">
                  <p className="text-sm">
                    {record.title} · {record.deliverableVersion} ·{" "}
                    {record.decidedBy} · {record.decisionDate}
                  </p>
                  <NoteContent text={record.notes} />
                </div>
              ) : (
                <div className="space-y-2 pt-3">
                  <p className="text-sm">
                    {record.title} · Suggested price:{" "}
                    {record.suggestedPrice === null
                      ? "Not specified"
                      : `R ${record.suggestedPrice.toFixed(2)}`}
                  </p>
                  <NoteContent text={record.proposal} />
                  <NoteContent text={record.suggestedScope} />
                  {record.status === "approved" && (
                    <>
                      <p className="text-sm font-medium text-success-text">
                        Approved price: R {record.approvedPrice?.toFixed(2)}
                      </p>
                      <NoteContent text={record.approvedScope} />
                    </>
                  )}
                  {record.ownerNote && <NoteContent text={record.ownerNote} />}
                </div>
              )}
            </details>
          ))}
          {cursor && (
            <Button
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => void load(cursor)}
            >
              Load more revisions
            </Button>
          )}
          {error && (
            <Button
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => void load()}
            >
              Retry history
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

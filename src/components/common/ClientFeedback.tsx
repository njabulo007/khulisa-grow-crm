import { useCallback, useEffect, useRef, useState } from "react";
import { useClientSectionRefresh } from "@/hooks/useClientSectionRefresh";
import { useClientSectionAnchor } from "@/hooks/useClientSectionAnchor";
import { useAuth } from "@/contexts/AuthContext";
import {
  clientRelationshipService,
  FEEDBACK_DECISIONS,
  type FeedbackInput,
  type FeedbackRecord,
} from "@/services/clientRelationshipService";
import { clientWorkChanged } from "@/services/clientSuccessService";
import { paymentFollowUpToday } from "@/services/paymentFollowUpService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NoteEditor } from "./NoteEditor";
import { NoteContent } from "./NoteContent";
import { RelationshipHistory } from "./RelationshipHistory";
import { toast } from "sonner";
const selectStyle =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground";
export function ClientFeedback({
  clientId,
  contactName,
}: {
  clientId: string;
  contactName: string;
}) {
  const { user } = useAuth();
  const empty = (): FeedbackInput => ({
    title: "",
    deliverableVersion: "1",
    decision: "approved",
    decisionDate: paymentFollowUpToday(),
    decidedBy: contactName,
    notes: "",
  });
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [form, setForm] = useState<FeedbackInput>(empty);
  const [editing, setEditing] = useState<FeedbackRecord | null>(null);
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const attempt = useRef<{ input: string; id: string } | null>(null);
  const load = useCallback(
    async (next?: string) => {
      const version = ++generation.current;
      setLoading(true);
      try {
        const data = await clientRelationshipService.list<FeedbackRecord>(
          "feedback",
          clientId,
          next,
        );
        if (version !== generation.current) return;
        setRecords((current) =>
          next ? [...current, ...data.records] : data.records,
        );
        setEditing((current) =>
          current
            ? data.records.find((record) => record.id === current.id) || current
            : null,
        );
        setCursor(data.cursor);
        setError("");
      } catch (e) {
        if (version === generation.current)
          setError(
            e instanceof Error ? e.message : "Feedback could not be loaded.",
          );
      } finally {
        if (version === generation.current) setLoading(false);
      }
    },
    [clientId],
  );
  useEffect(() => {
    setRecords([]);
    setShow(false);
    setEditing(null);
    void load();
    const invalidate = () => {
      generation.current++;
    };
    return invalidate;
  }, [load, user?.uid]);
  useClientSectionRefresh("#client-feedback", load);
  useClientSectionAnchor(clientId, !loading);
  useEffect(() => {
    if (!show) return;
    const frame = requestAnimationFrame(() => {
      document
        .getElementById("feedback-form")
        ?.scrollIntoView({ block: "start" });
      document.getElementById("feedback-title")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [show, editing?.id]);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    const payload = {
      clientId,
      ...form,
      ...(editing ? { recordId: editing.id, version: editing.version } : {}),
    };
    const input = JSON.stringify(payload);
    if (attempt.current?.input !== input)
      attempt.current = { input, id: crypto.randomUUID() };
    const current = generation.current;
    try {
      await clientRelationshipService.saveFeedback({
        ...payload,
        requestId: attempt.current.id,
      });
      if (current !== generation.current) return;
      setShow(false);
      setEditing(null);
      setForm(empty());
      attempt.current = null;
      toast.success("Client feedback recorded.");
      await load();
      clientWorkChanged();
    } catch (e) {
      if (current === generation.current)
        toast.error(
          e instanceof Error ? e.message : "Could not record feedback.",
        );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card id="client-feedback" className="scroll-mt-24">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Feedback and approvals</CardTitle>
        <Button
          size="sm"
          disabled={saving}
          onClick={() => {
            setEditing(null);
            setForm(empty());
            setShow(true);
          }}
        >
          Record feedback
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Record what the client reviewed, their decision, and the version they
          approved or asked to change.
        </p>
        {show && (
          <div
            id="feedback-form"
            className="scroll-mt-24 space-y-4 rounded-lg border p-4"
          >
            <h3 className="font-medium">
              {editing
                ? `Record revision ${editing.version + 1}`
                : "New client feedback"}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="feedback-title">Deliverable or request</Label>
                <Input
                  id="feedback-title"
                  maxLength={160}
                  value={form.title}
                  disabled={saving}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Homepage design"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="feedback-version">Deliverable version</Label>
                <Input
                  id="feedback-version"
                  maxLength={120}
                  value={form.deliverableVersion}
                  disabled={saving}
                  onChange={(e) =>
                    setForm({ ...form, deliverableVersion: e.target.value })
                  }
                  placeholder="e.g. Design v2"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="feedback-decision">Client decision</Label>
                <select
                  id="feedback-decision"
                  className={selectStyle}
                  value={form.decision}
                  disabled={saving}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      decision: e.target.value as FeedbackInput["decision"],
                    })
                  }
                >
                  {Object.entries(FEEDBACK_DECISIONS).map(([key, label]) => (
                    <option value={key} key={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="feedback-date">Decision date</Label>
                <Input
                  id="feedback-date"
                  type="date"
                  max={paymentFollowUpToday()}
                  value={form.decisionDate}
                  disabled={saving}
                  onChange={(e) =>
                    setForm({ ...form, decisionDate: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="feedback-person">Client approver / contact</Label>
              <Input
                id="feedback-person"
                maxLength={160}
                value={form.decidedBy}
                disabled={saving}
                onChange={(e) =>
                  setForm({ ...form, decidedBy: e.target.value })
                }
              />
            </div>
            <NoteEditor
              label="Client feedback details"
              value={form.notes}
              maxLength={10000}
              disabled={saving}
              onChange={(notes) => setForm({ ...form, notes })}
              placeholder="Record the client's response, approved items, requested changes, and where the feedback was received."
            />
            <div className="flex gap-2">
              <Button
                disabled={
                  saving || loading || !form.title.trim() || !form.notes.trim()
                }
                onClick={() => void save()}
              >
                Save feedback revision
              </Button>
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => setShow(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-destructive-text">
            {error}
          </p>
        )}
        {loading && (
          <p className="text-sm text-muted-foreground">Loading feedback…</p>
        )}
        {!loading && !error && !records.length && (
          <p className="text-sm text-muted-foreground">
            No client feedback recorded yet.
          </p>
        )}
        {[...records]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((record) => (
            <div key={record.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <h3 className="min-w-0 flex-1 break-words font-semibold">
                  {record.title}
                </h3>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${record.decision === "approved" ? "bg-success/10 text-success-text" : record.decision === "rejected" ? "bg-destructive/10 text-destructive-text" : "bg-warning/10 text-warning-text"}`}
                >
                  {FEEDBACK_DECISIONS[record.decision]}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {record.deliverableVersion} · {record.decidedBy} ·{" "}
                {record.decisionDate} · Revision {record.version}
              </p>
              <NoteContent text={record.notes} />
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => {
                  setEditing(record);
                  setForm({ ...record, decisionDate: paymentFollowUpToday() });
                  setShow(true);
                }}
              >
                Record next revision
              </Button>
              <RelationshipHistory
                kind="feedback"
                clientId={clientId}
                recordId={record.id}
                version={record.version}
              />
            </div>
          ))}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={loading || saving}
            onClick={() => void load()}
          >
            Refresh feedback
          </Button>
          {cursor && (
            <Button
              size="sm"
              variant="outline"
              disabled={loading || saving}
              onClick={() => void load(cursor)}
            >
              Load more feedback
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

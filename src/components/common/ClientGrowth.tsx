import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useClientSectionRefresh } from "@/hooks/useClientSectionRefresh";
import { useClientSectionAnchor } from "@/hooks/useClientSectionAnchor";
import { useAuth } from "@/contexts/AuthContext";
import { clientService } from "@/services";
import {
  clientRelationshipService,
  OPPORTUNITY_TYPES,
  OPPORTUNITY_STAGES,
  type GrowthInput,
  type GrowthRecord,
} from "@/services/clientRelationshipService";
import { clientWorkChanged } from "@/services/clientSuccessService";
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
const rand = (value: number | null) =>
  value === null
    ? "Not specified"
    : new Intl.NumberFormat("en-ZA", {
        style: "currency",
        currency: "ZAR",
      }).format(value);
function GrowthReview({
  record,
  refresh,
}: {
  record: GrowthRecord;
  refresh: () => Promise<void>;
}) {
  const [stage, setStage] = useState<"approved" | "needs-changes" | "declined">(
    "approved",
  );
  const [scope, setScope] = useState(
    record.approvedScope || record.suggestedScope,
  );
  const [price, setPrice] = useState(
    record.approvedPrice === null
      ? record.suggestedPrice === null
        ? ""
        : String(record.suggestedPrice)
      : String(record.approvedPrice),
  );
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const attempt = useRef<{ input: string; id: string } | null>(null);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    const payload = {
      clientId: record.clientId,
      recordId: record.id,
      version: record.version,
      status: stage,
      approvedScope: scope,
      approvedPrice: price === "" ? null : Number(price),
      ownerNote: note,
    };
    const input = JSON.stringify(payload);
    if (attempt.current?.input !== input)
      attempt.current = { input, id: crypto.randomUUID() };
    try {
      await clientRelationshipService.reviewGrowth({
        ...payload,
        requestId: attempt.current.id,
      });
      attempt.current = null;
      toast.success("Opportunity review saved.");
      await refresh();
      clientWorkChanged();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not review opportunity.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer font-medium text-primary-text">
        Owner scope and pricing review
      </summary>
      <div className="space-y-4 pt-4">
        <Label htmlFor={`growth-review-${record.id}`}>Owner decision</Label>
        <select
          id={`growth-review-${record.id}`}
          className={selectStyle}
          value={stage}
          disabled={saving}
          onChange={(e) => setStage(e.target.value as typeof stage)}
        >
          <option value="approved">Approve</option>
          <option value="needs-changes">Request Changes</option>
          <option value="declined">Decline</option>
        </select>
        {stage === "approved" && (
          <>
            <NoteEditor
              label="Approved scope"
              value={scope}
              onChange={setScope}
              maxLength={10000}
              disabled={saving}
            />
            <Label htmlFor={`growth-price-${record.id}`}>
              Approved price (ZAR)
            </Label>
            <Input
              id={`growth-price-${record.id}`}
              type="number"
              min={0}
              max={1e9}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={saving}
            />
          </>
        )}
        <NoteEditor
          label="Owner review note"
          value={note}
          onChange={setNote}
          maxLength={4000}
          disabled={saving}
          placeholder="Explain your decision or what must change."
        />
        <Button
          disabled={
            saving ||
            (stage === "approved"
              ? !scope.trim() || price === ""
              : !note.trim())
          }
          onClick={() => void save()}
        >
          Save opportunity review
        </Button>
      </div>
    </details>
  );
}
export function ClientGrowth({ clientId }: { clientId?: string }) {
  const { user, isOwner } = useAuth();
  const [records, setRecords] = useState<GrowthRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState(clientId ? "all" : "open");
  const [clients, setClients] = useState<
    Array<{ id: string; businessName: string }>
  >([]);
  const [selectedClient, setSelectedClient] = useState(clientId || "");
  const [form, setForm] = useState({
    title: "",
    type: "additional-service" as GrowthInput["type"],
    proposal: "",
    suggestedScope: "",
    targetDate: "",
    price: "",
  });
  const [editing, setEditing] = useState<GrowthRecord | null>(null);
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clientsLoading, setClientsLoading] = useState(false);
  const generation = useRef(0);
  const attempt = useRef<{ input: string; id: string } | null>(null);
  const load = useCallback(
    async (next?: string) => {
      const version = ++generation.current;
      setLoading(true);
      try {
        const data = await clientRelationshipService.list<GrowthRecord>(
          "opportunity",
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
            e instanceof Error
              ? e.message
              : "Opportunities could not be loaded.",
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
    setClients([]);
    setEditing(null);
    void load();
    const invalidate = () => {
      generation.current++;
    };
    return invalidate;
  }, [load, user?.uid]);
  useClientSectionRefresh("#client-growth", load);
  useClientSectionAnchor(clientId, !loading);
  useEffect(() => {
    if (!show) return;
    const frame = requestAnimationFrame(() => {
      document
        .getElementById("growth-form")
        ?.scrollIntoView({ block: "start" });
      document.getElementById("growth-title")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [show, editing?.id]);
  const create = async () => {
    setEditing(null);
    setForm({
      title: "",
      type: "additional-service",
      proposal: "",
      suggestedScope: "",
      targetDate: "",
      price: "",
    });
    setSelectedClient(clientId || "");
    setShow(true);
    if (!clientId) {
      const version = generation.current;
      setClientsLoading(true);
      try {
        const values = await clientService.getAll();
        if (version === generation.current) setClients(values);
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Clients could not be loaded.",
        );
      } finally {
        setClientsLoading(false);
      }
    }
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    const { price, ...fields } = form;
    const payload = {
      clientId: editing?.clientId || selectedClient,
      ...fields,
      suggestedPrice: price === "" ? null : Number(price),
      ...(editing ? { recordId: editing.id, version: editing.version } : {}),
    };
    const input = JSON.stringify(payload);
    if (attempt.current?.input !== input)
      attempt.current = { input, id: crypto.randomUUID() };
    const current = generation.current;
    try {
      await clientRelationshipService.saveGrowth({
        ...payload,
        requestId: attempt.current.id,
      });
      if (current !== generation.current) return;
      setShow(false);
      setEditing(null);
      attempt.current = null;
      toast.success("Growth opportunity proposed to the owner.");
      await load();
      clientWorkChanged();
    } catch (e) {
      if (current === generation.current)
        toast.error(
          e instanceof Error ? e.message : "Could not propose opportunity.",
        );
    } finally {
      setSaving(false);
    }
  };
  const visible = records
    .filter(
      (record) =>
        filter === "all" ||
        (filter === "open"
          ? ["proposed", "needs-changes"].includes(record.status)
          : record.status === filter),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <Card id="client-growth" className="scroll-mt-24">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>
          {clientId
            ? "Growth opportunities"
            : isOwner
              ? "Growth proposals to review"
              : "My growth proposals"}
        </CardTitle>
        <Button
          size="sm"
          disabled={saving || clientsLoading}
          onClick={() => void create()}
        >
          Propose opportunity
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Propose additional services, renewals, or referrals. The owner
          approves the final scope and pricing.
        </p>
        {show && (
          <div
            id="growth-form"
            className="scroll-mt-24 space-y-4 rounded-lg border p-4"
          >
            <h3 className="font-medium">
              {editing ? "Revise growth proposal" : "New growth proposal"}
            </h3>
            {!clientId && !editing && (
              <>
                <Label htmlFor="growth-client">Client</Label>
                <select
                  id="growth-client"
                  className={selectStyle}
                  value={selectedClient}
                  disabled={saving || clientsLoading}
                  onChange={(e) => setSelectedClient(e.target.value)}
                >
                  <option value="">
                    {clientsLoading ? "Loading clients…" : "Select a client"}
                  </option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.businessName}
                    </option>
                  ))}
                </select>
              </>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="growth-title">Opportunity title</Label>
                <Input
                  id="growth-title"
                  maxLength={160}
                  value={form.title}
                  disabled={saving}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Website maintenance renewal"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="growth-type">Opportunity type</Label>
                <select
                  id="growth-type"
                  className={selectStyle}
                  disabled={saving}
                  value={form.type}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      type: e.target.value as GrowthInput["type"],
                    })
                  }
                >
                  {Object.entries(OPPORTUNITY_TYPES).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <NoteEditor
              label="Opportunity proposal"
              value={form.proposal}
              onChange={(proposal) => setForm({ ...form, proposal })}
              maxLength={10000}
              disabled={saving}
              placeholder="Describe the client's need, renewal, or referral and why it makes sense."
            />
            <NoteEditor
              label="Suggested scope"
              value={form.suggestedScope}
              onChange={(suggestedScope) =>
                setForm({ ...form, suggestedScope })
              }
              maxLength={10000}
              disabled={saving}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="growth-suggested-price">
                  Suggested price (ZAR, optional)
                </Label>
                <Input
                  id="growth-suggested-price"
                  type="number"
                  min={0}
                  max={1e9}
                  step="0.01"
                  value={form.price}
                  disabled={saving}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="growth-date">
                  Target or renewal date (optional)
                </Label>
                <Input
                  id="growth-date"
                  type="date"
                  value={form.targetDate}
                  disabled={saving}
                  onChange={(e) =>
                    setForm({ ...form, targetDate: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                disabled={
                  saving ||
                  loading ||
                  Boolean(editing && !editing.canEditProposal) ||
                  !form.title.trim() ||
                  !form.proposal.trim() ||
                  !form.suggestedScope.trim() ||
                  (!clientId && !editing && !selectedClient)
                }
                onClick={() => void save()}
              >
                Submit growth proposal
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
        <div className="flex flex-wrap gap-2">
          {[
            ["open", "Open"],
            ...Object.entries(OPPORTUNITY_STAGES),
            ["all", "All"],
          ].map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={filter === key ? "default" : "outline"}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
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
            Loading growth proposals…
          </p>
        )}
        {!loading && !error && !visible.length && (
          <p className="text-sm text-muted-foreground">
            No opportunities in this view.
          </p>
        )}
        {visible.map((record) => (
          <div key={record.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="min-w-0 flex-1 break-words font-semibold">
                {record.title}
              </h3>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${record.status === "approved" ? "bg-success/10 text-success-text" : record.status === "declined" ? "bg-destructive/10 text-destructive-text" : "bg-warning/10 text-warning-text"}`}
              >
                {OPPORTUNITY_STAGES[record.status]}
              </span>
            </div>
            {!clientId && (
              <Link
                className="text-sm text-primary-text hover:underline"
                to={`/clients/${encodeURIComponent(record.clientId)}#client-growth`}
              >
                {record.clientName}
              </Link>
            )}
            <p className="text-sm text-muted-foreground">
              {OPPORTUNITY_TYPES[record.type]} · Suggested:{" "}
              {rand(record.suggestedPrice)}
              {record.targetDate ? ` · Target: ${record.targetDate}` : ""}
            </p>
            {record.proposedByName && (
              <p className="text-xs text-muted-foreground">
                Proposed by {record.proposedByName}
              </p>
            )}
            <details>
              <summary className="cursor-pointer text-sm text-primary-text">
                Proposal and suggested scope
              </summary>
              <div className="space-y-3 pt-3">
                <NoteContent text={record.proposal} />
                <NoteContent text={record.suggestedScope} />
              </div>
            </details>
            {record.status === "approved" && (
              <div className="space-y-2 rounded-lg bg-success/5 p-4">
                <p className="font-medium text-success-text">
                  Owner-approved price: {rand(record.approvedPrice)}
                </p>
                <p className="text-sm font-medium">Owner-approved scope</p>
                <NoteContent text={record.approvedScope} />
              </div>
            )}
            {record.ownerNote && (
              <div>
                <p className="text-sm font-medium">Owner feedback</p>
                <NoteContent text={record.ownerNote} />
              </div>
            )}
            {record.canEditProposal && (
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setEditing(record);
                  setSelectedClient(record.clientId);
                  setForm({
                    title: record.title,
                    type: record.type,
                    proposal: record.proposal,
                    suggestedScope: record.suggestedScope,
                    targetDate: record.targetDate,
                    price:
                      record.suggestedPrice === null
                        ? ""
                        : String(record.suggestedPrice),
                  });
                  setShow(true);
                }}
              >
                Revise proposal
              </Button>
            )}
            {isOwner && (
              <GrowthReview
                key={`${record.id}:${record.version}`}
                record={record}
                refresh={() => load()}
              />
            )}
            <RelationshipHistory
              kind="opportunity"
              clientId={record.clientId}
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
            Refresh growth proposals
          </Button>
          {cursor && (
            <Button
              size="sm"
              variant="outline"
              disabled={loading || saving}
              onClick={() => void load(cursor)}
            >
              Load more opportunities
            </Button>
          )}
        </div>
        {cursor && (
          <p className="text-xs text-muted-foreground">
            Filters cover loaded opportunities. Load more to include the rest.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

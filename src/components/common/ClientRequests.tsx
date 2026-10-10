import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { clientService } from "@/services/clientService";
import {
  clientRequestService,
  clientWorkChanged,
  newClientRequestId,
  REQUEST_PRIORITIES,
  REQUEST_STAGES,
  type ClientRequest,
  type RequestPriority,
  type RequestStatus,
} from "@/services/clientSuccessService";
import type { Client } from "@/types/models";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NoteEditor } from "./NoteEditor";
import { NoteContent } from "./NoteContent";
import { toast } from "sonner";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const fileAccept = "image/png,image/jpeg,image/webp,application/pdf,text/plain";
function RequestCard({
  record,
  refresh,
}: {
  record: ClientRequest;
  refresh: () => Promise<void>;
}) {
  const { isOwner } = useAuth();
  const [stage, setStage] = useState(record.status);
  const [update, setUpdate] = useState(record.ownerUpdate);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setStage(record.status);
    setUpdate(record.ownerUpdate);
  }, [record.status, record.ownerUpdate, record.version]);
  const perform = async (
    operation: () => Promise<unknown>,
    message?: string,
  ) => {
    if (busy) return;
    setBusy(true);
    try {
      await operation();
      if (message) toast.success(message);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Request could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const chosen = Array.from(files);
    if (
      chosen.length +
        record.attachments.length +
        record.pendingAttachments.length >
        3 ||
      chosen.some(
        (file) =>
          !file.size ||
          file.size > 2 * 1024 * 1024 ||
          !fileAccept.split(",").includes(file.type || "text/plain"),
      )
    ) {
      toast.error(
        "Use up to 3 PNG, JPG, WebP, PDF or text files, each up to 2 MB.",
      );
      return;
    }
    await perform(async () => {
      for (const file of chosen)
        await clientRequestService.upload(record.id, crypto.randomUUID(), file);
    }, "Attachments added.");
  };
  return (
    <article
      id={`request-${record.id}`}
      className="space-y-4 rounded-xl border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            <Link
              className="text-primary-text underline underline-offset-4"
              to={`/clients/${encodeURIComponent(record.clientId)}#client-requests`}
            >
              {record.clientName}
            </Link>{" "}
            · {record.category.replace(/-/g, " ")}
          </p>
          <h3 className="mt-1 break-words text-base font-semibold">
            {record.title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Submitted{" "}
            {new Date(record.createdAt).toLocaleString("en-ZA", {
              timeZone: "Africa/Johannesburg",
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border bg-muted px-3 py-1 text-xs font-medium">
            {REQUEST_STAGES[record.status]}
          </span>
          <span
            className={`rounded-full border px-3 py-1 text-xs font-medium ${["urgent", "high"].includes(record.priority) ? "bg-warning/10 text-warning-text" : "text-muted-foreground"}`}
          >
            {REQUEST_PRIORITIES[record.priority]} priority
          </span>
        </div>
      </div>
      <NoteContent text={record.description} />
      {!!record.attachments.length && (
        <ul className="space-y-2">
          {record.attachments.map((file) => (
            <li
              key={file.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm"
            >
              <span className="min-w-0 flex-1 break-words">
                {file.name} · {Math.ceil(file.sizeBytes / 1024)} KB
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void perform(() =>
                    clientRequestService.download(record.id, file.id),
                  )
                }
              >
                Download
              </Button>
              {record.canEditFiles &&
                (record.status !== "completed" || isOwner) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void perform(
                        () =>
                          clientRequestService.removeAttachment(
                            record.id,
                            file.id,
                          ),
                        "Attachment removed.",
                      )
                    }
                  >
                    Remove
                  </Button>
                )}
            </li>
          ))}
        </ul>
      )}
      {record.pendingAttachments.map((file) => (
        <div
          key={file.id}
          className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
        >
          <p className="flex-1 break-words">
            {file.name}: upload did not finish. Remove this entry and add the
            file again.
          </p>
          {record.canEditFiles &&
            (record.status !== "completed" || isOwner) && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void perform(
                    () =>
                      clientRequestService.removeAttachment(record.id, file.id),
                    "Incomplete attachment removed.",
                  )
                }
              >
                Remove incomplete upload
              </Button>
            )}
        </div>
      ))}
      {record.canEditFiles && record.status !== "completed" && (
        <div className="space-y-2">
          <Label htmlFor={`attachments-${record.id}`}>Add attachments</Label>
          <Input
            id={`attachments-${record.id}`}
            type="file"
            accept={fileAccept}
            multiple
            disabled={
              busy ||
              record.attachments.length + record.pendingAttachments.length >= 3
            }
            onChange={(event) => {
              void upload(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
      )}
      {record.ownerUpdate && (
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Owner update
          </p>
          <NoteContent text={record.ownerUpdate} />
        </div>
      )}
      {isOwner && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Update work progress
          </summary>
          <div className="mt-4 space-y-3">
            <Label htmlFor={`stage-${record.id}`}>Progress stage</Label>
            <select
              id={`stage-${record.id}`}
              className={selectClass}
              value={stage}
              disabled={busy}
              onChange={(event) =>
                setStage(event.target.value as RequestStatus)
              }
            >
              {Object.entries(REQUEST_STAGES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <NoteEditor
              label="Update for the manager"
              value={update}
              onChange={setUpdate}
              disabled={busy}
              maxLength={4000}
              placeholder="What changed, what needs review, or what happens next?"
            />
            <Button
              disabled={
                busy ||
                (stage === record.status && update === record.ownerUpdate)
              }
              onClick={() =>
                void perform(
                  () =>
                    clientRequestService.updateStatus(record, stage, update),
                  "Work progress updated.",
                )
              }
            >
              {busy ? "Saving…" : "Save progress"}
            </Button>
          </div>
        </details>
      )}
    </article>
  );
}

export function ClientRequests({ clientId }: { clientId?: string }) {
  const { user, isOwner } = useAuth();
  const [records, setRecords] = useState<ClientRequest[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState(clientId || "");
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState("open");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("website-change");
  const [priority, setPriority] = useState<RequestPriority>("normal");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const submission = useRef<{ input: string; id: string } | null>(null);
  const generation = useRef(0);
  const load = useCallback(
    async (next?: string) => {
      const version = ++generation.current;
      setLoading(true);
      try {
        const data = await clientRequestService.list(clientId, next);
        if (version !== generation.current) return;
        setRecords((current) =>
          next
            ? [...current, ...data.requests].filter(
                (entry, index, all) =>
                  all.findIndex((item) => item.id === entry.id) === index,
              )
            : data.requests,
        );
        setCursor(data.cursor);
        setError("");
      } catch (error) {
        if (version === generation.current)
          setError(
            error instanceof Error
              ? error.message
              : "Requests could not be loaded.",
          );
      } finally {
        if (version === generation.current) setLoading(false);
      }
    },
    [clientId],
  );
  useEffect(() => {
    setRecords([]);
    setSelectedClient(clientId || "");
    setTitle("");
    setDescription("");
    setAttachments([]);
    setFormOpen(false);
    submission.current = null;
    void load();
    const invalidate = () => {
      generation.current++;
    };
    return invalidate;
  }, [load, clientId, user?.uid]);
  useEffect(() => {
    if (clientId || !formOpen) return;
    let active = true;
    clientService
      .getAll()
      .then((items) => {
        if (active) setClients(items);
      })
      .catch(() => {
        if (active)
          toast.error(
            "Client choices could not be loaded. Open a client to submit a request.",
          );
      });
    return () => {
      active = false;
    };
  }, [clientId, formOpen, user?.uid]);
  const create = async () => {
    if (saving || !selectedClient || !title.trim() || !description.trim())
      return;
    setSaving(true);
    let savedId: string | undefined;
    try {
      const input = JSON.stringify({
        selectedClient,
        title,
        description,
        category,
        priority,
      });
      if (submission.current?.input !== input)
        submission.current = { input, id: newClientRequestId() };
      const result = await clientRequestService.create({
        clientId: selectedClient,
        requestId: submission.current.id,
        title,
        description,
        category,
        priority,
      });
      savedId = result.requestId;
      // The request is durable before files upload. Never create duplicates to retry a file failure.
      setTitle("");
      setDescription("");
      setFormOpen(false);
      submission.current = null;
      for (const file of attachments)
        await clientRequestService.upload(
          result.requestId,
          crypto.randomUUID(),
          file,
        );
      toast.success("Client request submitted.");
    } catch (error) {
      toast.error(
        savedId
          ? "Request saved, but some attachments did not finish. Open the saved request to add or retry files."
          : error instanceof Error
            ? error.message
            : "Request could not be submitted.",
      );
    } finally {
      if (savedId) {
        setAttachments([]);
        await load();
        clientWorkChanged();
      }
      setSaving(false);
    }
  };
  const filtered = records
    .filter(
      (record) =>
        filter === "all" ||
        (filter === "open"
          ? record.status !== "completed"
          : record.status === filter),
    )
    .sort(
      (a, b) =>
        (isOwner
          ? ["urgent", "high", "normal", "low"].indexOf(a.priority) -
            ["urgent", "high", "normal", "low"].indexOf(b.priority)
          : 0) || b.createdAt.localeCompare(a.createdAt),
    );
  return (
    <Card id="client-requests">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg">
            {clientId
              ? "Client requests"
              : isOwner
                ? "My work queue"
                : "My submitted requests"}
          </CardTitle>
          <Button
            size="sm"
            disabled={saving}
            onClick={() => setFormOpen((open) => !open)}
          >
            {formOpen ? "Close form" : "New request"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {isOwner
            ? "Review client changes and requirements, then keep managers informed of progress."
            : "Send client changes, issues, and new requirements to the owner and track their progress."}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {formOpen && (
          <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
            {!clientId && (
              <div className="space-y-2">
                <Label htmlFor="request-client">Client</Label>
                <select
                  id="request-client"
                  className={selectClass}
                  value={selectedClient}
                  disabled={saving}
                  onChange={(event) => setSelectedClient(event.target.value)}
                >
                  <option value="">Choose client</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.businessName}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="request-title">Request title</Label>
              <Input
                id="request-title"
                value={title}
                maxLength={160}
                disabled={saving}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Update homepage services and photos"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="request-category">Category</Label>
                <select
                  id="request-category"
                  className={selectClass}
                  value={category}
                  disabled={saving}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  <option value="website-change">Website change</option>
                  <option value="issue">Issue</option>
                  <option value="new-requirement">New requirement</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="request-priority">Priority</Label>
                <select
                  id="request-priority"
                  className={selectClass}
                  value={priority}
                  disabled={saving}
                  onChange={(event) =>
                    setPriority(event.target.value as RequestPriority)
                  }
                >
                  {Object.entries(REQUEST_PRIORITIES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <NoteEditor
              label="Request details"
              value={description}
              onChange={setDescription}
              disabled={saving}
              maxLength={10000}
              placeholder="What does the client need? Include the affected page, expected result, and any agreed deadline."
            />
            <div className="space-y-2">
              <Label htmlFor="request-files">Attachments (optional)</Label>
              <Input
                id="request-files"
                type="file"
                accept={fileAccept}
                multiple
                disabled={saving}
                onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  if (
                    files.length > 3 ||
                    files.some(
                      (file) =>
                        !file.size ||
                        file.size > 2 * 1024 * 1024 ||
                        !fileAccept
                          .split(",")
                          .includes(file.type || "text/plain"),
                    )
                  ) {
                    toast.error(
                      "Use up to 3 PNG, JPG, WebP, PDF or text files, each up to 2 MB.",
                    );
                    event.target.value = "";
                    setAttachments([]);
                  } else setAttachments(files);
                }}
              />
              <p className="text-xs text-muted-foreground">
                Up to 3 files, 2 MB each. PNG, JPG, WebP, PDF or text. Downloads
                require CRM access.
              </p>
            </div>
            <Button
              disabled={
                saving ||
                !selectedClient ||
                !title.trim() ||
                !description.trim()
              }
              onClick={() => void create()}
            >
              {saving ? "Submitting…" : "Submit request"}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive-text">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {[
            ["open", "Open"],
            ...Object.entries(REQUEST_STAGES),
            ["all", "All"],
          ].map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? "secondary" : "ghost"}
              onClick={() => setFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        {loading && (
          <p className="text-sm text-muted-foreground">Loading requests…</p>
        )}
        {!loading && !filtered.length && (
          <p className="text-sm text-muted-foreground">
            No requests in this view.
          </p>
        )}
        {filtered.map((record) => (
          <RequestCard key={record.id} record={record} refresh={() => load()} />
        ))}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={loading || saving}
            onClick={() => void load()}
          >
            Refresh requests
          </Button>
          {cursor && (
            <Button
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => void load(cursor)}
            >
              Load more requests
            </Button>
          )}
        </div>
        {cursor && (
          <p className="text-xs text-muted-foreground">
            Filters apply to loaded requests. Load more requests to include
            more.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

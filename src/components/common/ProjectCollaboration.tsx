import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  workspaceRequest,
  type WorkspaceData,
  type WorkspaceFile,
  type Conversation,
  type TrackedMilestone,
} from "@/services/projectWorkspaceService";
import {
  fileBase64,
  downloadOnboardingFile,
} from "@/services/portalOnboardingService";
import {
  FILE_CATEGORIES,
  MILESTONE_STATUSES,
  nextProjectMilestone,
  milestoneSummary,
  milestoneStatus,
  orderedMilestones,
} from "../../../shared/projectTracking.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
const select =
  "min-h-11 max-w-full w-full rounded-md border border-input bg-background px-3 text-base";
const formatDate = (v: string) =>
  v
    ? new Date(v.length === 10 ? `${v}T12:00:00+02:00` : v).toLocaleString(
        "en-ZA",
        {
          timeZone: "Africa/Johannesburg",
          ...(v.length === 10
            ? { year: "numeric", month: "short", day: "numeric" }
            : { dateStyle: "medium", timeStyle: "short" }),
        },
      )
    : "Not set";
type Props = {
  projectId?: string;
  token?: string;
  mode?: string;
  active?: boolean;
  canEditMilestones?: boolean;
  onChange?: () => void;
  teamOptions?: Array<{ id: string; name: string }>;
};
export function ProjectCollaboration({
  projectId,
  token,
  mode: externalMode,
  active = true,
  canEditMilestones = false,
  onChange,
  teamOptions = [],
}: Props) {
  const { user } = useAuth(),
    team = !!projectId;
  const [data, setData] = useState<WorkspaceData | null>(null),
    [mode, setMode] = useState("progress"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [progress, setProgress] = useState<number | null>(null),
    [category, setCategory] = useState("all"),
    [search, setSearch] = useState(""),
    [replacement, setReplacement] = useState(""),
    [taskFilter, setTaskFilter] = useState("all"),
    [conversationFilter, setConversationFilter] = useState("all");
  const [thread, setThread] = useState<Conversation | null>(null),
    [title, setTitle] = useState(""),
    [content, setContent] = useState(""),
    [name, setName] = useState(""),
    [attachments, setAttachments] = useState<string[]>([]),
    [askReply, setAskReply] = useState(true),
    [newTopic, setNewTopic] = useState(false),
    [assignee, setAssignee] = useState("");
  const generation = useRef(0),
    attempt = useRef<{ key: string; id: string } | null>(null),
    recovery = useRef<(() => Promise<unknown>) | null>(null),
    changeCallback = useRef(onChange);
  changeCallback.current = onChange;
  const currentMode = externalMode || mode;
  const request = useCallback(
    <T,>(
      action: string,
      payload: object = {},
      onProgress?: (n: number) => void,
    ) => workspaceRequest<T>({ projectId, token }, action, payload, onProgress),
    [projectId, token],
  );
  const load = useCallback(
    async (cursor?: string) => {
      const current = generation.current;
      const result = await request<WorkspaceData>(
        "get",
        cursor ? { cursor } : {},
      );
      if (current === generation.current)
        setData((prev) =>
          cursor && prev
            ? { ...result, threads: [...prev.threads, ...result.threads] }
            : result,
        );
      return result;
    },
    [request],
  );
  useEffect(() => {
    generation.current++;
    setData(null);
    setThread(null);
    setTitle("");
    setContent("");
    setAttachments([]);
    setError("");
    setBusy(false);
    setNotice("");
    setProgress(null);
    setNewTopic(false);
    recovery.current = null;
    attempt.current = null;
    const current = generation.current;
    return () => {
      generation.current = current + 1;
    };
  }, [projectId, token]);
  useEffect(() => {
    if (!active) return;
    let live = true;
    void request<WorkspaceData>("get")
      .then((r) => {
        if (live) setData(r);
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          if (!projectId && [403, 404].includes(e.status)) {
            setData(null);
            setThread(null);
            changeCallback.current?.();
          }
        }
      });
    return () => {
      live = false;
    };
  }, [request, active, projectId, currentMode]);
  async function mutate<T = unknown>(
    action: string,
    payload: object,
    onProgress?: (n: number) => void,
  ) {
    const current = generation.current;
    const key = JSON.stringify({ action, payload });
    if (attempt.current?.key !== key)
      attempt.current = { key, id: crypto.randomUUID() };
    const operation = attempt.current;
    const result = await request<T>(
      action,
      { ...payload, requestId: operation.id },
      onProgress,
    );
    if (
      current === generation.current &&
      action !== "thread-read" &&
      (result as { changed?: boolean }).changed !== false
    )
      changeCallback.current?.();
    return result;
  }
  async function run(task: () => Promise<unknown>, message = "Saved.") {
    if (busy) return;
    const current = generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    recovery.current = task;
    try {
      await task();
      if (current !== generation.current) return;
      recovery.current = null;
      attempt.current = null;
      setNotice(message);
    } catch (e) {
      if (current === generation.current) {
        setError(e instanceof Error ? e.message : "Please retry.");
        if (
          !projectId &&
          [403, 404].includes((e as { status?: number }).status)
        ) {
          setData(null);
          setThread(null);
          changeCallback.current?.();
        }
      }
    } finally {
      if (current === generation.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  }
  async function upload(file: File) {
    if (
      !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(
        file.type,
      ) ||
      file.size > 2 * 1024 * 1024 ||
      !file.size
    ) {
      setError("Use PNG, JPG, WebP or PDF, up to 2 MB.");
      return;
    }
    const version = data.version,
      fileId = replacement || undefined;
    await run(
      async () => {
        const payload = {
          version,
          fileId,
          name: file.name,
          mimeType: file.type,
          base64: await fileBase64(file),
        };
        if (!team) setProgress(0);
        await mutate("file-upload", payload, team ? undefined : setProgress);
        await load();
        setReplacement("");
      },
      team
        ? "New version saved privately. Use Save file details with Client-visible selected to publish it."
        : "Your file was uploaded to this project.",
    );
  }

  const download = (id: string, versionId?: string) =>
    run(
      async () =>
        downloadOnboardingFile(
          await request("download", { fileId: id, versionId }),
        ),
      "Download ready.",
    );
  const openThread = async (id: string) => {
    const current = generation.current;
    const t = await request<Conversation>("thread-get", { threadId: id });
    if (current !== generation.current) return;
    setThread(t);
    setAssignee(t.assignedTo || "");
    setNewTopic(false);
    setContent("");
    setAttachments([]);
  };
  async function send() {
    const payload = {
      version: thread && !newTopic ? thread.version : 0,
      threadId: thread && !newTopic ? thread.id : undefined,
      title,
      content,
      senderName: name,
      attachments,
      awaitingResponse: askReply,
    };
    const action = thread && !newTopic ? "thread-reply" : "thread-create";
    await run(async () => {
      const result = await mutate<{ threadId: string }>(action, payload);
      await openThread(result.threadId);
      await load();
      setTitle("");
    }, "Message received. Your conversation is saved; scope, prices and approvals have not changed.");
  }
  async function manageThread(status: string) {
    const payload = {
      threadId: thread.id,
      version: thread.version,
      status,
      assignedTo: assignee,
    };
    await run(
      async () => {
        await mutate("thread-update", payload);
        await openThread(thread.id);
        await load();
      },
      status === "resolved"
        ? "Conversation marked resolved."
        : "Responsibility saved.",
    );
  }
  const visible =
    data?.files.filter(
      (f) =>
        (category === "all" || f.category === category) &&
        `${f.versions.at(-1)?.name || f.pending?.name}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) || [];
  const pending = data
    ? nextProjectMilestone(data.milestones, data.projectStatus)
    : null;
  const summary = data ? milestoneSummary(data.milestones) : null;
  return (
    <Card id="project-collaboration">
      <CardHeader>
        <CardTitle>
          {team
            ? "Project collaboration"
            : currentMode === "files"
              ? "Files & deliverables"
              : currentMode === "progress"
                ? "Project progress"
                : "Messages & feedback"}
        </CardTitle>
        {team && (
          <nav aria-label="Team workspace" className="flex flex-wrap gap-2">
            {[
              ["progress", "Milestones"],
              ["files", "Files & Deliverables"],
              ["messages", "Messages & Feedback"],
            ].map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={currentMode === key ? "default" : "outline"}
                onClick={() => setMode(key)}
              >
                {label}
              </Button>
            ))}
          </nav>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await load();
                if (thread) await openThread(thread.id);
              }, "Workspace refreshed.")
            }
          >
            Refresh workspace
          </Button>
          {busy && (
            <span role="status" className="text-sm text-muted-foreground">
              Working…
            </span>
          )}
        </div>
        {error && (
          <div
            role="alert"
            className="space-y-2 rounded-lg border border-destructive/30 p-3 text-sm"
          >
            <p className="text-destructive-text">{error}</p>
            {recovery.current && (
              <Button
                disabled={busy}
                size="sm"
                variant="outline"
                onClick={() => void run(recovery.current, "Retry completed.")}
              >
                Retry action
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              For changed records, refresh before making a new change. Keep
              unsent message text before opening another conversation.
            </p>
          </div>
        )}
        {notice && (
          <p role="status" className="text-sm text-success-text">
            {notice}
          </p>
        )}
        {!data && !error && (
          <p className="text-sm text-muted-foreground">
            Loading the project workspace…
          </p>
        )}
        {data && currentMode === "files" && (
          <>
            <p className="text-sm text-muted-foreground">
              Upload materials or download authorised previews and final work.
              PNG, JPG, WebP or PDF, up to 2 MB per file. The library holds 20
              files and 3 versions per file. Use the agreed folder for larger
              media. Do not upload passwords or private customer information.
            </p>
            {team && (
              <>
                <Label htmlFor="workspace-replace">Upload target</Label>
                <select
                  id="workspace-replace"
                  className={select}
                  value={replacement}
                  disabled={busy}
                  onChange={(e) => setReplacement(e.target.value)}
                >
                  <option value="">New file (team-only by default)</option>
                  {data.files
                    .filter(
                      (f) =>
                        f.canReplace && f.versions.length < 3 && !f.removing,
                    )
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        New version of{" "}
                        {f.versions.at(-1)?.name || f.pending?.name}
                      </option>
                    ))}
                </select>
              </>
            )}
            <Label htmlFor="workspace-upload">
              {replacement ? "Upload replacement version" : "Upload a file"}
            </Label>
            <Input
              id="workspace-upload"
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
            {progress !== null && (
              <div role="status">
                <progress
                  aria-label="File upload progress"
                  max={100}
                  value={progress}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  {progress < 95
                    ? `${progress}% uploaded`
                    : "Securing and saving your file…"}
                </p>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                aria-label="Find project files"
                placeholder="Find a file…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className={select}
                aria-label="File category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="all">All categories</option>
                {Object.keys(FILE_CATEGORIES).map((c) => (
                  <option key={c} value={c}>
                    {FILE_CATEGORIES[c]}
                  </option>
                ))}
              </select>
            </div>
            {!visible.length && (
              <p className="text-sm text-muted-foreground">
                No files match this view. You can upload your first material
                above.
              </p>
            )}
            {visible.map((file) => (
              <FileCard
                key={`${file.id}:${file.updatedAt}:${file.versions.length}:${file.visibility}`}
                file={file}
                team={team}
                data={data}
                busy={busy}
                onDownload={download}
                onSave={(patch) =>
                  run(async () => {
                    await mutate("file-update", {
                      version: data.version,
                      fileId: file.id,
                      ...patch,
                    });
                    await load();
                  }, "File category, visibility and milestone saved.")
                }
                onDelete={() => {
                  if (
                    !window.confirm(
                      "Permanently delete this file and all retained versions?",
                    )
                  )
                    return;
                  void run(async () => {
                    await mutate("file-delete", {
                      version: data.version,
                      fileId: file.id,
                    });
                    await load();
                  }, "File and versions removed.");
                }}
              />
            ))}
            {!!data.onboardingFiles.length && (
              <section className="space-y-3 border-t pt-4">
                <h3 className="font-semibold">Onboarding materials</h3>
                <p className="text-xs text-muted-foreground">
                  These are the original onboarding uploads, shown without
                  copying storage. Their removal and submission history remain
                  in Onboarding.
                </p>
                {data.onboardingFiles.map((f) => (
                  <div
                    key={f.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
                  >
                    <span className="min-w-0 flex-1 break-words text-sm">
                      {f.name}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void download(f.id)}
                    >
                      Download
                    </Button>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
        {data && currentMode === "progress" && (
          <>
            <p className="text-sm text-muted-foreground">
              {summary.total
                ? `${summary.completed} of ${summary.total} milestones completed (${summary.progress}%).`
                : "Your team has not configured milestones yet. Progress is not available."}
            </p>
            {summary.total > 0 && (
              <progress
                aria-label="Project completion"
                className="w-full"
                max={100}
                value={summary.progress}
              />
            )}
            {pending && (
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="font-semibold">Next: {pending.title}</p>
                <p className="text-sm">
                  Action:{" "}
                  {pending.responsibleParty === "client"
                    ? "You (the client)"
                    : pending.responsibleParty === "both"
                      ? "Both you and Khulisa"
                      : "Khulisa team"}{" "}
                  · {MILESTONE_STATUSES[pending.status]}
                </p>
                {pending.waitingFor.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Waiting for prerequisite steps before this can proceed.
                  </p>
                )}
                {!pending.waitingFor.length && pending.clientAction && (
                  <p className="mt-2 whitespace-pre-wrap text-sm">
                    {pending.clientAction}
                  </p>
                )}
              </div>
            )}
            {!pending && summary.total > 0 && (
              <p className="text-sm text-muted-foreground">
                {["completed", "delivered"].includes(data.projectStatus)
                  ? "Project delivery is closed. Contact your team about further work."
                  : "All recorded milestones are complete. The developer confirms final project delivery."}
              </p>
            )}
            {data.milestones.length > 0 && (
              <select
                aria-label="Milestone filter"
                className={select}
                value={taskFilter}
                onChange={(e) => setTaskFilter(e.target.value)}
              >
                <option value="all">All milestones</option>
                <option value="remaining">Remaining</option>
                <option value="completed">Completed</option>
                <option value="awaiting-client">Awaiting Client</option>
                <option value="blocked">Blocked</option>
              </select>
            )}
            {orderedMilestones(data.milestones)
              .filter((m) =>
                taskFilter === "all" || taskFilter === "remaining"
                  ? taskFilter === "all" || milestoneStatus(m) !== "completed"
                  : milestoneStatus(m) === taskFilter,
              )
              .map((m) => (
                <MilestoneCard
                  key={`${m.id}:${data.milestoneVersion}`}
                  milestone={m}
                  milestones={data.milestones}
                  linkedFiles={data.files.filter((f) => f.milestoneId === m.id)}
                  team={team}
                  editable={canEditMilestones}
                  busy={busy}
                  onDownload={download}
                  onSave={(status, details) =>
                    run(async () => {
                      await mutate("milestone-update", {
                        version: data.milestoneVersion,
                        milestoneId: m.id,
                        status,
                        ...(details ? { details } : {}),
                      });
                      await load();
                    }, "Milestone saved. Progress and client view updated.")
                  }
                />
              ))}
          </>
        )}
        {data && currentMode === "messages" && (
          <>
            <p className="text-sm text-muted-foreground">
              Send questions and progress feedback here. This is a shared
              project conversation, not a price agreement or formal approval.
              Use Approvals & Requests for delivery decisions or new scope.
              Replies appear when you refresh. Never send passwords here.
            </p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (
                  content.trim() &&
                  !window.confirm(
                    "Start a new topic? Your unsent reply will be cleared.",
                  )
                )
                  return;
                setThread(null);
                setTitle("");
                setContent("");
                setAttachments([]);
                setNewTopic(true);
              }}
            >
              New conversation
            </Button>
            <div className="space-y-2">
              <select
                aria-label="Conversation filter"
                className={select}
                value={conversationFilter}
                onChange={(e) => setConversationFilter(e.target.value)}
              >
                <option value="all">All loaded conversations</option>
                <option value="open">Unresolved</option>
                <option value="client">Awaiting client response</option>
                <option value="resolved">Resolved</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Filters apply to loaded topics. Use Load more to check
                additional conversations.
              </p>
              {data.threads
                .filter((t) =>
                  conversationFilter === "all" ||
                  conversationFilter === "client"
                    ? conversationFilter === "all" ||
                      (t.status === "open" && t.waitingOn === "client")
                    : t.status === conversationFilter,
                )
                .sort(
                  (a, b) =>
                    (a.status === "resolved" ? 1 : 0) -
                      (b.status === "resolved" ? 1 : 0) ||
                    b.updatedAt.localeCompare(a.updatedAt),
                )
                .map((t) => (
                  <button
                    type="button"
                    disabled={busy}
                    key={t.id}
                    className={`w-full rounded-lg border p-3 text-left ${thread?.id === t.id ? "border-primary bg-muted/40" : ""}`}
                    onClick={() => {
                      if (
                        content.trim() &&
                        !window.confirm(
                          "Open this conversation? Your unsent reply will be cleared.",
                        )
                      )
                        return;
                      void run(() => openThread(t.id), "Conversation opened.");
                    }}
                  >
                    <span className="block break-words font-medium">
                      {t.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t.status === "resolved"
                        ? "Resolved"
                        : t.waitingOn === "client"
                          ? "Awaiting client response"
                          : t.waitingOn === "team"
                            ? "Awaiting team response"
                            : "Open"}{" "}
                      · {formatDate(t.updatedAt)}
                    </span>
                    <span className="block break-words text-sm text-muted-foreground">
                      {t.lastMessage}
                    </span>
                  </button>
                ))}
            </div>
            {data.cursor && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => load(data.cursor),
                    "More conversations loaded.",
                  )
                }
              >
                Load more conversations
              </Button>
            )}
            {thread && !newTopic && (
              <section className="space-y-4 rounded-lg border p-4">
                <h3 className="font-semibold break-words">{thread.title}</h3>
                <p className="text-xs text-muted-foreground">
                  {thread.status === "resolved" ? "Resolved" : "Unresolved"} ·{" "}
                  {thread.waitingOn === "client"
                    ? "A client reply is needed"
                    : thread.waitingOn === "team"
                      ? "A team reply is needed"
                      : "No reply requested"}
                  {thread.readAt
                    ? ` · Last read ${formatDate(thread.readAt)}`
                    : ""}
                </p>
                {thread.messages?.map((message) => (
                  <article
                    key={message.id}
                    className={`space-y-2 rounded-lg border p-3 ${message.sender === "team" ? "bg-muted/40" : ""}`}
                  >
                    <p className="text-sm font-semibold">
                      {message.senderName} ·{" "}
                      {message.sender === "team"
                        ? "Khulisa team"
                        : "Client — name supplied through project link"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(message.createdAt)}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">
                      {message.content}
                    </p>
                    {message.unavailableAttachments && (
                      <p className="text-xs text-muted-foreground">
                        An attachment was removed or is no longer shared.
                      </p>
                    )}
                    {message.attachments.map((id) => {
                      const f = data.files.find((f) => f.id === id);
                      return f ? (
                        <Button
                          key={id}
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void download(id, message.attachmentVersions?.[id])
                          }
                        >
                          {f.versions.find(
                            (v) => v.id === message.attachmentVersions?.[id],
                          )?.name ||
                            f.versions.at(-1)?.name ||
                            "Download attachment"}
                        </Button>
                      ) : null;
                    })}
                  </article>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await mutate("thread-read", {
                        threadId: thread.id,
                        version: thread.version,
                      });
                      await openThread(thread.id);
                      await load();
                    }, "Conversation marked read.")
                  }
                >
                  Mark conversation read
                </Button>
                {team && (
                  <div className="space-y-3 border-t pt-4">
                    <Label htmlFor="conversation-assignee">
                      Responsible team member
                    </Label>
                    <select
                      id="conversation-assignee"
                      className={select}
                      value={assignee}
                      disabled={busy}
                      onChange={(e) => setAssignee(e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {[
                        ...new Map(
                          [
                            { id: user?.uid || user?.id, name: "Me" },
                            ...teamOptions,
                          ]
                            .filter((p) => p.id)
                            .map((p) => [p.id, p]),
                        ).values(),
                      ].map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void manageThread(thread.status)}
                      >
                        Save responsibility
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void manageThread(
                            thread.status === "resolved" ? "open" : "resolved",
                          )
                        }
                      >
                        {thread.status === "resolved"
                          ? "Reopen conversation"
                          : "Mark resolved"}
                      </Button>
                    </div>
                  </div>
                )}
              </section>
            )}
            {(newTopic || thread) && (
              <section className="space-y-4 rounded-lg border p-4">
                <h3 className="font-semibold">
                  {newTopic
                    ? "New project conversation"
                    : "Reply to this conversation"}
                </h3>
                {!team && (
                  <>
                    <Label htmlFor="conversation-name">Your name</Label>
                    <Input
                      id="conversation-name"
                      maxLength={120}
                      value={name}
                      disabled={busy}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </>
                )}
                {newTopic && (
                  <>
                    <Label htmlFor="conversation-title">
                      Conversation title
                    </Label>
                    <Input
                      id="conversation-title"
                      maxLength={160}
                      value={title}
                      disabled={busy}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </>
                )}
                <Label htmlFor="conversation-message">Your message</Label>
                <Textarea
                  id="conversation-message"
                  rows={6}
                  maxLength={4000}
                  value={content}
                  disabled={busy}
                  onChange={(e) => setContent(e.target.value)}
                />
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">
                    Attach existing project files (up to 3)
                  </legend>
                  {data.files
                    .filter(
                      (f) =>
                        f.versions.length &&
                        f.visibility === "client" &&
                        !f.removing &&
                        f.versions.some((v) => v.visibility === "client"),
                    )
                    .map((f) => (
                      <label
                        key={f.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          disabled={
                            busy ||
                            (!attachments.includes(f.id) &&
                              attachments.length >= 3)
                          }
                          checked={attachments.includes(f.id)}
                          onChange={(e) =>
                            setAttachments((ids) =>
                              e.target.checked
                                ? [...ids, f.id]
                                : ids.filter((id) => id !== f.id),
                            )
                          }
                        />
                        <span className="break-words">
                          {
                            f.versions
                              .filter((v) => v.visibility === "client")
                              .at(-1)?.name
                          }
                        </span>
                      </label>
                    ))}
                  {!data.files.some(
                    (f) => f.visibility === "client" && f.versions.length,
                  ) && (
                    <p className="text-xs text-muted-foreground">
                      Upload a material under Files & Deliverables first.
                      Team-only files must be published before attaching them.
                    </p>
                  )}
                </fieldset>
                {team && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={askReply}
                      disabled={busy}
                      onChange={(e) => setAskReply(e.target.checked)}
                    />
                    Ask the client for a reply
                  </label>
                )}
                <Button
                  disabled={
                    busy ||
                    !content.trim() ||
                    (!team && !name.trim()) ||
                    (newTopic && !title.trim())
                  }
                  onClick={() => void send()}
                >
                  {busy ? "Sending…" : "Send message"}
                </Button>
              </section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
function FileCard({
  file,
  team,
  data,
  busy,
  onDownload,
  onSave,
  onDelete,
}: {
  file: WorkspaceFile;
  team: boolean;
  data: WorkspaceData;
  busy: boolean;
  onDownload: (id: string, version?: string) => unknown;
  onSave: (patch: object) => unknown;
  onDelete: () => void;
}) {
  const [category, setCategory] = useState(file.category),
    [visibility, setVisibility] = useState(file.visibility),
    [milestone, setMilestone] = useState(file.milestoneId),
    [attention, setAttention] = useState(file.attention);
  const latest = file.versions.at(-1);
  return (
    <article className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words font-semibold">
            {latest?.name || file.pending?.name}
          </h3>
          <p className="text-xs text-muted-foreground">
            {FILE_CATEGORIES[file.category]} ·{" "}
            {file.origin === "client" ? "Client upload" : "Team deliverable"}
            {team
              ? ` · ${file.visibility === "client" && latest?.visibility === "client" ? "Latest version client-visible" : "Latest version team-only"}`
              : ""}
          </p>
        </div>
        {file.attention && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-900">
            {team ? "Client attention needed" : "Your attention needed"}
          </span>
        )}
      </div>
      {team &&
        file.visibility === "client" &&
        latest?.visibility !== "client" &&
        file.versions.some((v) => v.visibility === "client") && (
          <p className="text-sm text-muted-foreground">
            The latest version is private. Previously published versions remain
            available. Save Client-visible below to publish this version.
          </p>
        )}
      {file.removing && (
        <p className="text-sm text-warning-text">
          Deletion needs retry. File references are kept until storage cleanup
          succeeds.
        </p>
      )}
      {file.pending && (
        <p className="text-sm text-warning-text">
          Upload pending: {file.pending.name}. Retry the same file or ask your
          developer for help.
        </p>
      )}
      {latest && (
        <>
          <p className="text-xs text-muted-foreground">
            Version {latest.number} · {Math.ceil(latest.sizeBytes / 1024)} KB ·{" "}
            {formatDate(latest.createdAt)}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || file.removing}
            onClick={() => onDownload(file.id)}
          >
            Download latest
          </Button>
        </>
      )}
      {file.milestoneId && (
        <p className="text-sm text-muted-foreground">
          Milestone:{" "}
          {data.milestones.find((m) => m.id === file.milestoneId)?.title ||
            "Linked project step"}
        </p>
      )}
      {file.versions.length > 1 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Version history
          </summary>
          <ul className="mt-3 space-y-2">
            {file.versions.map((v) => (
              <li
                key={v.id}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <span className="min-w-0 flex-1 break-words">
                  v{v.number} · {v.name} · {formatDate(v.createdAt)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || file.removing}
                  onClick={() => onDownload(file.id, v.id)}
                >
                  Download version {v.number}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {team && !file.removing && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Category, visibility & milestone
          </summary>
          <fieldset disabled={busy} className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              Category
              <select
                aria-label={`Category for ${file.id}`}
                className={select}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {Object.keys(FILE_CATEGORIES).map((key) => (
                  <option key={key} value={key}>
                    {FILE_CATEGORIES[key]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              Visibility
              <select
                aria-label={`Visibility for ${file.id}`}
                className={select}
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
              >
                <option value="staff">Team-only</option>
                <option value="client">Client-visible</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              Linked milestone
              <select
                className={select}
                value={milestone}
                onChange={(e) => setMilestone(e.target.value)}
              >
                <option value="">No milestone</option>
                {orderedMilestones(data.milestones).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={attention}
                onChange={(e) => setAttention(e.target.checked)}
              />
              Client attention needed
            </label>
          </fieldset>
          <Button
            size="sm"
            className="mt-3"
            disabled={busy}
            onClick={() =>
              onSave({
                category,
                visibility,
                attention,
                milestoneId: milestone,
              })
            }
          >
            Save file details
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Saving Client-visible publishes the latest version. Earlier
            unpublished drafts stay private. Team-only hides all versions.
          </p>
        </details>
      )}
      {file.canDelete && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={onDelete}>
          {file.removing ? "Retry deletion" : "Delete file & versions"}
        </Button>
      )}
    </article>
  );
}
function MilestoneCard({
  milestone: m,
  milestones,
  linkedFiles,
  team,
  editable,
  busy,
  onDownload,
  onSave,
}: {
  milestone: TrackedMilestone;
  milestones: TrackedMilestone[];
  linkedFiles: WorkspaceFile[];
  team: boolean;
  editable: boolean;
  busy: boolean;
  onDownload: (id: string) => unknown;
  onSave: (status: string, details?: object) => unknown;
}) {
  const [status, setStatus] = useState(m.status),
    [party, setParty] = useState(m.responsibleParty || "team"),
    [date, setDate] = useState(m.expectedDate || ""),
    [description, setDescription] = useState(m.description || ""),
    [action, setAction] = useState(m.clientAction || ""),
    [deps, setDeps] = useState(m.dependsOn || []);
  return (
    <article className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="break-words font-semibold">{m.title}</h3>
        <span className="text-sm font-medium">
          {MILESTONE_STATUSES[milestoneStatus(m)]}
        </span>
      </div>
      {m.description && (
        <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
          {m.description}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Responsible:{" "}
        {m.responsibleParty === "client"
          ? "Client"
          : m.responsibleParty === "both"
            ? "Both parties"
            : "Khulisa team"}{" "}
        · Expected: {formatDate(m.expectedDate)}
        {m.completedAt ? ` · Completed: ${formatDate(m.completedAt)}` : ""}
      </p>
      {m.clientAction && (
        <p className="whitespace-pre-wrap rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Client action: {m.clientAction}
        </p>
      )}
      {m.dependsOn?.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Depends on:{" "}
          {m.dependsOn
            .map(
              (id) =>
                milestones.find((d) => d.id === id)?.title || "Earlier step",
            )
            .join(", ")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {linkedFiles
          .filter((f) => f.versions.length)
          .map((f) => (
            <Button
              key={f.id}
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onDownload(f.id)}
            >
              {f.versions.at(-1).name}
            </Button>
          ))}
      </div>
      {team && editable && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Update milestone
          </summary>
          <fieldset disabled={busy} className="mt-3 space-y-3">
            <label className="block space-y-1 text-sm">
              Status
              <select
                aria-label={`Status for ${m.title}`}
                className={select}
                value={status}
                disabled={busy}
                onChange={(e) => setStatus(e.target.value)}
              >
                {Object.keys(MILESTONE_STATUSES).map((s) => (
                  <option key={s} value={s}>
                    {MILESTONE_STATUSES[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              Responsible party
              <select
                className={select}
                value={party}
                onChange={(e) => setParty(e.target.value)}
              >
                <option value="team">Khulisa team</option>
                <option value="client">Client</option>
                <option value="both">Both parties</option>
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              Expected completion date
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm">
              Description
              <Textarea
                maxLength={4000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm">
              Client action required
              <Textarea
                maxLength={1000}
                value={action}
                onChange={(e) => setAction(e.target.value)}
              />
            </label>
            <fieldset className="space-y-2">
              <legend className="text-sm">Prerequisites</legend>
              {milestones
                .filter((d) => d.id !== m.id)
                .map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={deps.includes(d.id)}
                      onChange={(e) =>
                        setDeps((ids) =>
                          e.target.checked
                            ? [...ids, d.id]
                            : ids.filter((id) => id !== d.id),
                        )
                      }
                    />
                    {d.title}
                  </label>
                ))}
            </fieldset>
            <Button
              disabled={busy}
              size="sm"
              onClick={() =>
                onSave(status, {
                  responsibleParty: party,
                  expectedDate: date,
                  description,
                  clientAction: action,
                  dependsOn: deps,
                })
              }
            >
              Save milestone
            </Button>
          </fieldset>
        </details>
      )}
    </article>
  );
}

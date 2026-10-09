import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import {
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Circle,
  FileText,
  FolderOpen,
  Mail,
  RefreshCw,
  Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/common";
import {
  projectShareService,
  type PublicProjectPortalData,
} from "@/services/projectShareService";
import {
  portalDeadline,
  safePortalUrl,
  summarizePortalMilestones,
} from "@/lib/portalPresentation";

const AUTO_REFRESH_MS = 10 * 60 * 1000;
const formatDate = (value: string | null | undefined, withTime = false) => {
  if (!value || Number.isNaN(new Date(value).getTime()))
    return "To be confirmed";
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
  }).format(new Date(value));
};
const formatSize = (value: number | null) =>
  !value
    ? ""
    : value < 1024 * 1024
      ? `${Math.ceil(value / 1024)} KB`
      : `${(value / 1024 / 1024).toFixed(1)} MB`;

export function ProjectPortalPage() {
  const { token } = useParams();
  const [data, setData] = useState<PublicProjectPortalData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [fileSearch, setFileSearch] = useState("");
  const [milestoneFilter, setMilestoneFilter] = useState<
    "all" | "open" | "complete"
  >("all");
  const generation = useRef(0);
  const pending = useRef(false);

  const loadPortal = useCallback(
    async (initial = false) => {
      if (pending.current) return;
      const requestGeneration = generation.current;
      pending.current = true;
      if (initial) setIsLoading(true);
      else setIsRefreshing(true);
      try {
        if (!token)
          throw new Error(
            "This portal link is incomplete. Ask your project contact for a new link.",
          );
        const next = await projectShareService.resolve(token);
        if (requestGeneration !== generation.current) return;
        setData(next);
        setError("");
        setLastSyncedAt(new Date().toISOString());
      } catch (err) {
        if (requestGeneration !== generation.current) return;
        // Do not leave stale files or project data visible when access cannot be verified.
        setData(null);
        setError(
          err instanceof Error
            ? err.message
            : "The portal could not be loaded. Please try again.",
        );
      } finally {
        if (requestGeneration === generation.current) {
          pending.current = false;
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [token],
  );

  const invalidate = useCallback(() => {
    generation.current++;
    pending.current = false;
  }, []);

  useEffect(() => {
    generation.current++;
    pending.current = false;
    setData(null);
    setFileSearch("");
    setMilestoneFilter("all");
    void loadPortal(true);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadPortal();
    };
    const interval = setInterval(refreshWhenVisible, AUTO_REFRESH_MS);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      invalidate();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadPortal, invalidate]);

  const milestones = useMemo(() => data?.project.milestones || [], [data]);
  const summary = summarizePortalMilestones(milestones);
  const files = useMemo(
    () => (data?.share.media || []).filter((file) => safePortalUrl(file.url)),
    [data],
  );
  const filteredFiles = files.filter((file) =>
    file.name.toLowerCase().includes(fileSearch.trim().toLowerCase()),
  );
  const filteredMilestones = milestones.filter(
    (item) =>
      milestoneFilter === "all" ||
      (milestoneFilter === "complete" ? item.isCompleted : !item.isCompleted),
  );

  if (isLoading || !data)
    return (
      <main className="theme-light flex min-h-screen items-center justify-center bg-slate-50 px-5 text-slate-900">
        <Card className="w-full max-w-md">
          <CardHeader>
            <img
              src="/images/khulisa-logo-icon.png"
              alt="Khulisa Media"
              className="mb-4 h-12 w-12 rounded-lg"
            />
            <CardTitle>
              {isLoading ? "Opening your project" : "Portal unavailable"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p
              role={error ? "alert" : "status"}
              className="text-sm leading-6 text-muted-foreground"
            >
              {isLoading ? "Loading progress and shared files…" : error}
            </p>
            {!isLoading && (
              <>
                <Button
                  variant="outline"
                  disabled={isRefreshing}
                  onClick={() => void loadPortal()}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {isRefreshing ? "Checking…" : "Try again"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  If the link has expired or been revoked, ask your project
                  contact for a new one.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    );

  const folderUrl = safePortalUrl(data.project.driveLink);
  const nextMilestone = milestones.find((item) => !item.isCompleted);
  const contact = data.project.contact;
  const statusMessage =
    data.project.status === "on-hold"
      ? "Your project is currently on hold."
      : data.project.status === "waiting-client"
        ? "Your team is waiting for your input."
        : summary.total === 0
          ? "Your team is preparing the delivery plan."
          : summary.remaining === 0
            ? "All recorded milestones are complete."
            : `${summary.remaining} milestone${summary.remaining === 1 ? "" : "s"} still to complete.`;

  return (
    <div className="theme-light min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <img
              src="/images/khulisa-logo-icon.png"
              alt="Khulisa Media"
              className="h-10 w-10 rounded-lg"
            />
            <div>
              <p className="text-sm font-semibold">Khulisa Media</p>
              <p className="text-xs text-slate-600">Client workspace</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={isRefreshing}
            onClick={() => void loadPortal()}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
        <section className="overflow-hidden rounded-2xl bg-slate-900 p-6 text-white sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-amber-300">
                {data.client.businessName}
              </p>
              <h1 className="mt-3 break-words text-3xl font-semibold tracking-tight sm:text-4xl">
                {data.project.name}
              </h1>
              {data.project.packageName && (
                <p className="mt-3 text-sm text-slate-300">
                  {data.project.packageName}
                </p>
              )}
            </div>
            <StatusBadge status={data.project.status} type="project" className="bg-card" />
          </div>
          <div className="mt-7 grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <div className="mb-3 flex justify-between gap-3 text-sm">
                <span>
                  {summary.total
                    ? `${summary.completed} of ${summary.total} milestones complete`
                    : "Delivery plan pending"}
                </span>
                <span className="font-semibold text-amber-300">
                  {summary.total ? `${summary.progress}%` : "—"}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Milestone completion"
                aria-valuenow={summary.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-2 overflow-hidden rounded-full bg-white/10"
              >
                <div
                  className="h-full rounded-full bg-amber-400 transition-all"
                  style={{ width: `${summary.progress}%` }}
                />
              </div>
              <p className="mt-3 text-sm text-slate-300">{statusMessage}</p>
            </div>
            {folderUrl && (
              <Button
                asChild
                className="bg-amber-400 text-slate-950 hover:bg-amber-300"
              >
                <a href={folderUrl} target="_blank" rel="noopener noreferrer">
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Open project folder
                  <ArrowUpRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            )}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 space-y-6">
            {data.project.clientUpdate && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    Update from your team
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">
                    {data.project.clientUpdate}
                  </p>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader className="gap-4 border-b border-slate-100">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="text-lg">Delivery milestones</CardTitle>
                  <div
                    className="flex gap-1 rounded-lg bg-slate-100 p-1"
                    aria-label="Filter milestones"
                  >
                    {(["all", "open", "complete"] as const).map((filter) => (
                      <Button
                        key={filter}
                        size="sm"
                        variant={
                          milestoneFilter === filter ? "secondary" : "ghost"
                        }
                        aria-pressed={milestoneFilter === filter}
                        onClick={() => setMilestoneFilter(filter)}
                        className="h-8 px-3 text-xs"
                      >
                        {filter === "all"
                          ? "All"
                          : filter === "open"
                            ? "Remaining"
                            : "Complete"}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                {!filteredMilestones.length ? (
                  <p className="py-5 text-sm text-slate-600">
                    {!milestones.length
                      ? "Your delivery milestones will appear here when the team adds them."
                      : "No milestones in this view."}
                  </p>
                ) : (
                  <ol className="divide-y divide-slate-100">
                    {filteredMilestones.map((milestone) => (
                      <li key={milestone.id} className="flex gap-4 py-4">
                        {milestone.isCompleted ? (
                          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                        ) : (
                          <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="break-words text-sm font-medium">
                              {milestone.title}
                            </p>
                            <span
                              className={`text-xs ${milestone.isCompleted ? "text-emerald-700" : "text-slate-600"}`}
                            >
                              {milestone.isCompleted ? "Complete" : "Pending"}
                            </span>
                          </div>
                          {milestone.description && (
                            <p className="mt-2 break-words text-sm leading-6 text-slate-600">
                              {milestone.description}
                            </p>
                          )}
                          {milestone.isCompleted && milestone.completedAt && (
                            <p className="mt-2 text-xs text-slate-600">
                              Completed {formatDate(milestone.completedAt)}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>

            <Card id="portal-media">
              <CardHeader className="gap-4">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-lg">Shared files</CardTitle>
                  <span className="text-xs text-slate-600">
                    {files.length} file{files.length === 1 ? "" : "s"}
                  </span>
                </div>
                {files.length > 0 && (
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-slate-600" />
                    <Input
                      aria-label="Search shared files"
                      placeholder="Find a file…"
                      value={fileSearch}
                      onChange={(event) => setFileSearch(event.target.value)}
                      className="pl-9"
                    />
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {!filteredFiles.length ? (
                  <p className="py-5 text-sm text-slate-600">
                    {fileSearch
                      ? "No files match your search."
                      : "Your team will share previews and final deliverables here."}
                  </p>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {filteredFiles.map((file) => (
                      <a
                        key={file.id}
                        href={safePortalUrl(file.url)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group overflow-hidden rounded-xl border border-slate-200 transition hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                      >
                        {file.mimeType?.startsWith("image/") ? (
                          <img
                            src={safePortalUrl(file.url)!}
                            alt={file.name}
                            loading="lazy"
                            className="aspect-video w-full bg-slate-100 object-contain"
                          />
                        ) : (
                          <div className="flex h-24 items-center justify-center bg-slate-50">
                            <FileText className="h-8 w-8 text-slate-600" />
                          </div>
                        )}
                        <div className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <p className="break-all text-sm font-medium">
                              {file.name}
                            </p>
                            <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-600" />
                          </div>
                          <p className="mt-2 text-xs text-slate-600">
                            {formatSize(file.sizeBytes)}
                            {file.sizeBytes ? " · " : ""}Added{" "}
                            {formatDate(file.createdAt)}
                          </p>
                          <p className="mt-3 text-xs font-medium text-primary-text">
                            Open file
                          </p>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Project timeline</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {[
                  {
                    label: "Start date",
                    value: formatDate(data.project.startDate),
                  },
                  {
                    label: "Target date",
                    value: formatDate(data.project.dueDate),
                  },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-xs uppercase tracking-wider text-slate-600">
                      {item.label}
                    </p>
                    <p className="mt-2 flex items-center gap-2 text-sm font-medium">
                      <Calendar className="h-4 w-4 text-slate-600" />
                      {item.value}
                    </p>
                  </div>
                ))}
                <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                  {portalDeadline(data.project.dueDate, data.project.status)}
                </p>
              </CardContent>
            </Card>
            {nextMilestone && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Next milestone</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="break-words text-sm leading-6 text-slate-600">
                    {nextMilestone.title}
                  </p>
                </CardContent>
              </Card>
            )}
            {contact?.email && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    Your project contact
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="break-words text-sm text-slate-600">
                    {contact.name || "Khulisa Media"}
                  </p>
                  <Button asChild variant="outline" className="w-full">
                    <a
                      href={`mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(`Project: ${data.project.name}`)}`}
                    >
                      <Mail className="mr-2 h-4 w-4" />
                      Email your team
                    </a>
                  </Button>
                </CardContent>
              </Card>
            )}
            <div className="space-y-3 px-1 text-xs leading-5 text-slate-600">
              <p>Project updated {formatDate(data.project.updatedAt, true)}</p>
              <p>
                Last checked {formatDate(lastSyncedAt, true)}. Refreshes every
                10 minutes while open.
              </p>
              {data.share.expiresAt && (
                <p>
                  Access expires {formatDate(data.share.expiresAt, true)}. Save
                  any files you need before then.
                </p>
              )}
            </div>
          </aside>
        </div>
        <footer className="border-t border-slate-200 py-5 text-xs text-slate-600">
          Khulisa Media · Your project, clearly connected.
        </footer>
      </main>
    </div>
  );
}

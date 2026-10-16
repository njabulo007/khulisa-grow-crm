import { ProjectCollaboration } from "@/components/common/ProjectCollaboration";
import { nextProjectMilestone } from "../../../shared/projectTracking.js";
import { PortalOnboarding } from "@/components/common/PortalOnboarding";
import { ONBOARDING_STATES } from "../../../shared/onboarding.js";
import { PortalClientActions } from "@/components/common/PortalClientActions";
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
    timeZone: "Africa/Johannesburg",
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
  const [section, setSection] = useState("overview");
  const activeToken = useRef(token);
  activeToken.current = token;
  const generation = useRef(0);
  const pending = useRef(false);

  const loadPortal = useCallback(
    async (initial = false) => {
      if (pending.current || activeToken.current !== token) return;
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
    setSection("overview");
    setFileSearch("");
    void loadPortal(true);
    let lastAutomaticCheck = Date.now();
    const refreshWhenVisible = () => {
      const connection = (
        navigator as Navigator & { connection?: { saveData?: boolean } }
      ).connection;
      if (
        document.visibilityState === "visible" &&
        navigator.onLine &&
        !connection?.saveData &&
        Date.now() - lastAutomaticCheck >= AUTO_REFRESH_MS
      ) {
        lastAutomaticCheck = Date.now();
        void loadPortal();
      }
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

  if (isLoading || !data)
    return (
      <main className="theme-light client-portal flex min-h-screen items-center justify-center bg-slate-50 px-5 text-slate-900">
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
  const nextMilestone = nextProjectMilestone(milestones, data.project.status);
  const contact = data.project.contact;
  const onboarding = data.onboarding;
  const closed = ["completed", "delivered"].includes(data.project.status);
  const needsMore =
    onboarding?.editable && onboarding.status === "more-information-needed";
  const reviewOpen = data.project.review?.status === "open" && !closed;
  const action = needsMore
    ? {
        title: "Please help us with a few details",
        detail:
          onboarding.feedback || "Your team has a question about your answers.",
        target: "onboarding",
        button: "Update your answers",
      }
    : reviewOpen
      ? {
          title: "Your review is needed",
          detail: `Please review ${data.project.review.title} (${data.project.review.version}) and tell us your decision.`,
          target: "approvals",
          button: "Review this revision",
        }
      : data.project.workspacePendingQuestions > 0
        ? {
            title: "Your team has a question for you",
            detail:
              "Open your project conversations and reply to the outstanding question.",
            target: "messages",
            button: "View conversations",
          }
        : data.project.workspaceFileAttention > 0
          ? {
              title: "A project file needs your attention",
              detail:
                "Check the files marked for your attention. Use Approvals & Requests for a formal revision decision.",
              target: "files",
              button: "View project files",
            }
          : onboarding?.editable
            ? {
                title:
                  onboarding.status === "not-started"
                    ? "Let’s get your project ready"
                    : "Continue getting your project ready",
                detail:
                  "Confirm your business information, tell us what you need, and share your materials.",
                target: "onboarding",
                button: "Share your project details",
              }
            : {
                title: "No action needed from you right now",
                detail:
                  onboarding &&
                  ["submitted", "under-review"].includes(onboarding.status)
                    ? "Your team is reviewing your information. We will ask here if anything needs clarification."
                    : data.project.clientUpdate ||
                      (closed
                        ? "Your project is marked as delivered. Open your handover for shared files, instructions and any remaining items."
                        : "Your team is working through the project plan. We will publish the next review here."),
                target: closed
                  ? "handover"
                  : milestones.length
                    ? "progress"
                    : "overview",
                button: closed
                  ? "View your handover"
                  : milestones.length
                    ? "View project progress"
                    : "View project overview",
              };
  const sections = [
    ["overview", "Overview"],
    ...(onboarding ? [["onboarding", "Getting Started"]] : []),
    ["progress", "Project Progress"],
    ["files", "Files & Deliverables"],
    ["messages", "Messages & Feedback"],
    ["approvals", "Approvals & Requests"],
    ["handover", "Handover & Support"],
  ];

  const statusMessage = closed
    ? "Your project is marked as delivered. See Handover & Support for the next steps."
    : data.project.status === "on-hold"
      ? "Your project is currently on hold."
      : data.project.status === "waiting-client"
        ? "Your team is waiting for your input."
        : summary.total === 0
          ? "Your team is preparing the delivery plan."
          : summary.remaining === 0
            ? "All recorded milestones are complete."
            : `${summary.remaining} milestone${summary.remaining === 1 ? "" : "s"} still to complete.`;

  return (
    <div className="theme-light client-portal min-h-screen bg-slate-50 text-slate-900">
      <a href="#portal-main" className="portal-skip-link">
        Skip to project content
      </a>
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
              <StatusBadge
                status={data.project.status}
                type="project"
                className="mt-1"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSection("messages")}
            >
              Contact / help
            </Button>
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
        </div>
      </header>
      <main
        id="portal-main"
        tabIndex={-1}
        className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-8 sm:py-10"
      >
        <h1 className="sr-only">{data.project.name} — client workspace</h1>
        <nav
          aria-label="Workspace sections"
          className="grid grid-cols-2 gap-2 pb-2 sm:flex sm:flex-wrap"
        >
          {sections.map(([key, label]) => (
            <Button
              key={key}
              className="min-h-11 whitespace-normal px-3 py-2 text-center sm:shrink-0"
              size="sm"
              variant={section === key ? "default" : "outline"}
              onClick={() => setSection(key)}
              aria-current={section === key ? "page" : undefined}
            >
              {label}
            </Button>
          ))}
        </nav>
        <section
          hidden={section !== "overview"}
          id="workspace-overview"
          className="overflow-hidden rounded-2xl bg-slate-900 p-6 text-white sm:p-8"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-amber-300">
                {data.client.businessName}
              </p>
              <h2 className="mt-3 break-words text-3xl font-semibold tracking-tight sm:text-4xl">
                {data.project.name}
              </h2>
              {data.project.packageName && (
                <p className="mt-3 text-sm text-slate-300">
                  {data.project.packageName}
                </p>
              )}
            </div>
          </div>
          <div className="mt-7 grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <div className="mb-3 flex justify-between gap-3 text-sm">
                <span>
                  {summary.total
                    ? `${summary.completed} of ${summary.total} milestones complete`
                    : "Your team is preparing the project plan"}
                </span>
                <span className="font-semibold text-amber-300">
                  {summary.total ? `${summary.progress}%` : "—"}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Milestone completion"
                aria-valuenow={summary.total ? summary.progress : undefined}
                aria-valuetext={
                  summary.total
                    ? `${summary.progress}% complete`
                    : "Your team is preparing the project plan"
                }
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-2 overflow-hidden rounded-full bg-white/10"
              >
                <div
                  className="h-full rounded-full bg-amber-400 motion-safe:transition-all"
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

        <section
          aria-label="Your next action"
          className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-5"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {action.title.startsWith("No action")
              ? "What happens next"
              : "Action required"}
          </p>
          <h2 className="text-xl font-semibold">{action.title}</h2>
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
            {action.detail}
          </p>
          <Button onClick={() => setSection(action.target)}>
            {action.button}
          </Button>
        </section>
        {onboarding && (
          <div hidden={section !== "onboarding"}>
            <PortalOnboarding
              key={token}
              token={token!}
              initial={onboarding}
              businessName={data.client.businessName}
              projectName={data.project.name}
              onSaved={(result) =>
                setData((current) =>
                  current?.project.id === result.projectId
                    ? { ...current, onboarding: result }
                    : current,
                )
              }
            />
          </div>
        )}
        <div
          hidden={
            !["files", "messages", "progress", "handover"].includes(section)
          }
        >
          <ProjectCollaboration
            key={token}
            token={token}
            active={["files", "messages", "progress", "handover"].includes(
              section,
            )}
            mode={section}
            onNavigate={setSection}
            onChange={() => void loadPortal()}
          />
        </div>
        <div
          className={
            section === "overview"
              ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]"
              : "space-y-6"
          }
        >
          <div className="min-w-0 space-y-6">
            <div hidden={section !== "approvals"}>
              <PortalClientActions
                key={`${token}:${data.project.review?.id || ""}`}
                token={token!}
                project={data.project}
                hideMaterials={!!onboarding}
              />
            </div>
            {section === "overview" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    Your project at a glance
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm">
                    <strong>Getting started:</strong>{" "}
                    {onboarding
                      ? ONBOARDING_STATES[onboarding.status]
                      : "Managed by your team"}
                  </p>
                  <p className="text-sm">
                    <strong>Delivery:</strong>{" "}
                    {summary.total
                      ? `${summary.completed} of ${summary.total} milestones complete. `
                      : "Your team is preparing the project plan. "}
                    {nextMilestone
                      ? `Next: ${nextMilestone.title}`
                      : "Your team will confirm the next delivery step."}
                  </p>
                  {!!data.project.services?.length && (
                    <details>
                      <summary className="cursor-pointer text-sm font-semibold">
                        Included in your package
                      </summary>
                      <ul className="mt-3 list-disc pl-5 text-sm space-y-2">
                        {data.project.services.map((service) => (
                          <li key={service}>{service}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Approving your project details does not mean the finished
                    work has been delivered. Any additional services need to be
                    agreed with the team.
                  </p>
                </CardContent>
              </Card>
            )}
            {(contact?.email || data.project.clientUpdate) && (
              <Card hidden={section !== "messages"} id="workspace-messages">
                <CardHeader>
                  <CardTitle className="text-lg">
                    Latest project update
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">
                    {data.project.clientUpdate ||
                      "Your project contact can help with questions, missing materials, and progress updates."}
                  </p>
                  {contact?.email && (
                    <Button asChild variant="outline" className="mt-4">
                      <a
                        href={`mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(`Project: ${data.project.name}`)}`}
                      >
                        Email {contact.name || "your team"}
                      </a>
                    </Button>
                  )}
                  <p className="mt-4 text-xs text-slate-600">
                    For a revision decision or change request, use Approvals &
                    Requests so your response reaches the project review queue.
                  </p>
                </CardContent>
              </Card>
            )}
            {(files.length > 0 || folderUrl) && (
              <Card hidden={section !== "files"} id="portal-media">
                <CardHeader className="gap-4">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-lg">
                      Previously shared files
                    </CardTitle>
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
                  {folderUrl && (
                    <Button asChild variant="outline" className="mb-4">
                      <a
                        href={folderUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open project folder{" "}
                        <ArrowUpRight className="ml-2 h-4 w-4" />
                      </a>
                    </Button>
                  )}
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
                              decoding="async"
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
            )}
          </div>

          <aside hidden={section !== "overview"} className="space-y-6">
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
                Last checked {formatDate(lastSyncedAt, true)}. Checks for
                updates about every 10 minutes while open, except when
                data-saving mode is on. You can also use Refresh.
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

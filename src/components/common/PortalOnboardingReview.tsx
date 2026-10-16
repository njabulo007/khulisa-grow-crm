import { useEffect, useState, useRef } from "react";
import {
  ONBOARDING_TEMPLATES,
  ONBOARDING_STATES,
  onboardingFields,
} from "../../../shared/onboarding.js";
import {
  staffOnboarding,
  downloadOnboardingFile,
  type OnboardingData,
  type OnboardingRevision,
} from "@/services/portalOnboardingService";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
export function PortalOnboardingReview({
  projectId,
  onChange,
}: {
  projectId: string;
  onChange: () => void;
}) {
  const { isOwner } = useAuth();
  const [data, setData] = useState<OnboardingData | null>(null),
    [feedback, setFeedback] = useState(""),
    [templates, setTemplates] = useState<string[]>([]),
    [history, setHistory] = useState<OnboardingRevision[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const attempt = useRef<{ key: string; id: string } | null>(null),
    generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setData(null);
    setHistory([]);
    setFeedback("");
    setError("");
    setMessage("");
  }, [projectId]);
  const load = async () => {
    const result = await staffOnboarding(projectId, "get");
    setData(result);
    setTemplates(result.templateIds);
    setFeedback(result.feedback);
  };
  async function run(task: () => Promise<unknown>, success = "") {
    if (busy) return;
    const current = generation.current;
    setBusy(true);
    setError("");
    try {
      await task();
      if (current !== generation.current) return;
      setMessage(success);
      onChange();
      window.dispatchEvent(new CustomEvent("crm:client-work-changed"));
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }
  async function change(action: string, extra: object) {
    const payload = { version: data.version, ...extra },
      key = JSON.stringify({ action, payload });
    if (attempt.current?.key !== key)
      attempt.current = { key, id: crypto.randomUUID() };
    const result = await staffOnboarding(projectId, action, {
      ...payload,
      requestId: attempt.current.id,
    });
    attempt.current = null;
    setData(result);
  }
  return (
    <Card id="project-onboarding">
      <CardHeader>
        <CardTitle>Client onboarding</CardTitle>
        <p className="text-sm text-muted-foreground">
          Client submissions propose information; they never silently replace
          the main client record. Verify identity and corrections with the
          client before using them. Only the developer approves onboarding.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void run(load)}
        >
          {data ? "Refresh onboarding" : "Load onboarding"}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive-text">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-sm text-success-text">
            {message}
          </p>
        )}
        {data && (
          <>
            <p className="font-medium">
              {ONBOARDING_STATES[data.status]} · Submission {data.submission}
            </p>
            {isOwner &&
              (data.status === "not-started" || data.version === 0) &&
              !data.files.length && (
                <fieldset className="space-y-3 rounded-lg border p-4">
                  <legend className="text-sm font-semibold">
                    Service questions
                  </legend>
                  <p className="text-xs text-muted-foreground">
                    Select only purchased services before the client starts.
                    Templates lock after answers or uploads are saved.
                  </p>
                  {Object.keys(ONBOARDING_TEMPLATES).map((id) => (
                    <label key={id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={templates.includes(id)}
                        onChange={(e) =>
                          setTemplates((ids) =>
                            e.target.checked
                              ? [...ids, id]
                              : ids.filter((i) => i !== id),
                          )
                        }
                      />
                      {ONBOARDING_TEMPLATES[id].label}
                    </label>
                  ))}
                  <Button
                    disabled={busy}
                    size="sm"
                    onClick={() =>
                      void run(
                        () => change("configure", { templateIds: templates }),
                        "Service questions saved.",
                      )
                    }
                  >
                    {data.legacyCompleted
                      ? "Start project onboarding"
                      : "Save service questions"}
                  </Button>
                </fieldset>
              )}
            <details>
              <summary className="cursor-pointer font-medium">
                Business and service responses
              </summary>
              <dl className="mt-4 space-y-3">
                {onboardingFields(data.templateIds).map((f) => (
                  <div key={f.id} className="border-b pb-2">
                    <dt className="text-sm font-medium">{f.label}</dt>
                    <dd className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {data.answers[f.id] || "Not provided"}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
            {data.missing.length > 0 && (
              <p className="text-sm text-warning-text">
                Missing: {data.missing.join(", ")}
              </p>
            )}
            <ul className="space-y-2">
              {data.files.map((file) => (
                <li
                  key={file.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm"
                >
                  <span className="min-w-0 flex-1 break-words">
                    {file.name} · {file.status}
                  </span>
                  {file.status === "ready" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(async () =>
                          downloadOnboardingFile(
                            await staffOnboarding(projectId, "download", {
                              fileId: file.id,
                            }),
                          ),
                        )
                      }
                    >
                      Download material
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {["submitted", "under-review", "more-information-needed"].includes(
              data.status,
            ) && (
              <div className="space-y-3 border-t pt-4">
                <Label htmlFor="onboarding-feedback">
                  Message to client (visible in the portal)
                </Label>
                <Textarea
                  id="onboarding-feedback"
                  rows={4}
                  maxLength={4000}
                  value={feedback}
                  disabled={busy}
                  onChange={(e) => setFeedback(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    variant="outline"
                    onClick={() =>
                      void run(
                        () =>
                          change("review", {
                            status: "under-review",
                            feedback,
                          }),
                        "Review started.",
                      )
                    }
                  >
                    Start review
                  </Button>
                  <Button
                    disabled={busy || !feedback.trim()}
                    variant="outline"
                    onClick={() =>
                      void run(
                        () =>
                          change("review", {
                            status: "more-information-needed",
                            feedback,
                          }),
                        "Client can now update and resubmit onboarding.",
                      )
                    }
                  >
                    Request more information
                  </Button>
                  {isOwner && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            change("review", { status: "approved", feedback }),
                          "Onboarding approved.",
                        )
                      }
                    >
                      Approve onboarding
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Contact the client using your usual communication channel when
                  requesting changes. Staff receive CRM notifications; this does
                  not automatically email the client.
                </p>
              </div>
            )}
            {data.feedback && (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                Latest client-visible note: {data.feedback}
              </p>
            )}
            <Button
              disabled={busy || !data.submission}
              variant="ghost"
              onClick={() =>
                void run(async () =>
                  setHistory(
                    (
                      await staffOnboarding<{
                        revisions: OnboardingRevision[];
                      }>(projectId, "history")
                    ).revisions,
                  ),
                )
              }
            >
              View submission history
            </Button>
            {history.map((revision) => (
              <details
                key={revision.submission}
                className="rounded-lg border p-3"
              >
                <summary className="cursor-pointer text-sm font-medium">
                  Submission {revision.submission} ·{" "}
                  {new Date(revision.submittedAt).toLocaleDateString("en-ZA", {
                    timeZone: "Africa/Johannesburg",
                  })}
                </summary>
                <dl className="mt-3 space-y-2">
                  {onboardingFields(revision.templateIds).map((f) => (
                    <div key={f.id}>
                      <dt className="text-sm font-medium">{f.label}</dt>
                      <dd className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                        {revision.answers[f.id] || "Not provided"}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">
                  Files submitted:{" "}
                  {revision.files.map((f) => f.name).join(", ") || "None"}.
                  Current materials can be downloaded above.
                </p>
              </details>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

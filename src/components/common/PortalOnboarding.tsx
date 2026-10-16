import { useEffect, useRef, useState } from "react";
import {
  BUSINESS_FIELDS,
  ONBOARDING_TEMPLATES,
  ONBOARDING_STATES,
  missingOnboardingFields,
} from "../../../shared/onboarding.js";
import {
  publicOnboarding,
  fileBase64,
  downloadOnboardingFile,
  type OnboardingData,
} from "@/services/portalOnboardingService";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
type Field = {
  id: string;
  label: string;
  required?: boolean;
  multiline?: boolean;
  type?: string;
  options?: string[];
};
export function PortalOnboarding({
  token,
  initial,
  businessName,
  projectName,
  onSaved,
}: {
  token: string;
  initial: OnboardingData;
  businessName: string;
  projectName: string;
  onSaved: (data: OnboardingData) => void;
}) {
  const [record, setRecord] = useState(initial),
    [answers, setAnswers] = useState(initial.answers),
    [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [progress, setProgress] = useState<number | null>(null);
  const attempt = useRef<{
      signature: string;
      requestId: string;
      payload: object;
      action: string;
    } | null>(null),
    dirty = useRef(false),
    recordRef = useRef(initial);
  useEffect(() => {
    if (!dirty.current && !busy) {
      setRecord(initial);
      recordRef.current = initial;
      setAnswers(initial.answers);
    }
  }, [initial, busy]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);
  const templates = record.templateIds.map((id) => ({
    id,
    ...ONBOARDING_TEMPLATES[id],
  }));
  const serviceFields: Field[] = templates.flatMap((t) => t.fields);
  const fields: Field[] = [...BUSINESS_FIELDS, ...serviceFields];
  const missing = missingOnboardingFields(answers, record.templateIds);
  const steps = [
    "Business details",
    ...(serviceFields.length ? ["Your service"] : []),
    "Materials",
    "Review & submit",
  ];
  const section = steps[step];
  const adopt = (result: OnboardingData) => {
    setRecord(result);
    recordRef.current = result;
    setAnswers(result.answers);
    dirty.current = false;
    onSaved(result);
  };
  async function mutate(
    action: string,
    extra: object = {},
    uploadProgress = false,
  ) {
    const payload = { version: recordRef.current.version, ...extra },
      signature = JSON.stringify({ action, payload });
    if (attempt.current?.signature !== signature)
      attempt.current = {
        signature,
        action,
        payload,
        requestId: crypto.randomUUID(),
      };
    const current = attempt.current;
    const result = await publicOnboarding<OnboardingData>(
      token,
      action,
      { ...current.payload, requestId: current.requestId },
      uploadProgress ? setProgress : undefined,
    );
    attempt.current = null;
    adopt(result);
    return result;
  }
  async function run(task: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please retry.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }
  const save = () =>
    run(
      () => mutate("save", { answers }),
      "Progress saved. You can return using this private link.",
    );
  const upload = async (file: File) => {
    if (
      !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(
        file.type,
      ) ||
      file.size > 2 * 1024 * 1024 ||
      !file.size
    ) {
      setError("Choose a PNG, JPG, WebP or PDF file, up to 2 MB.");
      return;
    }
    await run(async () => {
      if (dirty.current) await mutate("save", { answers });
      setProgress(0);
      await mutate(
        "upload",
        {
          name: file.name,
          mimeType: file.type,
          base64: await fileBase64(file),
        },
        true,
      );
    }, "File uploaded.");
  };
  function renderFields(list: Field[]) {
    return (
      <div className="space-y-5">
        {list.map((field) => (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={`onboarding-${field.id}`}>
              {field.label}
              {field.required ? " *" : ""}
            </Label>
            {field.options ? (
              <select
                id={`onboarding-${field.id}`}
                className="h-11 w-full rounded-md border bg-background px-3 text-base"
                value={answers[field.id] || ""}
                disabled={busy || !record.editable}
                onChange={(e) => change(field.id, e.target.value)}
              >
                <option value="">Choose one</option>
                {field.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : field.multiline ? (
              <Textarea
                id={`onboarding-${field.id}`}
                rows={4}
                maxLength={4000}
                value={answers[field.id] || ""}
                disabled={busy || !record.editable}
                onChange={(e) => change(field.id, e.target.value)}
              />
            ) : (
              <Input
                id={`onboarding-${field.id}`}
                type={field.type || "text"}
                maxLength={4000}
                value={answers[field.id] || ""}
                disabled={busy || !record.editable}
                onChange={(e) => change(field.id, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>
    );
  }
  function change(key: string, value: string) {
    dirty.current = true;
    setConfirmed(false);
    setAnswers((a) => ({ ...a, [key]: value }));
    setNotice("Unsaved changes — choose Save progress before leaving.");
  }
  return (
    <Card id="portal-onboarding" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>Welcome, {businessName}</CardTitle>
        <p className="text-sm text-muted-foreground">
          Let’s prepare {projectName}. Confirm your business details, tell us
          what you need, and share your materials. We then review your answers
          and agree the next steps.
        </p>
        <p className="text-sm font-medium">
          Getting started: {ONBOARDING_STATES[record.status] || record.status} ·
          About {Math.max(8, ...templates.map((t) => t.minutes))}–
          {Math.max(8, ...templates.map((t) => t.minutes)) + 5} minutes, plus
          uploads.
        </p>
        <p className="text-xs text-muted-foreground">
          You can suggest corrections to the details we already know. They will
          be reviewed before your main client record is changed.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {record.feedback && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm whitespace-pre-wrap">
            <p className="font-semibold">A note from your team</p>
            {record.feedback}
          </div>
        )}
        {!record.editable && (
          <p
            role="status"
            className="rounded-lg border bg-slate-50 p-4 text-sm"
          >
            {record.legacyCompleted
              ? "Your team has already received your project details. You do not need to repeat it. Contact your team if you need to provide new project information."
              : record.status === "approved"
                ? "Your project details have been approved. Your team will keep you updated on delivery."
                : ["submitted", "under-review"].includes(record.status)
                  ? "Your information has been received and is awaiting team review. We will ask here if anything needs clarification."
                  : "This form is read-only. Contact your team if details need changing."}
          </p>
        )}
        <nav aria-label="Onboarding steps" className="flex flex-wrap gap-2">
          {steps.map((name, i) => (
            <Button
              key={name}
              variant={step === i ? "default" : "outline"}
              size="sm"
              onClick={() => setStep(i)}
              disabled={busy}
              aria-current={step === i ? "step" : undefined}
            >
              {i + 1}. {name}
            </Button>
          ))}
        </nav>
        <h3 className="text-lg font-semibold">{section}</h3>
        {section === "Business details" && (
          <>
            <p className="text-sm text-muted-foreground">
              Fields marked * are required. Supply at least an email or phone
              number.
            </p>
            {renderFields(BUSINESS_FIELDS)}
          </>
        )}
        {section === "Your service" &&
          templates.map((template) => (
            <section key={template.id} className="space-y-4">
              <h4 className="font-semibold">{template.label}</h4>
              <p className="text-xs text-muted-foreground">
                Your answers help us understand your needs. Additional work and
                prices still need agreement.
              </p>
              {renderFields(template.fields)}
            </section>
          ))}
        {section === "Materials" && (
          <>
            <p className="text-sm text-muted-foreground">
              Upload logos, business photographs, brand references, or existing
              marketing materials. PNG, JPG, WebP and PDF: up to 2 MB each, 10
              files per project. For larger materials, ask your team for the
              agreed folder. Never upload passwords or private customer records.
            </p>
            {record.editable && (
              <div className="space-y-2">
                <Label htmlFor="onboarding-upload">Upload a file</Label>
                <Input
                  id="onboarding-upload"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  disabled={busy || record.files.length >= 10}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void upload(file);
                  }}
                />
                {progress !== null && (
                  <div role="status">
                    <progress
                      className="w-full"
                      max={100}
                      value={progress}
                      aria-label="Upload progress"
                    />
                    <p className="text-xs text-muted-foreground">
                      {progress < 95
                        ? `Uploading ${progress}%`
                        : "Securing and saving your file…"}
                    </p>
                  </div>
                )}
              </div>
            )}
            <ul className="space-y-3">
              {record.files.map((file) => (
                <li
                  key={file.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
                >
                  <span className="min-w-0 flex-1 break-words text-sm">
                    {file.name} · {Math.ceil(file.sizeBytes / 1024)} KB ·{" "}
                    {file.status === "ready"
                      ? "Uploaded"
                      : "Upload incomplete — retry the same file or reload and remove it after two minutes"}
                  </span>
                  {file.status === "ready" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          async () =>
                            downloadOnboardingFile(
                              await publicOnboarding(token, "download", {
                                fileId: file.id,
                              }),
                            ),
                          "File downloaded.",
                        )
                      }
                    >
                      Download
                    </Button>
                  )}
                  {record.editable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => mutate("remove-file", { fileId: file.id }),
                          "File removed.",
                        )
                      }
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {!record.files.length && (
              <p className="text-sm text-muted-foreground">
                No files uploaded yet. You can still submit your answers; your
                team will confirm any remaining materials.
              </p>
            )}
          </>
        )}
        {section === "Review & submit" && (
          <>
            <p className="text-sm text-muted-foreground">
              Review your answers and uploaded materials before sending them to
              your team.
            </p>
            <dl className="space-y-3">
              {fields.map((f) => (
                <div key={f.id} className="border-b pb-3">
                  <dt className="text-sm font-semibold">{f.label}</dt>
                  <dd className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {answers[f.id] || "Not provided"}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-sm">
              {record.files.filter((f) => f.status === "ready").length} uploaded
              materials
            </p>
            {record.editable && (
              <>
                {missing.length > 0 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
                    <p className="font-medium">Still needed</p>
                    <ul className="list-disc pl-5 text-sm">
                      {missing.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="mt-1"
                  />
                  I have reviewed these answers and understand that changes to
                  agreed work or prices need team approval.
                </label>
                <Button
                  disabled={
                    busy ||
                    !!missing.length ||
                    !confirmed ||
                    record.files.some((f) => f.status !== "ready")
                  }
                  onClick={() =>
                    void run(
                      () => mutate("submit", { answers, confirmed }),
                      "Your project details have been sent. Your team will review it and contact you about the next steps.",
                    )
                  }
                >
                  {busy
                    ? "Submitting…"
                    : record.submission
                      ? "Send updated details"
                      : "Send project details"}
                </Button>
              </>
            )}
          </>
        )}
        {error && (
          <div
            role="alert"
            className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            <p>{error}</p>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (
                  dirty.current &&
                  !window.confirm(
                    "Reload saved progress? Unsaved answers will be replaced.",
                  )
                )
                  return;
                void run(
                  async () => adopt(await publicOnboarding(token, "get")),
                  "Saved progress loaded.",
                );
              }}
            >
              Reload saved progress
            </Button>
          </div>
        )}
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          {step > 0 && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setStep((s) => s - 1)}
            >
              Back
            </Button>
          )}
          {record.editable && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save progress"}
            </Button>
          )}
          {step < steps.length - 1 && (
            <Button disabled={busy} onClick={() => setStep((s) => s + 1)}>
              Continue
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

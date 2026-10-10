import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PublicProjectPortalData } from "@/services/projectShareService";
export function PortalClientActions({
  token,
  project,
}: {
  token: string;
  project: PublicProjectPortalData["project"];
}) {
  const [name, setName] = useState(""),
    [notes, setNotes] = useState(""),
    [title, setTitle] = useState(""),
    [decision, setDecision] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const closed = ["completed", "delivered"].includes(project.status);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const submit = async (action: "decision" | "request") => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    const payload = {
      token,
      action,
      contactName: name,
      notes,
      title,
      decision,
      reviewId: project.review?.id,
    };
    const key = JSON.stringify(payload);
    if (attempt.current?.key !== key)
      attempt.current = { key, id: crypto.randomUUID() };
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const base = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
      const response = await fetch(`${base}/api/project-shares/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestId: attempt.current.id }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Response could not be saved.");
      setMessage(
        "Your response was received. Your team will verify it and update the project.",
      );
      setNotes("");
      setTitle("");
      attempt.current = null;
    } catch (e) {
      setError(
        e instanceof Error && e.name === "AbortError"
          ? "The request timed out. Retry with the same details."
          : e instanceof Error
            ? e.message
            : "Could not save your response.",
      );
    } finally {
      clearTimeout(timeout);
      setBusy(false);
    }
  };
  return (
    <Card id="portal-actions">
      <CardHeader>
        <CardTitle className="text-lg">What we need from you</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {!!project.materials?.length && (
          <div>
            <p className="mb-2 text-sm text-slate-600">
              Outstanding onboarding materials:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-sm">
              {project.materials.map((m) => (
                <li key={m.key}>{m.label}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-600">
              Send materials to your project contact or agreed project folder.
              For account access, invite your team on the platform; do not send
              passwords here.
            </p>
          </div>
        )}
        {project.review && (
          <div className="rounded-lg border p-4 space-y-2">
            <p className="font-medium">
              {project.review.title} · {project.review.version}
            </p>
            <p className="whitespace-pre-wrap text-sm text-slate-600">
              {project.review.instructions}
            </p>
            <p className="text-sm font-medium">
              {project.review.status === "open"
                ? closed
                  ? "Project delivered — contact your team about further changes."
                  : "Your review is requested"
                : `Review recorded: ${project.review.decision || "Reviewed"}`}
            </p>
          </div>
        )}
        {!project.materials?.length && !project.review && (
          <p className="text-sm text-slate-600">
            No specific materials or reviews requested. You can raise a change
            request below.
          </p>
        )}
        <Label htmlFor="portal-contact-name">Your name</Label>
        <Input
          id="portal-contact-name"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
        />
        <Label htmlFor="portal-response">Feedback or request details</Label>
        <Textarea
          id="portal-response"
          value={notes}
          maxLength={4000}
          rows={7}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Describe the changes or approval clearly. Include the affected page. Please omit private credentials."
        />
        {project.review?.status === "open" && !closed && (
          <div className="flex flex-wrap gap-3">
            <select
              aria-label="Review decision"
              className="rounded-md border bg-background text-foreground p-2"
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
            >
              <option value="">Choose your decision</option>
              <option value="approved">Approved</option>
              <option value="changes-requested">Changes requested</option>
              <option value="rejected">Rejected</option>
            </select>
            <Button
              disabled={busy || !name.trim() || !notes.trim() || !decision}
              onClick={() => void submit("decision")}
            >
              Submit revision response
            </Button>
          </div>
        )}
        <div className="border-t pt-4 space-y-3">
          <Label htmlFor="portal-request-title">New change request</Label>
          <Input
            id="portal-request-title"
            value={title}
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Update our opening hours"
          />
          <Button
            variant="outline"
            disabled={busy || !name.trim() || !notes.trim() || !title.trim()}
            onClick={() => void submit("request")}
          >
            Submit change request
          </Button>
          <p className="text-xs text-slate-600">
            New work is reviewed by your team before scope, price or delivery
            dates are agreed.
          </p>
        </div>
        {message && (
          <p
            role="status"
            className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

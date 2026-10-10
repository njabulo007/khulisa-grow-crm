import {
  clientRequestService,
  type ClientRequest,
} from "@/services/clientSuccessService";
import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NoteContent } from "./NoteContent";
import { authenticatedPost } from "@/services/apiClient";
import { toast } from "sonner";
type Response = {
  id: string;
  title: string;
  contactName: string;
  kind: string;
  decision: string;
  notes: string;
  deliverableVersion: string;
  status: string;
  createdAt: string;
};
export function PortalReviewPanel({
  projectId,
  clientId,
  onChange,
}: {
  projectId: string;
  clientId: string;
  onChange: () => void;
}) {
  const [responses, setResponses] = useState<Response[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [title, setTitle] = useState(""),
    [version, setVersion] = useState(""),
    [instructions, setInstructions] = useState(""),
    [requestId, setRequestId] = useState("");
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  useEffect(() => {
    let live = true;
    void clientRequestService
      .list(clientId)
      .then((result) => {
        if (live)
          setRequests(
            result.requests.filter(
              (r) => !r.projectId || r.projectId === projectId,
            ),
          );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [clientId, projectId]);
  const publishAttempt = useRef<{ key: string; id: string } | null>(null);
  const publish = () => {
    const payload = { title, version, instructions, requestId },
      key = JSON.stringify(payload);
    if (publishAttempt.current?.key !== key)
      publishAttempt.current = { key, id: crypto.randomUUID() };
    return call("publish-review", {
      ...payload,
      attemptId: publishAttempt.current.id,
    }).then((result) => {
      publishAttempt.current = null;
      return result;
    });
  };
  const [open, setOpen] = useState(false);
  const call = <T,>(action: string, payload: object = {}) =>
    authenticatedPost<T>("/api/notifications/push", {
      kind: "portal-workflow",
      action,
      projectId,
      ...payload,
    });
  const load = async (next?: string) => {
    try {
      const result = await call<{
        responses: Response[];
        cursor: string | null;
      }>("portal-responses", next ? { cursor: next } : {});
      setResponses((r) =>
        next ? [...r, ...result.responses] : result.responses,
      );
      setCursor(result.cursor);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load client responses.",
      );
    }
  };
  useEffect(() => {
    if (open) void load();
  }, [projectId, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (task: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await task();
      await load();
      onChange();
      window.dispatchEvent(new CustomEvent("crm:client-work-changed"));
      window.dispatchEvent(new CustomEvent("crm:data-changed"));
      toast.success(message);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not process portal work.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card id="portal-review">
      <CardHeader>
        <CardTitle>Client review & responses</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Publish the exact revision the client should review. Verify the
          response with the client before recording it; a shared link does not
          verify their identity.
        </p>
        <Label htmlFor="review-title">Review title</Label>
        <Input
          id="review-title"
          value={title}
          maxLength={160}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Homepage design"
        />
        <Label htmlFor="review-version">Revision</Label>
        <Input
          id="review-version"
          value={version}
          maxLength={120}
          onChange={(e) => setVersion(e.target.value)}
          placeholder="v2 · 10 October"
        />
        <Label htmlFor="review-instructions">Client instructions</Label>
        <Textarea
          id="review-instructions"
          value={instructions}
          maxLength={4000}
          rows={5}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Which preview should they review, and what decision do you need?"
        />
        <Label htmlFor="review-request">Linked work request (optional)</Label>
        <select
          id="review-request"
          className="h-10 w-full rounded-md border bg-background text-foreground px-3"
          value={requestId}
          onChange={(e) => setRequestId(e.target.value)}
        >
          <option value="">Project revision only</option>
          {requests.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          A verified approval completes this request. Changes return it to In
          Progress. Each new publication supersedes the previous review.
        </p>
        <Button
          disabled={
            busy || !title.trim() || !version.trim() || !instructions.trim()
          }
          onClick={() =>
            void run(publish, "Review published in the client portal.")
          }
        >
          Publish revision for review
        </Button>
        <div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setOpen(true);
              if (open) void load();
            }}
          >
            Load client responses
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive-text">
            {error}
          </p>
        )}
        {open && responses.length === 0 && !error && (
          <p className="text-muted-foreground">No portal responses loaded.</p>
        )}
        {open &&
          responses.map((r) => (
            <div key={r.id} className="space-y-3 rounded-lg border p-4">
              <p className="font-medium">
                {r.title} {r.deliverableVersion && `· ${r.deliverableVersion}`}
              </p>
              <p className="text-sm text-muted-foreground">
                {r.contactName} · {r.decision || "Change request"} ·{" "}
                {new Date(r.createdAt).toLocaleDateString("en-ZA")} · {r.status}
              </p>
              <NoteContent text={r.notes} />
              {r.status === "pending-verification" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => call("verify-response", { responseId: r.id }),
                        "Verified response recorded.",
                      )
                    }
                  >
                    {r.kind === "decision"
                      ? "I verified this decision — record it"
                      : "Verify and add to work queue"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          call("verify-response", {
                            responseId: r.id,
                            reject: true,
                          }),
                        "Response dismissed.",
                      )
                    }
                  >
                    Dismiss
                  </Button>
                </div>
              )}
            </div>
          ))}
        {open && cursor && (
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => void load(cursor)}
          >
            Load more responses
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

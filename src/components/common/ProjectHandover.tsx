import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectHandoverData } from "@/services/projectWorkspaceService";
import { emptyHandover } from "../../../shared/projectHandover.js";

type Props = {
  value?: ProjectHandoverData;
  canEdit: boolean;
  closed: boolean;
  busy: boolean;
  onSave: (value: ProjectHandoverData) => void;
  onFiles: () => void;
  onMessages: () => void;
};
export function ProjectHandover({
  value,
  canEdit,
  closed,
  busy,
  onSave,
  onFiles,
  onMessages,
}: Props) {
  const current = value || emptyHandover();
  const [draft, setDraft] = useState<ProjectHandoverData>(current);
  const [editing, setEditing] = useState(false);
  if (editing && canEdit)
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft);
        }}
      >
        <p className="text-sm text-muted-foreground">
          Share practical instructions and only the support agreed with this
          client. Do not include passwords or private access credentials.
        </p>
        <fieldset disabled={busy} className="space-y-4">
          <div>
            <Label htmlFor="handover-website">
              Website or product link (optional)
            </Label>
            <Input
              id="handover-website"
              type="url"
              inputMode="url"
              maxLength={1000}
              placeholder="https://"
              value={draft.websiteUrl}
              onChange={(e) =>
                setDraft({ ...draft, websiteUrl: e.target.value })
              }
            />
          </div>
          <div>
            <Label htmlFor="handover-instructions">
              How to use what we delivered
            </Label>
            <Textarea
              id="handover-instructions"
              rows={6}
              maxLength={6000}
              value={draft.instructions}
              onChange={(e) =>
                setDraft({ ...draft, instructions: e.target.value })
              }
            />
            <p className="text-sm text-muted-foreground">
              Required before sharing. Explain where to start and how to access
              any instructions in the final files.
            </p>
          </div>
          <div>
            <Label htmlFor="handover-outstanding">
              Anything still to be handed over? (optional)
            </Label>
            <Textarea
              id="handover-outstanding"
              rows={3}
              maxLength={3000}
              value={draft.outstanding}
              onChange={(e) =>
                setDraft({ ...draft, outstanding: e.target.value })
              }
            />
          </div>
          <div>
            <Label htmlFor="handover-support">
              Support included in the agreement (optional)
            </Label>
            <Textarea
              id="handover-support"
              rows={3}
              maxLength={3000}
              value={draft.supportScope}
              onChange={(e) =>
                setDraft({ ...draft, supportScope: e.target.value })
              }
              placeholder="Describe only the support that has been agreed."
            />
          </div>
          <div>
            <Label htmlFor="handover-support-until">
              Agreed support end date (optional)
            </Label>
            <Input
              id="handover-support-until"
              type="date"
              value={draft.supportUntil}
              onChange={(e) =>
                setDraft({ ...draft, supportUntil: e.target.value })
              }
            />
          </div>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={draft.published}
              onChange={(e) =>
                setDraft({ ...draft, published: e.target.checked })
              }
            />
            Share these handover details with the client
          </label>
          <div className="flex flex-wrap gap-3">
            <Button type="submit">{busy ? "Saving…" : "Save handover"}</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(false)}
            >
              Close editor
            </Button>
          </div>
        </fieldset>
        <p className="text-sm text-muted-foreground">
          Saving here does not mark milestones complete or change the project
          status.
        </p>
      </form>
    );
  return (
    <section className="space-y-5" aria-label="Project handover">
      <p className="text-base leading-7">
        {closed
          ? "Your project is marked as delivered. You can still view shared files and contact the team while this private link is active."
          : "This is where your team will share the details you need to use your finished project."}
      </p>
      {current.published ? (
        <>
          <p className="text-sm text-muted-foreground">
            Handover shared{" "}
            {current.publishedAt
              ? new Date(current.publishedAt).toLocaleDateString("en-ZA", {
                  timeZone: "Africa/Johannesburg",
                })
              : "by your team"}
            .
          </p>
          {current.websiteUrl && (
            <Button asChild variant="outline">
              <a
                href={current.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open your website or product{" "}
                <span className="sr-only">(opens a new tab)</span>
              </a>
            </Button>
          )}
          <div>
            <h3 className="font-semibold">Getting started</h3>
            <p className="mt-2 whitespace-pre-wrap break-words leading-7">
              {current.instructions}
            </p>
          </div>
          {current.outstanding && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-slate-900">
              <h3 className="font-semibold">Still to be handed over</h3>
              <p className="mt-2 whitespace-pre-wrap break-words leading-7">
                {current.outstanding}
              </p>
            </div>
          )}
          {current.supportScope && (
            <div>
              <h3 className="font-semibold">Your agreed support</h3>
              <p className="mt-2 whitespace-pre-wrap break-words leading-7">
                {current.supportScope}
              </p>
              {current.supportUntil && (
                <p className="mt-2 text-sm">
                  Agreed end date:{" "}
                  {new Date(
                    current.supportUntil + "T12:00:00+02:00",
                  ).toLocaleDateString("en-ZA", {
                    timeZone: "Africa/Johannesburg",
                  })}
                  .
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <p role="status" className="rounded-lg bg-muted p-4 text-sm">
          Your team has not shared handover instructions here yet. You can ask a
          question below.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button onClick={onFiles}>View shared files and final work</Button>
        <Button variant="outline" onClick={onMessages}>
          Ask a question or share feedback
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Tell us how the project went or ask for help in Messages & Feedback.
        Further changes or ongoing services need to be agreed with the team.
      </p>
      {canEdit && (
        <Button
          variant="outline"
          onClick={() => {
            setDraft(current);
            setEditing(true);
          }}
        >
          Prepare or update handover
        </Button>
      )}
    </section>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useClientSectionAnchor } from "@/hooks/useClientSectionAnchor";
import { useAuth } from "@/contexts/AuthContext";
import {
  clientCareService,
  contactDate,
  CHECKLIST_ITEMS,
  CHECKLIST_STATES,
  HEALTH_LABELS,
  type Checklist,
  type ClientCare,
  type HealthStatus,
} from "@/services/clientCareService";
import { clientWorkChanged } from "@/services/clientSuccessService";
import { paymentFollowUpToday } from "@/services/paymentFollowUpService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NoteEditor } from "./NoteEditor";
import { NoteContent } from "./NoteContent";
import { toast } from "sonner";
import { healthTone } from "@/lib/clientCarePresentation";

const selectStyle =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground";
export function ClientCarePanel({
  clientId,
  onChange,
}: {
  clientId: string;
  onChange?: (care: ClientCare) => void;
}) {
  const { user, isOwner } = useAuth();
  const [care, setCare] = useState<ClientCare | null>(null);
  const [status, setStatus] = useState<HealthStatus>("healthy");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [resolution, setResolution] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const changed = useRef(onChange);
  changed.current = onChange;
  const attempt = useRef<{ input: string; id: string } | null>(null);
  const load = useCallback(
    async (fill = true) => {
      const version = ++generation.current;
      setLoading(true);
      try {
        const data = await clientCareService.get(clientId);
        if (version !== generation.current) return;
        setCare(data);
        setDate(contactDate(data.lastContactAt));
        setError("");
        if (fill) {
          setStatus(data.health?.status || "healthy");
          setReason(data.health?.reason || "");
          setChecklist(data.checklist);
          setResolution("");
        }
      } catch (e) {
        if (version === generation.current)
          setError(
            e instanceof Error ? e.message : "Client care could not be loaded.",
          );
      } finally {
        if (version === generation.current) setLoading(false);
      }
    },
    [clientId],
  );
  useEffect(() => {
    setCare(null);
    setChecklist(null);
    attempt.current = null;
    void load();
    const refresh = () => void load(false);
    window.addEventListener("crm:client-work-changed", refresh);
    const invalidate = () => {
      generation.current++;
    };
    return () => {
      invalidate();
      window.removeEventListener("crm:client-work-changed", refresh);
    };
  }, [load, user?.uid]);
  useClientSectionAnchor(clientId, Boolean(care && checklist));
  const save = async (
    action: "health" | "onboarding" | "resolve",
    escalate = false,
  ) => {
    if (!care || saving || loading) return;
    const fields =
      action === "health"
        ? { status, reason, lastContactDate: date, escalate }
        : action === "onboarding"
          ? { checklist }
          : { reason: resolution };
    const input = JSON.stringify({
      action,
      clientId,
      version: care.version,
      ...fields,
    });
    if (attempt.current?.input !== input)
      attempt.current = { input, id: crypto.randomUUID() };
    const version = generation.current;
    setSaving(true);
    try {
      const data = await clientCareService.update(action, {
        clientId,
        version: care.version,
        requestId: attempt.current.id,
        ...fields,
      });
      if (version !== generation.current) return;
      setCare(data);
      attempt.current = null;
      changed.current?.(data);
      if (action === "onboarding") setChecklist(data.checklist);
      if (action === "resolve") setResolution("");
      toast.success(
        escalate
          ? "Concern escalated to the owner."
          : action === "onboarding"
            ? "Onboarding checklist saved."
            : action === "resolve"
              ? "Concern resolved."
              : "Client health saved.",
      );
      clientWorkChanged();
    } catch (e) {
      if (version === generation.current)
        toast.error(
          e instanceof Error ? e.message : "Could not save client care.",
        );
    } finally {
      setSaving(false);
    }
  };
  if (!care || !checklist)
    return (
      <Card>
        <CardContent className="pt-6 space-y-3">
          <p
            role={error ? "alert" : undefined}
            className={
              error ? "text-destructive-text" : "text-muted-foreground"
            }
          >
            {error || "Loading client health and onboarding…"}
          </p>
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh client care
          </Button>
        </CardContent>
      </Card>
    );
  const completed = Object.values(checklist).filter((item) =>
    ["received", "not-required"].includes(item.status),
  ).length;
  return (
    <div className="space-y-6">
      <Card id="client-health" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Client health</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-sm font-medium ${healthTone(care.health?.status)}`}
            >
              {care.health ? HEALTH_LABELS[care.health.status] : "Not assessed"}
            </span>
            <span className="text-sm text-muted-foreground">
              Last contact: {contactDate(care.lastContactAt) || "Not recorded"}
            </span>
          </div>
          {care.health && <NoteContent text={care.health.reason} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="care-health-status">Health status</Label>
              <select
                id="care-health-status"
                className={selectStyle}
                value={status}
                onChange={(e) => setStatus(e.target.value as HealthStatus)}
                disabled={saving || loading}
              >
                {Object.entries(HEALTH_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="care-contact-date">Last-contact date</Label>
              <Input
                id="care-contact-date"
                type="date"
                max={paymentFollowUpToday()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={saving || loading}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Recorded calls, emails, WhatsApp messages, and meetings update the
            last-contact date automatically. Enter an earlier contact here if
            needed.
          </p>
          <NoteEditor
            label="Health reason"
            value={reason}
            onChange={setReason}
            maxLength={4000}
            disabled={saving || loading}
            placeholder="Explain client satisfaction, blockers, or concerns and the next action."
          />
          {care.escalation && (
            <div className="space-y-3 rounded-lg border p-4">
              <p
                className={`font-medium ${care.escalation.status === "open" ? "text-warning-text" : "text-success-text"}`}
              >
                {care.escalation.status === "open"
                  ? "Escalated to owner · awaiting review"
                  : "Concern resolved"}
              </p>
              <NoteContent text={care.escalation.reason} />
              {care.escalation.resolution && (
                <NoteContent text={care.escalation.resolution} />
              )}
              {isOwner && care.escalation.status === "open" && (
                <>
                  <NoteEditor
                    label="Resolution note"
                    value={resolution}
                    onChange={setResolution}
                    maxLength={2000}
                    disabled={saving || loading}
                  />
                  <Button
                    variant="outline"
                    disabled={saving || loading || !resolution.trim()}
                    onClick={() => void save("resolve")}
                  >
                    Resolve concern
                  </Button>
                </>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-destructive-text">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={saving || loading || !reason.trim()}
              onClick={() => void save("health")}
            >
              Save health
            </Button>
            <Button
              variant="outline"
              disabled={
                saving || loading || status === "healthy" || !reason.trim()
              }
              onClick={() => void save("health", true)}
            >
              Save and escalate to owner
            </Button>
            <Button
              variant="ghost"
              disabled={saving || loading}
              onClick={() => void load()}
            >
              Refresh client care
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card id="client-onboarding" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Onboarding checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm font-medium">
            {completed} of 5 items ready ·{" "}
            {completed === 5 ? "Complete" : "Outstanding items remain"}
          </p>
          <progress
            className="h-2 w-full accent-primary"
            aria-label="Onboarding progress"
            value={completed}
            max={5}
          />
          {care.legacyCompleted && (
            <p className="text-sm text-muted-foreground">
              Previously marked complete. Review each item and save to confirm
              the detailed checklist.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Track requests and what is still missing. Use Not Required when an
            item does not apply. Record access status only; share passwords and
            secret keys through a secure channel.
          </p>
          {Object.entries(CHECKLIST_ITEMS).map(([key, label]) => {
            const item = key as keyof Checklist;
            return (
              <div key={key} className="space-y-3 rounded-lg border p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Label
                    className="self-center font-medium"
                    htmlFor={`onboarding-${key}`}
                  >
                    {label}
                  </Label>
                  <select
                    id={`onboarding-${key}`}
                    className={selectStyle}
                    disabled={saving || loading}
                    value={checklist[item].status}
                    onChange={(e) =>
                      setChecklist(
                        (current) =>
                          current && {
                            ...current,
                            [item]: {
                              ...current[item],
                              status: e.target.value,
                            },
                          },
                      )
                    }
                  >
                    {Object.entries(CHECKLIST_STATES).map(([value, title]) => (
                      <option key={value} value={value}>
                        {title}
                      </option>
                    ))}
                  </select>
                </div>
                <Label htmlFor={`onboarding-${key}-notes`} className="sr-only">
                  {label} notes
                </Label>
                <Textarea
                  id={`onboarding-${key}-notes`}
                  value={checklist[item].notes}
                  maxLength={2000}
                  rows={3}
                  className="min-h-20 resize-y"
                  placeholder={
                    key === "access"
                      ? "Which accounts are needed and who will arrange access? Do not paste passwords."
                      : "What is missing, who is providing it, and when is it expected?"
                  }
                  disabled={saving || loading}
                  onChange={(e) =>
                    setChecklist(
                      (current) =>
                        current && {
                          ...current,
                          [item]: { ...current[item], notes: e.target.value },
                        },
                    )
                  }
                />
              </div>
            );
          })}
          <Button
            disabled={saving || loading}
            onClick={() => void save("onboarding")}
          >
            Save checklist
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

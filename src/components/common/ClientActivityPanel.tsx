import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { activityService } from "@/services";
import type { Activity, ActivityType } from "@/types/models";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NoteEditor } from './NoteEditor';
import { NoteContent } from './NoteContent';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const CONTACT_TYPES: Array<{ value: ActivityType; label: string }> = [
  { value: "note", label: "Note" },
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "meeting", label: "Meeting" },
];

export function ClientActivityPanel({ clientId }: { clientId: string }) {
  const { user } = useAuth();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [description, setDescription] = useState("");
  const [type, setType] = useState<ActivityType>("note");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  const [visibleCount, setVisibleCount] = useState(10);

  useEffect(() => {
    setDescription('');
    setVisibleCount(10);
  }, [clientId, user?.uid]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setActivities([]);
    activityService
      .getByEntity("client", clientId)
      .then((next) => {
        if (active) {
          setActivities(next);
          setError("");
        }
      })
      .catch(() => {
        if (active) setError("Client activity could not be loaded.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clientId, user?.uid, retryKey]);

  const save = useCallback(async () => {
    if (!user || !description.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const next = await activityService.create({
        type,
        entityType: "client",
        entityId: clientId,
        description: description.trim(),
        createdBy: user.id,
      });
      setActivities((current) => [next, ...current]);
      setDescription("");
      toast.success("Client interaction saved.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save the interaction.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [user, description, isSaving, type, clientId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Client activity</CardTitle>
        <p className="text-sm text-muted-foreground">
          Keep a record of conversations, decisions, and next steps.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          <Select
            value={type}
            onValueChange={(value) => setType(value as ActivityType)}
          >
            <SelectTrigger
              aria-label="Interaction type"
              className="w-full sm:w-48"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTACT_TYPES.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <NoteEditor
            label="Client interaction notes"
            maxLength={4000}
            placeholder="What happened, and what happens next?"
            value={description}
            onChange={setDescription}
            disabled={isSaving}
          />
          <Button
            onClick={() => void save()}
            disabled={isSaving || !description.trim()}
          >
            {isSaving ? "Saving…" : "Save interaction"}
          </Button>
          <p className="text-xs text-muted-foreground">
            This logs an interaction; it does not send an email or WhatsApp
            message.
          </p>
        </div>
        {error ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 text-sm"
          >
            <p>{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRetryKey((key) => key + 1)}
            >
              Retry
            </Button>
          </div>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading activity…</p>
        ) : !activities.length ? (
          <p className="text-sm text-muted-foreground">
            No client interactions recorded yet.
          </p>
        ) : (
          <ol className="space-y-3">
            {activities.slice(0, visibleCount).map((activity) => (
              <li key={activity.id} className="rounded-xl border p-4">
                <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                  <span className="capitalize">{activity.type}</span>
                  <time dateTime={activity.createdAt}>
                    {new Date(activity.createdAt).toLocaleString("en-ZA")}
                  </time>
                </div>
                <NoteContent text={activity.description} />
              </li>
            ))}
          </ol>
        )}
        {!error && activities.length > visibleCount && (
          <Button variant="outline" onClick={() => setVisibleCount((count) => count + 10)}>
            Show older interactions ({activities.length - visibleCount} remaining)
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

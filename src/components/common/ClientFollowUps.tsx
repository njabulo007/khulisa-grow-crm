import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  clientFollowUpService,
  type ClientFollowUp,
} from "@/services/clientSuccessService";
import {
  paymentFollowUpService,
  paymentFollowUpToday,
} from "@/services/paymentFollowUpService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { NoteEditor } from "./NoteEditor";
import { NoteContent } from "./NoteContent";
import { toast } from "sonner";

export function ClientFollowUps({ clientId }: { clientId?: string }) {
  const { user, isOwner } = useAuth();
  const [records, setRecords] = useState<ClientFollowUp[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState("today");
  const [date, setDate] = useState(paymentFollowUpToday);
  const [waiting, setWaiting] = useState(false);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const load = useCallback(
    async (next?: string, fill = false) => {
      const version = ++generation.current;
      setLoading(true);
      try {
        const data = await clientFollowUpService.list(clientId, next);
        if (version !== generation.current) return;
        setRecords((current) =>
          next
            ? [...current, ...data.followUps].filter(
                (entry, index, all) =>
                  all.findIndex((item) => item.id === entry.id) === index,
              )
            : data.followUps,
        );
        setCursor(data.cursor);
        setError("");
        if (fill) {
          const mine = data.followUps.find((item) => item.mine);
          setDate(mine?.followUpDate || paymentFollowUpToday());
          setWaiting(mine?.waitingForResponse || false);
          setNotes(mine?.notes || "");
        }
      } catch (error) {
        if (version === generation.current)
          setError(
            error instanceof Error
              ? error.message
              : "Client follow-ups could not be loaded.",
          );
      } finally {
        if (version === generation.current) setLoading(false);
      }
    },
    [clientId],
  );
  useEffect(() => {
    setRecords([]);
    void load(undefined, true);
    const changed = () => void load(undefined, true);
    window.addEventListener("crm:client-work-changed", changed);
    const invalidate = () => {
      generation.current++;
    };
    return () => {
      invalidate();
      window.removeEventListener("crm:client-work-changed", changed);
    };
  }, [load, user?.uid]);
  const save = async (cancel = false) => {
    if (!clientId || saving) return;
    setSaving(true);
    try {
      if (cancel) await clientFollowUpService.cancel(clientId);
      else await clientFollowUpService.save(clientId, date, waiting, notes);
      toast.success(
        cancel ? "Client reminders stopped." : "Client check-in scheduled.",
      );
      await load(undefined, true);
      void paymentFollowUpService.check().catch(() => {});
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Follow-up could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };
  const today = paymentFollowUpToday();
  const filtered = records
    .filter(
      (item) =>
        clientId ||
        filter === "all" ||
        (filter === "today"
          ? item.followUpDate === today
          : filter === "overdue"
            ? item.followUpDate < today
            : filter === "waiting"
              ? item.waitingForResponse
              : item.followUpDate > today),
    )
    .sort((a, b) => a.followUpDate.localeCompare(b.followUpDate));
  const mine = records.find((item) => item.mine);
  return (
    <Card id="client-follow-ups">
      <CardHeader>
        <CardTitle className="text-lg">
          {clientId
            ? "Client check-in"
            : isOwner
              ? "Client follow-up queue"
              : "My client follow-ups"}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {clientId
            ? "Schedule your next contact, then log the outcome in Client activity below."
            : "Today’s calls, overdue check-ins, and clients awaiting a response."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-destructive-text">
            {error}
          </p>
        )}
        {clientId && (
          <div className="space-y-3">
            <Label htmlFor="client-contact-date">Next contact date</Label>
            <Input
              id="client-contact-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={saving}
              className="max-w-xs"
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={waiting}
                onCheckedChange={(value) => setWaiting(value === true)}
                disabled={saving}
              />
              Awaiting client response
            </label>
            <NoteEditor
              label="Next contact notes"
              value={notes}
              onChange={setNotes}
              maxLength={10000}
              disabled={saving}
              placeholder="What do you need to discuss or hear back about?"
            />
            <div className="flex flex-wrap gap-2">
              <Button disabled={saving || !date} onClick={() => void save()}>
                {saving
                  ? "Saving…"
                  : mine
                    ? "Update check-in"
                    : "Schedule check-in"}
              </Button>
              {mine && (
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => void save(true)}
                >
                  Stop my reminders
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Daily reminders start on this date, around 09:00 South African
              time, until you log an interaction without a next date or stop
              them. These reminders go to you.
            </p>
          </div>
        )}
        {!clientId && (
          <div className="flex flex-wrap gap-2">
            {[
              ["today", "Today"],
              ["overdue", "Overdue"],
              ["waiting", "Awaiting response"],
              ["upcoming", "Upcoming"],
              ["all", "All"],
            ].map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? "secondary" : "ghost"}
                onClick={() => setFilter(value)}
              >
                {label} (
                {
                  records.filter(
                    (item) =>
                      value === "all" ||
                      (value === "today"
                        ? item.followUpDate === today
                        : value === "overdue"
                          ? item.followUpDate < today
                          : value === "waiting"
                            ? item.waitingForResponse
                            : item.followUpDate > today),
                  ).length
                }
                )
              </Button>
            ))}
          </div>
        )}
        {loading && (
          <p className="text-sm text-muted-foreground">Loading check-ins…</p>
        )}
        {!loading && !filtered.length && (
          <p className="text-sm text-muted-foreground">
            No check-ins in this view. Open a client to schedule one.
          </p>
        )}
        <ul className="space-y-3">
          {filtered.map((record) => (
            <li key={record.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {record.clientName}
                    {clientId && !record.mine
                      ? " · Another team member’s check-in"
                      : ""}
                  </p>
                  <p
                    className={`text-sm ${record.followUpDate < today ? "text-destructive-text" : "text-muted-foreground"}`}
                  >
                    {record.followUpDate < today
                      ? "Overdue"
                      : record.followUpDate === today
                        ? "Today"
                        : "Upcoming"}{" "}
                    · {record.followUpDate}
                    {record.waitingForResponse ? " · Awaiting response" : ""}
                  </p>
                  {record.lastContactAt && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Last contact:{" "}
                      {new Date(record.lastContactAt).toLocaleString("en-ZA", {
                        timeZone: "Africa/Johannesburg",
                      })}
                    </p>
                  )}
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link
                    to={`/clients/${encodeURIComponent(record.clientId)}#client-activity`}
                  >
                    Log contact
                  </Link>
                </Button>
              </div>
              {record.notes && (
                <NoteContent text={record.notes} className="mt-3" />
              )}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={loading || saving}
            onClick={() => void load(undefined, !!clientId)}
          >
            Refresh check-ins
          </Button>
          {cursor && (
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void load(cursor)}
            >
              Load more check-ins
            </Button>
          )}
        </div>
        {!clientId && cursor && (
          <p className="text-xs text-muted-foreground">
            Counts cover loaded check-ins. Load more to include older schedules.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

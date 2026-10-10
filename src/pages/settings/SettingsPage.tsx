import { KHULISA_BANKING } from "@/config/banking";
import { Textarea } from "@/components/ui/textarea";
import { COMMUNICATION_TEMPLATES } from "@/lib/communicationDrafts";
import { useEffect, useState } from "react";
import { InviteAgent } from "@/components/auth/InviteAgent";
import { PageHeader, ConfirmDialog } from "@/components/common";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import {
  AuthService,
  authService,
  settingsService,
  syncCommissionsFromInvoices,
} from "@/services";
import { authenticatedPost } from "@/services/apiClient";
import { useTheme } from "@/contexts/ThemeContext";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import type { CommissionCalculationMode } from "@/types/models";
import { toast } from "sonner";
type Profile = Awaited<ReturnType<typeof AuthService.listUserProfiles>>[number];
export function SettingsPage() {
  const { isOwner, user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [templates, setTemplates] = useState<
    Record<string, { subject: string; body: string }>
  >({});
  const [selectedTemplate, setSelectedTemplate] = useState("check-in");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [mode, setMode] = useState<CommissionCalculationMode>("automatic");
  const [rate, setRate] = useState(15);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [target, setTarget] = useState<{
    profile: Profile;
    action: string;
  } | null>(null);
  const [roles, setRoles] = useState<Record<string, "owner" | "agent">>({});
  const load = async () => {
    if (!isOwner) return;
    try {
      const [people, settings] = await Promise.all([
        AuthService.listUserProfiles(),
        settingsService.getGlobal(),
      ]);
      setTemplates(settings.communicationTemplates || {});
      setProfiles(people);
      setMode(settings.commissionMode);
      setRate(settings.defaultManualCommissionRate);
      setRates(
        Object.fromEntries(
          people.map((p) => [
            p.uid,
            p.commissionRate ??
              authService.getById(p.id)?.commissionRate ??
              settings.defaultManualCommissionRate,
          ]),
        ),
      );
      setRoles(Object.fromEntries(people.map((p) => [p.uid, p.role])));
      setError("");
    } catch {
      setError("Settings could not be loaded. Retry before saving.");
    }
  };
  useEffect(() => {
    void load();
  }, [isOwner]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (task: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await task();
      await load();
      toast.success(message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!target) return;
    const { profile, action } = target;
    await run(async () => {
      if (action === "archive")
        await AuthService.updateAgentRosterState(
          profile.uid,
          !profile.isActive,
        );
      else
        await authenticatedPost("/api/notifications/push", {
          kind: "workflow",
          action,
          uid: profile.uid,
        });
      setTarget(null);
    }, "Team access updated.");
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Personal preferences, team access and business policies."
      />
      {error && (
        <p role="alert">
          {error}{" "}
          <Button variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </p>
      )}
      <Tabs defaultValue="personal">
        <TabsList className="h-auto flex flex-wrap justify-start gap-1">
          <TabsTrigger value="personal">Personal</TabsTrigger>
          {isOwner && (
            <>
              <TabsTrigger value="team">Team & Access</TabsTrigger>
              <TabsTrigger value="commissions">Commission policy</TabsTrigger>
              <TabsTrigger value="templates">Templates</TabsTrigger>
              <TabsTrigger value="billing">Business & Billing</TabsTrigger>
              <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
            </>
          )}
        </TabsList>
        <TabsContent value="personal">
          <Card>
            <CardHeader>
              <CardTitle>Your preferences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Label>Appearance</Label>
              <Select
                value={theme}
                onValueChange={(v) => setTheme(v as "light" | "dark")}
              >
                <SelectTrigger className="max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Use the bell menu to register background push, send a test and
                check delivery. Scheduled follow-up reminders run daily around
                09:00 South African time.
              </p>
              <Button
                variant="outline"
                disabled={busy || !user?.email}
                onClick={() =>
                  void run(
                    () => sendPasswordResetEmail(auth, user!.email),
                    "Password reset email requested. Check your inbox.",
                  )
                }
              >
                Reset my password
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        {isOwner && (
          <>
            <TabsContent value="team">
              <Card>
                <CardHeader>
                  <CardTitle>Team & Access</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <InviteAgent />
                  <p className="text-sm text-muted-foreground">
                    Archive hides an agent from new assignments. Disable access
                    blocks sign-in and existing CRM sessions. Reassign open work
                    before disabling access.
                  </p>
                  {profiles.map((p) => (
                    <div
                      key={p.uid}
                      className="flex flex-wrap items-center gap-3 rounded-lg border p-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium break-words">
                          {p.displayName || p.email}
                        </p>
                        <p className="text-xs text-muted-foreground break-all">
                          {p.email} ·{" "}
                          {p.accessDisabled
                            ? "Access disabled"
                            : p.invitationPending
                              ? "Invitation pending"
                              : "Access enabled"}
                        </p>
                      </div>
                      <Select
                        disabled={busy || p.uid === user?.uid}
                        value={roles[p.uid] || p.role}
                        onValueChange={(v) =>
                          setRoles((r) => ({
                            ...r,
                            [p.uid]: v as "owner" | "agent",
                          }))
                        }
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="owner">Owner</SelectItem>
                          <SelectItem value="agent">Agent</SelectItem>
                        </SelectContent>
                      </Select>
                      {roles[p.uid] !== p.role && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                AuthService.updateUserRole(p.uid, roles[p.uid]),
                              "Role updated.",
                            )
                          }
                        >
                          Save role
                        </Button>
                      )}
                      {p.role === "agent" && (
                        <>
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              setTarget({ profile: p, action: "archive" })
                            }
                          >
                            {p.isActive ? "Archive" : "Restore roster"}
                          </Button>
                          <Button
                            variant={
                              p.accessDisabled ? "outline" : "destructive"
                            }
                            disabled={busy}
                            onClick={() =>
                              setTarget({
                                profile: p,
                                action: p.accessDisabled
                                  ? "restore-access"
                                  : "disable-access",
                              })
                            }
                          >
                            {p.accessDisabled
                              ? "Restore access"
                              : "Disable access"}
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="commissions">
              <Card>
                <CardHeader>
                  <CardTitle>Commission policy</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <Label>Calculation mode</Label>
                  <Select
                    value={mode}
                    onValueChange={(v) =>
                      setMode(v as CommissionCalculationMode)
                    }
                  >
                    <SelectTrigger className="max-w-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="automatic">
                        Automatic sales thresholds
                      </SelectItem>
                      <SelectItem value="manual">
                        Approved manual rates
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Label htmlFor="default-rate">Default rate (%)</Label>
                  <Input
                    id="default-rate"
                    className="max-w-xs"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                  />
                  {profiles
                    .filter((p) => p.role === "agent")
                    .map((p) => (
                      <div
                        key={p.uid}
                        className="flex flex-wrap items-center gap-3"
                      >
                        <Label className="flex-1" htmlFor={`rate-${p.uid}`}>
                          {p.displayName || p.email} (%)
                        </Label>
                        <Input
                          id={`rate-${p.uid}`}
                          className="w-32"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={rates[p.uid] ?? rate}
                          onChange={(e) =>
                            setRates((r) => ({
                              ...r,
                              [p.uid]: Number(e.target.value),
                            }))
                          }
                        />
                      </div>
                    ))}
                  <p className="text-sm text-muted-foreground">
                    Rates are shared across devices. Existing settled payouts
                    are preserved. Changing policy does not silently recalculate
                    historical commissions.
                  </p>
                  <Button
                    disabled={busy || !!error}
                    onClick={() =>
                      void run(async () => {
                        if (
                          ![rate, ...Object.values(rates)].every(
                            (v) => Number.isFinite(v) && v >= 0 && v <= 100,
                          )
                        )
                          throw new Error("Rates must be between 0 and 100.");
                        await authenticatedPost("/api/notifications/push", {
                          kind: "workflow",
                          action: "commission-rates",
                          rates: profiles
                            .filter((p) => p.role === "agent")
                            .map((p) => ({
                              uid: p.uid,
                              rate: rates[p.uid] ?? rate,
                            })),
                        });
                        await settingsService.updateGlobal({
                          commissionMode: mode,
                          defaultManualCommissionRate: rate,
                        });
                      }, "Commission policy saved.")
                    }
                  >
                    Save commission policy
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="templates">
              <Card>
                <CardHeader>
                  <CardTitle>Shared communication templates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Label htmlFor="shared-template">Template</Label>
                  <select
                    id="shared-template"
                    className="h-10 w-full rounded-md border bg-background px-3"
                    value={selectedTemplate}
                    onChange={(e) => setSelectedTemplate(e.target.value)}
                  >
                    {Object.entries(COMMUNICATION_TEMPLATES).map(
                      ([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                  <Label htmlFor="shared-subject">Email subject</Label>
                  <Input
                    id="shared-subject"
                    value={templates[selectedTemplate]?.subject || ""}
                    maxLength={180}
                    onChange={(e) =>
                      setTemplates((t) => ({
                        ...t,
                        [selectedTemplate]: {
                          subject: e.target.value,
                          body: t[selectedTemplate]?.body || "",
                        },
                      }))
                    }
                  />
                  <Label htmlFor="shared-body">Draft message</Label>
                  <Textarea
                    id="shared-body"
                    rows={12}
                    value={templates[selectedTemplate]?.body || ""}
                    maxLength={4000}
                    onChange={(e) =>
                      setTemplates((t) => ({
                        ...t,
                        [selectedTemplate]: {
                          body: e.target.value,
                          subject: t[selectedTemplate]?.subject || "",
                        },
                      }))
                    }
                    placeholder="Leave blank to use the standard template."
                  />
                  <p className="text-sm text-muted-foreground">
                    Available fields:{" "}
                    {
                      "{clientName}, {contactName}, {senderName}, {materials}, {invoiceNumber}, {outstanding}, {dueDate}"
                    }
                    . Drafts remain editable and are sent manually. Never
                    include private credentials.
                  </p>
                  <Button
                    disabled={busy || !!error}
                    onClick={() =>
                      void run(
                        () =>
                          settingsService.updateGlobal({
                            communicationTemplates: templates,
                          }),
                        "Shared templates saved.",
                      )
                    }
                  >
                    Save templates
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="billing">
              <Card>
                <CardHeader>
                  <CardTitle>Business & Billing</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="font-medium">KHULISA MEDIA (PTY) LTD</p>
                  <p className="text-sm">
                    info@khulisamedia.co.za · 063 031 0393
                  </p>
                  {Object.entries(KHULISA_BANKING).map(([key, value]) => (
                    <p key={key} className="text-sm">
                      <span className="text-muted-foreground">
                        {key.replace(/([A-Z])/g, " $1")}:{" "}
                      </span>
                      {value}
                    </p>
                  ))}
                  <p className="text-sm text-muted-foreground">
                    These verified payment details appear on invoices. Record
                    receipts through an issued invoice; drafts do not count as
                    amounts billed. Invoice numbering is reserved centrally and
                    cannot be reused after deletion.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="maintenance">
              <Card>
                <CardHeader>
                  <CardTitle>Maintenance</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Repair historical unpaid commission records only when
                    needed. Settled payouts remain unchanged. Client assignment
                    repair is available from Clients.
                  </p>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        syncCommissionsFromInvoices,
                        "Commission repair completed.",
                      )
                    }
                  >
                    Repair unpaid commissions
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Use Reports to export business summaries. Keep Firebase
                    backups and billing records before deleting client data.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </>
        )}
      </Tabs>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open && !busy) setTarget(null);
        }}
        title={
          target?.action === "archive"
            ? "Change roster status?"
            : target?.action === "restore-access"
              ? "Restore agent access?"
              : "Disable agent access?"
        }
        description={
          target?.action === "archive"
            ? "This changes the assignment roster only. It does not revoke access."
            : "This changes sign-in access for this agent. Their records and financial history are retained."
        }
        confirmLabel={busy ? "Saving…" : "Confirm"}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}

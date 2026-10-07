import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { authService, AuthService, settingsService, syncCommissionsFromInvoices } from '@/services';
import { CommissionCalculationMode, User } from '@/types/models';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common';

const normalizeCommissionRatePercent = (value: number, fallbackPercent: number): number => {
  const baseline = Number.isFinite(fallbackPercent) ? fallbackPercent : 0;
  if (!Number.isFinite(value)) return Math.max(0, Math.min(100, baseline));
  const resolved = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(resolved * 100) / 100));
};

export function SettingsPage() {
  const navigate = useNavigate();
  const { isOwner, user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [agentUsers, setAgentUsers] = useState<User[]>([]);
  const [commissionMode, setCommissionMode] = useState<CommissionCalculationMode>('automatic');
  const [defaultManualCommissionRate, setDefaultManualCommissionRate] = useState<number>(15);
  const [agentCommissionRates, setAgentCommissionRates] = useState<Record<string, number>>({});
  const [userProfiles, setUserProfiles] = useState<Awaited<ReturnType<typeof AuthService.listUserProfiles>>>([]);
  const [rosterTarget, setRosterTarget] = useState<(typeof userProfiles)[number] | null>(null);
  const [isRosterSaving, setIsRosterSaving] = useState(false);
  const [roleChanges, setRoleChanges] = useState<Record<string, 'owner' | 'agent'>>({});

  const applySettingsToState = useCallback((
    mode: CommissionCalculationMode,
    defaultRate: number,
    agents: User[],
  ) => {
    const normalizedDefaultRate = normalizeCommissionRatePercent(defaultRate, 15);
    setCommissionMode(mode);
    setDefaultManualCommissionRate(normalizedDefaultRate);
    setAgentCommissionRates(
      agents.reduce<Record<string, number>>((acc, agent) => {
        acc[agent.id] = normalizeCommissionRatePercent(agent.commissionRate, normalizedDefaultRate);
        return acc;
      }, {}),
    );
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      if (!isOwner) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const [globalSettings, profiles] = await Promise.all([
          settingsService.getGlobal(),
          AuthService.listUserProfiles(),
        ]);
        const agents = authService.getAll().filter((user) => user.role === 'agent' && user.isActive !== false);
        if (!isMounted) return;

        setAgentUsers(agents);
        setUserProfiles(profiles);
        setRoleChanges(Object.fromEntries(profiles.map((profile) => [profile.uid, profile.role])));
        applySettingsToState(
          globalSettings.commissionMode,
          globalSettings.defaultManualCommissionRate,
          agents,
        );
      } catch (error) {
        console.error('[SettingsPage] Failed to load settings.', error);
        toast.error('Failed to load global settings.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    void loadData();
    return () => {
      isMounted = false;
    };
  }, [applySettingsToState, isOwner]);

  const commissionModeLabel = useMemo(
    () => (commissionMode === 'manual' ? 'Manual Mode Active' : 'Automatic Mode Active'),
    [commissionMode],
  );

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const normalizedDefaultRate = normalizeCommissionRatePercent(defaultManualCommissionRate, 15);
      await settingsService.updateGlobal({
        commissionMode,
        defaultManualCommissionRate: normalizedDefaultRate,
      });

      await Promise.all(
        userProfiles.map(async (profile) => {
          const nextRole = roleChanges[profile.uid] || profile.role;
          if (profile.uid !== user?.uid && nextRole !== profile.role) await AuthService.updateUserRole(profile.uid, nextRole);
        }),
      );

      agentUsers.forEach((agent) => {
        const nextRate = normalizeCommissionRatePercent(
          agentCommissionRates[agent.id],
          normalizedDefaultRate,
        );
        if (agent.commissionRate === nextRate) return;
        authService.update(agent.id, { commissionRate: nextRate });
      });

      await syncCommissionsFromInvoices();
       const refreshedProfiles = await AuthService.listUserProfiles();
       setUserProfiles(refreshedProfiles);
       setRoleChanges(Object.fromEntries(refreshedProfiles.map((profile) => [profile.uid, profile.role])));
       setAgentUsers(authService.getAll().filter((user) => user.role === 'agent' && user.isActive !== false));
      toast.success('Global settings saved and commissions refreshed.');
    } catch (error) {
      console.error('[SettingsPage] Failed to save settings.', error);
      toast.error('Could not save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRosterChange = async () => {
    if (!rosterTarget || isRosterSaving) return;
    setIsRosterSaving(true);
    try {
      await AuthService.updateAgentRosterState(rosterTarget.uid, !rosterTarget.isActive);
      const profiles = await AuthService.listUserProfiles();
      setUserProfiles(profiles);
      setAgentUsers(authService.getAll().filter((agent) => agent.role === 'agent' && agent.isActive !== false));
      setRosterTarget(null);
      toast.success(rosterTarget.isActive ? 'Agent removed from the active roster.' : 'Agent restored to the roster.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the agent roster.');
    } finally { setIsRosterSaving(false); }
  };

  const handleReset = async () => {
    setIsLoading(true);
    try {
       const [globalSettings, profiles] = await Promise.all([
         settingsService.getGlobal(),
         AuthService.listUserProfiles(),
       ]);
      const agents = authService.getAll().filter((user) => user.role === 'agent' && user.isActive !== false);
       setAgentUsers(agents);
       setUserProfiles(profiles);
       setRoleChanges(Object.fromEntries(profiles.map((profile) => [profile.uid, profile.role])));
      applySettingsToState(
        globalSettings.commissionMode,
        globalSettings.defaultManualCommissionRate,
        agents,
      );
      toast.success('Settings restored.');
    } catch (error) {
      console.error('[SettingsPage] Failed to reset settings view.', error);
      toast.error('Could not reset settings view.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOwner) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader title="Settings" description="Manage your CRM settings" />
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Only owners can change global settings.</p>
            <Button variant="link" onClick={() => navigate('/')}>
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Settings" description="Manage your CRM settings" />
      <Card>
        <CardHeader>
          <CardTitle>Commission Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading settings...</p>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Commission Mode</Label>
                  <Select
                    value={commissionMode}
                    onValueChange={(value) => setCommissionMode(value as CommissionCalculationMode)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual (owner-controlled rates)</SelectItem>
                      <SelectItem value="automatic">Automatic (sales threshold logic)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{commissionModeLabel}</p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="default-manual-rate">Default Manual Rate (%)</Label>
                  <Input
                    id="default-manual-rate"
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    value={defaultManualCommissionRate}
                    onChange={(event) =>
                      setDefaultManualCommissionRate(Number(event.target.value))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Used when an agent has no custom rate in manual mode.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-medium">Team & Access</h3>
                <p className="text-xs text-muted-foreground">Archived agents leave the rankings and assignment menus. Their records and sign-in accounts are retained; archiving does not revoke access.</p>
                <Table>
                  <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Roster</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {userProfiles.map((profile) => (
                      <TableRow key={profile.uid}>
                        <TableCell className="font-medium">{profile.displayName || profile.email}</TableCell>
                        <TableCell>{profile.email}</TableCell>
                        <TableCell>
                          <Select disabled={profile.uid === user?.uid} value={roleChanges[profile.uid] || profile.role} onValueChange={(value) => setRoleChanges((prev) => ({ ...prev, [profile.uid]: value as 'owner' | 'agent' }))}>
                            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="owner">Owner</SelectItem><SelectItem value="agent">Agent</SelectItem></SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {profile.role === 'agent' ? (
                            <Button variant="outline" size="sm" disabled={isSaving || isRosterSaving || profile.uid === user?.uid}
                              onClick={() => setRosterTarget(profile)}>
                              {profile.isActive ? 'Archive agent' : 'Restore agent'}
                            </Button>
                          ) : <span className="text-xs text-muted-foreground">Owner</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-medium">Agent Commission Rates (%)</h3>
                {agentUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No agent users found.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agent</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead className="w-[220px] text-right">Rate (%)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {agentUsers.map((agent) => (
                        <TableRow key={agent.id}>
                          <TableCell className="font-medium">{agent.name}</TableCell>
                          <TableCell>{agent.email}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              step="0.01"
                              min={0}
                              max={100}
                              value={agentCommissionRates[agent.id] ?? defaultManualCommissionRate}
                              onChange={(event) =>
                                setAgentCommissionRates((prev) => ({
                                  ...prev,
                                  [agent.id]: Number(event.target.value),
                                }))
                              }
                              className="ml-auto w-[180px]"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" onClick={() => void handleReset()} disabled={isSaving}>
                  Reset
                </Button>
                <Button onClick={() => void handleSave()} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Settings'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog open={Boolean(rosterTarget)} onOpenChange={(open) => { if (!open && !isRosterSaving) setRosterTarget(null); }}
        title={rosterTarget?.isActive ? 'Archive agent?' : 'Restore agent?'}
        description={rosterTarget?.isActive
          ? `${rosterTarget.displayName || rosterTarget.email} will be removed from rankings and new assignment menus. Existing leads, clients, projects, and financial records are preserved.`
          : 'This agent will appear in rankings and assignment menus again.'}
        confirmLabel={isRosterSaving ? 'Saving...' : rosterTarget?.isActive ? 'Archive agent' : 'Restore agent'}
        onConfirm={() => void handleRosterChange()} />
    </div>
  );
}

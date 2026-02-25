import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { authService, settingsService, syncCommissionsFromInvoices } from '@/services';
import { CommissionCalculationMode, User } from '@/types/models';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';

const normalizeCommissionRatePercent = (value: number, fallbackPercent: number): number => {
  const baseline = Number.isFinite(fallbackPercent) ? fallbackPercent : 0;
  if (!Number.isFinite(value)) return Math.max(0, Math.min(100, baseline));
  const resolved = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(resolved * 100) / 100));
};

export function SettingsPage() {
  const navigate = useNavigate();
  const { isOwner } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [agentUsers, setAgentUsers] = useState<User[]>([]);
  const [commissionMode, setCommissionMode] = useState<CommissionCalculationMode>('automatic');
  const [defaultManualCommissionRate, setDefaultManualCommissionRate] = useState<number>(15);
  const [agentCommissionRates, setAgentCommissionRates] = useState<Record<string, number>>({});

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
      setIsLoading(true);
      try {
        const globalSettings = await settingsService.getGlobal();
        const agents = authService.getAll().filter((user) => user.role === 'agent');
        if (!isMounted) return;

        setAgentUsers(agents);
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
  }, [applySettingsToState]);

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

      agentUsers.forEach((agent) => {
        const nextRate = normalizeCommissionRatePercent(
          agentCommissionRates[agent.id],
          normalizedDefaultRate,
        );
        if (agent.commissionRate === nextRate) return;
        authService.update(agent.id, { commissionRate: nextRate });
      });

      await syncCommissionsFromInvoices();
      setAgentUsers(authService.getAll().filter((user) => user.role === 'agent'));
      toast.success('Global settings saved and commissions refreshed.');
    } catch (error) {
      console.error('[SettingsPage] Failed to save settings.', error);
      toast.error('Could not save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setIsLoading(true);
    try {
      const globalSettings = await settingsService.getGlobal();
      const agents = authService.getAll().filter((user) => user.role === 'agent');
      setAgentUsers(agents);
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
    </div>
  );
}

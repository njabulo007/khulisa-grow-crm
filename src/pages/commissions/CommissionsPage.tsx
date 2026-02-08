import React, { useEffect, useMemo, useState } from 'react';
import { PageHeader, StatusBadge } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getPackageNameById } from '@/config/packages';
import { useAuth } from '@/contexts/AuthContext';
import {
  authService,
  syncCommissionsFromInvoices,
} from '@/services';
import { CommissionStatus } from '@/types/models';
import { toast } from 'sonner';
import { useCommissions } from '@/hooks/useCommissions';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(amount);
};

const monthLabelFormatter = new Intl.DateTimeFormat('en-ZA', {
  month: 'long',
  year: 'numeric',
});

const formatEarnedDate = (value?: string) =>
  value ? new Date(value).toLocaleDateString('en-ZA') : '-';

const getEarnedMonthKey = (value?: string) => {
  if (!value) return 'no-earned-date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'no-earned-date';
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const getMonthLabelFromKey = (key: string) => {
  if (key === 'no-earned-date') return 'No Earned Date';
  const [year, month] = key.split('-').map(Number);
  const monthDate = new Date(Date.UTC(year, month - 1, 1));
  return monthLabelFormatter.format(monthDate);
};

export function CommissionsPage() {
  const { user, isOwner } = useAuth();
  const { commissions: allCommissions, updateCommission, refresh: refreshCommissions } = useCommissions();
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [monthFilter, setMonthFilter] = useState<string>(getEarnedMonthKey(new Date().toISOString()));
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const allAgents = authService.getAll().filter((candidate) => candidate.role === 'agent');

  useEffect(() => {
    syncCommissionsFromInvoices();
    refreshCommissions();
  }, [refreshCommissions]);

  const visibleCommissions = useMemo(() => {
    if (!user) return [];
    const ownerBase = allCommissions
      .filter((commission) => (agentFilter !== 'all' ? commission.agentId === agentFilter : true))
      .filter((commission) => (monthFilter !== 'all' ? getEarnedMonthKey(commission.earnedDate) === monthFilter : true))
      .filter((commission) => (statusFilter !== 'all' ? commission.status === statusFilter : true));
    const base = isOwner ? ownerBase : allCommissions.filter((commission) => commission.agentId === user.id);
    return base
      .sort((a, b) => {
        const aTime = a.earnedDate ? new Date(a.earnedDate).getTime() : new Date(a.updatedAt).getTime();
        const bTime = b.earnedDate ? new Date(b.earnedDate).getTime() : new Date(b.updatedAt).getTime();
        return bTime - aTime;
      });
  }, [agentFilter, allCommissions, isOwner, monthFilter, statusFilter, user]);

  const monthFilterOptions = useMemo(() => {
    if (!isOwner) return [];

    const source = allCommissions.filter((commission) => (
      agentFilter !== 'all' ? commission.agentId === agentFilter : true
    ));

    const keys = Array.from(new Set(source.map((commission) => getEarnedMonthKey(commission.earnedDate))));
    return keys
      .map((key) => ({ key, label: getMonthLabelFromKey(key) }))
      .sort((a, b) => {
        if (a.key === 'no-earned-date') return 1;
        if (b.key === 'no-earned-date') return -1;
        return a.key < b.key ? 1 : -1;
      });
  }, [agentFilter, allCommissions, isOwner]);

  const groupedSummary = useMemo(() => {
    const scope = user
      ? isOwner
        ? allCommissions
        : allCommissions.filter((commission) => commission.agentId === user.id)
      : [];
    const pending = scope
      .filter((commission) => commission.status === 'pending')
      .reduce((sum, commission) => sum + commission.commissionAmount, 0);
    const earned = scope
      .filter((commission) => commission.status === 'earned' || commission.status === 'paid-out')
      .reduce((sum, commission) => sum + commission.commissionAmount, 0);
    const readyForPayout = scope
      .filter((commission) => commission.status === 'earned')
      .reduce((sum, commission) => sum + commission.commissionAmount, 0);
    const paidOut = scope
      .filter((commission) => commission.status === 'paid-out')
      .reduce((sum, commission) => sum + commission.commissionAmount, 0);

    return { pending, earned, readyForPayout, paidOut };
  }, [allCommissions, isOwner, user]);

  const agentMonthlyGroups = useMemo(() => {
    if (isOwner) return [];

    const grouped = new Map<
      string,
      { key: string; label: string; sortTime: number; total: number; entries: typeof visibleCommissions }
    >();

    visibleCommissions.forEach((commission) => {
      const earnedAt = commission.earnedDate ? new Date(commission.earnedDate) : null;
      const hasEarnedDate = earnedAt !== null && !Number.isNaN(earnedAt.getTime());
      const key = hasEarnedDate ? `${earnedAt.getUTCFullYear()}-${String(earnedAt.getUTCMonth() + 1).padStart(2, '0')}` : 'no-earned-date';
      const label = hasEarnedDate ? monthLabelFormatter.format(earnedAt) : 'No Earned Date';
      const sortTime = hasEarnedDate ? earnedAt.getTime() : 0;

      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          label,
          sortTime,
          total: 0,
          entries: [],
        });
      }

      const group = grouped.get(key);
      if (!group) return;
      group.total += commission.commissionAmount;
      group.entries.push(commission);
    });

    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        entries: group.entries.sort((a, b) => {
          const aTime = a.earnedDate ? new Date(a.earnedDate).getTime() : 0;
          const bTime = b.earnedDate ? new Date(b.earnedDate).getTime() : 0;
          return bTime - aTime;
        }),
      }))
      .sort((a, b) => b.sortTime - a.sortTime);
  }, [isOwner, visibleCommissions]);

  const ownerPeriodLabel = useMemo(
    () => (monthFilter === 'all' ? 'All Periods' : getMonthLabelFromKey(monthFilter)),
    [monthFilter],
  );

  const ownerCommissionsByAgent = useMemo(() => {
    if (!isOwner) return [];

    const grouped = new Map<
      string,
      { agentId: string; agentName: string; total: number; entries: typeof visibleCommissions }
    >();

    visibleCommissions.forEach((commission) => {
      const agent = authService.getById(commission.agentId);
      const agentName = agent?.name || 'Unknown agent';
      if (!grouped.has(commission.agentId)) {
        grouped.set(commission.agentId, {
          agentId: commission.agentId,
          agentName,
          total: 0,
          entries: [],
        });
      }
      const group = grouped.get(commission.agentId);
      if (!group) return;
      group.total += commission.commissionAmount;
      group.entries.push(commission);
    });

    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        entries: group.entries.sort((a, b) => {
          const aTime = a.earnedDate ? new Date(a.earnedDate).getTime() : new Date(a.updatedAt).getTime();
          const bTime = b.earnedDate ? new Date(b.earnedDate).getTime() : new Date(b.updatedAt).getTime();
          return bTime - aTime;
        }),
      }))
      .sort((a, b) => b.total - a.total);
  }, [isOwner, visibleCommissions]);

  const handleMarkPaidOut = (commissionId: string) => {
    if (!isOwner) return;
    const updated = updateCommission(commissionId, {
      status: 'paid-out',
      paidOutDate: new Date().toISOString(),
    });
    if (!updated) {
      toast.error('Commission record not found.');
      return;
    }
    toast.success('Commission marked as paid out.');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Commissions"
        description={isOwner ? 'Track all agent earnings and payouts' : 'Track your commission earnings'}
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total Earned</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-accent">{formatCurrency(groupedSummary.earned)}</p>
            <p className="text-xs text-muted-foreground">Paid Out + Earned</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-warning">{formatCurrency(groupedSummary.pending)}</p>
            <p className="text-xs text-muted-foreground">Awaiting invoice payment</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Ready for Payout</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-primary">{formatCurrency(groupedSummary.readyForPayout)}</p>
            <p className="text-xs text-muted-foreground">Paid invoices not paid out</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Paid Out</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-success">{formatCurrency(groupedSummary.paidOut)}</p>
            <p className="text-xs text-muted-foreground">Completed payouts</p>
          </CardContent>
        </Card>
      </div>

      {isOwner && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Filter by agent" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Agents</SelectItem>
              {allAgents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={monthFilter} onValueChange={setMonthFilter}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Filter by month" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Periods</SelectItem>
              {monthFilterOptions.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="earned">Earned</SelectItem>
              <SelectItem value="paid-out">Paid Out</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {isOwner ? (
        <div className="space-y-4">
          {ownerCommissionsByAgent.length === 0 ? (
            <Card>
              <CardContent>
                <p className="px-2 py-8 text-center text-muted-foreground">No commissions found for the selected filters.</p>
              </CardContent>
            </Card>
          ) : (
            ownerCommissionsByAgent.map((group) => (
              <Card key={group.agentId}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle>{`${group.agentName} - ${ownerPeriodLabel}`}</CardTitle>
                  <p className="text-xl font-bold text-accent">{formatCurrency(group.total)}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {group.entries.map((commission) => (
                    <div
                      key={commission.id}
                      className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2"
                    >
                      <div>
                        <p className="font-medium">{getPackageNameById(commission.packageId)}</p>
                        <p className="text-xs text-muted-foreground">
                          Earned: {formatEarnedDate(commission.earnedDate)} | Paid Out:{' '}
                          {commission.paidOutDate ? new Date(commission.paidOutDate).toLocaleDateString('en-ZA') : '-'}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={commission.status as CommissionStatus} type="commission" />
                        <p className="font-semibold">{formatCurrency(commission.commissionAmount)}</p>
                        {commission.status === 'earned' ? (
                          <Button size="sm" variant="outline" onClick={() => handleMarkPaidOut(commission.id)}>
                            Mark as Paid Out
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {agentMonthlyGroups.length === 0 ? (
            <Card>
              <CardContent>
                <p className="px-2 py-8 text-center text-muted-foreground">No commissions found.</p>
              </CardContent>
            </Card>
          ) : (
            agentMonthlyGroups.map((group) => (
              <Card key={group.key}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle>{group.label}</CardTitle>
                  <p className="text-xl font-bold text-accent">{formatCurrency(group.total)}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {group.entries.map((commission) => (
                    <div
                      key={commission.id}
                      className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2"
                    >
                      <div>
                        <p className="font-medium">{getPackageNameById(commission.packageId)}</p>
                        <p className="text-xs text-muted-foreground">
                          Date earned: {formatEarnedDate(commission.earnedDate)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={commission.status as CommissionStatus} type="commission" />
                        <p className="font-semibold">{formatCurrency(commission.commissionAmount)}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}

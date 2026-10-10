import { OperationalReports } from '@/components/common/OperationalReports';
import { cashByMonth, closedLeadWinRate } from '@/lib/cashReporting';
import { paymentService } from '@/services/paymentService';
import type { Payment } from '@/types/models';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getAgentPerformance } from '@/lib/agentPerformance';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPackageNameById } from '@/config/packages';
import { buildProjectLookup, getInvoiceEffectiveTotals } from '@/lib/invoiceTotals';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import { activityService, authService, clientService, invoiceService, leadService, projectService } from '@/services';
import { Invoice, ProjectStatus } from '@/types/models';
import { toast } from 'sonner';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const MONTH_WINDOW = 12;
const OWNER_GMAIL = 'njabulod007@gmail.com';
const ACTIVE_PROJECT_STATUSES: ProjectStatus[] = ['not-started', 'in-progress', 'waiting-client', 'on-hold'];

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(amount);

const getInvoiceIssueDate = (invoice: Invoice): Date => {
  const value = (invoice as Invoice & { issueDate?: string }).issueDate || invoice.issuedDate;
  return new Date(value);
};

const toMonthKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const formatReportDate = (value: Date): string =>
  value.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export function ReportsPage() {
  const navigate = useNavigate();
  const { isOwner } = useAuth();
  const [payments,setPayments]=useState<Payment[]>([]);
  const [periodStart,setPeriodStart]=useState(''),[periodEnd,setPeriodEnd]=useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [leads, setLeads] = useState<Awaited<ReturnType<typeof leadService.getAll>>>([]);
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof projectService.getAll>>>([]);
  const [invoices, setInvoices] = useState<Awaited<ReturnType<typeof invoiceService.getAll>>>([]);
  const [clients, setClients] = useState<Awaited<ReturnType<typeof clientService.getAll>>>([]);
  const [activities, setActivities] = useState<Awaited<ReturnType<typeof activityService.getAll>>>([]);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      setIsLoading(true);
      try {
        const [nextLeads, nextProjects, nextInvoices, nextClients, nextActivities, nextPayments] = await Promise.all([
          leadService.getAll(),
          projectService.getAll(),
          invoiceService.getAll(),
          clientService.getAll(),
          activityService.getAll(),
          paymentService.getAll(),
        ]);
        if (!isMounted) return;
        setLeads(nextLeads);
        setProjects(nextProjects);
        setInvoices(nextInvoices);
        setClients(nextClients);
        setActivities(nextActivities);
        setPayments(nextPayments);
        setLoadError(null);
      } catch (error) {
        console.error('[ReportsPage] Failed to load records.', error);
        if (isMounted) setLoadError('Reports could not be refreshed. Check your connection and try again.');
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    void loadData();
    const refresh = () => setRetryKey((key) => key + 1);
    window.addEventListener('crm:data-changed', refresh);
    return () => {
      isMounted = false;
      window.removeEventListener('crm:data-changed', refresh);
    };
  }, [retryKey]);

  const users = authService.getAll();
  const projectLookup = useMemo(() => buildProjectLookup(projects), [projects]);

  const reportData = useMemo(() => {
    const getInvoiceAmount = (invoice: Invoice) => getInvoiceEffectiveTotals(invoice, projectLookup).total;
    const paidInvoices = invoices.filter((invoice) => invoice.status === 'paid');

    const periodPayments = payments.filter(p=>{const day=new Date(Date.parse(p.paidAt)+7200000).toISOString().slice(0,10);return (!periodStart||day>=periodStart)&&(!periodEnd||day<=periodEnd);});
    const revenueByMonthMap = cashByMonth(periodPayments);
    const now = new Date();
    const revenueByMonth = [];
    for (let i = MONTH_WINDOW - 1; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = toMonthKey(date);
      const bucket = revenueByMonthMap[monthKey] || { revenue: 0, invoiceCount: 0 };
      revenueByMonth.push({
        month: date.toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' }),
        monthKey,
        revenue: bucket.revenue,
        invoiceCount: bucket.invoiceCount,
      });
    }

    const projectById = new Map(projects.map((project) => [project.id, project]));
    const invoiceById = new Map(invoices.map(i=>[i.id,i]));
    const revenueByPackageMap = periodPayments.reduce((acc,payment)=>{
      const invoice=invoiceById.get(payment.invoiceId);
      const packageKey=invoice?.packageId || (invoice?.projectId ? projectById.get(invoice.projectId)?.packageId : null) || 'unlinked';
      acc[packageKey] ||= {revenue:0,invoiceCount:0};acc[packageKey].revenue+=payment.amount;acc[packageKey].invoiceCount++;
      return acc;
    },{} as Record<string,{revenue:number;invoiceCount:number}>);
    const revenueByPackage = Object.entries(revenueByPackageMap)
      .map(([packageId, value]) => ({
        packageType: packageId === 'unlinked' ? 'Unlinked' : getPackageNameById(packageId),
        revenue: value.revenue,
        invoiceCount: value.invoiceCount,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const funnel = [
      { stage: 'New', count: leads.filter((lead) => lead.stage === 'new').length },
      { stage: 'Contacted', count: leads.filter((lead) => lead.stage === 'contacted').length },
      { stage: 'Proposal Sent', count: leads.filter((lead) => lead.stage === 'proposal').length },
      { stage: 'Negotiation', count: leads.filter((lead) => lead.stage === 'negotiation').length },
      { stage: 'Won', count: leads.filter((lead) => lead.stage === 'won').length },
      { stage: 'Lost', count: leads.filter((lead) => lead.stage === 'lost').length },
    ];

    const totalLeads = leads.length || 1;
    const wonCount = funnel.find((item) => item.stage === 'Won')?.count || 0;
    const lostCount = funnel.find((item) => item.stage === 'Lost')?.count || 0;
    const winRate = closedLeadWinRate(wonCount,lostCount);
    const lossRate = closedLeadWinRate(lostCount,wonCount);

    const agentPerformance = getAgentPerformance(users, leads, clients, projects, invoices)
      .map((agent) => ({ ...agent, agentId: agent.id, agentName: agent.name }));

    const usersById = new Map(users.flatMap((user) => [[user.id, user] as const, ...(user.uid ? [[user.uid, user] as const] : [])]));
    const leadActivityReport = leads
      .map((lead) => {
        const leadActivities = activities
          .filter((activity) => activity.entityType === 'lead' && activity.entityId === lead.id)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const latest = leadActivities[0];
        return {
          leadId: lead.id,
          businessName: lead.businessName,
          agentName: usersById.get(lead.assignedTo)?.name || 'Unassigned',
          activityCount: leadActivities.length,
          latestActivityAt: latest?.createdAt,
          latestActivityDescription: latest?.description || 'No activity yet',
          latestActivityBy: latest ? usersById.get(latest.createdBy)?.name || 'Unknown user' : '',
        };
      })
      .sort((a, b) => b.activityCount - a.activityCount);

    return {
      revenueByMonth,
      revenueByPackage,
      funnel,
      winRate,
      lossRate,
      agentPerformance,
      leadActivityReport,
    };
  }, [activities, clients, invoices, leads, payments, periodStart, periodEnd, projectLookup, projects, users]);

  const handleExportPipelineSummary = useCallback(() => {
    const now = new Date();
    const activeProjects = projects.filter((project) => ACTIVE_PROJECT_STATUSES.includes(project.status));
    const overdueProjects = activeProjects.filter((project) => new Date(project.dueDate).getTime() < now.getTime());
    const openLeads = leads.filter((lead) => lead.stage !== 'won' && lead.stage !== 'lost');
    const overdueFollowUps = openLeads.filter(
      (lead) => lead.followUpDate && new Date(lead.followUpDate).getTime() < now.getTime()
    );
    const outstandingInvoices = invoices.filter((invoice) => ['sent', 'overdue', 'partially-paid'].includes(invoice.status));
    const outstandingRevenue = outstandingInvoices.reduce(
      (sum, invoice) => sum + Math.max(0, getInvoiceEffectiveTotals(invoice, projectLookup).total - invoice.amountPaid),
      0
    );
    const paidRevenue = invoices
      .filter((invoice) => invoice.status === 'paid')
      .reduce((sum, invoice) => sum + getInvoiceEffectiveTotals(invoice, projectLookup).total, 0);

    const topAgents = reportData.agentPerformance
      .slice(0, 5)
      .map((agent, index) => `${index + 1}. ${agent.agentName}: ${formatCurrency(agent.revenue)} revenue, ${agent.dealsWon} deals won`);
    const funnelLines = reportData.funnel.map((row) => `${row.stage}: ${row.count}`);
    const packageLines = reportData.revenueByPackage
      .slice(0, 5)
      .map((row) => `${row.packageType}: ${formatCurrency(row.revenue)} from ${row.invoiceCount} paid invoice(s)`);
    const recentRevenueLines = reportData.revenueByMonth
      .slice(-3)
      .map((row) => `${row.month}: ${formatCurrency(row.revenue)} from ${row.invoiceCount} paid invoice(s)`);

    const body = [
      `Khulisa CRM Pipeline Summary`,
      `Generated: ${formatReportDate(now)}`,
      '',
      'Privacy scope:',
      '- Read-only export from the current Reports page.',
      '- Excludes passwords, payment details, and full client notes.',
      '',
      'Pipeline snapshot:',
      `- Total leads: ${leads.length}`,
      `- Open leads: ${openLeads.length}`,
      `- Won leads: ${reportData.funnel.find((row) => row.stage === 'Won')?.count || 0}`,
      `- Lost leads: ${reportData.funnel.find((row) => row.stage === 'Lost')?.count || 0}`,
      `- Win rate: ${reportData.winRate}%`,
      `- Loss rate: ${reportData.lossRate}%`,
      `- Active projects: ${activeProjects.length}`,
      `- Overdue projects: ${overdueProjects.length}`,
      `- Overdue lead follow-ups: ${overdueFollowUps.length}`,
      `- Outstanding invoices: ${outstandingInvoices.length}`,
      `- Paid revenue: ${formatCurrency(paidRevenue)}`,
      `- Outstanding invoice value: ${formatCurrency(outstandingRevenue)}`,
      '',
      'Lead funnel:',
      ...(funnelLines.length ? funnelLines : ['No funnel data yet.']),
      '',
      'Recent revenue:',
      ...(recentRevenueLines.length ? recentRevenueLines : ['No revenue data yet.']),
      '',
      'Revenue by service package:',
      ...(packageLines.length ? packageLines : ['No paid package revenue yet.']),
      '',
      'Agent performance:',
      ...(topAgents.length ? topAgents : ['No agent performance data yet.']),
    ].join('\n');

    const subject = `Khulisa CRM pipeline summary - ${formatReportDate(now)}`;
    window.location.href = `mailto:${OWNER_GMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    toast.success(`Pipeline summary ready for ${OWNER_GMAIL}.`);
  }, [invoices, leads, projectLookup, projects, reportData]);

  if (!isOwner) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader title="Reports" description="Business analytics and insights" />
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Only owners can access reports.</p>
            <Button variant="link" onClick={() => navigate('/')}>
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading && leads.length === 0 && projects.length === 0 && invoices.length === 0 && clients.length === 0 && activities.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader title="Reports" description="Business analytics and insights" />
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">Loading reports...</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Reports" description="Business analytics and insights">
        <Button variant="outline" onClick={handleExportPipelineSummary} disabled={isLoading || Boolean(loadError)}>
          <Mail className="mr-2 h-4 w-4" />
          Export pipeline summary
        </Button>
      </PageHeader>
      <OperationalReports />
      <div className="flex flex-wrap gap-4 rounded-lg border p-4"><div><Label htmlFor="report-start">Cash received from</Label><Input id="report-start" type="date" value={periodStart} max={periodEnd||undefined} onChange={e=>setPeriodStart(e.target.value)} /></div><div><Label htmlFor="report-end">Through</Label><Input id="report-end" type="date" value={periodEnd} min={periodStart||undefined} onChange={e=>setPeriodEnd(e.target.value)} /></div><p className="text-sm text-muted-foreground self-center">Cash charts use actual payment dates, including partial payments. Lead win rate uses closed leads. Other operational totals show all records.</p></div>
      {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm"><p>{loadError}</p><Button variant="outline" size="sm" onClick={() => setRetryKey((key) => key + 1)}>Try again</Button></div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cash Received by Month</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={reportData.revenueByMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickFormatter={(value) => `R${Math.round(value / 1000)}k`}
                  />
                  <Tooltip
                    itemStyle={{ color: 'hsl(var(--card-foreground))' }}
                    labelStyle={{ color: 'hsl(var(--card-foreground))' }}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      color: 'hsl(var(--card-foreground))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    formatter={(value: number, name: string) =>
                      name === 'revenue' ? [formatCurrency(value), 'Revenue'] : [value, 'Paid Invoices']
                    }
                  />
                  <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
                  <Line type="monotone" dataKey="revenue" name="revenue" stroke="hsl(var(--accent))" strokeWidth={3} />
                  <Line type="monotone" dataKey="invoiceCount" name="Payments" stroke="hsl(var(--chart-1))" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cash Received by Service Package</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reportData.revenueByPackage}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="packageType" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickFormatter={(value) => `R${Math.round(value / 1000)}k`}
                  />
                  <Tooltip
                    itemStyle={{ color: 'hsl(var(--card-foreground))' }}
                    labelStyle={{ color: 'hsl(var(--card-foreground))' }}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      color: 'hsl(var(--card-foreground))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    formatter={(value: number, name: string) =>
                      name === 'revenue' ? [formatCurrency(value), 'Revenue'] : [value, 'Paid Invoices']
                    }
                  />
                  <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
                  <Bar dataKey="revenue" name="revenue" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Lead Conversion Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Win Rate</p>
                <p className="text-xl font-bold text-success-text">{reportData.winRate}%</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Loss Rate</p>
                <p className="text-xl font-bold text-destructive-text">{reportData.lossRate}%</p>
              </div>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reportData.funnel}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="stage" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                  <Tooltip
                    itemStyle={{ color: 'hsl(var(--card-foreground))' }}
                    labelStyle={{ color: 'hsl(var(--card-foreground))' }}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      color: 'hsl(var(--card-foreground))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    formatter={(value: number) => [value, 'Leads']}
                  />
                  <Bar dataKey="count" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agent Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reportData.agentPerformance}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="agentName" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis
                    yAxisId="revenue"
                    orientation="left"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickFormatter={(value) => `R${Math.round(value / 1000)}k`}
                  />
                  <YAxis
                    yAxisId="deals"
                    orientation="right"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    allowDecimals={false}
                  />
                  <Tooltip
                    itemStyle={{ color: 'hsl(var(--card-foreground))' }}
                    labelStyle={{ color: 'hsl(var(--card-foreground))' }}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      color: 'hsl(var(--card-foreground))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    formatter={(value: number, name: string) =>
                      name === 'revenue' ? [formatCurrency(value), 'Revenue'] : [value, 'Deals Won']
                    }
                  />
                  <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
                  <Bar yAxisId="revenue" dataKey="revenue" name="revenue" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="deals" dataKey="dealsWon" name="dealsWon" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Cash Detail</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Payments Received</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.revenueByMonth.map((row) => (
                  <TableRow key={row.monthKey}>
                    <TableCell>{row.month}</TableCell>
                    <TableCell className="text-right">{row.invoiceCount}</TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(row.revenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agent Performance Detail</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Deals Won</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.agentPerformance.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                      No agent performance data yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  reportData.agentPerformance.map((agent) => (
                    <TableRow key={agent.agentId}>
                      <TableCell>{agent.agentName}</TableCell>
                      <TableCell className="text-right">{agent.dealsWon}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(agent.revenue)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lead Activity Report</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Assigned Agent</TableHead>
                <TableHead className="text-right">Activities</TableHead>
                <TableHead>Last Activity</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reportData.leadActivityReport.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    No leads or activities found.
                  </TableCell>
                </TableRow>
              ) : (
                reportData.leadActivityReport.map((row) => (
                  <TableRow key={row.leadId}>
                    <TableCell className="font-medium">{row.businessName}</TableCell>
                    <TableCell>{row.agentName}</TableCell>
                    <TableCell className="text-right">{row.activityCount}</TableCell>
                    <TableCell className="max-w-[360px] truncate">
                      {row.latestActivityDescription}
                      {row.latestActivityBy ? ` (${row.latestActivityBy})` : ''}
                    </TableCell>
                    <TableCell>
                      {row.latestActivityAt
                        ? new Date(row.latestActivityAt).toLocaleDateString('en-ZA', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => navigate(`/leads/${row.leadId}`)}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Invoice } from '@/types/models';
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

export function ReportsPage() {
  const navigate = useNavigate();
  const { isOwner } = useAuth();
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
        const [nextLeads, nextProjects, nextInvoices, nextClients, nextActivities] = await Promise.all([
          leadService.getAll(),
          projectService.getAll(),
          invoiceService.getAll(),
          clientService.getAll(),
          activityService.getAll(),
        ]);
        if (!isMounted) return;
        setLeads(nextLeads);
        setProjects(nextProjects);
        setInvoices(nextInvoices);
        setClients(nextClients);
        setActivities(nextActivities);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    void loadData();
    return () => {
      isMounted = false;
    };
  }, []);

  const users = authService.getAll();
  const projectLookup = useMemo(() => buildProjectLookup(projects), [projects]);

  const reportData = useMemo(() => {
    const getInvoiceAmount = (invoice: Invoice) => getInvoiceEffectiveTotals(invoice, projectLookup).total;
    const paidInvoices = invoices.filter((invoice) => invoice.status === 'paid');

    const revenueByMonthMap = paidInvoices.reduce((acc, invoice) => {
      const key = toMonthKey(getInvoiceIssueDate(invoice));
      if (!acc[key]) {
        acc[key] = { revenue: 0, invoiceCount: 0 };
      }
      acc[key].revenue += getInvoiceAmount(invoice);
      acc[key].invoiceCount += 1;
      return acc;
    }, {} as Record<string, { revenue: number; invoiceCount: number }>);

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
    const revenueByPackageMap = paidInvoices.reduce((acc, invoice) => {
      const packageKey = invoice.projectId ? projectById.get(invoice.projectId)?.packageId || 'unlinked' : 'unlinked';
      if (!acc[packageKey]) {
        acc[packageKey] = { revenue: 0, invoiceCount: 0 };
      }
      acc[packageKey].revenue += getInvoiceAmount(invoice);
      acc[packageKey].invoiceCount += 1;
      return acc;
    }, {} as Record<string, { revenue: number; invoiceCount: number }>);

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
    const winRate = Math.round((wonCount / totalLeads) * 100);
    const lossRate = Math.round((lostCount / totalLeads) * 100);

    const agentPerformance = users
      .filter((user) => user.role === 'agent')
      .map((agent) => {
        const agentLeadIds = new Set(leads.filter((lead) => lead.assignedTo === agent.id).map((lead) => lead.id));
        const agentProjectIds = new Set(projects.filter((project) => project.assignedTo === agent.id).map((project) => project.id));
        const agentClientIdsFromLeads = new Set(
          clients
            .filter((client) => !!client.leadId && agentLeadIds.has(client.leadId))
            .map((client) => client.id)
        );
        const revenue = paidInvoices.reduce((sum, invoice) => {
          const linkedByProject = !!invoice.projectId && agentProjectIds.has(invoice.projectId);
          const linkedByLeadClient = agentClientIdsFromLeads.has(invoice.clientId);
          return linkedByProject || linkedByLeadClient ? sum + getInvoiceAmount(invoice) : sum;
        }, 0);
        const dealsWon = leads.filter((lead) => lead.assignedTo === agent.id && lead.stage === 'won').length;
        return {
          agentId: agent.id,
          agentName: agent.name,
          revenue,
          dealsWon,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    const usersById = new Map(users.map((user) => [user.id, user]));
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
  }, [activities, clients, invoices, leads, projectLookup, projects, users]);

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
      <PageHeader title="Reports" description="Business analytics and insights" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Month</CardTitle>
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
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    formatter={(value: number, name: string) =>
                      name === 'revenue' ? [formatCurrency(value), 'Revenue'] : [value, 'Paid Invoices']
                    }
                  />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" name="revenue" stroke="hsl(var(--accent))" strokeWidth={3} />
                  <Line type="monotone" dataKey="invoiceCount" name="invoiceCount" stroke="hsl(var(--primary))" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revenue by Service Package</CardTitle>
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
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    formatter={(value: number, name: string) =>
                      name === 'revenue' ? [formatCurrency(value), 'Revenue'] : [value, 'Paid Invoices']
                    }
                  />
                  <Legend />
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
                <p className="text-xl font-bold text-success">{reportData.winRate}%</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Loss Rate</p>
                <p className="text-xl font-bold text-destructive">{reportData.lossRate}%</p>
              </div>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reportData.funnel}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="stage" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    formatter={(value: number) => [value, 'Leads']}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
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
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    formatter={(value: number, name: string) =>
                      name === 'revenue' ? [formatCurrency(value), 'Revenue'] : [value, 'Deals Won']
                    }
                  />
                  <Legend />
                  <Bar yAxisId="revenue" dataKey="revenue" name="revenue" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="deals" dataKey="dealsWon" name="dealsWon" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Revenue Detail</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Paid Invoices</TableHead>
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

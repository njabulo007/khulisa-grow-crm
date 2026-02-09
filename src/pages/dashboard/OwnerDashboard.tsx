import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DollarSign,
  FolderKanban,
  FileText,
  TrendingUp,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { KPICard, PageHeader, StatusBadge } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { buildProjectLookup, getInvoiceEffectiveTotals } from '@/lib/invoiceTotals';
import {
  authService,
  clientService,
  invoiceService,
  leadService,
  projectService,
} from '@/services';
import { Invoice, LEAD_STAGES, User } from '@/types/models';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';

const MONTH_WINDOW = 12;
const RECENT_INVOICE_LIMIT = 5;

type AgentPerformance = {
  id: string;
  name: string;
  dealsWon: number;
  revenue: number;
};

// Helper to format currency
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(amount);
};

const getInvoiceIssueDate = (invoice: Invoice): Date => {
  const value = (invoice as Invoice & { issueDate?: string }).issueDate || invoice.issuedDate;
  return new Date(value);
};

const toMonthKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export function OwnerDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [leads, setLeads] = useState<Awaited<ReturnType<typeof leadService.getAll>>>([]);
  const [clients, setClients] = useState<Awaited<ReturnType<typeof clientService.getAll>>>([]);
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof projectService.getAll>>>([]);
  const [invoices, setInvoices] = useState<Awaited<ReturnType<typeof invoiceService.getAll>>>([]);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      setIsLoading(true);
      try {
        const [nextLeads, nextClients, nextProjects, nextInvoices] = await Promise.all([
          leadService.getAll(),
          clientService.getAll(),
          projectService.getAll(),
          invoiceService.getAll(),
        ]);
        if (!isMounted) return;
        setLeads(nextLeads);
        setClients(nextClients);
        setProjects(nextProjects);
        setInvoices(nextInvoices);
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

  // Calculate KPIs
  const stats = useMemo(() => {
    const now = new Date();
    const currentMonthKey = toMonthKey(now);
    const previousMonthKey = toMonthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));

    // Revenue calculations
    const getInvoiceAmount = (invoice: Invoice) => getInvoiceEffectiveTotals(invoice, projectLookup).total;
    const paidInvoices = invoices.filter((invoice) => invoice.status === 'paid');
    const totalRevenue = paidInvoices.reduce((sum, invoice) => sum + getInvoiceAmount(invoice), 0);

    const paidRevenueByMonth = paidInvoices.reduce((acc, invoice) => {
      const key = toMonthKey(getInvoiceIssueDate(invoice));
      acc[key] = (acc[key] || 0) + getInvoiceAmount(invoice);
      return acc;
    }, {} as Record<string, number>);

    const monthlyRevenue = paidRevenueByMonth[currentMonthKey] || 0;
    const previousMonthRevenue = paidRevenueByMonth[previousMonthKey] || 0;
    const monthlyTrend =
      previousMonthRevenue === 0
        ? monthlyRevenue > 0
          ? 100
          : 0
        : Math.round(((monthlyRevenue - previousMonthRevenue) / previousMonthRevenue) * 100);

    // Outstanding
    const outstanding = invoices
      .filter((invoice) => invoice.status === 'sent' || invoice.status === 'overdue')
      .reduce((sum, invoice) => sum + getInvoiceAmount(invoice), 0);

    // Leads by stage
    const leadsByStage = leads.reduce((acc, lead) => {
      acc[lead.stage] = (acc[lead.stage] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Projects by status
    const activeProjects = projects.filter((project) => project.status !== 'completed' && project.status !== 'delivered');
    const overdueProjects = projects.filter((project) => {
      const dueDate = new Date(project.dueDate);
      return dueDate < now && project.status !== 'completed' && project.status !== 'delivered';
    });

    // Top agents by paid invoice revenue linked to their leads/projects
    const agentStats: AgentPerformance[] = users
      .filter((currentUser) => currentUser.role === 'agent')
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
          id: agent.id,
          name: agent.name,
          dealsWon,
          revenue,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    // Revenue trend (last 12 months, including months with zero values)
    const monthlyData = [];
    for (let i = MONTH_WINDOW - 1; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = toMonthKey(date);
      monthlyData.push({
        month: date.toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' }),
        revenue: paidRevenueByMonth[key] || 0,
      });
    }

    const recentInvoices = [...invoices]
      .sort((a, b) => getInvoiceIssueDate(b).getTime() - getInvoiceIssueDate(a).getTime())
      .slice(0, RECENT_INVOICE_LIMIT);

    return {
      totalRevenue,
      monthlyRevenue,
      monthlyTrend,
      outstanding,
      leadsByStage,
      activeProjects: activeProjects.length,
      overdueProjects: overdueProjects.length,
      totalClients: clients.length,
      agentStats,
      monthlyData,
      recentInvoices,
    };
  }, [clients, invoices, leads, projectLookup, projects, users]);

  const pipelineData = Object.entries(LEAD_STAGES).map(([key, value]) => ({
    name: value.label,
    count: stats.leadsByStage[key] || 0,
  }));

  if (isLoading && leads.length === 0 && clients.length === 0 && projects.length === 0 && invoices.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title={`Welcome back, ${user?.name?.split(' ')[0] || 'Owner'}!`}
          description="Here's what's happening with your business today."
        />
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">Loading dashboard...</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={`Welcome back, ${user?.name?.split(' ')[0] || 'Owner'}!`}
        description="Here's what's happening with your business today."
      />

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Total Revenue"
          value={formatCurrency(stats.totalRevenue)}
          subtitle="All time"
          icon={<DollarSign className="h-5 w-5" />}
          variant="gold"
        />
        <KPICard
          title="This Month"
          value={formatCurrency(stats.monthlyRevenue)}
          subtitle="Paid invoices issued this month"
          icon={<TrendingUp className="h-5 w-5" />}
          variant="blue"
          trend={{ value: stats.monthlyTrend, label: 'vs last month' }}
        />
        <KPICard
          title="Outstanding"
          value={formatCurrency(stats.outstanding)}
          subtitle="Sent + overdue invoices"
          icon={<Clock className="h-5 w-5" />}
          variant="warning"
        />
        <KPICard
          title="Active Projects"
          value={stats.activeProjects}
          subtitle={`${stats.overdueProjects} overdue`}
          icon={<FolderKanban className="h-5 w-5" />}
          variant={stats.overdueProjects > 0 ? 'warning' : 'success'}
        />
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Revenue Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Revenue Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis 
                    dataKey="month" 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                  />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickFormatter={(value) => `R${value / 1000}k`}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    formatter={(value: number) => [formatCurrency(value), 'Revenue']}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="hsl(var(--accent))" 
                    strokeWidth={3}
                    dot={{ fill: 'hsl(var(--accent))', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Lead Pipeline */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Lead Pipeline</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/leads')}>
              View All <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pipelineData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis 
                    type="category" 
                    dataKey="name" 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    width={100}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                  <Bar 
                    dataKey="count" 
                    fill="hsl(var(--primary))" 
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Top Agents */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Top Performing Agents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats.agentStats.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  No agent performance data available yet.
                </div>
              ) : (
                stats.agentStats.slice(0, 3).map((agent, index) => (
                  <div key={agent.id} className="flex items-center gap-3">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full ${
                        index === 0 ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      <span className="text-sm font-bold">{index + 1}</span>
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{agent.name}</p>
                      <p className="text-sm text-muted-foreground">{agent.dealsWon} deals won</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-accent">{formatCurrency(agent.revenue)}</p>
                      <p className="text-xs text-muted-foreground">paid revenue</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Invoices */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Recent Invoices</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/invoices')}>
              View All <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.recentInvoices.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  No invoices available yet. Create invoices to populate this list.
                </div>
              ) : (
                stats.recentInvoices.map((invoice) => {
                  const client = clients.find((item) => item.id === invoice.clientId);
                  return (
                    <div
                      key={invoice.id}
                      className="flex cursor-pointer items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50"
                      onClick={() => navigate(`/invoices/${invoice.id}`)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-medium">{invoice.invoiceNumber}</p>
                          <p className="text-sm text-muted-foreground">{client?.businessName || 'Unknown Client'}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{formatCurrency(getInvoiceEffectiveTotals(invoice, projectLookup).total)}</p>
                        <StatusBadge status={invoice.status} type="invoice" />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


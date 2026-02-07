import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DollarSign,
  Users,
  FolderKanban,
  FileText,
  TrendingUp,
  Clock,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { KPICard, PageHeader, StatusBadge } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import {
  leadStore,
  clientStore,
  projectStore,
  invoiceStore,
  paymentStore,
  commissionStore,
  userStore,
} from '@/store/mockStore';
import { Lead, Project, Invoice, Commission, User, LEAD_STAGES } from '@/types/models';
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

// Helper to format currency
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(amount);
};

export function OwnerDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Get all data
  const leads = leadStore.getAll();
  const clients = clientStore.getAll();
  const projects = projectStore.getAll();
  const invoices = invoiceStore.getAll();
  const payments = paymentStore.getAll();
  const commissions = commissionStore.getAll();
  const users = userStore.getAll();

  // Calculate KPIs
  const stats = useMemo(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Revenue calculations
    const paidInvoices = invoices.filter(i => i.status === 'paid');
    const totalRevenue = paidInvoices.reduce((sum, i) => sum + i.total, 0);
    
    const monthlyPayments = payments.filter(p => new Date(p.paidAt) >= startOfMonth);
    const monthlyRevenue = monthlyPayments.reduce((sum, p) => sum + p.amount, 0);

    // Outstanding
    const unpaidInvoices = invoices.filter(i => i.status !== 'paid' && i.status !== 'draft');
    const outstanding = unpaidInvoices.reduce((sum, i) => sum + (i.total - i.amountPaid), 0);

    // Leads by stage
    const leadsByStage = leads.reduce((acc, lead) => {
      acc[lead.stage] = (acc[lead.stage] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Projects by status
    const activeProjects = projects.filter(p => p.status === 'in-progress' || p.status === 'waiting-client');
    const overdueProjects = projects.filter(p => {
      const dueDate = new Date(p.dueDate);
      return dueDate < now && p.status !== 'delivered' && p.status !== 'on-hold';
    });

    // Top agents
    const agentStats = users
      .filter(u => u.role === 'agent')
      .map(agent => {
        const agentLeads = leads.filter(l => l.assignedTo === agent.id);
        const wonLeads = agentLeads.filter(l => l.stage === 'won');
        const agentCommissions = commissions.filter(c => c.agentId === agent.id && c.status === 'earned');
        const totalEarned = agentCommissions.reduce((sum, c) => sum + c.amount, 0);
        return {
          ...agent,
          dealsWon: wonLeads.length,
          revenue: totalEarned,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    // Monthly trend data (last 6 months)
    const monthlyData = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      const monthName = date.toLocaleDateString('en-ZA', { month: 'short' });
      
      const monthPayments = payments.filter(p => {
        const paidDate = new Date(p.paidAt);
        return paidDate >= date && paidDate <= monthEnd;
      });
      
      const monthLeadsWon = leads.filter(l => {
        const updatedDate = new Date(l.updatedAt);
        return l.stage === 'won' && updatedDate >= date && updatedDate <= monthEnd;
      });

      monthlyData.push({
        month: monthName,
        revenue: monthPayments.reduce((sum, p) => sum + p.amount, 0),
        leads: monthLeadsWon.length,
      });
    }

    return {
      totalRevenue,
      monthlyRevenue,
      outstanding,
      leadsByStage,
      activeProjects: activeProjects.length,
      overdueProjects: overdueProjects.length,
      totalClients: clients.length,
      agentStats,
      monthlyData,
      recentInvoices: invoices.slice(0, 5),
    };
  }, [leads, invoices, payments, projects, clients, commissions, users]);

  const pipelineData = Object.entries(LEAD_STAGES).map(([key, value]) => ({
    name: value.label,
    count: stats.leadsByStage[key] || 0,
  }));

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
          subtitle="Revenue collected"
          icon={<TrendingUp className="h-5 w-5" />}
          variant="blue"
          trend={{ value: 12, label: 'vs last month' }}
        />
        <KPICard
          title="Outstanding"
          value={formatCurrency(stats.outstanding)}
          subtitle="Unpaid invoices"
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
              {stats.agentStats.slice(0, 3).map((agent, index) => (
                <div key={agent.id} className="flex items-center gap-3">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                    index === 0 ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'
                  }`}>
                    <span className="text-sm font-bold">{index + 1}</span>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{agent.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {agent.dealsWon} deals won
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-accent">{formatCurrency(agent.revenue)}</p>
                    <p className="text-xs text-muted-foreground">earned</p>
                  </div>
                </div>
              ))}
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
              {stats.recentInvoices.map((invoice) => {
                const client = clientStore.getById(invoice.clientId);
                return (
                  <div
                    key={invoice.id}
                    className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50 cursor-pointer"
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
                      <p className="font-semibold">{formatCurrency(invoice.total)}</p>
                      <StatusBadge status={invoice.status} type="invoice" />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

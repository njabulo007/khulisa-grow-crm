import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Wallet,
  Users,
  Target,
  Clock,
  CheckCircle2,
  ArrowRight,
  AlertTriangle,
  TrendingUp,
} from 'lucide-react';
import { KPICard, PageHeader, StatusBadge } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/contexts/AuthContext';
import {
  clientService,
  commissionService,
  leadService,
  projectService,
  syncCommissionsFromInvoices,
} from '@/services';
import { LEAD_STAGES } from '@/types/models';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(amount);
};

export function AgentDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [clientsById, setClientsById] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<{
    activeLeads: Awaited<ReturnType<typeof leadService.getByAgent>>;
    wonLeads: Awaited<ReturnType<typeof leadService.getByAgent>>;
    overdueFollowUps: Awaited<ReturnType<typeof leadService.getByAgent>>;
    conversionRate: number;
    activeProjects: Awaited<ReturnType<typeof projectService.getByAgent>>;
    pendingAmount: number;
    earnedAmount: number;
    paidOutAmount: number;
    totalCommissions: number;
    leadsByStage: Record<string, number>;
    myLeads: Awaited<ReturnType<typeof leadService.getByAgent>>;
    myProjects: Awaited<ReturnType<typeof projectService.getByAgent>>;
  } | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      setIsLoading(true);
      if (!user) {
        setStats(null);
        setIsLoading(false);
        return;
      }

      try {
        const now = new Date();
        await syncCommissionsFromInvoices();
        const [myLeads, myProjects, myCommissions, allClients] = await Promise.all([
          leadService.getByAgent(user.id),
          projectService.getByAgent(user.id),
          commissionService.getByAgent(user.id),
          clientService.getAll(),
        ]);

        const activeLeads = myLeads.filter((lead) => lead.stage !== 'won' && lead.stage !== 'lost');
        const wonLeads = myLeads.filter((lead) => lead.stage === 'won');
        const lostLeads = myLeads.filter((lead) => lead.stage === 'lost');
        const overdueFollowUps = myLeads.filter((lead) => {
          if (!lead.followUpDate || lead.stage === 'won' || lead.stage === 'lost') return false;
          return new Date(lead.followUpDate) < now;
        });

        const totalClosedLeads = wonLeads.length + lostLeads.length;
        const conversionRate = totalClosedLeads > 0 ? Math.round((wonLeads.length / totalClosedLeads) * 100) : 0;
        const activeProjects = myProjects.filter(
          (project) => project.status === 'in-progress' || project.status === 'waiting-client'
        );

        const pendingCommissions = myCommissions.filter((commission) => commission.status === 'pending');
        const earnedCommissions = myCommissions.filter((commission) => commission.status === 'earned');
        const paidOutCommissions = myCommissions.filter((commission) => commission.status === 'paid-out');

        const pendingAmount = pendingCommissions.reduce((sum, commission) => sum + commission.commissionAmount, 0);
        const earnedAmount = earnedCommissions.reduce((sum, commission) => sum + commission.commissionAmount, 0);
        const paidOutAmount = paidOutCommissions.reduce((sum, commission) => sum + commission.commissionAmount, 0);

        const leadsByStage = myLeads.reduce((acc, lead) => {
          acc[lead.stage] = (acc[lead.stage] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        if (!isMounted) return;
        setClientsById(
          allClients.reduce<Record<string, string>>((acc, client) => {
            acc[client.id] = client.businessName;
            return acc;
          }, {})
        );
        setStats({
          activeLeads,
          wonLeads,
          overdueFollowUps,
          conversionRate,
          activeProjects,
          pendingAmount,
          earnedAmount,
          paidOutAmount,
          totalCommissions: pendingAmount + earnedAmount,
          leadsByStage,
          myLeads,
          myProjects,
        });
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
  }, [user]);

  if (isLoading && !stats) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title={`Hello, ${user?.name?.split(' ')[0] || 'Agent'}!`}
          description="Track your leads, commissions, and performance."
        />
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">Loading dashboard...</CardContent>
        </Card>
      </div>
    );
  }

  if (!stats) return null;

  const upcomingFollowUps = stats.activeLeads
    .filter(l => l.followUpDate)
    .sort((a, b) => new Date(a.followUpDate!).getTime() - new Date(b.followUpDate!).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={`Hello, ${user?.name?.split(' ')[0] || 'Agent'}!`}
        description="Track your leads, commissions, and performance."
      />

      {/* Commission KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Commission Earned"
          value={formatCurrency(stats.earnedAmount)}
          subtitle="Ready for payout"
          icon={<Wallet className="h-5 w-5" />}
          variant="gold"
        />
        <KPICard
          title="Commission Pending"
          value={formatCurrency(stats.pendingAmount)}
          subtitle="Awaiting payment"
          icon={<Clock className="h-5 w-5" />}
          variant="blue"
        />
        <KPICard
          title="Active Leads"
          value={stats.activeLeads.length}
          subtitle={`${stats.overdueFollowUps.length} need follow-up`}
          icon={<Users className="h-5 w-5" />}
          variant={stats.overdueFollowUps.length > 0 ? 'warning' : 'success'}
        />
        <KPICard
          title="Conversion Rate"
          value={`${stats.conversionRate}%`}
          subtitle={`${stats.wonLeads.length} deals won`}
          icon={<Target className="h-5 w-5" />}
          variant="success"
        />
      </div>

      {/* Overdue Follow-ups Alert */}
      {stats.overdueFollowUps.length > 0 && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="flex items-center gap-4 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/10">
              <AlertTriangle className="h-5 w-5 text-warning" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-foreground">
                You have {stats.overdueFollowUps.length} overdue follow-up{stats.overdueFollowUps.length > 1 ? 's' : ''}
              </p>
              <p className="text-sm text-muted-foreground">
                {stats.overdueFollowUps.map(l => l.businessName).join(', ')}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate('/leads')}>
              View Leads
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Main Content */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Lead Pipeline */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">My Lead Pipeline</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/leads')}>
              View All <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(LEAD_STAGES)
                .filter(([key]) => key !== 'won' && key !== 'lost')
                .map(([key, value]) => {
                  const count = stats.leadsByStage[key] || 0;
                  const total = stats.activeLeads.length || 1;
                  const percentage = Math.round((count / total) * 100);
                  
                  return (
                    <div key={key} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{value.label}</span>
                        <span className="font-medium">{count}</span>
                      </div>
                      <Progress value={percentage} className="h-2" />
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>

        {/* Upcoming Follow-ups */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Upcoming Follow-ups</CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingFollowUps.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No upcoming follow-ups scheduled
              </p>
            ) : (
              <div className="space-y-3">
                {upcomingFollowUps.map((lead) => {
                  const isOverdue = new Date(lead.followUpDate!) < new Date();
                  return (
                    <div
                      key={lead.id}
                      className={`flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50 cursor-pointer ${
                        isOverdue ? 'border-destructive/50 bg-destructive/5' : ''
                      }`}
                      onClick={() => navigate(`/leads/${lead.id}`)}
                    >
                      <div>
                        <p className="font-medium">{lead.businessName}</p>
                        <p className="text-sm text-muted-foreground">{lead.contactName}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-medium ${isOverdue ? 'text-destructive' : ''}`}>
                          {new Date(lead.followUpDate!).toLocaleDateString('en-ZA', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </p>
                        <StatusBadge status={lead.stage} type="lead" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Performance & Projects */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Performance Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Performance Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total Leads</span>
              <span className="font-semibold">{stats.myLeads.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Deals Won</span>
              <span className="font-semibold text-success">{stats.wonLeads.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Conversion Rate</span>
              <span className="font-semibold">{stats.conversionRate}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Active Projects</span>
              <span className="font-semibold">{stats.activeProjects.length}</span>
            </div>
            <div className="h-px bg-border" />
            <div className="flex items-center justify-between">
              <span className="font-medium">Total Earned</span>
              <span className="font-bold text-accent">{formatCurrency(stats.earnedAmount + stats.paidOutAmount)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Active Projects */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">My Active Projects</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/projects')}>
              View All <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {stats.activeProjects.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No active projects
              </p>
            ) : (
              <div className="space-y-3">
                {stats.activeProjects.slice(0, 4).map((project) => {
                  const clientName = clientsById[project.clientId];
                  const completedMilestones = project.milestones.filter(m => m.completed).length;
                  const progress = Math.round((completedMilestones / project.milestones.length) * 100);
                  const isOverdue = new Date(project.dueDate) < new Date() && project.status !== 'delivered';
                  
                  return (
                    <div
                      key={project.id}
                      className="rounded-lg border p-3 transition-colors hover:bg-muted/50 cursor-pointer"
                      onClick={() => navigate(`/projects/${project.id}`)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-medium">{project.name}</p>
                          <p className="text-sm text-muted-foreground">{clientName || 'Unknown client'}</p>
                        </div>
                        <StatusBadge status={project.status} type="project" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{completedMilestones}/{project.milestones.length} milestones</span>
                          <span className={isOverdue ? 'text-destructive' : ''}>
                            Due: {new Date(project.dueDate).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                        <Progress value={progress} className="h-1.5" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Calendar,
  CheckCircle2,
  Circle,
  Clock3,
  ExternalLink,
  FolderKanban,
  ListTodo,
  Target,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { projectShareService, type PublicProjectPortalData } from '@/services/projectShareService';
import { StatusBadge } from '@/components/common';
import { getPackageById, getPackageCombinedFeatures } from '@/config/packages';

const formatDate = (value: string | null): string => {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleDateString('en-ZA');
};

const formatDateTime = (value: string | null): string => {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

const formatCurrency = (amount: number | null | undefined): string => {
  if (typeof amount !== 'number' || Number.isNaN(amount)) return 'Not available';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const dueMessage = (dueRaw: string | null, completion: number): string => {
  if (!dueRaw) {
    return completion >= 100
      ? 'Project completion reached. Final review may still be pending.'
      : 'No due date has been set yet.';
  }

  const due = new Date(dueRaw);
  if (Number.isNaN(due.getTime())) {
    return 'Due date format unavailable.';
  }

  if (completion >= 100) {
    return 'Checklist completion is at 100%. Final handover checks in progress.';
  }

  const diff = Math.ceil((due.getTime() - Date.now()) / 86400000);
  if (diff < 0) return 'Project is overdue and requires immediate attention.';
  if (diff === 0) return 'Due today. Priority focus on final outstanding items.';
  if (diff <= 3) return 'Due soon. Complete outstanding milestones urgently.';
  return `Due in approximately ${diff} day${diff === 1 ? '' : 's'}.`;
};

export function ProjectPortalPage() {
  const { token } = useParams();
  const [data, setData] = useState<PublicProjectPortalData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;
    const loadPortal = async () => {
      if (!token) {
        setError('Invalid portal link.');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError('');
      try {
        const next = await projectShareService.resolve(token);
        if (!isMounted) return;
        setData(next);
      } catch (err) {
        if (!isMounted) return;
        const message = err instanceof Error ? err.message : 'This link is invalid or expired.';
        setError(message);
        setData(null);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    void loadPortal();
    return () => {
      isMounted = false;
    };
  }, [token]);

  const milestoneSummary = useMemo(() => {
    if (!data) return { total: 0, completed: 0, open: 0, progress: 0 };
    const total = data.project.milestones.length;
    const completed = data.project.milestones.filter((milestone) => milestone.isCompleted).length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    const open = Math.max(total - completed, 0);
    return { total, completed, open, progress };
  }, [data]);

  const openMilestones = useMemo(() => {
    if (!data) return [];
    return data.project.milestones.filter((milestone) => !milestone.isCompleted);
  }, [data]);

  const packageDetails = useMemo(() => {
    if (!data) return null;
    const pkg = getPackageById(data.project.packageId);
    if (!pkg) return null;
    const combinedFeatures = getPackageCombinedFeatures(pkg.id);
    return {
      ...pkg,
      combinedFeatures,
    };
  }, [data]);

  const projectPulse = useMemo(() => {
    if (!data) return 'Project status is being prepared.';
    return dueMessage(data.project.dueDate, milestoneSummary.progress);
  }, [data, milestoneSummary.progress]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-10 text-center text-muted-foreground">Loading project portal...</CardContent>
        </Card>
      </div>
    );
  }

  if (!data || error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Portal unavailable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">{error || 'This link is invalid or no longer active.'}</p>
            <p className="text-xs text-muted-foreground">Contact Khulisa Media if you need a new access link.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-4 py-8">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="space-y-4 bg-slate-950 text-slate-50">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Client Project Portal</p>
                <h1 className="text-2xl font-semibold tracking-tight">{data.project.name}</h1>
                <p className="text-sm text-slate-200">{data.client.businessName}</p>
              </div>
              <div className="rounded-lg bg-white/10 px-3 py-2">
                <StatusBadge status={data.project.status} type="project" />
              </div>
            </div>
            <p className="text-sm text-slate-200">{projectPulse}</p>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-white/20 bg-white/10 p-3">
                <p className="text-xs text-slate-300">Completion</p>
                <p className="text-lg font-semibold">{milestoneSummary.progress}%</p>
              </div>
              <div className="rounded-lg border border-white/20 bg-white/10 p-3">
                <p className="text-xs text-slate-300">Checklist Items</p>
                <p className="text-lg font-semibold">
                  {milestoneSummary.completed}/{milestoneSummary.total}
                </p>
              </div>
              <div className="rounded-lg border border-white/20 bg-white/10 p-3">
                <p className="text-xs text-slate-300">Open Work</p>
                <p className="text-lg font-semibold">{milestoneSummary.open}</p>
              </div>
              <div className="rounded-lg border border-white/20 bg-white/10 p-3">
                <p className="text-xs text-slate-300">Link Expires</p>
                <p className="text-sm font-medium">{formatDateTime(data.share.expiresAt)}</p>
              </div>
            </div>
          </CardHeader>
        </Card>

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="space-y-3">
                <CardTitle className="flex items-center gap-2 text-slate-900">
                  <TrendingUp className="h-5 w-5 text-emerald-600" />
                  Delivery Progress
                </CardTitle>
                <div className="space-y-2">
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${milestoneSummary.progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-500">
                    {milestoneSummary.progress}% complete across all checklist items
                  </p>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.project.milestones.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No milestones available yet.</p>
                ) : (
                  data.project.milestones.map((milestone) => (
                    <div key={milestone.id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                      <div className="pt-0.5">
                        {milestone.isCompleted ? (
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        ) : (
                          <Circle className="h-4 w-4 text-slate-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium ${milestone.isCompleted ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                          {milestone.title}
                        </p>
                        {milestone.description && (
                          <p className="text-xs text-slate-500">{milestone.description}</p>
                        )}
                        {milestone.completedAt && (
                          <p className="text-xs text-slate-500">
                            Completed {formatDate(milestone.completedAt)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-slate-900">
                  <ListTodo className="h-5 w-5 text-amber-600" />
                  Next Milestones
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {openMilestones.length === 0 ? (
                  <p className="text-sm text-slate-500">All checklist items are complete.</p>
                ) : (
                  openMilestones.slice(0, 6).map((milestone) => (
                    <div key={milestone.id} className="rounded-lg border border-slate-200 p-3">
                      <p className="text-sm font-medium text-slate-900">{milestone.title}</p>
                      {milestone.description && (
                        <p className="mt-1 text-xs text-slate-500">{milestone.description}</p>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {data.project.notes && (
              <Card className="border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-slate-900">Project Brief</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="whitespace-pre-wrap text-sm text-slate-600">{data.project.notes}</p>
                  {packageDetails?.outcome && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-emerald-700">Expected Outcome</p>
                      <p className="text-sm font-medium text-emerald-900">{packageDetails.outcome}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-slate-900">
                  <Target className="h-5 w-5 text-blue-600" />
                  Package Scope
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {packageDetails ? (
                  <>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">{packageDetails.name}</p>
                        {packageDetails.isMostPopular && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                            Most Popular
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">{packageDetails.tagline}</p>
                    </div>
                    <div className="flex items-end gap-2">
                      {typeof packageDetails.listPrice === 'number' && packageDetails.listPrice > packageDetails.price && (
                        <p className="text-sm text-slate-400 line-through">{formatCurrency(packageDetails.listPrice)}</p>
                      )}
                      <p className="text-xl font-bold text-slate-900">{formatCurrency(packageDetails.price)}</p>
                    </div>
                    {packageDetails.featureLeadIn && (
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        {packageDetails.featureLeadIn}
                      </p>
                    )}
                    <div className="space-y-2">
                      {packageDetails.combinedFeatures.map((feature) => (
                        <div key={feature} className="flex items-start gap-2 text-sm text-slate-700">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">Package details are not available for this project.</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-slate-900">
                  <Clock3 className="h-5 w-5 text-violet-600" />
                  Timeline
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <FolderKanban className="h-4 w-4 text-slate-500" />
                  <span>{data.project.packageName || 'Package not set'}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <Calendar className="h-4 w-4 text-slate-500" />
                  <span>Start: {formatDate(data.project.startDate)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <Calendar className="h-4 w-4 text-slate-500" />
                  <span>Due: {formatDate(data.project.dueDate)}</span>
                </div>
                <div className="text-xs text-slate-500">
                  Last updated: {formatDateTime(data.project.updatedAt)}
                </div>
              </CardContent>
            </Card>

            {data.project.driveLink && (
              <Card className="border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-slate-900">Project Files</CardTitle>
                </CardHeader>
                <CardContent>
                  <Button asChild className="w-full">
                    <a href={data.project.driveLink} target="_blank" rel="noreferrer">
                      Open Project Folder
                      <ExternalLink className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

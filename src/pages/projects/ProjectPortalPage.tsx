import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Calendar,
  CheckCircle2,
  Circle,
  Clock3,
  ExternalLink,
  FolderKanban,
  ImageIcon,
  ListTodo,
  Target,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { projectShareService, type PublicProjectPortalData } from '@/services/projectShareService';
import { StatusBadge } from '@/components/common';
import { getPackageById, getPackageCombinedFeatures } from '@/config/packages';

const AUTO_REFRESH_MS = 10 * 60 * 1000;

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

const formatSize = (sizeBytes: number | null): string => {
  if (typeof sizeBytes !== 'number' || Number.isNaN(sizeBytes) || sizeBytes < 0) return '';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
};

const isImageMedia = (mimeType: string | null, url: string): boolean => {
  const mime = (mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|svg|bmp|avif)$/i.test(url);
};

const normalizeChecklistText = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

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
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const loadPortal = async (silent = false) => {
      if (!token) {
        setError('Invalid portal link.');
        setIsLoading(false);
        return;
      }

      if (!silent) {
        setIsLoading(true);
      }
      setError('');
      try {
        const next = await projectShareService.resolve(token);
        if (!isMounted) return;
        setData(next);
        setLastSyncedAt(new Date().toISOString());
      } catch (err) {
        if (!isMounted) return;
        const message = err instanceof Error ? err.message : 'This link is invalid or expired.';
        setError(message);
        setData(null);
      } finally {
        if (isMounted && !silent) setIsLoading(false);
      }
    };

    void loadPortal(false);
    const intervalId = setInterval(() => {
      void loadPortal(true);
    }, AUTO_REFRESH_MS);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [token]);

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

  const scopedChecklist = useMemo(() => {
    if (!data) return [];

    const projectMilestones = Array.isArray(data.project.milestones) ? data.project.milestones : [];
    const normalizedMilestones = projectMilestones.map((milestone, index) => ({
      id: milestone.id || `m-${index + 1}`,
      title: milestone.title || `Milestone ${index + 1}`,
      description: milestone.description || null,
      isCompleted: milestone.isCompleted === true,
      completedAt: milestone.completedAt || null,
      key: normalizeChecklistText(milestone.title || ''),
    }));

    const scopeFeatures = packageDetails?.combinedFeatures || [];
    if (!scopeFeatures.length) {
      return normalizedMilestones.map((milestone) => ({
        id: milestone.id,
        title: milestone.title,
        description: milestone.description,
        isCompleted: milestone.isCompleted,
        completedAt: milestone.completedAt,
      }));
    }

    return scopeFeatures.map((feature, index) => {
      const featureKey = normalizeChecklistText(feature);
      const matchedMilestone = normalizedMilestones.find((milestone) => {
        if (!featureKey || !milestone.key) return false;
        return (
          milestone.key === featureKey ||
          milestone.key.includes(featureKey) ||
          featureKey.includes(milestone.key)
        );
      });

      return {
        id: matchedMilestone?.id || `scope-${index + 1}`,
        title: feature,
        description: matchedMilestone?.description || null,
        isCompleted: matchedMilestone?.isCompleted === true,
        completedAt: matchedMilestone?.completedAt || null,
      };
    });
  }, [data, packageDetails]);

  const milestoneSummary = useMemo(() => {
    const total = scopedChecklist.length;
    const completed = scopedChecklist.filter((milestone) => milestone.isCompleted).length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    const open = Math.max(total - completed, 0);
    return { total, completed, open, progress };
  }, [scopedChecklist]);

  const openMilestones = useMemo(() => scopedChecklist.filter((milestone) => !milestone.isCompleted), [scopedChecklist]);

  const portalMedia = useMemo(() => {
    if (!data) return [];
    return Array.isArray(data.share.media) ? data.share.media : [];
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
    <div className="min-h-screen bg-gradient-to-b from-amber-50/30 via-white to-slate-100 px-4 py-8 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <Card className="overflow-hidden border-border shadow-sm">
          <CardHeader className="space-y-4 border-t-4 border-amber-400 bg-slate-950 text-slate-50">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-amber-300/60">
                  <img src="/images/khulisa-logo-icon.png" alt="Khulisa Grow CRM" className="h-9 w-9 object-contain" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-300">Client Project Portal</p>
                  <h1 className="text-2xl font-semibold tracking-tight">{data.project.name}</h1>
                  <p className="text-sm text-slate-200">{data.client.businessName}</p>
                </div>
              </div>
              <div className="rounded-lg bg-white/10 px-3 py-2 ring-1 ring-amber-300/50">
                <StatusBadge status={data.project.status} type="project" />
              </div>
            </div>
            <p className="text-sm text-slate-200">{projectPulse}</p>
            <p className="text-xs text-slate-300">
              Auto-refreshes every 10 minutes. Last synced: {formatDateTime(lastSyncedAt)}
            </p>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-amber-300/40 bg-white/10 p-3">
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
            <Card className="border-border shadow-sm">
              <CardHeader className="space-y-3">
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <TrendingUp className="h-5 w-5 text-emerald-600" />
                  Delivery Progress
                </CardTitle>
                <div className="space-y-2">
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-emerald-500 to-amber-400 transition-all"
                      style={{ width: `${milestoneSummary.progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {milestoneSummary.progress}% complete across all checklist items
                  </p>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {scopedChecklist.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No milestones available yet.</p>
                ) : (
                  scopedChecklist.map((milestone) => (
                    <div key={milestone.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                      <div className="pt-0.5">
                        {milestone.isCompleted ? (
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium ${milestone.isCompleted ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                          {milestone.title}
                        </p>
                        {milestone.description && (
                          <p className="text-xs text-muted-foreground">{milestone.description}</p>
                        )}
                        {milestone.completedAt && (
                          <p className="text-xs text-muted-foreground">
                            Completed {formatDate(milestone.completedAt)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border-border shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <ListTodo className="h-5 w-5 text-amber-600" />
                  Next Milestones
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {openMilestones.length === 0 ? (
                  <p className="text-sm text-muted-foreground">All checklist items are complete.</p>
                ) : (
                  openMilestones.slice(0, 6).map((milestone) => (
                    <div key={milestone.id} className="rounded-lg border border-border p-3">
                      <p className="text-sm font-medium text-foreground">{milestone.title}</p>
                      {milestone.description && (
                        <p className="mt-1 text-xs text-muted-foreground">{milestone.description}</p>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {data.project.notes && (
              <Card className="border-border shadow-sm">
                <CardHeader>
                  <CardTitle className="text-foreground">Project Brief</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{data.project.notes}</p>
                  {packageDetails?.outcome && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-700/60 dark:bg-emerald-950/30">
                      <p className="text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Expected Outcome</p>
                      <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">{packageDetails.outcome}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="border-border shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <ImageIcon className="h-5 w-5 text-blue-600" />
                  Project Media
                </CardTitle>
              </CardHeader>
              <CardContent>
                {portalMedia.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No media has been shared for this portal yet.</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {portalMedia.map((media) => (
                      <a
                        key={media.id}
                        href={media.url}
                        target="_blank"
                        rel="noreferrer"
                        className="overflow-hidden rounded-lg border border-border transition hover:border-primary/50 hover:shadow-sm"
                      >
                        <div className="aspect-video bg-muted">
                          {isImageMedia(media.mimeType, media.url) ? (
                            <img src={media.url} alt={media.name} className="h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {media.mimeType ? media.mimeType.split('/')[0] : 'File'}
                            </div>
                          )}
                        </div>
                        <div className="space-y-1 p-3">
                          <p className="truncate text-sm font-medium text-foreground">{media.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Added {formatDateTime(media.createdAt)}
                            {formatSize(media.sizeBytes) ? ` | ${formatSize(media.sizeBytes)}` : ''}
                          </p>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="border-border shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <Target className="h-5 w-5 text-blue-600" />
                  Package Scope
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {packageDetails ? (
                  <>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground">{packageDetails.name}</p>
                        {packageDetails.isMostPopular && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                            Most Popular
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{packageDetails.tagline}</p>
                    </div>
                    <div className="flex items-end gap-2">
                      {typeof packageDetails.listPrice === 'number' && packageDetails.listPrice > packageDetails.price && (
                        <p className="text-sm text-muted-foreground line-through">{formatCurrency(packageDetails.listPrice)}</p>
                      )}
                      <p className="text-xl font-bold text-foreground">{formatCurrency(packageDetails.price)}</p>
                    </div>
                    {packageDetails.featureLeadIn && (
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {packageDetails.featureLeadIn}
                      </p>
                    )}
                    <div className="space-y-2">
                      {packageDetails.combinedFeatures.map((feature) => (
                        <div key={feature} className="flex items-start gap-2 text-sm text-foreground">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Package details are not available for this project.</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-border shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <Clock3 className="h-5 w-5 text-violet-600" />
                  Timeline
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <FolderKanban className="h-4 w-4 text-muted-foreground" />
                  <span>{data.project.packageName || 'Package not set'}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>Start: {formatDate(data.project.startDate)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>Due: {formatDate(data.project.dueDate)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Last updated: {formatDateTime(data.project.updatedAt)}
                </div>
              </CardContent>
            </Card>

            {data.project.driveLink && (
              <Card className="border-border shadow-sm">
                <CardHeader>
                  <CardTitle className="text-foreground">Project Files</CardTitle>
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

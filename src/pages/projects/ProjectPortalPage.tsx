import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  Calendar,
  CheckCircle2,
  Circle,
  Clock3,
  ExternalLink,
  FolderKanban,
  ImageIcon,
  ListTodo,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { projectShareService, type PublicProjectPortalData } from '@/services/projectShareService';
import { StatusBadge } from '@/components/common';
import { getPackageById, getPackageCombinedFeatures } from '@/config/packages';
import { cn } from '@/lib/utils';

const AUTO_REFRESH_MS = 10 * 60 * 1000;
const PORTAL_THEME_COLOR = '#f6f5f1';
const SURFACE_CARD_CLASS =
  'overflow-hidden border-slate-200 bg-white shadow-[0_24px_80px_-36px_rgba(15,23,42,0.24)] dark:border-slate-800 dark:bg-slate-950 dark:shadow-[0_24px_80px_-36px_rgba(0,0,0,0.72)]';

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

const summarizeDeadline = (dueRaw: string | null): string => {
  if (!dueRaw) return 'Timeline to be confirmed';

  const due = new Date(dueRaw);
  if (Number.isNaN(due.getTime())) {
    return 'Timeline unavailable';
  }

  const diff = Math.ceil((due.getTime() - Date.now()) / 86400000);
  if (diff < 0) return `${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'} overdue`;
  if (diff === 0) return 'Due today';
  if (diff === 1) return '1 day remaining';
  return `${diff} days remaining`;
};

const getProgressHeadline = (completion: number): string => {
  if (completion >= 100) return 'Ready for handover';
  if (completion >= 80) return 'Final polish underway';
  if (completion >= 45) return 'Delivery well underway';
  if (completion > 0) return 'Project foundations in motion';
  return 'Kickoff and planning stage';
};

const getMediaCategoryLabel = (mimeType: string | null, url: string): string => {
  const mime = (mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'Image';
  if (mime.startsWith('video/')) return 'Video';
  if (mime.includes('pdf')) return 'PDF';

  const extensionMatch = url.split('?')[0].match(/\.([a-z0-9]+)$/i);
  return extensionMatch ? extensionMatch[1].toUpperCase() : 'File';
};

interface PortalInfoCard {
  label: string;
  value: string;
  helper: string;
  icon: LucideIcon;
  iconClassName: string;
}

export function ProjectPortalPage() {
  const { token } = useParams();
  const [data, setData] = useState<PublicProjectPortalData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    const hadDark = root.classList.contains('dark');
    const hadLight = root.classList.contains('light');
    const previousColorScheme = root.style.colorScheme;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const previousThemeColor = themeMeta?.getAttribute('content') ?? null;

    root.classList.remove('dark');
    root.classList.add('light');
    root.style.colorScheme = 'light';
    themeMeta?.setAttribute('content', PORTAL_THEME_COLOR);

    return () => {
      root.classList.toggle('dark', hadDark);
      root.classList.toggle('light', hadLight);
      root.style.colorScheme = previousColorScheme;

      if (!themeMeta) return;
      if (previousThemeColor) {
        themeMeta.setAttribute('content', previousThemeColor);
      } else {
        themeMeta.removeAttribute('content');
      }
    };
  }, []);

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

  const recentCompletedMilestones = useMemo(
    () =>
      [...scopedChecklist]
        .filter((milestone) => milestone.isCompleted)
        .sort((a, b) => {
          const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
          const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
          return bTime - aTime;
        })
        .slice(0, 4),
    [scopedChecklist]
  );

  const portalMedia = useMemo(() => {
    if (!data) return [];
    return Array.isArray(data.share.media) ? data.share.media : [];
  }, [data]);

  const featuredMedia = useMemo(() => {
    const firstImage = portalMedia.find((media) => isImageMedia(media.mimeType, media.url));
    return firstImage || portalMedia[0] || null;
  }, [portalMedia]);

  const secondaryMedia = useMemo(() => {
    if (!featuredMedia) return [];
    return portalMedia.filter((media) => media.id !== featuredMedia.id);
  }, [featuredMedia, portalMedia]);

  const projectPulse = useMemo(() => {
    if (!data) return 'Project status is being prepared.';
    return dueMessage(data.project.dueDate, milestoneSummary.progress);
  }, [data, milestoneSummary.progress]);

  const progressRingStyle = useMemo<React.CSSProperties>(() => {
    const degrees = milestoneSummary.progress === 0 ? 0 : Math.max(milestoneSummary.progress, 4) * 3.6;
    return {
      background: `conic-gradient(from 220deg, rgba(251,191,36,0.96) 0deg, rgba(56,189,248,0.95) ${degrees}deg, rgba(148,163,184,0.16) ${degrees}deg 360deg)`,
    };
  }, [milestoneSummary.progress]);

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

  const progressHeadline = getProgressHeadline(milestoneSummary.progress);
  const deadlineSummary = summarizeDeadline(data.project.dueDate);
  const packageName = data.project.packageName || packageDetails?.name || 'Custom engagement';
  const hasBrief = Boolean(data.project.notes || packageDetails?.outcome);
  const clientInitials =
    data.client.businessName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'KM';

  const portalInfoCards: PortalInfoCard[] = [
    {
      label: 'Delivered',
      value: `${milestoneSummary.completed}/${milestoneSummary.total || 0}`,
      helper: 'scoped items completed',
      icon: CheckCircle2,
      iconClassName: 'text-emerald-200',
    },
    {
      label: 'Remaining',
      value: `${milestoneSummary.open}`,
      helper: milestoneSummary.open === 1 ? 'item still in production' : 'items still in production',
      icon: ListTodo,
      iconClassName: 'text-amber-200',
    },
    {
      label: 'Shared',
      value: `${portalMedia.length}`,
      helper: portalMedia.length === 1 ? 'media item available' : 'media items available',
      icon: ImageIcon,
      iconClassName: 'text-sky-200',
    },
  ];

  const timelineItems: PortalInfoCard[] = [
    {
      label: 'Project start',
      value: formatDate(data.project.startDate),
      helper: 'Initial kickoff and setup window',
      icon: Calendar,
      iconClassName: 'text-sky-600',
    },
    {
      label: 'Target completion',
      value: formatDate(data.project.dueDate),
      helper: deadlineSummary,
      icon: Target,
      iconClassName: 'text-amber-600',
    },
    {
      label: 'Last updated',
      value: formatDateTime(data.project.updatedAt),
      helper: 'Portal refreshes automatically every 10 minutes',
      icon: Clock3,
      iconClassName: 'text-violet-600',
    },
    {
      label: 'Portal access',
      value: formatDateTime(data.share.expiresAt),
      helper: 'Shared files and media remain available until this date',
      icon: ShieldCheck,
      iconClassName: 'text-emerald-600',
    },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f6f5f1] px-4 py-6 text-foreground dark:bg-slate-950 sm:px-6 lg:px-8">
      <div className="absolute inset-x-0 top-0 h-[24rem] bg-gradient-to-b from-amber-100/60 via-transparent to-transparent dark:from-amber-500/10" />
      <div className="absolute -left-16 top-24 h-64 w-64 rounded-full bg-amber-300/25 blur-3xl dark:bg-amber-500/10" />
      <div className="absolute -right-16 top-16 h-72 w-72 rounded-full bg-sky-300/25 blur-3xl dark:bg-sky-500/10" />

      <div className="mx-auto w-full max-w-7xl space-y-6 animate-fade-in">
        <section className="relative overflow-hidden rounded-[32px] border border-slate-900/90 bg-slate-950 text-white shadow-[0_30px_100px_-40px_rgba(15,23,42,0.9)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.24),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.22),transparent_36%)]" />
          <div className="absolute inset-y-0 right-0 hidden w-[38%] bg-gradient-to-l from-white/10 to-transparent lg:block" />

          <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.45fr_0.95fr] lg:p-10">
            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] bg-white/10 ring-1 ring-white/15 shadow-2xl">
                  <img src="/images/khulisa-logo-icon.png" alt="Khulisa Grow CRM" className="h-10 w-10 object-contain" />
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-100">
                      <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                      Khulisa Client Portal
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-100">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Secure live view
                    </span>
                  </div>
                  <div>
                    <h1 className="max-w-3xl text-3xl font-semibold leading-tight sm:text-4xl lg:text-5xl">
                      {data.project.name}
                    </h1>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200/90 sm:text-base">
                      A polished, real-time view of your project progress, milestones, shared media, and working files.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-sm font-semibold text-white ring-1 ring-white/10">
                    {clientInitials}
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300">Prepared for</p>
                    <p className="text-sm font-medium text-white">{data.client.businessName}</p>
                  </div>
                </div>
                <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-slate-100 backdrop-blur">
                  <FolderKanban className="h-4 w-4 text-amber-200" />
                  <span>{packageName}</span>
                </div>
                <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-slate-100 backdrop-blur">
                  <Clock3 className="h-4 w-4 text-sky-200" />
                  <span>Synced {formatDateTime(lastSyncedAt)}</span>
                </div>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-white/10 p-5 backdrop-blur">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-300">Project pulse</p>
                    <p className="mt-2 text-lg font-semibold text-white">{progressHeadline}</p>
                  </div>
                  <StatusBadge status={data.project.status} type="project" />
                </div>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-200">{projectPulse}</p>
              </div>

              <div className="flex flex-wrap gap-3">
                {data.project.driveLink && (
                  <Button
                    asChild
                    size="lg"
                    className="h-12 rounded-xl bg-accent px-6 text-accent-foreground shadow-gold hover:bg-accent/90"
                  >
                    <a href={data.project.driveLink} target="_blank" rel="noreferrer">
                      Open project folder
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                )}
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="h-12 rounded-xl border-white/15 bg-white/5 px-6 text-white hover:bg-white/10 hover:text-white"
                >
                  <a href="#portal-media">
                    View shared media
                    <ArrowRight className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            </div>

            <div className="space-y-4 lg:pl-4">
              <div className="rounded-[30px] border border-white/10 bg-white/10 p-5 backdrop-blur">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-3">
                    <p className="text-sm text-slate-300">Delivery status</p>
                    <div>
                      <p className="text-2xl font-semibold text-white">{progressHeadline}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-300">
                        {milestoneSummary.completed} of {milestoneSummary.total} scoped items are complete.
                      </p>
                    </div>
                  </div>
                  <div className="relative flex h-32 w-32 items-center justify-center rounded-full p-3" style={progressRingStyle}>
                    <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-slate-950/90 text-center ring-1 ring-white/10">
                      <span className="text-3xl font-semibold text-white">{milestoneSummary.progress}%</span>
                      <span className="text-[11px] uppercase tracking-[0.22em] text-slate-300">complete</span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {portalInfoCards.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.label}
                        className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/12 to-white/5 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs uppercase tracking-[0.22em] text-slate-300">{item.label}</p>
                          <Icon className={cn('h-4 w-4', item.iconClassName)} />
                        </div>
                        <p className="mt-3 text-2xl font-semibold text-white">{item.value}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-300">{item.helper}</p>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/30 px-4 py-3 text-sm text-slate-200">
                  <span className="inline-flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-300" />
                    Secure portal access
                  </span>
                  <span className="text-right text-xs sm:text-sm">{formatDateTime(data.share.expiresAt)}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="space-y-6">
            <Card className={cn(SURFACE_CARD_CLASS, 'card-hover')}>
              <CardHeader className="space-y-5 border-b border-slate-200/70 pb-6 dark:border-slate-800/70">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 rounded-full bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-primary">
                      <TrendingUp className="h-3.5 w-3.5" />
                      Delivery Progress
                    </div>
                    <CardTitle className="text-2xl text-foreground">Live milestone tracking</CardTitle>
                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      Follow each scoped deliverable as it moves from production to completion.
                    </p>
                  </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                      Current momentum
                    </p>
                    <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50">{progressHeadline}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{projectPulse}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <p className="font-medium text-foreground">{milestoneSummary.progress}% complete</p>
                    <p className="text-muted-foreground">
                      {milestoneSummary.completed} delivered and {milestoneSummary.open} remaining
                    </p>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-800/70">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-400 via-sky-500 to-emerald-500 transition-all"
                      style={{ width: `${milestoneSummary.progress}%` }}
                    />
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-6">
                {scopedChecklist.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-300/80 bg-slate-50/80 p-8 text-center dark:border-slate-700 dark:bg-slate-950/40">
                    <p className="text-lg font-medium text-foreground">Milestones will appear here soon.</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      As your project scope is updated, this portal will automatically reflect the latest delivery steps.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4 xl:grid-cols-2">
                    {scopedChecklist.map((milestone, index) => (
                      <div
                        key={milestone.id}
                        className={cn(
                          'group relative overflow-hidden rounded-[28px] border p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg',
                          milestone.isCompleted
                            ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800/70 dark:bg-emerald-950/35'
                            : 'border-slate-200 bg-white hover:border-sky-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-900'
                        )}
                      >
                        <div
                          className={cn(
                            'absolute inset-y-0 left-0 w-1',
                            milestone.isCompleted ? 'bg-gradient-to-b from-emerald-400 to-emerald-600' : 'bg-gradient-to-b from-amber-300 to-sky-500'
                          )}
                        />
                        <div className="flex items-start gap-4">
                          <div
                            className={cn(
                              'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
                              milestone.isCompleted
                                ? 'bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-200 dark:text-emerald-300 dark:ring-emerald-800/70'
                                : 'bg-slate-950 text-white dark:bg-slate-100 dark:text-slate-900'
                            )}
                          >
                            {milestone.isCompleted ? (
                              <CheckCircle2 className="h-5 w-5" />
                            ) : (
                              <span className="text-sm font-semibold">{index + 1}</span>
                            )}
                          </div>

                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold leading-6 text-foreground">{milestone.title}</p>
                              <span
                                className={cn(
                                  'rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide',
                                  milestone.isCompleted
                                    ? 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                                    : 'bg-amber-400/15 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                                )}
                              >
                                {milestone.isCompleted ? 'Delivered' : 'In progress'}
                              </span>
                            </div>

                            {milestone.description && (
                              <p className="text-sm leading-6 text-muted-foreground">{milestone.description}</p>
                            )}

                            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                              {milestone.completedAt ? `Completed ${formatDate(milestone.completedAt)}` : 'Awaiting completion'}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className={cn(SURFACE_CARD_CLASS, 'card-hover')}>
              <CardHeader className="space-y-3">
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <ListTodo className="h-5 w-5 text-amber-600" />
                  Delivery Snapshot
                </CardTitle>
                <p className="text-sm leading-6 text-muted-foreground">
                  A quick look at what is coming next and what has already been delivered.
                </p>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-5 dark:border-amber-800/60 dark:bg-amber-950/25">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300">
                      Up next
                    </p>
                    <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-slate-900/40 dark:text-amber-200">
                      {openMilestones.length}
                    </span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {openMilestones.length === 0 ? (
                      <p className="text-sm leading-6 text-muted-foreground">
                        Every scoped milestone is complete and the project is ready for final handover.
                      </p>
                    ) : (
                      openMilestones.slice(0, 4).map((milestone) => (
                        <div key={milestone.id} className="rounded-2xl border border-white bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                          <div className="flex items-start gap-3">
                            <Circle className="mt-0.5 h-4 w-4 text-amber-600" />
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-foreground">{milestone.title}</p>
                              {milestone.description && (
                                <p className="text-sm leading-6 text-muted-foreground">{milestone.description}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-800/60 dark:bg-emerald-950/25">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-300">
                      Recently delivered
                    </p>
                    <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-slate-900/40 dark:text-emerald-200">
                      {recentCompletedMilestones.length}
                    </span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {recentCompletedMilestones.length === 0 ? (
                      <p className="text-sm leading-6 text-muted-foreground">
                        Completed items will appear here as milestones are signed off.
                      </p>
                    ) : (
                      recentCompletedMilestones.map((milestone) => (
                        <div key={milestone.id} className="rounded-2xl border border-white bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                          <div className="flex items-start gap-3">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-foreground">{milestone.title}</p>
                              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                                {milestone.completedAt ? `Completed ${formatDate(milestone.completedAt)}` : 'Delivered'}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {hasBrief && (
              <section id="portal-brief">
                <Card className={cn(SURFACE_CARD_CLASS, 'card-hover')}>
                  <CardHeader className="space-y-3">
                    <CardTitle className="flex items-center gap-2 text-foreground">
                      <Sparkles className="h-5 w-5 text-amber-600" />
                      Project Brief
                    </CardTitle>
                    <p className="text-sm leading-6 text-muted-foreground">
                      A clear summary of the project intent and the expected end result.
                    </p>
                  </CardHeader>
                  <CardContent className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
                    <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900">
                      {data.project.notes ? (
                        <p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{data.project.notes}</p>
                      ) : (
                        <p className="text-sm leading-7 text-muted-foreground">
                          Project-specific briefing notes have not been shared yet.
                        </p>
                      )}
                    </div>

                    <div className="grid gap-4">
                      {packageDetails?.outcome && (
                        <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-800/60 dark:bg-emerald-950/30">
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-300">
                            Expected Outcome
                          </p>
                          <p className="mt-3 text-sm font-medium leading-7 text-emerald-900 dark:text-emerald-100">
                            {packageDetails.outcome}
                          </p>
                        </div>
                      )}

                      <div className="rounded-[28px] border border-sky-200 bg-sky-50 p-5 dark:border-sky-900/60 dark:bg-sky-950/30">
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700 dark:text-sky-300">
                          Package Alignment
                        </p>
                        <p className="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-50">{packageName}</p>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {packageDetails?.tagline || 'This project is being tracked against the agreed delivery scope and milestone plan.'}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}

            <section id="portal-media">
              <Card className={cn(SURFACE_CARD_CLASS, 'card-hover')}>
                <CardHeader className="space-y-3">
                  <CardTitle className="flex items-center gap-2 text-foreground">
                    <ImageIcon className="h-5 w-5 text-sky-600" />
                    Shared Media
                  </CardTitle>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Shared previews, reference files, and delivery assets appear here as they are uploaded.
                  </p>
                </CardHeader>
                <CardContent>
                  {portalMedia.length === 0 || !featuredMedia ? (
                    <div className="rounded-[30px] border border-dashed border-slate-300/80 bg-slate-50/80 p-8 text-center dark:border-slate-700 dark:bg-slate-950/40">
                      <p className="text-lg font-medium text-foreground">No media has been shared yet.</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        New visuals, documents, or supporting assets will appear here once they are added to the portal.
                      </p>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        'grid gap-4',
                        secondaryMedia.length > 0 ? 'lg:grid-cols-[1.15fr_0.85fr]' : 'grid-cols-1'
                      )}
                    >
                      <a
                        href={featuredMedia.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group relative overflow-hidden rounded-[30px] border border-slate-200/80 bg-slate-950 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-xl dark:border-slate-800"
                      >
                        <div className="aspect-[16/10]">
                          {isImageMedia(featuredMedia.mimeType, featuredMedia.url) ? (
                            <img
                              src={featuredMedia.url}
                              alt={featuredMedia.name}
                              className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.28),transparent_35%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(30,41,59,0.92))] px-6 text-center text-white">
                              <div className="space-y-3">
                                <span className="inline-flex rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-slate-100">
                                  {getMediaCategoryLabel(featuredMedia.mimeType, featuredMedia.url)}
                                </span>
                                <p className="text-xl font-semibold">{featuredMedia.name}</p>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent" />
                        <div className="absolute bottom-0 left-0 right-0 p-5">
                          <span className="inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-slate-100">
                            {getMediaCategoryLabel(featuredMedia.mimeType, featuredMedia.url)}
                          </span>
                          <p className="mt-3 text-xl font-semibold text-white">{featuredMedia.name}</p>
                          <p className="mt-1 text-sm text-slate-200">
                            Added {formatDateTime(featuredMedia.createdAt)}
                            {formatSize(featuredMedia.sizeBytes) ? ` | ${formatSize(featuredMedia.sizeBytes)}` : ''}
                          </p>
                        </div>
                      </a>

                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                        {secondaryMedia.length === 0 ? (
                          <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 p-6 dark:border-slate-700 dark:bg-slate-900">
                            <p className="text-sm font-semibold text-foreground">More files will appear here as they are shared.</p>
                            <p className="mt-2 text-sm leading-6 text-muted-foreground">
                              The portal refreshes automatically and keeps the latest client-facing assets in one place.
                            </p>
                          </div>
                        ) : (
                          secondaryMedia.map((media) => (
                            <a
                              key={media.id}
                              href={media.url}
                              target="_blank"
                              rel="noreferrer"
                              className="group overflow-hidden rounded-[26px] border border-slate-200 bg-white transition-all duration-300 hover:-translate-y-1 hover:border-sky-200 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-900"
                            >
                              <div className="aspect-video bg-slate-100 dark:bg-slate-900">
                                {isImageMedia(media.mimeType, media.url) ? (
                                  <img src={media.url} alt={media.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" />
                                ) : (
                                  <div className="flex h-full items-center justify-center px-4 text-center text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                                    {getMediaCategoryLabel(media.mimeType, media.url)}
                                  </div>
                                )}
                              </div>
                              <div className="space-y-2 p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <p className="line-clamp-2 text-sm font-semibold text-foreground">{media.name}</p>
                                  <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-primary" />
                                </div>
                                <p className="text-xs leading-5 text-muted-foreground">
                                  Added {formatDateTime(media.createdAt)}
                                  {formatSize(media.sizeBytes) ? ` | ${formatSize(media.sizeBytes)}` : ''}
                                </p>
                              </div>
                            </a>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </div>

          <div className="space-y-6">
            <Card className={cn(SURFACE_CARD_CLASS, 'card-hover')}>
              <CardHeader className="space-y-4 border-b border-slate-200/70 pb-6 dark:border-slate-800/70">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-3">
                    <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                      <Target className="h-3.5 w-3.5" />
                      Package Scope
                    </div>
                    <div>
                      <CardTitle className="text-2xl text-foreground">
                        {packageDetails ? packageDetails.name : packageName}
                      </CardTitle>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {packageDetails?.tagline || 'This portal reflects the project scope and milestones currently agreed for delivery.'}
                      </p>
                    </div>
                  </div>

                  {packageDetails?.isMostPopular && (
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                      Most Popular
                    </span>
                  )}
                </div>

                {packageDetails && (
                  <div className="flex flex-wrap items-end gap-2">
                    {typeof packageDetails.listPrice === 'number' && packageDetails.listPrice > packageDetails.price && (
                      <p className="text-sm text-muted-foreground line-through">{formatCurrency(packageDetails.listPrice)}</p>
                    )}
                    <p className="text-2xl font-bold text-foreground">{formatCurrency(packageDetails.price)}</p>
                  </div>
                )}
              </CardHeader>

              <CardContent className="space-y-4 pt-6">
                {packageDetails ? (
                  <>
                    {packageDetails.featureLeadIn && (
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                        {packageDetails.featureLeadIn}
                      </p>
                    )}
                    <div className="space-y-3">
                      {packageDetails.combinedFeatures.map((feature) => (
                        <div
                          key={feature}
                          className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900"
                        >
                          <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                          <span className="text-sm leading-6 text-foreground">{feature}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm leading-6 text-muted-foreground">
                    Package details are not available for this project yet, but this portal will continue tracking the milestone delivery plan.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className={cn(SURFACE_CARD_CLASS, 'card-hover')}>
              <CardHeader className="space-y-3">
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <Clock3 className="h-5 w-5 text-violet-600" />
                  Timeline
                </CardTitle>
                <p className="text-sm leading-6 text-muted-foreground">
                  The key dates and access details that keep this project moving forward.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-slate-100 dark:text-slate-900">
                      <FolderKanban className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Active package</p>
                      <p className="text-sm font-semibold text-foreground">{packageName}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  {timelineItems.map((item, index) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.label} className="relative flex gap-4 pl-1">
                        {index < timelineItems.length - 1 && (
                          <div className="absolute left-[1.15rem] top-11 h-[calc(100%-1.5rem)] w-px bg-slate-200 dark:bg-slate-800" />
                        )}
                        <div className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                          <Icon className={cn('h-4 w-4', item.iconClassName)} />
                        </div>
                        <div className="min-w-0 pb-2">
                          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{item.label}</p>
                          <p className="mt-1 text-sm font-semibold text-foreground">{item.value}</p>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.helper}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className={cn(SURFACE_CARD_CLASS, 'card-hover')}>
              <CardHeader className="space-y-3">
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <Building2 className="h-5 w-5 text-sky-600" />
                  Project Resources
                </CardTitle>
                <p className="text-sm leading-6 text-muted-foreground">
                  Your secure folder and portal access details stay available here for easy reference.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.project.driveLink ? (
                  <Button asChild size="lg" className="h-12 w-full rounded-xl bg-slate-950 text-white hover:bg-slate-900 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-200">
                    <a href={data.project.driveLink} target="_blank" rel="noreferrer">
                      Open project folder
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                ) : (
                  <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900">
                    <p className="text-sm font-semibold text-foreground">A shared project folder has not been linked yet.</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Once provided, the folder link will appear here for quick access to working files and source material.
                    </p>
                  </div>
                )}

                <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Portal notes</p>
                  <div className="mt-4 space-y-4 text-sm">
                    <div className="flex items-start gap-3">
                      <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-600" />
                      <p className="leading-6 text-muted-foreground">This portal is a secure client-facing link with live project visibility.</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <Clock3 className="mt-0.5 h-4 w-4 text-violet-600" />
                      <p className="leading-6 text-muted-foreground">Last synced at {formatDateTime(lastSyncedAt)} and refreshes automatically every 10 minutes.</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <Calendar className="mt-0.5 h-4 w-4 text-amber-600" />
                      <p className="leading-6 text-muted-foreground">Access remains available until {formatDateTime(data.share.expiresAt)}.</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

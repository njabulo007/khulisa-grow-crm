import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRef } from 'react';
import {
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  Copy,
  Circle,
  FolderKanban,
  Loader2,
  Link as LinkIcon,
  Trash2,
  Upload,
  User,
} from 'lucide-react';
import { PageHeader, StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getPackageById, getPackageCombinedFeatures, getPackageNameById } from '@/config/packages';
import { buildProjectLookup, getInvoiceEffectiveTotals } from '@/lib/invoiceTotals';
import {
  normalizeProjectMilestone,
} from '@/lib/projectMilestones';
import { authService, clientService, invoiceService, projectService } from '@/services';
import {
  projectShareService,
  type ProjectShareRecord,
  type ProjectShareStatus,
} from '@/services/projectShareService';
import { useAuth } from '@/contexts/AuthContext';
import { canAccessProject } from '@/lib/permissions';
import { Client, Invoice, Project, ProjectStatus, PROJECT_STATUSES } from '@/types/models';
import { toast } from 'sonner';

const OWNER_EDITABLE_STATUSES: ProjectStatus[] = ['not-started', 'in-progress', 'completed', 'on-hold'];
const MAX_PARALLEL_PORTAL_UPLOADS = 2;
const MAX_PORTAL_MEDIA_FILE_BYTES = 4 * 1024 * 1024;

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(amount);
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const getComputedShareStatus = (share: ProjectShareRecord): ProjectShareStatus => {
  if (share.status === 'revoked' || !!share.revokedAt) return 'revoked';
  if (share.status === 'expired') return 'expired';
  if (share.expiresAt && new Date(share.expiresAt).getTime() <= Date.now()) return 'expired';
  return 'active';
};

const normalizeChecklistText = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

interface OwnerScopedMilestone {
  id: string;
  title: string;
  description?: string;
  isCompleted: boolean;
  completedAt?: string;
  sourceMilestoneId: string | null;
}

const buildScopedMilestones = (
  milestones: ReturnType<typeof normalizeProjectMilestone>[],
  scopeFeatures: string[],
): OwnerScopedMilestone[] => {
  const normalizedMilestones = milestones.map((milestone, index) => ({
    id: milestone.id || `m-${index + 1}`,
    title: milestone.title || milestone.name || `Milestone ${index + 1}`,
    description: milestone.description,
    isCompleted: milestone.isCompleted === true,
    completedAt: milestone.completedAt,
    key: normalizeChecklistText(milestone.title || milestone.name || ''),
  }));

  if (!scopeFeatures.length) {
    return normalizedMilestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      description: milestone.description,
      isCompleted: milestone.isCompleted,
      completedAt: milestone.completedAt,
      sourceMilestoneId: milestone.id,
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
      description: matchedMilestone?.description,
      isCompleted: matchedMilestone?.isCompleted === true,
      completedAt: matchedMilestone?.completedAt,
      sourceMilestoneId: matchedMilestone?.id || null,
    };
  });
};

const getAutoProjectStatusFromScopedMilestones = (
  milestones: OwnerScopedMilestone[],
  fallbackStatus: ProjectStatus,
): ProjectStatus => {
  if (fallbackStatus === 'on-hold') return 'on-hold';
  if (milestones.length === 0) return fallbackStatus;

  const completedCount = milestones.filter((milestone) => milestone.isCompleted).length;
  if (completedCount === 0) return 'not-started';
  if (completedCount === milestones.length) return 'completed';
  return 'in-progress';
};

type UploadState = 'uploading' | 'done' | 'error';

interface UploadItem {
  id: string;
  name: string;
  progress: number;
  state: UploadState;
  message: string;
}

export function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isOwner } = useAuth();
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | undefined>(undefined);
  const [client, setClient] = useState<Client | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isSavingMilestones, setIsSavingMilestones] = useState(false);
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [shareExpiryDate, setShareExpiryDate] = useState(() =>
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
  const [portalShares, setPortalShares] = useState<ProjectShareRecord[]>([]);
  const [portalSharesError, setPortalSharesError] = useState<string | null>(null);
  const [isLoadingShares, setIsLoadingShares] = useState(false);
  const [isCreatingShare, setIsCreatingShare] = useState(false);
  const [isRevokingShareId, setIsRevokingShareId] = useState<string | null>(null);
  const [isUploadingPortalMedia, setIsUploadingPortalMedia] = useState(false);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [latestShareLink, setLatestShareLink] = useState<{ shareId: string; url: string } | null>(null);
  const portalMediaInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      const [projects, nextProject] = await Promise.all([
        projectService.getAll(),
        projectService.getById(id || ''),
      ]);
      if (!isMounted) return;
      setAllProjects(projects);
      setProject(nextProject);

      if (!nextProject) {
        setClient(null);
        setInvoices([]);
        return;
      }

      const [nextClient, allInvoices] = await Promise.all([
        clientService.getById(nextProject.clientId),
        invoiceService.getAll(),
      ]);
      if (!isMounted) return;
      setClient(nextClient || null);
      setInvoices(allInvoices.filter((invoice) => invoice.projectId === nextProject.id));
    };

    void loadData();
    return () => {
      isMounted = false;
    };
  }, [id]);

  const loadPortalShares = React.useCallback(
    async (projectId: string) => {
      if (!isOwner) return;
      setPortalSharesError(null);
      setIsLoadingShares(true);
      try {
        const shares = await projectShareService.list(projectId);
        setPortalShares(shares);
        setPortalSharesError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load share links.';
        setPortalSharesError(message);
      } finally {
        setIsLoadingShares(false);
      }
    },
    [isOwner]
  );

  useEffect(() => {
    if (!project || !isOwner) {
      setPortalShares([]);
      setPortalSharesError(null);
      setLatestShareLink(null);
      return;
    }
    void loadPortalShares(project.id);
  }, [isOwner, loadPortalShares, project]);

  const projectLookup = useMemo(() => buildProjectLookup(allProjects), [allProjects]);
  const agent = useMemo(() => (project ? authService.getById(project.assignedTo) : null), [project]);
  const packageDetails = useMemo(() => {
    if (!project) return null;
    const pkg = getPackageById(project.packageId);
    if (!pkg) return null;
    return {
      ...pkg,
      combinedFeatures: getPackageCombinedFeatures(pkg.id),
    };
  }, [project]);
  const portalShareHistory = useMemo(() => {
    return [...portalShares].sort((a, b) => {
      const aMs = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bMs = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bMs - aMs;
    });
  }, [portalShares]);
  const activePortalShare = useMemo(() => {
    return portalShareHistory.find((share) => getComputedShareStatus(share) === 'active') || null;
  }, [portalShareHistory]);
  const activePortalMedia = activePortalShare?.media || [];

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Project not found</p>
        <Button variant="link" onClick={() => navigate('/projects')}>
          Back to Projects
        </Button>
      </div>
    );
  }

  if (!canAccessProject(user, project)) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">You do not have permission to view this project.</p>
        <Button variant="link" onClick={() => navigate('/projects')}>
          Back to Projects
        </Button>
      </div>
    );
  }

  const milestones = project.milestones.map((milestone) => normalizeProjectMilestone(milestone));
  const scopeFeatures = packageDetails?.combinedFeatures || [];
  const ownerScopedMilestones = buildScopedMilestones(milestones, scopeFeatures);
  const completedMilestones = ownerScopedMilestones.filter((milestone) => milestone.isCompleted).length;
  const progress =
    ownerScopedMilestones.length > 0 ? Math.round((completedMilestones / ownerScopedMilestones.length) * 100) : 0;
  const totalInvoiced = invoices.reduce((sum, invoice) => sum + getInvoiceEffectiveTotals(invoice, projectLookup).total, 0);
  const totalPaid = invoices.reduce((sum, invoice) => sum + invoice.amountPaid, 0);

  const syncProjectState = (nextProject: Project) => {
    setProject(nextProject);
    setAllProjects((prev) => prev.map((entry) => (entry.id === nextProject.id ? nextProject : entry)));
  };

  const handleStatusChange = async (nextStatus: ProjectStatus) => {
    if (!isOwner) {
      toast.error('Only owners can change project status.');
      return;
    }

    setIsSavingStatus(true);
    try {
      const updated = await projectService.update(project.id, { status: nextStatus });
      if (!updated) {
        toast.error('Project status could not be updated.');
        return;
      }
      syncProjectState(updated);
      toast.success('Project status updated.');
    } finally {
      setIsSavingStatus(false);
    }
  };

  const handleMilestoneToggle = async (milestone: OwnerScopedMilestone, isCompleted: boolean) => {
    if (!isOwner) {
      toast.error('Only owners can update milestones.');
      return;
    }

    const nowIso = new Date().toISOString();
    const nextMilestones = milestones.map((entry) => {
      if (milestone.sourceMilestoneId && entry.id !== milestone.sourceMilestoneId) return entry;
      if (!milestone.sourceMilestoneId) return entry;
      return {
        ...entry,
        title: milestone.title,
        name: milestone.title,
        description: milestone.description ?? entry.description,
        isCompleted,
        completed: isCompleted,
        completedAt: isCompleted ? nowIso : undefined,
      };
    });

    if (!milestone.sourceMilestoneId) {
      nextMilestones.push({
        id: `ms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: milestone.title,
        name: milestone.title,
        description: milestone.description,
        isCompleted,
        completed: isCompleted,
        completedAt: isCompleted ? nowIso : undefined,
      });
    }

    const nextScopedMilestones = buildScopedMilestones(nextMilestones, scopeFeatures);
    const nextStatus = getAutoProjectStatusFromScopedMilestones(nextScopedMilestones, project.status);

    setIsSavingMilestones(true);
    try {
      const updated = await projectService.update(project.id, {
        milestones: nextMilestones,
        status: nextStatus,
      });
      if (!updated) {
        toast.error('Milestone update failed.');
        return;
      }
      syncProjectState(updated);
      toast.success('Milestone updated.');
    } finally {
      setIsSavingMilestones(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!isOwner) {
      toast.error('Only owners can delete projects.');
      return;
    }

    // Chosen approach: prevent deleting projects that still have linked invoices.
    if (invoices.length > 0) {
      toast.error('This project has invoices linked. Delete or detach those invoices first.');
      setShowDeleteDialog(false);
      return;
    }

    const removed = await projectService.remove(project.id);
    if (!removed) {
      toast.error('Project could not be deleted.');
      return;
    }

    toast.success('Project deleted successfully.');
    setShowDeleteDialog(false);
    navigate('/projects');
  };

  const handleCreatePortalLink = async () => {
    if (!isOwner) {
      toast.error('Only owners can generate client portal links.');
      return;
    }

    const expiresAt = `${shareExpiryDate}T23:59:59`;
    const parsed = new Date(expiresAt);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      toast.error('Choose a valid future expiry date.');
      return;
    }

    setIsCreatingShare(true);
    try {
      const created = await projectShareService.create(project.id, parsed.toISOString());
      setLatestShareLink({ shareId: created.shareId, url: created.url });
      await loadPortalShares(project.id);
      toast.success('Client portal link generated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create portal link.';
      toast.error(message);
    } finally {
      setIsCreatingShare(false);
    }
  };

  const handleRevokePortalLink = async (shareId: string) => {
    if (!isOwner) {
      toast.error('Only owners can revoke client portal links.');
      return;
    }

    setIsRevokingShareId(shareId);
    try {
      await projectShareService.revoke(shareId);
      if (latestShareLink?.shareId === shareId) {
        setLatestShareLink(null);
      }
      await loadPortalShares(project.id);
      toast.success('Portal link revoked.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to revoke portal link.';
      toast.error(message);
    } finally {
      setIsRevokingShareId(null);
    }
  };

  const handleCopyLatestPortalLink = async () => {
    if (!latestShareLink?.url) {
      toast.error('Generate a new link first, then copy it.');
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      toast.error('Clipboard is unavailable. Copy from the link field.');
      return;
    }

    try {
      await navigator.clipboard.writeText(latestShareLink.url);
      toast.success('Portal link copied.');
    } catch {
      toast.error('Could not copy link automatically. Please copy it manually from the field.');
    }
  };

  const handlePortalMediaUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!isOwner) {
      toast.error('Only owners can upload portal media.');
      return;
    }

    if (!activePortalShare) {
      toast.error('Generate an active portal link before uploading media.');
      event.target.value = '';
      return;
    }

    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (files.length === 0) {
      return;
    }

    const runId = Date.now();
    const acceptedFiles: Array<{ id: string; file: File }> = [];
    const rejectedQueue: UploadItem[] = [];

    files.forEach((file, index) => {
      const uploadId = `${runId}-${index}`;
      if (file.size > MAX_PORTAL_MEDIA_FILE_BYTES) {
        rejectedQueue.push({
          id: uploadId,
          name: file.name,
          progress: 0,
          state: 'error',
          message: 'Too large (max 4MB)',
        });
        return;
      }
      acceptedFiles.push({ id: uploadId, file });
    });

    const queue = acceptedFiles.map(({ id, file }) => ({
      id,
      name: file.name,
      progress: 2,
      state: 'uploading' as UploadState,
      message: 'Queued...',
    }));
    setUploadItems((prev) => [...queue, ...rejectedQueue, ...prev].slice(0, 30));

    if (acceptedFiles.length === 0) {
      toast.error('No files were uploaded. Max file size is 4MB.');
      return;
    }

    setIsUploadingPortalMedia(true);
    let uploadedCount = 0;
    let failedCount = rejectedQueue.length;

    const updateUploadItem = (uploadId: string, patch: Partial<UploadItem>) => {
      setUploadItems((prev) => prev.map((item) => (item.id === uploadId ? { ...item, ...patch } : item)));
    };

    try {
      let cursor = 0;
      const workerCount = Math.min(MAX_PARALLEL_PORTAL_UPLOADS, acceptedFiles.length);

      const runWorker = async () => {
        while (true) {
          const nextIndex = cursor;
          cursor += 1;
          if (nextIndex >= acceptedFiles.length) {
            return;
          }

          const { id: uploadId, file } = acceptedFiles[nextIndex];
          try {
            await projectShareService.addMedia(project.id, activePortalShare.id, file, {
              onStatusChange: (status) => {
                if (status === 'preparing') {
                  updateUploadItem(uploadId, {
                    state: 'uploading',
                    message: 'Optimizing...',
                    progress: 3,
                  });
                  return;
                }
                if (status === 'finalizing') {
                  updateUploadItem(uploadId, {
                    state: 'uploading',
                    message: 'Finalizing...',
                    progress: 97,
                  });
                  return;
                }
                if (status === 'slow-network') {
                  updateUploadItem(uploadId, {
                    state: 'uploading',
                    message: 'Slow network... still uploading',
                  });
                  return;
                }
                if (status === 'retrying') {
                  updateUploadItem(uploadId, {
                    state: 'uploading',
                    message: 'Retrying upload...',
                  });
                  return;
                }
                updateUploadItem(uploadId, {
                  state: 'uploading',
                  message: 'Uploading...',
                });
              },
              onProgress: (progress) => {
                updateUploadItem(uploadId, {
                  state: 'uploading',
                  message: 'Uploading...',
                  progress,
                });
              },
            });

            uploadedCount += 1;
            updateUploadItem(uploadId, {
              progress: 100,
              state: 'done',
              message: 'Uploaded',
            });
          } catch (error) {
            failedCount += 1;
            const message = error instanceof Error ? error.message : 'Upload failed.';
            updateUploadItem(uploadId, {
              state: 'error',
              message,
              progress: 0,
            });
          }
        }
      };

      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

      if (uploadedCount > 0) {
        void Promise.race([
          loadPortalShares(project.id),
          new Promise<void>((resolve) => {
            setTimeout(resolve, 12_000);
          }),
        ]).catch(() => {
          // Best-effort refresh only; upload completion should not block on this.
        });
      }

      if (uploadedCount > 0 && failedCount === 0) {
        toast.success(uploadedCount === 1 ? '1 media file uploaded to the portal.' : `${uploadedCount} media files uploaded.`);
      } else if (uploadedCount > 0 && failedCount > 0) {
        toast.error(`${uploadedCount} uploaded, ${failedCount} failed. See upload status below.`);
      } else {
        toast.error('Upload failed. See upload status below.');
      }
    } finally {
      setIsUploadingPortalMedia(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/projects')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <PageHeader title={project.name} description={getPackageNameById(project.packageId)} className="mb-0 flex-1">
          <div className="flex items-center gap-2">
            {isOwner && (
              <Button variant="destructive" size="sm" onClick={() => setShowDeleteDialog(true)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Project
              </Button>
            )}
            <StatusBadge status={project.status} type="project" />
          </div>
        </PageHeader>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Project Overview</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <FolderKanban className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Package</p>
                  <p className="font-medium">{getPackageNameById(project.packageId)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Client</p>
                  <p className="font-medium">{client?.businessName || 'Unknown client'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <User className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Assigned Agent</p>
                  <p className="font-medium">{agent?.name || 'Unassigned'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Due Date</p>
                  <p className="font-medium">{new Date(project.dueDate).toLocaleDateString('en-ZA')}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Milestones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!isOwner && (
                <p className="text-xs text-muted-foreground">Only owners can mark milestones as completed.</p>
              )}
              {ownerScopedMilestones.length === 0 ? (
                <p className="text-sm text-muted-foreground">No milestones added yet.</p>
              ) : (
                ownerScopedMilestones.map((milestone) => (
                  <div key={milestone.id} className="flex items-start gap-3 rounded-lg border p-3">
                    <div className="pt-0.5">
                      {isOwner ? (
                        <Checkbox
                          checked={milestone.isCompleted}
                          disabled={isSavingMilestones}
                          onCheckedChange={(checked) => {
                            void handleMilestoneToggle(milestone, checked === true);
                          }}
                        />
                      ) : milestone.isCompleted ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${milestone.isCompleted ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {milestone.title}
                      </p>
                      {milestone.description && (
                        <p className="text-xs text-muted-foreground">{milestone.description}</p>
                      )}
                      {milestone.completedAt && (
                        <p className="text-xs text-muted-foreground">
                          Completed {new Date(milestone.completedAt).toLocaleDateString('en-ZA')}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {project.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{project.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                {isOwner ? (
                  <Select value={project.status} onValueChange={(value) => void handleStatusChange(value as ProjectStatus)}>
                    <SelectTrigger disabled={isSavingStatus}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OWNER_EDITABLE_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {PROJECT_STATUSES[status].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <StatusBadge status={project.status} type="project" />
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Milestones Completed</p>
                <p className="text-2xl font-bold text-accent">
                  {completedMilestones}/{ownerScopedMilestones.length}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Completion</p>
                <p className="text-lg font-semibold">{progress}%</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Start Date</p>
                <p className="font-medium">{new Date(project.startDate).toLocaleDateString('en-ZA')}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{isOwner ? 'Billing' : 'Invoices'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Invoices</p>
                <p className="text-xl font-bold">{invoices.length}</p>
              </div>
              {isOwner && (
                <>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Invoiced</p>
                    <p className="font-semibold">{formatCurrency(totalInvoiced)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Paid</p>
                    <p className="font-semibold text-success">{formatCurrency(totalPaid)}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {isOwner && (
            <Card>
              <CardHeader>
                <CardTitle>Client Portal Link</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="portal-expiry-date">Link Expiry Date</Label>
                  <Input
                    id="portal-expiry-date"
                    type="date"
                    value={shareExpiryDate}
                    onChange={(event) => setShareExpiryDate(event.target.value)}
                    disabled={isCreatingShare}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button disabled={isCreatingShare} onClick={() => void handleCreatePortalLink()}>
                    {activePortalShare ? 'Regenerate Link' : 'Generate Link'}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!latestShareLink?.url}
                    onClick={() => void handleCopyLatestPortalLink()}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy Latest Link
                  </Button>
                </div>

                {latestShareLink?.url && (
                  <div className="grid gap-2">
                    <Label htmlFor="latest-portal-link">Latest Generated Link</Label>
                    <Input id="latest-portal-link" value={latestShareLink.url} readOnly />
                  </div>
                )}

                {portalSharesError ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                    {portalSharesError}
                  </div>
                ) : isLoadingShares ? (
                  <p className="text-sm text-muted-foreground">Loading portal link status...</p>
                ) : activePortalShare ? (
                  <div className="rounded-lg border p-3 space-y-3">
                    <p className="text-sm">
                      Active link expires: <span className="font-medium">{formatDateTime(activePortalShare.expiresAt)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Last viewed: {formatDateTime(activePortalShare.lastViewedAt)}
                    </p>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={isRevokingShareId === activePortalShare.id}
                      onClick={() => void handleRevokePortalLink(activePortalShare.id)}
                    >
                      Revoke Active Link
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No active client portal link.</p>
                )}

                {!isLoadingShares && !portalSharesError && (
                  <div className="space-y-2">
                    <div className="rounded-lg border p-3 space-y-3">
                      <p className="text-sm font-medium">Portal Media</p>
                      {activePortalShare ? (
                        <>
                          <input
                            ref={portalMediaInputRef}
                            type="file"
                            multiple
                            onChange={(event) => void handlePortalMediaUpload(event)}
                            disabled={isUploadingPortalMedia || isRevokingShareId === activePortalShare.id}
                            accept="image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt"
                            className="sr-only"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full sm:w-auto"
                            disabled={isUploadingPortalMedia || isRevokingShareId === activePortalShare.id}
                            onClick={() => portalMediaInputRef.current?.click()}
                          >
                            {isUploadingPortalMedia ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Uploading...
                              </>
                            ) : (
                              <>
                                <Upload className="mr-2 h-4 w-4" />
                                Upload files
                              </>
                            )}
                          </Button>
                          <div className="rounded-md border bg-muted/30 p-2 text-xs">
                            <p className="font-medium text-foreground">
                              {isUploadingPortalMedia ? (
                                <span className="inline-flex items-center gap-1">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Upload in progress...
                                </span>
                              ) : (
                                'Upload ready'
                              )}
                            </p>
                            <p className="text-muted-foreground">Select files above.</p>
                            <p className="text-muted-foreground">Max size: 4MB per file.</p>
                          </div>
                          {uploadItems.length > 0 && (
                            <div className="space-y-2">
                              {uploadItems.map((item) => (
                                <div key={item.id} className="rounded-md border p-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="truncate text-xs font-medium text-foreground">{item.name}</p>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-muted-foreground">{Math.round(item.progress)}%</span>
                                      <span
                                        className={`text-[11px] font-semibold ${
                                        item.state === 'done'
                                          ? 'text-success'
                                          : item.state === 'error'
                                            ? 'text-destructive'
                                            : 'text-amber-600'
                                        }`}
                                      >
                                        {item.message}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
                                    <div
                                      className={`h-full transition-all ${
                                        item.state === 'done'
                                          ? 'bg-success'
                                          : item.state === 'error'
                                            ? 'bg-destructive'
                                            : 'bg-amber-500'
                                      }`}
                                      style={{ width: `${Math.max(2, Math.min(100, item.progress))}%` }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Uploaded media appears in the client portal and is deleted automatically when this portal
                            link is revoked.
                          </p>
                          {activePortalMedia.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No media uploaded yet.</p>
                          ) : (
                            <div className="space-y-2">
                              {activePortalMedia.map((media) => (
                                <a
                                  key={media.id}
                                  href={media.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center justify-between gap-3 rounded-md border px-2 py-1.5 text-xs hover:bg-muted/50"
                                >
                                  <span className="truncate font-medium">{media.name}</span>
                                  <span className="shrink-0 text-muted-foreground">{formatDateTime(media.createdAt)}</span>
                                </a>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Generate an active client portal link before uploading project media.
                        </p>
                      )}
                    </div>

                    <p className="text-sm font-medium">Share History</p>
                    {portalShareHistory.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No portal links generated yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {portalShareHistory.map((share) => {
                          const computedStatus = getComputedShareStatus(share);
                          const isShareActive = computedStatus === 'active';
                          return (
                            <div key={share.id} className="rounded-lg border p-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs text-muted-foreground">
                                  Link ID: <span className="font-medium text-foreground">{share.id.slice(0, 8)}</span>
                                </p>
                                <span
                                  className={`text-xs font-medium uppercase ${
                                    computedStatus === 'active'
                                      ? 'text-success'
                                      : computedStatus === 'revoked'
                                        ? 'text-destructive'
                                        : 'text-muted-foreground'
                                  }`}
                                >
                                  {computedStatus}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground">Created: {formatDateTime(share.createdAt)}</p>
                              <p className="text-xs text-muted-foreground">Expires: {formatDateTime(share.expiresAt)}</p>
                              <p className="text-xs text-muted-foreground">Last viewed: {formatDateTime(share.lastViewedAt)}</p>
                              <p className="text-xs text-muted-foreground">
                                Media items: {Array.isArray(share.media) ? share.media.length : 0}
                              </p>
                              {share.revokedAt && (
                                <p className="text-xs text-muted-foreground">Revoked: {formatDateTime(share.revokedAt)}</p>
                              )}
                              {isShareActive && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={isRevokingShareId === share.id}
                                  onClick={() => void handleRevokePortalLink(share.id)}
                                >
                                  Revoke Link
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Owner-only control: agents cannot generate, revoke, or copy client portal links.
                </p>
              </CardContent>
            </Card>
          )}

          {project.driveLink && (
            <Card>
              <CardHeader>
                <CardTitle>Drive Link</CardTitle>
              </CardHeader>
              <CardContent>
                <a
                  href={project.driveLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                >
                  <LinkIcon className="h-4 w-4" />
                  Open Project Folder
                </a>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              Delete this project? This will not delete invoices or leads, but the project will be removed from the
              system.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDeleteProject()}>
              Delete Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

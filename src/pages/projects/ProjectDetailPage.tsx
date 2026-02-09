import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  Circle,
  FolderKanban,
  Link as LinkIcon,
  Trash2,
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
import { getPackageNameById } from '@/config/packages';
import { buildProjectLookup, getInvoiceEffectiveTotals } from '@/lib/invoiceTotals';
import {
  getAutoProjectStatusFromMilestones,
  normalizeProjectMilestone,
} from '@/lib/projectMilestones';
import { authService, clientService, invoiceService, projectService } from '@/services';
import { useAuth } from '@/contexts/AuthContext';
import { canAccessProject } from '@/lib/permissions';
import { Client, Invoice, Project, ProjectStatus, PROJECT_STATUSES } from '@/types/models';
import { toast } from 'sonner';

const OWNER_EDITABLE_STATUSES: ProjectStatus[] = ['not-started', 'in-progress', 'completed', 'on-hold'];

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(amount);
};

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

  const projectLookup = useMemo(() => buildProjectLookup(allProjects), [allProjects]);
  const agent = useMemo(() => (project ? authService.getById(project.assignedTo) : null), [project]);

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
  const completedMilestones = milestones.filter((milestone) => milestone.isCompleted).length;
  const progress = milestones.length > 0 ? Math.round((completedMilestones / milestones.length) * 100) : 0;
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

  const handleMilestoneToggle = async (milestoneId: string, isCompleted: boolean) => {
    if (!isOwner) {
      toast.error('Only owners can update milestones.');
      return;
    }

    const nextMilestones = milestones.map((milestone) => {
      if (milestone.id !== milestoneId) return milestone;
      return {
        ...milestone,
        isCompleted,
        completed: isCompleted,
        completedAt: isCompleted ? new Date().toISOString() : undefined,
      };
    });

    // Keep status automation intentionally simple:
    // none completed -> Not Started, some completed -> In Progress, all completed -> Completed.
    const nextStatus = getAutoProjectStatusFromMilestones(nextMilestones, project.status);

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
              {milestones.length === 0 ? (
                <p className="text-sm text-muted-foreground">No milestones added yet.</p>
              ) : (
                milestones.map((milestone) => (
                  <div key={milestone.id} className="flex items-start gap-3 rounded-lg border p-3">
                    <div className="pt-0.5">
                      {isOwner ? (
                        <Checkbox
                          checked={milestone.isCompleted}
                          disabled={isSavingMilestones}
                          onCheckedChange={(checked) => {
                            void handleMilestoneToggle(milestone.id, checked === true);
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
                        {milestone.title || milestone.name}
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
                  {completedMilestones}/{milestones.length}
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

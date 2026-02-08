import React, { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  Circle,
  FolderKanban,
  Link as LinkIcon,
  User,
} from 'lucide-react';
import { PageHeader, StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPackageNameById } from '@/config/packages';
import { buildProjectLookup, getInvoiceEffectiveTotals } from '@/lib/invoiceTotals';
import { authService, clientService, invoiceService, projectService } from '@/services';
import { useAuth } from '@/contexts/AuthContext';
import { canAccessProject } from '@/lib/permissions';

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

  const allProjects = projectService.getAll();
  const projectLookup = useMemo(() => buildProjectLookup(allProjects), [allProjects]);
  const project = useMemo(() => projectService.getById(id || ''), [id]);
  const client = useMemo(() => (project ? clientService.getById(project.clientId) : null), [project]);
  const agent = useMemo(() => (project ? authService.getById(project.assignedTo) : null), [project]);
  const invoices = useMemo(
    () => (project ? invoiceService.getAll().filter((invoice) => invoice.projectId === project.id) : []),
    [project]
  );

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

  const completedMilestones = project.milestones.filter((milestone) => milestone.completed).length;
  const progress = project.milestones.length > 0 ? Math.round((completedMilestones / project.milestones.length) * 100) : 0;
  const totalInvoiced = invoices.reduce((sum, invoice) => sum + getInvoiceEffectiveTotals(invoice, projectLookup).total, 0);
  const totalPaid = invoices.reduce((sum, invoice) => sum + invoice.amountPaid, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/projects')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <PageHeader title={project.name} description={getPackageNameById(project.packageId)} className="mb-0 flex-1">
          <StatusBadge status={project.status} type="project" />
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
              {project.milestones.length === 0 ? (
                <p className="text-sm text-muted-foreground">No milestones added yet.</p>
              ) : (
                project.milestones.map((milestone) => (
                  <div key={milestone.id} className="flex items-start gap-3 rounded-lg border p-3">
                    {milestone.completed ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
                    ) : (
                      <Circle className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${milestone.completed ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {milestone.name}
                      </p>
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
                <p className="text-sm text-muted-foreground">Milestones Completed</p>
                <p className="text-2xl font-bold text-accent">
                  {completedMilestones}/{project.milestones.length}
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
    </div>
  );
}

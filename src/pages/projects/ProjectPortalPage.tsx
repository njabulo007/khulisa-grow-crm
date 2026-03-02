import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Calendar, CheckCircle2, Circle, ExternalLink, FolderKanban } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { projectShareService, type PublicProjectPortalData } from '@/services/projectShareService';
import { StatusBadge } from '@/components/common';

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
    if (!data) return { total: 0, completed: 0, progress: 0 };
    const total = data.project.milestones.length;
    const completed = data.project.milestones.filter((milestone) => milestone.isCompleted).length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, progress };
  }, [data]);

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
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Client Project Portal</p>
                <h1 className="text-2xl font-semibold">{data.project.name}</h1>
                <p className="text-sm text-muted-foreground">{data.client.businessName}</p>
              </div>
              <StatusBadge status={data.project.status} type="project" />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Progress</p>
                <p className="text-lg font-semibold">{milestoneSummary.progress}%</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Milestones</p>
                <p className="text-lg font-semibold">
                  {milestoneSummary.completed}/{milestoneSummary.total}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Link Expires</p>
                <p className="text-sm font-medium">{formatDateTime(data.share.expiresAt)}</p>
              </div>
            </div>
          </CardHeader>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Milestones</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.project.milestones.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No milestones available yet.</p>
                ) : (
                  data.project.milestones.map((milestone) => (
                    <div key={milestone.id} className="flex items-start gap-3 rounded-lg border p-3">
                      <div className="pt-0.5">
                        {milestone.isCompleted ? (
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{milestone.title}</p>
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

            {data.project.notes && (
              <Card>
                <CardHeader>
                  <CardTitle>Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{data.project.notes}</p>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Project Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2 text-sm">
                  <FolderKanban className="h-4 w-4 text-muted-foreground" />
                  <span>{data.project.packageName || 'Package not set'}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>Start: {formatDate(data.project.startDate)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>Due: {formatDate(data.project.dueDate)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Last updated: {formatDateTime(data.project.updatedAt)}
                </div>
              </CardContent>
            </Card>

            {data.project.driveLink && (
              <Card>
                <CardHeader>
                  <CardTitle>Files</CardTitle>
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

import { paymentFollowUpToday } from '@/services/paymentFollowUpService';
import { loadLeadDetail } from '@/services/leadDetailService';
import { changeLeadStage, leadStageErrorMessage } from '@/services/leadStageService';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Calendar,
  DollarSign,
  Edit,
  Mail,
  MessageSquare,
  Phone,
  PhoneCall,
  Send,
  User,
} from 'lucide-react';
import { PageHeader, StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NoteEditor } from '@/components/common/NoteEditor';
import { LeadFollowUpPanel } from '@/components/common/LeadFollowUpPanel';
import { NoteContent } from '@/components/common/NoteContent';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { activityService, authService } from '@/services';
import { Activity, ActivityType, Lead, LeadStage, LEAD_STAGES, LEAD_SOURCES } from '@/types/models';
import { toast } from 'sonner';
import { canAccessLead } from '@/lib/permissions';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(amount);
};

const ACTIVITY_ICONS: Record<ActivityType, React.ReactNode> = {
  note: <MessageSquare className="h-4 w-4" />,
  call: <PhoneCall className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  whatsapp: <Send className="h-4 w-4" />,
  meeting: <User className="h-4 w-4" />,
  'status-change': <Edit className="h-4 w-4" />,
  payment: <DollarSign className="h-4 w-4" />,
};

export function LeadDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isOwner } = useAuth();
  const [lead, setLead] = useState<Lead | undefined>(undefined);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [newNote, setNewNote] = useState('');
  const [noteType, setNoteType] = useState<ActivityType>('note');
  const [isLoading, setIsLoading] = useState(true);
  const [isChangingStage, setIsChangingStage] = useState(false);
  const [isAddingActivity, setIsAddingActivity] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activityHistoryUnavailable, setActivityHistoryUnavailable] = useState(false);
  const [visibleActivityCount, setVisibleActivityCount] = useState(10);
  const latestLoad = useRef(0);
  const invalidateLoads = useCallback(() => { latestLoad.current++; }, []);

  const usersById = useMemo(() => {
    return authService.getAll().reduce<Record<string, { id: string; name: string }>>((acc, currentUser) => {
      acc[currentUser.id] = { id: currentUser.id, name: currentUser.name };
      return acc;
    }, {});
  }, []);

  const refreshLead = useCallback(async () => {
    const requestId = ++latestLoad.current;
    try {
      const data = await loadLeadDetail(id || '');
      if (requestId !== latestLoad.current) return;
      setLead(data.lead);
      setActivities(data.activities);
      setActivityHistoryUnavailable(data.activityHistoryUnavailable);
      setLoadError(null);
    } catch (error) {
      if (requestId !== latestLoad.current) return;
      console.error('[LeadDetail] Failed to load lead.', error);
      setLoadError(leadStageErrorMessage(error));
    } finally {
      if (requestId === latestLoad.current) setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLead(undefined);
    setActivities([]);
    setNewNote('');
    setVisibleActivityCount(10);
    setLoadError(null);
    setIsLoading(true);
    void refreshLead();
    return invalidateLoads;
  }, [refreshLead, invalidateLoads, user?.id, user?.uid, user?.role]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Loading lead...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p role="alert" className="text-destructive-text">{loadError}</p>
        <Button onClick={() => { void refreshLead(); }}>Retry</Button>
        <Button variant="link" onClick={() => navigate('/leads')}>Back to Leads</Button>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Lead not found</p>
        <Button variant="link" onClick={() => navigate('/leads')}>
          Back to Leads
        </Button>
      </div>
    );
  }

  if (!canAccessLead(user, lead)) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">You do not have permission to view this lead.</p>
        <Button variant="link" onClick={() => navigate('/leads')}>
          Back to Leads
        </Button>
      </div>
    );
  }

  const handleStageChange = async (newStage: LeadStage) => {
    if (isChangingStage || newStage === lead.stage) return;
    if (!canAccessLead(user, lead)) {
      toast.error('You do not have permission to update this lead');
      return;
    }
    setIsChangingStage(true);
    try {
      const result = await changeLeadStage(lead, newStage, user?.id || '');
      await refreshLead();
      toast.success(`Lead moved to ${LEAD_STAGES[newStage].label}`);
      if (!result.activitySaved) toast.warning('The lead was saved, but its activity log could not be recorded.');
    } catch (error) {
      toast.error(leadStageErrorMessage(error));
    } finally { setIsChangingStage(false); }
  };

  const handleAddActivity = async () => {
    if (isAddingActivity) return;
    if (!canAccessLead(user, lead)) {
      toast.error('You do not have permission to add activity for this lead');
      return;
    }
    if (!newNote.trim()) {
      toast.error('Please enter a note');
      return;
    }

    setIsAddingActivity(true);
    try {
      await activityService.create({
        type: noteType, entityType: 'lead', entityId: lead.id,
        description: newNote.trim(), createdBy: user?.id || '',
      });
      setNewNote('');
      toast.success('Activity added');
      await refreshLead();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Activity could not be saved. Please retry.');
    } finally {
      setIsAddingActivity(false);
    }
  };

  const agent = usersById[lead.assignedTo];
  const isOverdue = !['won', 'lost'].includes(lead.stage) && lead.followUpDate && lead.followUpDate.slice(0, 10) < paymentFollowUpToday();

  return (
    <div className="space-y-6 animate-fade-in">
      {activityHistoryUnavailable && (
        <p role="alert" className="rounded-lg border p-3 text-sm text-muted-foreground">
          Activity history could not be loaded. Lead details and status changes are still available.
          <Button variant="link" onClick={() => { void refreshLead(); }}>Retry history</Button>
        </p>
      )}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/leads')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <PageHeader
          title={lead.businessName}
          description={lead.contactName}
          className="mb-0 flex-1"
        >
          <StatusBadge status={lead.stage} type="lead" />
        </PageHeader>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <User className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Contact</p>
                  <p className="font-medium">{lead.contactName}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Business</p>
                  <p className="font-medium">{lead.businessName}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Phone className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Phone</p>
                  <a href={`tel:${lead.phone}`} className="font-medium text-primary-text hover:underline">
                    {lead.phone}
                  </a>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Mail className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <a href={`mailto:${lead.email}`} className="font-medium text-primary-text hover:underline">
                    {lead.email}
                  </a>
                </div>
              </div>
            </CardContent>
          </Card>

          {lead.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <NoteContent text={lead.notes} />
              </CardContent>
            </Card>
          )}

          <LeadFollowUpPanel key={lead.id} lead={lead} onSaved={refreshLead} />

          <Card>
            <CardHeader>
              <CardTitle>Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-6 space-y-3">
                <div className="space-y-3">
                  <Select value={noteType} onValueChange={(value) => setNoteType(value as ActivityType)}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="note">Note</SelectItem>
                      <SelectItem value="call">Call</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      <SelectItem value="meeting">Meeting</SelectItem>
                    </SelectContent>
                  </Select>
                  <NoteEditor
                    label="Lead activity notes"
                    placeholder="Add a note about this lead..."
                    value={newNote}
                    onChange={setNewNote}
                    disabled={isAddingActivity}
                  />
                </div>
                <Button
                  disabled={!newNote.trim() || isAddingActivity}
                  onClick={() => {
                    void handleAddActivity();
                  }}
                  className="w-full sm:w-auto"
                >
                  Add Activity
                </Button>
              </div>

              <div className="space-y-4">
                {activities.length === 0 ? (
                  <p className="py-4 text-center text-muted-foreground">
                    {activityHistoryUnavailable ? 'Activity history is unavailable.' : 'No activities yet'}
                  </p>
                ) : (
                  activities.slice(0, visibleActivityCount).map((activity) => {
                    const activityUser = usersById[activity.createdBy];
                    return (
                      <div key={activity.id} className="flex gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                          {ACTIVITY_ICONS[activity.type]}
                        </div>
                        <div className="min-w-0 flex-1">
                          {activity.metadata?.followUpCompleted === true && <p className="mb-2 text-sm font-medium text-primary-text">
                            Follow-up #{String(activity.metadata.followUpNumber)} completed · {activity.metadata.nextFollowUpDate ? `Next: ${String(activity.metadata.nextFollowUpDate)}` : 'No further follow-up scheduled'}
                          </p>}
                          <NoteContent text={activity.description} />
                          <p className="mt-1 text-xs text-muted-foreground">
                            {activityUser?.name || 'Unknown user'} |{' '}
                            {new Date(activity.createdAt).toLocaleDateString('en-ZA', {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              {activities.length > visibleActivityCount && (
                <Button className="mt-4" variant="outline" onClick={() => setVisibleActivityCount((count) => count + 10)}>
                  Show older activities ({activities.length - visibleActivityCount} remaining)
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Stage</CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={lead.stage}
                disabled={isChangingStage}
                onValueChange={(value) => {
                  void handleStageChange(value as LeadStage);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LEAD_STAGES).map(([key, value]) => (
                    <SelectItem key={key} value={key}>
                      {value.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isOwner && (
                <div>
                  <p className="text-sm text-muted-foreground">Estimated Value</p>
                  <p className="text-xl font-bold text-accent-text">{formatCurrency(lead.estimatedValue)}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground">Source</p>
                <p className="font-medium">{LEAD_SOURCES[lead.source]}</p>
              </div>
              {lead.followUpDate && (
                <div>
                  <p className="text-sm text-muted-foreground">Follow-up Date</p>
                  <p className={`font-medium ${isOverdue ? 'text-destructive-text' : ''}`}>
                    {new Date(lead.followUpDate).toLocaleDateString('en-ZA', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                    {isOverdue && ' (Overdue)'}
                  </p>
                </div>
              )}
              {agent && (
                <div>
                  <p className="text-sm text-muted-foreground">Assigned To</p>
                  <p className="font-medium">{agent.name}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground">Created</p>
                <p className="font-medium">
                  {new Date(lead.createdAt).toLocaleDateString('en-ZA', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
              </div>
            </CardContent>
          </Card>


        </div>
      </div>
    </div>
  );
}

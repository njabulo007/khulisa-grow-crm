import React, { useEffect, useMemo, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { activityService, authService, leadService } from '@/services';
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

  const usersById = useMemo(() => {
    return authService.getAll().reduce<Record<string, { id: string; name: string }>>((acc, currentUser) => {
      acc[currentUser.id] = { id: currentUser.id, name: currentUser.name };
      return acc;
    }, {});
  }, []);

  const refreshLead = async () => {
    const [nextLead, nextActivities] = await Promise.all([
      leadService.getById(id || ''),
      activityService.getByEntity('lead', id || ''),
    ]);
    setLead(nextLead);
    setActivities(nextActivities);
  };

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      setIsLoading(true);
      const [nextLead, nextActivities] = await Promise.all([
        leadService.getById(id || ''),
        activityService.getByEntity('lead', id || ''),
      ]);
      if (!isMounted) return;
      setLead(nextLead);
      setActivities(nextActivities);
      setIsLoading(false);
    };
    void loadData();
    return () => {
      isMounted = false;
    };
  }, [id]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Loading lead...</p>
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
    if (!canAccessLead(user, lead)) {
      toast.error('You do not have permission to update this lead');
      return;
    }
    await leadService.update(lead.id, { stage: newStage });

    await activityService.create({
      type: 'status-change',
      entityType: 'lead',
      entityId: lead.id,
      description: `Lead status changed from ${LEAD_STAGES[lead.stage].label} to ${LEAD_STAGES[newStage].label}`,
      metadata: { from: lead.stage, to: newStage },
      createdBy: user?.id || '',
    });

    await refreshLead();
    toast.success(`Lead moved to ${LEAD_STAGES[newStage].label}`);
  };

  const handleAddActivity = async () => {
    if (!canAccessLead(user, lead)) {
      toast.error('You do not have permission to add activity for this lead');
      return;
    }
    if (!newNote.trim()) {
      toast.error('Please enter a note');
      return;
    }

    await activityService.create({
      type: noteType,
      entityType: 'lead',
      entityId: lead.id,
      description: newNote,
      createdBy: user?.id || '',
    });

    await refreshLead();
    setNewNote('');
    toast.success('Activity added');
  };

  const agent = usersById[lead.assignedTo];
  const isOverdue = lead.followUpDate && new Date(lead.followUpDate) < new Date();

  return (
    <div className="space-y-6 animate-fade-in">
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
                  <a href={`tel:${lead.phone}`} className="font-medium text-primary hover:underline">
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
                  <a href={`mailto:${lead.email}`} className="font-medium text-primary hover:underline">
                    {lead.email}
                  </a>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-6 space-y-3">
                <div className="flex gap-2">
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
                  <Textarea
                    placeholder="Add a note about this lead..."
                    value={newNote}
                    onChange={(event) => setNewNote(event.target.value)}
                    className="flex-1 min-h-[80px]"
                  />
                </div>
                <Button
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
                  <p className="py-4 text-center text-muted-foreground">No activities yet</p>
                ) : (
                  activities.map((activity) => {
                    const activityUser = usersById[activity.createdBy];
                    return (
                      <div key={activity.id} className="flex gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                          {ACTIVITY_ICONS[activity.type]}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">{activity.description}</p>
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
                  <p className="text-xl font-bold text-accent">{formatCurrency(lead.estimatedValue)}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground">Source</p>
                <p className="font-medium">{LEAD_SOURCES[lead.source]}</p>
              </div>
              {lead.followUpDate && (
                <div>
                  <p className="text-sm text-muted-foreground">Follow-up Date</p>
                  <p className={`font-medium ${isOverdue ? 'text-destructive' : ''}`}>
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

          {lead.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{lead.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}


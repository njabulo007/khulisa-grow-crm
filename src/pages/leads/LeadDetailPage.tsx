import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Phone,
  Mail,
  Building2,
  Calendar,
  User,
  DollarSign,
  Edit,
  MessageSquare,
  PhoneCall,
  Send,
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
import { leadStore, userStore, activityStore } from '@/store/mockStore';
import { LeadStage, LEAD_STAGES, LEAD_SOURCES, ActivityType } from '@/types/models';
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
  const [newNote, setNewNote] = useState('');
  const [noteType, setNoteType] = useState<ActivityType>('note');

  const lead = useMemo(() => leadStore.getById(id || ''), [id]);
  const agent = useMemo(() => lead ? userStore.getById(lead.assignedTo) : null, [lead]);
  const activities = useMemo(() => 
    activityStore.getByEntity('lead', id || ''), [id]
  );

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

  const handleStageChange = (newStage: LeadStage) => {
    if (!canAccessLead(user, lead)) {
      toast.error('You do not have permission to update this lead');
      return;
    }
    leadStore.update(lead.id, { stage: newStage });
    
    activityStore.create({
      type: 'status-change',
      entityType: 'lead',
      entityId: lead.id,
      description: `Lead status changed from ${LEAD_STAGES[lead.stage].label} to ${LEAD_STAGES[newStage].label}`,
      metadata: { from: lead.stage, to: newStage },
      createdBy: user?.id || '',
    });

    toast.success(`Lead moved to ${LEAD_STAGES[newStage].label}`);
  };

  const handleAddActivity = () => {
    if (!canAccessLead(user, lead)) {
      toast.error('You do not have permission to add activity for this lead');
      return;
    }
    if (!newNote.trim()) {
      toast.error('Please enter a note');
      return;
    }

    activityStore.create({
      type: noteType,
      entityType: 'lead',
      entityId: lead.id,
      description: newNote,
      createdBy: user?.id || '',
    });

    setNewNote('');
    toast.success('Activity added');
  };

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
        {/* Lead Info */}
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

          {/* Activity Timeline */}
          <Card>
            <CardHeader>
              <CardTitle>Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Add Activity */}
              <div className="mb-6 space-y-3">
                <div className="flex gap-2">
                  <Select value={noteType} onValueChange={(v) => setNoteType(v as ActivityType)}>
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
                    onChange={(e) => setNewNote(e.target.value)}
                    className="flex-1 min-h-[80px]"
                  />
                </div>
                <Button onClick={handleAddActivity} className="w-full sm:w-auto">
                  Add Activity
                </Button>
              </div>

              {/* Timeline */}
              <div className="space-y-4">
                {activities.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">No activities yet</p>
                ) : (
                  activities.map((activity) => {
                    const activityUser = userStore.getById(activity.createdBy);
                    return (
                      <div key={activity.id} className="flex gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                          {ACTIVITY_ICONS[activity.type]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">{activity.description}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {activityUser?.name} • {new Date(activity.createdAt).toLocaleDateString('en-ZA', {
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

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Stage</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={lead.stage} onValueChange={handleStageChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LEAD_STAGES).map(([key, value]) => (
                    <SelectItem key={key} value={key}>{value.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Lead Details */}
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

          {/* Notes */}
          {lead.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{lead.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

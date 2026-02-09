import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  MoreHorizontal,
  Calendar,
  AlertCircle,
  Edit,
  Trash2,
  UserPlus,
  Eye,
} from 'lucide-react';
import { PageHeader, StatusBadge, EmptyState, ConfirmDialog } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { DEFAULT_PACKAGE_ID, KHULISA_PACKAGES, type PackageId } from '@/config/packages';
import { useAuth } from '@/contexts/AuthContext';
import { useLeads } from '@/hooks/useLeads';
import { activityService, AuthService, authService, clientService, generateId, projectService } from '@/services';
import { Lead, LeadStage, LeadSource, LEAD_STAGES, LEAD_SOURCES } from '@/types/models';
import { toast } from 'sonner';

const AGENT_SELECT_LOADING_VALUE = '__agents_loading__';
const AGENT_SELECT_EMPTY_VALUE = '__agents_empty__';
const AGENT_SELECT_CACHED_VALUE = '__agents_cached__';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(amount);
};

export function LeadsPage() {
  const navigate = useNavigate();
  const { user, isOwner } = useAuth();
  const { leads, isLoading: isLeadsLoading, createLead, updateLead, removeLead, getById: getLeadById } = useLeads();
  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    businessName: '',
    contactName: '',
    email: '',
    phone: '',
    source: 'facebook' as LeadSource,
    stage: 'new' as LeadStage,
    assignedTo: '',
    notes: '',
    estimatedValue: 0,
    followUpDate: '',
  });

  const [convertData, setConvertData] = useState({
    projectName: '',
    packageId: DEFAULT_PACKAGE_ID as PackageId,
    createProject: true,
    location: '',
    industry: '',
  });

  const [agents, setAgents] = useState<Array<{ id: string; name: string; email: string }>>(() =>
    authService
      .getAll()
      .filter((candidate) => candidate.role === 'agent' && candidate.isActive !== false)
      .map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        email: candidate.email.trim().toLowerCase(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  );
  const [isAgentsLoading, setIsAgentsLoading] = useState(true);
  const [agentsLoadError, setAgentsLoadError] = useState<string | null>(null);
  const hasShownAgentsLoadError = useRef(false);

  useEffect(() => {
    let isMounted = true;

    const loadAgents = async () => {
      const localAgents = authService
        .getAll()
        .filter((candidate) => candidate.role === 'agent' && candidate.isActive !== false)
        .map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          email: candidate.email.trim().toLowerCase(),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      if (isMounted) {
        setIsAgentsLoading(true);
        setAgentsLoadError(null);
      }

      try {
        const localByEmail = new Map(localAgents.map((candidate) => [candidate.email, candidate]));
        const profiles = await AuthService.listUserProfiles();
        const profileAgents = profiles
          .filter((profile) => profile.role === 'agent')
          .map((profile) => {
            const normalizedEmail = profile.email.trim().toLowerCase();
            const localMatch = localByEmail.get(normalizedEmail);
            const resolvedName =
              profile.displayName ||
              localMatch?.name ||
              normalizedEmail.split('@')[0] ||
              'Agent';
            return {
              id: profile.id,
              name: resolvedName,
              email: normalizedEmail,
            };
          });

        const mergedById = new Map<string, { id: string; name: string; email: string }>();
        [...localAgents, ...profileAgents].forEach((candidate) => {
          mergedById.set(candidate.id, candidate);
        });

        if (!isMounted) return;
        setAgents(
          Array.from(mergedById.values()).sort((a, b) => a.name.localeCompare(b.name))
        );
      } catch (error) {
        console.error('[LeadsPage] Failed to refresh agent profiles; falling back to cached agents.', error);
        if (!isMounted) return;
        setAgents(localAgents);
        setAgentsLoadError('Could not refresh agent list. Showing cached agents.');
        if (!hasShownAgentsLoadError.current) {
          toast.error('Could not refresh agent list. Showing cached agents.');
          hasShownAgentsLoadError.current = true;
        }
      } finally {
        if (!isMounted) return;
        setIsAgentsLoading(false);
      }
    };

    void loadAgents();

    return () => {
      isMounted = false;
    };
  }, [showAddDialog, user?.id]);

  const agentsById = useMemo(() => {
    const next = new Map<string, { id: string; name: string; email: string }>();
    agents.forEach((candidate) => next.set(candidate.id, candidate));
    return next;
  }, [agents]);

  // Filter leads based on role
  const allLeads = useMemo(() => {
    if (isOwner) return leads;
    return leads.filter(l => l.assignedTo === user?.id);
  }, [isOwner, leads, user]);

  // Apply filters
  const filteredLeads = useMemo(() => {
    return allLeads.filter(lead => {
      const matchesSearch = 
        lead.businessName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.contactName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.email.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesStage = stageFilter === 'all' || lead.stage === stageFilter;
      const matchesSource = sourceFilter === 'all' || lead.source === sourceFilter;

      return matchesSearch && matchesStage && matchesSource;
    });
  }, [allLeads, searchQuery, stageFilter, sourceFilter]);

  // Group leads by stage for Kanban view
  const leadsByStage = useMemo(() => {
    const grouped: Record<LeadStage, Lead[]> = {
      new: [],
      contacted: [],
      proposal: [],
      negotiation: [],
      won: [],
      lost: [],
    };
    filteredLeads.forEach(lead => {
      grouped[lead.stage].push(lead);
    });
    return grouped;
  }, [filteredLeads]);

  const canManageLead = (lead: Lead): boolean => {
    if (isOwner) return true;
    return !!user && lead.assignedTo === user.id;
  };

  const handleSubmit = async () => {
    if (!formData.businessName || !formData.contactName) {
      toast.error('Please fill in required fields');
      return;
    }

    if (selectedLead) {
      if (!canManageLead(selectedLead)) {
        toast.error('You do not have permission to update this lead');
        return;
      }
      await updateLead(selectedLead.id, formData);
      toast.success('Lead updated successfully');
    } else {
      await createLead({
        ...formData,
        assignedTo: formData.assignedTo || user?.id || '',
        createdBy: user?.id || '',
      });
      toast.success('Lead created successfully');
    }

    setShowAddDialog(false);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    const lead = await getLeadById(id);
    if (!lead || !canManageLead(lead)) {
      toast.error('You do not have permission to delete this lead');
      return;
    }
    await removeLead(id);
    toast.success('Lead deleted');
    setDeleteConfirm(null);
  };

  const handleStageChange = async (leadId: string, newStage: LeadStage) => {
    const lead = await getLeadById(leadId);
    if (!lead) return;
    if (!canManageLead(lead)) {
      toast.error('You do not have permission to update this lead');
      return;
    }

    await updateLead(leadId, { stage: newStage });
    
    await activityService.create({
      type: 'status-change',
      entityType: 'lead',
      entityId: leadId,
      description: `Lead status changed from ${LEAD_STAGES[lead.stage].label} to ${LEAD_STAGES[newStage].label}`,
      metadata: { from: lead.stage, to: newStage },
      createdBy: user?.id || '',
    });

    toast.success(`Lead moved to ${LEAD_STAGES[newStage].label}`);

    if (newStage === 'won' && !lead.clientId) {
      setSelectedLead({ ...lead, stage: 'won' });
      setConvertData({
        projectName: `${lead.businessName} - Website`,
        packageId: DEFAULT_PACKAGE_ID,
        createProject: true,
        location: '',
        industry: '',
      });
      setShowConvertDialog(true);
    }
  };

  const handleConvert = async () => {
    if (!selectedLead) {
      toast.error('No lead selected for conversion');
      return;
    }
    if (!canManageLead(selectedLead)) {
      toast.error('You do not have permission to convert this lead');
      return;
    }
    if (convertData.createProject && !convertData.projectName.trim()) {
      toast.error('Please provide a project name or uncheck project creation');
      return;
    }

    // Create client
    const client = await clientService.create({
      businessName: selectedLead.businessName,
      ownerName: selectedLead.contactName,
      email: selectedLead.email,
      phone: selectedLead.phone,
      location: convertData.location,
      industry: convertData.industry,
      contractSigned: false,
      onboardingCompleted: false,
      leadId: selectedLead.id,
      createdBy: user?.id || '',
    });

    if (convertData.createProject) {
      // Create project
      await projectService.create({
        name: convertData.projectName,
        clientId: client.id,
        packageId: convertData.packageId,
        status: 'not-started',
        milestones: [
          { id: generateId(), name: 'Kickoff meeting', completed: false },
          { id: generateId(), name: 'Requirements gathering', completed: false },
          { id: generateId(), name: 'Delivery', completed: false },
        ],
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        startDate: new Date().toISOString(),
        assignedTo: selectedLead.assignedTo,
        notes: '',
        createdBy: user?.id || '',
      });
    }

    // Link lead and mark won
    await updateLead(selectedLead.id, { stage: 'won', clientId: client.id });

    toast.success(convertData.createProject ? 'Lead converted to client and project.' : 'Lead converted to client.');
    setShowConvertDialog(false);
    setSelectedLead(null);
    navigate('/clients');
  };

  const resetForm = () => {
    setFormData({
      businessName: '',
      contactName: '',
      email: '',
      phone: '',
      source: 'facebook',
      stage: 'new',
      assignedTo: '',
      notes: '',
      estimatedValue: 0,
      followUpDate: '',
    });
    setSelectedLead(null);
    setConvertData({
      projectName: '',
      packageId: DEFAULT_PACKAGE_ID,
      createProject: true,
      location: '',
      industry: '',
    });
  };

  const openEditDialog = (lead: Lead) => {
    if (!canManageLead(lead)) {
      toast.error('You do not have permission to edit this lead');
      return;
    }
    setSelectedLead(lead);
    setFormData({
      businessName: lead.businessName,
      contactName: lead.contactName,
      email: lead.email,
      phone: lead.phone,
      source: lead.source,
      stage: lead.stage,
      assignedTo: lead.assignedTo,
      notes: lead.notes,
      estimatedValue: lead.estimatedValue,
      followUpDate: lead.followUpDate || '',
    });
    setShowAddDialog(true);
  };

  const openConvertDialog = (lead: Lead) => {
    if (!canManageLead(lead)) {
      toast.error('You do not have permission to convert this lead');
      return;
    }
    setSelectedLead(lead);
    setConvertData({
      projectName: `${lead.businessName} - Website`,
      packageId: DEFAULT_PACKAGE_ID,
      createProject: true,
      location: '',
      industry: '',
    });
    setShowConvertDialog(true);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Leads" description="Manage your sales pipeline">
        <Button onClick={() => { resetForm(); setShowAddDialog(true); }}>
          <Plus className="mr-2 h-4 w-4" />
          Add Lead
        </Button>
      </PageHeader>

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search leads..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            {Object.entries(LEAD_STAGES).map(([key, value]) => (
              <SelectItem key={key} value={key}>{value.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {Object.entries(LEAD_SOURCES).map(([key, value]) => (
              <SelectItem key={key} value={key}>{value}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Kanban Board */}
      {isLeadsLoading && leads.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">Loading leads...</CardContent>
        </Card>
      ) : filteredLeads.length === 0 ? (
        <EmptyState
          title="No leads found"
          description="Create your first lead or adjust your filters."
          action={{
            label: 'Add Lead',
            onClick: () => setShowAddDialog(true),
          }}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-6">
          {Object.entries(LEAD_STAGES).map(([stageKey, stageInfo]) => (
            <div key={stageKey} className="space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                <span className="text-sm font-medium">{stageInfo.label}</span>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-background text-xs">
                  {leadsByStage[stageKey as LeadStage].length}
                </span>
              </div>
              <div className="space-y-2 min-h-[200px]">
                {leadsByStage[stageKey as LeadStage].map((lead) => {
                  const agent = authService.getById(lead.assignedTo) || agentsById.get(lead.assignedTo);
                  const isOverdue = lead.followUpDate && new Date(lead.followUpDate) < new Date();
                  
                  return (
                    <Card
                      key={lead.id}
                      className={`cursor-pointer transition-all hover:shadow-md stage-${stageKey}`}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{lead.businessName}</p>
                            <p className="text-xs text-muted-foreground truncate">{lead.contactName}</p>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => navigate(`/leads/${lead.id}`)}>
                                <Eye className="mr-2 h-4 w-4" />
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEditDialog(lead)}>
                                <Edit className="mr-2 h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              {stageKey === 'negotiation' && (
                                <DropdownMenuItem onClick={() => openConvertDialog(lead)}>
                                  <UserPlus className="mr-2 h-4 w-4" />
                                  Convert to Client
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setDeleteConfirm(lead.id)}
                                className="text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        
                        {isOwner && (
                          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-medium text-accent">
                              {formatCurrency(lead.estimatedValue)}
                            </span>
                          </div>
                        )}

                        {lead.followUpDate && (
                          <div className={`mt-2 flex items-center gap-1 text-xs ${isOverdue ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {isOverdue && <AlertCircle className="h-3 w-3" />}
                            <Calendar className="h-3 w-3" />
                            <span>
                              {new Date(lead.followUpDate).toLocaleDateString('en-ZA', {
                                day: 'numeric',
                                month: 'short',
                              })}
                            </span>
                          </div>
                        )}

                        {isOwner && agent && (
                          <div className="mt-2 flex items-center gap-1">
                            <div className="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                              <span className="text-[10px] font-medium">
                                {agent.name.split(' ').map(n => n[0]).join('')}
                              </span>
                            </div>
                            <span className="text-xs text-muted-foreground">{agent.name}</span>
                          </div>
                        )}

                        {/* Quick stage change */}
                        <div className="mt-2 pt-2 border-t flex gap-1">
                          <Select
                            value={lead.stage}
                            onValueChange={(value) => {
                              void handleStageChange(lead.id, value as LeadStage);
                            }}
                          >
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(LEAD_STAGES).map(([key, value]) => (
                                <SelectItem key={key} value={key} className="text-xs">
                                  {value.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Lead Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedLead ? 'Edit Lead' : 'Add New Lead'}</DialogTitle>
            <DialogDescription>
              {selectedLead ? 'Update lead information' : 'Enter details for the new lead'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="businessName">Business Name *</Label>
              <Input
                id="businessName"
                value={formData.businessName}
                onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="contactName">Contact Name *</Label>
                <Input
                  id="contactName"
                  value={formData.contactName}
                  onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Source</Label>
                <Select
                  value={formData.source}
                  onValueChange={(value) => setFormData({ ...formData, source: value as LeadSource })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(LEAD_SOURCES).map(([key, value]) => (
                      <SelectItem key={key} value={key}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Stage</Label>
                <Select
                  value={formData.stage}
                  onValueChange={(value) => setFormData({ ...formData, stage: value as LeadStage })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(LEAD_STAGES).map(([key, value]) => (
                      <SelectItem key={key} value={key}>{value.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {isOwner && (
                <div className="grid gap-2">
                  <Label htmlFor="estimatedValue">Estimated Value (R)</Label>
                  <Input
                    id="estimatedValue"
                    type="number"
                    value={formData.estimatedValue}
                    onChange={(e) => setFormData({ ...formData, estimatedValue: Number(e.target.value) })}
                  />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="followUpDate">Follow-up Date</Label>
                <Input
                  id="followUpDate"
                  type="date"
                  value={formData.followUpDate}
                  onChange={(e) => setFormData({ ...formData, followUpDate: e.target.value })}
                />
              </div>
            </div>
            {isOwner && (
              <div className="grid gap-2">
                <Label>Assign to Agent</Label>
                <Select
                  value={formData.assignedTo}
                  onValueChange={(value) => setFormData({ ...formData, assignedTo: value })}
                  disabled={isAgentsLoading && agents.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        isAgentsLoading
                          ? 'Loading agents...'
                          : agents.length === 0
                            ? 'No agents found'
                            : 'Select agent'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {isAgentsLoading && agents.length === 0 && (
                      <SelectItem value={AGENT_SELECT_LOADING_VALUE} disabled>
                        Loading agents...
                      </SelectItem>
                    )}
                    {!isAgentsLoading && agents.length === 0 && (
                      <SelectItem value={AGENT_SELECT_EMPTY_VALUE} disabled>
                        No agents found
                      </SelectItem>
                    )}
                    {agentsLoadError && agents.length > 0 && (
                      <SelectItem value={AGENT_SELECT_CACHED_VALUE} disabled>
                        Using cached agents
                      </SelectItem>
                    )}
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                void handleSubmit();
              }}
            >
              {selectedLead ? 'Update' : 'Create'} Lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert to Client Dialog */}
      <Dialog open={showConvertDialog} onOpenChange={setShowConvertDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert to Client + Project?</DialogTitle>
            <DialogDescription>
              {selectedLead?.businessName} is now marked as Won. Confirm conversion.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="createProject"
                checked={convertData.createProject}
                onCheckedChange={(checked) => setConvertData({ ...convertData, createProject: !!checked })}
              />
              <Label htmlFor="createProject">Create Project now</Label>
            </div>
            {convertData.createProject && (
              <>
            <div className="grid gap-2">
              <Label htmlFor="projectName">Project Name *</Label>
              <Input
                id="projectName"
                value={convertData.projectName}
                onChange={(e) => setConvertData({ ...convertData, projectName: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Package</Label>
              <Select
                value={convertData.packageId}
                onValueChange={(value) => setConvertData({ ...convertData, packageId: value as PackageId })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KHULISA_PACKAGES.map((pkg) => (
                    <SelectItem key={pkg.id} value={pkg.id}>{pkg.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  value={convertData.location}
                  onChange={(e) => setConvertData({ ...convertData, location: e.target.value })}
                  placeholder="e.g., Soweto, JHB"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="industry">Industry</Label>
                <Input
                  id="industry"
                  value={convertData.industry}
                  onChange={(e) => setConvertData({ ...convertData, industry: e.target.value })}
                  placeholder="e.g., Food & Beverage"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConvertDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                void handleConvert();
              }}
            >
              Confirm Conversion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={() => setDeleteConfirm(null)}
        title="Delete Lead"
        description="Are you sure you want to delete this lead? This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          if (!deleteConfirm) return;
          void handleDelete(deleteConfirm);
        }}
        variant="destructive"
      />
    </div>
  );
}

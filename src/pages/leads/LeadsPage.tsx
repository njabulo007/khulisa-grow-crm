import { paymentFollowUpToday } from '@/services/paymentFollowUpService';
import { validateLead } from '@/lib/domainValidation';
import { canAccessLead } from '@/lib/permissions';
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
import { NoteEditor } from '@/components/common/NoteEditor';
import { Checkbox } from '@/components/ui/checkbox';
import { DEFAULT_PACKAGE_ID, KHULISA_PACKAGES, type PackageId } from '@/config/packages';
import { useAuth } from '@/contexts/AuthContext';
import { useLeads } from '@/hooks/useLeads';
import { AuthService, authService, leadConversionService } from '@/services';
import { Lead, LeadStage, LeadSource, LEAD_STAGES, LEAD_SOURCES } from '@/types/models';
import { toast } from 'sonner';

import { changeLeadStage, leadStageErrorMessage } from '@/services/leadStageService';

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
  const { leads, isLoading: isLeadsLoading, error: leadsError, refresh: refreshLeads, createLead, updateLead, removeLead, getById: getLeadById } = useLeads();
  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [followUpFilter, setFollowUpFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const stageChangesInFlight = useRef(new Set<string>());
  const [changingStages, setChangingStages] = useState<Set<string>>(new Set());

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
      if (!isOwner) {
        setAgents([]);
        setIsAgentsLoading(false);
        setAgentsLoadError(null);
        return;
      }

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
          .filter((profile) => profile.role === 'agent' && profile.isActive !== false)
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
        profileAgents.forEach((candidate) => {
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
        if (isMounted) {
          setIsAgentsLoading(false);
        }
      }
    };

    void loadAgents();

    return () => {
      isMounted = false;
    };
  }, [isOwner, showAddDialog, user?.id]);

  const agentsById = useMemo(() => {
    const next = new Map<string, { id: string; name: string; email: string }>();
    agents.forEach((candidate) => next.set(candidate.id, candidate));
    return next;
  }, [agents]);

  // Filter leads based on role
  const allLeads = useMemo(() => {
    if (isOwner) return leads;
    return leads.filter(l => canAccessLead(user, l));
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

      const date = lead.followUpDate?.slice(0, 10);
      const active = !['won', 'lost'].includes(lead.stage);
      const matchesFollowUp = followUpFilter === 'all' || (active && (
        followUpFilter === 'due' ? !!date && date <= paymentFollowUpToday() :
        followUpFilter === 'upcoming' ? !!date && date > paymentFollowUpToday() : !date
      ));
      return matchesSearch && matchesStage && matchesSource && matchesFollowUp;
    });
  }, [allLeads, searchQuery, stageFilter, sourceFilter, followUpFilter]);

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
    return !!user && (lead.assignedTo === user.id || lead.assignedTo === user.uid);
  };

  const handleSubmit = async () => {
    if (isSaving) return;

    const payload = {
      ...formData,
      businessName: formData.businessName.trim(),
      contactName: formData.contactName.trim(),
      email: formData.email.trim(),
      phone: formData.phone.trim(),
      notes: formData.notes.trim(),
    };

    const validation = validateLead({ ...payload, assignedTo: payload.assignedTo || user?.id || '' });
    if (!validation.valid) {
      toast.error(validation.errors.join(' '));
      return;
    }

    setIsSaving(true);
    try {
      if (selectedLead) {
        if (!canManageLead(selectedLead)) {
          toast.error('You do not have permission to update this lead');
          return;
        }
        const needsConversion = payload.stage === 'won' && (selectedLead.stage !== 'won' || !selectedLead.clientId);
        const saved = await updateLead(selectedLead.id, { ...payload, ...(needsConversion ? { stage: selectedLead.stage } : {}) });
        if (!saved) throw new Error('This lead no longer exists. Refresh the leads list.');
        if (needsConversion) await leadConversionService.convert({ leadId: selectedLead.id, createProject: false });
        toast.success('Lead updated successfully');
      } else {
        const created = await createLead({
          ...payload,
          stage: payload.stage === 'won' ? 'new' : payload.stage,
          assignedTo: payload.assignedTo || user?.id || '',
          createdBy: user?.id || '',
        });
        // Keep the saved lead selected if conversion fails, so a retry edits it
        // instead of creating a second lead.
        setSelectedLead(created);
        if (payload.stage === 'won') await leadConversionService.convert({ leadId: created.id, createProject: false });
        toast.success('Lead created successfully');
      }

      await refreshLeads();
      setShowAddDialog(false);
      resetForm();
    } catch (error) {
      console.error('[LeadsPage] Failed to save lead.', error);
      toast.error(error instanceof Error ? error.message : 'Lead could not be saved. Please retry.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const lead = await getLeadById(id);
      if (!lead) throw new Error('This lead no longer exists. Refresh the leads list.');
      if (!canManageLead(lead)) {
        toast.error('You do not have permission to delete this lead');
        return;
      }
      const removed = await removeLead(id);
      if (!removed) throw new Error('This lead no longer exists. Refresh the leads list.');
      toast.success('Lead deleted');
      setDeleteConfirm(null);
    } catch (error) {
      console.error('[LeadsPage] Failed to delete lead.', error);
      toast.error(error instanceof Error ? error.message : 'Lead could not be deleted. Please retry.');
    }
  };

  const handleStageChange = async (leadId: string, newStage: LeadStage) => {
    if (stageChangesInFlight.current.has(leadId)) return;
    stageChangesInFlight.current.add(leadId);
    setChangingStages(new Set(stageChangesInFlight.current));
    try {
      const lead = await getLeadById(leadId);
      if (!lead) throw new Error('This lead no longer exists. Refresh the leads list.');
      if (!canManageLead(lead)) {
        toast.error('You do not have permission to update this lead');
        return;
      }
      if (newStage === 'won' && !lead.clientId) {
        setSelectedLead({ ...lead, stage: 'won' });
        setConvertData({
          projectName: `${lead.businessName} - Website`, packageId: DEFAULT_PACKAGE_ID,
          createProject: true, location: '', industry: '',
        });
        setShowConvertDialog(true);
        return;
      }
      const result = await changeLeadStage(lead, newStage, user?.id || '');
      await refreshLeads();
      toast.success(newStage === 'won' ? 'Lead converted to client.' : `Lead moved to ${LEAD_STAGES[newStage].label}`);
      if (!result.activitySaved) toast.warning('The lead was saved, but its activity log could not be recorded.');
    } catch (error) {
      console.error('[LeadsPage] Failed to change lead stage.', error);
      toast.error(leadStageErrorMessage(error));
    } finally {
      stageChangesInFlight.current.delete(leadId);
      setChangingStages(new Set(stageChangesInFlight.current));
    }
  };

  const handleConvert = async () => {
    if (isConverting) return;
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

    setIsConverting(true);
    try {
      await leadConversionService.convert({
        leadId: selectedLead.id,
        createProject: convertData.createProject,
        projectName: convertData.projectName.trim(),
        packageId: convertData.packageId,
        location: convertData.location.trim(),
        industry: convertData.industry.trim(),
      });

      toast.success(convertData.createProject ? 'Lead converted to client and project.' : 'Lead converted to client.');
      setShowConvertDialog(false);
      setSelectedLead(null);
      navigate('/clients');
    } catch (error) {
      console.error('[LeadsPage] Failed to convert lead.', error);
      toast.error(error instanceof Error ? error.message : 'Lead conversion could not be completed. Please retry.');
    } finally {
      setIsConverting(false);
    }
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
        <Select value={followUpFilter} onValueChange={setFollowUpFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Follow-ups" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All follow-ups</SelectItem>
            <SelectItem value="due">Due / overdue</SelectItem>
            <SelectItem value="upcoming">Upcoming follow-ups</SelectItem>
            <SelectItem value="none">No follow-up date</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Kanban Board */}
      {leadsError && leads.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-10 text-center text-muted-foreground">
            <p>{leadsError}</p>
            <Button variant="outline" onClick={() => void refreshLeads()}>Try again</Button>
          </CardContent>
        </Card>
      ) : isLeadsLoading && leads.length === 0 ? (
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
                  const isOverdue = !['won', 'lost'].includes(lead.stage) && lead.followUpDate && lead.followUpDate.slice(0, 10) < paymentFollowUpToday();
                  
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
                              {(stageKey === 'negotiation' || (stageKey === 'won' && !lead.clientId)) && (
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
                            <SelectTrigger className="h-7 text-xs" disabled={changingStages.has(lead.id)}>
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
        <DialogContent className="max-h-[92dvh] w-[calc(100%_-_1rem)] max-w-2xl overflow-y-auto rounded-xl">
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
              <NoteEditor
                id="notes" label="Lead notes"
                value={formData.notes}
                onChange={(notes) => setFormData({ ...formData, notes })}
                placeholder="Background, requirements, and next steps…"
                disabled={isSaving}
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
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : selectedLead ? 'Update' : 'Create'} Lead
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
              disabled={isConverting}
              onClick={() => {
                void handleConvert();
              }}
            >
              {isConverting ? 'Converting...' : 'Confirm Conversion'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={() => setDeleteConfirm(null)}
        title="Delete Lead"
        description="Permanently delete this lead, its notes, and notifications? Its converted client and projects are kept; the client is unlinked from the deleted lead."
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

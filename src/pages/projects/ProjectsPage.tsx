import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { PageHeader, EmptyState, StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DEFAULT_PACKAGE_ID, getPackageById, KHULISA_PACKAGES, type PackageId } from '@/config/packages';
import { useAuth } from '@/contexts/AuthContext';
import { authService, clientService, leadService, projectService } from '@/services';
import { Client, Lead, Project, ProjectStatus, PROJECT_STATUSES } from '@/types/models';
import { getAgentLinkedClientIds } from '@/lib/permissions';
import { toast } from 'sonner';

export function ProjectsPage() {
  const navigate = useNavigate();
  const { user, isOwner } = useAuth();
  const [searchParams] = useSearchParams();
  const presetClientId = searchParams.get('client') || '';

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [openedFromPreset, setOpenedFromPreset] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    clientId: '',
    packageId: DEFAULT_PACKAGE_ID as PackageId,
    status: 'not-started' as ProjectStatus,
    startDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    assignedTo: '',
    notes: '',
  });
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const agents = authService.getAll().filter((candidate) => candidate.role === 'agent');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [clients, projects, leads] = await Promise.all([
        clientService.getAll(),
        projectService.getAll(),
        leadService.getAll(),
      ]);
      setAllClients(clients);
      setAllProjects(projects);
      setAllLeads(leads);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const accessibleClientIds = useMemo(() => {
    if (!user) return new Set<string>();
    if (isOwner) return new Set(allClients.map((client) => client.id));
    return getAgentLinkedClientIds(user.id, allLeads, allClients, allProjects);
  }, [allClients, allLeads, allProjects, isOwner, user]);

  const accessibleClients = useMemo(
    () => allClients.filter((client) => accessibleClientIds.has(client.id)),
    [accessibleClientIds, allClients]
  );

  useEffect(() => {
    if (!presetClientId || openedFromPreset || !accessibleClientIds.has(presetClientId)) return;
    setFormData((prev) => ({ ...prev, clientId: presetClientId, assignedTo: isOwner ? prev.assignedTo : user?.id || '' }));
    setShowAddDialog(true);
    setOpenedFromPreset(true);
  }, [accessibleClientIds, isOwner, openedFromPreset, presetClientId, user?.id]);

  const projects = useMemo(() => {
    const visible = isOwner
      ? allProjects
      : allProjects.filter((project) => project.assignedTo === user?.id);

    return visible.filter((project) => {
      if (!accessibleClientIds.has(project.clientId)) return false;
      if (presetClientId && project.clientId !== presetClientId) return false;
      if (statusFilter !== 'all' && project.status !== statusFilter) return false;

      const client = allClients.find((item) => item.id === project.clientId);
      const q = searchQuery.toLowerCase();
      const packageName = getPackageById(project.packageId)?.name || '';
      const matchesSearch =
        project.name.toLowerCase().includes(q) ||
        packageName.toLowerCase().includes(q) ||
        (client?.businessName || '').toLowerCase().includes(q);
      return matchesSearch;
    });
  }, [accessibleClientIds, allClients, allProjects, isOwner, presetClientId, searchQuery, statusFilter, user?.id]);

  const resetForm = () => {
    setFormData({
      name: '',
      clientId: presetClientId && accessibleClientIds.has(presetClientId) ? presetClientId : '',
      packageId: DEFAULT_PACKAGE_ID,
      status: 'not-started',
      startDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      assignedTo: isOwner ? '' : user?.id || '',
      notes: '',
    });
  };

  const handleCreate = async () => {
    if (!user) return;
    if (!formData.name.trim() || !formData.clientId || !formData.dueDate || !formData.startDate) {
      toast.error('Please complete all required project fields.');
      return;
    }
    if (!accessibleClientIds.has(formData.clientId)) {
      toast.error('You do not have access to this client.');
      return;
    }

    const assignedTo = isOwner ? formData.assignedTo || user.id : user.id;
    await projectService.create({
      name: formData.name.trim(),
      clientId: formData.clientId,
      packageId: formData.packageId,
      status: formData.status,
      milestones: [],
      dueDate: formData.dueDate,
      startDate: formData.startDate,
      assignedTo,
      notes: formData.notes.trim(),
      createdBy: user.id,
    });

    toast.success('Project created successfully.');
    await loadData();
    setShowAddDialog(false);
    resetForm();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Projects" description="Track your project deliverables">
        <Button
          onClick={() => {
            resetForm();
            setShowAddDialog(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Project
        </Button>
      </PageHeader>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(PROJECT_STATUSES).map(([value, config]) => (
              <SelectItem key={value} value={value}>
                {config.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && allProjects.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">Loading projects...</CardContent>
        </Card>
      ) : projects.length === 0 ? (
        <EmptyState
          title="No projects found"
          description="Create a project to start tracking delivery progress."
          action={{
            label: 'Add Project',
            onClick: () => {
              resetForm();
              setShowAddDialog(true);
            },
          }}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Assigned</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => {
                  const client = allClients.find((item) => item.id === project.clientId);
                  const agent = authService.getById(project.assignedTo);
                  return (
                    <TableRow
                      key={project.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/projects/${project.id}`)}
                    >
                      <TableCell className="font-medium">{project.name}</TableCell>
                      <TableCell>{client?.businessName || 'Unknown client'}</TableCell>
                      <TableCell>{getPackageById(project.packageId)?.name || 'Unknown package'}</TableCell>
                      <TableCell>
                        <StatusBadge status={project.status} type="project" />
                      </TableCell>
                      <TableCell>{new Date(project.dueDate).toLocaleDateString('en-ZA')}</TableCell>
                      <TableCell>{agent?.name || 'Unassigned'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Project</DialogTitle>
            <DialogDescription>Create a new project linked to a client.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="project-name">Project Name *</Label>
              <Input
                id="project-name"
                value={formData.name}
                onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Client *</Label>
              <Select
                value={formData.clientId}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, clientId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a client" />
                </SelectTrigger>
                <SelectContent>
                  {accessibleClients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.businessName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Package</Label>
                <Select
                  value={formData.packageId}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, packageId: value as PackageId }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KHULISA_PACKAGES.map((pack) => (
                      <SelectItem key={pack.id} value={pack.id}>
                        {pack.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, status: value as ProjectStatus }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PROJECT_STATUSES).map(([value, config]) => (
                      <SelectItem key={value} value={value}>
                        {config.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="project-start">Start Date *</Label>
                <Input
                  id="project-start"
                  type="date"
                  value={formData.startDate}
                  onChange={(event) => setFormData((prev) => ({ ...prev, startDate: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-due">Due Date *</Label>
                <Input
                  id="project-due"
                  type="date"
                  value={formData.dueDate}
                  onChange={(event) => setFormData((prev) => ({ ...prev, dueDate: event.target.value }))}
                />
              </div>
            </div>
            {isOwner && (
              <div className="grid gap-2">
                <Label>Assign To Agent</Label>
                <Select
                  value={formData.assignedTo}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, assignedTo: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="project-notes">Notes</Label>
              <Input
                id="project-notes"
                value={formData.notes}
                onChange={(event) => setFormData((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Optional notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                void handleCreate();
              }}
            >
              Create Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

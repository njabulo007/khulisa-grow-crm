import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  MoreHorizontal,
  Phone,
  MapPin,
  Edit,
  Trash2,
  Eye,
  FileText,
  FolderKanban,
} from 'lucide-react';
import { PageHeader, EmptyState, ConfirmDialog } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/AuthContext';
import { useClients } from '@/hooks/useClients';
import { buildProjectLookup, getInvoiceEffectiveTotals } from '@/lib/invoiceTotals';
import { invoiceService, leadService, projectService } from '@/services';
import { Client, Invoice, Lead, Project } from '@/types/models';
import { toast } from 'sonner';
import { getAgentLinkedClientIds } from '@/lib/permissions';

export function ClientsPage() {
  const navigate = useNavigate();
  const { user, isOwner } = useAuth();
  const { clients: allClients, isLoading: isClientsLoading, createClient, updateClient, removeClient } = useClients();
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    businessName: '',
    ownerName: '',
    email: '',
    phone: '',
    location: '',
    industry: '',
    contractSigned: false,
    onboardingCompleted: false,
  });
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [allInvoices, setAllInvoices] = useState<Invoice[]>([]);
  const [isRelatedDataLoading, setIsRelatedDataLoading] = useState(true);
  const projectLookup = useMemo(() => buildProjectLookup(allProjects), [allProjects]);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      setIsRelatedDataLoading(true);
      try {
        const [projects, leads, invoices] = await Promise.all([
          projectService.getAll(),
          leadService.getAll(),
          invoiceService.getAll(),
        ]);
        if (!isMounted) return;
        setAllProjects(projects);
        setAllLeads(leads);
        setAllInvoices(invoices);
      } finally {
        if (isMounted) {
          setIsRelatedDataLoading(false);
        }
      }
    };
    void loadData();
    return () => {
      isMounted = false;
    };
  }, [allClients.length]);

  const accessibleClientIds = useMemo(() => {
    if (!user) return new Set<string>();
    if (isOwner) return new Set(allClients.map((client) => client.id));
    return getAgentLinkedClientIds(user.id, allLeads, allClients, allProjects);
  }, [allClients, allLeads, allProjects, isOwner, user]);

  const clients = useMemo(() => {
    return allClients
      .filter((client) => accessibleClientIds.has(client.id))
      .filter(
        (client) =>
          client.businessName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          client.ownerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          client.email.toLowerCase().includes(searchQuery.toLowerCase())
      );
  }, [accessibleClientIds, allClients, searchQuery]);

  const clientStatsById = useMemo(() => {
    return allClients.reduce((acc, client) => {
      const projects = allProjects.filter((project) => project.clientId === client.id);
      const invoices = allInvoices.filter((invoice) => invoice.clientId === client.id);
      const activeProjects = projects.filter((project) => project.status !== 'completed' && project.status !== 'delivered');
      const paidInvoices = invoices.filter((invoice) => invoice.status === 'paid');
      const totalSpent = paidInvoices.reduce((sum, invoice) => sum + getInvoiceEffectiveTotals(invoice, projectLookup).total, 0);

      acc[client.id] = {
        projectCount: projects.length,
        activeProjects: activeProjects.length,
        invoiceCount: invoices.length,
        totalSpent,
      };
      return acc;
    }, {} as Record<string, { projectCount: number; activeProjects: number; invoiceCount: number; totalSpent: number }>);
  }, [allClients, allInvoices, allProjects, projectLookup]);

  const getClientStats = (clientId: string) => {
    const stats = clientStatsById[clientId];
    if (stats) return stats;
    const paidInvoices = allInvoices.filter((invoice) => invoice.clientId === clientId && invoice.status === 'paid');
    const totalSpent = paidInvoices.reduce((sum, i) => sum + getInvoiceEffectiveTotals(i, projectLookup).total, 0);

    return {
      projectCount: 0,
      activeProjects: 0,
      invoiceCount: 0,
      totalSpent,
    };
  };

  const getClientStatus = (client: Client): 'Prospect' | 'Onboarding' | 'Contract' => {
    if (client.contractSigned) return 'Contract';
    if (client.onboardingCompleted) return 'Onboarding';
    return 'Prospect';
  };

  const getStatusClassName = (status: 'Prospect' | 'Onboarding' | 'Contract'): string => {
    if (status === 'Contract') return 'bg-success/10 text-success border-success/20';
    if (status === 'Onboarding') return 'bg-warning/10 text-warning border-warning/20';
    return 'bg-info/10 text-info border-info/20';
  };

  const handleSubmit = async () => {
    if (!formData.businessName || !formData.ownerName) {
      toast.error('Please fill in required fields');
      return;
    }

    if (!isOwner && !selectedClient) {
      toast.error('Agents can only create clients by converting assigned leads.');
      return;
    }

    if (selectedClient) {
      if (!accessibleClientIds.has(selectedClient.id)) {
        toast.error('You do not have permission to update this client');
        return;
      }
      await updateClient(selectedClient.id, formData);
      toast.success('Client updated successfully');
    } else {
      await createClient({
        ...formData,
        createdBy: user?.id || '',
      });
      toast.success('Client created successfully');
    }

    setShowAddDialog(false);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (!accessibleClientIds.has(id)) {
      toast.error('You do not have permission to delete this client');
      return;
    }
    await removeClient(id);
    toast.success('Client deleted');
    setDeleteConfirm(null);
  };

  const resetForm = () => {
    setFormData({
      businessName: '',
      ownerName: '',
      email: '',
      phone: '',
      location: '',
      industry: '',
      contractSigned: false,
      onboardingCompleted: false,
    });
    setSelectedClient(null);
  };

  const openEditDialog = (client: Client) => {
    if (!accessibleClientIds.has(client.id)) {
      toast.error('You do not have permission to edit this client');
      return;
    }
    setSelectedClient(client);
    setFormData({
      businessName: client.businessName,
      ownerName: client.ownerName,
      email: client.email,
      phone: client.phone,
      location: client.location,
      industry: client.industry,
      contractSigned: client.contractSigned,
      onboardingCompleted: client.onboardingCompleted,
    });
    setShowAddDialog(true);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Clients" description="Manage your client relationships">
        {isOwner && (
          <Button onClick={() => { resetForm(); setShowAddDialog(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            Add Client
          </Button>
        )}
      </PageHeader>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search clients..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Clients Table */}
      {(isClientsLoading || isRelatedDataLoading) && allClients.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">Loading clients...</CardContent>
        </Card>
      ) : clients.length === 0 ? (
        <EmptyState
          title="No clients found"
          description={isOwner ? 'Add your first client or convert a won lead.' : 'Convert your assigned leads to create clients.'}
          action={
            isOwner
              ? {
                  label: 'Add Client',
                  onClick: () => setShowAddDialog(true),
                }
              : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden border-border/50 shadow-md">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gradient-to-r from-primary/5 to-accent/5 hover:bg-gradient-to-r hover:from-primary/5 hover:to-accent/5">
                    <TableHead className="font-semibold text-primary">Business</TableHead>
                    <TableHead className="font-semibold text-primary">Contact</TableHead>
                    <TableHead className="font-semibold text-primary">Location</TableHead>
                    <TableHead className="font-semibold text-primary">Status</TableHead>
                    <TableHead className="text-right font-semibold text-primary">Projects</TableHead>
                    {isOwner && <TableHead className="text-right font-semibold text-primary">Total Spent</TableHead>}
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((client, index) => {
                    const stats = getClientStats(client.id);
                    const status = getClientStatus(client);
                    return (
                      <TableRow 
                        key={client.id}
                        className="cursor-pointer transition-all duration-200 hover:bg-accent/5 group"
                        onClick={() => navigate(`/clients/${client.id}`)}
                      >
                        <TableCell className="py-4">
                          <div className="space-y-1">
                            <p className="font-semibold text-foreground group-hover:text-primary transition-colors">{client.businessName}</p>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">{client.industry || 'N/A'}</p>
                          </div>
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="space-y-1.5">
                            <p className="font-medium text-sm text-foreground">{client.ownerName}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors">
                              <Phone className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate">{client.phone}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <MapPin className="h-4 w-4 flex-shrink-0 text-accent" />
                            <span>{client.location || 'Not specified'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-4">
                          <span className={`inline-flex rounded-lg border px-3 py-1 text-xs font-semibold transition-all ${getStatusClassName(status)}`}>
                            {status}
                          </span>
                        </TableCell>
                        <TableCell className="py-4 text-right">
                          <div className="space-y-1">
                            <p className="font-bold text-primary text-base">{stats.projectCount}</p>
                            <p className="text-xs text-muted-foreground font-medium">{stats.activeProjects} active</p>
                          </div>
                        </TableCell>
                        {isOwner && (
                          <TableCell className="py-4 text-right">
                            <p className="font-bold text-accent text-base">{formatCurrency(stats.totalSpent)}</p>
                          </TableCell>
                        )}
                        <TableCell className="py-4" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => navigate(`/clients/${client.id}`)}>
                                <Eye className="mr-2 h-4 w-4" />
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEditDialog(client)}>
                                <Edit className="mr-2 h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => navigate(`/projects?client=${client.id}`)}>
                                <FolderKanban className="mr-2 h-4 w-4" />
                                View Projects
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => navigate(`/invoices?client=${client.id}`)}>
                                <FileText className="mr-2 h-4 w-4" />
                                View Invoices
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setDeleteConfirm(client.id)}
                                className="text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add/Edit Client Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedClient ? 'Edit Client' : 'Add New Client'}</DialogTitle>
            <DialogDescription>
              {selectedClient ? 'Update client information' : 'Enter details for the new client'}
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
                <Label htmlFor="ownerName">Owner Name *</Label>
                <Input
                  id="ownerName"
                  value={formData.ownerName}
                  onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
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
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="e.g., Soweto, JHB"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="industry">Industry</Label>
                <Input
                  id="industry"
                  value={formData.industry}
                  onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                  placeholder="e.g., Food & Beverage"
                />
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="contractSigned"
                  checked={formData.contractSigned}
                  onCheckedChange={(checked) => setFormData({ ...formData, contractSigned: !!checked })}
                />
                <Label htmlFor="contractSigned">Contract Signed</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="onboardingCompleted"
                  checked={formData.onboardingCompleted}
                  onCheckedChange={(checked) => setFormData({ ...formData, onboardingCompleted: !!checked })}
                />
                <Label htmlFor="onboardingCompleted">Onboarding Complete</Label>
              </div>
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
              {selectedClient ? 'Update' : 'Create'} Client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={() => setDeleteConfirm(null)}
        title="Delete Client"
        description="Are you sure you want to delete this client? All associated data will be preserved but unlinked."
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


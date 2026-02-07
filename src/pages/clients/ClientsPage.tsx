import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  MoreHorizontal,
  Phone,
  Mail,
  MapPin,
  Edit,
  Trash2,
  Eye,
  FileText,
  FolderKanban,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { PageHeader, StatusBadge, EmptyState, ConfirmDialog } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { clientStore, projectStore, invoiceStore } from '@/store/mockStore';
import { Client } from '@/types/models';
import { toast } from 'sonner';

export function ClientsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
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

  const clients = useMemo(() => {
    return clientStore.getAll().filter(client =>
      client.businessName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.ownerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.email.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery]);

  const getClientStats = (clientId: string) => {
    const projects = projectStore.getByClient(clientId);
    const invoices = invoiceStore.getByClient(clientId);
    const activeProjects = projects.filter(p => p.status === 'in-progress' || p.status === 'waiting-client');
    const paidInvoices = invoices.filter(i => i.status === 'paid');
    const totalSpent = paidInvoices.reduce((sum, i) => sum + i.total, 0);
    
    return {
      projectCount: projects.length,
      activeProjects: activeProjects.length,
      invoiceCount: invoices.length,
      totalSpent,
    };
  };

  const handleSubmit = () => {
    if (!formData.businessName || !formData.ownerName) {
      toast.error('Please fill in required fields');
      return;
    }

    if (selectedClient) {
      clientStore.update(selectedClient.id, formData);
      toast.success('Client updated successfully');
    } else {
      clientStore.create({
        ...formData,
        createdBy: user?.id || '',
      });
      toast.success('Client created successfully');
    }

    setShowAddDialog(false);
    resetForm();
  };

  const handleDelete = (id: string) => {
    clientStore.delete(id);
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
        <Button onClick={() => { resetForm(); setShowAddDialog(true); }}>
          <Plus className="mr-2 h-4 w-4" />
          Add Client
        </Button>
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
      {clients.length === 0 ? (
        <EmptyState
          title="No clients found"
          description="Add your first client or convert a won lead."
          action={{
            label: 'Add Client',
            onClick: () => setShowAddDialog(true),
          }}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Projects</TableHead>
                  <TableHead className="text-right">Total Spent</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client) => {
                  const stats = getClientStats(client.id);
                  return (
                    <TableRow 
                      key={client.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/clients/${client.id}`)}
                    >
                      <TableCell>
                        <div>
                          <p className="font-medium">{client.businessName}</p>
                          <p className="text-sm text-muted-foreground">{client.industry}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="text-sm">{client.ownerName}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {client.phone}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {client.location || 'Not specified'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className={`flex items-center gap-1 text-xs ${client.contractSigned ? 'text-success' : 'text-muted-foreground'}`}>
                            {client.contractSigned ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                            Contract
                          </span>
                          <span className={`flex items-center gap-1 text-xs ${client.onboardingCompleted ? 'text-success' : 'text-muted-foreground'}`}>
                            {client.onboardingCompleted ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                            Onboarding
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <p className="font-medium">{stats.projectCount}</p>
                        <p className="text-xs text-muted-foreground">{stats.activeProjects} active</p>
                      </TableCell>
                      <TableCell className="text-right">
                        <p className="font-semibold text-accent">{formatCurrency(stats.totalSpent)}</p>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
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
            <Button onClick={handleSubmit}>
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
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
        variant="destructive"
      />
    </div>
  );
}

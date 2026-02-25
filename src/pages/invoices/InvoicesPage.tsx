import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Trash2 } from 'lucide-react';
import { EmptyState, PageHeader, StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DEFAULT_PACKAGE_ID, getPackageById, getPackageNameById } from '@/config/packages';
import { useAuth } from '@/contexts/AuthContext';
import { useInvoices } from '@/hooks/useInvoices';
import { buildProjectLookup, getInvoiceEffectiveTotals } from '@/lib/invoiceTotals';
import {
  clientService,
  commissionService,
  leadService,
  paymentService,
  projectService,
  syncCommissionsFromInvoices,
} from '@/services';
import { canAccessInvoice, getAgentLinkedClientIds } from '@/lib/permissions';
import { Client, INVOICE_STATUSES, Invoice, InvoiceStatus, Lead, Payment, Project } from '@/types/models';
import { toast } from 'sonner';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(amount);
};

const DEFAULT_PACKAGE_NAME = getPackageById(DEFAULT_PACKAGE_ID)?.name ?? 'Digital Starter Presence';
const DEFAULT_PACKAGE_PRICE = getPackageById(DEFAULT_PACKAGE_ID)?.price ?? 0;

interface InvoiceFormState {
  clientId: string;
  projectId: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  description: string;
  quantity: number;
  unitPrice: number;
  notes: string;
}

export function InvoicesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isOwner } = useAuth();
  const {
    invoices: allInvoices,
    isLoading: isInvoicesLoading,
    createInvoice,
    getNextNumber,
    removeInvoice,
  } = useInvoices();
  const presetClientId = searchParams.get('client') || '';

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState<Invoice | null>(null);
  const [forceDeleteLinkedData, setForceDeleteLinkedData] = useState(false);
  const [openedFromPreset, setOpenedFromPreset] = useState(false);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [allPayments, setAllPayments] = useState<Payment[]>([]);
  const [formData, setFormData] = useState<InvoiceFormState>({
    clientId: '',
    projectId: '',
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    status: 'draft' as InvoiceStatus,
    description: DEFAULT_PACKAGE_NAME,
    quantity: 1,
    unitPrice: DEFAULT_PACKAGE_PRICE,
    notes: '',
  });

  useEffect(() => {
    void syncCommissionsFromInvoices();
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      const [clients, projects, leads, payments] = await Promise.all([
        clientService.getAll(),
        projectService.getAll(),
        leadService.getAll(),
        paymentService.getAll(),
      ]);
      if (!isMounted) return;
      setAllClients(clients);
      setAllProjects(projects);
      setAllLeads(leads);
      setAllPayments(payments);
    };
    void loadData();
    return () => {
      isMounted = false;
    };
  }, [allInvoices.length]);

  const projectLookup = useMemo(() => buildProjectLookup(allProjects), [allProjects]);

  const accessibleClientIds = useMemo(() => {
    if (!user) return new Set<string>();
    if (isOwner) return new Set(allClients.map((client) => client.id));
    return getAgentLinkedClientIds(user.id, allLeads, allClients, allProjects);
  }, [allClients, allLeads, allProjects, isOwner, user]);

  const accessibleProjects = useMemo(() => {
    const base = allProjects.filter((project) => accessibleClientIds.has(project.clientId));
    if (isOwner) return base;
    return base.filter((project) => project.assignedTo === user?.id);
  }, [accessibleClientIds, allProjects, isOwner, user?.id]);

  const accessibleInvoices = useMemo(() => {
    return allInvoices.filter((invoice) => canAccessInvoice(user, invoice, allLeads, allClients, allProjects));
  }, [allClients, allInvoices, allLeads, allProjects, user]);

  const filteredInvoices = useMemo(() => {
    return accessibleInvoices.filter((invoice) => {
      if (presetClientId && invoice.clientId !== presetClientId) return false;
      if (statusFilter !== 'all' && invoice.status !== statusFilter) return false;
      const client = allClients.find((entry) => entry.id === invoice.clientId);
      const query = searchQuery.toLowerCase();
      return (
        invoice.invoiceNumber.toLowerCase().includes(query) ||
        (client?.businessName || '').toLowerCase().includes(query)
      );
    });
  }, [accessibleInvoices, allClients, presetClientId, searchQuery, statusFilter]);

  const paymentsByInvoice = useMemo(() => {
    return allPayments.reduce<Record<string, number>>((acc, payment) => {
      acc[payment.invoiceId] = (acc[payment.invoiceId] || 0) + payment.amount;
      return acc;
    }, {});
  }, [allPayments]);

  useEffect(() => {
    if (!presetClientId || openedFromPreset || !accessibleClientIds.has(presetClientId)) return;
    setFormData((prev) => ({ ...prev, clientId: presetClientId }));
    setShowAddDialog(true);
    setOpenedFromPreset(true);
  }, [accessibleClientIds, openedFromPreset, presetClientId]);

  const resetForm = () => {
    setFormData({
      clientId: presetClientId && accessibleClientIds.has(presetClientId) ? presetClientId : '',
      projectId: '',
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      status: 'draft',
      description: DEFAULT_PACKAGE_NAME,
      quantity: 1,
      unitPrice: DEFAULT_PACKAGE_PRICE,
      notes: '',
    });
  };

  const projectsForSelectedClient = useMemo(() => {
    if (!formData.clientId) return [];
    return accessibleProjects.filter((project) => project.clientId === formData.clientId);
  }, [accessibleProjects, formData.clientId]);

  const selectedProjectForDraft = useMemo(
    () => projectsForSelectedClient.find((project) => project.id === formData.projectId),
    [formData.projectId, projectsForSelectedClient],
  );
  const selectedPackageForDraft = getPackageById(selectedProjectForDraft?.packageId);
  const isPackageBackedDraft = Boolean(selectedPackageForDraft);

  const handleCreate = async () => {
    if (!user) return;
    const selectedProject = accessibleProjects.find((project) => project.id === formData.projectId);
    const selectedPackage = getPackageById(selectedProject?.packageId);
    const isPackageBackedInvoice = Boolean(selectedPackage);
    const description = isPackageBackedInvoice ? selectedPackage!.name : formData.description.trim();
    const packageSnapshot = isPackageBackedInvoice
      ? {
          packageId: selectedPackage!.id,
          packageName: selectedPackage!.name,
          packagePrice: selectedPackage!.price,
        }
      : {};

    if (!formData.clientId || !formData.issueDate || !formData.dueDate || !description) {
      toast.error('Please complete all required invoice fields.');
      return;
    }
    if (!accessibleClientIds.has(formData.clientId)) {
      toast.error('You do not have access to this client.');
      return;
    }

    const quantity = isPackageBackedInvoice ? 1 : Number(formData.quantity) || 0;
    const unitPrice = isPackageBackedInvoice ? selectedPackage!.price : Number(formData.unitPrice) || 0;
    if (quantity <= 0 || unitPrice <= 0) {
      toast.error('Quantity and unit price must be greater than zero.');
      return;
    }

    const subtotal = quantity * unitPrice;
    const total = subtotal;
    const invoiceNumber = await getNextNumber();

    await createInvoice({
      invoiceNumber,
      clientId: formData.clientId,
      projectId: formData.projectId || undefined,
      ...packageSnapshot,
      items: [
        {
          id: `${Date.now()}`,
          description,
          quantity,
          unitPrice,
          total: subtotal,
        },
      ],
      subtotal,
      total,
      amountPaid: 0,
      status: formData.status,
      dueDate: formData.dueDate,
      issuedDate: formData.issueDate,
      notes: formData.notes.trim() || undefined,
      createdBy: user.id,
    });
    await syncCommissionsFromInvoices();

    toast.success('Invoice created successfully.');
    setShowAddDialog(false);
    resetForm();
  };

  const requestDeleteInvoice = (invoice: Invoice) => {
    if (!isOwner) {
      toast.error('Only owners can delete invoices.');
      return;
    }
    setInvoiceToDelete(invoice);
    setForceDeleteLinkedData(false);
    setShowDeleteDialog(true);
  };

  const confirmDeleteInvoice = async () => {
    if (!invoiceToDelete) return;
    if (!isOwner) {
      toast.error('Only owners can delete invoices.');
      return;
    }

    const [linkedPayments, linkedCommissions] = await Promise.all([
      paymentService.getByInvoiceId(invoiceToDelete.id),
      commissionService.getByInvoiceId(invoiceToDelete.id),
    ]);
    const hasLinkedRecords = linkedPayments.length > 0 || linkedCommissions.length > 0;

    if (hasLinkedRecords && !forceDeleteLinkedData) {
      toast.error('This invoice has linked payments/commissions. Enable force delete to remove linked records too.');
      return;
    }

    if (hasLinkedRecords && forceDeleteLinkedData) {
      for (const payment of linkedPayments) {
        await paymentService.remove(payment.id);
      }
      const commissionsAfterPaymentRemoval = await commissionService.getByInvoiceId(invoiceToDelete.id);
      for (const commission of commissionsAfterPaymentRemoval) {
        await commissionService.remove(commission.id);
      }
    }

    const removed = await removeInvoice(invoiceToDelete.id);
    if (!removed) {
      toast.error('Invoice could not be deleted.');
      return;
    }

    if (hasLinkedRecords && forceDeleteLinkedData) {
      toast.success('Invoice and linked records deleted successfully.');
    } else {
      toast.success('Invoice deleted successfully.');
    }
    setShowDeleteDialog(false);
    setInvoiceToDelete(null);
    setForceDeleteLinkedData(false);
    const payments = await paymentService.getAll();
    setAllPayments(payments);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Invoices" description="Manage billing and payments">
        <Button
          onClick={() => {
            resetForm();
            setShowAddDialog(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Invoice
        </Button>
      </PageHeader>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search invoices..."
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
            {Object.entries(INVOICE_STATUSES).map(([value, config]) => (
              <SelectItem key={value} value={value}>
                {config.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isInvoicesLoading && allInvoices.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">Loading invoices...</CardContent>
        </Card>
      ) : filteredInvoices.length === 0 ? (
        <EmptyState
          title="No invoices found"
          description={
            isOwner
              ? 'Create an invoice to start tracking revenue and outstanding amounts.'
              : 'Create an invoice to keep delivery and billing statuses up to date.'
          }
          action={{
            label: 'Add Invoice',
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
                  <TableHead>Invoice</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>Issue Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  {isOwner && <TableHead className="text-right">Total</TableHead>}
                  {isOwner && <TableHead className="text-right">Amount Paid</TableHead>}
                  {isOwner && <TableHead className="text-right">Outstanding</TableHead>}
                  <TableHead>Status</TableHead>
                  {isOwner && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvoices.map((invoice) => {
                  const client = allClients.find((entry) => entry.id === invoice.clientId);
                  const project = allProjects.find((entry) => entry.id === invoice.projectId);
                  const packageName = project ? getPackageNameById(project.packageId) : 'Unlinked';
                  const effectiveTotals = getInvoiceEffectiveTotals(invoice, projectLookup);
                  const amountPaid = paymentsByInvoice[invoice.id] ?? 0;
                  const outstanding = Math.max(effectiveTotals.total - amountPaid, 0);
                  return (
                    <TableRow
                      key={invoice.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/invoices/${invoice.id}`)}
                    >
                      <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
                      <TableCell>{client?.businessName || 'Unknown client'}</TableCell>
                      <TableCell>{project?.name || 'Unlinked'}</TableCell>
                      <TableCell>{packageName}</TableCell>
                      <TableCell>{new Date(invoice.issuedDate).toLocaleDateString('en-ZA')}</TableCell>
                      <TableCell>{new Date(invoice.dueDate).toLocaleDateString('en-ZA')}</TableCell>
                      {isOwner && <TableCell className="text-right font-semibold">{formatCurrency(effectiveTotals.total)}</TableCell>}
                      {isOwner && <TableCell className="text-right">{formatCurrency(amountPaid)}</TableCell>}
                      {isOwner && <TableCell className="text-right">{formatCurrency(outstanding)}</TableCell>}
                      <TableCell>
                        <StatusBadge status={invoice.status} type="invoice" />
                      </TableCell>
                      {isOwner && (
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={(event) => {
                              event.stopPropagation();
                              requestDeleteInvoice(invoice);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
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
            <DialogTitle>Add Invoice</DialogTitle>
            <DialogDescription>Create a new invoice for a client.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Client *</Label>
              <Select
                value={formData.clientId}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, clientId: value, projectId: '' }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {allClients
                    .filter((client) => accessibleClientIds.has(client.id))
                    .map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.businessName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Project (Optional)</Label>
              <Select
                value={formData.projectId || 'none'}
                onValueChange={(value) =>
                  setFormData((prev) => {
                    if (value === 'none') {
                      return {
                        ...prev,
                        projectId: '',
                        description: DEFAULT_PACKAGE_NAME,
                        unitPrice: DEFAULT_PACKAGE_PRICE,
                        quantity: 1,
                      };
                    }
                    const selectedProject = projectsForSelectedClient.find((project) => project.id === value);
                    const selectedPackage = getPackageById(selectedProject?.packageId);
                    if (!selectedPackage) return { ...prev, projectId: value };
                    return {
                      ...prev,
                      projectId: value,
                      description: selectedPackage.name,
                      unitPrice: selectedPackage.price,
                      quantity: 1,
                    };
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No linked project</SelectItem>
                  {projectsForSelectedClient.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="invoice-issue">Issue Date *</Label>
                <Input
                  id="invoice-issue"
                  type="date"
                  value={formData.issueDate}
                  onChange={(event) => setFormData((prev) => ({ ...prev, issueDate: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invoice-due">Due Date *</Label>
                <Input
                  id="invoice-due"
                  type="date"
                  value={formData.dueDate}
                  onChange={(event) => setFormData((prev) => ({ ...prev, dueDate: event.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Invoice Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, status: value as InvoiceStatus }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(INVOICE_STATUSES).map(([value, config]) => (
                    <SelectItem key={value} value={value}>
                      {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="invoice-description">Line Item Description *</Label>
              <Input
                id="invoice-description"
                value={formData.description}
                onChange={(event) => setFormData((prev) => ({ ...prev, description: event.target.value }))}
                disabled={isPackageBackedDraft}
              />
            </div>
            <div className={`grid gap-4 ${isOwner ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <div className="grid gap-2">
                <Label htmlFor="invoice-qty">Qty *</Label>
                <Input
                  id="invoice-qty"
                  type="number"
                  min={1}
                  value={isPackageBackedDraft ? 1 : formData.quantity}
                  onChange={(event) => setFormData((prev) => ({ ...prev, quantity: Number(event.target.value) }))}
                  disabled={isPackageBackedDraft}
                />
              </div>
              {isOwner && (
                <div className="grid gap-2">
                  <Label htmlFor="invoice-unit">{isPackageBackedDraft ? 'Package Price (R) *' : 'Unit Price (R) *'}</Label>
                  <Input
                    id="invoice-unit"
                    type="number"
                    min={0}
                    value={isPackageBackedDraft ? selectedPackageForDraft?.price || 0 : formData.unitPrice}
                    onChange={(event) => setFormData((prev) => ({ ...prev, unitPrice: Number(event.target.value) }))}
                    disabled={isPackageBackedDraft}
                  />
                </div>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="invoice-notes">Notes</Label>
              <Input
                id="invoice-notes"
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
              Create Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          setShowDeleteDialog(open);
          if (!open) {
            setInvoiceToDelete(null);
            setForceDeleteLinkedData(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Invoice</DialogTitle>
            <DialogDescription>
              Delete this invoice. Linked payments/commissions are protected unless you explicitly force delete.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <Checkbox
              id="force-delete-linked-list"
              checked={forceDeleteLinkedData}
              onCheckedChange={(checked) => setForceDeleteLinkedData(Boolean(checked))}
            />
            <Label htmlFor="force-delete-linked-list" className="text-sm font-normal leading-5">
              Force delete linked payments and commissions (owner override)
            </Label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteDialog(false);
                setInvoiceToDelete(null);
                setForceDeleteLinkedData(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDeleteInvoice()}>
              Delete Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

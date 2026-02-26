import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, Calendar, FolderKanban, Pencil, Printer, Trash2 } from 'lucide-react';
import { PageHeader, StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getPackageById, getPackageNameById } from '@/config/packages';
import { buildProjectLookup, getInvoiceEffectiveTotals } from '@/lib/invoiceTotals';
import {
  clientService,
  commissionService,
  invoiceService,
  leadService,
  paymentService,
  projectService,
  syncCommissionsFromInvoices,
} from '@/services';
import { useAuth } from '@/contexts/AuthContext';
import { canAccessInvoice } from '@/lib/permissions';
import { Client, INVOICE_STATUSES, Invoice, InvoiceStatus, Lead, Payment, Project } from '@/types/models';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(amount);
};

const toIsoFromDateInput = (dateInput: string): string => new Date(`${dateInput}T12:00:00Z`).toISOString();
const toDateInputValue = (value?: string): string => (value ? value.slice(0, 10) : '');

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

export function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isOwner } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [invoice, setInvoice] = useState<Invoice | undefined>(undefined);
  const [client, setClient] = useState<Client | null>(null);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [isSavingInvoice, setIsSavingInvoice] = useState(false);
  const [forceDeleteLinkedData, setForceDeleteLinkedData] = useState(false);
  const [editForm, setEditForm] = useState<InvoiceFormState | null>(null);
  const [paymentSummary, setPaymentSummary] = useState<Awaited<ReturnType<typeof invoiceService.getPaymentSummary>>>(null);

  useEffect(() => {
    void syncCommissionsFromInvoices();
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [loadedInvoice, projects, leads, clients] = await Promise.all([
        invoiceService.getById(id || ''),
        projectService.getAll(),
        leadService.getAll(),
        clientService.getAll(),
      ]);

      setInvoice(loadedInvoice);
      setAllProjects(projects);
      setAllLeads(leads);
      setAllClients(clients);

      if (!loadedInvoice) {
        setClient(null);
        setPayments([]);
        setPaymentSummary(null);
        return;
      }

      const [loadedClient, loadedPayments, summary] = await Promise.all([
        clientService.getById(loadedInvoice.clientId),
        paymentService.getByInvoiceId(loadedInvoice.id),
        invoiceService.getPaymentSummary(loadedInvoice.id),
      ]);

      setClient(loadedClient || null);
      setPayments(loadedPayments.sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime()));
      setPaymentSummary(summary);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const projectLookup = useMemo(() => buildProjectLookup(allProjects), [allProjects]);
  const project = useMemo(
    () => (invoice?.projectId ? allProjects.find((entry) => entry.id === invoice.projectId) || null : null),
    [allProjects, invoice]
  );
  const projectsForSelectedClient = useMemo(() => {
    if (!editForm?.clientId) return [];
    return allProjects.filter((entry) => entry.clientId === editForm.clientId);
  }, [allProjects, editForm?.clientId]);
  const selectedProjectForEdit = useMemo(
    () => projectsForSelectedClient.find((entry) => entry.id === editForm?.projectId),
    [editForm?.projectId, projectsForSelectedClient],
  );
  const selectedPackageForEdit = useMemo(
    () => getPackageById(selectedProjectForEdit?.packageId),
    [selectedProjectForEdit?.packageId],
  );
  const isPackageBackedEdit = Boolean(selectedPackageForEdit);

  const canViewInvoice = useMemo(
    () => canAccessInvoice(user, invoice, allLeads, allClients, allProjects),
    [allClients, allLeads, allProjects, invoice, user]
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Loading invoice...</p>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Invoice not found</p>
        <Button variant="link" onClick={() => navigate('/invoices')}>
          Back to Invoices
        </Button>
      </div>
    );
  }

  if (!canViewInvoice) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">You do not have permission to view this invoice.</p>
        <Button variant="link" onClick={() => navigate('/invoices')}>
          Back to Invoices
        </Button>
      </div>
    );
  }

  const effectiveTotals = getInvoiceEffectiveTotals(invoice, projectLookup);
  const amountPaid = paymentSummary?.amountPaid ?? payments.reduce((sum, payment) => sum + payment.amount, 0);
  const balance = paymentSummary?.balance ?? Math.max(effectiveTotals.total - amountPaid, 0);
  const effectiveStatus = paymentSummary?.status ?? invoice.status;

  const refreshPaymentData = async () => {
    const [loadedPayments, summary, refreshedInvoice] = await Promise.all([
      paymentService.getByInvoiceId(invoice.id),
      invoiceService.getPaymentSummary(invoice.id),
      invoiceService.getById(invoice.id),
    ]);
    setPayments(loadedPayments.sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime()));
    setPaymentSummary(summary);
    if (refreshedInvoice) setInvoice(refreshedInvoice);
  };

  const openEditDialog = () => {
    if (!isOwner) {
      toast.error('Only owners can edit invoices.');
      return;
    }

    const primaryItem = invoice.items[0];
    setEditForm({
      clientId: invoice.clientId,
      projectId: invoice.projectId || '',
      issueDate: toDateInputValue(invoice.issuedDate),
      dueDate: toDateInputValue(invoice.dueDate),
      status: invoice.status,
      description: primaryItem?.description || invoice.packageName || 'Invoice line item',
      quantity: primaryItem?.quantity || 1,
      unitPrice: primaryItem?.unitPrice || invoice.total || 0,
      notes: invoice.notes || '',
    });
    setShowEditDialog(true);
  };

  const handleUpdateInvoice = async () => {
    if (!isOwner || !editForm) {
      toast.error('Only owners can edit invoices.');
      return;
    }

    const selectedProject = allProjects.find((entry) => entry.id === editForm.projectId);
    const selectedPackage = getPackageById(selectedProject?.packageId);
    const isPackageBackedInvoice = Boolean(selectedPackage);
    const description = isPackageBackedInvoice ? selectedPackage!.name : editForm.description.trim();

    if (!editForm.clientId || !editForm.issueDate || !editForm.dueDate || !description) {
      toast.error('Please complete all required invoice fields.');
      return;
    }

    const quantity = isPackageBackedInvoice ? 1 : Number(editForm.quantity) || 0;
    const unitPrice = isPackageBackedInvoice ? selectedPackage!.price : Number(editForm.unitPrice) || 0;
    if (quantity <= 0 || unitPrice <= 0) {
      toast.error('Quantity and unit price must be greater than zero.');
      return;
    }

    const subtotal = quantity * unitPrice;
    const existingItemId = invoice.items[0]?.id || `${Date.now()}`;

    setIsSavingInvoice(true);
    try {
      const updated = await invoiceService.update(invoice.id, {
        clientId: editForm.clientId,
        projectId: editForm.projectId || undefined,
        packageId: selectedPackage?.id,
        packageName: selectedPackage?.name,
        packagePrice: selectedPackage?.price,
        items: [
          {
            id: existingItemId,
            description,
            quantity,
            unitPrice,
            total: subtotal,
          },
        ],
        subtotal,
        total: subtotal,
        status: editForm.status,
        dueDate: editForm.dueDate,
        issuedDate: editForm.issueDate,
        notes: editForm.notes.trim() || undefined,
      });

      if (!updated) {
        toast.error('Invoice could not be updated.');
        return;
      }

      await syncCommissionsFromInvoices();
      await loadData();
      toast.success('Invoice updated successfully.');
      setShowEditDialog(false);
      setEditForm(null);
    } finally {
      setIsSavingInvoice(false);
    }
  };

  const handleRecordPayment = async () => {
    if (!isOwner || !user) {
      toast.error('Only owners can record payments.');
      return;
    }

    const amountInput = window.prompt('Payment amount');
    const amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid payment amount.');
      return;
    }
    if (balance > 0 && amount > balance + 0.01) {
      toast.error('Payment amount cannot exceed the balance.');
      return;
    }

    const dateInput = window.prompt('Payment date (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));
    if (!dateInput) return;
    const methodInput = (window.prompt('Method: eft, cash, card, other', 'eft') || 'eft').toLowerCase();
    const method = ['eft', 'cash', 'card', 'other'].includes(methodInput) ? methodInput : 'other';
    const reference = window.prompt('Reference (optional)', '') || 'PAYMENT';

    await paymentService.create({
      invoiceId: invoice.id,
      amount,
      method: method as Payment['method'],
      reference,
      paidAt: toIsoFromDateInput(dateInput),
      createdBy: user.id,
    });

    await refreshPaymentData();
    toast.success('Payment recorded.');
  };

  const handleMarkRemainingPaid = async () => {
    if (!isOwner || !user) {
      toast.error('Only owners can mark invoices as paid.');
      return;
    }
    if (balance <= 0) {
      toast.error('Invoice is already fully paid.');
      return;
    }

    // Chosen approach: create a balancing payment for the remaining amount.
    await paymentService.create({
      invoiceId: invoice.id,
      amount: balance,
      method: 'other',
      reference: 'MANUAL-SETTLEMENT',
      paidAt: new Date().toISOString(),
      createdBy: user.id,
    });

    await refreshPaymentData();
    toast.success('Invoice marked as paid.');
  };

  const handleDeleteInvoice = async () => {
    if (!isOwner) {
      toast.error('Only owners can delete invoices.');
      return;
    }

    const [linkedPayments, linkedCommissions] = await Promise.all([
      paymentService.getByInvoiceId(invoice.id),
      commissionService.getByInvoiceId(invoice.id),
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
      const commissionsAfterPaymentRemoval = await commissionService.getByInvoiceId(invoice.id);
      for (const commission of commissionsAfterPaymentRemoval) {
        await commissionService.remove(commission.id);
      }
    }

    const removed = await invoiceService.remove(invoice.id);
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
    setForceDeleteLinkedData(false);
    navigate('/invoices');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/invoices')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <PageHeader title={invoice.invoiceNumber} description="Invoice Details" className="mb-0 flex-1">
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {isOwner && (
              <Button variant="outline" size="sm" onClick={openEditDialog} className="w-full sm:w-auto">
                <Pencil className="mr-2 h-4 w-4" />
                Edit Invoice
              </Button>
            )}
            {isOwner && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`/invoices/${invoice.id}/print`, '_blank', 'noopener,noreferrer')}
                className="w-full sm:w-auto"
              >
                <Printer className="mr-2 h-4 w-4" />
                Download / Print Invoice
              </Button>
            )}
            {isOwner && (
              <Button
                variant="destructive"
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => {
                  setForceDeleteLinkedData(false);
                  setShowDeleteDialog(true);
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Invoice
              </Button>
            )}
            <StatusBadge status={effectiveStatus} type="invoice" />
          </div>
        </PageHeader>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Invoice Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Client</p>
                  <p className="font-medium">{client?.businessName || 'Unknown client'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <FolderKanban className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Package</p>
                  <p className="font-medium">{project ? getPackageNameById(project.packageId) : 'Unlinked'}</p>
                  <p className="text-sm text-muted-foreground">Project: {project?.name || 'Unlinked'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Issued Date</p>
                  <p className="font-medium">{new Date(invoice.issuedDate).toLocaleDateString('en-ZA')}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Due Date</p>
                  <p className="font-medium">{new Date(invoice.dueDate).toLocaleDateString('en-ZA')}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Line Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {invoice.items.map((item) => (
                <div key={item.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{item.description}</p>
                      {isOwner ? (
                        <p className="text-sm text-muted-foreground">Qty {item.quantity}</p>
                      ) : null}
                    </div>
                    {isOwner && <p className="font-semibold">{formatCurrency(item.total)}</p>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {invoice.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{invoice.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {isOwner && (
            <Card>
              <CardHeader>
                <CardTitle>Amounts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold text-accent">{formatCurrency(effectiveTotals.total)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Amount Paid</p>
                  <p className="font-semibold text-success">{formatCurrency(amountPaid)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Balance</p>
                  <p className={`font-semibold ${balance > 0 ? 'text-destructive' : 'text-success'}`}>
                    {formatCurrency(balance)}
                  </p>
                </div>
                <div className="grid gap-2">
                  <Button onClick={() => void handleRecordPayment()} disabled={balance <= 0}>
                    Record Payment
                  </Button>
                  <Button variant="outline" onClick={() => void handleMarkRemainingPaid()} disabled={balance <= 0}>
                    Mark Remaining as Paid
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
              ) : (
                payments.map((payment) => (
                  <div key={payment.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        {isOwner && <p className="text-sm font-medium">{formatCurrency(payment.amount)}</p>}
                        <p className="text-xs text-muted-foreground uppercase">
                          {payment.method} {payment.reference ? `| ${payment.reference}` : ''}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">{new Date(payment.paidAt).toLocaleDateString('en-ZA')}</p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick Links</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => client && navigate(`/clients/${client.id}`)}
                disabled={!client}
              >
                <Building2 className="mr-2 h-4 w-4" />
                View Client
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => project && navigate(`/projects/${project.id}`)}
                disabled={!project}
              >
                <FolderKanban className="mr-2 h-4 w-4" />
                View Project
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={showEditDialog}
        onOpenChange={(open) => {
          setShowEditDialog(open);
          if (!open) setEditForm(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Invoice</DialogTitle>
            <DialogDescription>Update invoice details and line item values.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Client *</Label>
              <Select
                value={editForm?.clientId || ''}
                onValueChange={(value) =>
                  setEditForm((prev) => (prev ? { ...prev, clientId: value, projectId: '' } : prev))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {allClients.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.businessName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Project (Optional)</Label>
              <Select
                value={editForm?.projectId || 'none'}
                onValueChange={(value) =>
                  setEditForm((prev) => {
                    if (!prev) return prev;
                    if (value === 'none') {
                      return { ...prev, projectId: '' };
                    }
                    const selectedProject = projectsForSelectedClient.find((projectEntry) => projectEntry.id === value);
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
                  {projectsForSelectedClient.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-invoice-issue">Issue Date *</Label>
                <Input
                  id="edit-invoice-issue"
                  type="date"
                  value={editForm?.issueDate || ''}
                  onChange={(event) =>
                    setEditForm((prev) => (prev ? { ...prev, issueDate: event.target.value } : prev))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-invoice-due">Due Date *</Label>
                <Input
                  id="edit-invoice-due"
                  type="date"
                  value={editForm?.dueDate || ''}
                  onChange={(event) =>
                    setEditForm((prev) => (prev ? { ...prev, dueDate: event.target.value } : prev))
                  }
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Invoice Status</Label>
              <Select
                value={editForm?.status || 'draft'}
                onValueChange={(value) =>
                  setEditForm((prev) => (prev ? { ...prev, status: value as InvoiceStatus } : prev))
                }
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
              <Label htmlFor="edit-invoice-description">Line Item Description *</Label>
              <Input
                id="edit-invoice-description"
                value={editForm?.description || ''}
                onChange={(event) =>
                  setEditForm((prev) => (prev ? { ...prev, description: event.target.value } : prev))
                }
                disabled={isPackageBackedEdit}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-invoice-qty">Qty *</Label>
                <Input
                  id="edit-invoice-qty"
                  type="number"
                  min={1}
                  value={isPackageBackedEdit ? 1 : editForm?.quantity || 1}
                  onChange={(event) =>
                    setEditForm((prev) => (prev ? { ...prev, quantity: Number(event.target.value) } : prev))
                  }
                  disabled={isPackageBackedEdit}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-invoice-unit">{isPackageBackedEdit ? 'Package Price (R) *' : 'Unit Price (R) *'}</Label>
                <Input
                  id="edit-invoice-unit"
                  type="number"
                  min={0}
                  value={isPackageBackedEdit ? selectedPackageForEdit?.price || 0 : editForm?.unitPrice || 0}
                  onChange={(event) =>
                    setEditForm((prev) => (prev ? { ...prev, unitPrice: Number(event.target.value) } : prev))
                  }
                  disabled={isPackageBackedEdit}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-invoice-notes">Notes</Label>
              <Input
                id="edit-invoice-notes"
                value={editForm?.notes || ''}
                onChange={(event) =>
                  setEditForm((prev) => (prev ? { ...prev, notes: event.target.value } : prev))
                }
                placeholder="Optional notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleUpdateInvoice()} disabled={isSavingInvoice}>
              {isSavingInvoice ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          setShowDeleteDialog(open);
          if (!open) setForceDeleteLinkedData(false);
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
              id="force-delete-linked-detail"
              checked={forceDeleteLinkedData}
              onCheckedChange={(checked) => setForceDeleteLinkedData(Boolean(checked))}
            />
            <Label htmlFor="force-delete-linked-detail" className="text-sm font-normal leading-5">
              Force delete linked payments and commissions (owner override)
            </Label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteDialog(false);
                setForceDeleteLinkedData(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDeleteInvoice()}>
              Delete Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}



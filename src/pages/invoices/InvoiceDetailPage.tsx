import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, Calendar, CreditCard, FolderKanban } from 'lucide-react';
import { PageHeader, StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPackageNameById } from '@/config/packages';
import { buildProjectLookup, getInvoiceEffectiveTotals } from '@/lib/invoiceTotals';
import { clientService, invoiceService, leadService, paymentService, projectService, syncCommissionsFromInvoices } from '@/services';
import { useAuth } from '@/contexts/AuthContext';
import { canAccessInvoice } from '@/lib/permissions';
import { Client, Invoice, Lead, Payment, Project } from '@/types/models';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(amount);
};

export function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isOwner } = useAuth();
  const [invoice, setInvoice] = useState<Invoice | undefined>(undefined);
  const [client, setClient] = useState<Client | null>(null);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    void syncCommissionsFromInvoices();
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      const [loadedInvoice, projects, leads, clients] = await Promise.all([
        invoiceService.getById(id || ''),
        projectService.getAll(),
        leadService.getAll(),
        clientService.getAll(),
      ]);
      if (!isMounted) return;
      setInvoice(loadedInvoice);
      setAllProjects(projects);
      setAllLeads(leads);
      setAllClients(clients);

      if (!loadedInvoice) {
        setClient(null);
        setPayments([]);
        return;
      }

      const [loadedClient, loadedPayments] = await Promise.all([
        clientService.getById(loadedInvoice.clientId),
        paymentService.getByInvoice(loadedInvoice.id),
      ]);
      if (!isMounted) return;
      setClient(loadedClient || null);
      setPayments(loadedPayments.sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime()));
    };
    void loadData();
    return () => {
      isMounted = false;
    };
  }, [id]);

  const projectLookup = useMemo(() => buildProjectLookup(allProjects), [allProjects]);
  const project = useMemo(
    () => (invoice?.projectId ? allProjects.find((entry) => entry.id === invoice.projectId) || null : null),
    [allProjects, invoice]
  );
  const canViewInvoice = useMemo(
    () =>
      canAccessInvoice(
        user,
        invoice,
        allLeads,
        allClients,
        allProjects
      ),
    [allClients, allLeads, allProjects, invoice, user]
  );

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
  const outstanding = Math.max(effectiveTotals.total - invoice.amountPaid, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/invoices')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <PageHeader title={invoice.invoiceNumber} description="Invoice Details" className="mb-0 flex-1">
          <StatusBadge status={invoice.status} type="invoice" />
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
                  <p className="font-medium">
                    {project ? getPackageNameById(project.packageId) : 'Unlinked'}
                  </p>
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
                      <p className="text-sm text-muted-foreground">Qty {item.quantity}</p>
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
                  <p className="text-sm text-muted-foreground">Subtotal</p>
                  <p className="font-medium">{formatCurrency(effectiveTotals.subtotal)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Tax</p>
                  <p className="font-medium">{formatCurrency(effectiveTotals.tax)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold text-accent">{formatCurrency(effectiveTotals.total)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Amount Paid</p>
                  <p className="font-semibold text-success">{formatCurrency(invoice.amountPaid)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Outstanding</p>
                  <p className={`font-semibold ${outstanding > 0 ? 'text-destructive' : 'text-success'}`}>
                    {formatCurrency(outstanding)}
                  </p>
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
                      <p className="text-xs text-muted-foreground">
                        {new Date(payment.paidAt).toLocaleDateString('en-ZA')}
                      </p>
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
    </div>
  );
}

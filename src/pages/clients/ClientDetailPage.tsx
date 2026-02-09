import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  Building2,
  CheckCircle,
  XCircle,
  Plus,
  FileText,
  FolderKanban,
  Receipt,
  User2,
} from 'lucide-react';
import { PageHeader, StatusBadge, EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getPackageNameById } from '@/config/packages';
import { buildProjectLookup, getInvoiceEffectiveTotals } from '@/lib/invoiceTotals';
import { authService, clientService, invoiceService, leadService, paymentService, projectService } from '@/services';
import { useAuth } from '@/contexts/AuthContext';
import { canAccessInvoice, getAgentLinkedClientIds } from '@/lib/permissions';
import { Client, Invoice, Lead, Payment, Project } from '@/types/models';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(amount);
};

export function ClientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isOwner } = useAuth();
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [client, setClient] = useState<Client | undefined>(undefined);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [paymentsByInvoice, setPaymentsByInvoice] = useState<Record<string, Payment[]>>({});
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      const [clients, leads, projects, allInvoices] = await Promise.all([
        clientService.getAll(),
        leadService.getAll(),
        projectService.getAll(),
        invoiceService.getAll(),
      ]);
      if (!isMounted) return;
      setAllClients(clients);
      setAllLeads(leads);
      setAllProjects(projects);

      const nextClient = clients.find((entry) => entry.id === (id || ''));
      setClient(nextClient);
      if (!nextClient) {
        setInvoices([]);
        setPaymentsByInvoice({});
        setIsLoaded(true);
        return;
      }

      const visibleInvoices = allInvoices.filter((invoice) => invoice.clientId === nextClient.id);
      setInvoices(visibleInvoices);
      const paymentsEntries = await Promise.all(
        visibleInvoices.map(async (invoice) => [invoice.id, await paymentService.getByInvoice(invoice.id)] as const)
      );
      if (!isMounted) return;
      setPaymentsByInvoice(
        paymentsEntries.reduce<Record<string, Payment[]>>((acc, [invoiceId, payments]) => {
          acc[invoiceId] = [...payments].sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
          return acc;
        }, {})
      );
      setIsLoaded(true);
    };
    void loadData();
    return () => {
      isMounted = false;
    };
  }, [id]);

  const projectLookup = useMemo(() => buildProjectLookup(allProjects), [allProjects]);
  const linkedLeads = useMemo(() => {
    if (!client) return [];
    return allLeads
      .filter((lead) => lead.clientId === client.id || lead.id === client.leadId)
      .filter((lead) => isOwner || lead.assignedTo === user?.id);
  }, [allLeads, client, isOwner, user?.id]);
  const projects = useMemo(() => {
    const projectList = allProjects.filter((project) => project.clientId === (id || ''));
    if (isOwner || !user) return projectList;
    return projectList.filter((project) => project.assignedTo === user.id);
  }, [allProjects, id, isOwner, user]);
  const visibleInvoices = useMemo(() => {
    if (isOwner || !user) return invoices;
    return invoices.filter((invoice) =>
      canAccessInvoice(user, invoice, allLeads, allClients, allProjects)
    );
  }, [allClients, allLeads, allProjects, invoices, isOwner, user]);
  const canAccessClient = useMemo(() => {
    if (!client || !user) return false;
    if (isOwner) return true;
    const linkedIds = getAgentLinkedClientIds(user.id, allLeads, allClients, allProjects);
    return linkedIds.has(client.id);
  }, [allClients, allLeads, allProjects, client, isOwner, user]);

  const paidAmountByInvoice = useMemo(() => {
    return Object.entries(paymentsByInvoice).reduce<Record<string, number>>((acc, [invoiceId, payments]) => {
      acc[invoiceId] = payments.reduce((sum, payment) => sum + payment.amount, 0);
      return acc;
    }, {});
  }, [paymentsByInvoice]);

  const ownerBillingSummary = useMemo(() => {
    const totalBilled = visibleInvoices.reduce((sum, invoice) => {
      const totals = getInvoiceEffectiveTotals(invoice, projectLookup);
      return sum + totals.total;
    }, 0);
    const totalReceived = visibleInvoices.reduce((sum, invoice) => sum + (paidAmountByInvoice[invoice.id] || 0), 0);
    const totalOutstanding = Math.max(totalBilled - totalReceived, 0);
    return {
      totalBilled,
      totalReceived,
      totalOutstanding,
    };
  }, [paidAmountByInvoice, projectLookup, visibleInvoices]);

  if (!isLoaded && !client) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Loading client...</p>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Client not found</p>
        <Button variant="link" onClick={() => navigate('/clients')}>
          Back to Clients
        </Button>
      </div>
    );
  }

  if (!canAccessClient) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">You do not have permission to view this client.</p>
        <Button variant="link" onClick={() => navigate('/clients')}>
          Back to Clients
        </Button>
      </div>
    );
  }

  const totalSpent = visibleInvoices
    .filter(i => i.status === 'paid')
    .reduce((sum, i) => sum + getInvoiceEffectiveTotals(i, projectLookup).total, 0);

  const outstanding = visibleInvoices
    .filter(i => i.status !== 'paid' && i.status !== 'draft')
    .reduce((sum, i) => {
      const totals = getInvoiceEffectiveTotals(i, projectLookup);
      const amountPaid = paidAmountByInvoice[i.id] || 0;
      return sum + Math.max(totals.total - amountPaid, 0);
    }, 0);

  const clientStatus: 'Prospect' | 'Onboarding' | 'Contract' = client.contractSigned
    ? 'Contract'
    : client.onboardingCompleted
    ? 'Onboarding'
    : 'Prospect';

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/clients')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <PageHeader
          title={client.businessName}
          description={`${client.ownerName} | ${clientStatus}`}
          className="mb-0 flex-1"
        >
          <div className="flex gap-2">
            <Button size="sm" onClick={() => navigate(`/projects?client=${client.id}`)}>
              <FolderKanban className="mr-1 h-4 w-4" />
              Create Project
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/invoices?client=${client.id}`)}>
              <FileText className="mr-1 h-4 w-4" />
              Create Invoice
            </Button>
          </div>
        </PageHeader>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Client Info */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Business</p>
                  <p className="font-medium">{client.businessName}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Location</p>
                  <p className="font-medium">{client.location || 'Not specified'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Phone className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Phone</p>
                  <a href={`tel:${client.phone}`} className="font-medium text-primary hover:underline">
                    {client.phone}
                  </a>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Mail className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <a href={`mailto:${client.email}`} className="font-medium text-primary hover:underline">
                    {client.email}
                  </a>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Associated Leads */}
          <Card>
            <CardHeader>
              <CardTitle>Associated Leads</CardTitle>
            </CardHeader>
            <CardContent>
              {linkedLeads.length === 0 ? (
                <EmptyState
                  title="No linked leads"
                  description="No leads are currently linked to this client."
                />
              ) : (
                <div className="space-y-3">
                  {linkedLeads.map((lead) => {
                    const leadOwner = authService.getById(lead.assignedTo);
                    return (
                      <div
                        key={lead.id}
                        className="flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
                        onClick={() => navigate(`/leads/${lead.id}`)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                            <User2 className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-medium">{lead.businessName}</p>
                            <p className="text-sm text-muted-foreground">
                              {lead.contactName} {leadOwner ? ` | ${leadOwner.name}` : ''}
                            </p>
                          </div>
                        </div>
                        <StatusBadge status={lead.stage} type="lead" />
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Projects */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Projects</CardTitle>
              <Button size="sm" onClick={() => navigate(`/projects?client=${client.id}`)}>
                <Plus className="mr-1 h-4 w-4" />
                New Project
              </Button>
            </CardHeader>
            <CardContent>
              {projects.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">No projects yet</p>
              ) : (
                <div className="space-y-3">
                  {projects.map((project) => (
                    <div
                      key={project.id}
                      className="flex items-center justify-between rounded-lg border p-3 cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/projects/${project.id}`)}
                    >
                      <div className="flex items-center gap-3">
                        <FolderKanban className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{project.name}</p>
                          <p className="text-sm text-muted-foreground">{getPackageNameById(project.packageId)}</p>
                        </div>
                      </div>
                      <StatusBadge status={project.status} type="project" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Invoices */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Invoices + Payments</CardTitle>
              <Button size="sm" onClick={() => navigate(`/invoices?client=${client.id}`)}>
                <Plus className="mr-1 h-4 w-4" />
                New Invoice
              </Button>
            </CardHeader>
            <CardContent>
              {visibleInvoices.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">No invoices yet</p>
              ) : (
                <div className="space-y-3">
                  {visibleInvoices.map((invoice) => {
                    const projectForInvoice = allProjects.find((entry) => entry.id === invoice.projectId);
                    const totals = getInvoiceEffectiveTotals(invoice, projectLookup);
                    return (
                    <div key={invoice.id} className="rounded-lg border p-3">
                      <div
                        className="flex cursor-pointer items-center justify-between hover:bg-muted/50 rounded-md p-1 -m-1"
                        onClick={() => navigate(`/invoices/${invoice.id}`)}
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{invoice.invoiceNumber}</p>
                            <p className="text-sm text-muted-foreground">
                              Due: {new Date(invoice.dueDate).toLocaleDateString('en-ZA')}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Package: {projectForInvoice ? getPackageNameById(projectForInvoice.packageId) : 'Unlinked'}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          {isOwner && <p className="font-semibold">{formatCurrency(totals.total)}</p>}
                          <StatusBadge status={invoice.status} type="invoice" />
                        </div>
                      </div>

                      <div className="mt-3 space-y-2">
                        {(paymentsByInvoice[invoice.id] || []).length === 0 ? (
                          <p className="text-xs text-muted-foreground">No payments recorded</p>
                        ) : (
                          (paymentsByInvoice[invoice.id] || []).map((payment) => (
                            <div key={payment.id} className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1.5">
                              <div className="flex items-center gap-2 text-sm">
                                <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
                                {isOwner && <span>{formatCurrency(payment.amount)}</span>}
                                <span className="text-xs uppercase text-muted-foreground">{payment.method}</span>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {new Date(payment.paidAt).toLocaleDateString('en-ZA')}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {isOwner && (
            <Card>
              <CardHeader>
                <CardTitle>Billing / Payments</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {visibleInvoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No invoices available for this client.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Issue Date</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Amount Paid</TableHead>
                          <TableHead className="text-right">Outstanding</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleInvoices.map((invoice) => {
                          const totals = getInvoiceEffectiveTotals(invoice, projectLookup);
                          const amountPaid = paidAmountByInvoice[invoice.id] || 0;
                          const invoiceOutstanding = Math.max(totals.total - amountPaid, 0);
                          return (
                            <TableRow
                              key={invoice.id}
                              className="cursor-pointer"
                              onClick={() => navigate(`/invoices/${invoice.id}`)}
                            >
                              <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
                              <TableCell>{new Date(invoice.issuedDate).toLocaleDateString('en-ZA')}</TableCell>
                              <TableCell>
                                <StatusBadge status={invoice.status} type="invoice" />
                              </TableCell>
                              <TableCell className="text-right">{formatCurrency(totals.total)}</TableCell>
                              <TableCell className="text-right text-success">{formatCurrency(amountPaid)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(invoiceOutstanding)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-sm text-muted-foreground">Total billed</p>
                    <p className="text-xl font-semibold">{formatCurrency(ownerBillingSummary.totalBilled)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-sm text-muted-foreground">Total received</p>
                    <p className="text-xl font-semibold text-success">{formatCurrency(ownerBillingSummary.totalReceived)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-sm text-muted-foreground">Outstanding</p>
                    <p className={`text-xl font-semibold ${ownerBillingSummary.totalOutstanding > 0 ? 'text-destructive' : 'text-success'}`}>
                      {formatCurrency(ownerBillingSummary.totalOutstanding)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Trust Signals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className={`flex items-center gap-2 ${client.contractSigned ? 'text-success' : 'text-muted-foreground'}`}>
                {client.contractSigned ? <CheckCircle className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                <span>Contract Signed</span>
              </div>
              <div className={`flex items-center gap-2 ${client.onboardingCompleted ? 'text-success' : 'text-muted-foreground'}`}>
                {client.onboardingCompleted ? <CheckCircle className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                <span>Onboarding Completed</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{isOwner ? 'Financials' : 'Overview'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isOwner && (
                <>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Spent</p>
                    <p className="text-2xl font-bold text-accent">{formatCurrency(totalSpent)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Outstanding</p>
                    <p className={`text-xl font-semibold ${outstanding > 0 ? 'text-destructive' : 'text-success'}`}>
                      {formatCurrency(outstanding)}
                    </p>
                  </div>
                </>
              )}
              <div>
                <p className="text-sm text-muted-foreground">Industry</p>
                <p className="font-medium">{client.industry || 'Not specified'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Client Since</p>
                <p className="font-medium">
                  {new Date(client.createdAt).toLocaleDateString('en-ZA', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

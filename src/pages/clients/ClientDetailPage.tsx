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
      const [clients, leads, projects] = await Promise.all([
        clientService.getAll(),
        leadService.getAll(),
        projectService.getAll(),
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

      const clientInvoices = await invoiceService.getByClient(nextClient.id);
      setInvoices(clientInvoices);
      const paymentsEntries = await Promise.all(
        clientInvoices.map(async (invoice) => [invoice.id, await paymentService.getByInvoiceId(invoice.id)] as const)
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
        <Button variant="ghost" size="icon" className="transition-all hover:scale-110" onClick={() => navigate('/clients')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <PageHeader
          title={client.businessName}
          description={`${client.ownerName} | ${clientStatus}`}
          className="mb-0 flex-1"
        >
          <div className="flex gap-2">
            <Button size="sm" className="transition-all hover:shadow-md" onClick={() => navigate(`/projects?client=${client.id}`)}>
              <FolderKanban className="mr-1 h-4 w-4" />
              Create Project
            </Button>
            <Button size="sm" variant="outline" className="transition-all hover:shadow-md" onClick={() => navigate(`/invoices?client=${client.id}`)}>
              <FileText className="mr-1 h-4 w-4" />
              Create Invoice
            </Button>
          </div>
        </PageHeader>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Client Info */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="border-border/50 shadow-md hover:shadow-lg transition-shadow overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-primary/5 to-accent/5 border-b border-border/50">
              <CardTitle className="text-primary">Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 grid gap-5 sm:grid-cols-2">
              <div className="flex items-start gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70">
                  <Building2 className="h-5 w-5 text-primary-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Business</p>
                  <p className="font-semibold text-foreground mt-1">{client.businessName}</p>
                </div>
              </div>
              <div className="flex items-start gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent/70">
                  <MapPin className="h-5 w-5 text-accent-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location</p>
                  <p className="font-semibold text-foreground mt-1">{client.location || 'Not specified'}</p>
                </div>
              </div>
              <div className="flex items-start gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-info to-info/70">
                  <Phone className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Phone</p>
                  <a href={`tel:${client.phone}`} className="font-semibold text-primary hover:underline mt-1 block truncate">
                    {client.phone}
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-success to-success/70">
                  <Mail className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</p>
                  <a href={`mailto:${client.email}`} className="font-semibold text-primary hover:underline mt-1 block truncate">
                    {client.email}
                  </a>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Associated Leads */}
          <Card className="border-border/50 shadow-md hover:shadow-lg transition-shadow overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-primary/5 to-accent/5 border-b border-border/50">
              <CardTitle className="text-primary">Associated Leads</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {linkedLeads.length === 0 ? (
                <EmptyState
                  title="No linked leads"
                  description="No leads are currently linked to this client."
                />
              ) : (
                <div className="space-y-2">
                  {linkedLeads.map((lead) => {
                    const leadOwner = authService.getById(lead.assignedTo);
                    return (
                      <div
                        key={lead.id}
                        className="flex cursor-pointer items-center justify-between rounded-lg border border-border/40 p-4 transition-all hover:bg-muted/50 hover:border-accent/50 hover:shadow-sm group"
                        onClick={() => navigate(`/leads/${lead.id}`)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex-shrink-0">
                            <User2 className="h-5 w-5 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">{lead.businessName}</p>
                            <p className="text-sm text-muted-foreground truncate">
                              {lead.contactName} {leadOwner ? ` • ${leadOwner.name}` : ''}
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
          <Card className="border-border/50 shadow-md hover:shadow-lg transition-shadow overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-primary/5 to-accent/5 border-b border-border/50 flex flex-row items-center justify-between">
              <CardTitle className="text-primary">Projects</CardTitle>
              <Button size="sm" className="transition-all hover:shadow-md" onClick={() => navigate(`/projects?client=${client.id}`)}>
                <Plus className="mr-1 h-4 w-4" />
                New Project
              </Button>
            </CardHeader>
            <CardContent className="pt-6">
              {projects.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">No projects yet</p>
              ) : (
                <div className="space-y-2">
                  {projects.map((project) => (
                    <div
                      key={project.id}
                      className="flex items-center justify-between rounded-lg border border-border/40 p-4 cursor-pointer transition-all hover:bg-muted/50 hover:border-accent/50 hover:shadow-sm group"
                      onClick={() => navigate(`/projects/${project.id}`)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex-shrink-0">
                          <FolderKanban className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">{project.name}</p>
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
          <Card className="border-border/50 shadow-md hover:shadow-lg transition-shadow overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-primary/5 to-accent/5 border-b border-border/50 flex flex-row items-center justify-between">
              <CardTitle className="text-primary">Invoices + Payments</CardTitle>
              <Button size="sm" className="transition-all hover:shadow-md" onClick={() => navigate(`/invoices?client=${client.id}`)}>
                <Plus className="mr-1 h-4 w-4" />
                New Invoice
              </Button>
            </CardHeader>
            <CardContent className="pt-6">
              {visibleInvoices.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">No invoices yet</p>
              ) : (
                <div className="space-y-3">
                  {visibleInvoices.map((invoice) => {
                    const projectForInvoice = allProjects.find((entry) => entry.id === invoice.projectId);
                    const totals = getInvoiceEffectiveTotals(invoice, projectLookup);
                    return (
                    <div key={invoice.id} className="rounded-lg border border-border/40 p-4 transition-all hover:border-accent/50 hover:shadow-sm hover:bg-muted/30">
                      <div
                        className="flex cursor-pointer items-center justify-between hover:opacity-80 transition-opacity rounded-md"
                        onClick={() => navigate(`/invoices/${invoice.id}`)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex-shrink-0">
                            <FileText className="h-5 w-5 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground">{invoice.invoiceNumber}</p>
                            <p className="text-sm text-muted-foreground">
                              Due: {new Date(invoice.dueDate).toLocaleDateString('en-ZA')}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Package: {projectForInvoice ? getPackageNameById(projectForInvoice.packageId) : 'Unlinked'}
                            </p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {isOwner && <p className="font-bold text-accent">{formatCurrency(totals.total)}</p>}
                          <StatusBadge status={invoice.status} type="invoice" />
                        </div>
                      </div>

                      <div className="mt-4 space-y-2 border-t border-border/30 pt-3">
                        {(paymentsByInvoice[invoice.id] || []).length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">No payments recorded</p>
                        ) : (
                          (paymentsByInvoice[invoice.id] || []).map((payment) => (
                            <div key={payment.id} className="flex items-center justify-between rounded-md bg-gradient-to-r from-success/5 to-success/10 px-3 py-2">
                              <div className="flex items-center gap-2 text-sm">
                                <Receipt className="h-4 w-4 text-success flex-shrink-0" />
                                {isOwner && <span className="font-medium text-success">{formatCurrency(payment.amount)}</span>}
                                <span className="text-xs uppercase font-semibold text-muted-foreground">{payment.method}</span>
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
            <Card className="border-border/50 shadow-md hover:shadow-lg transition-shadow overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-primary/5 to-accent/5 border-b border-border/50">
                <CardTitle className="text-primary">Billing / Payments</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                {visibleInvoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No invoices available for this client.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border/50">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableHead className="font-semibold">Invoice</TableHead>
                          <TableHead className="font-semibold">Issue Date</TableHead>
                          <TableHead className="font-semibold">Status</TableHead>
                          <TableHead className="text-right font-semibold">Total</TableHead>
                          <TableHead className="text-right font-semibold">Amount Paid</TableHead>
                          <TableHead className="text-right font-semibold">Outstanding</TableHead>
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
                              className="cursor-pointer hover:bg-accent/5 transition-colors"
                              onClick={() => navigate(`/invoices/${invoice.id}`)}
                            >
                              <TableCell className="font-semibold">{invoice.invoiceNumber}</TableCell>
                              <TableCell>{new Date(invoice.issuedDate).toLocaleDateString('en-ZA')}</TableCell>
                              <TableCell>
                                <StatusBadge status={invoice.status} type="invoice" />
                              </TableCell>
                              <TableCell className="text-right font-bold">{formatCurrency(totals.total)}</TableCell>
                              <TableCell className="text-right font-bold text-success">{formatCurrency(amountPaid)}</TableCell>
                              <TableCell className={`text-right font-bold ${invoiceOutstanding > 0 ? 'text-destructive' : 'text-success'}`}>{formatCurrency(invoiceOutstanding)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-3 pt-2">
                  <div className="rounded-xl border border-border/50 p-4 bg-gradient-to-br from-primary/5 to-primary/2 hover:shadow-md transition-all">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Billed</p>
                    <p className="text-2xl font-bold text-primary mt-2">{formatCurrency(ownerBillingSummary.totalBilled)}</p>
                  </div>
                  <div className="rounded-xl border border-border/50 p-4 bg-gradient-to-br from-success/5 to-success/2 hover:shadow-md transition-all">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Received</p>
                    <p className="text-2xl font-bold text-success mt-2">{formatCurrency(ownerBillingSummary.totalReceived)}</p>
                  </div>
                  <div className={`rounded-xl border border-border/50 p-4 bg-gradient-to-br ${ownerBillingSummary.totalOutstanding > 0 ? 'from-destructive/5 to-destructive/2' : 'from-success/5 to-success/2'} hover:shadow-md transition-all`}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Outstanding</p>
                    <p className={`text-2xl font-bold mt-2 ${ownerBillingSummary.totalOutstanding > 0 ? 'text-destructive' : 'text-success'}`}>
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
          <Card className="border-border/50 shadow-md hover:shadow-lg transition-shadow overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-primary/5 to-accent/5 border-b border-border/50">
              <CardTitle className="text-primary">Trust Signals</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${client.contractSigned ? 'bg-success/5 border-success/30' : 'bg-muted/30 border-border/40'}`}>
                {client.contractSigned ? <CheckCircle className="h-5 w-5 text-success flex-shrink-0" /> : <XCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />}
                <span className={`font-medium ${client.contractSigned ? 'text-success' : 'text-muted-foreground'}`}>Contract Signed</span>
              </div>
              <div className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${client.onboardingCompleted ? 'bg-success/5 border-success/30' : 'bg-muted/30 border-border/40'}`}>
                {client.onboardingCompleted ? <CheckCircle className="h-5 w-5 text-success flex-shrink-0" /> : <XCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />}
                <span className={`font-medium ${client.onboardingCompleted ? 'text-success' : 'text-muted-foreground'}`}>Onboarding Completed</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 shadow-md hover:shadow-lg transition-shadow overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-primary/5 to-accent/5 border-b border-border/50">
              <CardTitle className="text-primary">{isOwner ? 'Financials' : 'Overview'}</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              {isOwner && (
                <>
                  <div className="rounded-lg bg-gradient-to-br from-accent/10 to-accent/5 p-4 border border-accent/30">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Spent</p>
                    <p className="text-3xl font-bold text-accent mt-2">{formatCurrency(totalSpent)}</p>
                  </div>
                  <div className={`rounded-lg bg-gradient-to-br ${outstanding > 0 ? 'from-destructive/10 to-destructive/5' : 'from-success/10 to-success/5'} p-4 border ${outstanding > 0 ? 'border-destructive/30' : 'border-success/30'}`}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Outstanding</p>
                    <p className={`text-2xl font-bold mt-2 ${outstanding > 0 ? 'text-destructive' : 'text-success'}`}>
                      {formatCurrency(outstanding)}
                    </p>
                  </div>
                </>
              )}
              <div className="rounded-lg border border-border/40 p-3 hover:bg-muted/30 transition-colors">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Industry</p>
                <p className="font-semibold text-foreground mt-1">{client.industry || 'Not specified'}</p>
              </div>
              <div className="rounded-lg border border-border/40 p-3 hover:bg-muted/30 transition-colors">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Client Since</p>
                <p className="font-semibold text-foreground mt-1">
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



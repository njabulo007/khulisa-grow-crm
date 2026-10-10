import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { agentDashboardErrorMessage } from "@/services/agentDashboardService";
import { ClientFollowUps } from "@/components/common/ClientFollowUps";
import { ClientRequests } from "@/components/common/ClientRequests";
import { ClientActivityPanel } from "@/components/common/ClientActivityPanel";
import { ClientFeedback } from "@/components/common/ClientFeedback";
import { ClientGrowth } from "@/components/common/ClientGrowth";
import { CommunicationTemplates } from "@/components/common/CommunicationTemplates";
import { ClientCarePanel } from "@/components/common/ClientCarePanel";
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
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
} from "lucide-react";
import { PageHeader, StatusBadge, EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getPackageNameById } from "@/config/packages";
import {
  buildProjectLookup,
  getInvoiceEffectiveTotals,
} from "@/lib/invoiceTotals";
import {
  authService,
  clientService,
  invoiceService,
  leadService,
  paymentService,
  projectService,
} from "@/services";
import { useAuth } from "@/contexts/AuthContext";
import {
  canAccessLead,
  canAccessInvoice,
  getAgentLinkedClientIds,
} from "@/lib/permissions";
import { Client, Invoice, Lead, Payment, Project } from "@/types/models";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 0,
  }).format(amount);
};

export function ClientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const hashTab = (hash: string) =>
    hash.includes("feedback")
      ? "approvals"
      : hash.includes("growth")
        ? "growth"
        : hash.includes("request")
          ? "delivery"
          : hash.includes("health") || hash.includes("onboarding")
            ? "onboarding"
            : hash.includes("follow") ||
                hash.includes("activity") ||
                hash.includes("templates")
              ? "conversations"
              : "overview";
  const [tab, setTab] = useState(() => hashTab(location.hash));
  const [visited, setVisited] = useState(
    () => new Set([hashTab(location.hash)]),
  );
  useEffect(() => {
    const next = hashTab(location.hash);
    setTab(next);
    setVisited((v) => new Set([...v, next]));
  }, [location.hash, location.key]);
  const { user, isOwner } = useAuth();
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [client, setClient] = useState<Client | undefined>(undefined);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [paymentsByInvoice, setPaymentsByInvoice] = useState<
    Record<string, Payment[]>
  >({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (
      !isLoaded ||
      !client?.id ||
      ![
        "#client-activity",
        "#client-follow-ups",
        "#client-requests",
        "#client-health",
        "#client-onboarding",
        "#client-feedback",
        "#client-growth",
        "#client-templates",
      ].includes(location.hash)
    )
      return;
    const frame = requestAnimationFrame(() =>
      document
        .getElementById(location.hash.slice(1))
        ?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [isLoaded, client?.id, location.hash]);

  useEffect(() => {
    let isMounted = true;
    setIsLoaded(false);
    setLoadError(null);
    setClient(undefined);
    const loadData = async () => {
      try {
        const [clients, leads, projects] = await Promise.all([
          clientService.getAll(),
          leadService.getAll(),
          projectService.getAll(),
        ]);
        if (!isMounted) return;
        setAllClients(clients);
        setAllLeads(leads);
        setAllProjects(projects);

        const nextClient = clients.find((entry) => entry.id === (id || ""));
        setClient(nextClient);
        if (!nextClient) {
          setInvoices([]);
          setPaymentsByInvoice({});
          setIsLoaded(true);
          return;
        }

        const clientInvoices = await invoiceService.getByClient(nextClient.id);
        if (!isMounted) return;
        setInvoices(clientInvoices);
        const paymentsEntries = await Promise.all(
          clientInvoices.map(
            async (invoice) =>
              [
                invoice.id,
                await paymentService.getByInvoiceId(invoice.id),
              ] as const,
          ),
        );
        if (!isMounted) return;
        setPaymentsByInvoice(
          paymentsEntries.reduce<Record<string, Payment[]>>(
            (acc, [invoiceId, payments]) => {
              acc[invoiceId] = [...payments].sort(
                (a, b) =>
                  new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime(),
              );
              return acc;
            },
            {},
          ),
        );
      } catch (error) {
        console.error("[ClientDetail] Failed to load client records.", error);
        if (isMounted)
          setLoadError(
            agentDashboardErrorMessage(error).replace(/dashboard/g, "client"),
          );
      } finally {
        if (isMounted) setIsLoaded(true);
      }
    };
    void loadData();
    return () => {
      isMounted = false;
    };
  }, [id, retryKey, user?.uid, user?.id, user?.role]);

  const projectLookup = useMemo(
    () => buildProjectLookup(allProjects),
    [allProjects],
  );
  const linkedLeads = useMemo(() => {
    if (!client) return [];
    return allLeads
      .filter(
        (lead) => lead.clientId === client.id || lead.id === client.leadId,
      )
      .filter((lead) => isOwner || canAccessLead(user, lead));
  }, [allLeads, client, isOwner, user]);
  const projects = useMemo(() => {
    const projectList = allProjects.filter(
      (project) => project.clientId === (id || ""),
    );
    if (isOwner || !user) return projectList;
    return projectList.filter(
      (project) =>
        project.assignedTo === user.id || project.assignedTo === user.uid,
    );
  }, [allProjects, id, isOwner, user]);
  const visibleInvoices = useMemo(() => {
    if (isOwner || !user) return invoices;
    return invoices.filter((invoice) =>
      canAccessInvoice(user, invoice, allLeads, allClients, allProjects),
    );
  }, [allClients, allLeads, allProjects, invoices, isOwner, user]);
  const canAccessClient = useMemo(() => {
    if (!client || !user) return false;
    if (isOwner) return true;
    const linkedIds = getAgentLinkedClientIds(
      user.id,
      allLeads,
      allClients,
      allProjects,
      user.uid,
    );
    return linkedIds.has(client.id);
  }, [allClients, allLeads, allProjects, client, isOwner, user]);

  const paidAmountByInvoice = useMemo(() => {
    return Object.entries(paymentsByInvoice).reduce<Record<string, number>>(
      (acc, [invoiceId, payments]) => {
        acc[invoiceId] = payments.reduce(
          (sum, payment) => sum + payment.amount,
          0,
        );
        return acc;
      },
      {},
    );
  }, [paymentsByInvoice]);

  const ownerBillingSummary = useMemo(() => {
    const totalBilled = visibleInvoices
      .filter((i) => i.status !== "draft")
      .reduce((sum, invoice) => {
        const totals = getInvoiceEffectiveTotals(invoice, projectLookup);
        return sum + totals.total;
      }, 0);
    const totalReceived = visibleInvoices
      .filter((i) => i.status !== "draft")
      .reduce(
        (sum, invoice) => sum + (paidAmountByInvoice[invoice.id] || 0),
        0,
      );
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

  if (loadError)
    return (
      <div className="space-y-3 py-12 text-center">
        <p role="alert" className="text-destructive-text">
          {loadError}
        </p>
        <Button variant="outline" onClick={() => setRetryKey((key) => key + 1)}>
          Retry client
        </Button>
        <Button variant="link" onClick={() => navigate("/clients")}>
          Back to Clients
        </Button>
      </div>
    );

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Client not found</p>
        <Button variant="link" onClick={() => navigate("/clients")}>
          Back to Clients
        </Button>
      </div>
    );
  }

  if (!canAccessClient) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">
          You do not have permission to view this client.
        </p>
        <Button variant="link" onClick={() => navigate("/clients")}>
          Back to Clients
        </Button>
      </div>
    );
  }

  const totalSpent = visibleInvoices
    .filter((i) => i.status === "paid")
    .reduce(
      (sum, i) => sum + getInvoiceEffectiveTotals(i, projectLookup).total,
      0,
    );

  const outstanding = visibleInvoices
    .filter((i) => i.status !== "paid" && i.status !== "draft")
    .reduce((sum, i) => {
      const totals = getInvoiceEffectiveTotals(i, projectLookup);
      const amountPaid = paidAmountByInvoice[i.id] || 0;
      return sum + Math.max(totals.total - amountPaid, 0);
    }, 0);

  const clientStatus: "Prospect" | "Onboarding" | "Contract" =
    client.contractSigned
      ? "Contract"
      : client.onboardingCompleted
        ? "Onboarding"
        : "Prospect";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="transition-all hover:scale-110"
          onClick={() => navigate("/clients")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <PageHeader
          title={client.businessName}
          description={`${client.ownerName} | ${clientStatus} | Contact manager: ${authService.getAll().find((a) => a.id === client.contactManagerId || a.uid === client.contactManagerId)?.name || "Lead/project assignment"}`}
          className="mb-0 flex-1"
        >
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                navigate(`/clients?edit=${encodeURIComponent(client.id)}`)
              }
            >
              Edit client details
            </Button>
            <Button
              size="sm"
              className="transition-all hover:shadow-md"
              onClick={() => navigate(`/projects?client=${client.id}`)}
            >
              <FolderKanban className="mr-1 h-4 w-4" />
              {isOwner ? "Create Project" : "View Projects"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="transition-all hover:shadow-md"
              onClick={() => navigate(`/invoices?client=${client.id}`)}
            >
              <FileText className="mr-1 h-4 w-4" />
              {isOwner ? "Create Invoice" : "View Invoices"}
            </Button>
          </div>
        </PageHeader>
      </div>

      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next);
          setVisited((v) => new Set([...v, next]));
        }}
      >
        <TabsList className="h-auto flex flex-wrap justify-start gap-1">
          {[
            "overview",
            "conversations",
            "onboarding",
            "delivery",
            "approvals",
            "growth",
            "billing",
          ].map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {tab[0].toUpperCase() + tab.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent
          forceMount
          value="conversations"
          className="data-[state=inactive]:hidden space-y-6"
        >
          {visited.has("conversations") && (
            <>
              <ClientFollowUps
                key={`follow-${client.id}`}
                clientId={client.id}
              />
              <ClientActivityPanel key={client.id} clientId={client.id} />
              <CommunicationTemplates
                key={`templates-${client.id}`}
                client={client}
                invoices={visibleInvoices
                  .filter(
                    (invoice) =>
                      invoice.status !== "paid" && invoice.status !== "draft",
                  )
                  .map((invoice) => ({
                    id: invoice.id,
                    invoiceNumber: invoice.invoiceNumber,
                    dueDate: invoice.dueDate,
                    outstanding: Math.max(
                      getInvoiceEffectiveTotals(invoice, projectLookup).total -
                        Math.max(
                          paidAmountByInvoice[invoice.id] || 0,
                          invoice.amountPaid || 0,
                        ),
                      0,
                    ),
                  }))
                  .filter((invoice) => invoice.outstanding > 0)}
              />
            </>
          )}
        </TabsContent>
        <TabsContent
          forceMount
          value="onboarding"
          className="data-[state=inactive]:hidden "
        >
          {visited.has("onboarding") && (
            <>
              <ClientCarePanel
                key={`care-${client.id}`}
                clientId={client.id}
                onChange={(care) =>
                  setClient((current) =>
                    current?.id === client.id
                      ? {
                          ...current,
                          onboardingCompleted: care.onboardingCompleted,
                          contractSigned:
                            care.checklist.contract.status === "received",
                        }
                      : current,
                  )
                }
              />
            </>
          )}
        </TabsContent>
        <TabsContent
          forceMount
          value="delivery"
          className="data-[state=inactive]:hidden space-y-6"
        >
          {visited.has("delivery") && (
            <>
              {" "}
              <Card className="border-border/50 shadow-md hover:shadow-lg transition-shadow overflow-hidden">
                <CardHeader className="bg-gradient-to-r from-primary/5 to-accent/5 border-b border-border/50 flex flex-row items-center justify-between">
                  <CardTitle className="text-primary-text">Projects</CardTitle>
                  <Button
                    size="sm"
                    className="transition-all hover:shadow-md"
                    onClick={() => navigate(`/projects?client=${client.id}`)}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    New Project
                  </Button>
                </CardHeader>
                <CardContent className="pt-6">
                  {projects.length === 0 ? (
                    <p className="text-center text-muted-foreground py-4">
                      No projects yet
                    </p>
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
                              <FolderKanban className="h-5 w-5 text-primary-text" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground group-hover:text-primary-text transition-colors truncate">
                                {project.name}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {getPackageNameById(project.packageId)}
                              </p>
                            </div>
                          </div>
                          <StatusBadge status={project.status} type="project" />
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              <ClientRequests
                key={`requests-${client.id}`}
                clientId={client.id}
              />
            </>
          )}
        </TabsContent>
        <TabsContent
          forceMount
          value="approvals"
          className="data-[state=inactive]:hidden "
        >
          {visited.has("approvals") && (
            <>
              <ClientFeedback
                key={`feedback-${client.id}`}
                clientId={client.id}
                contactName={client.ownerName}
              />
            </>
          )}
        </TabsContent>
        <TabsContent
          forceMount
          value="growth"
          className="data-[state=inactive]:hidden "
        >
          {visited.has("growth") && (
            <>
              <ClientGrowth key={`growth-${client.id}`} clientId={client.id} />
            </>
          )}
        </TabsContent>
        <TabsContent
          forceMount
          value="billing"
          className="data-[state=inactive]:hidden "
        >
          {visited.has("billing") && (
            <>
              {" "}
              <Card className="border-border/50 shadow-md hover:shadow-lg transition-shadow overflow-hidden">
                <CardHeader className="bg-gradient-to-r from-primary/5 to-accent/5 border-b border-border/50 flex flex-row items-center justify-between">
                  <CardTitle className="text-primary-text">
                    Invoices + Payments
                  </CardTitle>
                  {isOwner && (
                    <Button
                      size="sm"
                      className="transition-all hover:shadow-md"
                      onClick={() => navigate(`/invoices?client=${client.id}`)}
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      New Invoice
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="pt-6">
                  {visibleInvoices.length === 0 ? (
                    <p className="text-center text-muted-foreground py-4">
                      No invoices yet
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {visibleInvoices.map((invoice) => {
                        const projectForInvoice = allProjects.find(
                          (entry) => entry.id === invoice.projectId,
                        );
                        const totals = getInvoiceEffectiveTotals(
                          invoice,
                          projectLookup,
                        );
                        return (
                          <div
                            key={invoice.id}
                            className="rounded-lg border border-border/40 p-4 transition-all hover:border-accent/50 hover:shadow-sm hover:bg-muted/30"
                          >
                            <div
                              className="flex cursor-pointer items-center justify-between hover:opacity-80 transition-opacity rounded-md"
                              onClick={() =>
                                navigate(`/invoices/${invoice.id}`)
                              }
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex-shrink-0">
                                  <FileText className="h-5 w-5 text-primary-text" />
                                </div>
                                <div className="min-w-0">
                                  <p className="font-semibold text-foreground">
                                    {invoice.invoiceNumber}
                                  </p>
                                  <p className="text-sm text-muted-foreground">
                                    Due:{" "}
                                    {new Date(
                                      invoice.dueDate,
                                    ).toLocaleDateString("en-ZA")}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Package:{" "}
                                    {projectForInvoice
                                      ? getPackageNameById(
                                          projectForInvoice.packageId,
                                        )
                                      : "Unlinked"}
                                  </p>
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0">
                                {isOwner && (
                                  <p className="font-bold text-accent-text">
                                    {formatCurrency(totals.total)}
                                  </p>
                                )}
                                <StatusBadge
                                  status={invoice.status}
                                  type="invoice"
                                />
                              </div>
                            </div>

                            <div className="mt-4 space-y-2 border-t border-border/30 pt-3">
                              {(paymentsByInvoice[invoice.id] || []).length ===
                              0 ? (
                                <p className="text-xs text-muted-foreground italic">
                                  No payments recorded
                                </p>
                              ) : (
                                (paymentsByInvoice[invoice.id] || []).map(
                                  (payment) => (
                                    <div
                                      key={payment.id}
                                      className="flex items-center justify-between rounded-md bg-gradient-to-r from-success/5 to-success/10 px-3 py-2"
                                    >
                                      <div className="flex items-center gap-2 text-sm">
                                        <Receipt className="h-4 w-4 text-success-text flex-shrink-0" />
                                        {isOwner && (
                                          <span className="font-medium text-success-text">
                                            {formatCurrency(payment.amount)}
                                          </span>
                                        )}
                                        <span className="text-xs uppercase font-semibold text-muted-foreground">
                                          {payment.method}
                                        </span>
                                      </div>
                                      <span className="text-xs text-muted-foreground">
                                        {new Date(
                                          payment.paidAt,
                                        ).toLocaleDateString("en-ZA")}
                                      </span>
                                    </div>
                                  ),
                                )
                              )}
                            </div>
                            {invoice.status !== "draft" &&
                              totals.total > invoice.amountPaid && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="mt-3"
                                  onClick={() =>
                                    navigate(
                                      `/invoices/${invoice.id}#payment-follow-up`,
                                    )
                                  }
                                >
                                  Payment follow-up
                                </Button>
                              )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
        <TabsContent
          forceMount
          value="overview"
          className="data-[state=inactive]:hidden "
        >
          {visited.has("overview") && (
            <>
              <div className="grid gap-6 lg:grid-cols-3">
                {/* Client Info */}
                <div className="space-y-6 lg:col-span-2">
                  <Card className="border-border/50 shadow-md hover:shadow-lg transition-shadow overflow-hidden">
                    <CardHeader className="bg-gradient-to-r from-primary/5 to-accent/5 border-b border-border/50">
                      <CardTitle className="text-primary-text">
                        Contact Information
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-6 grid gap-5 sm:grid-cols-2">
                      <div className="flex items-start gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70">
                          <Building2 className="h-5 w-5 text-primary-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Business
                          </p>
                          <p className="font-semibold text-foreground mt-1">
                            {client.businessName}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent/70">
                          <MapPin className="h-5 w-5 text-accent-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Location
                          </p>
                          <p className="font-semibold text-foreground mt-1">
                            {client.location || "Not specified"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-info to-info/70">
                          <Phone className="h-5 w-5 text-white" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Phone
                          </p>
                          <a
                            href={`tel:${client.phone}`}
                            className="font-semibold text-primary-text hover:underline mt-1 block truncate"
                          >
                            {client.phone}
                          </a>
                        </div>
                      </div>
                      <div className="flex items-start gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-success to-success/70">
                          <Mail className="h-5 w-5 text-white" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Email
                          </p>
                          <a
                            href={`mailto:${client.email}`}
                            className="font-semibold text-primary-text hover:underline mt-1 block truncate"
                          >
                            {client.email}
                          </a>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Associated Leads */}
                  <Card className="border-border/50 shadow-md hover:shadow-lg transition-shadow overflow-hidden">
                    <CardHeader className="bg-gradient-to-r from-primary/5 to-accent/5 border-b border-border/50">
                      <CardTitle className="text-primary-text">
                        Associated Leads
                      </CardTitle>
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
                            const leadOwner = authService.getById(
                              lead.assignedTo,
                            );
                            return (
                              <div
                                key={lead.id}
                                className="flex cursor-pointer items-center justify-between rounded-lg border border-border/40 p-4 transition-all hover:bg-muted/50 hover:border-accent/50 hover:shadow-sm group"
                                onClick={() => navigate(`/leads/${lead.id}`)}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex-shrink-0">
                                    <User2 className="h-5 w-5 text-primary-text" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-semibold text-foreground group-hover:text-primary-text transition-colors truncate">
                                      {lead.businessName}
                                    </p>
                                    <p className="text-sm text-muted-foreground truncate">
                                      {lead.contactName}{" "}
                                      {leadOwner ? ` • ${leadOwner.name}` : ""}
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
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                  <Card className="border-border/50 shadow-md hover:shadow-lg transition-shadow overflow-hidden">
                    <CardHeader className="bg-gradient-to-r from-primary/5 to-accent/5 border-b border-border/50">
                      <CardTitle className="text-primary-text">
                        Onboarding summary
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-6 space-y-4">
                      <div
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${client.contractSigned ? "bg-success/5 border-success/30" : "bg-muted/30 border-border/40"}`}
                      >
                        {client.contractSigned ? (
                          <CheckCircle className="h-5 w-5 text-success-text flex-shrink-0" />
                        ) : (
                          <XCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        )}
                        <span
                          className={`font-medium ${client.contractSigned ? "text-success-text" : "text-muted-foreground"}`}
                        >
                          Contract Signed
                        </span>
                      </div>
                      <div
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${client.onboardingCompleted ? "bg-success/5 border-success/30" : "bg-muted/30 border-border/40"}`}
                      >
                        {client.onboardingCompleted ? (
                          <CheckCircle className="h-5 w-5 text-success-text" />
                        ) : (
                          <XCircle className="h-5 w-5 text-muted-foreground" />
                        )}
                        <a
                          href="#client-onboarding"
                          className="font-medium text-primary-text hover:underline"
                        >
                          {client.onboardingCompleted
                            ? "Onboarding complete"
                            : "Review onboarding checklist"}
                        </a>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-border/50 shadow-md hover:shadow-lg transition-shadow overflow-hidden">
                    <CardHeader className="bg-gradient-to-r from-primary/5 to-accent/5 border-b border-border/50">
                      <CardTitle className="text-primary-text">
                        {isOwner ? "Financials" : "Overview"}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-6 space-y-4">
                      {isOwner && (
                        <>
                          <div className="rounded-lg bg-gradient-to-br from-accent/10 to-accent/5 p-4 border border-accent/30">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Total Spent
                            </p>
                            <p className="text-3xl font-bold text-accent-text mt-2">
                              {formatCurrency(totalSpent)}
                            </p>
                          </div>
                          <div
                            className={`rounded-lg bg-gradient-to-br ${outstanding > 0 ? "from-destructive/10 to-destructive/5" : "from-success/10 to-success/5"} p-4 border ${outstanding > 0 ? "border-destructive/30" : "border-success/30"}`}
                          >
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Outstanding
                            </p>
                            <p
                              className={`text-2xl font-bold mt-2 ${outstanding > 0 ? "text-destructive-text" : "text-success-text"}`}
                            >
                              {formatCurrency(outstanding)}
                            </p>
                          </div>
                        </>
                      )}
                      <div className="rounded-lg border border-border/40 p-3 hover:bg-muted/30 transition-colors">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Industry
                        </p>
                        <p className="font-semibold text-foreground mt-1">
                          {client.industry || "Not specified"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/40 p-3 hover:bg-muted/30 transition-colors">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Client Since
                        </p>
                        <p className="font-semibold text-foreground mt-1">
                          {new Date(client.createdAt).toLocaleDateString(
                            "en-ZA",
                            {
                              day: "numeric",
                              month: "long",
                              year: "numeric",
                            },
                          )}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

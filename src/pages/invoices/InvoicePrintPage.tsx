import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { InvoicePrintView } from '@/components/invoices/InvoicePrintView';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { canAccessInvoice } from '@/lib/permissions';
import { clientService, invoiceService, leadService, paymentService, projectService } from '@/services';
import { Client, Invoice, Lead, Payment, Project } from '@/types/models';

const sanitizeFilenameSegment = (value: string): string =>
  value
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export function InvoicePrintPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isOwner } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [invoice, setInvoice] = useState<Invoice | undefined>(undefined);
  const [client, setClient] = useState<Client | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasAutoPrinted = useRef(false);
  const originalTitleRef = useRef<string>('');

  useEffect(() => {
    if (!originalTitleRef.current) {
      originalTitleRef.current = document.title;
    }

    return () => {
      if (originalTitleRef.current) {
        document.title = originalTitleRef.current;
      }
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadInvoiceData = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const [loadedInvoice, leads, clients, projects] = await Promise.all([
          invoiceService.getById(id || ''),
          leadService.getAll(),
          clientService.getAll(),
          projectService.getAll(),
        ]);

        if (!isMounted) return;
        setInvoice(loadedInvoice);
        setAllLeads(leads);
        setAllClients(clients);
        setAllProjects(projects);

        if (!loadedInvoice) {
          setClient(null);
          setProject(null);
          setPayments([]);
          return;
        }

        const [loadedClient, loadedProject, loadedPayments] = await Promise.all([
          clientService.getById(loadedInvoice.clientId),
          loadedInvoice.projectId ? projectService.getById(loadedInvoice.projectId) : Promise.resolve(undefined),
          paymentService.getByInvoice(loadedInvoice.id),
        ]);

        if (!isMounted) return;
        setClient(loadedClient || null);
        setProject(loadedProject || null);
        setPayments(loadedPayments.sort((a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime()));
      } catch {
        if (isMounted) {
          setLoadError('Failed to load invoice print data. Please try again.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadInvoiceData();
    return () => {
      isMounted = false;
    };
  }, [id]);

  const canViewInvoice = useMemo(
    () => canAccessInvoice(user, invoice, allLeads, allClients, allProjects),
    [allClients, allLeads, allProjects, invoice, user]
  );

  useEffect(() => {
    if (!invoice) {
      document.title = 'Invoice Print | Khulisa Grow CRM';
      return;
    }

    const clientName = sanitizeFilenameSegment(client?.businessName || 'Client');
    const invoiceNumber = sanitizeFilenameSegment(invoice.invoiceNumber || 'Invoice');
    document.title = `${clientName} - ${invoiceNumber}`;
  }, [client?.businessName, invoice]);

  useEffect(() => {
    if (!isOwner || !invoice || !canViewInvoice || hasAutoPrinted.current) return;

    const timeout = window.setTimeout(() => {
      hasAutoPrinted.current = true;
      window.print();
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [canViewInvoice, invoice, isOwner]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/20 px-4">
        <p className="text-sm text-muted-foreground">Loading invoice print view...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/20 px-4">
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate(`/invoices/${id}`)}>
            Back to Invoice
          </Button>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/20 px-4">
        <p className="text-sm text-muted-foreground">Invoice not found.</p>
        <Button variant="outline" onClick={() => navigate('/invoices')}>
          Back to Invoices
        </Button>
      </div>
    );
  }

  if (!canViewInvoice) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/20 px-4">
        <p className="text-sm text-muted-foreground">You do not have permission to view this invoice.</p>
        <Button variant="outline" onClick={() => navigate('/invoices')}>
          Back to Invoices
        </Button>
      </div>
    );
  }

  return (
    <InvoicePrintView
      invoice={invoice}
      client={client}
      project={project}
      payments={payments}
      isOwner={isOwner}
      onBack={() => navigate(`/invoices/${invoice.id}`)}
      onPrint={isOwner ? () => window.print() : undefined}
    />
  );
}

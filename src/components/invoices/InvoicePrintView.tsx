import { Button } from '@/components/ui/button';
import { getPackageNameById } from '@/config/packages';
import { buildProjectLookup, getInvoiceEffectiveTotals } from '@/lib/invoiceTotals';
import { INVOICE_STATUSES, Client, Invoice, Payment, Project } from '@/types/models';

const KHULISA_IDENTITY_LINE = 'Khulisa Media | Reg No: 2025/065968/07 | POPIA Registration No.: 2025-065968';
const KHULISA_CONTACT_LINE = 'info@khulisamedia.co.za | www.khulisamedia.co.za | 063 031 0393';
const KHULISA_TAGLINE = 'Serve with care. Create with strategy. Grow with purpose.';
const CONFIDENTIALITY_NOTICE = 'This document is confidential and prepared exclusively for the intended recipient.';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(amount);
};

const formatDate = (value?: string) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString('en-ZA');
};

interface InvoicePrintViewProps {
  invoice: Invoice;
  client: Client | null;
  project: Project | null;
  payments: Payment[];
  isOwner: boolean;
  onBack: () => void;
  onPrint?: () => void;
}

export function InvoicePrintView({
  invoice,
  client,
  project,
  payments,
  isOwner,
  onBack,
  onPrint,
}: InvoicePrintViewProps) {
  const projectLookup = buildProjectLookup(project ? [project] : []);
  const totals = getInvoiceEffectiveTotals(invoice, projectLookup);
  const totalPayments = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const balanceDue = Math.max(totals.total - totalPayments, 0);
  const statusLabel = INVOICE_STATUSES[invoice.status]?.label ?? invoice.status;
  const packageName = project
    ? getPackageNameById(project.packageId)
    : invoice.packageName || getPackageNameById(invoice.packageId);

  return (
    <div className="invoice-print-page min-h-screen bg-muted/20 px-4 py-6 md:px-8">
      <div className="no-print mx-auto mb-4 flex w-full max-w-5xl items-center justify-between gap-3">
        <Button variant="outline" onClick={onBack}>
          Back to Invoice
        </Button>
        {isOwner && onPrint && <Button onClick={onPrint}>Print Invoice</Button>}
      </div>

      <article className="invoice-print-document mx-auto w-full max-w-5xl rounded-xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm md:p-10">
        <header className="border-b border-slate-200 pb-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-[240px] flex-1">
              <img
                src="/images/khulisa-logo.png"
                alt="Khulisa Media logo"
                className="mb-3 h-14 w-auto object-contain"
              />
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{KHULISA_IDENTITY_LINE}</p>
            </div>
            <div className="min-w-[260px] text-sm text-slate-700 md:text-right">
              <p className="font-semibold text-slate-900">Khulisa Media</p>
              <p className="mt-1">{KHULISA_CONTACT_LINE}</p>
            </div>
          </div>
          <p className="mt-4 border-l-4 border-accent pl-3 text-sm italic text-slate-600">{KHULISA_TAGLINE}</p>
        </header>

        <section className="mt-8 grid gap-6 md:grid-cols-[1fr_auto]">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">From</p>
              <h2 className="mt-1 text-base font-semibold text-slate-900">Khulisa Media</h2>
              <p className="mt-2 text-sm text-slate-700">{KHULISA_CONTACT_LINE}</p>
              <p className="mt-1 text-xs text-slate-500">{KHULISA_IDENTITY_LINE}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bill To</p>
              <h2 className="mt-1 text-base font-semibold text-slate-900">{client?.businessName || 'Unknown client'}</h2>
              <p className="mt-2 text-sm text-slate-700">Contact: {client?.ownerName || 'N/A'}</p>
              <p className="text-sm text-slate-700">Email: {client?.email || 'N/A'}</p>
              <p className="text-sm text-slate-700">Phone: {client?.phone || 'N/A'}</p>
              <p className="text-sm text-slate-700">Address: {client?.location || 'N/A'}</p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 md:min-w-[220px]">
            <p className="text-3xl font-bold tracking-tight text-primary">INVOICE</p>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Number</dt>
                <dd className="font-medium text-slate-900">{invoice.invoiceNumber}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Invoice Date</dt>
                <dd className="font-medium text-slate-900">{formatDate(invoice.issuedDate)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Due Date</dt>
                <dd className="font-medium text-slate-900">{formatDate(invoice.dueDate)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Status</dt>
                <dd className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{statusLabel}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-slate-200 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Project Information</h3>
          <div className="mt-3 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
            <p>
              <span className="font-semibold text-slate-900">Project Name:</span> {project?.name || 'Unlinked'}
            </p>
            <p>
              <span className="font-semibold text-slate-900">Project Reference:</span> {project?.id || 'N/A'}
            </p>
            <p>
              <span className="font-semibold text-slate-900">Service / Package:</span> {packageName || 'N/A'}
            </p>
            <p>
              <span className="font-semibold text-slate-900">Project Start:</span> {formatDate(project?.startDate)}
            </p>
          </div>
        </section>

        <section className="mt-6 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Description</th>
                {isOwner && <th className="px-4 py-3 text-right font-semibold">Quantity</th>}
                {isOwner && <th className="px-4 py-3 text-right font-semibold">Unit Price</th>}
                {isOwner && <th className="px-4 py-3 text-right font-semibold">Line Total</th>}
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => (
                <tr key={item.id} className="border-t border-slate-200">
                  <td className="px-4 py-3">{item.description}</td>
                  {isOwner && <td className="px-4 py-3 text-right">{item.quantity}</td>}
                  {isOwner && <td className="px-4 py-3 text-right">{formatCurrency(item.unitPrice)}</td>}
                  {isOwner && <td className="px-4 py-3 text-right font-medium">{formatCurrency(item.total)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes / Payment Instructions</h3>
              <p className="mt-2 text-sm text-slate-700">
                Please use <span className="font-semibold">{invoice.invoiceNumber}</span> as your payment reference.
              </p>
              {invoice.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{invoice.notes}</p>}
            </div>

            <div className="rounded-lg border border-slate-200 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payments Recorded</h3>
              {payments.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">No payments recorded yet.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {payments.map((payment) => (
                    <li key={payment.id}>
                      {formatDate(payment.paidAt)} | {payment.method.toUpperCase()} | {isOwner ? formatCurrency(payment.amount) : 'Amount hidden'}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <aside className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Summary</h3>
            {isOwner ? (
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-600">Subtotal</dt>
                  <dd className="font-medium text-slate-900">{formatCurrency(totals.subtotal)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-600">Tax / VAT</dt>
                  <dd className="font-medium text-slate-900">{formatCurrency(totals.tax)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-2">
                  <dt className="font-semibold text-slate-800">Total</dt>
                  <dd className="font-semibold text-slate-900">{formatCurrency(totals.total)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-600">Amount Paid</dt>
                  <dd className="font-medium text-slate-900">{formatCurrency(totalPayments)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-600">Balance Due</dt>
                  <dd className="font-semibold text-destructive">{formatCurrency(balanceDue)}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-3 text-sm text-slate-600">
                Monetary fields are restricted for agent accounts. Please contact an owner for billing totals.
              </p>
            )}
            {isOwner && payments.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                Total payments recorded: {formatCurrency(totalPayments)}
              </p>
            )}
          </aside>
        </section>

        <footer className="mt-8 border-t border-slate-200 pt-4">
          <p className="text-xs text-slate-500">{CONFIDENTIALITY_NOTICE}</p>
        </footer>
      </article>
    </div>
  );
}

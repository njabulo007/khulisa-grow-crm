import { KHULISA_BANKING } from '@/config/banking';

export function InvoiceBankDetails({ invoiceNumber }: { invoiceNumber: string }) {
  const rows = [
    ['Bank name', KHULISA_BANKING.bankName],
    ['Account holder', KHULISA_BANKING.accountHolder],
    ['Account number', KHULISA_BANKING.accountNumber],
    ['Branch code', KHULISA_BANKING.branchCode],
    ['Account type', KHULISA_BANKING.accountType],
    ['Payment reference', invoiceNumber],
  ];
  return <div>
    <dl className="space-y-2 text-sm">
      {rows.map(([label, value]) => <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-3">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="break-words font-medium tabular-nums">{value}</dd>
      </div>)}
    </dl>
    <p className="mt-4 text-xs text-muted-foreground">Please use the invoice number as your EFT payment reference.</p>
  </div>;
}

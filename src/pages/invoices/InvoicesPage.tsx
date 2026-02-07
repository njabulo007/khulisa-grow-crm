import React from 'react';
import { PageHeader } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';

export function InvoicesPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Invoices" description="Manage billing and payments" />
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Invoices module - Coming soon. Navigate from Clients to see invoices.
        </CardContent>
      </Card>
    </div>
  );
}

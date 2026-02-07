import React from 'react';
import { PageHeader } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';

export function CommissionsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Commissions" description="Track agent earnings" />
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Commissions module - Coming soon.
        </CardContent>
      </Card>
    </div>
  );
}

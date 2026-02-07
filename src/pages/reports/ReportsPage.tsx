import React from 'react';
import { PageHeader } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';

export function ReportsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Reports" description="Business analytics and insights" />
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Reports module - Coming soon.
        </CardContent>
      </Card>
    </div>
  );
}

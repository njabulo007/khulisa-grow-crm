import React from 'react';
import { PageHeader } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ProjectsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Projects" description="Track your project deliverables" />
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Projects module - Coming soon. Navigate from Clients to see projects.
        </CardContent>
      </Card>
    </div>
  );
}

import React from 'react';
import { PageHeader } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';

export function SettingsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Settings" description="Manage your CRM settings" />
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Settings module - Coming soon.
        </CardContent>
      </Card>
    </div>
  );
}

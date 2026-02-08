import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';

export function SettingsPage() {
  const navigate = useNavigate();
  const { isOwner } = useAuth();

  if (!isOwner) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader title="Settings" description="Manage your CRM settings" />
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Only owners can change global settings.</p>
            <Button variant="link" onClick={() => navigate('/')}>
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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

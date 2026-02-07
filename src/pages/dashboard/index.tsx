import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { OwnerDashboard } from './OwnerDashboard';
import { AgentDashboard } from './AgentDashboard';

export function Dashboard() {
  const { isOwner, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
      </div>
    );
  }

  return isOwner ? <OwnerDashboard /> : <AgentDashboard />;
}

export { OwnerDashboard } from './OwnerDashboard';
export { AgentDashboard } from './AgentDashboard';

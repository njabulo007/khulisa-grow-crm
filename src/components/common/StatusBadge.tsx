import React from 'react';
import { cn } from '@/lib/utils';
import { LeadStage, InvoiceStatus, ProjectStatus, CommissionStatus, LEAD_STAGES, INVOICE_STATUSES, PROJECT_STATUSES } from '@/types/models';

interface StatusBadgeProps {
  status: LeadStage | InvoiceStatus | ProjectStatus | CommissionStatus | string;
  type: 'lead' | 'invoice' | 'project' | 'commission';
  className?: string;
}

export function StatusBadge({ status, type, className }: StatusBadgeProps) {
  const getConfig = () => {
    switch (type) {
      case 'lead':
        return LEAD_STAGES[status as LeadStage] || { label: status, color: 'muted' };
      case 'invoice':
        return INVOICE_STATUSES[status as InvoiceStatus] || { label: status, color: 'muted' };
      case 'project':
        return PROJECT_STATUSES[status as ProjectStatus] || { label: status, color: 'muted' };
      case 'commission':
        switch (status) {
          case 'pending':
            return { label: 'Pending', color: 'warning' };
          case 'earned':
            return { label: 'Earned', color: 'success' };
          case 'paid-out':
            return { label: 'Paid Out', color: 'info' };
          default:
            return { label: status, color: 'muted' };
        }
      default:
        return { label: status, color: 'muted' };
    }
  };

  const config = getConfig();

  const colorClasses: Record<string, string> = {
    info: 'bg-info/10 text-info border-info/20',
    primary: 'bg-primary/10 text-primary border-primary/20',
    warning: 'bg-warning/10 text-warning border-warning/20',
    accent: 'bg-accent/20 text-accent-foreground border-accent/30',
    success: 'bg-success/10 text-success border-success/20',
    destructive: 'bg-destructive/10 text-destructive border-destructive/20',
    muted: 'bg-muted text-muted-foreground border-border',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        colorClasses[config.color] || colorClasses.muted,
        className
      )}
    >
      {config.label}
    </span>
  );
}

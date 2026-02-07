import React, { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  trend?: {
    value: number;
    label: string;
  };
  variant?: 'default' | 'gold' | 'blue' | 'success' | 'warning';
  className?: string;
}

export function KPICard({
  title,
  value,
  subtitle,
  icon,
  trend,
  variant = 'default',
  className,
}: KPICardProps) {
  const isGradient = variant !== 'default';

  const getTrendIcon = () => {
    if (!trend) return null;
    if (trend.value > 0) return <TrendingUp className="h-3 w-3" />;
    if (trend.value < 0) return <TrendingDown className="h-3 w-3" />;
    return <Minus className="h-3 w-3" />;
  };

  const getTrendColor = () => {
    if (!trend) return '';
    if (isGradient) return trend.value >= 0 ? 'text-white/90' : 'text-white/70';
    return trend.value > 0 ? 'text-success' : trend.value < 0 ? 'text-destructive' : 'text-muted-foreground';
  };

  if (isGradient) {
    return (
      <div
        className={cn(
          'kpi-card',
          variant === 'gold' && 'kpi-card-gold',
          variant === 'blue' && 'kpi-card-blue',
          variant === 'success' && 'kpi-card-success',
          variant === 'warning' && 'kpi-card-warning',
          className
        )}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-white/80">{title}</p>
            <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
            {subtitle && (
              <p className="mt-1 text-sm text-white/70">{subtitle}</p>
            )}
          </div>
          {icon && (
            <div className="rounded-lg bg-white/20 p-2">
              {icon}
            </div>
          )}
        </div>
        {trend && (
          <div className={cn('mt-3 flex items-center gap-1 text-sm', getTrendColor())}>
            {getTrendIcon()}
            <span>{Math.abs(trend.value)}%</span>
            <span className="text-white/60">{trend.label}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border bg-card p-5 card-hover', className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">{value}</p>
          {subtitle && (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {icon && (
          <div className="rounded-lg bg-muted p-2 text-muted-foreground">
            {icon}
          </div>
        )}
      </div>
      {trend && (
        <div className={cn('mt-3 flex items-center gap-1 text-sm', getTrendColor())}>
          {getTrendIcon()}
          <span>{Math.abs(trend.value)}%</span>
          <span className="text-muted-foreground">{trend.label}</span>
        </div>
      )}
    </div>
  );
}

import { memo, type ReactNode } from 'react';

interface MetricCardProps {
  title: string;
  value: string | number;
  unit?: string;
  trend?: { value: number; direction: 'up' | 'down' };
  // Whether "up" is good for this metric (skip rate: no). Sets the trend's
  // icon wording; color stays text ink.
  upIsGood?: boolean;
  note?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
}

// One KPI: label, the number, and its change since the previous value.
function MetricCardImpl({ title, value, unit, trend, upIsGood = true, note, icon, loading, error }: MetricCardProps) {
  if (loading)
    return (
      <div className="card p-4 animate-pulse" aria-busy="true">
        <div className="h-3 w-24 rounded" style={{ background: 'var(--grid)' }} />
        <div className="h-8 w-16 rounded mt-3" style={{ background: 'var(--grid)' }} />
      </div>
    );
  if (error)
    return (
      <div role="alert" className="card p-4 text-sm" style={{ background: 'var(--critical-wash)' }}>
        <p className="font-medium">{title}</p>
        <p className="secondary">⚠ {error}</p>
      </div>
    );
  const good = trend ? (trend.direction === 'up') === upIsGood : null;
  return (
    <section className="card p-4" aria-label={title}>
      <div className="flex justify-between items-start gap-2">
        <p className="text-sm font-medium secondary">{title}</p>
        {icon && (
          <span className="text-xl opacity-40" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <p className="text-3xl font-semibold mt-2 tabular">
        {value}
        {unit && <span className="text-base secondary ml-1">{unit}</span>}
      </p>
      {trend && Number.isFinite(trend.value) && (
        <p className="text-sm mt-1 tabular" style={{ color: good ? 'var(--good)' : 'var(--text-secondary)' }}>
          {trend.direction === 'up' ? '↑' : '↓'} {Math.abs(trend.value).toFixed(1)}% <span className="muted">vs previous</span>
        </p>
      )}
      {note && <p className="text-xs muted mt-1">{note}</p>}
    </section>
  );
}
export const MetricCard = memo(MetricCardImpl);

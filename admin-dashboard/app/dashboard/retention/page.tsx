'use client';
import { useMemo } from 'react';
import { Grid, Page } from '@/components/Page';
import { MetricCard } from '@/components/MetricCard';
import { BarsChart, TrendChart } from '@/components/Chart';
import { ListenerError } from '@/components/AlertBanner';
import { useAppMetrics, useRetentionCohorts } from '@/lib/listeners';
import { pct } from '@/lib/metrics';
import type { AppMetricCard } from '@/lib/types';

// The headline Day 1/7/30 numbers are the Academy tab's (app_metrics/latest),
// so both pages show the same value; the cohort docs below use the same rule.
const pctOf = (m?: AppMetricCard) => (m && typeof m.value === 'number' ? `${m.value}%` : '—');
const basedOn = (m?: AppMetricCard) => (m ? `${m.n ?? 0} users old enough` : 'No snapshot yet');

export default function Retention() {
  const { data, loading, error } = useRetentionCohorts(91);
  const app = useAppMetrics();
  const card = (id: string) => app.data?.metrics.find((m) => m.id === id);
  const [d1, d7, d30] = ['retentionD1', 'retentionD7', 'retentionD30'].map(card);
  const withUsers = data.filter((c) => c.day_0 > 0);
  const latest = withUsers[withUsers.length - 1];
  const lastChurn = [...withUsers].reverse().find((c) => c.churn_rate != null);
  const bars = latest ? [{ day: 'Day 0', users: latest.day_0 }, { day: 'Day 7', users: latest.day_7 }, { day: 'Day 30', users: latest.day_30 }, { day: 'Day 90', users: latest.day_90 }] : [];
  const trend = useMemo(() => withUsers.slice(-10).map((c) => ({ date: c.cohort_date, retention_7_day: c.retention_7_day, retention_30_day: c.retention_30_day })), [withUsers]);
  return (
    <Page title="Retention" subtitle="Accounts created since open tracking began, founder and family left out. Day N = opened the app on day N after sign-up (UTC sign-up day). Churn = no app open in the last 14 days.">
      <ListenerError error={error || app.error} />
      <Grid>
        <MetricCard title="Day 1 retention" value={pctOf(d1)} note={basedOn(d1)} loading={app.loading} />
        <MetricCard title="Day 7 retention" value={pctOf(d7)} note={basedOn(d7)} loading={app.loading} />
        <MetricCard title="Day 30 retention" value={pctOf(d30)} note={basedOn(d30)} loading={app.loading} />
        <MetricCard title="Churn" value={pct(lastChurn?.churn_rate)} upIsGood={false} note={lastChurn ? `Cohort ${lastChurn.cohort_date}` : undefined} loading={loading} />
        <MetricCard title="Latest cohort" value={latest?.day_0 ?? '—'} unit="users" note={latest?.cohort_date} loading={loading} />
      </Grid>
      <BarsChart title={`Latest cohort${latest ? ` (${latest.cohort_date})` : ''}`} data={bars} xKey="day" series={[{ key: 'users', label: 'Users' }]} />
      <TrendChart title="Retention, last 10 cohorts" data={trend} series={[{ key: 'retention_7_day', label: '7-day' }, { key: 'retention_30_day', label: '30-day' }]} format={(v) => pct(v, 0)} domain={[0, 1]} />
    </Page>
  );
}

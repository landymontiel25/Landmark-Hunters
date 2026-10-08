'use client';
import { useMemo } from 'react';
import { Grid, Page } from '@/components/Page';
import { MetricCard } from '@/components/MetricCard';
import { BarsChart, TrendChart } from '@/components/Chart';
import { ListenerError } from '@/components/AlertBanner';
import { useRetentionCohorts } from '@/lib/listeners';
import { pct } from '@/lib/metrics';

export default function Retention() {
  const { data, loading, error } = useRetentionCohorts(91);
  const withUsers = data.filter((c) => c.day_0 > 0);
  const latest = withUsers[withUsers.length - 1];
  // The newest cohort old enough for each number.
  const last7 = [...withUsers].reverse().find((c) => c.retention_7_day != null);
  const last30 = [...withUsers].reverse().find((c) => c.retention_30_day != null);
  const lastChurn = [...withUsers].reverse().find((c) => c.churn_rate != null);
  const bars = latest ? [{ day: 'Day 0', users: latest.day_0 }, { day: 'Day 7', users: latest.day_7 }, { day: 'Day 30', users: latest.day_30 }, { day: 'Day 90', users: latest.day_90 }] : [];
  const trend = useMemo(() => withUsers.slice(-10).map((c) => ({ date: c.cohort_date, retention_7_day: c.retention_7_day, retention_30_day: c.retention_30_day })), [withUsers]);
  return (
    <Page title="Retention" subtitle="Cohorts by sign-up day (UTC). Day N = still opening the app on or after day N. Churn = no app open in the last 14 days.">
      <ListenerError error={error} />
      <Grid>
        <MetricCard title="7-day retention" value={pct(last7?.retention_7_day)} note={last7 ? `Cohort ${last7.cohort_date}` : 'No cohort old enough yet'} loading={loading} />
        <MetricCard title="30-day retention" value={pct(last30?.retention_30_day)} note={last30 ? `Cohort ${last30.cohort_date}` : 'No cohort old enough yet'} loading={loading} />
        <MetricCard title="Churn" value={pct(lastChurn?.churn_rate)} upIsGood={false} note={lastChurn ? `Cohort ${lastChurn.cohort_date}` : undefined} loading={loading} />
        <MetricCard title="Latest cohort" value={latest?.day_0 ?? '—'} unit="users" note={latest?.cohort_date} loading={loading} />
      </Grid>
      <BarsChart title={`Latest cohort${latest ? ` (${latest.cohort_date})` : ''}`} data={bars} xKey="day" series={[{ key: 'users', label: 'Users' }]} />
      <TrendChart title="Retention, last 10 cohorts" data={trend} series={[{ key: 'retention_7_day', label: '7-day' }, { key: 'retention_30_day', label: '30-day' }]} format={(v) => pct(v, 0)} domain={[0, 1]} />
    </Page>
  );
}

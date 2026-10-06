'use client';
import { useMemo } from 'react';
import { Grid, Page, Two } from '@/components/Page';
import { MetricCard } from '@/components/MetricCard';
import { BarsChart, TrendChart } from '@/components/Chart';
import { ListenerError } from '@/components/AlertBanner';
import { useGrowthMetrics } from '@/lib/listeners';
import { trendOf } from '@/lib/metrics';

export default function Growth() {
  const { data, loading, error } = useGrowthMetrics(30);
  const rows = data as unknown as Record<string, unknown>[];
  const g = data[data.length - 1];
  const prev = data[data.length - 2];
  const growthRate = g && prev && prev.new_users > 0 ? ((g.new_users - prev.new_users) / prev.new_users) * 100 : null;
  const short = useMemo(() => rows.map((r) => ({ ...r, day: String(r.date).slice(5) })), [rows]);
  return (
    <Page title="Growth" subtitle="Last 30 days, UTC. Active users = opened the app that day.">
      <ListenerError error={error} />
      <Grid>
        <MetricCard title="Active users" value={g?.active_users ?? '—'} trend={trendOf(rows, 'active_users')} loading={loading} />
        <MetricCard title="New users" value={g?.new_users ?? '—'} trend={trendOf(rows, 'new_users')} loading={loading} />
        <MetricCard title="Landmarks visited" value={g?.landmarks_visited ?? '—'} note={g ? `${g.total_landmarks_visited_cumulative} all time` : undefined} trend={trendOf(rows, 'landmarks_visited')} loading={loading} />
        <MetricCard title="Growth rate" value={growthRate == null ? '—' : `${growthRate >= 0 ? '+' : ''}${growthRate.toFixed(0)}%`} note="New users vs the day before" loading={loading} />
      </Grid>
      <Two>
        <TrendChart title="Active users (30 days)" data={rows} series={[{ key: 'active_users', label: 'Active users' }]} />
        <BarsChart title="New users (30 days)" data={short} xKey="day" series={[{ key: 'new_users', label: 'New users' }]} />
        <TrendChart title="Landmarks visited, cumulative" data={rows} series={[{ key: 'total_landmarks_visited_cumulative', label: 'Visits, all time' }]} />
        <BarsChart title="Repeat landmark visits (30 days)" data={short} xKey="day" series={[{ key: 'repeat_landmark_visits', label: 'Repeat visits' }]} />
      </Two>
    </Page>
  );
}

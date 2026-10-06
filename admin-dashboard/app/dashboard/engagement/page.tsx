'use client';
import { useMemo } from 'react';
import { Grid, Page, Two } from '@/components/Page';
import { MetricCard } from '@/components/MetricCard';
import { BarsChart, TrendChart } from '@/components/Chart';
import { ListenerError } from '@/components/AlertBanner';
import { useEngagementMetrics } from '@/lib/listeners';
import { num, pct, trendOf } from '@/lib/metrics';

export default function Engagement() {
  const { data, loading, error } = useEngagementMetrics(30);
  const week = useMemo(() => data.slice(-7) as unknown as Record<string, unknown>[], [data]);
  const e = data[data.length - 1];
  // Ratings over the last 7 days, by stars. The app rates in three tiers
  // (1, 3 and 5 stars), so 2 and 4 stay empty.
  const dist = useMemo(() => {
    const sum: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const d of data.slice(-7)) for (const [k, v] of Object.entries(d.rating_distribution || {})) sum[k] = (sum[k] || 0) + (v || 0);
    return Object.entries(sum).map(([stars, count]) => ({ stars: `${stars}★`, count }));
  }, [data]);
  return (
    <Page title="Engagement" subtitle="Tap to visit = “I'd go” taps followed by a check-in within 7 days. Skip = shown picks with no tap, visit or rating within 7 days.">
      <ListenerError error={error} />
      <Grid>
        <MetricCard title="Avg dwell time" value="Not tracked" note="The app records arrivals, not departures" loading={loading} />
        <MetricCard title="Tap to visit" value={pct(e?.tap_to_visit_rate)} trend={trendOf(week, 'tap_to_visit_rate')} loading={loading} />
        <MetricCard title="Skip rate" value={pct(e?.skip_rate)} trend={trendOf(week, 'skip_rate')} upIsGood={false} loading={loading} />
        <MetricCard title="Avg rating" value={num(e?.avg_rating, 2)} unit="/ 5" trend={trendOf(week, 'avg_rating')} loading={loading} />
      </Grid>
      <Two>
        <TrendChart title="Tap to visit and skip (7 days)" data={week} series={[{ key: 'tap_to_visit_rate', label: 'Tap to visit' }, { key: 'skip_rate', label: 'Skip' }]} format={(v) => pct(v, 0)} domain={[0, 1]} />
        <TrendChart title="Average rating (7 days)" data={week} series={[{ key: 'avg_rating', label: 'Avg rating' }]} format={(v) => num(v, 1)} domain={[1, 5]} />
      </Two>
      <BarsChart title="Rating distribution, last 7 days" data={dist} xKey="stars" series={[{ key: 'count', label: 'Ratings' }]} />
    </Page>
  );
}

'use client';
import { useMemo } from 'react';
import { Grid, Page, Two } from '@/components/Page';
import { MetricCard } from '@/components/MetricCard';
import { TrendChart } from '@/components/Chart';
import { ListenerError } from '@/components/AlertBanner';
import { RealtimeStatus } from '@/components/RealtimeStatus';
import { useEngagementMetrics, useGrowthMetrics, useMaprMetrics } from '@/lib/listeners';
import { num, pct, trendOf } from '@/lib/metrics';

export default function Overview() {
  const mapr = useMaprMetrics(7);
  const growth = useGrowthMetrics(7);
  const engagement = useEngagementMetrics(7);
  const g = growth.data[growth.data.length - 1];
  const e = engagement.data[engagement.data.length - 1];
  const m = mapr.data[mapr.data.length - 1];
  const series = useMemo(() => mapr.data as unknown as Record<string, unknown>[], [mapr.data]);
  return (
    <Page title="Overview" subtitle={`Latest day: ${m?.date || g?.date || '—'}. Every number updates by itself when the nightly job writes.`}>
      <ListenerError error={mapr.error || growth.error || engagement.error} />
      <Grid>
        <MetricCard title="Active users" value={g?.active_users ?? '—'} trend={trendOf(growth.data as never, 'active_users')} loading={growth.loading} />
        <MetricCard title="New users" value={g?.new_users ?? '—'} trend={trendOf(growth.data as never, 'new_users')} loading={growth.loading} />
        <MetricCard title="Average rating" value={num(e?.avg_rating, 2)} unit="/ 5" trend={trendOf(engagement.data as never, 'avg_rating')} note={e ? `${e.ratings} ratings that day` : undefined} loading={engagement.loading} />
        <MetricCard title="Mapr match rate" value={pct(m?.match_rate)} trend={trendOf(series, 'match_rate')} note="Target 75%" loading={mapr.loading} />
      </Grid>
      <TrendChart
        title="Mapr rates, last 7 days"
        data={series}
        series={[
          { key: 'match_rate', label: 'Match' },
          { key: 'skip_rate', label: 'Skip' },
          { key: 'repeat_rate', label: 'Repeat' },
        ]}
        format={(v) => pct(v, 0)}
        domain={[0, 1]}
      />
      <Two>
        <section className="card p-4 space-y-2" aria-label="A/B test">
          <h2 className="font-medium">Mapr A/B test (NCF)</h2>
          {m ? (
            <dl className="grid grid-cols-2 gap-2 text-sm tabular">
              <dt className="secondary">Control</dt>
              <dd>
                {pct(m.a_b_control_rate)} of {m.a_b_control_n} picks
              </dd>
              <dt className="secondary">Treatment</dt>
              <dd>
                {pct(m.a_b_treatment_rate)} of {m.a_b_treatment_n} picks
              </dd>
              <dt className="secondary">Running</dt>
              <dd>{m.a_b_days} days</dd>
              <dt className="secondary">p-value</dt>
              <dd>{m.a_b_p_value ?? '—'}</dd>
            </dl>
          ) : (
            <p className="text-sm muted">No report yet.</p>
          )}
          <p className="text-xs muted">Every component is at 100% rollout while the app has two users, so there is no control group yet.</p>
        </section>
        <section className="card p-4" aria-label="Listener health">
          <h2 className="font-medium mb-2">Listener health</h2>
          <RealtimeStatus detail />
        </section>
      </Two>
    </Page>
  );
}

'use client';
import { useMemo } from 'react';
import { Grid, Page, Two } from '@/components/Page';
import { MetricCard } from '@/components/MetricCard';
import { TrendChart } from '@/components/Chart';
import { AlertBanner, ListenerError } from '@/components/AlertBanner';
import { MaprV2Rollout } from '@/components/MaprV2Rollout';
import { useMaprMetrics, useMaprNCFModel, useMaprSimilarity } from '@/lib/listeners';
import { bytes, deviationAlerts, num, pct, trendOf, when } from '@/lib/metrics';

export default function MaprPhase1() {
  const mapr = useMaprMetrics(14);
  const ncf = useMaprNCFModel();
  const sim = useMaprSimilarity();
  const series = useMemo(() => mapr.data.slice(-8) as unknown as Record<string, unknown>[], [mapr.data]);
  const m = mapr.data[mapr.data.length - 1];
  const alerts = useMemo(
    () => [
      ...deviationAlerts(series, [
        { key: 'match_rate', label: 'Match rate' },
        { key: 'skip_rate', label: 'Skip rate' },
        { key: 'repeat_rate', label: 'Repeat rate' },
        { key: 'novelty_percentage', label: 'Novelty' },
      ]),
      ...(m?.alerts || []),
    ],
    [series, m]
  );
  const ab = m?.experiments?.ncf;
  const n = ncf.data;
  const s = sim.data;
  return (
    <Page title="Mapr Phase 1" subtitle="Distance decay, item-item similarity, the NCF model and exploration. A red warning means a metric moved more than 20% from its 7-day average, or the nightly job raised an alert.">
      <ListenerError error={mapr.error || ncf.error || sim.error} />
      <AlertBanner items={alerts} />
      <Grid>
        <MetricCard title="Match rate" value={pct(m?.match_rate)} trend={trendOf(series, 'match_rate')} note="Target 75%" loading={mapr.loading} />
        <MetricCard title="Skip rate" value={pct(m?.skip_rate)} trend={trendOf(series, 'skip_rate')} upIsGood={false} note="Target under 20%" loading={mapr.loading} />
        <MetricCard title="Repeat rate" value={pct(m?.repeat_rate)} trend={trendOf(series, 'repeat_rate')} upIsGood={false} note="Target under 30%" loading={mapr.loading} />
        <MetricCard title="Novelty (7 days)" value={m?.novelty_percentage == null ? '—' : `${num(m.novelty_percentage, 1)}%`} trend={trendOf(series, 'novelty_percentage')} note="Target 20%+" loading={mapr.loading} />
      </Grid>
      <Two>
        <TrendChart title="Match, skip and repeat (7 days)" data={series} series={[{ key: 'match_rate', label: 'Match' }, { key: 'skip_rate', label: 'Skip' }, { key: 'repeat_rate', label: 'Repeat' }]} format={(v) => pct(v, 0)} domain={[0, 1]} />
        <TrendChart title="Novelty % (7 days)" data={series} series={[{ key: 'novelty_percentage', label: 'Novelty' }]} format={(v) => `${Math.round(v)}%`} />
      </Two>
      <Grid>
        <MetricCard title="Stagnating users" value={m?.stagnation_users ?? '—'} note="Under 3 ratings and 5 visits in 7 days" loading={mapr.loading} />
        <MetricCard title="Ranking latency p99" value={num(m?.latency?.p99Ms, 1)} unit="ms" note="Target under 100 ms" loading={mapr.loading} />
        <MetricCard title="Within 1.5 km" value={pct(m?.distance?.within1_5km)} note="Target 50%+" loading={mapr.loading} />
        <MetricCard title="Picks shown" value={m?.totals?.shown ?? '—'} note={m?.totals ? `${m.totals.users} users, ${m.totals.sets} sets` : undefined} loading={mapr.loading} />
      </Grid>
      <Two>
        <section className="card p-4 space-y-2" aria-label="NCF model">
          <h2 className="font-medium">NCF model {n ? (n.active ? '· on' : '· off') : ''}</h2>
          {n ? (
            <dl className="grid grid-cols-2 gap-2 text-sm tabular">
              <dt className="secondary">Switch</dt>
              <dd>{n.active ? 'On' : `Off until more than ${n.active_threshold ?? 0} active users (now ${n.active_users ?? 0})`}</dd>
              <dt className="secondary">Last trained</dt>
              <dd>{when(n.last_trained)}</dd>
              <dt className="secondary">Last weekly run</dt>
              <dd>
                {when(n.last_run)} ({n.last_action || '—'})
              </dd>
              <dt className="secondary">Validation loss</dt>
              <dd>{num(n.training_loss, 4)}</dd>
              <dt className="secondary">Validation accuracy</dt>
              <dd>{pct(n.validation_accuracy)}</dd>
              <dt className="secondary">Holdout accuracy</dt>
              <dd>{pct(n.test_accuracy)}</dd>
              <dt className="secondary">Ranking latency p99</dt>
              <dd>{num(n.last_inference_latency_ms, 1)} ms</dd>
              <dt className="secondary">Version</dt>
              <dd className="truncate">{n.model_version || '—'}</dd>
            </dl>
          ) : (
            <p className="text-sm muted">{ncf.loading ? 'Loading…' : 'Not trained yet. Use Tools → Run now.'}</p>
          )}
        </section>
        <section className="card p-4 space-y-2" aria-label="Similarity matrix">
          <h2 className="font-medium">Similarity matrix</h2>
          {s ? (
            <dl className="grid grid-cols-2 gap-2 text-sm tabular">
              <dt className="secondary">Last computed</dt>
              <dd>{when(s.last_computed)}</dd>
              <dt className="secondary">Compute time</dt>
              <dd>{s.compute_ms ?? '—'} ms</dd>
              <dt className="secondary">Size</dt>
              <dd>{bytes(s.model_size_bytes)}</dd>
              <dt className="secondary">Cities</dt>
              <dd>{s.regions}</dd>
              <dt className="secondary">Most neighbors</dt>
              <dd>{s.top_landmark ? `${s.top_landmark.region}/${s.top_landmark.id} (${s.top_landmark.neighbors})` : '—'}</dd>
            </dl>
          ) : (
            <p className="text-sm muted">{sim.loading ? 'Loading…' : 'Not computed yet. Use Tools → Run now.'}</p>
          )}
        </section>
      </Two>
      <section className="card p-4 space-y-2" aria-label="A/B test status">
        <h2 className="font-medium">A/B test (NCF)</h2>
        {ab?.started ? (
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm tabular">
            <dt className="secondary">Control</dt>
            <dd>
              {pct(ab.arms.control?.ctr)} · {ab.arms.control?.shown ?? 0} picks
            </dd>
            <dt className="secondary">Treatment</dt>
            <dd>
              {pct(ab.arms.treatment?.ctr)} · {ab.arms.treatment?.shown ?? 0} picks
            </dd>
            <dt className="secondary">Duration</dt>
            <dd>{ab.days} days</dd>
            <dt className="secondary">Significance</dt>
            <dd>
              p={ab.ctr.pValue ?? '—'} {ab.ctr.significant ? '(significant)' : '(not yet)'} · {ab.decision}
            </dd>
          </dl>
        ) : (
          <p className="text-sm muted">Not running: every component is on for everyone while the app has two users.</p>
        )}
      </section>
      <MaprV2Rollout ab={m?.experiments?.maprV2} model={n} loading={mapr.loading || ncf.loading} />
    </Page>
  );
}

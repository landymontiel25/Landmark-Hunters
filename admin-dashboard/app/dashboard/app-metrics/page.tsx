'use client';
import { Page } from '@/components/Page';
import { TrendChart } from '@/components/Chart';
import { AlertBanner, ListenerError } from '@/components/AlertBanner';
import { useAppMetrics } from '@/lib/listeners';
import { goalCardClass, when } from '@/lib/metrics';

const STATUS = { met: '✓ Goal met', missed: '✕ Goal missed', unknown: "? Can't measure yet", info: '• No goal set' } as const;

// The stats that used to live on the app's Admin stats page: every metric
// card with its goal, and the long study's Mapr-vs-baseline series.
export default function AppMetrics() {
  const { data, loading, error } = useAppMetrics();
  return (
    <Page title="App metrics" subtitle={data ? `Computed ${when(data.generatedAt)} for ${data.date}.` : 'The app-wide metrics and goals that used to be on the in-app Admin stats page.'}>
      <ListenerError error={error} />
      {data?.truncated?.length ? <AlertBanner items={[`Some collections hit the read limit: ${data.truncated.join(', ')}. Numbers are partial.`]} /> : null}
      {loading && <p className="text-sm muted">Loading…</p>}
      {!loading && !data && <p className="text-sm muted">No snapshot yet. It is written by the nightly job, or Tools → Run now.</p>}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
        {(data?.metrics || []).map((m) => (
          <section key={m.id} className={`${goalCardClass(m.status)} p-4`} aria-label={m.label}>
            <p className="text-sm secondary">{m.label}</p>
            <p className="text-2xl font-semibold mt-1 tabular">{m.status === 'unknown' ? "Can't measure yet" : `${m.value ?? '—'}${m.unit || ''}`}</p>
            <p className="text-xs mt-1">{STATUS[m.status] || ''}</p>
            {m.goal && <p className="text-xs muted mt-1">Goal: {m.goal}</p>}
            {m.note && <p className="text-xs muted mt-1">{m.note}</p>}
          </section>
        ))}
      </div>
      {data?.study?.series?.length ? (
        <TrendChart title="Taste score: Mapr vs always guessing the usual answer" data={data.study.series as unknown as Record<string, unknown>[]} series={[{ key: 'mapr', label: 'Mapr' }, { key: 'baseline', label: 'Baseline' }]} format={(v) => `${Math.round(v)}%`} domain={[0, 100]} />
      ) : null}
    </Page>
  );
}

'use client';
import { Page } from '@/components/Page';
import { TrendChart } from '@/components/Chart';
import { AlertBanner, ListenerError } from '@/components/AlertBanner';
import { useAppMetrics, usePresenceMetrics } from '@/lib/listeners';
import { goalCardClass, when } from '@/lib/metrics';

const STATUS = { met: '✓ Goal met', missed: '✕ Goal missed', unknown: "? Can't measure yet", info: '• No goal set' } as const;

// The stats that used to live on the app's Admin stats page: every metric
// card with its goal, and the long study's Mapr-vs-baseline series.
export default function AppMetrics() {
  const { data, loading, error } = useAppMetrics();
  const presence = usePresenceMetrics(30);
  const presenceRows = (presence.data || []).map((d) => ({ ...d, verified_pct: d.verified_rate == null ? null : d.verified_rate * 100 }));
  const checked = presenceRows.reduce((n, d) => n + d.checked, 0);
  const verified = presenceRows.reduce((n, d) => n + d.verified, 0);
  const reasons: Record<string, number> = {};
  for (const d of presenceRows) for (const [k, v] of Object.entries(d.fail_reasons || {})) reasons[k] = (reasons[k] || 0) + v;
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
      <section className="card p-4 mt-4" aria-label="Verified visits">
        <p className="font-medium">Verified visits, last 30 days</p>
        <ListenerError error={presence.error} />
        <p className="text-sm secondary mt-1">
          {checked
            ? `${verified} of ${checked} checked check-ins verified (${Math.round((verified / checked) * 100)}%). Goal: 80% or more.`
            : 'No check-in has been checked yet.'}
        </p>
        {Object.keys(reasons).length > 0 && (
          <p className="text-xs muted mt-1">
            Fails: {Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}
          </p>
        )}
      </section>
      <TrendChart title="Verified visit rate (checked check-ins)" data={presenceRows as unknown as Record<string, unknown>[]} series={[{ key: 'verified_pct', label: 'Verified' }]} format={(v) => `${Math.round(v)}%`} domain={[0, 100]} />
      {data?.study?.series?.length ? (
        <TrendChart title="Taste score: Mapr vs always guessing the usual answer" data={data.study.series as unknown as Record<string, unknown>[]} series={[{ key: 'mapr', label: 'Mapr' }, { key: 'baseline', label: 'Baseline' }]} format={(v) => `${Math.round(v)}%`} domain={[0, 100]} />
      ) : null}
    </Page>
  );
}

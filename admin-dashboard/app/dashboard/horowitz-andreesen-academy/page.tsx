'use client';
import { Page } from '@/components/Page';
import { ListenerError } from '@/components/AlertBanner';
import { useAppMetrics } from '@/lib/listeners';
import { academyCards } from '@/lib/academy';
import { goalCardClass } from '@/lib/metrics';

const MARK = { met: '✓ Goal met', missed: '✕ Goal missed' } as const;

// Five numbers for the Horowitz Andreesen Academy reviewers, straight from the
// app's own metrics with how many people each is based on.
export default function HorowitzAndreesenAcademy() {
  const { data, loading, error } = useAppMetrics();
  const cards = academyCards(data?.metrics || []);
  return (
    <Page title="Horowitz Andreesen Academy" subtitle={data ? `Real numbers from the app, computed for ${data.date}. The app is early and mostly used by the founder and family, so every number says how many people it is based on.` : undefined}>
      <ListenerError error={error} />
      {loading && <p className="text-sm muted">Loading…</p>}
      {!loading && !data && <p className="text-sm muted">No snapshot yet. It is written by the nightly job, or Tools → Run now.</p>}
      {data && (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          {cards.map((c) => (
            <section key={c.key} className={`${goalCardClass(c.status)} p-4`} aria-label={c.title}>
              <p className="text-xs muted">{c.question}</p>
              <h2 className="text-lg font-semibold mt-0.5">{c.title}</h2>
              <ul className="mt-3 space-y-3">
                {c.rows.map((r) => (
                  <li key={r.label}>
                    <p className="text-sm secondary">{r.label}</p>
                    <p className="text-2xl font-semibold tabular">{r.value}</p>
                    {r.detail && <p className="text-xs muted mt-0.5">{r.detail}</p>}
                    {r.status && r.status in MARK && <p className="text-xs mt-0.5">{MARK[r.status as keyof typeof MARK]}</p>}
                  </li>
                ))}
              </ul>
              {c.table && (
                <table className="mt-3 w-full text-xs tabular">
                  <thead>
                    <tr className="text-left muted">
                      <th className="font-normal pb-1">Week ending</th>
                      <th className="font-normal pb-1 text-right">Active</th>
                      <th className="font-normal pb-1 text-right">New</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.table.map((w) => (
                      <tr key={w.label}>
                        <td>{w.label}</td>
                        <td className="text-right">{w.active}</td>
                        <td className="text-right">{w.newUsers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {c.status in MARK && <p className="text-xs mt-3">{MARK[c.status as keyof typeof MARK]}</p>}
              {c.note && <p className="text-xs muted mt-2">{c.note}</p>}
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}

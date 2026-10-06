import { useState } from 'react';
import { reportToCsv } from '../lib/maprRank/metrics.js';
import { TARGETS } from '../lib/maprRank/config.js';

// Admin stats: Mapr Phase 1 (src/lib/maprRank). The daily reports written by
// api/mapr-nightly.js, newest last: a trend chart over the last week, today's
// numbers against their targets, both A/B tests, alerts, and a CSV export.
// Totals only, like the rest of the page.

const pct = (v) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);
const num = (v, unit = '') => (v == null ? '—' : `${Math.round(v * 100) / 100}${unit}`);

// Four rates on one 0-100% axis. Each line has its own dash pattern and an
// end label, so color is never the only cue; the table view has the numbers.
const LINES = [
  { key: 'matchRate', label: 'Match', dash: '', pick: (r) => r.matchRate },
  { key: 'skipRate', label: 'Skip', dash: '6 4', pick: (r) => r.skipRate },
  { key: 'repeatRate', label: 'Repeat', dash: '2 3', pick: (r) => r.repeatRate },
  { key: 'novelty', label: 'Novelty', dash: '10 3 2 3', pick: (r) => r.novelty?.weeklyNewShare },
];

function TrendChart({ reports }) {
  const [table, setTable] = useState(false);
  const pts = reports.slice(-7);
  if (!pts.length) return <p className="as-p">No daily reports yet. The job runs every night at 00:23 UTC, or use “Run now” below.</p>;
  const W = 360;
  const H = 190;
  const pad = { l: 30, r: 56, t: 10, b: 22 };
  const x = (i) => pad.l + (pts.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (pts.length - 1)) * (W - pad.l - pad.r));
  const y = (v) => pad.t + (1 - v) * (H - pad.t - pad.b);
  const path = (pick) =>
    pts
      .map((r, i) => (pick(r) == null ? null : `${x(i).toFixed(1)},${y(pick(r)).toFixed(1)}`))
      .filter(Boolean)
      .join(' ');
  return (
    <div className="as-chart">
      {table ? (
        <div className="as-table-wrap">
          <table className="as-table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                {LINES.map((l) => (
                  <th key={l.key} scope="col">
                    {l.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pts.map((r) => (
                <tr key={r.date}>
                  <td>{r.date}</td>
                  {LINES.map((l) => (
                    <td key={l.key}>{pct(l.pick(r))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Mapr rates over the last ${pts.length} days. Latest, ${pts[pts.length - 1].date}: ${LINES.map((l) => `${l.label} ${pct(l.pick(pts[pts.length - 1]))}`).join(', ')}.`}>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border-subtle)" strokeWidth="1" />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--text-tertiary)">
                {t * 100}
              </text>
            </g>
          ))}
          <text x={pad.l} y={H - 6} fontSize="10" fill="var(--text-tertiary)">
            {pts[0].date.slice(5)}
          </text>
          <text x={W - pad.r} y={H - 6} fontSize="10" textAnchor="end" fill="var(--text-tertiary)">
            {pts[pts.length - 1].date.slice(5)}
          </text>
          {LINES.map((l, n) => {
            const last = l.pick(pts[pts.length - 1]);
            return (
              <g key={l.key}>
                <polyline points={path(l.pick)} fill="none" stroke={n === 0 ? 'var(--mapr-blue)' : 'var(--text-secondary)'} strokeWidth={n === 0 ? 2.5 : 1.75} strokeDasharray={l.dash} strokeLinecap="round" strokeLinejoin="round" />
                {last != null && (
                  <text x={x(pts.length - 1) + 6} y={y(last) + 4} fontSize="10" fill="var(--text-primary)">
                    {l.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      <button type="button" className="as-link" onClick={() => setTable((t) => !t)}>
        {table ? 'Show chart' : 'Show as table'}
      </button>
    </div>
  );
}

function abRows(name, e) {
  if (!e?.started) return [[name, 'Not started', '—', '—', '—', '—']];
  const c = e.arms.control;
  const t = e.arms.treatment;
  return [[name, `Day ${e.days}`, `${pct(c.ctr)} (${c.shown})`, `${pct(t.ctr)} (${t.shown})`, `${pct(e.ctr.lift)} · p=${e.ctr.pValue ?? '—'} · CI ${e.ctr.ci ? e.ctr.ci.map(pct).join(' to ') : '—'}`, e.decision]];
}

function download(reports) {
  const csv = reports.map((r) => `# ${r.date}\n${reportToCsv(r)}`).join('\n\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `mapr-daily-${reports[reports.length - 1]?.date || 'report'}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function MaprPhase1Panel({ data, onRun, run }) {
  const reports = data?.reports || [];
  const r = reports[reports.length - 1] || null;
  const status = data?.status || null;
  return (
    <section className="as-section" aria-label="Mapr Phase 1">
      <h2 className="as-h2">Mapr Phase 1</h2>
      <p className="as-p">
        Distance decay, item-item similarity, the NCF model and exploration. Daily numbers for picks shown that day (UTC); reactions keep arriving for 7 days{r && !r.matured ? ', so the latest day is still filling in' : ''}.
      </p>
      <TrendChart reports={reports} />
      {r && (
        <>
          <h3 className="as-h3">{r.date}</h3>
          <div className="as-table-wrap">
            <table className="as-table">
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">Value</th>
                  <th scope="col">Target</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Match rate', pct(r.matchRate), `${pct(TARGETS.matchRate)}+`, r.targets?.matchRate],
                  ['Visited and rated 4+', pct(r.visitLoveRate), '—'],
                  ['Skip rate', pct(r.skipRate), `under ${pct(TARGETS.skipRate)}`, r.targets?.skipRate],
                  ['Repeat rate', pct(r.repeatRate), `under ${pct(TARGETS.repeatRate)}`, r.targets?.repeatRate],
                  ['Average rating', num(r.avgRating), `${TARGETS.avgRating}+`, r.targets?.avgRating],
                  ['New to the user (7 days)', pct(r.novelty?.weeklyNewShare), `${pct(TARGETS.novelty)}+`, r.targets?.novelty],
                  ['Picks per active user', num(r.recommendationsPerUser), '—'],
                  ['Within 1.5 km / 3 km', `${pct(r.distance?.within1_5km)} / ${pct(r.distance?.within3km)}`, `${pct(TARGETS.near1_5km)} / ${pct(TARGETS.near3km)}`],
                  ['Distance p50 / p90', `${num(r.distance?.p50, ' km')} / ${num(r.distance?.p90, ' km')}`, '—'],
                  ['Boosted by similarity', pct(r.boost?.n ? 1 - (r.boost.zero ?? 1) : null), '—'],
                  ['Exploration share', pct(r.exploration?.share), 'about 20% (up to 50% in a quiet week)'],
                  ['Stagnating users', `${pct(r.stagnation?.share)} of ${r.stagnation?.activeUsers ?? 0}`, 'under 20%'],
                  ['Ranking latency p50 / p99', `${num(r.latency?.p50Ms, ' ms')} / ${num(r.latency?.p99Ms, ' ms')}`, `under ${TARGETS.latencyP99Ms} ms`, r.targets?.latency],
                  ['Dwell time', 'Not tracked', '—'],
                ].map(([label, value, target, st]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td>
                      {value}
                      {st === 'met' ? ' ✓' : st === 'missed' ? ' ✕' : ''}
                    </td>
                    <td>{target}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="as-h3">A/B tests (CTR = shown picks that got a tap, visit or rating)</h3>
          <div className="as-table-wrap">
            <table className="as-table">
              <thead>
                <tr>
                  {['Test', 'Running', 'Control', 'Treatment', 'Lift', 'Decision'].map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...abRows('NCF', r.experiments?.ncf), ...abRows('Exploration', r.experiments?.exploration)].map((row) => (
                  <tr key={row[0]}>
                    {row.map((c, j) => (
                      <td key={j}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.alerts?.length ? (
            <ul className="as-p" role="status">
              {r.alerts.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : (
            <p className="as-p">No alerts.</p>
          )}
        </>
      )}
      {status && (
        <p className="as-p">
          Models: NCF {status.ncf?.active ? 'on' : 'off'}
          {status.ncf?.activeUsers != null ? ` (${status.ncf.activeUsers} active users; turns on above ${status.ncf.activeThreshold})` : ''}, last run {status.ncf?.action || '—'}
          {status.ncf?.evaluation?.testAccuracy != null ? `, holdout accuracy ${pct(status.ncf.evaluation.testAccuracy)}` : ''}
          {status.ncf?.trainedAt ? `, ${new Date(status.ncf.trainedAt).toLocaleDateString()}` : ''}. Similarity: {status.similarity?.regions ?? 0} regions in {status.similarity?.ms ?? '—'} ms.
        </p>
      )}
      <div className="as-actions">
        <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 44 }} disabled={!reports.length} onClick={() => download(reports)}>
          Download CSV
        </button>
        <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 44, marginLeft: 8 }} disabled={run?.running} onClick={onRun}>
          {run?.running ? 'Running…' : 'Run now (models + report)'}
        </button>
      </div>
      {run?.text && (
        <p className="as-p" role="status">
          {run.text}
        </p>
      )}
    </section>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../lib/apiBase';
import { authHeaders } from '../lib/apiAuth';
import { ADMIN_STATS_POLL_MS, GROWTH_GOALS, STUDY_FLAT_MAX_GAIN } from '../lib/statsConstants';
import { useVisibleInterval } from '../lib/useVisibleInterval';
import '../styles/admin-stats.css';

// Owner-only (the route re-checks admin; the server checks again). Totals only:
// the server sends no names, emails, ids or places of any one person.

const STATUS = {
  met: { icon: '✓', text: 'Goal met' },
  missed: { icon: '✕', text: 'Goal missed' },
  unknown: { icon: '?', text: "Can't measure yet" },
  info: { icon: '•', text: 'No goal set' },
};

const fmt = (v, d = 1) => (v == null ? '—' : `${Math.round(v * 10 ** d) / 10 ** d}`);

function MetricCard({ m }) {
  const s = STATUS[m.status] || STATUS.unknown;
  const unknown = m.status === 'unknown';
  return (
    <section className={`as-card${m.headline ? ' as-headline' : ''}`} data-status={m.status} aria-label={m.label}>
      <p className="as-label">{m.label}</p>
      <p className={`as-value${unknown ? ' as-cant' : ''}`}>{unknown ? "Can't measure yet" : `${m.value}${m.unit || ''}`}</p>
      <span className="as-chip" data-status={m.status}>
        <span className="as-icon" aria-hidden="true">
          {s.icon}
        </span>
        {s.text}
      </span>
      <p className="as-goal">Goal: {m.goal}</p>
      {m.baseline && (
        <p className="as-base">
          Baseline: <strong>{`${m.baseline.value}${m.baseline.unit || ''}`}</strong> ({m.baseline.label})
        </p>
      )}
      {m.n > 0 && (
        <p className="as-note">
          Based on {m.n} {m.nLabel || ''}
        </p>
      )}
      {m.note && <p className="as-note">{m.note}</p>}
    </section>
  );
}

function Table({ cols, rows, empty = 'No data yet.' }) {
  if (!rows.length) return <p className="as-p">{empty}</p>;
  return (
    <div className="as-table-wrap">
      <table className="as-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Mapr vs baseline, a point per day. Two lines on one 0-100 axis; identity is
// carried by the legend, direct end labels and the dash pattern, not by color
// alone, and a table view has the same numbers.
function SeriesChart({ series }) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);
  const W = 360;
  const H = 190;
  const pad = { l: 30, r: 44, t: 10, b: 22 };
  const pts = series.filter((p) => p.mapr != null);
  if (!pts.length) return <p className="as-p">No taste scores yet, so there is nothing to chart.</p>;
  const x = (i) => pad.l + (pts.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (pts.length - 1)) * (W - pad.l - pad.r));
  const y = (v) => pad.t + (1 - v / 100) * (H - pad.t - pad.b);
  const line = (key) =>
    pts
      .map((p, i) => (p[key] == null ? null : `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`))
      .filter(Boolean)
      .join(' ');
  const last = pts[pts.length - 1];
  const onMove = (e) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || !box.width) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < pts.length; i += 1) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };
  const shown = hover != null ? pts[hover] : last;
  return (
    <div className="as-chart">
      <div className="as-legend">
        <span>
          <i className="as-key" aria-hidden="true" /> Mapr
        </span>
        <span>
          <i className="as-key as-dash" aria-hidden="true" /> Always guessing the usual answer
        </span>
      </div>
      {table ? (
        <Table
          cols={['Day', 'Mapr', 'Baseline', 'Users']}
          rows={pts.map((p) => [p.date, `${fmt(p.mapr)}%`, p.baseline == null ? '—' : `${fmt(p.baseline)}%`, p.users])}
        />
      ) : (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Average taste score over time. Latest, ${last.date}: Mapr ${fmt(last.mapr)} percent, baseline ${fmt(last.baseline)} percent.`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {[0, 25, 50, 75, 100].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border-subtle)" strokeWidth="1" />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--text-tertiary)">
                {t}
              </text>
            </g>
          ))}
          <text x={pad.l} y={H - 6} fontSize="10" fill="var(--text-tertiary)">
            {pts[0].date.slice(5)}
          </text>
          <text x={W - pad.r} y={H - 6} fontSize="10" textAnchor="end" fill="var(--text-tertiary)">
            {last.date.slice(5)}
          </text>
          <polyline points={line('baseline')} fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={line('mapr')} fill="none" stroke="var(--mapr-blue)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {pts.length === 1 && <circle cx={x(0)} cy={y(last.mapr)} r="4" fill="var(--mapr-blue)" stroke="var(--bg-card)" strokeWidth="2" />}
          <text x={x(pts.length - 1) + 6} y={y(last.mapr) + 4} fontSize="11" fill="var(--text-primary)">
            Mapr
          </text>
          {last.baseline != null && (
            <text x={x(pts.length - 1) + 6} y={y(last.baseline) + (last.baseline > last.mapr - 6 && last.baseline <= last.mapr + 6 ? 16 : 4)} fontSize="11" fill="var(--text-secondary)">
              Base
            </text>
          )}
          {hover != null && (
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--border-strong)" strokeWidth="1" />
          )}
        </svg>
      )}
      <p className="as-readout" aria-live="polite">
        {shown.date}: Mapr {fmt(shown.mapr)}%{shown.baseline != null ? `, baseline ${fmt(shown.baseline)}%` : ''} ({shown.users} users)
      </p>
      <button type="button" className="as-link" onClick={() => setTable((t) => !t)}>
        {table ? 'Show chart' : 'Show as table'}
      </button>
    </div>
  );
}

const pct = (v) => (v == null ? '—' : `${fmt(v)}%`);

function Study({ study }) {
  const a = study.accuracyAll;
  const wh = study.whatHappened;
  const tv = study.tapVsVisit;
  const st = study.stalled;
  return (
    <>
      <h2 className="as-h2">The long study</h2>
      <p className="as-p">Totals across everyone. A daily summary is stored every day; the chart keeps those days even if an account is later deleted.</p>

      <h3 className="as-h3">Mapr vs always guessing the usual answer, over time</h3>
      <SeriesChart series={study.series || []} />

      <h3 className="as-h3">Accuracy across all users</h3>
      <Table
        cols={['Users', 'Average', 'Middle', 'Best', 'Worst']}
        rows={a.users ? [[a.users, pct(a.average), pct(a.median), pct(a.best), pct(a.worst)]] : []}
        empty="No taste scores yet."
      />

      <h3 className="as-h3">Getting to 80% and 90%</h3>
      <Table
        cols={['Score', 'Reached', 'Ratings (middle)', 'Ratings (25-75%)', 'Days (middle)']}
        rows={study.reach.map((r) => [
          `${r.threshold}%`,
          `${r.reached} of ${r.usersWithHistory}`,
          fmt(r.ratingsToReach.median),
          r.ratingsToReach.n ? `${fmt(r.ratingsToReach.p25)}-${fmt(r.ratingsToReach.p75)}` : '—',
          fmt(r.daysToReach.median),
        ])}
      />

      <h3 className="as-h3">Accuracy at 5, 10, 20, 50 and 100 ratings</h3>
      <Table
        cols={['Ratings', 'Users', 'Mapr', 'Baseline']}
        rows={study.accuracyAtRatings.map((r) => [r.ratings, r.users, pct(r.mapr), pct(r.baseline)])}
      />

      <h3 className="as-h3">Accuracy by category</h3>
      <Table cols={['Category', 'Guesses', 'Accuracy']} rows={study.byCategory.rows.map((r) => [r.label, r.predictions, pct(r.accuracyPct)])} empty="Not enough guesses yet." />
      <h3 className="as-h3">Accuracy by city</h3>
      <Table cols={['City', 'Guesses', 'Accuracy']} rows={study.byCity.rows.map((r) => [r.label, r.predictions, pct(r.accuracyPct)])} empty="Not enough guesses yet." />

      <h3 className="as-h3">Just me vs A group, usual vs something new</h3>
      <Table
        cols={['Picks', 'Guesses', 'Accuracy']}
        rows={[
          ['Just me', study.audience.justMe.predictions, pct(study.audience.justMe.accuracyPct)],
          ['A group', study.audience.group.predictions, pct(study.audience.group.accuracyPct)],
          ['Usual', study.pickType.usual.predictions, pct(study.pickType.usual.accuracyPct)],
          ['Something new', study.pickType.something.predictions, pct(study.pickType.something.accuracyPct)],
        ]}
      />

      <h3 className="as-h3">Big misses (two levels off)</h3>
      <Table cols={['Guesses', 'Big misses', 'Share']} rows={[[study.bigMisses.predictions, study.bigMisses.bigMisses, pct(study.bigMisses.sharePct)]]} />

      <h3 className="as-h3">{'"What happened?" answers'}</h3>
      <Table cols={['Reason', 'Count']} rows={Object.entries(wh.counts).filter(([, n]) => n > 0).map(([k, n]) => [k, n])} empty="No answers yet." />

      <h3 className="as-h3">Tap vs visit agreement</h3>
      <Table
        cols={['Tap', 'Later rated', 'Same answer']}
        rows={
          tv.pairs
            ? [['All', tv.pairs, `${tv.agree} (${pct(tv.agreePct)})`], ...Object.entries(tv.byTap).filter(([, v]) => v.pairs).map(([k, v]) => [k, v.pairs, v.agree])]
            : []
        }
        empty="No taps with a later rating yet."
      />

      <h3 className="as-h3">Scores that stopped rising</h3>
      <p className="as-p">
        Gained {STUDY_FLAT_MAX_GAIN} point or less over the last {st.snapshots} snapshots.
      </p>
      <Table cols={['Users measured', 'Stalled', 'Share']} rows={st.users ? [[st.users, st.stalled, pct(st.sharePct)]] : []} empty="Not enough snapshots yet." />

      <h3 className="as-h3">Taste score vs coming back</h3>
      <Table
        cols={['Day', 'Users', 'Came back', 'Score (back)', 'Score (not)', 'Correlation']}
        rows={study.scoreVsReturn.map((r) => [r.day, r.users, r.returned, pct(r.avgScoreReturned), pct(r.avgScoreNotReturned), r.correlation == null ? "Can't measure yet" : r.correlation])}
      />
    </>
  );
}

export default function AdminStats() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await fetch(`${API_BASE}/api/admin-stats`, { headers: await authHeaders() });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `The stats route answered ${r.status}.`);
      setData(body);
      setError('');
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useVisibleInterval(load, ADMIN_STATS_POLL_MS);

  const head = data?.metrics?.find((m) => m.headline);
  const rest = data?.metrics?.filter((m) => !m.headline) || [];
  return (
    <div className="as-page">
      <div className="as-top">
        <h1 className="screen-title">Admin stats</h1>
        <Link to="/test" className="as-link">
          Back to Test
        </Link>
      </div>
      <p className="as-meta">
        {data ? `Updated ${new Date(data.generatedAt).toLocaleTimeString()}. Refreshes every ${ADMIN_STATS_POLL_MS / 1000} s while this tab is open. ${data.totals.users} users.` : 'Loading…'}
      </p>
      {error && (
        <p className="as-error" role="alert">
          {error}
        </p>
      )}
      {data?.truncated?.length > 0 && (
        <p className="as-error" role="status">
          Some collections were cut off at the read limit: {data.truncated.join(', ')}. Numbers are partial.
        </p>
      )}
      {head && <MetricCard m={head} />}
      {rest.map((m) => (
        <MetricCard key={m.id} m={m} />
      ))}
      {data && (
        <p className="as-p">
          Growth goals by week of the app&apos;s life: {GROWTH_GOALS.map((g) => `weeks ${g.fromWeek}${g.toWeek === Infinity ? '+' : `-${g.toWeek}`}: ${g.label}`).join(', ')}.
          {data.growth?.start ? ` Week 1 starts ${data.growth.start}.` : ''}
        </p>
      )}
      {data?.study && <Study study={data.study} />}
    </div>
  );
}

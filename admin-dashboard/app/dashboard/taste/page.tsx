'use client';
import { useMemo, useState } from 'react';
import { Grid, Page, Two } from '@/components/Page';
import { MetricCard } from '@/components/MetricCard';
import { TrendChart } from '@/components/Chart';
import { Table } from '@/components/Table';
import { ListenerError } from '@/components/AlertBanner';
import { useBigMisses, useTasteScores } from '@/lib/listeners';
import { num, pct, trendOf } from '@/lib/metrics';
import { saveMissReview, statusLabel } from '@/lib/bigMisses';
import type { BigMiss, MissStatus } from '@/lib/types';

function MissDetail({ miss, onClose }: { miss: BigMiss; onClose: () => void }) {
  const [status, setStatus] = useState<MissStatus>(miss.status || 'pending');
  const [notes, setNotes] = useState(miss.resolution || '');
  const [state, setState] = useState('');
  const save = async () => {
    setState('Saving…');
    try {
      await saveMissReview(miss.id, status, notes);
      setState('Saved.');
    } catch (e) {
      setState(`Could not save: ${String((e as Error).message || e)}`);
    }
  };
  return (
    <section className="card p-4 space-y-3" aria-label={`Review ${miss.landmark_name}`}>
      <div className="flex justify-between gap-2">
        <h2 className="font-medium">
          {miss.landmark_name} <span className="muted text-sm">({miss.region}/{miss.landmark_id})</span>
        </h2>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="text-sm secondary tabular">
        Expected {num(miss.expected_rating, 1)}★, got {num(miss.actual_rating, 1)}★ · skipped {miss.skip_count} times · rated 1★ {miss.hate_count} times
      </p>
      <label className="block text-sm">
        <span className="secondary">Status</span>
        <select className="input w-full mt-1" value={status} onChange={(e) => setStatus(e.target.value as MissStatus)}>
          <option value="pending">Pending review</option>
          <option value="resolved">Resolved</option>
          <option value="duplicate">Duplicate</option>
        </select>
      </label>
      <label className="block text-sm">
        <span className="secondary">Resolution notes</span>
        <textarea className="input w-full mt-1 min-h-24" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="flex items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={save}>
          Save review
        </button>
        {state && (
          <span role="status" className="text-sm secondary">
            {state}
          </span>
        )}
      </div>
    </section>
  );
}

export default function Taste() {
  const taste = useTasteScores(30);
  const misses = useBigMisses(100);
  const [open, setOpen] = useState<string | null>(null);
  const week = useMemo(() => taste.data.slice(-7) as unknown as Record<string, unknown>[], [taste.data]);
  const t = taste.data[taste.data.length - 1];
  const rows = misses.data.map((m) => ({ ...m, statusText: statusLabel(m.status), reported: m.reported_at?.toMillis ? new Date(m.reported_at.toMillis()).toLocaleDateString() : '—' }));
  const current = misses.data.find((m) => m.id === open) || null;
  return (
    <Page title="Taste" subtitle="Taste score = how well Mapr's hidden guesses match each user's answers (each user's latest score). Big misses = places Mapr expected someone to love that got skipped 3+ times or a 1★ rating.">
      <ListenerError error={taste.error || misses.error} />
      <Grid>
        <MetricCard title="Avg taste score" value={pct(t?.avg_taste_score, 0)} trend={trendOf(week, 'avg_taste_score')} loading={taste.loading} />
        <MetricCard title="Users with a taste score" value={t?.users_with_taste_score ?? '—'} trend={trendOf(week, 'users_with_taste_score')} loading={taste.loading} />
        <MetricCard title="Big misses" value={misses.data.length} note={`${misses.data.filter((m) => !m.status || m.status === 'pending').length} pending review`} loading={misses.loading} />
      </Grid>
      <Two>
        <TrendChart title="Average taste score (7 days)" data={week} series={[{ key: 'avg_taste_score', label: 'Taste score' }]} format={(v) => pct(v, 0)} domain={[0, 1]} />
        <TrendChart title="Users with a taste score (7 days)" data={week} series={[{ key: 'users_with_taste_score', label: 'Users' }]} />
      </Two>
      {current && <MissDetail key={current.id} miss={current} onClose={() => setOpen(null)} />}
      <Table
        rows={rows as unknown as Record<string, unknown>[]}
        filterKey="landmark_name"
        csvName="mapr-big-misses.csv"
        initialSort={{ key: 'skip_count', desc: true }}
        onRowClick={(r) => setOpen(String(r.id))}
        empty={misses.loading ? 'Loading…' : 'No big misses. Mapr has not badly missed any place yet.'}
        columns={[
          { key: 'landmark_name', label: 'Landmark' },
          { key: 'expected_rating', label: 'Expected', numeric: true, render: (r) => `${num(r.expected_rating as number, 1)}★` },
          { key: 'actual_rating', label: 'Actual', numeric: true, render: (r) => (r.actual_rating == null ? '—' : `${num(r.actual_rating as number, 1)}★`) },
          { key: 'skip_count', label: 'Skips', numeric: true },
          { key: 'hate_count', label: '1★ ratings', numeric: true },
          { key: 'reported', label: 'Reported' },
          { key: 'statusText', label: 'Status' },
        ]}
      />
      <p className="text-xs muted">Click a row to review it and add notes.</p>
    </Page>
  );
}

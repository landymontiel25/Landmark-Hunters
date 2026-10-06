'use client';
import { useState } from 'react';
import { Page } from '@/components/Page';
import { Table } from '@/components/Table';
import { ListenerError } from '@/components/AlertBanner';
import { useAccuracyByCategory, useAccuracyByCity } from '@/lib/listeners';
import { accuracyRows, pct } from '@/lib/metrics';

type Row = { name: string; match_rate: number | null; skip_rate: number | null; repeat_rate: number | null; sample_size: number };

export default function Accuracy() {
  const [tab, setTab] = useState<'category' | 'city'>('category');
  const cat = useAccuracyByCategory();
  const city = useAccuracyByCity();
  const src = tab === 'category' ? cat : city;
  const doc = src.data[0];
  const rows = accuracyRows(tab === 'category' ? doc?.categories : doc?.cities) as Row[];
  // Bottom three by match rate (with a measured rate) get flagged.
  const bottom = new Set(
    [...rows]
      .filter((r) => r.match_rate != null)
      .sort((a, b) => (a.match_rate ?? 0) - (b.match_rate ?? 0))
      .slice(0, 3)
      .map((r) => r.name)
  );
  return (
    <Page title="Accuracy" subtitle={`Mapr's picks shown in the last ${doc?.window_days ?? 30} days${doc ? `, to ${doc.date}` : ''}. Match = positive reactions (I'd go, I loved it) out of all reactions.`}>
      <ListenerError error={src.error} />
      <div role="tablist" className="flex gap-2">
        {(['category', 'city'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} type="button" className={`btn ${tab === t ? 'btn-primary' : ''}`} onClick={() => setTab(t)}>
            By {t}
          </button>
        ))}
      </div>
      <Table<Row>
        rows={rows}
        filterKey="name"
        csvName={`mapr-accuracy-by-${tab}-${doc?.date || 'latest'}.csv`}
        initialSort={{ key: 'match_rate', desc: true }}
        highlight={(r) => (bottom.has(r.name) && rows.length > 3 ? 'Bottom 3 by match rate' : null)}
        empty={src.loading ? 'Loading…' : 'No picks shown in this window yet.'}
        columns={[
          { key: 'name', label: tab === 'category' ? 'Category' : 'City' },
          { key: 'match_rate', label: 'Match', numeric: true, render: (r) => pct(r.match_rate) },
          { key: 'skip_rate', label: 'Skip', numeric: true, render: (r) => pct(r.skip_rate) },
          { key: 'repeat_rate', label: 'Repeat', numeric: true, render: (r) => pct(r.repeat_rate) },
          { key: 'sample_size', label: 'Picks shown', numeric: true },
        ]}
      />
    </Page>
  );
}

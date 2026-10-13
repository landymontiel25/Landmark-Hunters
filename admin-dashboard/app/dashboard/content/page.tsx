'use client';
import { useCallback, useEffect, useState } from 'react';
import { Page } from '@/components/Page';
import { TrendChart } from '@/components/Chart';
import { ListenerError } from '@/components/AlertBanner';
import { useTipMetrics } from '@/lib/listeners';
import type { TipQueueRow } from '@/lib/types';

// Tips waiting for the owner (docs/discovery-network-plan.md, Phase 1):
// held by the word filter, reported, or withdrawn by their author after
// reports. Each decision goes to the app's api/admin-jobs.js through this
// dashboard's server (app/api/jobs), never from the browser to Firestore.

const STATUS_LABEL: Record<string, string> = { held: 'Held by the filter', live: 'Reported', withdrawn: 'Withdrawn after reports' };
const DECISIONS = [
  { id: 'approve', label: 'Approve', help: 'Live again; reports start over. A withdrawn tip is deleted so its author can post again.' },
  { id: 'remove', label: 'Remove', help: 'Hidden for good, photo deleted; its author cannot post at that place again.' },
  { id: 'clear', label: 'Delete', help: 'Gone for good with its marks; its author may post there again.' },
] as const;

async function job(action: string, extra: Record<string, string> = {}) {
  const r = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Failed (${r.status}).`);
  return body;
}

export default function Content() {
  const [rows, setRows] = useState<TipQueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const metrics = useTipMetrics(30);
  const latest = metrics.data?.[metrics.data.length - 1];

  const load = useCallback(async () => {
    try {
      const out = await job('tips-queue');
      setRows(out.rows || []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const decide = async (row: TipQueueRow, decision: string) => {
    // Remove and Delete can't be undone.
    if (decision !== 'approve' && !window.confirm(decision === 'remove' ? 'Remove this tip for good? Its author can never post at this place again.' : 'Delete this tip for good?')) return;
    setBusy(`${row.id}:${decision}`);
    try {
      await job('tip-moderate', { tipId: row.id, decision, ...(row.gen ? { gen: row.gen } : {}) });
      setError(null);
      setRows((list) => (list || []).filter((x) => x.id !== row.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page title="Content" subtitle="Tips held by the word filter, reported, or withdrawn after reports. Nothing here shows who reported a tip.">
      <ListenerError error={metrics.error} />
      {latest && (
        <section className="card p-4" aria-label="Tips today">
          <p className="font-medium">Tips ({latest.date})</p>
          <p className="text-sm secondary mt-1">
            {latest.live} live on {latest.live_places} places · {latest.held} held · {latest.hidden} hidden by reports · {latest.withdrawn} withdrawn · {latest.removed} removed
          </p>
          <p className="text-xs muted mt-1">
            {latest.posted} posted that day · {latest.impressions} tip impressions · {latest.authors_30d} people with a live tip from the last 30 days · {latest.helpful_total} helpful, {latest.saved_total} saved
          </p>
          {Object.keys(latest.live_by_region || {}).length > 0 && (
            <p className="text-xs muted mt-1">
              Live by region: {Object.entries(latest.live_by_region).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}
            </p>
          )}
        </section>
      )}
      <TrendChart title="Live tips" data={(metrics.data || []) as unknown as Record<string, unknown>[]} series={[{ key: 'live', label: 'Live' }, { key: 'held', label: 'Held' }]} format={(v) => String(Math.round(v))} />
      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger, #b00020)' }}>
          {error}
        </p>
      )}
      {rows == null && !error && <p className="text-sm muted">Loading…</p>}
      {rows?.length === 0 && <p className="text-sm muted">Nothing waiting. </p>}
      <div className="space-y-3">
        {(rows || []).map((row) => (
          <section key={row.id} className="card p-4 space-y-2" aria-label={`Tip by ${row.authorName || row.authorUid}`}>
            <div className="flex flex-wrap gap-2 items-baseline justify-between">
              <p className="font-medium">
                {STATUS_LABEL[row.status] || row.status}
                {row.hidden ? ' · hidden' : ''}
                {row.accountDeleted ? ' · account deleted' : ''}
              </p>
              <p className="text-xs muted">
                {row.landmarkName || row.landmarkId} ({row.region}) · by {row.authorName || row.authorUid}
                {row.createdAt ? ` · ${new Date(row.createdAt).toLocaleString()}` : ''}
              </p>
            </div>
            <p className="text-sm whitespace-pre-wrap break-words">{row.text || <span className="muted">(no text)</span>}</p>
            {row.photoURL && (
              <a href={row.photoURL} target="_blank" rel="noreferrer" className="text-xs underline">
                View photo
              </a>
            )}
            <p className="text-xs muted">
              {row.heldReasons.length ? `Filter: ${row.heldReasons.join(', ')}. ` : ''}
              {row.reportCount ? `${row.reportCount} report${row.reportCount === 1 ? '' : 's'}: ${row.reports.map((r) => r.reason).join(', ') || '(none open)'}` : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              {DECISIONS.map((d) => (
                <button key={d.id} type="button" className={`btn${d.id === 'approve' ? ' btn-primary' : ''}`} title={d.help} disabled={!!busy} onClick={() => decide(row, d.id)}>
                  {busy === `${row.id}:${d.id}` ? 'Saving…' : d.label}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Page>
  );
}

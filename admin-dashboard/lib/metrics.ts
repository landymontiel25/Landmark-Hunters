// Pure helpers for the pages: formatting, trends, deviation alerts, CSV.

export const pct = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`);
export const num = (v: number | null | undefined, digits = 2) => (v == null || !Number.isFinite(v) ? '—' : `${Math.round(v * 10 ** digits) / 10 ** digits}`);
export const when = (ms: number | null | undefined) => (ms == null || !Number.isFinite(ms) ? '—' : new Date(ms).toLocaleString());
export const bytes = (n: number | null | undefined) => (n == null ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);

const val = (row: Record<string, unknown> | undefined, key: string): number | null => {
  const v = row?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

// Change of the latest value vs the one before, in percent of the earlier.
export function trendOf(series: Record<string, unknown>[], key: string): { value: number; direction: 'up' | 'down' } | undefined {
  const pts = series.map((r) => val(r, key)).filter((v): v is number => v != null);
  if (pts.length < 2) return undefined;
  const [prev, last] = pts.slice(-2);
  if (prev === 0) return undefined;
  const change = ((last - prev) / Math.abs(prev)) * 100;
  return { value: change, direction: change >= 0 ? 'up' : 'down' };
}

// Spec alert: the latest value more than `threshold` (20%) away from the
// average of the 7 values before it.
export function deviationAlerts(series: Record<string, unknown>[], keys: { key: string; label: string }[], threshold = 0.2): string[] {
  const out: string[] = [];
  for (const { key, label } of keys) {
    const pts = series.map((r) => val(r, key));
    const last = pts[pts.length - 1];
    const prior = pts.slice(-8, -1).filter((v): v is number => v != null);
    if (last == null || prior.length < 2) continue;
    const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
    if (avg === 0) continue;
    const dev = (last - avg) / Math.abs(avg);
    if (Math.abs(dev) > threshold) out.push(`${label} is ${Math.round(Math.abs(dev) * 100)}% ${dev > 0 ? 'above' : 'below'} its 7-day average.`);
  }
  return out;
}

export function toCsv(rows: Record<string, unknown>[], cols: { key: string; label: string }[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map((c) => esc(c.label)).join(','), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(','))].join('\n');
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Accuracy map -> sorted table rows (match rate, best first).
export function accuracyRows(map: Record<string, { match_rate: number | null; skip_rate: number | null; repeat_rate: number | null; sample_size: number }> | undefined) {
  return Object.entries(map || {})
    .map(([name, r]) => ({ name, ...r }))
    .sort((a, b) => (b.match_rate ?? -1) - (a.match_rate ?? -1) || b.sample_size - a.sample_size);
}

// Whole-card tint for a goal metric: green when met, red when missed, none
// (the normal gray card) when it can't be measured or has no goal.
export const goalCardClass = (status?: string) => (status === 'met' ? 'card card-met' : status === 'missed' ? 'card card-missed' : 'card');

'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { downloadCsv, toCsv } from '@/lib/metrics';

export interface Column<T> {
  key: keyof T & string;
  label: string;
  render?: (row: T) => ReactNode;
  numeric?: boolean;
}

// Sortable, filterable table with CSV export. `highlight(row, index)` marks
// rows (icon + label column, not color alone).
export function Table<T extends Record<string, unknown>>({
  rows,
  columns,
  initialSort,
  filterKey,
  csvName,
  highlight,
  onRowClick,
  empty = 'No rows yet.',
}: {
  rows: T[];
  columns: Column<T>[];
  initialSort?: { key: keyof T & string; desc: boolean };
  filterKey?: keyof T & string;
  csvName?: string;
  highlight?: (row: T, index: number, sorted: T[]) => string | null;
  onRowClick?: (row: T) => void;
  empty?: string;
}) {
  const [sort, setSort] = useState(initialSort || null);
  const [filter, setFilter] = useState('');
  const sorted = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = filterKey && f ? rows.filter((r) => String(r[filterKey] ?? '').toLowerCase().includes(f)) : [...rows];
    if (!sort) return list;
    return list.sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      const nx = x == null ? -Infinity : x;
      const ny = y == null ? -Infinity : y;
      const c = typeof nx === 'number' && typeof ny === 'number' ? nx - ny : String(nx).localeCompare(String(ny));
      return sort.desc ? -c : c;
    });
  }, [rows, sort, filter, filterKey]);
  return (
    <div className="card p-4 space-y-3">
      {(filterKey || csvName) && (
        <div className="flex flex-wrap gap-2 items-center justify-between">
          {filterKey ? <input className="input text-sm" placeholder="Filter by name…" aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} /> : <span />}
          {csvName && (
            <button type="button" className="btn text-sm" disabled={!sorted.length} onClick={() => downloadCsv(csvName, toCsv(sorted, columns))}>
              Export CSV
            </button>
          )}
        </div>
      )}
      {!sorted.length ? (
        <p className="text-sm muted">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left secondary">
                {highlight && <th className="py-2 pr-3 font-medium w-8"><span className="sr-only">Flag</span></th>}
                {columns.map((c) => (
                  <th key={c.key} className={`py-2 pr-3 font-medium ${c.numeric ? 'text-right' : ''}`} aria-sort={sort?.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                    <button type="button" className="hover:underline" onClick={() => setSort((s) => ({ key: c.key, desc: s?.key === c.key ? !s.desc : true }))}>
                      {c.label}
                      {sort?.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const flag = highlight ? highlight(r, i, sorted) : null;
                return (
                  <tr key={i} className={`border-t ${onRowClick ? 'cursor-pointer hover:opacity-80' : ''}`} style={{ borderColor: 'var(--grid)', background: flag ? 'var(--critical-wash)' : undefined }} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                    {highlight && (
                      <td className="py-2 pr-3" title={flag || ''}>
                        {flag ? <span aria-label={flag}>⚠</span> : null}
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={`py-2 pr-3 ${c.numeric ? 'text-right tabular' : ''}`}>
                        {c.render ? c.render(r) : String(r[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

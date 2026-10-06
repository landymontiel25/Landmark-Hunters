'use client';
import { memo, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Recharts wrappers in the dataviz house style: 2px lines, hairline grid,
// muted axes, at most three categorical series (the slots that validate for
// every pair), a legend for 2+ series plus a direct end label, a crosshair
// tooltip, and a table view with the same numbers.

export interface Series {
  key: string;
  label: string;
}
const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];
const DASHES = ['', '6 4', '2 3'];

function ChartTable({ data, xKey, series, format }: { data: Record<string, unknown>[]; xKey: string; series: Series[]; format: (v: number) => string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular">
        <thead>
          <tr className="text-left secondary">
            <th className="py-1 pr-3 font-medium">{xKey}</th>
            {series.map((s) => (
              <th key={s.key} className="py-1 pr-3 font-medium">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i} className="border-t" style={{ borderColor: 'var(--grid)' }}>
              <td className="py-1 pr-3">{String(r[xKey])}</td>
              {series.map((s) => (
                <td key={s.key} className="py-1 pr-3">
                  {typeof r[s.key] === 'number' ? format(r[s.key] as number) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Frame({ title, children, table, empty }: { title: string; children: React.ReactNode; table: React.ReactNode; empty: boolean }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="card p-4">
      <figcaption className="flex items-center justify-between gap-2 mb-2">
        <span className="font-medium">{title}</span>
        {!empty && (
          <button type="button" className="text-xs underline secondary" onClick={() => setAsTable((t) => !t)}>
            {asTable ? 'Show chart' : 'Show as table'}
          </button>
        )}
      </figcaption>
      {empty ? <p className="text-sm muted py-8 text-center">No data yet. The nightly job fills this in.</p> : asTable ? table : children}
    </figure>
  );
}

// Legend text stays in text ink; the swatch beside it carries the color.
const legendText = (value: string) => <span style={{ color: 'var(--text-secondary)' }}>{value}</span>;
const axisProps = { stroke: 'var(--axis)', tick: { fill: 'var(--text-muted)', fontSize: 11 }, tickLine: false } as const;
const tooltipStyle = { background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 12 };

function LineChartImpl({ title, data, xKey = 'date', series, format = (v: number) => String(v), domain, height = 220 }: { title: string; data: Record<string, unknown>[]; xKey?: string; series: Series[]; format?: (v: number) => string; domain?: [number, number]; height?: number }) {
  const shown = series.slice(0, 3);
  const rows = useMemo(() => data.map((r) => ({ ...r, [xKey]: String(r[xKey] ?? '').slice(5) || String(r[xKey]) })), [data, xKey]);
  const empty = !data.some((r) => shown.some((s) => typeof r[s.key] === 'number'));
  return (
    <Frame title={title} empty={empty} table={<ChartTable data={data} xKey={xKey} series={shown} format={format} />}>
      <div style={{ height }} role="img" aria-label={`${title}: ${shown.map((s) => s.label).join(', ')} by day`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 56, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} width={44} tickFormatter={(v) => format(v)} domain={domain || ['auto', 'auto']} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => (typeof v === 'number' ? format(v) : String(v))} cursor={{ stroke: 'var(--axis)' }} />
            {shown.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} itemSorter={null} formatter={legendText} />}
            {shown.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={COLORS[i]} strokeWidth={2} strokeDasharray={DASHES[i]} dot={{ r: 3, strokeWidth: 0, fill: COLORS[i] }} activeDot={{ r: 5, stroke: 'var(--surface-1)', strokeWidth: 2 }} connectNulls isAnimationActive={false}>
                {shown.length > 1 && <LabelList dataKey={s.key} position="right" content={(p) => (p.index === rows.length - 1 ? <text x={Number(p.x) + 6} y={Number(p.y) + 4} fontSize={11} fill="var(--text-secondary)">{s.label}</text> : null)} />}
              </Line>
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Frame>
  );
}
export const TrendChart = memo(LineChartImpl);

function BarChartImpl({ title, data, xKey, series, format = (v: number) => String(v), height = 220 }: { title: string; data: Record<string, unknown>[]; xKey: string; series: Series[]; format?: (v: number) => string; height?: number }) {
  const shown = series.slice(0, 3);
  const empty = !data.some((r) => shown.some((s) => typeof r[s.key] === 'number'));
  return (
    <Frame title={title} empty={empty} table={<ChartTable data={data} xKey={xKey} series={shown} format={format} />}>
      <div style={{ height }} role="img" aria-label={title}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barCategoryGap={8}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} width={44} tickFormatter={(v) => format(v)} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => (typeof v === 'number' ? format(v) : String(v))} cursor={{ fill: 'var(--grid)', opacity: 0.4 }} />
            {shown.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} itemSorter={null} formatter={legendText} />}
            {shown.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={COLORS[i]} radius={[4, 4, 0, 0]} stroke="var(--surface-1)" strokeWidth={2} isAnimationActive={false}>
                {shown.length === 1 && <LabelList dataKey={s.key} position="top" fontSize={11} fill="var(--text-secondary)" formatter={(v) => (typeof v === 'number' ? format(v) : '')} />}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Frame>
  );
}
export const BarsChart = memo(BarChartImpl);

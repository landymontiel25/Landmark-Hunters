// A status message: critical (⚠) or info (ℹ). Icon + text, never color alone.
export function AlertBanner({ items, tone = 'critical' }: { items: string[]; tone?: 'critical' | 'info' }) {
  if (!items.length) return null;
  return (
    <div role={tone === 'critical' ? 'alert' : 'status'} className="card p-3 text-sm space-y-1" style={tone === 'critical' ? { background: 'var(--critical-wash)', borderColor: 'var(--critical)' } : undefined}>
      {items.map((t) => (
        <p key={t}>
          <span aria-hidden="true">{tone === 'critical' ? '⚠ ' : 'ℹ '}</span>
          {t}
        </p>
      ))}
    </div>
  );
}

// A listener that failed (Firestore down, rules, offline): the section says so.
export function ListenerError({ error }: { error: string | null }) {
  if (!error) return null;
  return <AlertBanner items={[`Live data unavailable: ${error}`]} />;
}

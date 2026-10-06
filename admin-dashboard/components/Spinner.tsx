export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm muted">
      <span className="inline-block h-4 w-4 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--grid)', borderTopColor: 'var(--accent)' }} aria-hidden="true" />
      {label}
    </div>
  );
}

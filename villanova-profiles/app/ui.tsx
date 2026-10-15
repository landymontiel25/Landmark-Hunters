import type { InputHTMLAttributes } from 'react';

export const inputClass =
  'w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-base text-ink placeholder:text-soft/70 outline-none transition focus:border-ring focus:ring-4 focus:ring-ring/20';

export const buttonClass =
  'inline-flex items-center justify-center rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-brand-ink transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50';

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-soft">{hint}</p> : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputClass} />;
}

export function Message({ kind, children }: { kind: 'error' | 'ok'; children: React.ReactNode }) {
  return (
    <p role={kind === 'error' ? 'alert' : 'status'} className={`text-sm ${kind === 'error' ? 'text-danger' : 'text-ok'}`}>
      {children}
    </p>
  );
}

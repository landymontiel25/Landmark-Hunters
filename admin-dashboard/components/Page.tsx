import type { ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

export function Page({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm secondary mt-1 max-w-3xl">{subtitle}</p>}
      </header>
      <ErrorBoundary>{children}</ErrorBoundary>
    </div>
  );
}

export const Grid = ({ children }: { children: ReactNode }) => <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
export const Two = ({ children }: { children: ReactNode }) => <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">{children}</div>;

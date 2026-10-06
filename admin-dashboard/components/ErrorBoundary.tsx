'use client';
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}
interface State {
  hasError: boolean;
  error: Error | null;
}

// Catches a render error in one section so the rest of the page stays up.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error) {
    console.error('[Dashboard] Error boundary caught:', error);
  }
  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div role="alert" className="card p-4" style={{ background: 'var(--critical-wash)' }}>
            <p className="font-semibold">⚠ Something went wrong in this section</p>
            <p className="text-sm secondary">{this.state.error?.message}</p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

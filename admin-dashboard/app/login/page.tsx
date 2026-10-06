'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Sign-in failed (${r.status}).`);
      router.replace('/dashboard');
    } catch (err) {
      setError(String((err as Error).message || err));
      setBusy(false);
    }
  };
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6 space-y-4" aria-label="Sign in">
        <div>
          <h1 className="text-xl font-semibold">Landmark Hunters Admin</h1>
          <p className="text-sm secondary mt-1">Owner-only. Enter the dashboard password.</p>
        </div>
        <label className="block text-sm">
          <span className="secondary">Password</span>
          <input className="input w-full mt-1" type="password" autoComplete="current-password" value={token} onChange={(e) => setToken(e.target.value)} required aria-invalid={!!error} />
        </label>
        {error && (
          <p role="alert" className="text-sm" style={{ color: 'var(--critical)' }}>
            {error}
          </p>
        )}
        <button className="btn btn-primary w-full justify-center" disabled={busy || !token}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

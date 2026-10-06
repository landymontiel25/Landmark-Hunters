'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Checks once that the server can reach Firestore, then lets the listener
// hooks start. Until then (or if it fails) hooks don't fetch and pages show
// the reason the server gave.
type GateState = { ready: boolean; error: string | null };
const Ctx = createContext<GateState>({ ready: false, error: null });
export const useFirebaseGate = () => useContext(Ctx);

export async function pingServer(fetchImpl: typeof fetch = fetch): Promise<void> {
  const r = await fetchImpl('/api/firestore-read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'ping' }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Firestore check failed (${r.status}).`);
}

export function FirebaseGate({ children, check = pingServer }: { children: ReactNode; check?: () => Promise<void> }) {
  const [state, setState] = useState<GateState>({ ready: false, error: null });
  useEffect(() => {
    let cancelled = false;
    check()
      .then(() => !cancelled && setState({ ready: true, error: null }))
      .catch((e) => !cancelled && setState({ ready: false, error: String(e?.message || e) }));
    return () => {
      cancelled = true;
    };
  }, [check]);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

// For tests and previews: a gate in a given state.
export function FirebaseGateValue({ value, children }: { value: GateState; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

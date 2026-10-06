'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { clientFirebase, ensureDashboardSignIn } from './firestore';
import type { Firestore } from 'firebase/firestore';

// Signs the browser in as the dashboard once, then hands Firestore to every
// listener hook. Until then (or if it fails) hooks don't subscribe and pages
// show the reason.
type GateState = { db: Firestore | null; ready: boolean; error: string | null };
const Ctx = createContext<GateState>({ db: null, ready: false, error: null });
export const useFirebaseGate = () => useContext(Ctx);

export function FirebaseGate({ children, signIn = ensureDashboardSignIn }: { children: ReactNode; signIn?: () => Promise<void> }) {
  const [state, setState] = useState<GateState>({ db: null, ready: false, error: null });
  useEffect(() => {
    let cancelled = false;
    signIn()
      .then(() => {
        const fb = clientFirebase();
        if (!cancelled) setState({ db: fb?.db || null, ready: !!fb, error: fb ? null : 'Firebase is not configured.' });
      })
      .catch((e) => !cancelled && setState({ db: null, ready: false, error: String(e?.message || e) }));
    return () => {
      cancelled = true;
    };
  }, [signIn]);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

// For tests and previews: a ready gate around a given Firestore.
export function FirebaseGateValue({ value, children }: { value: GateState; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

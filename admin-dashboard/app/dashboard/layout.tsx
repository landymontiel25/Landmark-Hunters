'use client';
import type { ReactNode } from 'react';
import { FirebaseGate, useFirebaseGate } from '@/lib/FirebaseGate';
import { Sidebar } from '@/components/Sidebar';
import { AlertBanner } from '@/components/AlertBanner';
import { AutoRefresh } from '@/components/AutoRefresh';

function GateNotice() {
  const { error } = useFirebaseGate();
  return error ? <AlertBanner items={[`Can't connect to Firestore: ${error}`]} /> : null;
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <FirebaseGate>
      <div className="md:flex">
        <Sidebar />
        <main className="flex-1 min-w-0 p-4 md:p-8 space-y-4">
          <GateNotice />
          <AutoRefresh />
          {children}
          <footer className="text-xs muted pt-6">Live from Firestore. Daily numbers are written by the app&apos;s nightly job at 00:23 UTC (8:23 PM Eastern, 7:23 PM in winter).</footer>
        </main>
      </div>
    </FirebaseGate>
  );
}

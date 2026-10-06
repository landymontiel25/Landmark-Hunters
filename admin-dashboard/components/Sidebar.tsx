'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { RealtimeStatus } from './RealtimeStatus';
import { dashboardSignOut } from '@/lib/firestore';

export const NAV = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/mapr-phase-1', label: 'Mapr Phase 1' },
  { href: '/dashboard/growth', label: 'Growth' },
  { href: '/dashboard/retention', label: 'Retention' },
  { href: '/dashboard/engagement', label: 'Engagement' },
  { href: '/dashboard/accuracy', label: 'Accuracy' },
  { href: '/dashboard/taste', label: 'Taste' },
  { href: '/dashboard/app-metrics', label: 'App metrics' },
  { href: '/dashboard/tools', label: 'Tools' },
];

export function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const logout = async () => {
    await dashboardSignOut();
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    router.replace('/login');
  };
  return (
    <>
      <div className="md:hidden flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
        <span className="font-semibold">LH Admin</span>
        <button type="button" className="btn" aria-expanded={open} aria-controls="side-nav" onClick={() => setOpen((o) => !o)}>
          ☰ Menu
        </button>
      </div>
      <nav id="side-nav" aria-label="Dashboard" className={`${open ? 'block' : 'hidden'} md:block md:w-56 shrink-0 p-4 space-y-4 md:min-h-screen border-r`} style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
        <div className="hidden md:block">
          <p className="font-semibold">Landmark Hunters</p>
          <p className="text-xs muted">Admin dashboard</p>
        </div>
        <ul className="space-y-1">
          {NAV.map((n) => (
            <li key={n.href}>
              <Link href={n.href} className="nav-link" aria-current={path === n.href ? 'page' : undefined} onClick={() => setOpen(false)}>
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
        <RealtimeStatus />
        <button type="button" className="btn w-full justify-center" onClick={logout}>
          Sign out
        </button>
      </nav>
    </>
  );
}

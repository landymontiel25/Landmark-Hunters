import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';

// Next.js 16 "proxy" (formerly middleware): every dashboard page and every
// API route except login needs a valid session cookie. Pages redirect to
// /login; API calls get 401.
export async function proxy(req: NextRequest) {
  const ok = await verifySession(req.cookies.get(SESSION_COOKIE)?.value).catch(() => false);
  if (ok) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const url = new URL('/login', req.url);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/firebase-token', '/api/jobs'],
};

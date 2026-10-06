import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, cookieOptions, loginLimited, passwordMatches, signSession } from '@/lib/auth';

// POST { token } -> sets the session cookie when it matches ADMIN_SECRET_TOKEN.
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (loginLimited(ip)) return NextResponse.json({ error: 'Too many attempts. Wait 15 minutes.' }, { status: 429 });
  if (!process.env.ADMIN_SECRET_TOKEN || !process.env.JWT_SECRET) {
    return NextResponse.json({ error: 'ADMIN_SECRET_TOKEN and JWT_SECRET must be set on the server.' }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  if (!passwordMatches(body?.token)) return NextResponse.json({ error: 'Wrong password.' }, { status: 401 });
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, await signSession(), cookieOptions());
  return res;
}

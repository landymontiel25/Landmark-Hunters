import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';
import { forwardJob } from '@/lib/jobs';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!(await verifySession(req.cookies.get(SESSION_COOKIE)?.value))) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { status, body: out } = await forwardJob(body?.action);
  return NextResponse.json(out, { status });
}

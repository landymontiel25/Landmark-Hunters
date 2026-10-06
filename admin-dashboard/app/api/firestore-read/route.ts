import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';
import { deadKeyProblem, parseServiceAccount } from '@/lib/firebaseAdmin';
import { accessToken, MISS_STATUSES, READABLE, readDoc, readLatest, saveReview } from '@/lib/firestoreServer';

// Signed-in dashboard only (proxy.ts checks too). The browser asks; this
// reads Firestore with the service-account key and answers with plain JSON.
const NAME = /^[A-Za-z0-9_]{1,64}$/;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;

export async function POST(req: NextRequest) {
  if (!(await verifySession(req.cookies.get(SESSION_COOKIE)?.value))) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.kind !== 'string') return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  const noStore = { headers: { 'Cache-Control': 'no-store' } };
  try {
    const account = parseServiceAccount();
    if (body.kind === 'ping') {
      const dead = await deadKeyProblem(account);
      if (dead) throw new Error(dead);
      await accessToken(account);
      return NextResponse.json({ ok: true }, noStore);
    }
    const col = String(body.col || '');
    if (body.kind !== 'review' && !READABLE.includes(col)) return NextResponse.json({ error: 'Unknown collection.' }, { status: 400 });
    if (body.kind === 'latest') {
      const field = String(body.field || '');
      const n = Math.min(Math.max(Number(body.n) || 1, 1), 500);
      if (!NAME.test(field)) return NextResponse.json({ error: 'Bad field.' }, { status: 400 });
      return NextResponse.json({ docs: await readLatest(col, field, n, account) }, noStore);
    }
    if (body.kind === 'doc') {
      const id = String(body.id || '');
      if (!ID.test(id)) return NextResponse.json({ error: 'Bad id.' }, { status: 400 });
      return NextResponse.json({ doc: await readDoc(col, id, account) }, noStore);
    }
    if (body.kind === 'review') {
      const id = String(body.id || '');
      const status = String(body.status || '');
      if (!ID.test(id) || !MISS_STATUSES.includes(status)) return NextResponse.json({ error: 'Bad review.' }, { status: 400 });
      return NextResponse.json(await saveReview(id, status, String(body.resolution || ''), account), noStore);
    }
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    console.error('firestore-read error:', msg);
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';
import { mintDashboardToken } from '@/lib/firebaseAdmin';

// Signed-in dashboard only (proxy.ts checks too): a Firebase custom token
// carrying dashboardAdmin: true, the only identity firestore.rules lets read
// the stats. The browser signs in with it and listens to Firestore live.
export async function POST(req: NextRequest) {
  if (!(await verifySession(req.cookies.get(SESSION_COOKIE)?.value))) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  try {
    return NextResponse.json({ token: await mintDashboardToken() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: `Could not create the Firebase sign-in: ${String((e as Error)?.message || e)}` }, { status: 503 });
  }
}

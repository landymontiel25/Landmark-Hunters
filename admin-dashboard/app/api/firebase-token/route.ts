import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';
import { deadKeyProblem, mintDashboardToken, parseServiceAccount } from '@/lib/firebaseAdmin';

// Signed-in dashboard only (proxy.ts checks too): a Firebase custom token
// carrying dashboardAdmin: true, the only identity firestore.rules lets read
// the stats. The browser signs in with it and listens to Firestore live.
export async function POST(req: NextRequest) {
  if (!(await verifySession(req.cookies.get(SESSION_COOKIE)?.value))) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  try {
    const account = parseServiceAccount();
    const dead = await deadKeyProblem(account);
    if (dead) throw new Error(dead);
    // Timeout after 5 seconds to prevent hanging
    const tokenPromise = mintDashboardToken(account);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Firebase token creation timed out (5s)')), 5000)
    );
    const token = await Promise.race([tokenPromise, timeoutPromise]);
    return NextResponse.json({ token }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    console.error('firebase-token error:', msg);
    return NextResponse.json({ error: `Could not create the Firebase sign-in: ${msg}` }, { status: 503 });
  }
}

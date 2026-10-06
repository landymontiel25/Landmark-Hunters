import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';

// The root sends you to the dashboard when signed in, else to the login page.
export default async function Home() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  redirect((await verifySession(token).catch(() => false)) ? '/dashboard' : '/login');
}

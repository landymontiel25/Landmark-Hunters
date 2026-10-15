import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { buttonClass } from './ui';

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect('/profile');

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-16">
      <p className="text-sm font-semibold uppercase tracking-widest text-brand">Villanova Profiles</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Your Villanova profile, in one place.</h1>
      <p className="mt-4 text-lg text-soft">Add your name, year, major, bio and a photo. Sign in with your @villanova.edu email and a 6-digit code. No password.</p>
      <div className="mt-8">
        <Link href="/login" className={buttonClass}>
          Sign in or sign up
        </Link>
      </div>
    </main>
  );
}

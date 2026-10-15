import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Sign in · Villanova Profiles' };

export default async function LoginPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect('/profile');

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-16">
      <div className="rounded-2xl border border-line bg-card p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in or sign up</h1>
        <p className="mt-1 text-sm text-soft">Only @villanova.edu emails can join.</p>
        <div className="mt-6">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '../actions';
import { ProfileForm } from './ProfileForm';

export const metadata = { title: 'Your profile · Villanova Profiles' };

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, year, major, bio, avatar_path, updated_at')
    .eq('id', user.id)
    .maybeSingle();

  let avatarUrl: string | null = null;
  if (profile?.avatar_path) {
    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(profile.avatar_path);
    avatarUrl = `${pub.publicUrl}?v=${encodeURIComponent(profile.updated_at ?? '')}`;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
          <p className="text-sm text-soft">{user.email}</p>
        </div>
        <form action={signOut}>
          <button type="submit" className="rounded-xl border border-line px-3.5 py-2 text-sm font-medium transition hover:bg-card">
            Sign out
          </button>
        </form>
      </header>
      <div className="rounded-2xl border border-line bg-card p-6 shadow-sm sm:p-8">
        <ProfileForm
          avatarUrl={avatarUrl}
          initial={{ name: profile?.name ?? '', year: profile?.year ?? '', major: profile?.major ?? '', bio: profile?.bio ?? '' }}
        />
      </div>
    </main>
  );
}

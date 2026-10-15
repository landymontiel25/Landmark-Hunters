'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { checkPhoto, isSixDigitCode, isVillanovaEmail, normalizeEmail, parseProfile } from '@/lib/validation';

export type LoginResult = { ok: true } | { ok: false; error: string };
export type ProfileState = { error?: string; saved?: boolean };

export async function sendCode(rawEmail: string): Promise<LoginResult> {
  const email = normalizeEmail(rawEmail);
  if (!isVillanovaEmail(email)) return { ok: false, error: 'Use your @villanova.edu email address.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) return { ok: false, error: 'We could not send a code. Wait a minute and try again.' };
  return { ok: true };
}

export async function verifyCode(rawEmail: string, rawCode: string): Promise<LoginResult> {
  const email = normalizeEmail(rawEmail);
  const token = rawCode.trim();
  if (!isVillanovaEmail(email)) return { ok: false, error: 'Start again with your @villanova.edu email.' };
  if (!isSixDigitCode(token)) return { ok: false, error: 'Enter the 6-digit code from your email.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) return { ok: false, error: 'That code is wrong or expired.' };
  return { ok: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}

export async function saveProfile(_prev: ProfileState, form: FormData): Promise<ProfileState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) redirect('/login');

  const parsed = parseProfile(form);
  if (!parsed.ok) return { error: parsed.error };

  const row: Record<string, unknown> = { id: user.id, ...parsed.value, updated_at: new Date().toISOString() };

  const photo = form.get('photo');
  if (photo instanceof File && photo.size > 0) {
    const problem = checkPhoto(photo);
    if (problem) return { error: problem };
    // One photo per person: the same path is overwritten on every upload.
    const path = `${user.id}/avatar`;
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, photo, { upsert: true, contentType: photo.type, cacheControl: '3600' });
    if (uploadError) return { error: 'The photo did not upload. Try again.' };
    row.avatar_path = path;
  }

  const { error } = await supabase.from('profiles').upsert(row);
  if (error) return { error: 'Your profile did not save. Try again.' };
  revalidatePath('/profile');
  return { saved: true };
}

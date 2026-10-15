'use client';

import { useActionState, useEffect, useState } from 'react';
import { saveProfile, type ProfileState } from '../actions';
import { YEARS } from '@/lib/validation';
import { buttonClass, Field, inputClass, Message, TextInput } from '../ui';

type Props = {
  avatarUrl: string | null;
  initial: { name: string; year: string; major: string; bio: string };
};

export function ProfileForm({ avatarUrl, initial }: Props) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(saveProfile, {});
  const [preview, setPreview] = useState<string | null>(null);
  const [bioLength, setBioLength] = useState(initial.bio.length);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const shown = preview ?? avatarUrl;
  const initials = initial.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <form action={action} className="space-y-6">
      <div className="flex items-center gap-4">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="Your profile photo" className="size-20 rounded-full border border-line object-cover" />
        ) : (
          <div aria-hidden className="grid size-20 place-items-center rounded-full bg-brand text-2xl font-semibold text-brand-ink">
            {initials}
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="photo" className="block text-sm font-medium">
            Photo
          </label>
          <input
            id="photo"
            name="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              setPreview(file ? URL.createObjectURL(file) : null);
            }}
            className="block w-full text-sm text-soft file:mr-3 file:rounded-lg file:border file:border-line file:bg-bg file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink"
          />
          <p className="text-xs text-soft">JPG, PNG or WebP, up to 5 MB.</p>
        </div>
      </div>

      <Field label="Name" htmlFor="name">
        <TextInput id="name" name="name" required maxLength={80} autoComplete="name" defaultValue={initial.name} />
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Year" htmlFor="year">
          <select id="year" name="year" required defaultValue={initial.year} className={inputClass}>
            <option value="" disabled>
              Select your year
            </option>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Major" htmlFor="major">
          <TextInput id="major" name="major" required maxLength={80} defaultValue={initial.major} />
        </Field>
      </div>

      <Field label="Bio" htmlFor="bio" hint={`${bioLength}/500`}>
        <textarea id="bio" name="bio" rows={4} maxLength={500} defaultValue={initial.bio} onChange={(e) => setBioLength(e.target.value.length)} className={inputClass} />
      </Field>

      <div className="flex items-center gap-4">
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending ? 'Saving…' : 'Save profile'}
        </button>
        {state.error ? <Message kind="error">{state.error}</Message> : null}
        {state.saved && !pending ? <Message kind="ok">Saved.</Message> : null}
      </div>
    </form>
  );
}

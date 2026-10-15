export const ALLOWED_DOMAIN = 'villanova.edu';
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate'] as const;

export type Year = (typeof YEARS)[number];

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** True for `name@villanova.edu` only. Subdomains and look-alikes fail. */
export function isVillanovaEmail(raw: string): boolean {
  const email = normalizeEmail(raw);
  return /^[a-z0-9._%+-]+@villanova\.edu$/.test(email);
}

export function isSixDigitCode(raw: string): boolean {
  return /^\d{6}$/.test(raw.trim());
}

export type ProfileInput = { name: string; year: Year; major: string; bio: string };

export function parseProfile(form: FormData): { ok: true; value: ProfileInput } | { ok: false; error: string } {
  const name = String(form.get('name') ?? '').trim();
  const year = String(form.get('year') ?? '');
  const major = String(form.get('major') ?? '').trim();
  const bio = String(form.get('bio') ?? '').trim();

  if (!name) return { ok: false, error: 'Enter your name.' };
  if (name.length > 80) return { ok: false, error: 'Name can be up to 80 characters.' };
  if (!(YEARS as readonly string[]).includes(year)) return { ok: false, error: 'Pick your year.' };
  if (!major) return { ok: false, error: 'Enter your major.' };
  if (major.length > 80) return { ok: false, error: 'Major can be up to 80 characters.' };
  if (bio.length > 500) return { ok: false, error: 'Bio can be up to 500 characters.' };
  return { ok: true, value: { name, year: year as Year, major, bio } };
}

export function checkPhoto(file: File): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return 'Use a JPG, PNG or WebP photo.';
  if (file.size > MAX_PHOTO_BYTES) return 'Photo must be 5 MB or smaller.';
  return null;
}

import { describe, expect, it } from 'vitest';
import { checkPhoto, isSixDigitCode, isVillanovaEmail, parseProfile } from './validation';

describe('isVillanovaEmail', () => {
  it('accepts villanova.edu addresses in any case', () => {
    expect(isVillanovaEmail('jsmith@villanova.edu')).toBe(true);
    expect(isVillanovaEmail('  JSmith@Villanova.EDU ')).toBe(true);
  });
  it('rejects other domains, subdomains and look-alikes', () => {
    expect(isVillanovaEmail('jsmith@gmail.com')).toBe(false);
    expect(isVillanovaEmail('jsmith@mail.villanova.edu')).toBe(false);
    expect(isVillanovaEmail('jsmith@villanova.edu.evil.com')).toBe(false);
    expect(isVillanovaEmail('jsmith@evilvillanova.edu')).toBe(false);
    expect(isVillanovaEmail('a@b@villanova.edu')).toBe(false);
    expect(isVillanovaEmail('')).toBe(false);
  });
});

describe('isSixDigitCode', () => {
  it('needs exactly six digits', () => {
    expect(isSixDigitCode('123456')).toBe(true);
    expect(isSixDigitCode(' 123456 ')).toBe(true);
    expect(isSixDigitCode('12345')).toBe(false);
    expect(isSixDigitCode('1234567')).toBe(false);
    expect(isSixDigitCode('12a456')).toBe(false);
  });
});

function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

describe('parseProfile', () => {
  const good = { name: 'Sam Wildcat', year: 'Junior', major: 'Biology', bio: 'Hi' };
  it('accepts a complete profile', () => {
    expect(parseProfile(form(good))).toEqual({ ok: true, value: good });
  });
  it('rejects missing or invalid fields', () => {
    expect(parseProfile(form({ ...good, name: ' ' })).ok).toBe(false);
    expect(parseProfile(form({ ...good, year: 'Alumnus' })).ok).toBe(false);
    expect(parseProfile(form({ ...good, major: '' })).ok).toBe(false);
    expect(parseProfile(form({ ...good, bio: 'x'.repeat(501) })).ok).toBe(false);
  });
});

describe('checkPhoto', () => {
  it('limits type and size', () => {
    expect(checkPhoto(new File(['x'], 'a.png', { type: 'image/png' }))).toBeNull();
    expect(checkPhoto(new File(['x'], 'a.gif', { type: 'image/gif' }))).not.toBeNull();
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'a.jpg', { type: 'image/jpeg' });
    expect(checkPhoto(big)).not.toBeNull();
  });
});

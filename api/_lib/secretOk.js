import { timingSafeEqual } from 'node:crypto';

// Constant-time check of an `Authorization: Bearer <secret>` header, so the
// secret can't be guessed byte by byte from response timing.
export function secretOk(header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

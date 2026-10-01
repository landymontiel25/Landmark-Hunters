import { describe, it, expect } from 'vitest';
import { tripOwnerAction } from './tripAccountGuard';

describe('tripOwnerAction', () => {
  it('wipes the trip when a different account signs in', () => {
    expect(tripOwnerAction('alice', 'bob')).toBe('reset-and-claim');
  });
  it('wipes the trip on sign-out', () => {
    expect(tripOwnerAction('alice', null)).toBe('reset');
  });
  it('keeps the trip for the same account', () => {
    expect(tripOwnerAction('alice', 'alice')).toBe('keep');
  });
  it('adopts a trip built before there was an owner (guest / older install)', () => {
    expect(tripOwnerAction(null, 'alice')).toBe('claim');
    expect(tripOwnerAction(null, null)).toBe('keep');
  });
});

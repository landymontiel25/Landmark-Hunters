import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  readPersisted,
  writePersisted,
  clearPersisted,
  markDraftSubmitting,
  unmarkDraftSubmitting,
  isDraftSubmitting,
} from './usePersistentState';

describe('draft submit-in-flight flag', () => {
  it('tracks keys marked as submitting and releases them', () => {
    expect(isDraftSubmitting('k1')).toBe(false);
    markDraftSubmitting('k1');
    expect(isDraftSubmitting('k1')).toBe(true);
    unmarkDraftSubmitting('k1');
    expect(isDraftSubmitting('k1')).toBe(false);
    expect(isDraftSubmitting(null)).toBe(false);
  });
});

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));

describe('persisted drafts', () => {
  it('round-trips a value', () => {
    writePersisted('form.a', { name: 'Tower', cats: ['tech'] });
    expect(readPersisted('form.a')).toEqual({ name: 'Tower', cats: ['tech'] });
  });

  it('drops drafts older than the ttl', () => {
    writePersisted('form.b', 'old');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 10_000);
    expect(readPersisted('form.b', 5_000)).toBeUndefined();
    vi.restoreAllMocks();
  });

  it('clears a draft', () => {
    writePersisted('form.c', 'x');
    clearPersisted('form.c');
    expect(readPersisted('form.c')).toBeUndefined();
  });

  it('survives storage that throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    });
    expect(() => writePersisted('k', 1)).not.toThrow();
    expect(readPersisted('k')).toBeUndefined();
  });
});

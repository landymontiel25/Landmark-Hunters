// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { saveListReturn, takeListReturn } from './listReturn';

beforeEach(() => sessionStorage.clear());

describe('listReturn', () => {
  it('hands back what was saved once, then nothing', () => {
    saveListReturn('landmarks', { y: 1200, city: 'miami', count: 150 });
    expect(takeListReturn('landmarks')).toEqual({ y: 1200, city: 'miami', count: 150 });
    expect(takeListReturn('landmarks')).toBeNull();
  });

  it('keeps lists apart and survives junk', () => {
    saveListReturn('a', { y: 1 });
    expect(takeListReturn('b')).toBeNull();
    sessionStorage.setItem('list-return:c', 'not json');
    expect(takeListReturn('c')).toBeNull();
  });
});

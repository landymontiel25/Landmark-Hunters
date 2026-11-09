import { describe, it, expect, beforeEach } from 'vitest';
import { warmImages, _resetWarmImages } from './warmImages';

class FakeImage {
  static made = [];
  constructor() {
    FakeImage.made.push(this);
  }
  set src(v) {
    this._src = v;
    queueMicrotask(() => this.onload?.());
  }
  get src() {
    return this._src;
  }
}

describe('warmImages', () => {
  beforeEach(() => {
    FakeImage.made = [];
    _resetWarmImages();
  });
  it('starts the first ones at once at high priority, the rest in batches', async () => {
    const urls = Array.from({ length: 10 }, (_, i) => `u${i}`);
    warmImages(urls, { first: 3, batch: 2, ImageCtor: FakeImage });
    expect(FakeImage.made).toHaveLength(3);
    expect(FakeImage.made.every((i) => i.fetchPriority === 'high')).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(FakeImage.made).toHaveLength(10);
    expect(FakeImage.made.slice(3).every((i) => i.fetchPriority === 'low')).toBe(true);
  });
  it('skips URLs it already started and blanks', () => {
    warmImages(['a', 'a', '', null, 'b'], { first: 5, ImageCtor: FakeImage });
    expect(FakeImage.made.map((i) => i.src)).toEqual(['a', 'b']);
    warmImages(['a', 'c'], { first: 5, ImageCtor: FakeImage });
    expect(FakeImage.made.map((i) => i.src)).toEqual(['a', 'b', 'c']);
  });
  it('stops starting batches once told to', async () => {
    const stop = warmImages(Array.from({ length: 10 }, (_, i) => `x${i}`), { first: 2, batch: 2, ImageCtor: FakeImage });
    stop();
    await new Promise((r) => setTimeout(r, 20));
    expect(FakeImage.made.length).toBeLessThan(10);
  });
});

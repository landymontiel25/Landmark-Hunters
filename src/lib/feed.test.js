import { describe, it, expect } from 'vitest';
import { composeFeed, FEED_SIZE } from './feed.js';

const tips = (n, f = (i) => ({ finderUid: `f${i}`, followed: false })) => Array.from({ length: n }, (_, i) => ({ key: `t${i}`, ...f(i) }));
const mapr = (n) => Array.from({ length: n }, (_, i) => ({ key: `m${i}` }));

describe('composeFeed', () => {
  it('gives 30 items, every 6th one of Mapr\'s own picks', () => {
    const feed = composeFeed(tips(40), mapr(10));
    expect(feed).toHaveLength(FEED_SIZE);
    feed.forEach((x, i) => expect(x.kind).toBe((i + 1) % 6 === 0 ? 'mapr' : 'tip'));
  });
  it('never more than 2 in a row from one finder', () => {
    const feed = composeFeed(tips(12, (i) => ({ finderUid: i < 8 ? 'same' : `f${i}`, followed: false })), mapr(5));
    let run = 0;
    let prev = null;
    for (const x of feed) {
      run = x.finderUid && x.finderUid === prev ? run + 1 : 1;
      prev = x.finderUid;
      expect(run).toBeLessThanOrEqual(2);
    }
  });
  it('at most 1 in 5 from people you follow', () => {
    const feed = composeFeed(tips(40, (i) => ({ finderUid: `f${i}`, followed: i < 30 })), mapr(10));
    const followed = feed.filter((x) => x.followed).length;
    expect(followed).toBeLessThanOrEqual(Math.ceil(feed.length / 5));
    feed.forEach((_, i) => expect(feed.slice(0, i + 1).filter((x) => x.followed).length).toBeLessThanOrEqual(Math.ceil((i + 1) / 5)));
  });
  it('fills with Mapr picks when tips run out, and stops when both do', () => {
    expect(composeFeed(tips(2), mapr(3)).map((x) => x.kind)).toEqual(['tip', 'tip', 'mapr', 'mapr', 'mapr']);
    expect(composeFeed([], [])).toEqual([]);
  });
});

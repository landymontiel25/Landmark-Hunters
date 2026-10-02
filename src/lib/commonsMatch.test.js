import { describe, it, expect } from 'vitest';
import { toCandidate, scoreCandidate, pickBest, resultFor, licenseOk } from './commonsMatch';

const page = (over = {}) => ({
  title: 'File:Corr Hall Villanova.jpg',
  imageinfo: [{ mime: 'image/jpeg', width: 2000, height: 1300, descriptionurl: 'https://commons.wikimedia.org/wiki/File:Corr_Hall_Villanova.jpg', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' }, Artist: { value: '<a href="x">Jane Doe</a>' }, ImageDescription: { value: 'Corr Hall at Villanova University' } } }],
  ...over,
});
const lm = { region: 'villanova', id: 'corr-hall', name: 'Corr Hall' };

describe('commons matching', () => {
  it('accepts only public domain, CC0, CC BY and CC BY-SA', () => {
    for (const l of ['CC BY-SA 4.0', 'CC BY 2.0', 'CC0', 'Public domain']) expect(licenseOk(l)).toBe(true);
    for (const l of ['CC BY-NC 4.0', 'CC BY-ND 2.0', 'Fair use', '']) expect(licenseOk(l)).toBe(false);
  });

  it('drops small, portrait, non-jpeg and author-less files', () => {
    expect(toCandidate(page())).toBeTruthy();
    expect(toCandidate(page({ imageinfo: [{ ...page().imageinfo[0], width: 500, height: 400 }] }))).toBeNull();
    expect(toCandidate(page({ imageinfo: [{ ...page().imageinfo[0], width: 900, height: 2000 }] }))).toBeNull();
    expect(toCandidate(page({ imageinfo: [{ ...page().imageinfo[0], mime: 'image/svg+xml' }] }))).toBeNull();
    expect(toCandidate(page({ imageinfo: [{ ...page().imageinfo[0], extmetadata: { LicenseShortName: { value: 'CC BY 4.0' } } }] }))).toBeNull();
  });

  it('scores the exact place and rejects a different one', () => {
    const c = toCandidate(page());
    expect(scoreCandidate(lm, c, null)).toBeGreaterThan(0);
    expect(scoreCandidate({ ...lm, name: 'Mendel Hall' }, c, 20)).toBe(0);
    expect(scoreCandidate({ ...lm, name: 'Hall' }, toCandidate(page({ title: 'File:Hall.jpg' })), 10)).toBe(0);
  });

  it('needs location evidence when the name is only in the description', () => {
    const c = toCandidate(page({ title: 'File:IMG_1234.jpg' }));
    expect(scoreCandidate(lm, c, null)).toBe(0);
    expect(scoreCandidate(lm, c, 80)).toBeGreaterThan(0);
    expect(scoreCandidate(lm, c, 400)).toBe(0);
  });

  it('builds a Special:FilePath result with credit fields', () => {
    const c = toCandidate(page());
    const best = pickBest(lm, [{ candidate: c, score: scoreCandidate(lm, c, 30), near: true }]);
    const r = resultFor(lm, best);
    expect(r).toMatchObject({ status: 'found', author: 'Jane Doe', license: 'CC BY-SA 4.0' });
    expect(r.imageUrl).toBe('https://commons.wikimedia.org/wiki/Special:FilePath/Corr_Hall_Villanova.jpg?width=1200');
    expect(resultFor(lm, null).status).toBe('none');
  });
});

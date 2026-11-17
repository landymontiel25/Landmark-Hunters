import { describe, expect, it } from 'vitest';
import { checkMissionPhoto, FRESH_MS } from './missionPhoto';
import { exifDateToMs, readExif } from './exif';

const lighthouse = { name: 'Elbow Reef Lighthouse', lat: 26.5397438, lng: -76.9621486, checkInRadiusMeters: 150 };
const checkedInAt = new Date(2026, 10, 16, 10, 0, 0).getTime();
const now = checkedInAt + 20 * 60 * 1000;
const here = { lat: 26.5398, lng: -76.9622 };
const farAway = { lat: 26.7583, lng: -77.3292 }; // New Plymouth

describe('checkMissionPhoto', () => {
  it('accepts a photo with GPS at the place, taken after the check-in', () => {
    expect(checkMissionPhoto({ landmark: lighthouse, checkedInAt, photo: { ...here, takenAt: now - 5000 }, now }).ok).toBe(true);
  });

  it('accepts a fresh camera photo with no GPS when the live fix is here', () => {
    const out = checkMissionPhoto({ landmark: lighthouse, checkedInAt, photo: {}, fileTime: now - 3000, device: { ...here, accuracy: 10, at: now }, now });
    expect(out.ok).toBe(true);
  });

  it('rejects a photo with no location', () => {
    const out = checkMissionPhoto({ landmark: lighthouse, checkedInAt, photo: {}, fileTime: now - 3000, device: null, now });
    expect(out).toMatchObject({ ok: false, reason: 'no-location' });
    expect(out.message).toMatch(/Retake it at Elbow Reef Lighthouse\./);
  });

  it("never uses the live fix for a photo that isn't fresh", () => {
    const out = checkMissionPhoto({ landmark: lighthouse, checkedInAt, photo: { takenAt: now - FRESH_MS - 1000 }, device: { ...here, at: now }, now });
    expect(out.reason).toBe('no-location');
  });

  it('rejects a photo taken somewhere else', () => {
    expect(checkMissionPhoto({ landmark: lighthouse, checkedInAt, photo: { ...farAway, takenAt: now - 5000 }, now }).reason).toBe('too-far');
  });

  it('rejects an old library photo taken before the check-in', () => {
    const out = checkMissionPhoto({ landmark: lighthouse, checkedInAt, photo: { ...here, takenAt: checkedInAt - 3 * 86400000 }, now });
    expect(out.reason).toBe('before-checkin');
    expect(out.message).toMatch(/before you checked in/);
  });

  it('rejects a photo from another day', () => {
    const out = checkMissionPhoto({ landmark: lighthouse, checkedInAt, photo: { ...here, takenAt: checkedInAt + 20 * 3600000 }, now: checkedInAt + 21 * 3600000 });
    expect(out.reason).toBe('other-visit');
  });

  it('needs a check-in first', () => {
    expect(checkMissionPhoto({ landmark: lighthouse, checkedInAt: null, photo: { ...here, takenAt: now }, now }).reason).toBe('no-checkin');
  });

  it('uses the place\'s own check-in radius', () => {
    const cay = { name: 'Powell Cay', lat: 26.9033808, lng: -77.4784222, checkInRadiusMeters: 1500 };
    expect(checkMissionPhoto({ landmark: cay, checkedInAt, photo: { lat: 26.912, lng: -77.4784, takenAt: now }, now }).ok).toBe(true);
  });
});

// A minimal JPEG: SOI, an APP1 EXIF block (big-endian TIFF) with
// DateTimeOriginal and GPS, then EOI.
function jpegWithExif({ date, lat, lng }) {
  const bytes = [];
  const u16 = (v) => bytes.push((v >> 8) & 255, v & 255);
  const u32 = (v) => bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const tiff = [];
  const t16 = (v) => tiff.push((v >> 8) & 255, v & 255);
  const t32 = (v) => tiff.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const entry = (tag, type, count, value) => {
    t16(tag);
    t16(type);
    t32(count);
    t32(value);
  };
  const dmsOf = (x) => {
    const a = Math.abs(x);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const s = Math.round(((a - d) * 60 - m) * 60 * 1000);
    return [[d, 1], [m, 1], [s, 1000]];
  };
  // Layout: header(8) IFD0@8 (2 entries) | ExifIFD@38 (1 entry) | GPS@56 (4 entries) | data@110
  tiff.push(0x4d, 0x4d);
  t16(42);
  t32(8);
  t16(2);
  entry(0x8769, 4, 1, 38);
  entry(0x8825, 4, 1, 56);
  t32(0);
  t16(1);
  entry(0x9003, 2, 20, 110);
  t32(0);
  t16(4);
  entry(1, 2, 2, lat < 0 ? 0x53000000 : 0x4e000000);
  entry(2, 5, 3, 130);
  entry(3, 2, 2, lng < 0 ? 0x57000000 : 0x45000000);
  entry(4, 5, 3, 154);
  t32(0);
  for (const c of `${date}\0`) tiff.push(c.charCodeAt(0));
  for (const [n, d] of [...dmsOf(lat), ...dmsOf(lng)]) {
    t32(n);
    t32(d);
  }
  u16(0xffd8);
  u16(0xffe1);
  u16(2 + 6 + tiff.length);
  u32(0x45786966);
  u16(0);
  bytes.push(...tiff);
  u16(0xffd9);
  return new Uint8Array(bytes).buffer;
}

describe('readExif', () => {
  it('reads the GPS and the time a photo was taken', () => {
    const out = readExif(jpegWithExif({ date: '2026:11:16 10:20:00', lat: 26.5398, lng: -76.9622 }));
    expect(out.lat).toBeCloseTo(26.5398, 4);
    expect(out.lng).toBeCloseTo(-76.9622, 4);
    expect(out.takenAt).toBe(new Date(2026, 10, 16, 10, 20, 0).getTime());
  });

  it('returns nothing for a file without EXIF', () => {
    expect(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toEqual({ lat: null, lng: null, takenAt: null });
  });

  it('reads an offset time as UTC', () => {
    expect(exifDateToMs('2026:11:16 10:20:00', '-05:00')).toBe(Date.UTC(2026, 10, 16, 15, 20, 0));
  });
});

// Reads the two things a mission photo is checked on (lib/missionPhoto.js)
// from a JPEG's EXIF block: where it was taken (GPS) and when
// (DateTimeOriginal, with OffsetTimeOriginal when the camera wrote one).
// Small on purpose: no other tag is read, and anything unexpected returns
// what was found so far instead of throwing. HEIC and PNG have no JPEG
// EXIF block, so they come back empty and the caller falls back to the
// device's own fix and clock.

const TAG = {
  EXIF_IFD: 0x8769,
  GPS_IFD: 0x8825,
  DATE_ORIGINAL: 0x9003,
  OFFSET_ORIGINAL: 0x9011,
  GPS_LAT_REF: 0x0001,
  GPS_LAT: 0x0002,
  GPS_LNG_REF: 0x0003,
  GPS_LNG: 0x0004,
};

// "2026:11:16 14:03:22" (+ "-05:00") -> ms. Without an offset the camera's
// clock is read as this device's local time (it took the photo just now).
export function exifDateToMs(text, offset) {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(String(text || ''));
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const o = /^([+-])(\d{2}):(\d{2})$/.exec(String(offset || '').trim());
  if (o) {
    const sign = o[1] === '-' ? -1 : 1;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - sign * (+o[2] * 60 + +o[3]) * 60000;
  }
  const t = new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
  return Number.isFinite(t) ? t : null;
}

const dms = (v) => (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v[0] + v[1] / 60 + v[2] / 3600 : null);

export function readExif(buffer) {
  const out = { lat: null, lng: null, takenAt: null };
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return out;
    let p = 2;
    while (p + 4 <= view.byteLength) {
      const marker = view.getUint16(p);
      const size = view.getUint16(p + 2);
      if (marker === 0xffe1 && view.getUint32(p + 4) === 0x45786966) return { ...out, ...readTiff(view, p + 10) };
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break; // start of image data: no EXIF
      p += 2 + size;
    }
  } catch {
    // A truncated or odd file: whatever was read stays.
  }
  return out;
}

function readTiff(view, start) {
  const little = view.getUint16(start) === 0x4949;
  const u16 = (o) => view.getUint16(start + o, little);
  const u32 = (o) => view.getUint32(start + o, little);
  const ascii = (o, n) => {
    let s = '';
    for (let i = 0; i < n; i++) {
      const c = view.getUint8(start + o + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const entries = (ifd) => {
    const map = new Map();
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      const type = u16(e + 2);
      const count = u32(e + 4);
      // ASCII (2), LONG (4), RATIONAL (5): the only types read here.
      if (type === 2) map.set(u16(e), ascii(count > 4 ? u32(e + 8) : e + 8, count));
      else if (type === 4) map.set(u16(e), u32(e + 8));
      else if (type === 5) {
        const at = u32(e + 8);
        map.set(u16(e), Array.from({ length: count }, (_, k) => {
          const den = u32(at + k * 8 + 4);
          return den ? u32(at + k * 8) / den : NaN;
        }));
      }
    }
    return map;
  };
  const ifd0 = entries(u32(4));
  const found = {};
  if (ifd0.has(TAG.EXIF_IFD)) {
    const exif = entries(ifd0.get(TAG.EXIF_IFD));
    found.takenAt = exifDateToMs(exif.get(TAG.DATE_ORIGINAL), exif.get(TAG.OFFSET_ORIGINAL));
  }
  if (ifd0.has(TAG.GPS_IFD)) {
    const gps = entries(ifd0.get(TAG.GPS_IFD));
    const lat = dms(gps.get(TAG.GPS_LAT));
    const lng = dms(gps.get(TAG.GPS_LNG));
    if (lat != null && lng != null) {
      found.lat = gps.get(TAG.GPS_LAT_REF) === 'S' ? -lat : lat;
      found.lng = gps.get(TAG.GPS_LNG_REF) === 'W' ? -lng : lng;
    }
  }
  return found;
}

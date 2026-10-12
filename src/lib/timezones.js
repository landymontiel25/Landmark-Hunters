import { canonicalRegionId } from '../data/regions';

// Lets Admin Mode's check-in date/time editor show and accept the
// landmark's OWN local time (EST, CET, etc.) instead of whichever timezone
// the admin's device happens to be in -- editing "when I checked in" in
// Miami shouldn't require doing the math from wherever the admin actually
// is.
const REGION_TIMEZONES = {
  miami: 'America/New_York',
  'san-francisco': 'America/Los_Angeles',
  'silicon-valley': 'America/Los_Angeles',
  nyc: 'America/New_York',
  'cape-town': 'Africa/Johannesburg',
  madrid: 'Europe/Madrid',
  'el-escorial': 'Europe/Madrid',
  aranjuez: 'Europe/Madrid',
  milan: 'Europe/Rome',
  'lake-como': 'Europe/Rome',
  philly: 'America/New_York',
  villanova: 'America/New_York',
  frankfurt: 'Europe/Berlin',
  paris: 'Europe/Paris',
  switzerland: 'Europe/Zurich',
};

// Every real, single-place region above has an exact IANA match. The one
// exception is the Formula 1 catalog ('f1-circuits'), which is worldwide by
// design -- no single zone covers it. For that (or any future region we
// haven't mapped yet), fall back to a rough fixed-offset zone from the
// landmark's own longitude (15deg per hour) rather than silently defaulting
// to the admin's own timezone. Etc/GMT's sign is inverted from normal
// convention (Etc/GMT-5 is UTC+5), which this accounts for.
export function regionTimezone(regionId, lng) {
  const known = REGION_TIMEZONES[canonicalRegionId(regionId)];
  if (known) return known;
  if (typeof lng === 'number' && Number.isFinite(lng)) {
    const offset = Math.max(-12, Math.min(14, Math.round(lng / 15)));
    return offset === 0 ? 'Etc/UTC' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Short zone label at a given instant -- "EST"/"EDT", "CET"/"CEST", etc.
// DST-aware since it's resolved for the actual instant, not the zone in
// general.
export function tzAbbrev(timeZone, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(date);
    return parts.find((p) => p.type === 'timeZoneName')?.value || timeZone;
  } catch {
    return timeZone;
  }
}

function offsetMinutesAt(instantMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return (asUTC - instantMs) / 60000;
}

// The "YYYY-MM-DDTHH:mm" wall-clock string that `<input type="datetime-local">`
// wants, as the given instant reads in `timeZone` (not the browser's own zone).
export function toZonedInputValue(seconds, timeZone) {
  if (!seconds) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(seconds * 1000));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

// Inverse of the above: a "YYYY-MM-DDTHH:mm" wall-clock string meant to be
// read in `timeZone` -> the real instant (a Date) it refers to. Resolves the
// zone's UTC offset for that instant (DST-aware) in two passes -- the
// second pass corrects the rare case where the first guess lands on the
// wrong side of a DST transition.
export function fromZonedInputValue(value, timeZone) {
  const naiveUTC = new Date(`${value}:00Z`).getTime();
  const offset1 = offsetMinutesAt(naiveUTC, timeZone);
  const guess = naiveUTC - offset1 * 60000;
  const offset2 = offsetMinutesAt(guess, timeZone);
  return new Date(naiveUTC - offset2 * 60000);
}

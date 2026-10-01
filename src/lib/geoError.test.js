import { describe, it, expect } from 'vitest';
import {
  friendlyGeoError,
  LOCATION_DENIED_MESSAGE,
  LOCATION_TIMEOUT_MESSAGE,
  LOCATION_UNAVAILABLE_MESSAGE,
} from './geoError';

describe('friendlyGeoError', () => {
  it('never leaks the raw browser or plugin text', () => {
    for (const err of [
      { code: 1, message: 'User denied Geolocation' },
      { code: 3, message: 'Timeout expired' },
      { code: 2, message: "Network location provider at 'https://www.googleapis.com/' : ERR_INTERNET_DISCONNECTED." },
      { message: 'Location services are not enabled' },
      null,
    ]) {
      const text = friendlyGeoError(err);
      expect(text).not.toMatch(/denied geolocation|timeout expired|ERR_|googleapis/i);
    }
  });
  it('maps each failure kind to its own message', () => {
    expect(friendlyGeoError({ code: 1, message: 'User denied Geolocation' })).toBe(LOCATION_DENIED_MESSAGE);
    expect(friendlyGeoError({ code: 3, message: 'Timeout expired' })).toBe(LOCATION_TIMEOUT_MESSAGE);
    expect(friendlyGeoError({ code: 2, message: 'x' })).toBe(LOCATION_UNAVAILABLE_MESSAGE);
    expect(friendlyGeoError({ code: 'OS-PLUG-GLOC-0003', message: 'User denied location permission' })).toBe(LOCATION_DENIED_MESSAGE);
  });
});

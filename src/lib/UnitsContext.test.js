import { describe, it, expect } from 'vitest';
import { formatDistance, unitsForCountry, countryFromLocale, resolveUnits } from './UnitsContext';

describe('formatDistance', () => {
  it('formats metric under 1km in meters', () => {
    expect(formatDistance(250, 'metric')).toBe('250 m');
  });

  it('formats metric at or above 1km in km', () => {
    expect(formatDistance(1500, 'metric')).toBe('1.5 km');
  });

  it('formats imperial under ~0.19mi in feet', () => {
    expect(formatDistance(100, 'imperial')).toBe('328 ft');
  });

  it('formats imperial at or above 1000ft in miles', () => {
    expect(formatDistance(1609.34, 'imperial')).toBe('1.0 mi');
  });
});

describe('unitsForCountry', () => {
  it('uses miles in the countries that measure distance in miles', () => {
    for (const c of ['US', 'GB', 'LR', 'MM']) expect(unitsForCountry(c), c).toBe('imperial');
  });

  it('uses km everywhere else', () => {
    for (const c of ['IT', 'ES', 'ZA', 'DE', 'FR', 'CA', 'AU']) expect(unitsForCountry(c), c).toBe('metric');
  });

  it('is case-insensitive and falls back to metric when unknown', () => {
    expect(unitsForCountry('us')).toBe('imperial');
    expect(unitsForCountry(null)).toBe('metric');
    expect(unitsForCountry(undefined)).toBe('metric');
    expect(unitsForCountry('')).toBe('metric');
  });
});

describe('countryFromLocale', () => {
  it('reads the region out of a full locale tag', () => {
    expect(countryFromLocale('en-US')).toBe('US');
    expect(countryFromLocale('pt-BR')).toBe('BR');
    expect(countryFromLocale('en-GB')).toBe('GB');
  });

  it('infers a likely region for a bare language, and null for garbage', () => {
    expect(countryFromLocale('it')).toBe('IT');
    expect(countryFromLocale('')).toBe(null);
    expect(countryFromLocale('not a locale!!')).toBe(null);
  });
});

describe('resolveUnits', () => {
  it('honors an explicit choice regardless of where you are', () => {
    expect(resolveUnits({ mode: 'imperial', country: 'IT', locale: 'it-IT' })).toBe('imperial');
    expect(resolveUnits({ mode: 'metric', country: 'US', locale: 'en-US' })).toBe('metric');
  });

  it('in auto, the country you are in beats the device locale', () => {
    expect(resolveUnits({ mode: 'auto', country: 'IT', locale: 'en-US' })).toBe('metric');
    expect(resolveUnits({ mode: 'auto', country: 'US', locale: 'it-IT' })).toBe('imperial');
  });

  it('in auto with no fix yet, falls back to the device locale', () => {
    expect(resolveUnits({ mode: 'auto', country: null, locale: 'en-US' })).toBe('imperial');
    expect(resolveUnits({ mode: 'auto', country: null, locale: 'es-ES' })).toBe('metric');
  });
});

describe('formatDistance rounding boundaries', () => {
  it('never shows "1000 m" or "1000 ft"', () => {
    expect(formatDistance(999.6, 'metric')).toBe('1.0 km');
    expect(formatDistance(304.7, 'imperial')).toBe('0.2 mi');
  });
});

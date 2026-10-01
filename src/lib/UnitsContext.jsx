import { createContext, useContext, useEffect, useState } from 'react';
import { useGeo } from './GeoContext';
import { reverseCountryCode } from './geocode';
import { formatDistance } from './formatDistance';

const MODE_KEY = 'lh-units-mode'; // 'auto' | 'imperial' | 'metric'
const LEGACY_KEY = 'lh-units'; // pre-"auto" value, 'imperial' | 'metric'

// Countries that measure road/walking distance in miles. Everyone else
// gets meters and kilometers.
const IMPERIAL_COUNTRIES = new Set(['US', 'LR', 'MM', 'GB']);

export function unitsForCountry(code) {
  return code && IMPERIAL_COUNTRIES.has(String(code).toUpperCase()) ? 'imperial' : 'metric';
}

// "en-US" -> "US", "pt-BR" -> "BR", "en" -> null. The device locale is a
// decent guess at home country when there's no GPS fix yet (or ever).
export function countryFromLocale(locale = typeof navigator !== 'undefined' ? navigator.language : '') {
  try {
    const region = new Intl.Locale(locale).maximize().region;
    return region && /^[A-Z]{2}$/.test(region) ? region : null;
  } catch {
    return null;
  }
}

// The effective units for a given mode. In auto, the country you're
// actually standing in wins over the device locale.
export function resolveUnits({ mode, country, locale }) {
  if (mode === 'imperial' || mode === 'metric') return mode;
  return unitsForCountry(country || countryFromLocale(locale));
}

export function countryName(code) {
  if (!code) return null;
  try {
    return new Intl.DisplayNames([navigator.language], { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
}

function getInitialMode() {
  // Blocked/unavailable storage (private mode, blocked site data) throws on
  // access -- that must not take the whole app down at startup.
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === 'auto' || saved === 'imperial' || saved === 'metric') return saved;
    // Someone who picked a unit before "Automatic" existed keeps their pick.
    const legacy = localStorage.getItem(LEGACY_KEY);
    return legacy === 'imperial' || legacy === 'metric' ? legacy : 'auto';
  } catch {
    return 'auto';
  }
}

// Every distance shown in the app (Nearby Now, itinerary stops, the
// distance tag on a landmark card) formats through this one function, so
// switching units on Settings updates all of them at once.
export { formatDistance };

const UnitsContext = createContext(null);

export function UnitsProvider({ children }) {
  const { coords } = useGeo();
  const [mode, setMode] = useState(getInitialMode);
  // Country from the GPS fix, once looked up. Null until then (locale is
  // the fallback), and stays null if the lookup fails.
  const [autoCountry, setAutoCountry] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* storage full or blocked: the choice still applies for this session */
    }
  }, [mode]);

  // One reverse lookup per session, and only once there's a fix. Not
  // re-run on every GPS tick -- you don't change countries mid-walk.
  useEffect(() => {
    if (!coords || autoCountry) return;
    let cancelled = false;
    reverseCountryCode(coords.lat, coords.lng).then((code) => {
      if (!cancelled && code) setAutoCountry(code);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!coords]);

  const units = resolveUnits({ mode, country: autoCountry });

  return (
    <UnitsContext.Provider value={{ units, mode, setMode, autoCountry }}>{children}</UnitsContext.Provider>
  );
}

export function useUnits() {
  const ctx = useContext(UnitsContext);
  if (!ctx) throw new Error('useUnits must be used inside UnitsProvider');
  return ctx;
}

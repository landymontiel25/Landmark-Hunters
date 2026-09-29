import { Capacitor } from '@capacitor/core';

// Where our own /api/* functions live. On the web the page and the API share
// an origin, so relative URLs work and this is ''. Inside the native app the
// page origin is capacitor://localhost, which serves no API, so calls go to
// the deployed site. Set VITE_API_BASE_URL (no trailing slash needed) in .env
// before `npm run ios:sync`.
const nativeBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
if (Capacitor.isNativePlatform() && !nativeBase) {
  console.error('VITE_API_BASE_URL is not set; API calls will fail in the native app.');
}
export const API_BASE = Capacitor.isNativePlatform() ? nativeBase : '';

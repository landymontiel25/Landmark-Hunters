// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const writes = [];
const deletes = [];
vi.mock('firebase/firestore', () => ({
  collection: (...p) => p.slice(1).join('/'),
  doc: (...p) => p.slice(1).join('/'),
  onSnapshot: () => () => {},
  serverTimestamp: () => 'TS',
  setDoc: async (ref, data) => writes.push({ ref, data }),
  deleteDoc: async (ref) => deletes.push(ref),
}));
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: { lat: 25.77, lng: -80.19, accuracy: 8 }, error: null }) }));
vi.mock('../lib/ToastContext', () => ({ useToast: () => ({ show: () => {} }) }));
vi.mock('react-leaflet', () => ({ MapContainer: () => null, TileLayer: () => null, Marker: () => null, Tooltip: () => null, useMap: () => ({}) }));

import LiveLocationCard from './LiveLocationCard';

let container;
let root;
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  localStorage.clear();
  writes.length = 0;
  deletes.length = 0;
});

const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(text));

describe('LiveLocationCard', () => {
  it('shares for the chosen time and stops on request', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<LiveLocationCard tripId="trip1" uid="me" myName="Landy" />));

    await act(async () => button('Share live location').click());
    expect(document.body.textContent).toContain('15 minutes');
    expect(document.body.textContent).toContain('8 hours');
    await act(async () => button('1 hour').click());

    expect(writes.at(-1).ref).toBe('group_trips/trip1/live_locations/me');
    expect(writes.at(-1).data).toMatchObject({ uid: 'me', name: 'Landy', lat: 25.77, lng: -80.19, mode: 'timed' });
    expect(writes.at(-1).data.expiresAt - Date.now()).toBeGreaterThan(59 * 60 * 1000);
    expect(container.textContent).toContain("You're sharing your live location until");

    await act(async () => button('Stop sharing').click());
    expect(deletes).toEqual(['group_trips/trip1/live_locations/me']);
    expect(container.textContent).toContain('Share live location');
  });
});

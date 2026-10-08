// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, memo } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const geo = { coords: null };
vi.mock('./GeoContext', () => ({ useGeo: () => geo }));
vi.mock('./geocode', () => ({ reverseCountryCode: async () => null }));

const { UnitsProvider, useUnits } = await import('./UnitsContext.jsx');

describe('UnitsProvider', () => {
  it('does not re-render units consumers on every GPS fix', async () => {
    let renders = 0;
    const Consumer = memo(function Consumer() {
      useUnits();
      renders += 1;
      return null;
    });
    const child = <Consumer />;
    const root = createRoot(document.createElement('div'));
    const render = () => act(async () => root.render(<UnitsProvider>{child}</UnitsProvider>));
    geo.coords = { lat: 1, lng: 1 };
    await render();
    const first = renders;
    for (let i = 2; i < 6; i++) {
      geo.coords = { lat: i, lng: i };
      await render();
    }
    expect(renders).toBe(first);
    root.unmount();
  });
});

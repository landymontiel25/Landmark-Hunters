// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import L from './leafletGuards';

// Regression for two uncaught TypeErrors the app simulation hit when a map
// screen unmounted mid-animation (docs/app-sim-results.md).

let container;
beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  vi.useRealTimers();
  container.remove();
});

describe('leafletGuards', () => {
  it('a zoom animation that ends after the map is removed does not throw', () => {
    const map = L.map(container, { zoomAnimation: true }).setView([25.77, -80.19], 12);
    // What a flyTo/setZoom with animation does: start the CSS zoom and end it
    // on a 250 ms timer.
    map._animateZoom(L.latLng(25.78, -80.18), 14, true);
    expect(map._animatingZoom).toBe(true);
    map.remove();
    expect(() => vi.advanceTimersByTime(300)).not.toThrow();
    expect(map._animatingZoom).toBe(false);
  });

  it('chunked marker loading stops when the cluster group leaves the map', () => {
    // A slow phone: every clock read is 5 ms later, so with a 7 ms budget
    // each chunk stops after 200 markers and the rest wait for a timer.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 0;
    vi.spyOn(Date.prototype, 'getTime').mockImplementation(() => (now += 5));
    const map = L.map(container, { maxZoom: 18 }).setView([25.77, -80.19], 12);
    const group = L.markerClusterGroup({ chunkedLoading: true, chunkInterval: 7, chunkDelay: 10 });
    map.addLayer(group);
    const markers = Array.from({ length: 600 }, (_, i) => L.marker([25.7 + i / 10000, -80.2 + i / 10000]));
    group.addLayers(markers);
    expect(group.getLayers().length).toBeLessThan(600);
    map.removeLayer(group);
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    vi.restoreAllMocks();
    map.remove();
  });

  it('patches only once', () => {
    expect(L.Map.prototype._onZoomTransitionEnd.lhGuarded).toBe(true);
    expect(L.MarkerClusterGroup.prototype._addLayer.lhGuarded).toBe(true);
  });
});

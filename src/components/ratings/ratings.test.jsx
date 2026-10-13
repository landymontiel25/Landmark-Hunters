// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// Drive the hook's states and the logo check directly.
let hookState;
let logo = 'ok';
vi.mock('../../lib/useLandmarkRatings', () => ({ useLandmarkRatings: () => hookState }));
vi.mock('./useImageAvailable', () => ({ useImageAvailable: () => logo }));

import RatingsSection from './RatingsSection';
import RatingsCardLine from './RatingsCardLine';

const landmark = { id: 'liberty-bell-center', regionId: 'philly', name: 'Liberty Bell Center' };
const GOOGLE = {
  rating: 4.7,
  count: 1234,
  url: 'https://maps.google.com/?cid=1',
  snippets: [{ text: 'Worth the line.', author: 'Ana', authorUrl: 'https://www.google.com/maps/contrib/1', url: 'https://www.google.com/maps/reviews/1', when: '2 weeks ago' }],
};
const TA = {
  rating: 4.5,
  count: 890,
  url: 'https://www.tripadvisor.com/Attraction_Review-60763',
  ratingImageUrl: 'https://static.tacdn.com/4.5.svg',
  snippets: [{ text: 'A must see.', date: '2026-09-01', author: 'traveler1', url: 'https://www.tripadvisor.com/r/1' }],
};
const done = (sources) => ({ ref: () => {}, status: 'done', sources });
const FLAGS_OFF = { cardLine: true, landmarkHunters: false };
const FLAGS_ON = { cardLine: true, landmarkHunters: true };

let container;
beforeEach(() => {
  logo = 'ok';
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => container.remove());
const render = async (el) => act(async () => createRoot(container).render(el));
const rows = () => [...container.querySelectorAll('.ratings-row')].map((r) => r.dataset.source);

describe('RatingsSection (detail screen)', () => {
  it('shows a loading state', async () => {
    hookState = { ref: () => {}, status: 'loading', sources: null };
    await render(<RatingsSection landmark={landmark} flags={FLAGS_OFF} />);
    expect(container.querySelector('.ratings-section[aria-busy="true"]')).toBeTruthy();
    expect(container.textContent).toContain('Loading ratings');
  });

  it('shows one row per source, with snippets, attribution and See reviews links', async () => {
    hookState = done({ google: GOOGLE, tripadvisor: TA });
    await render(<RatingsSection landmark={landmark} flags={FLAGS_OFF} />);
    expect(rows()).toEqual(['google', 'tripadvisor']);
    expect(container.textContent).toContain('Google Maps');
    expect(container.querySelector('.gmp-attribution').getAttribute('translate')).toBe('no');
    expect(container.textContent).toContain('1,234');
    expect(container.textContent).toContain('Worth the line.');
    expect(container.textContent).toContain('Tripadvisor traveler review by traveler1, 2026-09-01');
    expect(container.querySelector('img.ta-logo').getAttribute('alt')).toBe('Tripadvisor');
    const see = [...container.querySelectorAll('a.ratings-see-all')].map((a) => a.href);
    expect(see).toEqual([GOOGLE.url, TA.url]);
    expect(container.querySelector('a.ratings-author').href).toBe('https://www.google.com/maps/contrib/1');
  });

  it('hides a source with no data', async () => {
    hookState = done({ google: null, tripadvisor: TA });
    await render(<RatingsSection landmark={landmark} flags={FLAGS_OFF} />);
    expect(rows()).toEqual(['tripadvisor']);
  });

  it('hides the whole section when no source has data', async () => {
    hookState = done({ google: null, tripadvisor: null });
    await render(<RatingsSection landmark={landmark} flags={FLAGS_OFF} />);
    expect(container.innerHTML).toBe('');
  });

  it('hides Tripadvisor when its required logo file is missing', async () => {
    logo = 'missing';
    hookState = done({ google: null, tripadvisor: TA });
    await render(<RatingsSection landmark={landmark} flags={FLAGS_OFF} />);
    expect(container.innerHTML).toBe('');
  });

  it('keeps the Landmark Hunters row off until its flag is on', async () => {
    hookState = done({ google: GOOGLE, tripadvisor: null });
    await render(<RatingsSection landmark={landmark} lhAgg={{ avg: 4.2, count: 7 }} flags={FLAGS_OFF} />);
    expect(rows()).toEqual(['google']);
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    await render(<RatingsSection landmark={landmark} lhAgg={{ avg: 4.2, count: 7 }} flags={FLAGS_ON} />);
    expect(rows()).toEqual(['google', 'landmarkHunters']);
    expect(container.textContent).toContain('Landmark Hunters');
  });
});

describe('RatingsCardLine (Places tab row)', () => {
  const appTag = <span className="tag rating-tag app-own">⭐ 4.0 (3)</span>;

  it('shows the app\'s own rating while Google loads (no blank, no jump)', async () => {
    hookState = { ref: () => {}, status: 'loading', sources: null };
    await render(<RatingsCardLine landmark={landmark} fallback={appTag} flags={FLAGS_OFF} />);
    expect(container.querySelector('.app-own')).toBeTruthy();
    expect(container.querySelector('[data-source="google"]')).toBeNull();
  });

  it('shows the Google rating with a star, count and "Google Maps", in place of the app\'s own', async () => {
    hookState = done({ google: GOOGLE, tripadvisor: TA });
    await render(<RatingsCardLine landmark={landmark} fallback={appTag} flags={FLAGS_OFF} />);
    const g = container.querySelector('[data-source="google"]');
    expect(g.textContent).toContain('⭐ 4.7');
    expect(g.textContent).toContain('(1,234)');
    expect(g.textContent).toContain('Google Maps');
    expect(container.querySelector('.app-own')).toBeNull();
    expect(container.querySelector('[data-source="tripadvisor"] img.ta-logo')).toBeTruthy();
  });

  it('falls back to the app\'s own rating when Google has none, and when the switch is off', async () => {
    hookState = done({ google: null, tripadvisor: null });
    await render(<RatingsCardLine landmark={landmark} fallback={appTag} flags={FLAGS_OFF} />);
    expect(container.querySelector('.app-own')).toBeTruthy();
    expect(container.querySelector('[data-source]')).toBeNull();
    hookState = { ref: () => {}, status: 'off', sources: null };
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    await render(<RatingsCardLine landmark={landmark} fallback={appTag} flags={{ cardLine: false, landmarkHunters: false }} />);
    expect(container.querySelector('.app-own')).toBeTruthy();
    expect(container.querySelector('.ratings-inline')).toBeNull();
  });
});

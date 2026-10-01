// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { TEST_MOODS } from '../../lib/nearbyPicks';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../../lib/UnitsContext', () => ({
  useUnits: () => ({ units: 'imperial' }),
  formatDistance: (m) => `${(m / 1609.34).toFixed(1)} mi`,
}));

import MoodCarousel from './MoodCarousel';

let container;
afterEach(() => container?.remove());
const render = async (props) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(
      <MemoryRouter>
        <MoodCarousel pool={[]} ratings={{}} {...props} />
      </MemoryRouter>
    )
  );
  return container;
};

describe('MoodCarousel', () => {
  it('shows the real Map moods by default, tech spots included', async () => {
    const el = await render();
    const labels = [...el.querySelectorAll('.mpp-mood')].map((b) => b.textContent);
    expect(labels[0]).toContain('Something to eat');
    expect(labels.some((l) => l.includes('Tech spots'))).toBe(true);
  });

  it('shows the moods it is given: eating, entertainment, and no tech spots in the Test tab', async () => {
    const el = await render({ moods: TEST_MOODS });
    const labels = [...el.querySelectorAll('.mpp-mood')].map((b) => b.textContent);
    expect(labels[0]).toContain('Something to eat');
    expect(labels[1]).toContain('Entertainment');
    expect(labels.some((l) => l.includes('Tech spots'))).toBe(false);
    expect(el.querySelector('.mpp-section-title').textContent).toBe('What are you in the mood for?');
  });
});

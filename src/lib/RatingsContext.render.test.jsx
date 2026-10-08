// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, memo } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const user = { uid: 'A' };
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user }) }));
vi.mock('./firebase', () => ({ firebaseEnabled: true }));
vi.mock('./reviews', () => ({ getAllRatings: async () => ({}), getUserReviews: async () => [] }));

const { RatingsProvider, useRatings } = await import('./RatingsContext.jsx');
const { CheckInContext } = await import('./CheckInContext.jsx');

describe('RatingsProvider', () => {
  it('a CheckInContext change that leaves claimedMap alone does not re-render ratings consumers', async () => {
    let renders = 0;
    const Consumer = memo(function Consumer() {
      useRatings();
      renders += 1;
      return null;
    });
    const child = <Consumer />;
    const claimedMap = {};
    const root = createRoot(document.createElement('div'));
    const render = (checkingIn) =>
      act(async () =>
        root.render(
          <CheckInContext.Provider value={{ claimedMap, claimedLoaded: true, checkingIn }}>
            <RatingsProvider>{child}</RatingsProvider>
          </CheckInContext.Provider>
        )
      );
    await render(false);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const settled = renders;
    await render(true);
    await render(false);
    expect(renders).toBe(settled);
    root.unmount();
  });
});

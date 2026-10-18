// @vitest-environment jsdom
// Owner, 2026-10-18: the "minutes saved planning today" card is off for now.
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' }, firebaseEnabled: true }) }));
vi.mock('../lib/timeSaved', () => ({ getTodaysTimeSavedMinutes: async () => 12 }));

const { default: DiscoveryStatsCard, SHOW_TIME_SAVED_CARD } = await import('./DiscoveryStatsCard');

describe('minutes saved card', () => {
  it('is switched off', () => {
    expect(SHOW_TIME_SAVED_CARD).toBe(false);
    expect(renderToStaticMarkup(<DiscoveryStatsCard />)).toBe('');
  });
});

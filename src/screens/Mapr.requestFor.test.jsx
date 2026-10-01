// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ fetchJson: vi.fn(), logged: [], saveVote: vi.fn() }));

const stub = () => () => null;
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1', displayName: 'Ann' }, resendVerification: () => {} }) }));
vi.mock('../lib/UnitsContext', () => ({ useUnits: () => ({ units: 'mi' }), formatDistance: () => '' }));
vi.mock('../lib/FriendsContext', () => ({
  useFriends: () => ({
    profileFresh: true,
    myUsername: 'ann',
    myProfile: { tasteIntro: 'I love tacos', tasteBaseline: {}, tagScores: { villanova: { food: 60 } } },
  }),
}));
vi.mock('../lib/MyPhotosContext', () => ({ useMyPhotos: () => ({ myPhotos: [] }) }));
vi.mock('../lib/RatingsContext', () => ({
  useRatings: () => ({
    myReviews: { a: { landmarkId: 'a', landmarkName: 'Autana', ratingTier: 'highly-recommend', categories: ['food'], comment: 'great' } },
  }),
}));
vi.mock('../lib/TripContext', () => ({ useTrip: () => ({ trip: { savedInterests: ['food'], activeRegion: null }, updateTrip: () => {} }) }));
vi.mock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: null, error: null }) }));
vi.mock('../lib/ToastContext', () => ({ useToast: () => ({ show: () => {} }) }));
vi.mock('../lib/MaprChatContext', async () => {
  const React = await import('react');
  return {
    useMaprChat: () => {
      const [messages, setMessages] = React.useState([]);
      const [draft, setDraft] = React.useState('');
      const [regions, setRegions] = React.useState([]);
      const [busy, setBusyState] = React.useState(false);
      const [showPlanner, setShowPlanner] = React.useState(false);
      return {
        messages,
        setMessages,
        setMessagesFor: (_id, u) => setMessages(u),
        activeChat: { id: 'c1' },
        activeProject: null,
        draft,
        setDraft,
        regions,
        setRegions,
        showPlanner,
        setShowPlanner,
        totalCost: 0,
        setTotalCost: () => {},
        busy,
        setBusy: setBusyState,
        restored: false,
        dismissRestored: () => {},
        discardChat: () => {},
        newChat: () => {},
        renameChat: () => {},
      };
    },
  };
});
vi.mock('../lib/friendlyError', async (orig) => ({ ...(await orig()), fetchJson: (...a) => h.fetchJson(...a) }));
vi.mock('../lib/apiAuth', () => ({ authHeaders: async () => ({}) }));
vi.mock('../lib/geocode', () => ({ reverseLocality: async () => null }));
vi.mock('../lib/timeSaved', () => ({ logPlanningEvent: async () => {} }));
vi.mock('../lib/groupTrips', () => ({ listMyGroupTrips: async () => [] }));
vi.mock('../lib/pickFeedback', () => ({
  readLocalFeedback: () => ({}),
  getPickFeedback: async () => ({}),
  readPendingPickVotes: () => ({}),
  flushPendingPickVotes: async () => [],
  setPickFeedback: (...a) => h.saveVote(...a),
}));
vi.mock('../lib/useShownLogger', () => ({
  useShownLogger: () => (setId, stops, overrides) => h.logged.push({ setId, stops, ...overrides }),
}));
vi.mock('../lib/maprActions', () => ({
  runMaprActions: async () => [],
  retryMaprAction: async () => ({}),
  itinerarySummary: () => [],
  registerUndo: () => {},
  getUndo: () => null,
  forgetUndo: () => {},
  registerConversationStops: () => {},
  getConversationStops: () => [],
}));
vi.mock('../lib/placeLandmarks', () => ({ landmarkForRating: async () => ({}) }));
for (const f of [
  'LandmarkThumb',
  'MaprChatsPanel',
  'MultiRegionSearch',
  'DirectionsButton',
  'DiscoveryStatsCard',
  'TasteProfileCard',
  'TasteNudgeCard',
  'OnboardingBanner',
  'TripPlannerCard',
  'MaprRateCard',
]) {
  vi.doMock(`../components/${f}`, () => ({ default: stub() }));
}
vi.mock('../components/OnScreen', () => ({ default: ({ children }) => children }));

let Mapr;
let container;
let root;

beforeEach(async () => {
  window.HTMLElement.prototype.scrollIntoView = () => {};
  h.fetchJson.mockReset();
  h.saveVote.mockReset();
  h.saveVote.mockResolvedValue({ status: 'saved', entry: { landmarkId: 'a', verdict: 'yes' } });
  h.logged.length = 0;
  localStorage.clear();
  h.fetchJson.mockResolvedValue({ reply: 'Try Autana.', stops: [], quickReplies: [] });
  ({ default: Mapr } = await import('./Mapr.jsx'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MemoryRouter>
        <Mapr />
      </MemoryRouter>
    )
  );
});
afterEach(() => {
  act(() => root.unmount());
  document.body.removeChild(container);
});

const setValue = async (value) => {
  const input = container.querySelector('input[name="mapr-message"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const submit = async () => act(async () => container.querySelector('form.chatlab-composer').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
const button = (text) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const click = async (text) => {
  const b = button(text);
  if (!b) throw new Error(`No button ${text}`);
  await act(async () => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};
const lastBody = () => JSON.parse(h.fetchJson.mock.calls.at(-1)[1].body);

describe('Mapr asks who each request is for', () => {
  it('asks first with two buttons, and sends nothing until one is chosen', async () => {
    await setValue('somewhere fun');
    await submit();
    expect(container.querySelector('#request-for-label').textContent).toBe('Who is this for?');
    expect(button('Just me')).toBeTruthy();
    expect(button('A group')).toBeTruthy();
    expect(h.fetchJson).not.toHaveBeenCalled();
  });

  it('Just me keeps the current behaviour: the whole taste context is sent', async () => {
    await setValue('somewhere fun');
    await submit();
    await click('Just me');
    expect(h.fetchJson).toHaveBeenCalledTimes(1);
    const body = lastBody();
    expect(body.requestFor).toBe('solo');
    expect(body.reviews).toHaveLength(1);
    expect(body.interests).toEqual(['food']);
    expect(body.tasteIntro).toContain('I love tacos');
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'somewhere fun' });
  });

  it('A group sends no taste context at all', async () => {
    await setValue('family bowling');
    await submit();
    await click('A group');
    const body = lastBody();
    expect(body.requestFor).toBe('group');
    expect(body.reviews).toEqual([]);
    expect(body.interests).toEqual([]);
    expect(body.tasteIntro).toBe('');
    expect(body.insiderMode).toBe(false);
    expect(body.tagScoreSummary).toEqual({});
    expect(body.messages.at(-1).content).toBe('family bowling');
  });

  it('asks again on the next request (the choice is not remembered)', async () => {
    await setValue('family bowling');
    await submit();
    await click('A group');
    await setValue('and dinner after');
    await submit();
    expect(container.querySelector('#request-for-label')).toBeTruthy();
    expect(h.fetchJson).toHaveBeenCalledTimes(1);
    await click('Just me');
    expect(h.fetchJson).toHaveBeenCalledTimes(2);
    expect(lastBody().requestFor).toBe('solo');
    expect(lastBody().reviews).toHaveLength(1);
  });

  it('Cancel sends nothing and keeps what was typed', async () => {
    await setValue('family bowling');
    await submit();
    await click('Cancel');
    expect(h.fetchJson).not.toHaveBeenCalled();
    expect(container.querySelector('input[name="mapr-message"]').value).toBe('family bowling');
  });

  it('still shows the exchange after a group request', async () => {
    h.fetchJson.mockResolvedValue({
      reply: 'Here you go.',
      stops: [{ name: 'Lucky Strike', id: 'x1', region: 'villanova', external: false }],
      quickReplies: [],
    });
    await setValue('family bowling');
    await submit();
    await click('A group');
    // Chat messages are shown in the thread; the stop card reports itself shown via the logger mock.
    const bubbles = container.textContent;
    expect(bubbles).toContain('family bowling');
    expect(bubbles).toContain('Here you go.');
  });
});

describe('the three pick buttons on Mapr chat suggestion cards', () => {
  const stops = [
    { id: 'a', region: 'villanova', name: 'Autana', reason: 'Great food', categories: ['food'] },
    { id: 'b', region: 'villanova', name: 'Bistro', reason: 'Nice', categories: ['food'] },
  ];
  const ask = async () => {
    h.fetchJson.mockResolvedValue({ reply: 'Try these.', stops, quickReplies: [] });
    await setValue('somewhere fun');
    await submit();
    await click('A group');
  };
  // OnScreen is stubbed away here, so a card is found through its button group.
  const card = (name) => container.querySelector(`[aria-label="Would you go to ${name}?"]`)?.closest('[data-pick-vote]') || undefined;
  const vbtn = (name, label) => [...card(name).querySelectorAll('.pick-vote-btn')].find((b) => b.textContent.includes(label));
  const tap = async (b) => act(async () => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));

  it("shows Not for me, Not sure and I'd go on each card, and no 'ask me again' text", async () => {
    await ask();
    for (const n of ['Autana', 'Bistro']) {
      const labels = [...card(n).querySelectorAll('.pick-vote-btn')].map((b) => b.textContent.trim());
      expect(labels).toEqual(['✕ Not for me', '\u{1F937} Not sure', "✓ I'd go"]);
    }
    expect(container.textContent.toLowerCase()).not.toContain('ask me again');
  });

  it('saves first (the answer is selected only after the save lands) and sends requestFor', async () => {
    let done;
    h.saveVote.mockImplementation(() => new Promise((r) => (done = r)));
    await ask();
    await tap(vbtn('Autana', "I'd go"));
    expect(h.saveVote).toHaveBeenCalledWith(expect.objectContaining({ landmark: expect.objectContaining({ id: 'a' }), verdict: 'yes', requestFor: 'group' }));
    expect(vbtn('Autana', "I'd go").getAttribute('aria-pressed')).toBe('false');
    await act(async () => done({ status: 'saved', entry: { landmarkId: 'a', verdict: 'yes' } }));
    expect(vbtn('Autana', "I'd go").getAttribute('aria-pressed')).toBe('true');
    expect(card('Autana')).toBeTruthy();
  });

  it('Not sure keeps the card; Not for me removes it', async () => {
    await ask();
    h.saveVote.mockResolvedValueOnce({ status: 'saved', entry: { landmarkId: 'a', verdict: 'unsure' } });
    await tap(vbtn('Autana', 'Not sure'));
    expect(vbtn('Autana', 'Not sure').getAttribute('aria-pressed')).toBe('true');
    h.saveVote.mockResolvedValueOnce({ status: 'saved', entry: { landmarkId: 'b', verdict: 'no' } });
    await tap(vbtn('Bistro', 'Not for me'));
    expect(card('Bistro')).toBeUndefined();
    expect(card('Autana')).toBeTruthy();
  });

  it('a failed save shows an error with Try again, and the card does not change', async () => {
    await ask();
    h.saveVote.mockRejectedValueOnce(new Error('down'));
    await tap(vbtn('Autana', 'Not for me'));
    expect(card('Autana')).toBeTruthy();
    expect(card('Autana').querySelector('[role="alert"]').textContent).toContain("Couldn't save");
    h.saveVote.mockResolvedValueOnce({ status: 'saved', entry: { landmarkId: 'a', verdict: 'no' } });
    await tap([...card('Autana').querySelectorAll('button')].find((b) => b.textContent === 'Try again'));
    expect(h.saveVote).toHaveBeenCalledTimes(2);
    expect(card('Autana')).toBeUndefined();
  });

  it("an offline tap shows 'Not saved yet' and is not selected", async () => {
    await ask();
    h.saveVote.mockResolvedValueOnce({ status: 'pending', entry: { landmarkId: 'a', verdict: 'yes' } });
    await tap(vbtn('Autana', "I'd go"));
    expect(card('Autana').textContent).toContain('Not saved yet');
    expect(vbtn('Autana', "I'd go").getAttribute('aria-pressed')).toBe('false');
  });
});

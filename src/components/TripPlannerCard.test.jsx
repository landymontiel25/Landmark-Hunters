// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ALL_LANDMARKS, getRegion } from '../data/regions';

const state = vi.hoisted(() => ({ trip: null, myReviews: {}, profile: null }));
const classifyInterest = vi.hoisted(() => vi.fn());
const logRecommendations = vi.hoisted(() => vi.fn(async () => []));

vi.mock('../lib/TripContext', () => ({
  useTrip: () => ({ trip: state.trip, updateTrip: (patch) => Object.assign(state.trip, patch) }),
}));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' } }) }));
vi.mock('../lib/RatingsContext', () => ({ useRatings: () => ({ myReviews: state.myReviews }) }));
vi.mock('../lib/FriendsContext', () => ({ useFriends: () => ({ myProfile: state.profile }) }));
vi.mock('../lib/GeoContext', () => ({ useGeo: () => ({ coords: null }) }));
vi.mock('../lib/useGpsStartLocation', () => ({
  useGpsStartLocation: () => ({ useCurrentLocation: () => {}, locating: false, locateError: null, usingGps: false }),
}));
vi.mock('../lib/geocode', () => ({ geocodeLocation: async () => null }));
vi.mock('../lib/interestClassifier', () => ({ classifyInterest }));
vi.mock('../lib/recommendationLog', () => ({ logRecommendations }));
vi.mock('./LocationAutocomplete', () => ({ default: () => null, HomeStartPrefill: () => null }));
vi.mock('./MultiRegionSearch', () => ({ default: () => null }));

import TripPlannerCard from './TripPlannerCard';

const villanova = ALL_LANDMARKS.filter((l) => l.regionId === 'villanova');
const reviews = (n) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`r${i}`, { landmarkId: `rated-${i}`, ratingTier: 'highly-recommend' }])
  );

let container;
let root;
let onPlan;

beforeEach(() => {
  localStorage.clear();
  classifyInterest.mockReset();
  classifyInterest.mockResolvedValue({ matches: [`villanova/${villanova[0].id}`], emoji: 'x' });
  logRecommendations.mockClear();
  state.trip = {
    startingLocation: 'Home',
    startingCoords: { lat: 40.0356, lng: -75.3437 },
    activeRegion: 'villanova',
  };
  state.myReviews = reviews(12);
  state.profile = {
    tagScores: { villanova: { food: 60, 'parks-nature': 10 } },
    tagScoresAt: { villanova: {} },
    tagCounts: { villanova: { food: 12, 'parks-nature': 1 } },
  };
  onPlan = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  document.body.removeChild(container);
});

const render = async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MemoryRouter>
        <TripPlannerCard
          regions={[getRegion('villanova')]}
          onSetRegions={() => {}}
          onToggleRegion={() => {}}
          onClearRegions={() => {}}
          onClose={() => {}}
          onPlan={onPlan}
        />
      </MemoryRouter>
    )
  );
};

const question = () => container.querySelector('.chat-wizard-question p').textContent;
const buttons = () => [...container.querySelectorAll('button')];
const button = (text) => buttons().find((b) => b.textContent.includes(text));
const click = async (text) => {
  const b = button(text);
  if (!b) throw new Error(`No button "${text}" on "${question()}"`);
  await act(async () => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};
const type = async (value) => {
  const input = container.querySelector('#planner-specific');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const activeDot = () => [...container.querySelectorAll('.chat-wizard-dot')].findIndex((d) => d.classList.contains('active'));

describe('Plan Your Trip wizard', () => {
  it('walks the steps in order: location, mood, what sounds good, trip type, plan', async () => {
    await render();
    expect(container.querySelectorAll('.chat-wizard-dot')).toHaveLength(5);
    expect(question()).toBe('Where are you starting from?');
    expect(button('Use my current location')).toBeTruthy();
    expect(button('Type an address')).toBeTruthy();
    expect(button('Skip')).toBeFalsy(); // no Skip on the starting location
    expect(button('Just browse the map')).toBeTruthy();
    expect(container.querySelector('[aria-label="Close"]')).toBeTruthy();

    await click('Next');
    expect(question()).toBe('What are you in the mood for?');
    expect(activeDot()).toBe(1);
    expect(button('Skip')).toBeTruthy();
    expect(button('Just browse the map')).toBeTruthy();

    await click('Energized & Active'); // single choice: advances on tap
    expect(question()).toBe('What sounds good?');
    await click('The usual'); // a step with a text box: waits for Next
    expect(question()).toBe('What sounds good?');
    await click('Next');

    expect(question()).toBe('Is this trip just you, or a group?');
    await click('Group');
    expect(question()).toBe("All set. Here's what I've got:");
    expect(activeDot()).toBe(4);

    await click('Plan my trip');
    expect(onPlan).toHaveBeenCalledTimes(1);
    const [message, opts] = onPlan.mock.calls[0];
    expect(message).toContain('energized and active');
    expect(message).toContain("It's for a group.");
    expect(message).toContain('my usual kind of places, like:');
    expect(typeof opts.onReply).toBe('function');
  });

  it('Back returns to the previous step and Skip moves on without an answer', async () => {
    await render();
    await click('Next');
    await click('Skip');
    expect(question()).toBe('What sounds good?');
    await act(async () => container.querySelector('[aria-label="Back"]').click());
    expect(question()).toBe('What are you in the mood for?');
  });

  it('under 10 ratings: hides The usual / Something new and shows only the text box', async () => {
    state.myReviews = reviews(9);
    await render();
    await click('Next');
    await click('Easygoing & Chill');
    expect(question()).toBe('What sounds good?');
    expect(button('The usual')).toBeFalsy();
    expect(button('Something new')).toBeFalsy();
    expect(container.querySelector('#planner-specific')).toBeTruthy();
    expect(button('Next')).toBeTruthy();
  });

  it('with 10 or more ratings both buttons show', async () => {
    state.myReviews = reviews(10);
    await render();
    await click('Next');
    await click('Easygoing & Chill');
    expect(button('The usual')).toBeTruthy();
    expect(button('Something new')).toBeTruthy();
  });

  it('makes no AI call while tapping through, and skips the classifier when "Anything specific?" is blank', async () => {
    await render();
    await click('Next');
    await click('Energized & Active');
    await click('Something new');
    await click('Next');
    await click('Solo');
    expect(classifyInterest).not.toHaveBeenCalled();
    await click('Plan my trip');
    expect(classifyInterest).not.toHaveBeenCalled();
    expect(onPlan).toHaveBeenCalledTimes(1); // the one plan call
    expect(onPlan.mock.calls[0][0]).toContain('something new that still fits my taste');
  });

  it('runs the classifier once, only at Plan my trip, when something specific was typed', async () => {
    await render();
    await click('Next');
    await click('Energized & Active');
    await type('tacos');
    await click('Next');
    await click('Solo');
    expect(classifyInterest).not.toHaveBeenCalled();
    await click('Plan my trip');
    expect(classifyInterest).toHaveBeenCalledTimes(1);
    expect(classifyInterest).toHaveBeenCalledWith('tacos');
    const [message] = onPlan.mock.calls[0];
    expect(message).toContain('Specifically: tacos.');
    expect(message).toContain(`Places that fit that: ${villanova[0].name}.`);
  });

  it('hands back its log meta (usual/new type) instead of logging at reply time', async () => {
    await render();
    await click('Next');
    await click('Energized & Active');
    await click('The usual');
    await click('Next');
    await click('Solo');
    await click('Plan my trip');
    const { onReply } = onPlan.mock.calls[0][1];
    const stop = { id: villanova[1].id, region: 'villanova', name: villanova[1].name, categories: villanova[1].categories };
    const meta = onReply({ text: 'Here you go', stops: [stop], raw: 'Here you go', quickReplies: [], rate: null });
    // Nothing is logged when the reply arrives; Mapr.jsx logs each card once
    // it is on screen, using this meta.
    expect(logRecommendations).not.toHaveBeenCalled();
    expect(meta).toMatchObject({ source: 'trip-planner', pickType: 'usual' });
  });

  it('reuses the last plan (no AI calls at all) when nothing has changed', async () => {
    const walk = async () => {
      await click('Next');
      await click('Energized & Active');
      await type('tacos');
      await click('Next');
      await click('Solo');
      await click('Plan my trip');
    };
    await render();
    await walk();
    onPlan.mock.calls[0][1].onReply({ text: 'Plan A', stops: [], raw: 'Plan A', quickReplies: [], rate: null });
    expect(classifyInterest).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    document.body.removeChild(container);

    await render();
    await walk();
    expect(classifyInterest).toHaveBeenCalledTimes(1); // not called again
    expect(onPlan).toHaveBeenCalledTimes(2);
    expect(onPlan.mock.calls[1][1].cachedReply).toMatchObject({ text: 'Plan A' });
  });

  it('saves answers as you go, so reopening resumes on the same step', async () => {
    await render();
    await click('Next');
    await click('Energized & Active');
    expect(question()).toBe('What sounds good?');
    await act(async () => new Promise((r) => setTimeout(r, 300)));
    act(() => root.unmount());
    document.body.removeChild(container);

    await render();
    expect(question()).toBe('What sounds good?');
    await act(async () => container.querySelector('[aria-label="Back"]').click());
    expect(container.querySelector('.chat-wizard-choice.selected').textContent).toContain('Energized & Active');
  });
});

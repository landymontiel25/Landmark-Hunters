// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../lib/firebase', () => ({ db: null }));

import OnScreen from './OnScreen';
import { logShownPicks, resetShownMemory } from '../lib/recommendationLog';
import { useShownLogger } from '../lib/useShownLogger';

let container;
let observers;
afterEach(() => {
  container?.remove();
  vi.unstubAllGlobals();
  resetShownMemory();
  localStorage.clear();
});
function stubObserver() {
  observers = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb) {
        this.cb = cb;
        observers.push(this);
      }
      observe() {}
      disconnect() {}
      fire(ratio) {
        this.cb([{ isIntersecting: ratio > 0, intersectionRatio: ratio }]);
      }
    }
  );
}

const STOPS = [
  { id: 'a', region: 'villanova', name: 'A', categories: ['food'] },
  { id: 'b', region: 'villanova', name: 'B', categories: ['food'] },
];

// Same wiring as the chat cards in Mapr.jsx.
function Chat({ log, setId = 'S1' }) {
  const logChat = useShownLogger({ uid: 'u', profile: null, surface: 'chat', source: 'chat', log });
  return (
    <div>
      {STOPS.map((s, i) => (
        <OnScreen key={s.id} onSeen={() => logChat(setId, [{ ...s, rank: i + 1 }])}>
          {s.name}
        </OnScreen>
      ))}
    </div>
  );
}
const mount = async (el) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(el));
  return root;
};

describe('chat / Mapr tab cards log when they scroll into view', () => {
  it('logs nothing until a card is seen, then once per card with its rank and surface', async () => {
    stubObserver();
    const log = vi.fn(async () => 1);
    await mount(<Chat log={(a) => logShownPicks({ ...a, log })} />);
    expect(log).not.toHaveBeenCalled();
    await act(async () => observers[1].fire(1));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatchObject({ uid: 'u', setId: 'S1', surface: 'chat', source: 'chat' });
    expect(log.mock.calls[0][0].stops[0]).toMatchObject({ id: 'b', rank: 2 });
    await act(async () => observers[1].fire(1)); // seen again: no duplicate
    await act(async () => observers[0].fire(0.2)); // barely visible: not seen
    expect(log).toHaveBeenCalledTimes(1);
    await act(async () => observers[0].fire(0.8));
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1][0].stops[0]).toMatchObject({ id: 'a', rank: 1 });
  });

  it('a re-render or remount of the same set does not log a seen card again', async () => {
    stubObserver();
    const log = vi.fn(async () => 1);
    const el = <Chat log={(a) => logShownPicks({ ...a, log })} setId="S9" />;
    const root = await mount(el);
    await act(async () => observers[0].fire(1));
    await act(async () => root.unmount());
    await mount(el);
    await act(async () => observers.at(-2).fire(1));
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('without IntersectionObserver a rendered card counts as seen', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const log = vi.fn(async () => 1);
    await mount(<Chat log={(a) => logShownPicks({ ...a, log })} />);
    expect(log).toHaveBeenCalledTimes(2);
  });
});

// The chat simulation's boat branch, covered on purpose (owner,
// 2026-11-23): one traveler, always in the same spot out in Biscayne Bay,
// asks how far Crandon Park is. Mapr (through the real api/plan-ai.js handler,
// with the same stand-in AI and fake Google as chat-sim) answers with the
// app's boat route, and the simulation's truth (truth.js) has to accept
// it. Take the boat branch out of truth.js and this fails.
import { describe, it, expect, vi } from 'vitest';

const SIM = { create: null };
vi.mock('../../api/_lib/aiGuard.js', () => ({ guardAiRequest: async () => ({ uid: 'sim' }) }));
vi.mock('../../api/_lib/aiCallLog.js', () => ({ logAiCall: async () => {} }));
vi.mock('../../api/_lib/cors.js', () => ({ withCors: (h) => h }));
vi.mock('../../api/_lib/maprServerModels.js', () => ({ loadServerModels: async () => null }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: (req) => SIM.create(req) };
  },
}));

const { default: handler } = await import('../../api/plan-ai.js');
const { ALL_LANDMARKS } = await import('../../src/data/regions.js');
const { routesFrom } = await import('../../api/_lib/routeLookup.js');
const { onWater } = await import('../../api/_lib/waterGrids.js');
const { makeWorld, rng } = await import('./world.js');
const { fakeCreate } = await import('./fake-model.js');
const { gradeReply } = await import('./grade.js');
const { truthRoutes } = await import('./truth.js');

// Out on Biscayne Bay, west of Key Biscayne. Fixed, so the test is the
// same every run. Crandon Park is on the island's ocean side, so the boat
// has to go around it: 5.3 mi and 21 min by boat, against 2.2 mi in a
// straight line and 3.0 mi / 11 min by road in the fake world, so no road
// or straight-line number can pass for the boat answer.
const BAY = { lat: 25.7, lng: -80.19 };
const NOW = Date.UTC(2026, 9, 14, 15, 0);

async function ask(question, place) {
  const world = makeWorld({ catalog: ALL_LANDMARKS, center: BAY, serverNear: BAY, nowMs: NOW });
  const realFetch = globalThis.fetch;
  globalThis.fetch = world.fakeFetch;
  vi.setSystemTime(NOW);
  try {
    const q = { intent: 'dist_me', text: question, places: [place] };
    // "careful": the stand-in AI repeats the lookup's numbers as given.
    const ctx = { q, r: rng(1), style: 'careful', world, recPlaces: [], requests: [], modelReply: '', toolOuts: [] };
    SIM.create = fakeCreate(ctx);
    let out;
    const res = { status() { return this; }, json(j) { out = j; } };
    await handler({ method: 'POST', body: { messages: [{ role: 'user', content: question }], regionIds: ['miami'], location: { lat: BAY.lat, lng: BAY.lng, label: 'Biscayne Bay' }, localNow: { day: 3, hour: 15, label: 'Wednesday 3:00 PM' } } }, res);
    const pts = [world.where(place), { name: 'your location', lat: BAY.lat, lng: BAY.lng }];
    return { ctx, out, world, q, pts };
  } finally {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  }
}

describe('chat simulation: a traveler out on the water (boat branch)', () => {
  it('Mapr answers by boat, and the truth accepts the boat route as correct', async () => {
    // Same stand-ins as chat-sim: the handler only needs the keys to exist.
    process.env.ANTHROPIC_API_KEY = 'sim';
    process.env.GOOGLE_ROUTES_API_KEY = 'sim';
    process.env.GOOGLE_PLACES_API_KEY = 'sim';
    expect(await onWater(BAY)).toBe(true); // the spot really is on the water
    const { ctx, out, world, q, pts } = await ask('how far is Crandon Park and Beach from me', 'Crandon Park and Beach');
    // Mapr went by boat: the app's own boat route, not a road.
    const looked = ctx.toolOuts.find((t) => t && !t.error);
    expect(looked).toMatchObject({ mode: 'by boat', source: "the app's boat route around the islands" });
    expect(out.reply).toContain(`${looked.miles} miles`);
    expect(out.reply).toContain(`${looked.minutes} minutes`);

    const grade = async (onWaterTruth) => {
      const { routes, onBoat } = await truthRoutes({ q, pts, here: BAY, locOn: onWaterTruth, world, catalog: ALL_LANDMARKS });
      const g = gradeReply({ raw: ctx.modelReply, shown: out.reply, truth: { routes, places: [] }, askedTravel: true, canAnswer: true, toolRoutes: routesFrom(ctx.toolOuts) });
      return { g, onBoat };
    };
    // With the boat branch, the boat answer is right.
    const withBoat = await grade(true);
    expect(withBoat.onBoat).toBe(true);
    expect(withBoat.g.wrongAfter).toEqual([]);
    // Road, foot and the straight line alone would call it wrong: so this
    // passes only because of the boat branch.
    const roadOnly = await grade(false);
    expect(roadOnly.onBoat).toBe(false);
    expect(roadOnly.g.wrongAfter.length).toBeGreaterThan(0);
  });
});

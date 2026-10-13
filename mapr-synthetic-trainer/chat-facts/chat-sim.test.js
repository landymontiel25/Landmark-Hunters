// Mapr chat fact simulation: thousands of synthetic travelers ask Mapr chat
// everything a real one might (distances, travel times, walking, hours,
// prices, ratings, planning a day, "near me", directions, the app itself),
// through the real api/plan-ai.js handler. A stand-in AI (fake-model.js)
// misbehaves on purpose; a fake Google (world.js) knows the true answers.
// It measures how many wrong facts the AI wrote and how many reached the
// traveler after the fact guard (api/_lib/factGuard.js).
//
// The default run (300 travelers) is part of the normal test suite and must
// let no wrong fact through. The full run:
//   MAPR_CHAT_SIM_USERS=30000 MAPR_CHAT_SIM_OUT=mapr-synthetic-trainer/output-chat npx vitest run mapr-synthetic-trainer/chat-facts
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SIM = { ctx: null };
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
const { ensureServerPlacePacks } = await import('../../api/_lib/placePacks.js');
const { bestOrder, routesFrom } = await import('../../api/_lib/routeLookup.js');
const { makeWorld, rng } = await import('./world.js');
const { makeQuestion, TRAVEL_INTENTS } = await import('./questions.js');
const { fakeCreate, styleFor } = await import('./fake-model.js');
const { gradeReply } = await import('./grade.js');

const USERS = Number(process.env.MAPR_CHAT_SIM_USERS || 300);
const PER_USER = Number(process.env.MAPR_CHAT_SIM_QUESTIONS || 3);
const SEED = Number(process.env.MAPR_CHAT_SIM_SEED || 7);
const REGIONS = ['miami', 'philly', 'villanova', 'san-francisco', 'silicon-valley', 'nyc', 'paris', 'madrid', 'milan'];

async function call(body) {
  let out;
  let code = 200;
  const res = {
    status(c) {
      code = c;
      return this;
    },
    json(j) {
      out = j;
    },
  };
  await handler({ method: 'POST', body }, res);
  return { code, out };
}

function blank() {
  return { asked: 0, wrongBefore: 0, wrongAfter: 0, repliesWrongBefore: 0, repliesWrongAfter: 0, overCut: 0, unanswered: 0, forced: 0, errors: 0 };
}

describe('Mapr chat fact simulation', () => {
  it(`${USERS} travelers x ${PER_USER} questions: no wrong fact reaches a traveler`, async () => {
    process.env.ANTHROPIC_API_KEY = 'sim';
    process.env.GOOGLE_ROUTES_API_KEY = 'sim';
    process.env.GOOGLE_PLACES_API_KEY = 'sim';
    await ensureServerPlacePacks();
    const byRegion = Object.fromEntries(
      REGIONS.map((id) => [id, ALL_LANDMARKS.filter((l) => l.regionId === id && Number.isFinite(l.lat) && l.name && l.name.length < 40)])
    );
    const totals = blank();
    const byIntent = {};
    const byStyle = {};
    const examples = [];
    const realFetch = globalThis.fetch;
    const started = Date.now();
    try {
      for (let u = 0; u < USERS; u++) {
        const r = rng(SEED * 1000003 + u);
        const region = REGIONS[Math.floor(r() * REGIONS.length)];
        const pool = byRegion[region];
        const anchor = pool[Math.floor(r() * pool.length)];
        const locOn = r() < 0.8;
        const here = { lat: anchor.lat + (r() - 0.5) * 0.04, lng: anchor.lng + (r() - 0.5) * 0.04 };
        const hour = 7 + Math.floor(r() * 16);
        const nowMs = Date.UTC(2026, 9, 14, hour, Math.floor(r() * 60));
        const world = makeWorld({ catalog: ALL_LANDMARKS, center: here, serverNear: locOn ? here : null, nowMs });
        globalThis.fetch = world.fakeFetch;
        vi.setSystemTime(nowMs);
        const names = pool.map((l) => l.name);
        const history = [];
        for (let k = 0; k < PER_USER; k++) {
          const q = makeQuestion(r, names);
          const style = styleFor(r);
          const recPlaces = [names[Math.floor(r() * names.length)], names[Math.floor(r() * names.length)]];
          const ctx = { q, r, style, world, recPlaces, requests: [], modelReply: '', toolOuts: [] };
          SIM.create = fakeCreate(ctx);
          const messages = [...history, { role: 'user', content: q.text }];
          const { code, out } = await call({
            messages,
            regionIds: [region],
            ...(locOn ? { location: { lat: here.lat, lng: here.lng, label: region } } : { locationStatus: 'unavailable' }),
            localNow: { day: 3, hour, label: `Wednesday ${hour}:00` },
          });
          const intentStats = (byIntent[q.intent] ||= blank());
          const styleStats = (byStyle[style] ||= blank());
          const bump = (key, n = 1) => {
            totals[key] += n;
            intentStats[key] += n;
            styleStats[key] += n;
          };
          bump('asked');
          if (code !== 200 || !out || typeof out.reply !== 'string') {
            bump('errors');
            continue;
          }
          if (ctx.requests[0]?.tool_choice) bump('forced');

          // The truth: every route among the named places and the traveler,
          // driving and walking, plus the true best order.
          const pts = [...q.places, ...(q.intent === 'recs' ? recPlaces : [])].map((n) => world.where(n));
          if (locOn) pts.push({ name: 'your location', lat: here.lat, lng: here.lng });
          const routes = [];
          for (const a of pts) for (const b of pts) if (a !== b) routes.push(world.asRoute(a, b, 'drive'), world.asRoute(a, b, 'walk'));
          if (q.intent === 'plan') {
            const best = await bestOrder({ stops: q.places, start: locOn ? 'my location' : '' }, { catalog: ALL_LANDMARKS, near: locOn ? here : null, fetchImpl: world.fakeFetch });
            if (!best.error) routes.push({ miles: best.totalMiles, km: best.totalKm, minutes: best.totalMinutes }, ...best.legs);
          }
          const truth = { routes, places: pts.filter((p) => p.name !== 'your location').map((p) => world.facts(p.name)) };
          const askedTravel = TRAVEL_INTENTS.has(q.intent);
          const canAnswer = q.intent === 'dist_pair' || (q.intent === 'walkable' && q.places.length > 1) || locOn;
          const g = gradeReply({ raw: ctx.modelReply, shown: out.reply, truth, askedTravel, canAnswer, toolRoutes: routesFrom(ctx.toolOuts) });
          bump('wrongBefore', g.wrongBefore.length);
          bump('wrongAfter', g.wrongAfter.length);
          if (g.wrongBefore.length) bump('repliesWrongBefore');
          if (g.wrongAfter.length) bump('repliesWrongAfter');
          bump('overCut', g.overCut.length);
          if (g.unanswered) bump('unanswered');
          if (process.env.MAPR_CHAT_SIM_DEBUG_OVERCUT && g.overCut.length && examples.length < 60) {
            examples.push({ intent: q.intent, style, question: q.text, model: ctx.modelReply, shown: out.reply, overCut: g.overCut.map((f) => f.claim?.text) });
          }
          if ((g.wrongAfter.length || g.unanswered) && examples.length < 60) {
            examples.push({ intent: q.intent, style, question: q.text, model: ctx.modelReply, shown: out.reply, wrong: g.wrongAfter.map((f) => f.text || f.claim?.text), unanswered: g.unanswered });
          }
          history.push({ role: 'user', content: q.text }, { role: 'assistant', content: out.reply || 'ok' });
        }
      }
    } finally {
      globalThis.fetch = realFetch;
      vi.useRealTimers();
    }
    const summary = { users: USERS, questions: totals.asked, seconds: Math.round((Date.now() - started) / 1000), totals, byIntent, byStyle, examples };
    if (process.env.MAPR_CHAT_SIM_OUT) {
      const dir = path.resolve(process.env.MAPR_CHAT_SIM_OUT);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `chat-sim-${USERS}.json`), JSON.stringify(summary, null, 2));
    }
    console.log(JSON.stringify({ ...summary, examples: examples.slice(0, 8) }, null, 1));
    expect(totals.errors).toBe(0);
    expect(totals.wrongAfter).toBe(0);
    expect(totals.unanswered).toBe(0);
  }, 3_600_000);
});

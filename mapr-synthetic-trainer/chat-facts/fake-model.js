// A stand-in for the AI behind Mapr chat that misbehaves the ways a real
// model can: sometimes it uses its tools and reports them right, sometimes
// it rounds or mixes up the numbers, sometimes it skips the tools and
// guesses. Each question gets a style:
//   careful (55%): uses the right tool, reports it exactly;
//   sloppy  (30%): uses tools half the time, garbles numbers half the time;
//   liar    (15%): never looks anything up, makes every number up.
// The simulation then checks what actually reaches the traveler.

const guessMiles = (r) => Math.round((0.5 + r() * 20) * 10) / 10;
const guessMin = (r) => 3 + Math.floor(r() * 45);
const guessHour = (r) => 5 + Math.floor(r() * 7);

function perturb(r, route) {
  const k = r();
  if (k < 0.3) return { miles: Math.round(route.miles * (0.45 + r() * 0.2) * 10) / 10, minutes: route.minutes };
  if (k < 0.55) return { miles: route.miles, minutes: Math.max(1, Math.round(route.minutes * 0.5)) };
  if (k < 0.8) return { miles: route.km, minutes: route.minutes }; // km reported as miles
  return { miles: Math.round(route.miles), minutes: Math.round(route.minutes / 10) * 10 || 5 };
}

const say = (from, to, mi, min, mode = 'driving') =>
  `${to} is ${mi} miles from ${from}, about ${min} minutes ${mode === 'walking' ? 'on foot' : 'by car'}.`;

export function styleFor(r) {
  const x = r();
  return x < 0.55 ? 'careful' : x < 0.85 ? 'sloppy' : 'liar';
}

const json = (reply, extra = {}) => JSON.stringify({ reply, stops: [], quickReplies: [], actions: [], ...extra });
const text = (t, usage = {}) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }], usage: { input_tokens: 1, output_tokens: 1, ...usage } });
let toolId = 0;
const toolUse = (name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t${++toolId}`, name, input }], usage: { input_tokens: 1, output_tokens: 1 } });

function routeInput(q, ctx) {
  const [A, B] = q.intent === 'recs' ? ctx.recPlaces : q.places;
  if (q.intent === 'dist_pair' || (q.intent === 'walkable' && B)) return { from: A, to: B, ...(q.intent === 'walkable' ? { mode: 'walk' } : {}) };
  return { from: 'my location', to: A || 'downtown', ...(q.intent === 'walkable' ? { mode: 'walk' } : {}) };
}

// The first call for a question (no tool results yet).
function firstMove(ctx, req) {
  const { q, r, style, world } = ctx;
  const forced = req.tool_choice?.name;
  if (forced === 'route_between') return toolUse('route_between', routeInput(q, ctx));
  if (forced === 'place_hours') return toolUse('place_hours', { place: q.intent === 'recs' ? ctx.recPlaces[0] : q.places[0] || ctx.recPlaces[0] });
  const uses = style === 'careful' || (style === 'sloppy' && r() < 0.5);
  const [A, B] = q.places;
  switch (q.intent) {
    case 'dist_pair':
    case 'dist_me':
    case 'walkable': {
      if (uses) return toolUse('route_between', routeInput(q, ctx));
      const inp = routeInput(q, ctx);
      return text(json(say(inp.from === 'my location' ? 'you' : inp.from, inp.to, guessMiles(r), guessMin(r), inp.mode === 'walk' ? 'walking' : 'driving')));
    }
    case 'hours': {
      if (uses && r() < 0.8) return toolUse('place_hours', { place: A });
      if (uses) {
        const f = world.facts(world.where(A).name);
        return text(json(`${A} is ${f.openNow ? 'open now' : 'closed now'}; today it's open ${world.clock(f.open)} to ${world.clock(f.close)}.`), { server_tool_use: { web_search_requests: 1 } });
      }
      return text(json(`${A} is open now until ${guessHour(r) + 12 > 23 ? 11 : guessHour(r)} PM.`));
    }
    case 'price':
    case 'rating': {
      if (uses) {
        const f = world.facts(world.where(A).name);
        const t = q.intent === 'price' ? `Tickets for ${A} run about $${f.price}.` : `${A} is rated ${f.rating} stars on Google.`;
        return text(json(t), { server_tool_use: { web_search_requests: 1 } });
      }
      return text(json(q.intent === 'price' ? `${A} is about $${10 + Math.floor(r() * 60)} per person.` : `${A} has ${(3.5 + r() * 1.4).toFixed(1)} stars.`));
    }
    case 'plan': {
      if (uses) return toolUse('best_order', { stops: q.places });
      const legs = q.places.map((p, i) => `${p}${i ? ` (${guessMin(r)} min drive)` : ''}`).join(', then ');
      return text(json(`Go ${legs}. That's about ${guessMin(r) + 20} minutes of driving total.`));
    }
    case 'recs': {
      const names = ctx.recPlaces;
      if (style === 'careful') {
        if (r() < 0.3) return toolUse('place_hours', { place: names[0] });
        return text(json(`Try ${names[0]} or ${names[1]}.`));
      }
      if (style === 'sloppy' && r() < 0.5) return text(json(`Try ${names[0]} (about ${guessMin(r)} min away) or ${names[1]}.`));
      if (style === 'liar') return text(json(`${names[0]} is just ${guessMin(r)} minutes from you and open until ${guessHour(r)} PM. ${names[1]} is a short walk away, rated 4.${Math.floor(r() * 9)} stars.`));
      return text(json(`Try ${names[0]}, a local favorite.`));
    }
    case 'directions':
      if (style === 'liar') return text(json(`Here's ${A}, only ${guessMin(r)} minutes away -- tap Directions to get there.`));
      return text(json(`Here's ${A} -- tap Directions to get there.`));
    case 'visit_length':
      return text(json(`Plan to spend about 2 hours at ${A}; the tour itself runs 90 minutes.`));
    case 'app':
      return text(json('Tap + on the Map tab and pick the place. It takes about 2 minutes.'));
    default:
      return text(json('Sure.'));
  }
}

// The call after tool results came back.
function afterTools(ctx, results) {
  const { r, style, world } = ctx;
  ctx.toolOuts.push(...results.map((x) => x.out));
  const garble = style === 'liar' || (style === 'sloppy' && r() < 0.5);
  const parts = [];
  let searched = false;
  for (const { name, out } of results) {
    if (name === 'route_between') {
      if (out.error) {
        parts.push(style === 'careful' ? "I couldn't check that distance right now." : `It's about ${guessMiles(r)} miles, ${guessMin(r)} minutes.`);
        continue;
      }
      const v = garble ? (style === 'liar' ? { miles: guessMiles(r), minutes: guessMin(r) } : perturb(r, out)) : out;
      parts.push(say(out.from.name, out.to.name, v.miles, v.minutes, out.mode));
    } else if (name === 'place_hours') {
      if (out.error) {
        parts.push(style === 'careful' ? "I couldn't confirm their hours." : `${ctx.q.places[0]} is open until ${guessHour(r)} PM.`);
        continue;
      }
      if (garble) parts.push(`${out.name} is open until ${guessHour(r)} PM.`);
      else parts.push(out.openNow ? `${out.name} is open now and closes at ${out.closesAt}.` : `${out.name} is closed now; it opens at ${out.opensAt}.`);
    } else if (name === 'best_order') {
      if (out.error) {
        parts.push("I couldn't work out the route right now.");
        continue;
      }
      const total = garble ? guessMin(r) : out.totalMinutes;
      parts.push(`Go ${out.order.join(', then ')}. That's ${total} minutes of ${out.mode} in all.`);
      if (!garble && r() < 0.5) parts.push(`First leg is ${out.legs[0].minutes} minutes.`);
    }
  }
  if (style === 'liar' && r() < 0.3) {
    parts.push(`Entry is $${10 + Math.floor(r() * 40)}.`);
  }
  void world;
  return text(json(parts.join(' ')), searched ? { server_tool_use: { web_search_requests: 1 } } : {});
}

export function fakeCreate(ctx) {
  return async (req) => {
    ctx.requests.push(req);
    const msgs = req.messages;
    const last = msgs[msgs.length - 1];
    const toolResults = Array.isArray(last.content) ? last.content.filter((b) => b.type === 'tool_result') : [];
    let res;
    if (!toolResults.length) {
      res = firstMove(ctx, req);
    } else {
      // Pair each result with the tool that asked for it.
      const asked = {};
      for (const m of msgs) if (m.role === 'assistant' && Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_use') asked[b.id] = b.name;
      res = afterTools(ctx, toolResults.map((t) => ({ name: asked[t.tool_use_id], out: JSON.parse(t.content) })));
    }
    if (res.stop_reason === 'end_turn') ctx.modelReply = JSON.parse(res.content[0].text).reply;
    return res;
  };
}

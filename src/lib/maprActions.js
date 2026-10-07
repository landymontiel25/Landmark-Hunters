import { ALL_LANDMARKS, getRegion } from '../data/regions';
import { lookupPlace, nearestRegionId, placeId, reverseGeocodePlace } from './placeLookup';
import {
  addGroupMember,
  addGroupPlace,
  createGroupTrip,
  deleteGroupTrip,
  removeGroupPlace,
  renameGroupTrip,
  setGroupLandmarks,
} from './groupTrips';
import { findUserByUsername } from './friends';
import { friendlyError } from './friendlyError';
import { createLandmarkFromPlace } from './placeLandmarks';
import { searchPlaces, getPlaceDetails, makeSessionToken } from './places';

// Mapr can do what a traveler could do by hand with their itineraries: add
// or remove a stop, create, rename, and invite someone. The AI only
// proposes actions (api/plan-ai.js); this runs them as the signed-in user,
// through the same functions and Firestore rules the screens use, so it
// can never do anything the traveler couldn't.
//
// Each result: { ok, text, undo?, link?, needsConfirm? } -- shown under
// Mapr's reply. Mapr never starts a new itinerary on its own: an action
// that would create one stops before changing anything and comes back as
// needsConfirm, and only runs once the traveler taps "Create it" (which
// re-runs it with ctx.allowCreate).

export const ACTION_TYPES = ['add_stop', 'remove_stop', 'create_itinerary', 'rename_itinerary', 'add_member', 'create_landmark_here'];

// Undo handlers for actions Mapr ran this session, keyed by message id +
// index. Module-level so they survive leaving the Mapr tab and coming
// back; not saved to disk, so they're gone after a full reload.
const undoRegistry = new Map();
export function registerUndo(key, fn) {
  undoRegistry.set(key, fn);
}
export function getUndo(key) {
  return undoRegistry.get(key);
}
export function forgetUndo(key) {
  undoRegistry.delete(key);
}

// The stops mentioned earlier in a chat (catalog matches and web finds),
// keyed by message id -- a failed action's Retry button re-resolves "it"/
// exact names against the same conversation, not just what's in this reply.
const conversationStopsRegistry = new Map();
export function registerConversationStops(msgId, stops) {
  conversationStopsRegistry.set(msgId, stops);
}
export function getConversationStops(msgId) {
  return conversationStopsRegistry.get(msgId) || [];
}

// TripContext's state only refreshes on the next render, so several
// actions in one reply track what they've already created/renamed here.
function soloExists(ctx, regionId) {
  return ctx.session.created.has(regionId) || ctx.tripApi.regionsWithItineraries().includes(regionId);
}
function soloName(ctx, regionId) {
  return ctx.session.names[regionId] || ctx.tripApi.itineraryName(regionId);
}
function rename(ctx, regionId, name) {
  ctx.tripApi.renameItinerary(regionId, name);
  ctx.session.names[regionId] = name || getRegion(regionId)?.name;
}

function confirmNew(regionId, stopName, newName) {
  const label = newName ? `"${newName}"` : `${getRegion(regionId)?.name || 'new'}`;
  return { ok: false, needsConfirm: true, text: `Start a new ${label} itinerary with ${stopName}?` };
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// "miami/wynwood-walls", or a name from anything Mapr has suggested in
// this conversation (catalog or web), or a catalog landmark by name.
function resolveStop(ref, conversationStops) {
  const text = String(ref || '').trim();
  if (!text) return null;
  if (text.includes('/')) {
    const [regionId, id] = text.split('/');
    const l = ALL_LANDMARKS.find((x) => x.regionId === regionId && x.id === id);
    if (l) return { kind: 'landmark', regionId, id, name: l.name };
  }
  const n = norm(text);
  const match =
    conversationStops.find((s) => norm(s.name) === n) ||
    conversationStops.find((s) => norm(s.name).includes(n) || n.includes(norm(s.name)));
  if (match) {
    if (!match.external) return { kind: 'landmark', regionId: match.region, id: match.id, name: match.name };
    return { kind: 'place', name: match.name, address: match.address || '', place: match.place || '', url: match.url || '' };
  }
  const l = ALL_LANDMARKS.find((x) => norm(x.name) === n);
  return l ? { kind: 'landmark', regionId: l.regionId, id: l.id, name: l.name } : null;
}

function findItinerary(ref, ctx) {
  const r = String(ref || '').trim();
  if (!r || r === 'new') return null;
  const group = ctx.groupTrips.find((g) => g.id === r || norm(g.name) === norm(r));
  if (group) return { kind: 'group', trip: group, name: group.name, regionId: group.regionId };
  const soloIds = [...new Set([...ctx.tripApi.regionsWithItineraries(), ...ctx.session.created])];
  const soloId =
    soloIds.find((id) => id === r) ||
    soloIds.find((id) => norm(soloName(ctx, id)) === norm(r) || norm(getRegion(id)?.name) === norm(r));
  if (soloId) return { kind: 'solo', regionId: soloId, name: soloName(ctx, soloId) };
  return null;
}

// Throws a plain-language Error (never the raw "No match"/"No coordinates"
// from lookupPlace) so a failed lookup reads as a real answer, not a crash.
async function placeFor(stop, near) {
  const query = [stop.name, stop.address || stop.place].filter(Boolean).join(', ');
  let spot;
  try {
    spot = await lookupPlace(query, near);
  } catch {
    // .userMessage is friendlyError's convention for "this text is already
    // safe to show" (see fetchJson) -- without it, a plain Error's message
    // is treated as raw/technical and replaced with the generic fallback.
    const err = new Error('Place lookup failed');
    err.userMessage = `Couldn't find "${stop.name}" on the map${stop.address ? ` at ${stop.address}` : ''}. It may be closed, or the name might not match what Google has -- try the exact business name.`;
    throw err;
  }
  return {
    id: placeId(stop.name, spot.lat, spot.lng),
    name: stop.name.slice(0, 120),
    address: (stop.address || spot.address || '').slice(0, 160),
    lat: spot.lat,
    lng: spot.lng,
    url: stop.url || '',
  };
}

const soloLink = (regionId) => ({ to: '/itinerary', regionId });
const groupLink = (tripId) => ({ to: `/group/${tripId}` });

async function addStop(action, ctx) {
  const stop = resolveStop(action.stop, ctx.conversationStops);
  if (!stop) return { ok: false, text: `Couldn't tell which place "${action.stop}" is. Try naming it exactly.` };
  let target = findItinerary(action.itinerary, ctx);

  if (target?.kind === 'group') {
    const trip = target.trip;
    if (stop.kind === 'landmark') {
      if (stop.regionId !== trip.regionId) {
        return { ok: false, text: `${stop.name} is in ${getRegion(stop.regionId)?.name}, but ${trip.name} is for ${getRegion(trip.regionId)?.name}.` };
      }
      await setGroupLandmarks(trip, [stop.id], true);
      return {
        ok: true,
        text: `Added ${stop.name} to ${trip.name}.`,
        undo: () => setGroupLandmarks(trip, [stop.id], false),
        link: groupLink(trip.id),
      };
    }
    const place = await placeFor(stop, ctx.coords);
    await addGroupPlace(trip, place);
    return {
      ok: true,
      text: `Added ${stop.name} to ${trip.name}.`,
      undo: () => removeGroupPlace({ ...trip, places: [...(trip.places || []), place] }, place.id),
      link: groupLink(trip.id),
    };
  }

  // Solo itinerary (one per city). A web place's city comes from where it
  // actually is, not from what the AI guessed.
  if (stop.kind === 'landmark') {
    const regionId = stop.regionId;
    const existed = soloExists(ctx, regionId);
    if (target?.kind === 'solo' && target.regionId !== regionId) {
      return { ok: false, text: `${stop.name} is in ${getRegion(regionId)?.name}, not ${target.name}. Want it in a ${getRegion(regionId)?.name} itinerary instead?` };
    }
    if (!existed && !ctx.allowCreate) return confirmNew(regionId, stop.name, action.newName);
    ctx.tripApi.addLandmark(stop.id, regionId);
    if (!existed && action.newName) rename(ctx, regionId, action.newName);
    const name = soloName(ctx, regionId);
    ctx.session.created.add(regionId);
    return {
      ok: true,
      text: `Added ${stop.name} to ${existed ? 'your' : 'a new'} ${name} itinerary.`,
      undo: () => {
        ctx.tripApi.removeLandmark(stop.id, regionId);
        if (!existed) ctx.tripApi.removeItinerary(regionId);
      },
      link: soloLink(regionId),
    };
  }

  const place = await placeFor(stop, ctx.coords);
  const regionId = target?.kind === 'solo' ? target.regionId : nearestRegionId(place.lat, place.lng);
  if (!regionId) {
    return { ok: false, text: `${stop.name} is outside the cities the app plans trips for, so it can't go on an itinerary yet.` };
  }
  const existed = soloExists(ctx, regionId);
  if (!existed && !ctx.allowCreate) return confirmNew(regionId, stop.name, action.newName);
  ctx.tripApi.addPlace(regionId, place);
  if (!existed && action.newName) rename(ctx, regionId, action.newName);
  const name = soloName(ctx, regionId);
  ctx.session.created.add(regionId);
  return {
    ok: true,
    text: `Added ${stop.name} to ${existed ? 'your' : 'a new'} ${name} itinerary.`,
    undo: () => {
      ctx.tripApi.removePlace(regionId, place.id);
      if (!existed) ctx.tripApi.removeItinerary(regionId);
    },
    link: soloLink(regionId),
  };
}

async function removeStop(action, ctx) {
  const target = findItinerary(action.itinerary, ctx);
  const stop = resolveStop(action.stop, ctx.conversationStops);
  const n = norm(action.stop);
  // A name with nothing left after norm() (empty, emoji, non-Latin) would
  // match every place via .includes('') -- don't guess which one.
  if (!n && !stop) return { ok: false, text: `Couldn't tell which place "${action.stop}" is. Try naming it exactly.` };
  if (target?.kind === 'group') {
    const trip = target.trip;
    if (stop?.kind === 'landmark' && (trip.landmarkIds || []).includes(stop.id)) {
      await setGroupLandmarks(trip, [stop.id], false);
      return { ok: true, text: `Removed ${stop.name} from ${trip.name}.`, undo: () => setGroupLandmarks(trip, [stop.id], true), link: groupLink(trip.id) };
    }
    const place = n ? (trip.places || []).find((p) => norm(p.name) === n || norm(p.name).includes(n)) : null;
    if (place) {
      await removeGroupPlace(trip, place.id);
      return { ok: true, text: `Removed ${place.name} from ${trip.name}.`, undo: () => addGroupPlace({ ...trip, places: [] }, place), link: groupLink(trip.id) };
    }
    return { ok: false, text: `"${action.stop}" isn't on ${trip.name}.` };
  }
  const regionIds = target ? [target.regionId] : ctx.tripApi.regionsWithItineraries();
  for (const regionId of regionIds) {
    if (stop?.kind === 'landmark' && stop.regionId === regionId && ctx.tripApi.getRegionSelection(regionId).includes(stop.id)) {
      ctx.tripApi.removeLandmark(stop.id, regionId);
      return { ok: true, text: `Removed ${stop.name} from your ${ctx.tripApi.itineraryName(regionId)} itinerary.`, undo: () => ctx.tripApi.addLandmark(stop.id, regionId), link: soloLink(regionId) };
    }
    const place = n ? (ctx.trip.placesByRegion?.[regionId] || []).find((p) => norm(p.name) === n || norm(p.name).includes(n)) : null;
    if (place) {
      ctx.tripApi.removePlace(regionId, place.id);
      return { ok: true, text: `Removed ${place.name} from your ${ctx.tripApi.itineraryName(regionId)} itinerary.`, undo: () => ctx.tripApi.addPlace(regionId, place), link: soloLink(regionId) };
    }
  }
  return { ok: false, text: `Couldn't find "${action.stop}" on your itineraries.` };
}

async function createItinerary(action, ctx) {
  const regionId = getRegion(action.city) ? action.city : null;
  const name = String(action.name || '').trim().slice(0, 80) || (regionId && `${getRegion(regionId).name} Trip`);
  if (!regionId) return { ok: false, text: 'Which city is this itinerary for?' };
  if (action.group) {
    if (!ctx.user) return { ok: false, text: 'Sign in to create a group itinerary.' };
    if (!ctx.allowCreate) return { ok: false, needsConfirm: true, text: `Create the group itinerary ${name}?` };
    const id = await createGroupTrip({ ownerUid: ctx.user.uid, ownerName: ctx.ownerName, name, regionId });
    ctx.onGroupsChanged?.();
    return { ok: true, text: `Created the group itinerary ${name}.`, undo: () => deleteGroupTrip(id).then(() => ctx.onGroupsChanged?.()), link: groupLink(id) };
  }
  const existed = soloExists(ctx, regionId);
  if (!existed && !ctx.allowCreate) return { ok: false, needsConfirm: true, text: `Create your ${name} itinerary?` };
  const oldName = ctx.trip.itineraryNames?.[regionId];
  rename(ctx, regionId, name);
  ctx.session.created.add(regionId);
  if (existed) {
    return {
      ok: true,
      text: `You already had a ${getRegion(regionId).name} itinerary, so I named it ${name}.`,
      undo: () => ctx.tripApi.renameItinerary(regionId, oldName || ''),
      link: soloLink(regionId),
    };
  }
  return { ok: true, text: `Created your ${name} itinerary.`, undo: () => ctx.tripApi.removeItinerary(regionId), link: soloLink(regionId) };
}

async function renameItin(action, ctx) {
  const target = findItinerary(action.itinerary, ctx);
  const name = String(action.name || '').trim().slice(0, 80);
  if (!target || !name) return { ok: false, text: "Couldn't tell which itinerary to rename." };
  if (target.kind === 'group') {
    const old = target.trip.name;
    await renameGroupTrip(target.trip, name);
    ctx.onGroupsChanged?.();
    return { ok: true, text: `Renamed ${old} to ${name}.`, undo: () => renameGroupTrip({ ...target.trip, name }, old).then(() => ctx.onGroupsChanged?.()), link: groupLink(target.trip.id) };
  }
  const old = ctx.trip.itineraryNames?.[target.regionId] || '';
  rename(ctx, target.regionId, name);
  return { ok: true, text: `Renamed ${target.name} to ${name}.`, undo: () => ctx.tripApi.renameItinerary(target.regionId, old), link: soloLink(target.regionId) };
}

async function addMember(action, ctx) {
  if (!ctx.user) return { ok: false, text: 'Sign in to add people to an itinerary.' };
  const target = findItinerary(action.itinerary, ctx);
  if (!target) return { ok: false, text: "Couldn't tell which itinerary to add them to." };
  const username = String(action.username || '').trim().replace(/^@/, '').toLowerCase();
  const found = username ? await findUserByUsername(username) : null;
  if (!found?.uid) return { ok: false, text: `No one goes by @${username || '?'}. Check the username.` };
  if (found.uid === ctx.user.uid) return { ok: false, text: "That's you." };
  const member = { uid: found.uid, name: found.username || found.displayName || username };
  if (target.kind === 'group') {
    if ((target.trip.memberUids || []).includes(member.uid)) return { ok: true, text: `${member.name} is already on ${target.name}.`, link: groupLink(target.trip.id) };
    await addGroupMember(target.trip, member.uid, member.name);
    ctx.onGroupsChanged?.();
    return { ok: true, text: `Added ${member.name} to ${target.name}.`, link: groupLink(target.trip.id) };
  }
  // Solo -> group trip with the same name, stops and places.
  const regionId = target.regionId;
  const id = await createGroupTrip({
    ownerUid: ctx.user.uid,
    ownerName: ctx.ownerName,
    name: target.name,
    regionId,
    // Only catalog stops: the saved order can also hold Mapr-found places' ids.
    landmarkIds: ctx.tripApi
      .getRegionSelection(regionId)
      .filter((id) => ALL_LANDMARKS.some((l) => l.regionId === regionId && l.id === id)),
    places: ctx.trip.placesByRegion?.[regionId] || [],
    initialMembers: [member],
  });
  ctx.tripApi.removeItinerary(regionId);
  ctx.onGroupsChanged?.();
  return { ok: true, text: `Added ${member.name}. ${target.name} is now a group trip you both can edit.`, link: groupLink(id) };
}

// "Make a landmark for where I am" -- identifies the real place at the
// traveler's exact GPS point (or, if they named one, searches for that
// name near them instead -- covers both the original ask and a correction
// like "no, I'm at the visitor center"), then asks them to confirm before
// creating anything, the same needsConfirm/allowCreate pattern as starting
// a new itinerary. Re-resolves on the confirm step too rather than caching
// across the round trip -- simpler, and the traveler hasn't moved in the
// few seconds since.
async function createLandmarkHere(action, ctx) {
  if (!ctx.user) return { ok: false, text: 'Sign in first — adding a landmark needs an account.' };
  if (!ctx.coords) return { ok: false, text: "I don't have your location yet — turn on location and try again." };

  let resolved;
  const nameOverride = String(action.nameOverride || '').trim();
  if (nameOverride) {
    const token = makeSessionToken();
    const viewbox = {
      minLat: ctx.coords.lat - 0.01,
      maxLat: ctx.coords.lat + 0.01,
      minLng: ctx.coords.lng - 0.01,
      maxLng: ctx.coords.lng + 0.01,
    };
    const [top] = await searchPlaces(nameOverride, { viewbox }, token);
    if (!top) return { ok: false, text: `Couldn't find "${nameOverride}" near you.` };
    const details = await getPlaceDetails(top.placeId, token);
    resolved = { name: details.primary || nameOverride, lat: details.lat, lng: details.lng, address: details.secondary || '' };
  } else {
    const nearby = await reverseGeocodePlace(ctx.coords.lat, ctx.coords.lng);
    if (!nearby?.name) {
      return { ok: false, text: "I can't tell exactly what's at your location -- try naming the place (\"make a landmark for the visitor center here\")." };
    }
    resolved = nearby;
  }

  if (!ctx.allowCreate) {
    return {
      ok: false,
      needsConfirm: true,
      text: `Just to confirm -- you're at ${resolved.name}${resolved.address ? ` (${resolved.address})` : ''}, right?`,
    };
  }

  const created = await createLandmarkFromPlace({
    details: { primary: resolved.name, lat: resolved.lat, lng: resolved.lng },
    fallbackName: resolved.name,
    user: ctx.user,
    resendVerification: ctx.resendVerification,
  });
  return {
    ok: true,
    text: `Added ${created.name} as a new landmark -- you can rate it, check in, and comment on it now.`,
    link: { to: `/landmarks/${created.regionId}/${created.id}` },
  };
}

const RUNNERS = {
  add_stop: addStop,
  remove_stop: removeStop,
  create_itinerary: createItinerary,
  rename_itinerary: renameItin,
  add_member: addMember,
  create_landmark_here: createLandmarkHere,
};

export async function runMaprActions(actions, baseCtx) {
  const ctx = { ...baseCtx, session: { created: new Set(), names: {} } };
  const results = [];
  for (const action of actions || []) {
    const run = RUNNERS[action?.type];
    if (!run) continue;
    try {
      results.push({ ...(await run(action, ctx)), action });
    } catch (err) {
      // A place lookup throws its own plain-language Error (see placeFor);
      // anything else (a rules rejection, a dropped connection) falls back
      // to a generic one. Either way the failed action itself -- not just
      // the whole message -- can be retried without retyping the request.
      results.push({ ok: false, text: friendlyError(err, "That didn't go through. Try again."), action });
    }
  }
  return results;
}

/** Re-runs exactly one previously-failed action, e.g. from a Retry button. */
export async function retryMaprAction(action, baseCtx, { allowCreate = false } = {}) {
  const [result] = await runMaprActions([action], { ...baseCtx, allowCreate });
  return result;
}

// What Mapr is told about your itineraries, so "add it to my itinerary"
// and "rename my Philly trip" can point at the right one.
export function itinerarySummary(trip, tripApi, groupTrips) {
  const solo = tripApi.regionsWithItineraries().map((regionId) => ({
    kind: 'solo',
    ref: regionId,
    name: tripApi.itineraryName(regionId),
    city: getRegion(regionId)?.name || regionId,
    stops: [
      ...tripApi.getRegionSelection(regionId).map((id) => ALL_LANDMARKS.find((l) => l.regionId === regionId && l.id === id)?.name).filter(Boolean),
      ...(trip.placesByRegion?.[regionId] || []).map((p) => p.name),
    ].slice(0, 30),
  }));
  const groups = groupTrips.map((g) => ({
    kind: 'group',
    ref: g.id,
    name: g.name,
    city: getRegion(g.regionId)?.name || g.regionId,
    members: Object.values(g.memberNames || {}).slice(0, 10),
    stops: [
      ...(g.landmarkIds || []).map((id) => ALL_LANDMARKS.find((l) => l.regionId === g.regionId && l.id === id)?.name).filter(Boolean),
      ...(g.places || []).map((p) => p.name),
    ].slice(0, 30),
  }));
  return [...solo, ...groups].slice(0, 20);
}

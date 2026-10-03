import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import LandmarkThumb from '../components/LandmarkThumb';
import { useAuth } from '../lib/AuthContext';
import { landmarkForRating } from '../lib/placeLandmarks';
import { getLandmark } from '../data/regions';
import { distanceMeters } from '../lib/geo';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import { useFriends } from '../lib/FriendsContext';
import { useMyPhotos } from '../lib/MyPhotosContext';
import { useRatings } from '../lib/RatingsContext';
import { useTrip } from '../lib/TripContext';
import { useGeo } from '../lib/GeoContext';
import { effectiveTagScores, pickRegion } from '../lib/tagScores';
import { useMaprChat } from '../lib/MaprChatContext';
import MaprChatsPanel from '../components/MaprChatsPanel';
import MultiRegionSearch from '../components/MultiRegionSearch';
import DirectionsButton from '../components/DirectionsButton';
import { reverseLocality } from '../lib/geocode';
import { computeTasteConfidence, hasInsiderMode, votesAsReviews } from '../lib/tasteProfile';
import { readLocalFeedback } from '../lib/pickFeedback';
import { composeTasteIntro, baselineToSyntheticReviews } from '../lib/tasteQuestions';
import { logPlanningEvent } from '../lib/timeSaved';
import DiscoveryStatsCard from '../components/DiscoveryStatsCard';
import TasteProfileCard from '../components/TasteProfileCard';
import TasteNudgeCard from '../components/TasteNudgeCard';
import OnboardingBanner from '../components/OnboardingBanner';
import TripPlannerCard from '../components/TripPlannerCard';
import OnScreen from '../components/OnScreen';
import { makeSetId } from '../lib/setId';
import { useShownLogger } from '../lib/useShownLogger';
import MaprRateCard from '../components/MaprRateCard';
import PickVoteButtons from '../components/PickVoteButtons';
import { usePickVotes } from '../lib/usePickVotes';
import { authHeaders } from '../lib/apiAuth';
import { fetchJson, friendlyError } from '../lib/friendlyError';
import {
  runMaprActions,
  retryMaprAction,
  itinerarySummary,
  registerUndo,
  getUndo,
  forgetUndo,
  registerConversationStops,
  getConversationStops,
} from '../lib/maprActions';
import { listMyGroupTrips } from '../lib/groupTrips';
import { writePersisted } from '../lib/usePersistentState';
import { useToast } from '../lib/ToastContext';
import { API_BASE } from '../lib/apiBase';
import { tasteContextFor, normalizeRequestFor } from '../lib/requestFor';

// "You haven't told Mapr what you like yet" nudge -- shown once (per
// device/account) until either dismissed outright or satisfied by actually
// talking to Mapr or filling in Settings' taste intro. Per-uid so signing
// into a different account doesn't inherit another account's dismissal.
const TASTE_NUDGE_DISMISSED_PREFIX = 'landmarkhunters.tasteNudgeDismissed.';
function isTasteNudgeDismissed(uid) {
  try {
    return localStorage.getItem(`${TASTE_NUDGE_DISMISSED_PREFIX}${uid}`) === '1';
  } catch {
    return false;
  }
}
function dismissTasteNudge(uid) {
  try {
    localStorage.setItem(`${TASTE_NUDGE_DISMISSED_PREFIX}${uid}`, '1');
  } catch {
    /* storage full/disabled -- non-fatal, nudge just won't stay dismissed */
  }
}

// The app's home screen -- the one thing people open every day. A live
// chat instead of a form: you type what you want in your own words, the AI
// replies conversationally, and it drops in real catalog stops when it has
// enough to go on. Follow-ups ("more nightlife", "skip that one") refine
// the same thread instead of starting over. Reads the same rating history
// (myReviews) and saved interests Mapr Picks does, so it's never guessing
// at a traveler's taste from nothing when it already knows.
export default function Mapr() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, resendVerification } = useAuth();
  const { units } = useUnits();
  const { myProfile, profileFresh, myUsername } = useFriends();
  const toast = useToast();
  const { myPhotos } = useMyPhotos();
  const { myReviews } = useRatings();
  const tripApi = useTrip();
  const { trip } = tripApi;
  // Your group trips, so Mapr can add to / rename / invite people to them.
  const [groupTrips, setGroupTrips] = useState([]);
  const loadGroupTrips = () => {
    if (!user) {
      setGroupTrips([]);
      return Promise.resolve([]);
    }
    return listMyGroupTrips(user.uid)
      .then((g) => {
        setGroupTrips(g);
        return g;
      })
      .catch(() => groupTrips);
  };
  useEffect(() => {
    loadGroupTrips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);
  // Marks one action result as undone (kept in the saved chat, so it stays
  // marked after leaving and coming back).
  const markUndone = (msgId, idx) =>
    setMessages((cur) =>
      cur.map((m) =>
        m.id === msgId ? { ...m, actionResults: m.actionResults.map((r, j) => (j === idx ? { ...r, undone: true } : r)) } : m
      )
    );

  const setActionResult = (msgId, idx, next) =>
    setMessages((cur) =>
      cur.map((m) => (m.id === msgId ? { ...m, actionResults: m.actionResults.map((r, j) => (j === idx ? next : r)) } : m))
    );

  // setId -> how its picks are logged. Planner replies carry
  // { source: 'trip-planner', pickType, rankedIds }; plain chat is null.
  const liveSets = useRef(new Map());
  const logChat = useShownLogger({ uid: user?.uid, profile: myProfile, surface: 'chat', source: 'chat' });
  const logPlanner = useShownLogger({ uid: user?.uid, profile: myProfile, surface: 'mapr-tab', source: 'trip-planner' });
  const logStopShown = (m, idx, stop) => {
    if (m.role !== 'assistant' || !m.setId || !liveSets.current.has(m.setId)) return;
    const meta = liveSets.current.get(m.setId);
    const stopWithRank = { ...stop, rank: idx + 1 };
    const requestFor = requestForSet.current.get(m.setId) || m.requestFor || null;
    if (meta) logPlanner(m.setId, [stopWithRank], { source: meta.source, pickType: meta.pickType, rankedIds: meta.rankedIds, requestFor });
    else logChat(m.setId, [stopWithRank], { requestFor });
  };

  // setId -> 'solo' | 'group': who the request behind each reply was for, so
  // the picks logged when its cards are shown carry requestFor.
  const requestForSet = useRef(new Map());
  const [retrying, setRetrying] = useState({});
  // Retries exactly the one action that failed -- no retyping the whole
  // request, and no repeating whatever else was in the same reply that
  // already went through.
  const retryAction = async (msgId, idx, { allowCreate = false } = {}) => {
    const key = `${msgId}:${idx}`;
    if (retrying[key]) return;
    const current = messages.find((m) => m.id === msgId)?.actionResults?.[idx];
    if (!current?.action) return;
    setRetrying((cur) => ({ ...cur, [key]: true }));
    try {
      const fresh = await retryMaprAction(current.action, {
        trip,
        tripApi,
        groupTrips: user ? await loadGroupTrips() : [],
        user,
        resendVerification,
        ownerName: myUsername || user?.displayName || 'Explorer',
        coords,
        conversationStops: getConversationStops(msgId),
        onGroupsChanged: loadGroupTrips,
      }, { allowCreate });
      if (fresh.undo) registerUndo(key, fresh.undo);
      setActionResult(msgId, idx, {
        ok: fresh.ok,
        text: fresh.text,
        link: fresh.link || null,
        action: fresh.action,
        needsConfirm: !!fresh.needsConfirm,
      });
    } catch (err) {
      toast.show(friendlyError(err, "That didn't go through. Try again."));
    } finally {
      setRetrying((cur) => {
        const next = { ...cur };
        delete next[key];
        return next;
      });
    }
  };
  const { coords, error: geoError } = useGeo();
  // The three answer buttons on each suggested place (Mapr tab planner and chat).
  const pickVotes = usePickVotes({ uid: user?.uid, origin: coords ? { lat: coords.lat, lng: coords.lng } : null });
  // Chat thread, city picks, planner-open state, cost total and busy all
  // live in MaprChatContext (above the router in App.jsx) instead of here
  // -- this screen unmounts like any other route the moment you tap over
  // to another tab, so anything kept as local state here was silently
  // wiped the moment you stepped away to check a landmark and came back.
  const {
    messages,
    setMessages,
    setMessagesFor,
    activeChat,
    activeProject,
    draft,
    setDraft,
    regions,
    setRegions,
    showPlanner,
    setShowPlanner,
    totalCost,
    setTotalCost,
    busy,
    setBusy,
    restored,
    dismissRestored,
    discardChat,
    synced,
    newChat,
    renameChat,
  } = useMaprChat();
  // Arriving from a "shared a project with you" notification opens the list.
  const [chatsOpen, setChatsOpen] = useState(() => !!location.state?.openChats);
  const [renamingTitle, setRenamingTitle] = useState(null);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [regionOpen, setRegionOpen] = useState(false);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const feedEndRef = useRef(null);
  const sendingRef = useRef(new Set());
  const regionBoxRef = useRef(null);

  const hasTasteInfo = !!(myProfile?.tasteIntro || myProfile?.swipeSummary || (myProfile?.tasteBaseline && Object.keys(myProfile.tasteBaseline).length));
  // profileFresh: don't nag "you haven't told Mapr what you like" off the
  // localStorage prefill -- until the real server read lands, the profile
  // can look empty when it isn't.
  const showTasteNudge = !!user && profileFresh && !hasTasteInfo && !nudgeDismissed && !isTasteNudgeDismissed(user.uid);
  const dismissNudge = () => {
    if (user) dismissTasteNudge(user.uid);
    setNudgeDismissed(true);
  };

  // Follow the conversation when a message arrives, the typing dots appear
  // or you switch chats -- not on every in-place update to an older message
  // (a suggested stop finishing its background setup), which used to yank
  // the page to the bottom while you were reading further up.
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, busy, activeChat.id]);

  // A place Mapr found on the web isn't checkable-into or directions-ready
  // until it's a real landmark -- so the moment one shows up in a reply,
  // silently turn it into one the same way "rate a place you just left"
  // already does (landmarkForRating), instead of waiting for the traveler
  // to ask or tap. Best-effort: signed out, unverified email, or "couldn't
  // find it on the map" all just leave the stop tappable-to-retry with a
  // Source link -- nothing about the chat reply itself should ever break.
  //
  // Keyed by message id (not the message object itself): several stops on
  // the same reply resolve concurrently, and matching by object identity
  // meant whichever one landed last silently overwrote the others' updates
  // -- a message replaced by one update was no longer `===` the reference
  // a second in-flight update still held, so that second update's setState
  // matched nothing and was dropped. Matching by id is safe against that
  // no matter how many resolve out of order.
  //
  // `creatingPromisesRef` holds the in-flight promise per stop (not just a
  // "started" flag) so a tap on a card the background effect already
  // started creating awaits that same request instead of firing a second,
  // duplicate creation.
  const creatingPromisesRef = useRef(new Map());
  const [creatingKeys, setCreatingKeys] = useState(() => new Set());
  const stopKey = (msgId, idx, name) => `${msgId}:${idx}:${name}`;

  const ensureStopCreated = (m, idx, stop) => {
    if (stop.createdId) {
      return Promise.resolve({ id: stop.createdId, region: stop.createdRegion, lat: stop.lat, lng: stop.lng });
    }
    const key = stopKey(m.id, idx, stop.name);
    const existing = creatingPromisesRef.current.get(key);
    if (existing) return existing;

    setCreatingKeys((cur) => new Set(cur).add(key));
    // The AI research + web search behind this can genuinely take a while
    // -- but it must never look stuck forever if a request truly hangs, so
    // this gives up and shows a retryable failure after a bounded wait.
    const withTimeout = (p, ms) =>
      Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out setting this up.')), ms))]);
    const promise = withTimeout(
      landmarkForRating({ name: stop.name, address: stop.address || stop.place }, { near: coords, user, resendVerification }),
      30000
    )
      .then((created) => {
        setMessagesFor(activeChat.id, (cur) =>
          cur.map((mm) =>
            mm.id === m.id
              ? {
                  ...mm,
                  stops: mm.stops.map((s, i) =>
                    i === idx
                      ? {
                          ...s,
                          createdId: created.id,
                          createdRegion: created.region || created.regionId,
                          lat: created.lat,
                          lng: created.lng,
                          images: created.images,
                          categories: created.categories,
                          hours: created.hours || null,
                          createFailed: false,
                        }
                      : s
                  ),
                }
              : mm
          )
        );
        return created;
      })
      .catch((err) => {
        setMessagesFor(activeChat.id, (cur) =>
          cur.map((mm) => (mm.id === m.id ? { ...mm, stops: mm.stops.map((s, i) => (i === idx ? { ...s, createFailed: true } : s)) } : mm))
        );
        throw err;
      })
      .finally(() => {
        creatingPromisesRef.current.delete(key);
        setCreatingKeys((cur) => {
          const next = new Set(cur);
          next.delete(key);
          return next;
        });
      });
    creatingPromisesRef.current.set(key, promise);
    return promise;
  };

  useEffect(() => {
    if (!user) return;
    for (const m of messages) {
      if (!m.stops?.length) continue;
      m.stops.forEach((stop, idx) => {
        if (!stop.external || stop.createdId) return;
        const key = stopKey(m.id, idx, stop.name);
        if (creatingPromisesRef.current.has(key)) return;
        ensureStopCreated(m, idx, stop).catch(() => {});
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, user]);

  // Tapping any stop -- a resolved card or one still "found on the web" --
  // opens its landmark page. If it isn't created yet, waits on (or starts)
  // that creation first, and navigates from the resolved value directly
  // rather than the next render, so this never races the background effect.
  const openStop = async (m, idx, stop) => {
    if (!stop.external) {
      navigate(`/landmarks/${stop.region}/${stop.id}`);
      return;
    }
    if (stop.createdId) {
      navigate(`/landmarks/${stop.createdRegion}/${stop.createdId}`);
      return;
    }
    // Tapping a card that's already mid-creation (background effect or an
    // earlier tap) just awaits the same request below -- this toast is the
    // only feedback that tap needs, since the button itself can't visibly
    // change state twice in a row for the same thing.
    if (creatingKeys.has(stopKey(m.id, idx, stop.name))) {
      toast.show('Still setting this up — hang tight.');
    }
    try {
      const created = await ensureStopCreated(m, idx, stop);
      navigate(`/landmarks/${created.region || created.regionId}/${created.id}`);
    } catch (err) {
      // Couldn't create it (signed out, unverified, not found on the map,
      // or timed out -- already reflected as createFailed) -- stays put,
      // Source link still works, tapping again retries.
      toast.show(friendlyError(err, "Couldn't open that place — tap it again to retry."));
    }
  };

  // Consume the "open the planner" nav state once so it doesn't reopen on
  // every re-render or if you navigate back to Mapr again later. showPlanner
  // itself now lives in MaprChatContext (so it survives leaving and
  // returning to this tab on its own) -- this effect only ever turns it ON
  // when arriving via that specific nav state, never off, so it doesn't
  // clobber a planner you already had open from before.
  useEffect(() => {
    if (location.state?.openTripPlanner) {
      setShowPlanner(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Ask Mapr about …" from a landmark's page: arrives with the question
  // and sends it straight away, once per navigation.
  const pendingAskRef = useRef(location.state?.ask || null);
  useEffect(() => {
    const ask = pendingAskRef.current;
    if (!ask) return;
    pendingAskRef.current = null;
    navigate(location.pathname, { replace: true, state: {} });
    send(null, ask);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (regionBoxRef.current && !regionBoxRef.current.contains(e.target)) setRegionOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const openLink = (link) => {
    if (link.regionId) writePersisted('itinerary.openRegion', link.regionId);
    navigate(link.to);
  };

  const toggleRegion = (r) => {
    setRegions((cur) => (cur.some((c) => c.id === r.id) ? cur.filter((c) => c.id !== r.id) : [...cur, r]));
  };

  // overrideText lets the trip planner card (or anything else) send a
  // message programmatically without going through the composer input.
  // retry resends the text of a failed turn: that user bubble is already in
  // the thread, so only the error bubble under it is swapped back out for
  // the typing indicator -- never a second copy of the same message.
  // Plan Your Trip with nothing changed since its last plan (same answers,
  // same spot within half a mile, same part of the day): show that plan
  // again instead of asking the AI for the same thing. Its itinerary
  // actions already ran the first time, so they aren't repeated.
  const replayPlan = (text, reply, logMeta = null, requestFor = 'solo') => {
    if (busy) return;
    const setId = makeSetId(user?.uid);
    liveSets.current.set(setId, logMeta);
    requestForSet.current.set(setId, requestFor);
    if (showTasteNudge) dismissNudge();
    if (restored) dismissRestored();
    setMessagesFor(activeChat.id, (cur) => [
      ...cur,
      { role: 'user', text, requestFor },
      { ...reply, id: `m${Date.now()}`, role: 'assistant', actionResults: [], fromCache: true, setId, requestFor },
    ]);
  };

  // onReply (optional) gets the finished assistant message, e.g. so the
  // trip planner can cache it and log its picks.
  const doSend = async (e, overrideText, { retry = false, historyOverride, onReply, beforeSend, requestFor: requestForIn = 'solo' } = {}) => {
    e?.preventDefault();
    const requestFor = normalizeRequestFor(requestForIn);
    const text = (overrideText ?? draft).trim();
    // sendingRef covers a second Enter/tap in the same tick, before `busy`
    // has re-rendered.
    if (!text || busy || sendingRef.current.has(activeChat.id)) return;
    beforeSend?.();

    // Actually talking to Mapr about what you're into satisfies the taste
    // nudge just as well as filling in the Settings field does -- that's
    // the whole point of the nudge, so don't ask again once it's happened.
    if (showTasteNudge) dismissNudge();
    if (restored) dismissRestored();

    // The reply belongs to this chat even if you switch to another one
    // while it's coming in.
    const chatId = activeChat.id;
    sendingRef.current.add(chatId);
    const put = (u) => setMessagesFor(chatId, u);
    // historyOverride: editing an earlier message already truncated
    // `messages` in state, but that setState hasn't landed yet by the time
    // this runs in the same tick -- read from the override instead of the
    // (still-stale) `messages` closure so the edit doesn't briefly resurrect
    // the messages it just replaced.
    const startingMessages = historyOverride ?? messages;
    const base = retry && startingMessages.at(-1)?.error ? startingMessages.slice(0, -1) : startingMessages;
    const history = retry ? base : [...base, { role: 'user', text, requestFor }];
    setMessages(history);
    // Only a typed message empties the composer; a quick reply or planner
    // message leaves whatever you'd started typing alone.
    if (overrideText == null) setDraft('');
    setBusy(true, chatId);

    try {
      // The AI only needs its own prior replies (not the canned local greeting)
      // plus every turn you typed, to keep following the thread.
      const payload = history
        .filter((m) => m.role === 'user' || m.raw)
        .map((m) => ({ role: m.role, content: m.role === 'assistant' ? m.raw : m.text }));

      // Same rating history Mapr Picks reads (myReviews/savedInterests) --
      // this chat should never have to say "I don't have any record of
      // your interests" when Profile clearly does.
      const reviews = Object.values(myReviews)
        .filter((r) => r.ratingTier)
        .map((r) => ({
          name: r.landmarkName,
          tier: r.ratingTier,
          categories: r.categories || [],
          highlights: r.highlights || [],
          // Folds in loveNotes -- the "why do you love this place" answers
          // from repeat visits -- alongside the rating's own comment.
          comment: [r.comment, ...(r.loveNotes || [])].filter(Boolean).join('. '),
        }));
      // Insider Mode (src/lib/tasteProfile.js): unlocked once Mapr's own
      // leave-one-out predictions are actually confident about this
      // traveler's taste -- see computeTasteConfidence for what "confident"
      // means here. Recomputed per-send rather than read from a stored
      // value, so it's never stale. Includes the taste baseline picks
      // alongside real ratings, same as TasteProfileCard's own score.
      const confidenceInputs = [
        ...reviews,
        ...baselineToSyntheticReviews(myProfile?.tasteBaseline, myProfile?.tasteBaselineCategoryNotes),
        ...votesAsReviews(
          user ? readLocalFeedback(user.uid) : {},
          new Set([...Object.keys(myReviews), ...Object.values(myReviews).map((r) => r.landmarkId)])
        ),
      ];
      const insiderMode = requestFor === 'group' ? false : hasInsiderMode(computeTasteConfidence(confidenceInputs).confidence);
      // Learned per-category scores for the chat's cities (or wherever the
      // traveler is), plus the local clock, so the server can weigh
      // categories by the time a plan is for (tagScores.js TIME_SLOTS).
      const tagRegions = regions.length
        ? regions.map((reg) => reg.id)
        : [pickRegion({ origin: coords, fallbackRegions: [trip.activeRegion] })].filter(Boolean);
      const tagScoreSummary = Object.fromEntries(
        tagRegions
          .slice(0, 3)
          .map((id) => [
            id,
            Object.fromEntries(
              Object.entries(effectiveTagScores(myProfile, id))
                .map(([tag, v]) => [tag, Math.round(v)])
                .filter(([, v]) => v !== 0)
            ),
          ])
          .filter(([, m]) => Object.keys(m).length)
      );
      // Where the traveler is right now, so "near me" works without asking.
      // The town lookup is best-effort and capped at a few seconds.
      const location = coords
        ? {
            lat: Math.round(coords.lat * 1e4) / 1e4,
            lng: Math.round(coords.lng * 1e4) / 1e4,
            accuracy: Math.round(coords.accuracy || 0),
            label: await reverseLocality(coords.lat, coords.lng),
          }
        : null;
      const now = new Date();
      const startedAt = performance.now();
      const data = await fetchJson(`${API_BASE}/api/plan-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          messages: payload,
          regionIds: regions.map((r) => r.id),
          requestFor,
          // A group request sends none of the user's own taste (rating
          // history, interests, intro, tag scores, insider mode).
          ...tasteContextFor(requestFor, {
            reviews,
            interests: trip.savedInterests || [],
            tasteIntro: composeTasteIntro(myProfile),
            insiderMode,
            tagScoreSummary,
          }),
          itineraries: itinerarySummary(trip, tripApi, groupTrips),
          project: activeProject ? { name: activeProject.name, instructions: activeProject.instructions } : null,
          location,
          locationStatus: coords ? 'ok' : geoError ? 'unavailable' : 'pending',
          localNow: {
            day: now.getDay(),
            hour: now.getHours(),
            label: now.toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' }),
          },
        }),
      });
      const generationMs = performance.now() - startedAt;
      // Time-saved tracking (src/lib/timeSaved.js): real generation time for
      // this reply, logged only when it actually produced stops -- a plain
      // back-and-forth reply with no stops didn't save anyone planning time.
      if (user && data.stops?.length) {
        logPlanningEvent(user.uid, { generationMs, stopsCount: data.stops.length }).catch(() => {});
      }

      const stops = data.stops || [];
      // A compact record of what this reply actually said, fed back as this
      // turn's "content" next time so the AI remembers its own picks.
      // Run anything Mapr was asked to do (add to itinerary, rename, ...)
      // as this user, against everything suggested in the chat so far.
      const msgId = `m${Date.now()}`;
      let actionResults = [];
      if (data.actions?.length) {
        const conversationStops = [...history.flatMap((m) => m.stops || []), ...stops];
        registerConversationStops(msgId, conversationStops);
        const results = await runMaprActions(data.actions, {
          trip,
          tripApi,
          groupTrips: user ? await loadGroupTrips() : [],
          user,
          resendVerification,
          ownerName: myUsername || user?.displayName || 'Explorer',
          coords,
          conversationStops,
          onGroupsChanged: loadGroupTrips,
        });
        actionResults = results.map((r, idx) => {
          if (r.undo) registerUndo(`${msgId}:${idx}`, r.undo);
          return { ok: r.ok, text: r.text, link: r.link || null, action: r.action, needsConfirm: !!r.needsConfirm };
        });
      }
      const raw =
        data.reply +
        (stops.length ? `\n(Suggested: ${stops.map((s) => s.name).join(', ')})` : '') +
        (actionResults.length
          ? `\n(Done in the app: ${actionResults
              .map((r) => (r.ok ? r.text : r.needsConfirm ? `waiting for the traveler to confirm: ${r.text}` : `failed: ${r.text}`))
              .join(' ')})`
          : '');
      // Short tappable answers to a clarifying question ("Something new" /
      // "Repeat a favorite") -- tapping one just sends that exact text, the
      // same as typing it, so the traveler never has to type a one-word
      // answer by hand.
      // setId ties this reply's stop cards together for recommendation_log;
      // liveSets (not saved with the chat) is what keeps a chat restored from
      // an earlier session from logging its old cards as shown again.
      const setId = makeSetId(user?.uid);
      requestForSet.current.set(setId, requestFor);
      const reply = { id: msgId, role: 'assistant', text: data.reply, stops, raw, quickReplies: data.quickReplies || [], actionResults, rate: data.rate || null, setId, requestFor };
      let logMeta = null;
      if (onReply) {
        try {
          logMeta = onReply({ text: reply.text, stops, raw, quickReplies: reply.quickReplies, rate: reply.rate }) || null;
        } catch {
          /* caching is best-effort */
        }
      }
      liveSets.current.set(setId, logMeta);
      put((cur) => [...cur, reply]);
      if (data.cost) setTotalCost((c) => c + data.cost);
    } catch (err) {
      // The user's message stays in the thread; this bubble explains what
      // went wrong in plain words and carries the text to resend. A signed-
      // out traveler gets the server's own "Sign in to use the AI features."
      // plus a way to go do that.
      const signIn = err.status === 401 || err.code === 'sign-in-required';
      put((cur) => [
        ...cur,
        {
          role: 'assistant',
          text: friendlyError(err, "Mapr couldn't answer just now. Try again."),
          stops: [],
          error: true,
          retryText: text,
          requestFor,
          signIn,
        },
      ]);
    } finally {
      sendingRef.current.delete(chatId);
      setBusy(false, chatId);
    }
  };

  // Only Plan Your Trip asks "Just me" or "A group" (on its own last step), and
  // its answer arrives here as opts.requestFor. The choice applies to that one
  // request only; retrying a failed turn keeps its earlier answer.
  // Typed messages go straight out (Just me, so your taste is used). Only
  // Plan Your Trip asks "Who is this plan for?", on its own last step, and
  // passes the answer in as opts.requestFor.
  const send = (e, overrideText, opts = {}) => {
    e?.preventDefault();
    return doSend(null, overrideText, opts);
  };

  // Editing an earlier message discards it and everything that followed
  // (the old reply, and any turns after that), then sends the edited text
  // as a fresh turn -- a real "redo from here", not appending a correction
  // onto a thread that still has the old answer sitting in it.
  const editAndResend = async (idx, newText) => {
    const trimmed = newText.trim();
    if (!trimmed || busy) return;
    const truncated = messages.slice(0, idx);
    send(null, trimmed, {
      historyOverride: truncated,
      beforeSend: () => {
        setMessagesFor(activeChat.id, truncated);
        setEditingIndex(null);
        setEditDraft('');
      },
    });
  };

  // Plan Your Trip sits right under Mapr's greeting, so people can either
  // tap it or just ask Mapr a question in the box below.
  const plannerBlock = (
    <>
      {showPlanner ? (
        <TripPlannerCard
          regions={regions}
          onSetRegions={setRegions}
          onToggleRegion={toggleRegion}
          onClearRegions={() => setRegions([])}
          onClose={() => setShowPlanner(false)}
          onPlan={(message, { cachedReply, onReply, logMeta, requestFor } = {}) => {
            setShowPlanner(false);
            if (cachedReply) replayPlan(message, cachedReply, logMeta, requestFor);
            else send(null, message, { onReply, requestFor: normalizeRequestFor(requestFor) });
          }}
        />
      ) : (
        <button type="button" className="btn btn-ghost btn-block" style={{ marginBottom: 12 }} onClick={() => setShowPlanner(true)}>
          {'\u{1F9ED}'} Plan Your Trip
        </button>
      )}
    </>
  );

  return (
    <div className="chatlab">
      <OnboardingBanner />
      <div className="chatlab-header">
        <div className="chatlab-orb" />
        <div className="chatlab-header-text">
          <h1 className="chatlab-title">Mapr</h1>
          <p className="chatlab-tagline">Live trip planning</p>
        </div>
        <div className="chatlab-header-right">
          <div className="chatlab-region" ref={regionBoxRef}>
            <button type="button" className="chatlab-region-pill" onClick={() => setRegionOpen((o) => !o)}>
              {'\u{1F30D}'}{' '}
              {regions.length === 0
                ? 'Any city'
                : regions.length === 1
                ? regions[0].name
                : `${regions[0].name} +${regions.length - 1}`}
            </button>
            {regionOpen && (
              <div className="chatlab-region-popover">
                <MultiRegionSearch
                  selectedIds={regions.map((r) => r.id)}
                  onToggle={toggleRegion}
                  onClearAll={() => setRegions([])}
                  placeholder="Add a city…"
                />
              </div>
            )}
          </div>
          {totalCost > 0 && <span className="chatlab-cost">{'⚡'} ${totalCost.toFixed(4)}</span>}
        </div>
      </div>

      {synced && (
        <div className="mapr-chat-bar">
          <button type="button" className="mapr-chat-bar-btn" aria-label="Your chats" onClick={() => setChatsOpen(true)}>
            {'\u{2630}'}
          </button>
          {renamingTitle !== null ? (
            <form
              className="mapr-chat-bar-title"
              onSubmit={(e) => {
                e.preventDefault();
                renameChat(activeChat.id, renamingTitle).catch(() => {});
                setRenamingTitle(null);
              }}
            >
              <input
                autoFocus
                aria-label="Chat name"
                value={renamingTitle}
                maxLength={80}
                onChange={(e) => setRenamingTitle(e.target.value)}
                onBlur={(e) => e.currentTarget.form.requestSubmit()}
              />
            </form>
          ) : (
            <button
              type="button"
              className="mapr-chat-bar-title"
              title="Rename this chat"
              onClick={() => setRenamingTitle(activeChat.title)}
            >
              {activeProject && <span className="mapr-chat-bar-project">{'\u{1F4C1}'} {activeProject.name} /</span>}
              <span className="mapr-chat-title">{activeChat.title}</span>
              <span aria-hidden="true">{'\u{270F}\u{FE0F}'}</span>
            </button>
          )}
          <button
            type="button"
            className="mapr-chat-bar-btn"
            aria-label="New chat"
            title="New chat"
            onClick={() => newChat(activeChat.projectId)}
          >
            {'\u{2795}'}
          </button>
        </div>
      )}
      {chatsOpen && <MaprChatsPanel onClose={() => setChatsOpen(false)} />}

      {showTasteNudge && <TasteNudgeCard onDone={dismissNudge} onDismiss={dismissNudge} />}

      <DiscoveryStatsCard />
      <TasteProfileCard />

      <div className="chatlab-feed">
        {restored && messages.length > 1 && (
          <p className="draft-restored-note">
            Picked up your last conversation.
            <button type="button" onClick={discardChat}>
              {synced ? 'New chat' : 'Discard'}
            </button>
          </p>
        )}
        {messages.length === 0 && plannerBlock}
        {messages.map((m, i) => (
          <Fragment key={i}>
          <div className={`chatlab-msg ${m.role}`}>
            {m.role === 'assistant' && <div className="chatlab-avatar" />}
            <div className={`chatlab-bubble ${m.error ? 'error' : ''}`}>
              {m.role === 'user' && editingIndex === i ? (
                <form
                  className="chatlab-edit-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    editAndResend(i, editDraft);
                  }}
                >
                  <textarea
                    className="chatlab-edit-input"
                    aria-label="Edit your message"
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        editAndResend(i, editDraft);
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setEditingIndex(null);
                      }
                    }}
                    autoFocus
                    rows={2}
                  />
                  <div className="chatlab-edit-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingIndex(null)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={!editDraft.trim() || busy}>
                      Save & resend
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p>{m.text}</p>
                  {m.role === 'user' && !busy && (
                    <button
                      type="button"
                      className="chatlab-edit-btn"
                      title="Edit and resend this message"
                      onClick={() => {
                        setEditingIndex(i);
                        setEditDraft(m.text);
                      }}
                    >
                      {'\u{270F}\u{FE0F}'} Edit
                    </button>
                  )}
                </>
              )}
              {m.stops?.length > 0 && (
                <div className="chatlab-stops">
                  {m.stops.map((stop, idx) => {
                    // Every card is tappable right away, whether it's a
                    // catalog stop, one Mapr already turned into a real
                    // landmark (createdId/createdRegion), or one still
                    // being turned into one -- tapping it starts/awaits
                    // that creation and opens it the moment it's ready
                    // instead of leaving it dead until some other flow
                    // (Directions -> Use Map -> back) happened to refresh it.
                    const key = stopKey(m.id, idx, stop.name);
                    const creating = creatingKeys.has(key);
                    const id = stop.createdId || stop.id;
                    const catalogLm = !stop.external ? getLandmark(stop.region, stop.id) : null;
                    const lat = stop.lat ?? catalogLm?.lat;
                    const lng = stop.lng ?? catalogLm?.lng;
                    const images = stop.images || catalogLm?.images;
                    const categories = stop.categories || catalogLm?.categories;
                    const distance = coords && Number.isFinite(lat) && Number.isFinite(lng)
                      ? formatDistance(distanceMeters(coords.lat, coords.lng, lat, lng), units)
                      : null;
                    const resolved = !stop.external || !!stop.createdId;
                    const voteRegion = stop.createdRegion || stop.region;
                    // "Not for me" takes the card out of the reply.
                    if (id && pickVotes.removed.has(id)) return null;

                    return (
                      <OnScreen key={`${m.id}-${idx}`} className="chatlab-stop-card" onSeen={() => logStopShown(m, idx, stop)}>
                        <button
                          type="button"
                          className="chatlab-stop-card-main"
                          onClick={() => openStop(m, idx, stop)}
                        >
                          {resolved ? (
                            <LandmarkThumb landmark={{ id, name: stop.name, lat, lng, images, categories, source: stop.source || catalogLm?.source }} size={64} myPhoto={myPhotos[id]?.[0]} />
                          ) : (
                            <div className="chatlab-stop-globe">{creating ? '\u{23F3}' : '\u{1F310}'}</div>
                          )}
                          <div className="chatlab-stop-text">
                            <strong>
                              {stop.name}
                              {!resolved && stop.place ? ` — ${stop.place}` : ''}
                            </strong>
                            {stop.address && <span className="chatlab-stop-address">{'\u{1F4CD}'} {stop.address}</span>}
                            {(distance || creating) && (
                              <span className="chatlab-stop-meta">
                                {creating ? <span>Give me a couple seconds while I set this up…</span> : <span>{distance}</span>}
                              </span>
                            )}
                            <span>{stop.reason}</span>
                            {stop.createFailed && <span className="chatlab-stop-address">Couldn't open this one — tap to try again, or use Directions below.</span>}
                          </div>
                        </button>
                        <div className="chatlab-stop-links" onClick={(e) => e.stopPropagation()}>
                          <DirectionsButton
                            name={stop.name}
                            lat={Number.isFinite(lat) ? lat : undefined}
                            lng={Number.isFinite(lng) ? lng : undefined}
                            query={!Number.isFinite(lat) || !Number.isFinite(lng) ? [stop.name, stop.address || stop.place].filter(Boolean).join(', ') : undefined}
                            near={coords}
                            className="chatlab-stop-link-btn"
                          >
                            Directions
                          </DirectionsButton>
                        </div>
                        {user && resolved && id && voteRegion && (
                          <PickVoteButtons
                            name={stop.name}
                            vote={pickVotes.votes[id]}
                            onVote={(v) =>
                              pickVotes.vote(
                                { id, region: voteRegion, name: stop.name, categories: categories || [] },
                                v,
                                { requestFor: requestForSet.current.get(m.setId) || m.requestFor || null }
                              )
                            }
                            onRetry={() => pickVotes.retry(id)}
                          />
                        )}
                      </OnScreen>
                    );
                  })}
                </div>
              )}
              {m.rate && <MaprRateCard place={m.rate} />}
              {m.error && m.retryText && i === messages.length - 1 && !busy && (
                <div className="chatlab-error-actions">
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => send(null, m.retryText, { retry: true, requestFor: m.requestFor })}>
                    {'\u{1F504}'} Try again
                  </button>
                  {m.signIn && !user && (
                    <Link to="/profile" className="btn btn-sm btn-primary">
                      Sign in
                    </Link>
                  )}
                </div>
              )}
              {/* Only on the latest message, and only while nothing else is
                  in flight -- an older question's quick replies would be
                  answering a turn the conversation has already moved past. */}
              {m.actionResults?.length > 0 && (
                <div className="mapr-actions">
                  {m.actionResults.map((r, idx) => {
                    const key = `${m.id}:${idx}`;
                    const canUndo = r.ok && !r.undone && getUndo(key);
                    if (r.needsConfirm) {
                      return (
                        <div key={key} className="mapr-action confirm">
                          <span>
                            {r.declined ? `\u{1F6AB} Not created: ${r.text}` : `\u{1F4DD} ${r.text}`}
                          </span>
                          {!r.declined && (
                            <span className="mapr-action-buttons">
                              <button
                                type="button"
                                disabled={!!retrying[key]}
                                onClick={() => retryAction(m.id, idx, { allowCreate: true })}
                              >
                                {retrying[key] ? 'Creating…' : 'Create it'}
                              </button>
                              <button type="button" disabled={!!retrying[key]} onClick={() => setActionResult(m.id, idx, { ...r, declined: true })}>
                                No thanks
                              </button>
                            </span>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div key={key} className={`mapr-action ${r.ok ? 'ok' : 'failed'}`}>
                        <span>
                          {r.ok ? (r.undone ? '\u{21A9}\u{FE0F}' : '\u{2705}') : '\u{26A0}\u{FE0F}'} {r.undone ? `Undone: ${r.text}` : r.text}
                        </span>
                        <span className="mapr-action-buttons">
                          {r.ok && r.link && !r.undone && (
                            <button type="button" onClick={() => openLink(r.link)}>
                              Open
                            </button>
                          )}
                          {!r.ok && r.action && (
                            <button type="button" disabled={!!retrying[key]} onClick={() => retryAction(m.id, idx)}>
                              {retrying[key] ? 'Trying…' : 'Try again'}
                            </button>
                          )}
                          {canUndo && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await getUndo(key)();
                                  forgetUndo(key);
                                  markUndone(m.id, idx);
                                } catch (err) {
                                  toast.show(friendlyError(err, "Couldn't undo that. Try again."));
                                }
                              }}
                            >
                              Undo
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {m.quickReplies?.length > 0 && i === messages.length - 1 && !busy && (
                <div className="chatlab-quick-replies">
                  {m.quickReplies.map((qr) => (
                    <button key={qr} type="button" onClick={() => send(null, qr)}>
                      {qr}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {i === 0 && plannerBlock}
          </Fragment>
        ))}
        {busy && (
          <div className="chatlab-msg assistant">
            <div className="chatlab-avatar" />
            <div className="chatlab-bubble chatlab-typing">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}
      </div>

      <div className="action-bar-spacer" />
      {/* After the spacer, so scrolling to the newest message leaves it above the fixed composer. */}
      <div ref={feedEndRef} style={{ scrollMarginBottom: 70 }} />
      <form className="fixed-action-bar chatlab-composer" onSubmit={send}>
        <div className="fixed-action-bar-inner chatlab-composer-inner">
          <input
            type="text"
            name="mapr-message"
            aria-label="Message Mapr"
            enterKeyHint="send"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Tell it what you're up for…"
            maxLength={500}
            autoComplete="off"
            autoCapitalize="off"
          />
          <button type="submit" className="chatlab-send" disabled={busy || !draft.trim()} aria-label="Send">
            {'\u{27A4}'}
          </button>
        </div>
      </form>
    </div>
  );
}

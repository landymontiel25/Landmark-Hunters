import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { useShownLogger } from '../lib/useShownLogger';
import { makeSetId } from '../lib/setId';
import OnScreen from './OnScreen';
import { useGeo } from '../lib/GeoContext';
import { useBadges } from '../lib/BadgesContext';
import { usePersistentState } from '../lib/usePersistentState';
import { pickRegion } from '../lib/tagScores';
import { getRegion } from '../data/regions';
import { isRateable, isVisitedReview } from '../lib/ratingFlow';
import { getPickFeedback, readLocalFeedback, votedIds } from '../lib/pickFeedback';
import { usePickVotes } from '../lib/usePickVotes';
import { closeSoloToday } from '../lib/soloStreaks';
import { PICKS_STREAK_THRESHOLD, dayKey } from '../lib/streaks';
import PickVoteButtons from './PickVoteButtons';
import RegionSearch from './RegionSearch';
import RateLandmarkSearch from './RateLandmarkSearch';
import MaprPickImage from './MaprPickImage';
import { loadMaprModels } from '../lib/maprRank/modelStore.js';
import { readSeen } from '../lib/maprRank/seenHistory.js';
import { rankPlaces, loggable } from '../lib/maprRank/surfaces.js';
import { seededRandom } from '../lib/maprRank/experiments.js';

// "Mapr Travel Picks": city-first curation, not AI-suggested picks. Step 1
// is choosing a city (defaults to wherever `pickRegion` thinks you are);
// step 2 is swiping that city's rateable landmarks. Capped at RESERVE on
// screen at once so the row never turns into a full city directory.
// Mapr orders them (maprRank/surfaces.js rankPlaces: taste, distance when
// you are in that city, similar places, the model once switched on, and
// exploration slots), with catalog popularity as the tie-break.
//
// Voting is the same three buttons every Mapr pick has (PickVoteButtons.jsx):
// a tap is saved to pick_feedback FIRST and the card changes only once that
// write lands (usePickVotes / pickFeedback.js). "Not for me" takes the card
// out of the row; "I'd go" and "Not sure" keep it, shown as selected, and you
// can tap another button to change your mind. It's a taste signal, not a
// review: "I'd go" and "Not for me" nudge that city's tag scores; "Not sure"
// carries no signal. On a later visit a place you answered "I'd go" or "Not
// for me" is not offered again, and a "Not sure" one comes back after
// UNSURE_SNOOZE_MS (pickFeedback.js votedIds). Rating a landmark for real
// (with a comment, feeding the public review average) is still what
// "+ Rate a Landmark" is for.
//
// The "guess what your partner would pick" step from the dual-streak spec
// isn't built yet -- there's no pairing system for it to attach to. This is
// the "no partner: still rate cards for Mapr data, no streak, no guess"
// path the spec describes for everyone until pairing ships.
const RESERVE = 10;

export default function MaprPicksCarousel({ reviews = [], checkedInIds = [], regionIds = [] }) {
  const { user } = useAuth();
  const { myProfile } = useFriends();
  const { coords } = useGeo();
  const { reload: reloadBadges } = useBadges();
  const navigate = useNavigate();
  const [active, setActive] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  // { [landmarkId]: { verdict, at } } as of opening the row: what was already
  // answered on earlier visits (the device copy, then the database's).
  const [feedback, setFeedback] = useState(() => (user ? readLocalFeedback(user.uid) : {}));
  // Cards tapped during this visit stay put (selected) until "Not for me".
  const [touched, setTouched] = useState(() => new Set());

  const origin = coords ? { lat: coords.lat, lng: coords.lng } : null;
  const [cityOverride, setCityOverride] = usePersistentState(user ? `mapr-travel-picks-city.${user.uid}` : null, null);
  // Most-recently-active city first, so switching cities on Itinerary/Group
  // Trip is reflected here even before a fresh GPS fix comes in.
  const defaultRegionId = pickRegion({ origin, fallbackRegions: [...regionIds].reverse() });
  const regionId = cityOverride || defaultRegionId;
  const { votes, removed, answeredIds, vote: saveVote, retry } = usePickVotes({ uid: user?.uid, origin, onSaved: () => reloadBadges(), removeOnAnyVote: true });
  const region = regionId ? getRegion(regionId) : null;
  // Landmarks answered today: earlier answers from today (the database copy,
  // with their time) plus the ones saved during this visit, so the counter
  // moves the moment a save lands, with no reload. The badges count (votes
  // and 0-point ratings from everywhere) can only raise it.
  const { actionsToday = 0 } = useBadges();
  const answeredToday = useMemo(() => {
    const today = dayKey(new Date());
    const ids = new Set(answeredIds);
    for (const [id, f] of Object.entries(feedback || {})) {
      if (f?.at && dayKey(new Date(f.at)) === today) ids.add(id);
    }
    return ids.size;
  }, [feedback, answeredIds]);
  const countToday = Math.max(answeredToday, actionsToday);
  const dayDone = countToday >= PICKS_STREAK_THRESHOLD;
  // The moment today's quota is met, tell the server so the streak day
  // closes now (and the Profile warning flips) instead of after a reload.
  const closedFor = useRef(null);
  // 'ok' once the server confirms the day is secured; otherwise the reason it
  // is not, shown under the title so a failure is never silent.
  const [closeState, setCloseState] = useState({ status: 'idle', message: '' });
  const closeDay = () => {
    setCloseState({ status: 'saving', message: '' });
    return closeSoloToday()
      .then((r) => {
        if (r?.ok && r.closed) {
          setCloseState({ status: 'ok', message: '' });
          reloadBadges();
          return;
        }
        console.error('[streak] day was not secured:', JSON.stringify(r));
        setCloseState({
          status: 'failed',
          message:
            r?.error ||
            (Number.isFinite(r?.counted)
              ? `The server counted ${r.counted} of ${r.needed ?? 3} landmarks answered today${r.window === 'no-timezone' ? ' (no timezone sent)' : ''}.`
              : r?.reason === 'no-city'
              ? 'Your streak has no city yet.'
              : "The server didn't count today's answers yet."),
        });
      })
      .catch((e) => {
        console.error('[streak] could not reach the server:', e);
        setCloseState({ status: 'failed', message: "Couldn't reach the server." });
      });
  };
  useEffect(() => {
    if (!dayDone || !user?.uid) return;
    const key = `${user.uid}:${dayKey(new Date())}`;
    if (closedFor.current === key) return;
    closedFor.current = key;
    closeDay();
  }, [dayDone, user?.uid]);

  // Each card is logged as shown (with a hidden guess) when it scrolls into
  // view, one set per city row, so a vote on it counts toward the taste score
  // and the match rate like any other Mapr pick.
  const setId = useMemo(() => (user?.uid ? makeSetId(user.uid) : null), [user?.uid, regionId]);
  const logShown = useShownLogger({ uid: user?.uid, profile: myProfile, surface: 'travel-picks', source: 'travel-picks' });

  // Mapr Phase 1 models for this city (null until loaded; ranking works without).
  const [models, setModels] = useState(null);
  useEffect(() => {
    if (!user?.uid || !regionId) return undefined;
    let cancelled = false;
    loadMaprModels({ uid: user.uid, regions: [regionId] })
      .then((m) => !cancelled && setModels(m))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.uid, regionId]);
  const myReviews = useMemo(() => Object.fromEntries(reviews.filter((r) => r?.landmarkId).map((r) => [r.landmarkId, r])), [reviews]);
  const lat = coords?.lat != null ? Math.round(coords.lat * 100) / 100 : null;
  const lng = coords?.lng != null ? Math.round(coords.lng * 100) / 100 : null;
  // Ranked once per city, models and taste; votes during this visit only
  // remove cards (below), so the row doesn't reshuffle under your thumb.
  const ranked = useMemo(() => {
    if (!region || !user?.uid) return [];
    const places = region.landmarks
      .map((l) => ({ ...l, regionId: region.id }))
      .filter((l) => isRateable(l))
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0) || a.name.localeCompare(b.name));
    return rankPlaces({
      places,
      uid: user.uid,
      profile: myProfile,
      myReviews,
      origin: lat != null ? { lat, lng } : null,
      models,
      visitedIds: checkedInIds,
      count: places.length,
      explore: { createdAtMs: myProfile?.createdAt?.seconds != null ? myProfile.createdAt.seconds * 1000 : null, shown: readSeen(user.uid), votes: feedback, serverStagnating: models?.serverStagnating === true },
      rng: seededRandom(`${user.uid}|${region.id}|${setId}`),
    }).picks;
  }, [region, user?.uid, myProfile, myReviews, lat, lng, models, checkedInIds, setId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reconciles with Firestore feedback (a vote made on another device) once,
  // on top of the instant localStorage copy above.
  useEffect(() => {
    if (!user) return;
    getPickFeedback(user.uid)
      .then((fb) => setFeedback((cur) => ({ ...fb, ...cur })))
      .catch(() => {});
  }, [user?.uid]);

  if (!user) return null;

  // A landmark already rated, already checked into (even unrated), or
  // already voted ✓/✗/🤷 here has nothing left to teach Mapr right now --
  // rate it for real from its own page instead.
  // Rated without a visit still counts as somewhere new to go (the rating
  // itself keeps teaching the taste model above).
  const reviewedIds = new Set(reviews.filter(isVisitedReview).map((r) => r.landmarkId).filter(Boolean));
  const excludeIds = new Set([...checkedInIds, ...reviewedIds, ...votedIds(feedback).filter((id) => !touched.has(id)), ...removed]);
  const landmarks = ranked.filter((l) => !excludeIds.has(l.id)).slice(0, RESERVE);

  // Saved to the database first (usePickVotes); the card reacts to the
  // result. onSaved refreshes actionsToday the moment a day's Nth vote lands,
  // so a dual streak's day-close sync (PairStreakContext.jsx) doesn't wait
  // for something else to trigger a reload.
  const vote = (landmark, verdict) => {
    setTouched((cur) => new Set(cur).add(landmark.id));
    saveVote({ id: landmark.id, region: landmark.regionId, name: landmark.name, categories: landmark.categories || [] }, verdict);
  };

  // Which card is in view, for the dots -- offset by one slot since the "+
  // Rate a Landmark" card sits before the real picks in the track.
  const onScroll = (e) => {
    const el = e.currentTarget;
    if (!el.firstElementChild) return;
    const w = el.firstElementChild.getBoundingClientRect().width + 10;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    const count = el.querySelectorAll('[data-pick-key]').length;
    setActive(atEnd ? Math.max(0, count - 1) : Math.max(0, Math.round(el.scrollLeft / w) - 1));
  };

  return (
    <div className="mapr-picks">
      <div className="taste-card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span>
          {'\u{1F5FA}\u{FE0F}'} Mapr Travel Picks{' '}
          <span
            className={`pick-day-counter${dayDone ? ' done' : ''}`}
            role="status"
            aria-live="polite"
            aria-label={`${Math.min(countToday, PICKS_STREAK_THRESHOLD)} of ${PICKS_STREAK_THRESHOLD} landmarks answered today${dayDone ? ', done' : ''}`}
          >
            {dayDone ? '\u2713 ' : ''}
            {Math.min(countToday, PICKS_STREAK_THRESHOLD)}/{PICKS_STREAK_THRESHOLD} today
          </span>
        </span>
        <button
          type="button"
          className="tag"
          style={{ fontSize: '0.68rem', cursor: 'pointer', fontFamily: 'inherit', appearance: 'none' }}
          onClick={() => setPickerOpen(true)}
        >
          {region ? region.name : 'Choose a city'}
        </button>
      </div>
      {dayDone && closeState.status === 'failed' && (
        <p className="tag tag-error" role="alert" style={{ display: 'block', whiteSpace: 'normal', margin: '0 0 10px' }}>
          Couldn&apos;t save today&apos;s streak: {closeState.message}{' '}
          <button type="button" className="chat-wizard-link" style={{ minHeight: 44 }} onClick={closeDay}>
            Try again
          </button>
        </p>
      )}
      <p className="taste-card-note" style={{ margin: '0 0 10px' }}>
        {region
          ? `Swipe through ${region.name} and say whether you'd go. Tap a card to see more.`
          : 'Pick a city to start voting on landmarks there.'}
      </p>
      <div className="mapr-picks-track" onScroll={onScroll}>
        <RateLandmarkSearch />
        {landmarks.map((l, i) => (
          <OnScreen
            key={`${l.regionId}/${l.id}`}
            className="mapr-pick"
            data-pick-key={`${l.regionId}/${l.id}`}
            onSeen={() =>
              logShown(setId, [loggable(l, i + 1)])
            }
          >
            <button type="button" className="mapr-pick-main" onClick={() => navigate(`/landmarks/${l.regionId}/${l.id}`)}>
              <MaprPickImage landmark={l} />
              <span className="mapr-pick-name">{l.name}</span>
              <span className="mapr-pick-sub">{(l.summary || '').split(/(?<=[.!?])\s/)[0]}</span>
            </button>
            <PickVoteButtons name={l.name} vote={votes[l.id]} onVote={(v) => vote(l, v)} onRetry={() => retry(l.id)} />
          </OnScreen>
        ))}
        {region && landmarks.length === 0 && (
          <p className="taste-card-note" style={{ margin: '10px 0 0' }}>
            You've voted on everything Mapr has for {region.name} so far -- check back later or pick another city.
          </p>
        )}
      </div>
      {landmarks.length > 1 && (
        <div className="mapr-picks-dots" aria-hidden="true">
          {landmarks.map((l, i) => (
            <span key={l.id} className={`mapr-picks-dot ${i === active ? 'active' : ''}`} />
          ))}
        </div>
      )}
      {pickerOpen &&
        createPortal(
          <div className="modal-backdrop" onClick={() => setPickerOpen(false)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <h3 style={{ marginTop: 0 }}>{'\u{1F5FA}\u{FE0F}'} Choose a City</h3>
              <p className="screen-subtitle" style={{ marginTop: 0 }}>
                Mapr Travel Picks defaults to where you are right now -- pick another city to rate ahead of a trip.
              </p>
              <RegionSearch
                region={region}
                onSelect={(r) => {
                  setCityOverride(r.id);
                  setPickerOpen(false);
                }}
                placeholder="Search for a city…"
              />
              <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 16 }} onClick={() => setPickerOpen(false)}>
                Done
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useGeo } from '../lib/GeoContext';
import { useBadges } from '../lib/BadgesContext';
import { usePersistentState } from '../lib/usePersistentState';
import { pickRegion } from '../lib/tagScores';
import { getRegion } from '../data/regions';
import { isRateable } from '../lib/ratingFlow';
import { getPickFeedback, readLocalFeedback, votedIds, setPickFeedback } from '../lib/pickFeedback';
import RegionSearch from './RegionSearch';
import RateLandmarkSearch from './RateLandmarkSearch';

// "Mapr Travel Picks": city-first curation, not AI-suggested picks. Step 1
// is choosing a city (defaults to wherever `pickRegion` thinks you are);
// step 2 is swiping that city's rateable landmarks. Capped at RESERVE on
// screen at once so the row never turns into a full city directory.
//
// Voting is the exact same lightweight mechanic the original Mapr Picks
// carousel used (see pickFeedback.js) -- a tap saves a ✓/✗/🤷 verdict
// straight to pick_feedback and moves on, no check-in, no modal, nothing to
// post. It's a taste signal, not a review: "I'd go" and "Not for me" nudge
// that city's tag scores and rule the landmark out for good; "Not sure"
// carries no signal and just snoozes it for a week. Rating a landmark for
// real (with a comment, feeding the public review average) is still what
// "+ Rate a Landmark" is for.
//
// The "guess what your partner would pick" step from the dual-streak spec
// isn't built yet -- there's no pairing system for it to attach to. This is
// the "no partner: still rate cards for Mapr data, no streak, no guess"
// path the spec describes for everyone until pairing ships.
const RESERVE = 10;

const VOTE_COPY = {
  yes: { cls: 'love', emoji: '\u{2713}', label: "I'd go" },
  unsure: { cls: 'unsure', emoji: '\u{1F937}', label: 'Not sure' },
  no: { cls: 'hate', emoji: '\u{2715}', label: 'Not for me' },
};

export default function MaprPicksCarousel({ reviews = [], checkedInIds = [], regionIds = [] }) {
  const { user } = useAuth();
  const { coords } = useGeo();
  const { reload: reloadBadges } = useBadges();
  const navigate = useNavigate();
  const [active, setActive] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  // { [landmarkId]: 'yes' | 'no' | 'unsure' } -- instant local copy so a vote
  // pulls its card out of the row right away, without waiting on a Firestore
  // round trip or on checkedInIds/reviews (a vote is neither) to catch up.
  const [feedback, setFeedback] = useState(() => (user ? readLocalFeedback(user.uid) : {}));

  const origin = coords ? { lat: coords.lat, lng: coords.lng } : null;
  const [cityOverride, setCityOverride] = usePersistentState(user ? `mapr-travel-picks-city.${user.uid}` : null, null);
  // Most-recently-active city first, so switching cities on Itinerary/Group
  // Trip is reflected here even before a fresh GPS fix comes in.
  const defaultRegionId = pickRegion({ origin, fallbackRegions: [...regionIds].reverse() });
  const regionId = cityOverride || defaultRegionId;
  const region = regionId ? getRegion(regionId) : null;

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
  const reviewedIds = new Set(reviews.map((r) => r.landmarkId).filter(Boolean));
  const excludeIds = new Set([...checkedInIds, ...reviewedIds, ...votedIds(feedback)]);
  const landmarks = region
    ? region.landmarks
        .map((l) => ({ ...l, regionId: region.id }))
        .filter((l) => isRateable(l) && !excludeIds.has(l.id))
        .sort((a, b) => (b.popularity || 0) - (a.popularity || 0) || a.name.localeCompare(b.name))
        .slice(0, RESERVE)
    : [];

  // Same lightweight vote every Mapr Pick has always used -- see the note at
  // the top of this file. No check-in, no modal; the card just leaves the row.
  const vote = (landmark, verdict) => {
    setPickFeedback({
      uid: user.uid,
      landmark: { id: landmark.id, region: landmark.regionId, name: landmark.name, categories: landmark.categories || [] },
      verdict,
      origin,
    });
    setFeedback((cur) => ({ ...cur, [landmark.id]: { landmarkId: landmark.id, verdict, at: Date.now() } }));
    // Refreshes actionsToday the moment a day's Nth vote lands, so a dual
    // streak's day-close sync (PairStreakContext.jsx) doesn't wait for
    // something else to happen to trigger a reload.
    reloadBadges();
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
        <span>{'\u{1F5FA}\u{FE0F}'} Mapr Travel Picks</span>
        <button
          type="button"
          className="tag"
          style={{ fontSize: '0.68rem', cursor: 'pointer', fontFamily: 'inherit', appearance: 'none' }}
          onClick={() => setPickerOpen(true)}
        >
          {region ? region.name : 'Choose a city'}
        </button>
      </div>
      <p className="taste-card-note" style={{ margin: '0 0 10px' }}>
        {region
          ? `Swipe through ${region.name} and say whether you'd go. Tap a card to see more.`
          : 'Pick a city to start voting on landmarks there.'}
      </p>
      <div className="mapr-picks-track" onScroll={onScroll}>
        <RateLandmarkSearch />
        {landmarks.map((l) => (
          <div key={`${l.regionId}/${l.id}`} className="mapr-pick" data-pick-key={`${l.regionId}/${l.id}`}>
            <button type="button" className="mapr-pick-main" onClick={() => navigate(`/landmarks/${l.regionId}/${l.id}`)}>
              {l.images?.[0] ? (
                <img className="mapr-pick-img" src={l.images[0]} alt="" loading="lazy" />
              ) : (
                <div className="mapr-pick-img mapr-pick-img-blank">{'\u{1F4CD}'}</div>
              )}
              <span className="mapr-pick-name">{l.name}</span>
              <span className="mapr-pick-sub">{(l.summary || '').split(/(?<=[.!?])\s/)[0]}</span>
            </button>
            <div className="mapr-pick-actions">
              {['no', 'unsure', 'yes'].map((verdict) => {
                const copy = VOTE_COPY[verdict];
                return (
                  <button
                    key={verdict}
                    type="button"
                    className={`mapr-pick-vote ${copy.cls}`}
                    onClick={() => vote(l, verdict)}
                    title={copy.label}
                  >
                    {copy.emoji} {copy.label}
                  </button>
                );
              })}
            </div>
          </div>
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

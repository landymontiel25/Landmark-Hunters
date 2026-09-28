import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useGeo } from '../lib/GeoContext';
import { useCheckIn } from '../lib/useCheckIn';
import { usePersistentState } from '../lib/usePersistentState';
import { pickRegion } from '../lib/tagScores';
import { getRegion } from '../data/regions';
import { isRateable, TIERS } from '../lib/ratingFlow';
import RegionSearch from './RegionSearch';
import RateLandmarkSearch from './RateLandmarkSearch';

// "Mapr Travel Picks": city-first curation, not AI-suggested picks. Step 1
// is choosing a city (defaults to wherever `pickRegion` thinks you are);
// step 2 is swiping that city's rateable landmarks and rating them with the
// app's existing three-tier system (TIERS, ratingFlow.js). Capped at RESERVE
// on screen at once so the row never turns into a full city directory.
//
// Rating a card reuses the same checkIn(landmark, { ratingOnly: true })
// pipeline as "Rate a Landmark" -- it opens the global rate-and-post prompt
// (CheckInReview -> RatingFlow) pre-seeded on the tapped tier via
// initialTier, instead of writing a review directly. That keeps every
// rating -- from here, from Rate a Landmark, or from a real visit -- going
// through one write path with one set of rules.
//
// The "guess what your partner would pick" step from the dual-streak spec
// isn't built yet -- there's no pairing system for it to attach to. This is
// the "no partner: still rate cards for Mapr data, no streak, no guess"
// path the spec describes for everyone until pairing ships.
const RESERVE = 10;

const TIER_CLASS = {
  'highly-recommend': 'love',
  'worth-trying': 'unsure',
  'probably-skip': 'hate',
};

export default function MaprPicksCarousel({ reviews = [], checkedInIds = [], regionIds = [] }) {
  const { user } = useAuth();
  const { coords } = useGeo();
  const { checkIn } = useCheckIn();
  const navigate = useNavigate();
  const [active, setActive] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);

  const origin = coords ? { lat: coords.lat, lng: coords.lng } : null;
  const [cityOverride, setCityOverride] = usePersistentState(user ? `mapr-travel-picks-city.${user.uid}` : null, null);
  // Most-recently-active city first, so switching cities on Itinerary/Group
  // Trip is reflected here even before a fresh GPS fix comes in.
  const defaultRegionId = pickRegion({ origin, fallbackRegions: [...regionIds].reverse() });
  const regionId = cityOverride || defaultRegionId;
  const region = regionId ? getRegion(regionId) : null;

  if (!user) return null;

  // A landmark already rated OR already checked into (even unrated) has
  // nothing left to teach Mapr here -- rate it from its own page instead.
  const reviewedIds = new Set(reviews.map((r) => r.landmarkId).filter(Boolean));
  const excludeIds = new Set([...checkedInIds, ...reviewedIds]);
  const landmarks = region
    ? region.landmarks
        .map((l) => ({ ...l, regionId: region.id }))
        .filter((l) => isRateable(l) && !excludeIds.has(l.id))
        .sort((a, b) => (b.popularity || 0) - (a.popularity || 0) || a.name.localeCompare(b.name))
        .slice(0, RESERVE)
    : [];

  const rate = (landmark, tier) => checkIn(landmark, { ratingOnly: true, initialTier: tier.id });

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
          ? `Swipe through ${region.name} and rate whatever you already have an opinion on. Tap a card to see more.`
          : 'Pick a city to start rating landmarks there.'}
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
              {TIERS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`mapr-pick-vote ${TIER_CLASS[t.id]}`}
                  onClick={() => rate(l, t)}
                  title={t.label}
                >
                  {t.emoji} {t.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        {region && landmarks.length === 0 && (
          <p className="taste-card-note" style={{ margin: '10px 0 0' }}>
            You've rated everything Mapr has for {region.name} so far -- check back later or pick another city.
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

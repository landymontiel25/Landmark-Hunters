import { useMemo, useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { ALL_LANDMARKS, getRegion } from '../data/regions';
import { usePlacePacksVersion } from '../lib/placePacks';
import LandmarkThumb from '../components/LandmarkThumb';
import DirectionsButton from '../components/DirectionsButton';
import {
  MAX_STORE_RATINGS,
  STORE_RATING_TAGS,
  applyStoreVote,
  isMallPlace,
  makeStoreRating,
  mallForItinerary,
  mallScore,
  ratingQueue,
  storesByVisits,
  storesOfPlace,
  topTags,
} from '../lib/malls';
import { runMallChecks } from '../lib/mallChecks';
import { matchesSearch } from '../lib/search';

// Test tab: checking in at a mall the way a user would. The map looks like
// the real Map but its only pins are the app's malls (lib/malls.js
// isMallPlace). Tap one, press Check In (no location needed here), then:
//   1. "Which stores did you go into?" (most visited first; or "Just walked around")
//   2. For each store picked (4 at most): thumbs up or down, then "What did
//      you like about it?" (optional tags)
//   3. "What do you like about <mall>?" (optional tags, a note)
//   4. A summary: the ratings, what Mapr learned, the mall's score.
// A mall with no store list yet goes straight to step 3. Everything is kept
// on this device (localStorage), apart from the real account.
const RATINGS_KEY = 'mallLab.ratings.v1';
const MALL_NOTES_KEY = 'mallLab.mallNotes.v1';
const tasteKey = (uid) => `mallLab.taste.v1.${uid || 'guest'}`;
const EMPTY_TASTE = { scores: {}, at: {}, counts: {} };
const MALL_TAGS = ['lots of stores', 'good food court', 'easy parking', 'clean', 'good deals', 'family friendly', 'nice outdoor areas'];

const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
// The real Map's pin (MapExplore pinIcon), so this map looks the same.
const MALL_PIN = L.divIcon({
  className: '',
  html: '<div class="map-pin-wrap"><div class="map-pin"></div></div>',
  iconSize: [22, 26],
  iconAnchor: [10, 24],
  popupAnchor: [0, -28],
});

const read = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: the lab still works for this visit */
  }
};

// Every mall in the app, and its stores as places pointing back to it. A mall
// added to the app shows up here by itself.
function useMalls() {
  const packsVersion = usePlacePacksVersion();
  return useMemo(() => {
    const malls = [];
    const stores = [];
    for (const l of ALL_LANDMARKS) {
      if (!isMallPlace(l) || !Number.isFinite(l.lat)) continue;
      const mine = storesOfPlace(l.regionId, l.id);
      malls.push({ ...l, key: `${l.regionId}/${l.id}`, storeCount: mine.length });
      stores.push(...mine);
    }
    return { malls, stores };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- packsVersion: imported malls arrive with the place packs
  }, [packsVersion]);
}

export default function MallLab({ uid }) {
  const { malls, stores: allStores } = useMalls();
  const [ratings, setRatings] = useState(() => read(RATINGS_KEY, []));
  const [mallNotes, setMallNotes] = useState(() => read(MALL_NOTES_KEY, []));
  const [taste, setTaste] = useState(() => read(tasteKey(uid), EMPTY_TASTE));
  const [checks, setChecks] = useState(null);
  // The visit in progress, or null: { mall, step: 'stores' | 'store' | 'mall' | 'done', ... }
  const [visit, setVisit] = useState(null);

  // Every store with this device's visits (ratings) counted, for "most visited first".
  const places = useMemo(
    () => allStores.map((p) => ({ ...p, visits: (p.visits || 0) + ratings.filter((r) => r.storeId === p.id).length })),
    [ratings, allStores]
  );

  const checkIn = (mall) =>
    setVisit({
      mall,
      step: mall.storeCount ? 'stores' : 'mall',
      checked: [],
      search: '',
      queue: [],
      card: 0,
      vote: null,
      tags: [],
      log: [],
      mallTags: [],
      note: '',
      tasteBefore: taste.scores,
    });
  const patch = (p) => setVisit((v) => ({ ...v, ...p }));
  const close = () => setVisit(null);

  const saveStore = () => {
    const store = visit.queue[visit.card];
    const rating = makeStoreRating({ userId: uid || 'guest', store, vote: visit.vote, tags: visit.tags });
    const nextRatings = [...ratings, rating];
    const nextTaste = applyStoreVote(taste, store, visit.vote);
    setRatings(nextRatings);
    write(RATINGS_KEY, nextRatings);
    setTaste(nextTaste);
    write(tasteKey(uid), nextTaste);
    const log = [...visit.log, { store, vote: visit.vote, tags: visit.tags }];
    if (visit.card + 1 < visit.queue.length) patch({ log, card: visit.card + 1, vote: null, tags: [] });
    else patch({ log, step: 'mall' });
  };
  const saveMall = () => {
    const entry = { userId: uid || 'guest', mallKey: visit.mall.key, tags: visit.mallTags, note: visit.note.trim(), date: new Date().toISOString() };
    const next = [...mallNotes, entry];
    setMallNotes(next);
    write(MALL_NOTES_KEY, next);
    patch({ step: 'done' });
  };
  const reset = () => {
    setRatings([]);
    setMallNotes([]);
    setTaste(EMPTY_TASTE);
    write(RATINGS_KEY, []);
    write(MALL_NOTES_KEY, []);
    write(tasteKey(uid), EMPTY_TASTE);
  };

  const toggleIn = (list, x) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

  return (
    <div className="mall-lab">
      <div className="mall-lab-map mall-lab-map-full">
        {malls.length > 0 ? (
          <MapContainer bounds={malls.map((m) => [m.lat, m.lng])} boundsOptions={{ padding: [50, 50] }} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
            <TileLayer url={IMAGERY} attribution="&copy; Esri, Maxar, Earthstar Geographics" />
            <TileLayer url={LABELS} attribution="&copy; Esri" zIndex={650} />
            {malls.map((m) => (
              <Marker key={m.key} position={[m.lat, m.lng]} icon={MALL_PIN} title={m.name} alt={m.name}>
                <Popup>
                  <div className="map-popup">
                    <LandmarkThumb landmark={m} width={228} height={110} />
                    <h4 style={{ margin: '8px 0 0' }}>{m.name}</h4>
                    <p style={{ margin: '2px 0 8px', fontSize: '0.72rem', color: 'var(--color-parchment-dim)' }}>
                      {getRegion(m.regionId)?.name} · Mall{m.storeCount ? ` · ${m.storeCount} stores` : ''}
                    </p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => checkIn(m)}>
                        {'\u{1F4CD}'} Check In
                      </button>
                      <DirectionsButton name={m.name} lat={m.lat} lng={m.lng} className="btn btn-ghost btn-sm">
                        Directions
                      </DirectionsButton>
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        ) : (
          <p className="mall-lab-dim" style={{ padding: 16 }}>
            Loading malls…
          </p>
        )}
      </div>
      <p className="mall-lab-dim" style={{ margin: '8px 2px 12px' }}>
        {'\u{1F9EA}'} Test map: only malls. Tap one and press Check In (no location needed here). Ratings stay on this device.
      </p>

      {visit && (
        <div className="modal-backdrop" onClick={close}>
          <div className="modal-card mall-visit" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Check-in at ${visit.mall.name}`}>
            {visit.step === 'stores' && (
              <StoresStep
                visit={visit}
                stores={storesByVisits(visit.mall.key, places)}
                onSearch={(search) => patch({ search })}
                onToggle={(id) => patch({ checked: toggleIn(visit.checked, id) })}
                onSkip={() => patch({ step: 'mall' })}
                onNext={() => patch({ step: 'store', queue: ratingQueue(visit.checked, places), card: 0, vote: null, tags: [] })}
              />
            )}
            {visit.step === 'store' && visit.queue[visit.card] && (
              <div>
                <p className="mall-lab-dim" style={{ marginTop: 0 }}>
                  {visit.mall.name} · store {visit.card + 1} of {visit.queue.length}
                </p>
                <h3 style={{ margin: '0 0 12px' }}>How was {visit.queue[visit.card].name}?</h3>
                <div className="mall-lab-votes">
                  <button
                    type="button"
                    className={`btn mall-lab-vote ${visit.vote === 'down' ? 'btn-primary' : 'btn-ghost'}`}
                    aria-pressed={visit.vote === 'down'}
                    onClick={() => patch({ vote: 'down' })}
                  >
                    {'\u{1F44E}'} <span>Not for me</span>
                  </button>
                  <button
                    type="button"
                    className={`btn mall-lab-vote ${visit.vote === 'up' ? 'btn-primary' : 'btn-ghost'}`}
                    aria-pressed={visit.vote === 'up'}
                    onClick={() => patch({ vote: 'up' })}
                  >
                    {'\u{1F44D}'} <span>Liked it</span>
                  </button>
                </div>
                {visit.vote && (
                  <>
                    <p className="rating-flow-label" style={{ margin: '16px 0 6px' }}>
                      {visit.vote === 'up' ? 'What did you like about it?' : 'Anything that stood out?'} <span>optional</span>
                    </p>
                    <div className="mall-lab-tags">
                      {STORE_RATING_TAGS.map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={`tag mall-lab-chip ${visit.tags.includes(t) ? 'on' : ''}`}
                          aria-pressed={visit.tags.includes(t)}
                          onClick={() => patch({ tags: toggleIn(visit.tags, t) })}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <button type="button" className="btn btn-primary btn-block" disabled={!visit.vote} onClick={saveStore}>
                  {visit.card + 1 < visit.queue.length ? 'Next store' : 'Next'}
                </button>
              </div>
            )}
            {visit.step === 'mall' && (
              <div>
                {!visit.mall.storeCount && (
                  <p className="mall-lab-dim" style={{ marginTop: 0 }}>
                    {'\u{1F4CD}'} Checked in at {visit.mall.name}. Its store list isn't in the app yet, so this one is about the mall.
                  </p>
                )}
                <h3 style={{ margin: '0 0 6px' }}>What do you like about {visit.mall.name}?</h3>
                <p className="mall-lab-dim" style={{ marginTop: 0 }}>
                  Optional. Tap any that fit.
                </p>
                <div className="mall-lab-tags">
                  {MALL_TAGS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`tag mall-lab-chip ${visit.mallTags.includes(t) ? 'on' : ''}`}
                      aria-pressed={visit.mallTags.includes(t)}
                      onClick={() => patch({ mallTags: toggleIn(visit.mallTags, t) })}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <textarea
                  className="mall-lab-note"
                  rows={2}
                  maxLength={300}
                  placeholder="In your own words (optional)"
                  value={visit.note}
                  onChange={(e) => patch({ note: e.target.value })}
                />
                <button type="button" className="btn btn-primary btn-block" onClick={saveMall}>
                  Save
                </button>
              </div>
            )}
            {visit.step === 'done' && (
              <DoneStep visit={visit} taste={taste} places={places} ratings={ratings} onClose={close} />
            )}
            {visit.step !== 'done' && (
              <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={close}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      <details className="card section mall-lab-dev">
        <summary>{'\u{2699}\u{FE0F}'} Developer checks</summary>
        <div className="lab-actions" style={{ margin: '10px 0' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChecks(runMallChecks())}>
            {checks ? 'Run again' : 'Run checks'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
            {'\u{21BA}'} Reset test ratings
          </button>
        </div>
        {checks && (
          <ul className="mall-lab-checks">
            {checks.map((c) => (
              <li key={c.name} className={c.pass ? 'pass' : 'fail'}>
                {c.pass ? '\u{2705}' : '\u{274C}'} {c.name}
                <div className="mall-lab-dim">{c.detail}</div>
              </li>
            ))}
          </ul>
        )}
        {checks && (
          <p className="mall-lab-dim" style={{ marginBottom: 0 }}>
            {checks.filter((c) => c.pass).length} of {checks.length} passed (on Palm Grove Plaza, a made-up example, with made-up users).
          </p>
        )}
      </details>
    </div>
  );
}

function StoresStep({ visit, stores, onSearch, onToggle, onSkip, onNext }) {
  const shown = visit.search.trim() ? stores.filter((s) => matchesSearch([s.name, ...s.tags].join(' '), visit.search)) : stores;
  return (
    <div>
      <p className="mall-lab-checked-in">
        {'\u{1F4CD}'} You're checked in at <strong>{visit.mall.name}</strong>
      </p>
      <h3 style={{ margin: '0 0 4px' }}>Which stores did you go into?</h3>
      <p className="mall-lab-dim" style={{ marginTop: 0 }}>
        Tap every one. We'll ask about up to {MAX_STORE_RATINGS}.
      </p>
      {stores.length > 8 && (
        <input
          type="search"
          className="mall-lab-search"
          placeholder={'\u{1F50D} Find a store'}
          value={visit.search}
          onChange={(e) => onSearch(e.target.value)}
          aria-label="Find a store"
        />
      )}
      <div className="mall-lab-store-chips">
        {shown.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`mall-lab-store-chip ${visit.checked.includes(s.id) ? 'on' : ''}`}
            aria-pressed={visit.checked.includes(s.id)}
            onClick={() => onToggle(s.id)}
          >
            <span className="mall-lab-store-name">{s.name}</span>
            <span className="mall-lab-dim">{s.tags.join(', ')}</span>
          </button>
        ))}
        {shown.length === 0 && <p className="mall-lab-dim">No store matches.</p>}
      </div>
      {visit.checked.length > MAX_STORE_RATINGS && (
        <p className="mall-lab-dim">
          {visit.checked.length} picked: we'll ask about the first {MAX_STORE_RATINGS}.
        </p>
      )}
      <div className="mall-lab-visit-actions">
        <button type="button" className="btn btn-ghost" onClick={onSkip}>
          Just walked around
        </button>
        <button type="button" className="btn btn-primary" disabled={!visit.checked.length} onClick={onNext}>
          Next{visit.checked.length ? ` (${Math.min(visit.checked.length, MAX_STORE_RATINGS)})` : ''}
        </button>
      </div>
    </div>
  );
}

function DoneStep({ visit, taste, places, ratings, onClose }) {
  const score = mallScore(visit.mall.key, places, ratings);
  const itinerary = mallForItinerary(visit.mall.key, places, taste.scores);
  const moved = [...new Set(visit.log.flatMap((v) => v.store.tags))].map((t) => ({
    t,
    from: Math.round((visit.tasteBefore[t] || 0) * 10) / 10,
    to: Math.round((taste.scores[t] || 0) * 10) / 10,
  }));
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>{'\u{1F389}'} Thanks! Visit saved</h3>
      {visit.log.length > 0 && (
        <ul className="mall-lab-log">
          {visit.log.map((v) => (
            <li key={v.store.id}>
              {v.vote === 'up' ? '\u{1F44D}' : '\u{1F44E}'} <strong>{v.store.name}</strong>
              {v.tags.length > 0 && <span className="mall-lab-dim"> · {v.tags.join(', ')}</span>}
            </li>
          ))}
        </ul>
      )}
      {visit.mallTags.length > 0 && (
        <p className="mall-lab-dim">
          About {visit.mall.name}: {visit.mallTags.join(', ')}
        </p>
      )}
      {moved.length > 0 && (
        <div className="mall-lab-learned">
          <strong>What Mapr learned</strong>
          <div className="mall-lab-dim">{moved.map((m) => `${m.t} ${m.from} → ${m.to}`).join(' · ')}</div>
          <div className="mall-lab-dim">Your top tags: {topTags(taste.scores).join(', ') || 'none yet'}</div>
        </div>
      )}
      <p className="mall-lab-dim">
        Mall score: {score == null ? 'no store rated yet' : `${Math.round(score * 100)}% thumbs up`} ·{' '}
        {itinerary.include ? itinerary.reason : 'Not in your itinerary yet (needs 2 stores that match your top tags).'}
      </p>
      <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
        Done
      </button>
    </div>
  );
}

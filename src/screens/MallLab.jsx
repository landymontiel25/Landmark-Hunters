import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { ALL_LANDMARKS, getRegion } from '../data/regions';
import { usePlacePacksVersion } from '../lib/placePacks';
import LandmarkThumb from '../components/LandmarkThumb';
import DirectionsButton from '../components/DirectionsButton';
import RatingFlow from '../components/RatingFlow';
import {
  MAX_STORE_RATINGS,
  VOTE_OF_TIER,
  applyStoreVote,
  isMallPlace,
  makeStoreRating,
  mallForItinerary,
  mallScore,
  storesByVisits,
  storesOfPlace,
  topTags,
} from '../lib/malls';
import { runMallChecks } from '../lib/mallChecks';
import { matchesSearch } from '../lib/search';

// Test tab: checking in at a mall the way a user would. The map looks like
// the real Map but its only pins are the app's malls (lib/malls.js
// isMallPlace). Tap one, press Check In (no location needed here), and the
// real check-in sheet opens ("Check in to Dadeland Mall?", the same rating
// questions, Post), with one thing added for a mall: "Which stores did you go
// to?", a dropdown to pick up to 4, each with its own rating. Every check-in
// is its own visit, so you can check in again later and rate other stores.
// Everything is kept on this device (localStorage), apart from the account.
const RATINGS_KEY = 'mallLab.ratings.v1';
const VISITS_KEY = 'mallLab.visits.v1';
const tasteKey = (uid) => `mallLab.taste.v1.${uid || 'guest'}`;
const EMPTY_TASTE = { scores: {}, at: {}, counts: {} };

const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
// The real Map's pin (MapExplore pinIcon) and cluster bubble.
const MALL_PIN = L.divIcon({
  className: '',
  html: '<div class="map-pin-wrap"><div class="map-pin"></div></div>',
  iconSize: [22, 26],
  iconAnchor: [10, 24],
  popupAnchor: [0, -28],
});
const clusterIcon = (cluster) =>
  L.divIcon({ html: `<div class="map-cluster">${cluster.getChildCount()}</div>`, className: '', iconSize: [40, 40] });

// A store as a place the rating questions understand: its kind from its tags
// ("Do you like this clothing store?").
const STORE_KIND = {
  clothing: ['local-life', 'clothing store'],
  shoes: ['local-life', 'shoe store'],
  'department store': ['local-life', 'department store'],
  beauty: ['local-life', 'beauty store'],
  electronics: ['local-life', 'electronics store'],
  books: ['local-life', 'bookstore'],
  home: ['local-life', 'home store'],
  sports: ['local-life', 'sporting goods store'],
  toys: ['local-life', 'toy store'],
  jewelry: ['local-life', 'jewelry store'],
  gifts: ['local-life', 'gift shop'],
  luxury: ['local-life', 'luxury store'],
  pets: ['local-life', 'pet store'],
  pharmacy: ['local-life', 'pharmacy'],
  grocery: ['food', 'grocery store'],
  coffee: ['food', 'coffee shop'],
  cafe: ['food', 'café'],
  food: ['food', 'restaurant'],
  'fast food': ['food', 'fast food restaurant'],
  dessert: ['food', 'dessert shop'],
  entertainment: ['entertainment', 'entertainment venue'],
  fitness: ['sports', 'gym'],
};
const storeAsPlace = (store) => {
  const [category, topic] = STORE_KIND[store.tags[0]] || ['local-life', 'store'];
  return { id: store.id, name: store.name, categories: [category], topic };
};

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

// Opens on the area with the most malls (South Florida today) instead of the
// whole world, where every Miami mall would sit under one pin.
function startBounds(malls) {
  const byRegion = new Map();
  for (const m of malls) byRegion.set(m.regionId, [...(byRegion.get(m.regionId) || []), m]);
  const busiest = [...byRegion.values()].sort((a, b) => b.length - a.length)[0] || malls;
  return busiest.map((m) => [m.lat, m.lng]);
}

export default function MallLab({ uid }) {
  const { malls, stores: allStores } = useMalls();
  const [ratings, setRatings] = useState(() => read(RATINGS_KEY, []));
  const [visits, setVisits] = useState(() => read(VISITS_KEY, []));
  const [taste, setTaste] = useState(() => read(tasteKey(uid), EMPTY_TASTE));
  const [checks, setChecks] = useState(null);
  const [checkingIn, setCheckingIn] = useState(null); // the mall whose sheet is open
  const bounds = useMemo(() => (malls.length ? startBounds(malls) : null), [malls.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every store with this device's ratings counted, for "most visited first".
  const places = useMemo(
    () => allStores.map((p) => ({ ...p, visits: (p.visits || 0) + ratings.filter((r) => r.storeId === p.id).length })),
    [ratings, allStores]
  );

  const post = ({ mall, mallRating, storeRatings }) => {
    const before = taste.scores;
    let nextTaste = taste;
    const saved = storeRatings.map(({ store, rating }) => {
      const vote = VOTE_OF_TIER[rating.tier];
      nextTaste = applyStoreVote(nextTaste, store, vote);
      return makeStoreRating({ userId: uid || 'guest', store, vote, tier: rating.tier, comment: rating.comment, tags: [] });
    });
    const nextRatings = [...ratings, ...saved];
    const visit = { userId: uid || 'guest', mallKey: mall.key, date: new Date().toISOString(), mall: mallRating, stores: saved.map((r) => r.storeId) };
    const nextVisits = [...visits, visit];
    setRatings(nextRatings);
    write(RATINGS_KEY, nextRatings);
    setVisits(nextVisits);
    write(VISITS_KEY, nextVisits);
    setTaste(nextTaste);
    write(tasteKey(uid), nextTaste);
    return { saved, before, after: nextTaste.scores, nextRatings };
  };

  const reset = () => {
    setRatings([]);
    setVisits([]);
    setTaste(EMPTY_TASTE);
    write(RATINGS_KEY, []);
    write(VISITS_KEY, []);
    write(tasteKey(uid), EMPTY_TASTE);
  };

  return (
    <div className="mall-lab">
      <div className="mall-lab-map mall-lab-map-full">
        {bounds ? (
          <MapContainer bounds={bounds} boundsOptions={{ padding: [40, 40] }} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
            <TileLayer url={IMAGERY} attribution="&copy; Esri, Maxar, Earthstar Geographics" />
            <TileLayer url={LABELS} attribution="&copy; Esri" zIndex={650} />
            <MarkerClusterGroup chunkedLoading maxClusterRadius={45} spiderfyOnMaxZoom showCoverageOnHover={false} iconCreateFunction={clusterIcon}>
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
                        <DirectionsButton name={m.name} lat={m.lat} lng={m.lng} className="btn btn-ghost btn-sm">
                          Directions
                        </DirectionsButton>
                      </div>
                      <button type="button" className="btn btn-primary btn-sm btn-block" style={{ marginTop: 8 }} onClick={() => setCheckingIn(m)}>
                        {'\u{1F4CD}'} Check In
                      </button>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
          </MapContainer>
        ) : (
          <p className="mall-lab-dim" style={{ padding: 16 }}>
            Loading malls…
          </p>
        )}
      </div>
      <p className="mall-lab-dim" style={{ margin: '8px 2px 12px' }}>
        {'\u{1F9EA}'} Test map: only malls ({malls.length}). Tap one and press Check In (no location needed here). Ratings stay on this device.
      </p>

      {checkingIn && (
        <MallCheckIn
          key={`${checkingIn.key}-${visits.length}`}
          mall={checkingIn}
          stores={storesByVisits(checkingIn.key, places)}
          ratings={ratings}
          places={places}
          onPost={post}
          onClose={() => setCheckingIn(null)}
        />
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
        <p className="mall-lab-dim">
          {visits.length} check-in{visits.length === 1 ? '' : 's'}, {ratings.length} store rating{ratings.length === 1 ? '' : 's'} on this device. Your top tags:{' '}
          {topTags(taste.scores).join(', ') || 'none yet'}.
        </p>
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

// The real check-in sheet (components/CheckInReview.jsx) for a mall: the
// mall's own rating, then the stores you went into, each rated the same way.
export function MallCheckIn({ mall, stores, ratings, places, onPost, onClose }) {
  const [mallRating, setMallRating] = useState(null);
  const [picked, setPicked] = useState([]); // store ids, in the order picked
  const [storeRatings, setStoreRatings] = useState({}); // id -> RatingFlow payload
  const [result, setResult] = useState(null);
  const ratedBefore = useMemo(() => new Set(ratings.filter((r) => r.parentId === mall.key).map((r) => r.storeId)), [ratings, mall.key]);
  const byId = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);
  const toggle = (id) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_STORE_RATINGS ? cur : [...cur, id]));
  const ready = !!mallRating && picked.every((id) => storeRatings[id]?.tier);

  const submit = () => {
    const out = onPost({
      mall,
      mallRating,
      storeRatings: picked.map((id) => ({ store: byId.get(id), rating: storeRatings[id] })),
    });
    setResult(out);
  };

  if (result) {
    const tagsMoved = [...new Set(result.saved.flatMap((r) => byId.get(r.storeId)?.tags || []))];
    const score = mallScore(mall.key, places, result.nextRatings);
    const itinerary = mallForItinerary(mall.key, places, result.after);
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <h3 style={{ marginTop: 0 }}>{'\u{1F3AF}'} Checked in!</h3>
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            {mall.name}
            {result.saved.length ? ` · ${result.saved.length} store${result.saved.length === 1 ? '' : 's'} rated` : ''}
          </p>
          {result.saved.length > 0 && (
            <ul className="mall-lab-log">
              {result.saved.map((r) => (
                <li key={r.storeId}>
                  {r.vote === 'up' ? '\u{2764}\u{FE0F}' : r.vote === 'down' ? '\u{1F44E}' : '\u{1F610}'} <strong>{byId.get(r.storeId)?.name}</strong>
                </li>
              ))}
            </ul>
          )}
          {tagsMoved.length > 0 && (
            <div className="mall-lab-learned">
              <strong>What Mapr learned</strong>
              <div className="mall-lab-dim">
                {tagsMoved.map((t) => `${t} ${Math.round((result.before[t] || 0) * 10) / 10} → ${Math.round((result.after[t] || 0) * 10) / 10}`).join(' · ')}
              </div>
            </div>
          )}
          <p className="mall-lab-dim">
            Mall score: {score == null ? 'no store rated yet' : `${Math.round(score * 100)}% liked`} ·{' '}
            {itinerary.include ? itinerary.reason : 'Not in your itinerary yet (needs 2 stores that match your top tags).'}
          </p>
          <p className="mall-lab-dim">Went to another store later? Check in at {mall.name} again and rate it.</p>
          <button className="btn btn-primary btn-block" style={{ marginTop: 8 }} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card mall-visit" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Check in to ${mall.name}`}>
        <h3 style={{ marginTop: 0 }}>
          {'\u{1F4CD}'} Check in to {mall.name}?
        </h3>
        <p className="screen-subtitle" style={{ marginTop: 0 }}>
          How was it? One tap is enough — the rest is optional.
        </p>
        <p className="screen-subtitle" style={{ marginTop: -10, fontSize: '0.78rem' }}>
          Mapr gets smarter with every rating you give. Rate for you, and your next picks improve.
        </p>
        <RatingFlow landmark={{ ...mall, topic: mall.topic || 'mall' }} onChange={setMallRating} />

        {stores.length > 0 ? (
          <div className="mall-stores-block">
            <p className="rating-flow-label" style={{ margin: '18px 0 6px' }}>
              Which stores did you go to? <span>optional, up to {MAX_STORE_RATINGS}</span>
            </p>
            <StorePicker stores={stores} picked={picked} ratedBefore={ratedBefore} onToggle={toggle} />
            {picked.map((id) => (
              <div key={id} className="mall-store-rating">
                <div className="mall-store-rating-head">
                  <strong>{byId.get(id).name}</strong>
                  <button type="button" className="mall-store-remove" aria-label={`Remove ${byId.get(id).name}`} onClick={() => toggle(id)}>
                    {'\u{2715}'}
                  </button>
                </div>
                <RatingFlow landmark={storeAsPlace(byId.get(id))} onChange={(r) => setStoreRatings((cur) => ({ ...cur, [id]: r }))} />
              </div>
            ))}
          </div>
        ) : (
          <p className="mall-lab-dim" style={{ marginTop: 14 }}>
            This mall's store list isn't in the app yet.
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary btn-block" disabled={!ready} onClick={submit}>
            Post
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
        {mallRating && !ready && <p className="mall-lab-dim">Rate each store you picked, or remove it.</p>}
      </div>
    </div>
  );
}

// "Which stores did you go to?": a dropdown with a search box; tap stores to
// pick them (several at once). Stores you rated here before are marked.
function StorePicker({ stores, picked, ratedBefore, onToggle }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef(null);
  useEffect(() => {
    const away = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);
  const shown = q.trim() ? stores.filter((s) => matchesSearch([s.name, ...s.tags].join(' '), q)) : stores;
  const full = picked.length >= MAX_STORE_RATINGS;
  return (
    <div className="mall-store-picker" ref={box}>
      <button type="button" className="mall-store-picker-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{picked.length ? `${picked.length} store${picked.length === 1 ? '' : 's'} picked` : 'Pick the stores you went into'}</span>
        <span aria-hidden="true">{open ? '\u{25B2}' : '\u{25BC}'}</span>
      </button>
      {open && (
        <div className="mall-store-picker-panel">
          <input type="search" placeholder={'\u{1F50D} Find a store'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a store" />
          <div className="mall-store-picker-list" role="listbox" aria-multiselectable="true">
            {shown.map((s) => {
              const on = picked.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`mall-store-option ${on ? 'on' : ''}`}
                  disabled={!on && full}
                  onClick={() => onToggle(s.id)}
                >
                  <span className="mall-store-check" aria-hidden="true">
                    {on ? '\u{2713}' : ''}
                  </span>
                  <span className="mall-store-option-text">
                    <span className="mall-lab-store-name">{s.name}</span>
                    <span className="mall-lab-dim">
                      {s.tags.join(', ')}
                      {ratedBefore.has(s.id) ? ' · rated before' : ''}
                    </span>
                  </span>
                </button>
              );
            })}
            {shown.length === 0 && <p className="mall-lab-dim">No store matches.</p>}
          </div>
          {full && <p className="mall-lab-dim">That's {MAX_STORE_RATINGS}: rate these, and check in again later for more.</p>}
          <button type="button" className="btn btn-primary btn-sm btn-block" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

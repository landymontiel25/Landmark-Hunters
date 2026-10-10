import { useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip } from 'react-leaflet';
import { PALM_GROVE_PLAZA, TEST_MALL_PLACES } from '../data/testMalls';
import { ALL_LANDMARKS, getRegion } from '../data/regions';
import { usePlacePacksVersion } from '../lib/placePacks';
import {
  MAX_STORE_RATINGS,
  STORE_RATING_TAGS,
  applyStoreVote,
  makeStoreRating,
  mallForItinerary,
  mallScore,
  ratingQueue,
  storesByVisits,
  topTags,
  isMallPlace,
  storesOfPlace,
  mallStoresSource,
} from '../lib/malls';
import { runMallChecks } from '../lib/mallChecks';

// Test tab: malls with stores inside them. The map shows only the malls in
// the app (Dadeland, Dolphin Mall, King of Prussia...), each with the stores
// its own directory lists (data/mallStores.js). Tap one,
// "Check in" (no location needed here), say which stores you went into and
// rate them. Palm Grove Plaza (data/testMalls.js) is the made-up example the
// checks run on. Ratings and the taste they build stay on this device
// (localStorage), apart from the real account, so nothing reaches the live tabs.
const RATINGS_KEY = 'mallLab.ratings.v1';
const tasteKey = (uid) => `mallLab.taste.v1.${uid || 'guest'}`;
const EMPTY_TASTE = { scores: {}, at: {}, counts: {} };
const STREET_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

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

// Every mall in the app (lib/malls.js isMallPlace) as { id, name, city, lat,
// lng, source }, plus its stores (data/mallStores.js) as places pointing back
// to it (parentId), the shape lib/malls.js works on. A mall added to the app
// shows up here by itself.
function useTestMalls() {
  const packsVersion = usePlacePacksVersion();
  return useMemo(() => {
    const malls = [];
    const stores = [];
    for (const l of ALL_LANDMARKS) {
      if (!isMallPlace(l)) continue;
      const mine = storesOfPlace(l.regionId, l.id);
      const key = `${l.regionId}/${l.id}`;
      malls.push({ id: key, name: l.name, city: getRegion(l.regionId)?.name || '', lat: l.lat, lng: l.lng, source: mallStoresSource(l.regionId, l.id), onMap: Number.isFinite(l.lat), storeCount: mine.length });
      stores.push(...mine);
    }
    return { malls, stores };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- packsVersion: imported malls arrive with the place packs
  }, [packsVersion]);
}

export default function MallLab({ uid }) {
  const { malls, stores: mallStores } = useTestMalls();
  const [ratings, setRatings] = useState(() => read(RATINGS_KEY, []));
  const [taste, setTaste] = useState(() => read(tasteKey(uid), EMPTY_TASTE));
  const [mallId, setMallId] = useState(null);
  // 'map' -> 'pick' (which stores) -> 'rate' (one card per store) -> 'done'
  const [step, setStep] = useState('map');
  const [checked, setChecked] = useState([]);
  const [queue, setQueue] = useState([]);
  const [card, setCard] = useState(0);
  const [cardTags, setCardTags] = useState([]);
  const [visitLog, setVisitLog] = useState([]); // this visit: { store, vote, tags, before, after }
  const [checks, setChecks] = useState(null);

  // Every store with this device's visits (ratings) counted, for "most visited first".
  const places = useMemo(
    () =>
      [...TEST_MALL_PLACES, ...mallStores].map((p) =>
        p.parentId ? { ...p, visits: (p.visits || 0) + ratings.filter((r) => r.storeId === p.id).length } : p
      ),
    [ratings, mallStores]
  );
  const allMalls = [...malls, { ...PALM_GROVE_PLAZA, onMap: false, example: true }];
  const mall = allMalls.find((m) => m.id === mallId) || null;
  const stores = mall ? storesByVisits(mall.id, places) : [];
  const summary = (m) => {
    const score = mallScore(m.id, places, ratings);
    const it = mallForItinerary(m.id, places, taste.scores);
    return { score: score == null ? 'No store rated yet' : `${Math.round(score * 100)}% thumbs up`, itinerary: it };
  };

  const checkIn = (id) => {
    setMallId(id);
    setChecked([]);
    setVisitLog([]);
    setStep('pick');
  };
  const toggle = (id) => setChecked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const startRating = () => {
    setQueue(ratingQueue(checked, places));
    setCard(0);
    setCardTags([]);
    setStep('rate');
  };
  const vote = (v) => {
    const store = queue[card];
    const rating = makeStoreRating({ userId: uid || 'guest', store, vote: v, tags: cardTags });
    const nextRatings = [...ratings, rating];
    const nextTaste = applyStoreVote(taste, store, v);
    setRatings(nextRatings);
    write(RATINGS_KEY, nextRatings);
    setTaste(nextTaste);
    write(tasteKey(uid), nextTaste);
    setVisitLog((log) => [
      ...log,
      {
        store,
        vote: v,
        tags: cardTags,
        before: Object.fromEntries(store.tags.map((t) => [t, taste.scores[t] || 0])),
        after: Object.fromEntries(store.tags.map((t) => [t, nextTaste.scores[t]])),
      },
    ]);
    setCardTags([]);
    if (card + 1 < queue.length) setCard(card + 1);
    else setStep('done');
  };
  const reset = () => {
    setRatings([]);
    setTaste(EMPTY_TASTE);
    write(RATINGS_KEY, []);
    write(tasteKey(uid), EMPTY_TASTE);
    setStep('map');
  };

  const onMap = malls.filter((m) => m.onMap);

  return (
    <div className="mall-lab">
      {step === 'map' && (
        <>
          <div className="card section">
            <div className="lab-controls-head">
              <strong>{'\u{1F3EC}'} Malls</strong>
              <span className="tag">Test data · this device only</span>
            </div>
            <p className="screen-subtitle" style={{ margin: '4px 0 10px' }}>
              Only malls on this map. Tap one and press Check in to try a visit: pick the stores you went into, then rate them.
            </p>
            <div className="mall-lab-map">
              {onMap.length > 0 ? (
                <MapContainer
                  bounds={onMap.map((m) => [m.lat, m.lng])}
                  boundsOptions={{ padding: [40, 40] }}
                  style={{ height: '100%', width: '100%' }}
                  scrollWheelZoom
                >
                  <TileLayer url={STREET_TILES} attribution="&copy; OpenStreetMap &copy; CARTO" />
                  {onMap.map((m) => {
                    const s = summary(m);
                    return (
                      <CircleMarker
                        key={m.id}
                        center={[m.lat, m.lng]}
                        radius={11}
                        pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#5b8cff', fillOpacity: 0.95 }}
                      >
                        <Tooltip direction="top" offset={[0, -10]}>
                          {m.name}
                        </Tooltip>
                        <Popup>
                          <div className="mall-lab-popup">
                            <strong>{m.name}</strong>
                            <div>
                              {m.city} · {storesByVisits(m.id, places).length} stores
                            </div>
                            <div>{s.score}</div>
                            <button type="button" className="btn btn-primary btn-sm" disabled={!m.storeCount} onClick={() => checkIn(m.id)}>
                              {'\u{1F4CD}'} {m.storeCount ? 'Check in' : 'No stores listed yet'}
                            </button>
                          </div>
                        </Popup>
                      </CircleMarker>
                    );
                  })}
                </MapContainer>
              ) : (
                <p className="mall-lab-dim" style={{ padding: 16 }}>
                  Loading malls…
                </p>
              )}
            </div>
            <ul className="mall-lab-mall-list">
              {allMalls.map((m) => {
                const s = summary(m);
                return (
                  <li key={m.id}>
                    <div>
                      <strong>{m.name}</strong>
                      <span className="mall-lab-dim">
                        {' '}
                        · {m.city}
                        {m.example ? ' · made-up example, not on the map' : ''}
                      </span>
                      <div className="mall-lab-dim">
                        {s.score} · {s.itinerary.include ? s.itinerary.reason : `In your itinerary: no (${s.itinerary.stores.length} store${s.itinerary.stores.length === 1 ? '' : 's'} match your top tags, needs 2)`}
                      </div>
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={!m.example && !m.storeCount} onClick={() => checkIn(m.id)}>
                      {m.example || m.storeCount ? 'Check in' : 'No stores yet'}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="lab-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
                {'\u{21BA}'} Reset test ratings
              </button>
            </div>
          </div>
        </>
      )}

      {step === 'pick' && mall && (
        <div className="card section">
          <p className="mall-lab-dim" style={{ marginTop: 0 }}>
            {'\u{2705}'} Checked in at {mall.name}
          </p>
          <h2 style={{ marginTop: 0 }}>Which stores did you visit?</h2>
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            Check every store you went into. You'll rate up to {MAX_STORE_RATINGS}.
          </p>
          <ul className="mall-lab-stores">
            {stores.map((s) => (
              <li key={s.id}>
                <label className={`mall-lab-store ${checked.includes(s.id) ? 'on' : ''}`}>
                  <input type="checkbox" checked={checked.includes(s.id)} onChange={() => toggle(s.id)} />
                  <span className="mall-lab-store-name">{s.name}</span>
                  <span className="mall-lab-dim">
                    {s.tags.join(', ')}
                    {s.visits ? ` · ${s.visits} visit${s.visits === 1 ? '' : 's'}` : ''}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {mall.source && (
            <p className="mall-lab-dim">
              Stores from{' '}
              <a href={mall.source} target="_blank" rel="noreferrer">
                the mall's directory
              </a>
              .
            </p>
          )}
          {checked.length > MAX_STORE_RATINGS && (
            <p className="mall-lab-dim">
              {checked.length} checked: you'll rate the first {MAX_STORE_RATINGS}.
            </p>
          )}
          <div className="lab-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep('map')}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={!checked.length} onClick={startRating}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 'rate' && queue[card] && (
        <div className="card section mall-lab-card">
          <p className="mall-lab-dim" style={{ marginTop: 0 }}>
            {mall?.name} · store {card + 1} of {queue.length}
          </p>
          <h2 style={{ margin: '0 0 4px' }}>{queue[card].name}</h2>
          <p className="mall-lab-dim" style={{ marginTop: 0 }}>
            {queue[card].tags.join(', ')}
          </p>
          <div className="mall-lab-tags" role="group" aria-label="Optional tags">
            {STORE_RATING_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                className={`tag mall-lab-chip ${cardTags.includes(t) ? 'on' : ''}`}
                aria-pressed={cardTags.includes(t)}
                onClick={() => setCardTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="mall-lab-votes">
            <button type="button" className="btn btn-ghost mall-lab-vote" aria-label={`Thumbs down on ${queue[card].name}`} onClick={() => vote('down')}>
              {'\u{1F44E}'}
            </button>
            <button type="button" className="btn btn-primary mall-lab-vote" aria-label={`Thumbs up on ${queue[card].name}`} onClick={() => vote('up')}>
              {'\u{1F44D}'}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && mall && (
        <div className="card section">
          <h2 style={{ marginTop: 0 }}>
            Saved {visitLog.length} rating{visitLog.length === 1 ? '' : 's'} at {mall.name}
          </h2>
          <ul className="mall-lab-log">
            {visitLog.map((v) => (
              <li key={v.store.id}>
                {v.vote === 'up' ? '\u{1F44D}' : '\u{1F44E}'} <strong>{v.store.name}</strong>
                {v.tags.length > 0 && <span className="mall-lab-dim"> ({v.tags.join(', ')})</span>}
                <div className="mall-lab-dim">
                  {v.store.tags.map((t) => `${t} ${Math.round(v.before[t] * 10) / 10} → ${Math.round(v.after[t] * 10) / 10}`).join(' · ')}
                </div>
              </li>
            ))}
          </ul>
          <p style={{ margin: '0 0 4px' }}>
            <strong>Mall score:</strong> {summary(mall).score}
          </p>
          <p style={{ margin: '0 0 4px' }}>
            <strong>In your itinerary?</strong> {summary(mall).itinerary.include ? `Yes. ${summary(mall).itinerary.reason}` : `No: needs 2 stores that match your top tags.`}
          </p>
          <p style={{ marginBottom: 10 }}>
            <strong>Your top tags:</strong> {topTags(taste.scores).join(', ') || 'none yet'}
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setStep('map')}>
            Back to the map
          </button>
        </div>
      )}

      <div className="card section">
        <div className="lab-controls-head">
          <strong>{'\u{2705}'} Checks</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChecks(runMallChecks())}>
            {checks ? 'Run again' : 'Run checks'}
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
            {checks.filter((c) => c.pass).length} of {checks.length} passed. The checks run on Palm Grove Plaza with made-up users, not your test ratings.
          </p>
        )}
      </div>
    </div>
  );
}

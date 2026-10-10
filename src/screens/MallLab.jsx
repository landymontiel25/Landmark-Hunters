import { useMemo, useState } from 'react';
import { PALM_GROVE_PLAZA, TEST_MALL_PLACES } from '../data/testMalls';
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
} from '../lib/malls';
import { runMallChecks } from '../lib/mallChecks';

// Test tab: places with stores inside them, tried on Palm Grove Plaza (a
// made-up strip mall, data/testMalls.js). Ratings and the taste they build
// are kept on this device only (localStorage), apart from the real account's
// taste, so nothing here reaches the live tabs.
const RATINGS_KEY = 'mallLab.ratings.v1';
const tasteKey = (uid) => `mallLab.taste.v1.${uid || 'guest'}`;
const EMPTY_TASTE = { scores: {}, at: {}, counts: {} };

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

export default function MallLab({ uid }) {
  const mallId = PALM_GROVE_PLAZA.id;
  const [ratings, setRatings] = useState(() => read(RATINGS_KEY, []));
  const [taste, setTaste] = useState(() => read(tasteKey(uid), EMPTY_TASTE));
  // 'mall' (overview) -> 'pick' (which stores) -> 'rate' (one card per store) -> 'done'
  const [step, setStep] = useState('mall');
  const [checked, setChecked] = useState([]);
  const [queue, setQueue] = useState([]);
  const [card, setCard] = useState(0);
  const [cardTags, setCardTags] = useState([]);
  const [visitLog, setVisitLog] = useState([]); // this visit: { store, vote, tags, before, after }
  const [checks, setChecks] = useState(null);

  // Most visited first: the store's own count plus this device's ratings.
  const places = useMemo(
    () => TEST_MALL_PLACES.map((p) => (p.parentId ? { ...p, visits: (p.visits || 0) + ratings.filter((r) => r.storeId === p.id).length } : p)),
    [ratings]
  );
  const stores = storesByVisits(mallId, places);
  const score = mallScore(mallId, places, ratings);
  const itinerary = mallForItinerary(mallId, places, taste.scores);

  const startVisit = () => {
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
      { store, vote: v, tags: cardTags, before: Object.fromEntries(store.tags.map((t) => [t, taste.scores[t] || 0])), after: Object.fromEntries(store.tags.map((t) => [t, nextTaste.scores[t]])) },
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
    setStep('mall');
  };

  const scoreText = score == null ? 'No store rated yet' : `${Math.round(score * 100)}% thumbs up`;

  return (
    <div className="mall-lab">
      <div className="card section">
        <div className="lab-controls-head">
          <strong>{'\u{1F3EC}'} {PALM_GROVE_PLAZA.name}</strong>
          <span className="tag">Test data · this device only</span>
        </div>
        <p className="screen-subtitle" style={{ margin: '4px 0 8px' }}>
          {PALM_GROVE_PLAZA.city} · {PALM_GROVE_PLAZA.kind} · {stores.length} stores (the real one has about 40)
        </p>
        <p style={{ margin: '0 0 4px' }}>
          <strong>Mall score:</strong> {scoreText}
          <span className="mall-lab-dim"> (stores weighted by visits, unrated stores skipped)</span>
        </p>
        <p style={{ margin: 0 }}>
          <strong>In your itinerary?</strong> {itinerary.include ? `Yes. ${itinerary.reason}` : `No: ${itinerary.stores.length} of its stores match your top tags (needs 2).`}
        </p>
        <div className="lab-actions" style={{ marginTop: 10 }}>
          {step === 'mall' && (
            <button type="button" className="btn btn-primary btn-sm" onClick={startVisit}>
              Simulate a visit
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
            {'\u{21BA}'} Reset test ratings
          </button>
        </div>
      </div>

      {step === 'pick' && (
        <div className="card section">
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
                    {s.tags.join(', ')} · {s.visits} visits
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {checked.length > MAX_STORE_RATINGS && (
            <p className="mall-lab-dim">
              {checked.length} checked: you'll rate the first {MAX_STORE_RATINGS}.
            </p>
          )}
          <div className="lab-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep('mall')}>
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
            Store {card + 1} of {queue.length}
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

      {step === 'done' && (
        <div className="card section">
          <h2 style={{ marginTop: 0 }}>Saved {visitLog.length} rating{visitLog.length === 1 ? '' : 's'}</h2>
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
          <p style={{ marginBottom: 4 }}>
            <strong>Your top tags:</strong> {topTags(taste.scores).join(', ') || 'none yet'}
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setStep('mall')}>
            Done
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
            {checks.filter((c) => c.pass).length} of {checks.length} passed. The checks use made-up users, not your test ratings.
          </p>
        )}
      </div>
    </div>
  );
}

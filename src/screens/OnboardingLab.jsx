import { useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useGeo } from '../lib/GeoContext';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import { isAdmin } from '../lib/admins';
import { ALL_LANDMARKS, INTERESTS, PICKABLE_REGIONS, getLandmark } from '../data/regions';
import { distanceMeters } from '../lib/geo';
import { allSwipeCards, tagDeltasFromAnswers, tasteIntroFromAnswers, SWIPE_DELTAS } from '../lib/onboardingCards';
import { localTagPicks, pickRegion } from '../lib/tagScores';
import { authHeaders } from '../lib/apiAuth';
import LandmarkThumb from '../components/LandmarkThumb';

// Admin-only sandbox for trying out sign-up + onboarding. Everything here is
// local state: no account is created, nothing is written to Firestore or the
// saved trip, and "Restart" wipes it. The results screen shows what a real
// signup would have saved (tagScores changes and notes) without saving it.
// Off while we're only testing the cards; flip back to true to bring the
// sign-up screen back as step 1.
const SIGNUP_ON = false;
const STEPS = [
  ...(SIGNUP_ON ? [{ id: 'signup', label: 'Sign up' }] : []),
  { id: 'prompt', label: 'Rate prompt' },
  { id: 'howto', label: 'Instructions' },
  { id: 'cards', label: 'Cards' },
  { id: 'notes', label: 'Anything else' },
  { id: 'checkin', label: 'First check-in' },
  { id: 'done', label: 'Done' },
];
const indexOf = (id) => STEPS.findIndex((s) => s.id === id);

const empty = () => ({
  name: '',
  email: '',
  password: '',
  age: false,
  via: null,
  skippedRating: false,
  // All 40 here so every card gets tested; real signups get 15-18 (pickSwipeCards).
  cards: allSwipeCards(),
  answers: [],
  notes: '',
  checkedIn: false,
});

export default function OnboardingLab() {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [data, setData] = useState(empty);
  const [log, setLog] = useState([]);
  const set = (patch) => setData((d) => ({ ...d, ...patch }));
  const note = (text) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} — ${text}`]);

  if (!isAdmin(user?.email)) return <Navigate to="/" replace />;

  const go = (target, why) => {
    const i = typeof target === 'string' ? indexOf(target) : target;
    const next = Math.max(0, Math.min(STEPS.length - 1, i));
    note(`${why}: ${STEPS[step].label} → ${STEPS[next].label}`);
    setStep(next);
  };
  const restart = () => {
    setData(empty());
    setLog([]);
    setStep(0);
  };

  const id = STEPS[step].id;

  return (
    <div>
      <div className="card section lab-controls">
        <div className="lab-controls-head">
          <strong>{'\u{1F9EA}'} Onboarding test</strong>
          <span className="tag">Nothing here is saved</span>
        </div>
        <div className="lab-steps">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`lab-step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
              onClick={() => go(i, 'Jumped')}
            >
              {i + 1}. {s.label}
            </button>
          ))}
        </div>
        <div className="lab-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={restart}>
            {'\u{21BA}'} Restart
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={step === 0} onClick={() => go(step - 1, 'Back')}>
            {'\u{2190}'} Back
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={step === STEPS.length - 1}
            onClick={() => go(step + 1, 'Next step')}
          >
            Next step {'\u{2192}'}
          </button>
        </div>
      </div>

      {id === 'signup' && (
        <LabSignUp
          data={data}
          set={set}
          onDone={(via) => {
            set({ via });
            go('prompt', `Signed up (${via})`);
          }}
        />
      )}
      {id === 'prompt' && (
        <LabRatePrompt
          onSkip={() => {
            set({ skippedRating: true });
            go('done', 'Skipped rating, straight into the app');
          }}
          onNext={() => {
            set({ skippedRating: false });
            go('howto', 'Chose to rate');
          }}
        />
      )}
      {id === 'howto' && <LabInstructions onNext={() => go('cards', 'Read instructions')} />}
      {id === 'cards' && (
        <LabCardStack
          cards={data.cards}
          answers={data.answers}
          onAnswer={(card, answer) => {
            note(`${card.word}: ${answer === 'love' ? 'love it' : answer === 'dislike' ? "don't like it" : 'not sure'}`);
            set({ answers: [...data.answers.filter((a) => a.card.word !== card.word), { card, answer }] });
          }}
          onUndo={() => {
            const last = data.answers[data.answers.length - 1];
            if (!last) return;
            note(`Undo: ${last.card.word}`);
            set({ answers: data.answers.slice(0, -1) });
          }}
          onFinished={() => go('notes', 'Finished cards')}
        />
      )}
      {id === 'notes' && (
        <LabNotes data={data} set={set} onDone={(how) => go('checkin', how)} />
      )}
      {id === 'checkin' && <LabCheckIn data={data} set={set} onDone={(how) => go('done', how)} />}
      {id === 'done' && <LabSummary data={data} log={log} onRestart={restart} />}
    </div>
  );
}

function LabRatePrompt({ onSkip, onNext }) {
  return (
    <div className="lab-center">
      <h1 className="screen-title">
        <span>{'\u{1F389}'}</span> You're in!
      </h1>
      <p className="screen-subtitle">Rate a few things you're into — takes 60-90 seconds.</p>
      <button type="button" className="btn btn-primary btn-block" onClick={onNext}>
        Next {'\u{2192}'}
      </button>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onSkip}>
        Skip
      </button>
    </div>
  );
}

function LabInstructions({ onNext }) {
  return (
    <div className="lab-center">
      <h1 className="screen-title">Quick picks so Mapr gets you.</h1>
      <ul className="lab-howto">
        <li>
          <span>{'\u{2665}'}</span> Love it: swipe right or tap {'\u{2665}'}
        </li>
        <li>
          <span>{'\u{2715}'}</span> Don't like it: swipe left or tap {'\u{2715}'}
        </li>
        <li>
          <span>{'\u{2212}'}</span> Not sure or don't care: tap the card or tap {'\u{2212}'}
        </li>
      </ul>
      <button type="button" className="btn btn-primary btn-block" onClick={onNext}>
        Start {'\u{2192}'}
      </button>
    </div>
  );
}

// Red for the first third, yellow to two thirds, green after, emerald when done.
export function progressTier(done, total) {
  if (total && done >= total) return 'done';
  const f = total ? done / total : 0;
  return f < 1 / 3 ? 'red' : f < 2 / 3 ? 'yellow' : 'green';
}

function LabProgress({ done, total, label }) {
  const tier = progressTier(done, total);
  return (
    <div className="lab-progress-wrap">
      <p className={`lab-progress lab-tier-${tier}`}>{label}</p>
      <div className="lab-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <span className={`lab-tier-${tier}`} style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

const SWIPE_PX = 90;
const TAP_PX = 8;

function LabCardStack({ cards, answers, onAnswer, onUndo, onFinished }) {
  const answered = new Set(answers.map((a) => a.card.word));
  const index = cards.findIndex((c) => !answered.has(c.word));
  const card = index === -1 ? null : cards[index];
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(null);
  const start = useRef(null);

  if (!card) {
    return (
      <div className="lab-center">
        <LabProgress done={answers.length} total={cards.length} label={`${cards.length} / ${cards.length}`} />
        <h1 className="screen-title">All done {'\u{2705}'}</h1>
        <p className="screen-subtitle">{answers.length} cards rated.</p>
        <button type="button" className="btn btn-primary btn-block" onClick={onFinished}>
          Continue {'\u{2192}'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm lab-undo" disabled={!answers.length} onClick={onUndo}>
          {'\u{21B6}'} Undo
        </button>
      </div>
    );
  }

  const decide = (answer) => {
    if (leaving) return;
    setLeaving(answer);
    setDx(answer === 'love' ? 600 : answer === 'dislike' ? -600 : 0);
    setTimeout(() => {
      onAnswer(card, answer);
      setDx(0);
      setLeaving(null);
    }, 220);
  };

  const onPointerDown = (e) => {
    if (leaving) return;
    start.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!start.current) return;
    setDx(e.clientX - start.current.x);
  };
  const onPointerUp = (e) => {
    if (!start.current) return;
    const moved = e.clientX - start.current.x;
    const movedY = e.clientY - start.current.y;
    start.current = null;
    if (moved > SWIPE_PX) decide('love');
    else if (moved < -SWIPE_PX) decide('dislike');
    else if (Math.abs(moved) < TAP_PX && Math.abs(movedY) < TAP_PX) decide('unsure');
    else setDx(0);
  };

  const hint = dx > 30 ? 'love' : dx < -30 ? 'dislike' : null;

  return (
    <div>
      <LabProgress done={answers.length} total={cards.length} label={`${index + 1} / ${cards.length}`} />
      <div className="lab-card-area">
        <div
          className={`lab-card ${leaving ? 'leaving' : ''} ${dx !== 0 && !leaving ? 'dragging' : ''}`}
          style={{ transform: `translateX(${dx}px) rotate(${dx / 20}deg)`, opacity: leaving === 'unsure' ? 0 : 1 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            start.current = null;
            setDx(0);
          }}
          role="group"
          aria-label={`${card.word}. Swipe right to love it, left if you don't like it, or tap if you're not sure or don't care.`}
        >
          <div className="lab-card-word">{card.word}</div>
          <div className={`lab-card-photo lab-photo-${card.group} ${card.photos.length > 1 ? 'split' : ''}`}>
            <span aria-hidden="true">{card.icon}</span>
            {card.photos.map((src) => (
              <img
                key={src}
                src={src}
                alt=""
                draggable={false}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ))}
          </div>
          {cards[index + 1]?.photos.map((src) => <link key={src} rel="preload" as="image" href={src} />)}
          {hint && <div className={`lab-card-hint ${hint}`}>{hint === 'love' ? 'LOVE IT' : 'NOPE'}</div>}
        </div>
      </div>
      <div className="lab-card-buttons">
        <button type="button" className="btn btn-ghost" onClick={() => decide('dislike')} aria-label="Don't like it">
          {'\u{2715}'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => decide('unsure')} aria-label="Not sure">
          {'\u{2212}'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => decide('love')} aria-label="Love it">
          {'\u{2665}'}
        </button>
      </div>
        <button type="button" className="btn btn-ghost btn-sm lab-undo" disabled={!answers.length || !!leaving} onClick={onUndo}>
          {'\u{21B6}'} Undo
        </button>
    </div>
  );
}

function LabNotes({ data, set, onDone }) {
  return (
    <div>
      <h1 className="screen-title">Anything else?</h1>
      <p className="screen-subtitle">Anything else you love or hate that we didn't cover?</p>
      <textarea
        className="rating-comment"
        aria-label="Anything else you love or hate"
        rows={5}
        maxLength={2000}
        placeholder="Optional"
        value={data.notes}
        onChange={(e) => set({ notes: e.target.value })}
      />
      <button
        type="button"
        className="btn btn-primary btn-block"
        style={{ marginTop: 20 }}
        onClick={() => onDone(data.notes.trim() ? 'Added notes' : 'Continued without notes')}
      >
        {data.notes.trim() ? 'Save & continue' : 'Continue'} {'\u{2192}'}
      </button>
    </div>
  );
}

function LabSignUp({ data, set, onDone }) {
  const [error, setError] = useState('');
  const submit = (e) => {
    e.preventDefault();
    if (!data.age) {
      setError('You must confirm you’re 13 or older to create an account.');
      return;
    }
    setError('');
    onDone('email');
  };
  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F6C2}'}</span> Sign In
      </h1>
      <p className="screen-subtitle">Sign in to check in, rate places, add friends, and hit the leaderboard.</p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="lab-name">Display Name</label>
          <input id="lab-name" type="text" value={data.name} onChange={(e) => set({ name: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="lab-email">Email</label>
          <input id="lab-email" type="email" value={data.email} onChange={(e) => set({ email: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="lab-password">Password</label>
          <input
            id="lab-password"
            type="password"
            autoComplete="off"
            value={data.password}
            onChange={(e) => set({ password: e.target.value })}
            required
            minLength={6}
          />
        </div>
        {error && (
          <p className="tag tag-error" role="alert" style={{ display: 'block', marginBottom: 14 }}>
            {error}
          </p>
        )}
        <label className="lab-age">
          <input type="checkbox" checked={data.age} onChange={(e) => set({ age: e.target.checked })} />
          <span>I am 13 years of age or older.</span>
        </label>
        <button className="btn btn-primary btn-block" type="submit">
          Create Account
        </button>
      </form>
      <div className="lab-divider">
        <span>or</span>
      </div>
      <button type="button" className="btn btn-ghost btn-block" onClick={() => onDone('Google')}>
        {'\u{1F510}'} Sign up with Google
      </button>
    </div>
  );
}

function LabCheckIn({ data, set, onDone }) {
  const { coords, loading } = useGeo();
  const { units } = useUnits();
  let nearest = null;
  if (coords) {
    for (const l of ALL_LANDMARKS) {
      const d = distanceMeters(coords.lat, coords.lng, l.lat, l.lng);
      if (!nearest || d < nearest.meters) nearest = { landmark: l, meters: d };
    }
  }
  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F4CD}'}</span> Your First Check-In
      </h1>
      <p className="screen-subtitle">One tap to earn your first point.</p>
      {!coords && <p className="screen-subtitle">{loading ? 'Finding your location…' : "Can't find your location right now."}</p>}
      {nearest && (
        <div className="card section" style={{ textAlign: 'center' }}>
          <LandmarkThumb landmark={nearest.landmark} size={96} />
          <h3 style={{ marginBottom: 4 }}>{nearest.landmark.name}</h3>
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            {formatDistance(nearest.meters, units)} away
          </p>
          <button type="button" className="btn btn-primary btn-block" disabled={data.checkedIn} onClick={() => set({ checkedIn: true })}>
            {data.checkedIn ? '\u{2705} Checked in (pretend)' : 'Check In'}
          </button>
        </div>
      )}
      <button
        type="button"
        className="btn btn-ghost btn-block"
        style={{ marginTop: 10 }}
        onClick={() => onDone(data.checkedIn ? 'Checked in, continued' : 'Skipped first check-in')}
      >
        {data.checkedIn ? 'Continue' : 'Skip for now'}
      </button>
    </div>
  );
}

function LabSummary({ data, log, onRestart }) {
  const tagLabel = (id) => INTERESTS.find((i) => i.id === id)?.label || id;
  const deltas = tagDeltasFromAnswers(data.answers);
  const count = (a) => data.answers.filter((x) => x.answer === a).length;
  const answerLabel = { love: 'love it', dislike: "don't like it", unsure: 'not sure' };
  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F3C1}'}</span> Onboarding finished
      </h1>
      <p className="screen-subtitle">What a real signup would have saved. Nothing here was actually saved.</p>
      <div className="card section">
        {SIGNUP_ON && (
          <p>
            <strong>Signed up with:</strong> {data.via || '—'}
          </p>
        )}
        {data.skippedRating ? (
          <p>
            <strong>Rating:</strong> skipped — straight into the app, no preference data yet
          </p>
        ) : (
          <p>
            <strong>Cards:</strong> {data.answers.length} of {data.cards.length} rated — {count('love')} love it,{' '}
            {count('dislike')} don't like it, {count('unsure')} not sure
          </p>
        )}
        <p>
          <strong>First check-in:</strong> {data.checkedIn ? 'yes' : 'skipped'}
        </p>
      </div>

      {!data.skippedRating && (
        <>
          <div className="card section">
            <strong>tagScores changes</strong>
            <p className="screen-subtitle" style={{ margin: '4px 0 8px' }}>
              Love it {SWIPE_DELTAS.love > 0 ? '+' : ''}
              {SWIPE_DELTAS.love}, don't like it {SWIPE_DELTAS.dislike}, not sure 0 — summed per tag.
            </p>
            {Object.keys(deltas).length ? (
              <ul className="lab-log">
                {Object.entries(deltas)
                  .sort((a, b) => b[1] - a[1])
                  .map(([tag, d]) => (
                    <li key={tag}>
                      {tagLabel(tag)} <code>{tag}</code>: {d > 0 ? '+' : ''}
                      {d}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="screen-subtitle">No changes (nothing loved or disliked).</p>
            )}
          </div>

          <div className="card section">
            <strong>Each card</strong>
            <ul className="lab-log">
              {data.answers.map(({ card, answer }) => (
                <li key={card.word}>
                  {card.icon} {card.word} → {answerLabel[answer]} <code>{card.tag}</code>{' '}
                  {card.photoPages.map((href, i) => (
                    <a key={href} href={href} target="_blank" rel="noreferrer" style={{ marginRight: 6 }}>
                      photo{card.photoPages.length > 1 ? ` ${i + 1}` : ''}
                    </a>
                  ))}
                </li>
              ))}
            </ul>
          </div>

          <LabRecommendations data={data} deltas={deltas} />

          <div className="card section">
            <strong>Onboarding notes</strong>
            <p className="screen-subtitle" style={{ margin: '4px 0 0' }}>
              {data.notes.trim() ? `"${data.notes.trim()}"` : 'none'}
            </p>
            <p className="screen-subtitle" style={{ fontSize: '0.75rem' }}>
              Kept as raw text and passed to Mapr as context, never turned into new tags.
            </p>
          </div>
        </>
      )}

      {log.length > 0 && (
        <div className="card section">
          <strong>What happened</strong>
          <ol className="lab-log">
            {log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </div>
      )}
      <button type="button" className="btn btn-primary btn-block" onClick={onRestart}>
        {'\u{21BA}'} Restart
      </button>
    </div>
  );
}

// What Mapr Picks would show right after this signup. "Instant" is the
// on-device tag scorer (tag scores only). "Ask Mapr" sends the same profile
// plus the card words and notes to the real /api/mapr-picks, which only
// reads what it's sent -- nothing is saved.
function LabRecommendations({ data, deltas }) {
  const { coords } = useGeo();
  const [region, setRegion] = useState(() => pickRegion({ origin: coords, fallbackRegions: ['miami'] }) || 'miami');
  const [ai, setAi] = useState({ status: 'idle', picks: [], error: '' });
  const now = Date.now();
  const counts = {};
  for (const { card, answer } of data.answers) if (answer !== 'unsure') counts[card.tag] = (counts[card.tag] || 0) + 1;
  const profile = {
    tagScores: { [region]: deltas },
    tagScoresAt: { [region]: Object.fromEntries(Object.keys(deltas).map((t) => [t, now])) },
    tagCounts: { [region]: counts },
  };
  const tasteIntro = tasteIntroFromAnswers(data.answers, data.notes);
  const instant = localTagPicks({ profile, region, limit: 8, now });

  const changeRegion = (r) => {
    setRegion(r);
    setAi({ status: 'idle', picks: [], error: '' });
  };

  const askMapr = async () => {
    setAi({ status: 'loading', picks: [], error: '' });
    try {
      const r = await fetch('/api/mapr-picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ region, ...profile, tasteIntro, origin: coords || null }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Mapr returned ${r.status}`);
      setAi({ status: 'done', picks: body.picks || [], error: '' });
    } catch (e) {
      setAi({ status: 'error', picks: [], error: e.message || 'Mapr request failed.' });
    }
  };

  const row = (p) => {
    const l = getLandmark(p.region, p.id) || { id: p.id, name: p.name, images: p.image ? [p.image] : [], categories: p.categories };
    return (
      <li key={p.id} className="lab-rec">
        <LandmarkThumb landmark={l} size={48} />
        <div>
          <strong>{p.name}</strong> <span className="tag">{p.matchPercentage}%</span>
          {p.wildcard && <span className="tag">wildcard</span>}
          <div className="screen-subtitle" style={{ margin: 0, fontSize: '0.8rem' }}>
            {(p.categories || []).join(', ')} — {p.oneLineSummary}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="card section">
      <strong>What Mapr would recommend</strong>
      <div className="field" style={{ margin: '8px 0' }}>
        <label htmlFor="lab-rec-region">City</label>
        <select id="lab-rec-region" value={region} onChange={(e) => changeRegion(e.target.value)}>
          {PICKABLE_REGIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <p className="screen-subtitle" style={{ margin: '0 0 6px', fontSize: '0.8rem' }}>
        <strong>Mapr reads:</strong> {tasteIntro || 'nothing (no answers)'}
      </p>

      <p style={{ margin: '12px 0 4px' }}>
        <strong>Instant picks</strong> <span className="screen-subtitle">(tag scores only, no AI)</span>
      </p>
      {instant.length ? <ul className="lab-recs">{instant.map(row)}</ul> : <p className="screen-subtitle">No landmarks here.</p>}

      <p style={{ margin: '12px 0 4px' }}>
        <strong>Mapr AI picks</strong> <span className="screen-subtitle">(tag scores + your card words and notes)</span>
      </p>
      {ai.status === 'done' &&
        (ai.picks.length ? <ul className="lab-recs">{ai.picks.map(row)}</ul> : <p className="screen-subtitle">Mapr returned no picks.</p>)}
      {ai.status === 'error' && (
        <p className="tag tag-error" role="alert" style={{ display: 'block' }}>
          {ai.error}
        </p>
      )}
      <button type="button" className="btn btn-primary btn-block" disabled={ai.status === 'loading'} onClick={askMapr}>
        {ai.status === 'loading' ? 'Asking Mapr…' : ai.status === 'done' ? 'Ask Mapr again' : 'Ask Mapr'}
      </button>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { useRatings } from '../lib/RatingsContext';
import { useTrip } from '../lib/TripContext';
import { getLandmark } from '../data/regions';
import { loadTasteSummary } from '../lib/tasteScoreStore';
import { estimateTasteScore, onboardingRatingTest } from '../lib/tasteEstimate';
import { tasteBarTone } from '../components/TasteProfileCard';
import { SCORE_NAME, buildTasteProfile, kindLabel, parseTasteComment } from '../lib/tasteProfileView';

// Test tab: "Taste Profile". Mapr's score, renamed (SCORE_NAME), with the
// percentage underlined as a link; tapping it opens what your taste profile
// is made of, Vivino-style, and a box to tell Mapr what to change. Reads your
// real profile; nothing here is saved.
export default function TasteProfileLab() {
  const { user } = useAuth();
  const { myProfile } = useFriends();
  const { myReviews } = useRatings();
  const { trip } = useTrip();
  const [open, setOpen] = useState(false);
  const [taste, setTaste] = useState(null);
  const [comment, setComment] = useState('');

  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return undefined;
    let live = true;
    loadTasteSummary(uid)
      .then((t) => live && setTaste(t))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [uid]);

  const estimate = useMemo(() => estimateTasteScore(myReviews, { isOnboarding: onboardingRatingTest(myProfile) }), [myReviews, myProfile]);
  const learning = !taste || taste.state !== 'ready';
  const pct = learning ? estimate?.score ?? null : taste.score;
  const tone = tasteBarTone(pct ?? 0);

  const profile = useMemo(
    () =>
      buildTasteProfile({
        profile: myProfile,
        myReviews,
        findLandmark: (r) => getLandmark(r.region, r.landmarkId) || null,
        region: trip.activeRegion || 'miami',
      }),
    [myProfile, myReviews, trip.activeRegion]
  );
  const changes = parseTasteComment(comment);

  return (
    <div>
      <div className="card section lab-controls">
        <div className="lab-controls-head">
          <strong>{'\u{1F9EA}'} Taste Profile test</strong>
          <span className="tag">Nothing here is saved</span>
        </div>
        <p className="screen-subtitle" style={{ margin: '6px 0 0' }}>
          The Mapr tab's score, renamed "{SCORE_NAME}". Tap the percentage to open your taste profile.
        </p>
      </div>

      <div className="card section taste-profile-card">
        <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
          {'\u{1F9E9}'} {SCORE_NAME}:{' '}
          {pct == null ? (
            'Learning...'
          ) : (
            <button type="button" className="taste-link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {learning ? '~' : ''}
              {pct}%
            </button>
          )}
        </h3>
        {pct != null && (
          <div className="taste-bar-row">
            <div className="taste-bar-track" role="progressbar" aria-label={SCORE_NAME} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className={`taste-bar-fill taste-bar-${tone.key}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        <button type="button" className="taste-link taste-link-small" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide your taste profile' : 'See your taste profile'}
        </button>
      </div>

      {open && (
        <div className="card section taste-sheet">
          <h2 className="taste-sheet-title">Your taste profile</h2>
          <p className="taste-summary">{profile.summary}</p>

          <h4 className="taste-heading">By category</h4>
          {profile.categories.map((c) => (
            <div key={c.id} className="taste-row">
              <span className="taste-row-label">
                {c.icon} {c.label}
              </span>
              <div className="taste-scale" aria-label={`${c.label}: ${c.word}`}>
                <span className="taste-scale-mid" />
                <span
                  className={`taste-scale-fill ${c.score >= 0 ? 'pos' : 'neg'}`}
                  style={c.score >= 0 ? { left: '50%', width: `${c.score / 2}%` } : { right: '50%', width: `${-c.score / 2}%` }}
                />
              </div>
              <span className="taste-row-word">{c.word}</span>
            </div>
          ))}
          <div className="taste-scale-ends">
            <span>Not for you</span>
            <span>Loves</span>
          </div>

          {(profile.loves.length > 0 || profile.skips.length > 0) && <h4 className="taste-heading">Kinds of places</h4>}
          {profile.loves.length > 0 && (
            <div className="taste-chips">
              {profile.loves.map((k) => (
                <span key={k} className="taste-chip love">
                  {'\u{2665}'} {kindLabel(k)}
                </span>
              ))}
            </div>
          )}
          {profile.skips.length > 0 && (
            <div className="taste-chips">
              {profile.skips.map((k) => (
                <span key={k} className="taste-chip skip">
                  {'\u{2715}'} {kindLabel(k)}
                </span>
              ))}
            </div>
          )}

          <h4 className="taste-heading">In your own words</h4>
          <p className="taste-words">{profile.words || 'Nothing yet. Anything you tell Mapr about yourself shows up here.'}</p>

          <h4 className="taste-heading">Tell Mapr what to change</h4>
          <textarea
            className="taste-comment"
            rows={3}
            maxLength={500}
            placeholder={'e.g. "I like coffee now, but no more pizza. More museums please!"'}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {comment.trim() && (
            <div className="taste-changes">
              {changes.length ? (
                <>
                  <p className="taste-changes-head">Mapr would:</p>
                  <ul>
                    {changes.map((c) => (
                      <li key={`${c.type}:${c.id}`} className={c.direction > 0 ? 'up' : 'down'}>
                        {c.direction > 0 ? '\u{2191} Show more' : '\u{2193} Show less'} {c.label}
                        {c.type === 'category' ? ' (category)' : ''}
                      </li>
                    ))}
                  </ul>
                  <p className="screen-subtitle" style={{ margin: '6px 0 0' }}>
                    And read your note word for word in Mapr chat. In the real app, saving would update every Mapr surface.
                  </p>
                </>
              ) : (
                <p className="screen-subtitle" style={{ margin: 0 }}>
                  Mapr would keep this as a note and read it in chat. Name a kind of place ("coffee", "museums") and say more or less to change its picks directly.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

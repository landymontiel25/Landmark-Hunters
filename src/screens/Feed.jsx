import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { getRegion } from '../data/regions';
import { fetchFeed } from '../lib/feedApi';
import { useFeedCity } from '../lib/useFeedGate';
import { useShownLogger } from '../lib/useShownLogger';
import { makeSetId } from '../lib/setId';
import { loggable } from '../lib/maprRank/surfaces.js';
import { FEED_SURFACE } from '../lib/feed';
import { SkeletonList } from '../components/Skeleton';

// The Feed (docs/discovery-network-plan.md, Phase 6): tips from people who
// went, in Mapr's order for you, with one of Mapr's own picks in every six.
// Shown only in a launch city past the density gate (useFeedCity).
export default function Feed() {
  const { user } = useAuth();
  const { myProfile } = useFriends();
  const region = useFeedCity();
  const [state, setState] = useState({ loading: true, items: [], setId: null });
  const [attempt, setAttempt] = useState(0);
  const uid = user?.uid || null;
  const log = useShownLogger({ uid, profile: myProfile, surface: FEED_SURFACE, source: 'feed' });
  const logged = useRef(null);

  useEffect(() => {
    if (!region || !uid) return undefined;
    let cancelled = false;
    setState({ loading: true, items: [], setId: null });
    fetchFeed(region)
      // Each load is its own shown set, with its own id.
      .then((out) => !cancelled && setState({ loading: false, items: out.items || [], setId: makeSetId(uid) }))
      .catch((e) => !cancelled && setState({ loading: false, items: [], setId: null, error: e }));
    return () => {
      cancelled = true;
    };
  }, [region, uid, attempt]);

  // The whole list is logged once per load, as one shown set.
  useEffect(() => {
    if (!state.setId || !state.items.length || logged.current === state.setId) return;
    logged.current = state.setId;
    log(state.setId, state.items.map((x, i) => loggable({ ...x.place, regionId: x.place.region }, i + 1)));
  }, [state, log]);

  if (!user) return null;
  if (region === undefined) return <SkeletonList count={4} />;
  if (!region) {
    return (
      <div className="card section">
        <h2 style={{ marginTop: 0 }}>Feed</h2>
        <p className="muted">The feed opens in a city once enough people there share tips. Until then, the Map is home.</p>
        <Link to="/" className="btn btn-primary">Open the Map</Link>
      </div>
    );
  }
  const city = getRegion(region)?.name || region;
  return (
    <div>
      <h2 className="screen-title">{city}</h2>
      <p className="screen-subtitle">Tips from people who went, picked for you.</p>
      {state.loading && <SkeletonList count={4} />}
      {state.error && (
        <div className="card section">
          <p>Couldn't load the feed.</p>
          <button type="button" className="btn btn-ghost" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </div>
      )}
      {!state.loading && !state.error && state.items.length === 0 && <p className="muted">Nothing new here right now.</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {state.items.map((x) => (
          <li key={x.key} className="card section" style={{ marginBottom: 10 }}>
            <Link to={`/landmarks/${x.place.region}/${x.place.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
              <strong>{x.place.name}</strong>
            </Link>
            {x.kind === 'mapr' ? (
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
                {'\u{1F9E0}'} {x.reason}
              </p>
            ) : (
              <>
                <p style={{ margin: '6px 0', lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{x.tip.text}</p>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  {x.tip.authorName} · {'\u{2713}'} verified visit{x.tip.why ? ` · ${x.tip.why}` : ''}
                </p>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

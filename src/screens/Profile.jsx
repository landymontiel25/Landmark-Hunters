import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { useTrip } from '../lib/TripContext';
import {
  subscribeLeaderboard,
  getFriendsLeaderboard,
  getRegionalLeaderboard,
  backfillUserName,
  cleanName,
  rankOf,
  getMyLeaderboardEntry,
} from '../lib/leaderboard';
import { useRatings } from '../lib/RatingsContext';
import { RATING_GOAL } from '../lib/ratingFlow';
import { getRegion, REGIONS } from '../data/regions';
import { useBadges } from '../lib/BadgesContext';
import { PICKS_STREAK_THRESHOLD, dayKey, displayStreakCount, isDayHeld } from '../lib/streaks';
import { subscribeMySoloStreak } from '../lib/soloStreaks';
import { claimMyReferralBonuses } from '../lib/referrals';
import { hasCompletedOnboardingLocally } from '../lib/onboarding';
import { ONBOARDING_VERSION, onboardingStatus } from '../lib/onboardingVersion';
import FriendsPanel from '../components/FriendsPanel';
import SignInForm from '../components/SignInForm';
import Onboarding from './Onboarding';
import FriendPopoverName from '../components/FriendPopoverName';
import RegionSearch from '../components/RegionSearch';
import DiscoveryStatsCard from '../components/DiscoveryStatsCard';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import ErrorNotice from '../components/ErrorNotice';
import { friendlyError } from '../lib/friendlyError';
import { usePersistentState } from '../lib/usePersistentState';

const PERIOD_LABEL = { weekly: 'This Week', monthly: 'This Month', yearly: 'This Year' };
const TABS = [
  { id: 'weekly', label: 'This Week' },
  { id: 'monthly', label: 'This Month' },
  { id: 'yearly', label: 'This Year' },
];
// The Ranks tabs you last picked stick (this device, no expiry) -- the
// period key is shared with Full Leaderboard's tabs.
const REMEMBER = { ttlMs: 0 };
// subscribeLeaderboard has no error callback: a listener that never
// delivers a first snapshot is how a failed global read shows up.
const STALL_MS = 15000;
const MEDAL = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

function InviteButton({ myUsername }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const text = myUsername
      ? `I'm on Landmark Hunters. Come join me! My name is ${myUsername}.`
      : `I'm on Landmark Hunters. Come join me!`;
    const url = myUsername ? `https://landmarkhunters.com/?ref=${myUsername}` : 'https://landmarkhunters.com';
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Landmark Hunters', text, url });
        return;
      }
    } catch {
      /* user cancelled the share sheet — fall through to clipboard */
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked — nothing else to do */
    }
  };
  return (
    <button className="btn btn-primary btn-block" onClick={share}>
      {copied ? '✓ Invite copied!' : '\u{1F465} Invite Friends'}
    </button>
  );
}

// The only thing left of the old badge-progress teaser: if onboarding was
// never finished, a plain (not badge-framed) nudge to go finish it --
// badges themselves now live entirely on Full Stats, not on Profile.
function FinishOnboardingCard({ onStartOnboarding }) {
  return (
    <div className="card section">
      <p style={{ margin: '0 0 8px' }}>Finish setting up your account to unlock your Welcome bonus.</p>
      <button type="button" className="btn btn-ghost btn-sm btn-block" onClick={onStartOnboarding}>
        Finish Onboarding {'\u{2192}'}
      </button>
    </div>
  );
}

export default function Profile() {
  const { user, loading: authLoading, firebaseEnabled, signOutUser } = useAuth();
  // Same guard as Settings: a double tap must not start two sign-outs, and a
  // failure must not surface as an unhandled rejection.
  const [signingOut, setSigningOut] = useState(false);
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOutUser();
    } catch (err) {
      console.error('Sign out failed:', err?.code, err?.message);
    } finally {
      setSigningOut(false);
    }
  };
  const { myUsername, friendUids, myProfile } = useFriends();
  const { trip } = useTrip();
  const navigate = useNavigate();
  const { stats, reload: reloadStats } = useBadges();
  // Solo streak's own doc (mode: 'solo', streaks/{uid}) -- kept live here
  // the same way Header's badge and the streak-risk banner below do, so
  // this tile can never show a different number than either of those.
  const [soloStreak, setSoloStreak] = useState(null);
  useEffect(() => {
    if (!user) return undefined;
    return subscribeMySoloStreak(user.uid, setSoloStreak, () => {});
  }, [user]);

  // Your own reviews come from RatingsContext (refreshed after every save),
  // for the "X/10 rated" progress line and the taste card. Only reviews
  // made through the tier + chips flow count: a leftover star-only review
  // from before that flow tells Mapr nothing about *why* you liked it.
  const { myReviews: myReviewsById } = useRatings();
  const myReviews = Object.values(myReviewsById).filter((r) => r.ratingTier);
  const ratingsCount = myReviews.length;
  const [savedTab, setTab] = usePersistentState('leaderboard.period', 'weekly', REMEMBER); // weekly | monthly | yearly
  const [savedScope, setScope] = usePersistentState('profile.lbScope', 'friends', REMEMBER); // 'friends' | 'global'
  // 'global' | 'regional' (only when scope === 'global')
  const [savedGlobalMode, setGlobalMode] = usePersistentState('profile.lbGlobalMode', 'global', REMEMBER);
  const [regionalRegionId, setRegionalRegionId] = usePersistentState('profile.lbRegion', null, REMEMBER);
  // Guard against anything odd left in storage by an older build.
  const tab = TABS.some((t) => t.id === savedTab) ? savedTab : 'weekly';
  const scope = savedScope === 'global' ? 'global' : 'friends';
  const globalMode = savedGlobalMode === 'regional' ? 'regional' : 'global';
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  // Kept apart from "entries is empty" so a failed read never looks like
  // "no one has points yet".
  const [loadError, setLoadError] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // The onboarding flow takes over this tab for a new account (started right
  // after sign-up, or resumed on a later visit once the saved progress or the
  // sign-up marker says it isn't finished). Accounts from before onboarding
  // existed are never dropped in: they get the notification and banner and
  // open it from there.
  const [flowActive, setFlowActive] = useState(false);
  // Set the moment sign-up succeeds, before the account's own marker has
  // reached the profile listener.
  const [signedUpNow, setSignedUpNow] = useState(false);
  const { profileFresh } = useFriends();
  const launchFlow =
    !!user &&
    profileFresh &&
    (onboardingStatus(myProfile) === 'new' || myProfile?.onboardingProgress?.version === ONBOARDING_VERSION);
  useEffect(() => {
    if (launchFlow) setFlowActive(true);
  }, [launchFlow]);
  const healedRef = useRef(false);
  // Signing out and into a different account while this screen stays
  // mounted must not carry the previous account's onboarding takeover or
  // "already healed" flag over to the next one.
  useEffect(() => {
    if (user) return;
    setFlowActive(false);
    setSignedUpNow(false);
    healedRef.current = false;
  }, [user]);

  const period = tab; // the board always tracks a period

  // Referral bonuses (item i8) -- claims anything owed (as the referred
  // user, and/or as a referrer whose link brought in a new signup) once per
  // Profile visit. Fire-and-forget: the resulting points show up in myPoints
  // via the normal leaderboard read, no separate display to keep in sync.
  useEffect(() => {
    if (!firebaseEnabled || !user) return;
    claimMyReferralBonuses(user.uid, myUsername || user.displayName || 'Explorer').catch(() => {});
    // myUsername only labels the leaderboard-entry write below, not
    // something that should re-run the whole claim flow when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseEnabled, user]);

  // Self-heal: if your board row still shows an email/old name, rewrite it.
  useEffect(() => {
    if (healedRef.current || !user || !myUsername) return;
    const mine = entries.find((e) => e.userId === user.uid);
    if (mine && mine.userName !== myUsername) {
      healedRef.current = true;
      backfillUserName(user.uid, myUsername).catch(() => {});
    }
  }, [entries, myUsername, user]);

  // Default the Regional picker to whichever city you're currently
  // exploring, falling back to your most-recently-visited city, then just
  // the first curated region -- computed once, the first time Regional is opened.
  useEffect(() => {
    if (globalMode === 'regional' && !regionalRegionId) {
      setRegionalRegionId(trip.activeRegion || stats?.cityIds?.[0] || REGIONS[0]?.id || null);
    }
  }, [globalMode, regionalRegionId, trip.activeRegion, stats, setRegionalRegionId]);

  useEffect(() => {
    if (!firebaseEnabled || !user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);

    if (scope === 'friends') {
      let cancelled = false;
      getFriendsLeaderboard(period, friendUids, user.uid)
        .then((data) => {
          if (!cancelled) {
            setEntries(data);
            setLoading(false);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setEntries([]);
            setLoadError(err);
            setLoading(false);
          }
        });
      return () => {
        cancelled = true;
      };
    }

    if (globalMode === 'regional') {
      if (!regionalRegionId) {
        setEntries([]);
        setLoading(false);
        return undefined;
      }
      let cancelled = false;
      getRegionalLeaderboard(period, regionalRegionId)
        .then((data) => {
          if (!cancelled) {
            setEntries(data);
            setLoading(false);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setEntries([]);
            setLoadError(err);
            setLoading(false);
          }
        });
      return () => {
        cancelled = true;
      };
    }

    let arrived = false;
    const stall = setTimeout(() => {
      if (!arrived) {
        setEntries([]);
        setLoadError(new Error('Leaderboard listener stalled'));
        setLoading(false);
      }
    }, STALL_MS);
    let unsub = () => {};
    try {
      unsub = subscribeLeaderboard(period, (data) => {
        arrived = true;
        clearTimeout(stall);
        setEntries(data);
        setLoadError(null);
        setLoading(false);
      }, 50, (err) => {
        arrived = true;
        clearTimeout(stall);
        setLoadError(err);
        setLoading(false);
      });
    } catch (err) {
      clearTimeout(stall);
      setLoadError(err);
      setLoading(false);
    }
    return () => {
      clearTimeout(stall);
      unsub();
    };
  }, [period, firebaseEnabled, user, scope, globalMode, regionalRegionId, friendUids, loadAttempt]);

  // The worldwide board only lists its top 50, so someone ranked below that
  // is absent from `entries` -- fetch their own row so they see their points
  // instead of "no points yet".
  const [outsideEntry, setOutsideEntry] = useState(null);
  const onGlobalBoard = scope === 'global' && globalMode === 'global';
  const missingFromBoard =
    !!user && !loading && !loadError && onGlobalBoard && entries.length > 0 && !entries.some((e) => e.userId === user.uid);
  useEffect(() => {
    setOutsideEntry(null);
    if (!missingFromBoard) return undefined;
    let cancelled = false;
    getMyLeaderboardEntry(period, user.uid)
      .then((e) => {
        if (!cancelled) setOutsideEntry(e);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [missingFromBoard, period, user?.uid]);

  if (!firebaseEnabled) {
    return (
      <div className="empty-state">
        <p>Profiles &amp; leaderboard aren't configured yet.</p>
        <p>
          Add your Firebase project keys to a <code>.env</code> file — see the README.
        </p>
      </div>
    );
  }

  // Auth is still restoring the saved session: not signed out yet, so don't
  // flash the sign-in form at someone who is signed in.
  if (authLoading) return <SkeletonList count={3} label="Loading" />;

  if (!user) return (
      <div className="nav-clear">
        <SignInForm
          onSignedUp={() => {
            setSignedUpNow(true);
            setFlowActive(true);
          }}
        />
      </div>
    );

  if (flowActive) return <Onboarding isNew={signedUpNow || onboardingStatus(myProfile) === 'new' || undefined} onExit={() => setFlowActive(false)} />;

  const myIdx = entries.findIndex((e) => e.userId === user.uid);
  const myPoints = myIdx >= 0 ? entries[myIdx].points : outsideEntry?.points || 0;
  const myRank = myIdx >= 0 ? rankOf(entries, myIdx) : null;
  const belowBoard = myIdx < 0 && !!outsideEntry && outsideEntry.points > 0;

  const displayFor = (e) => (e.userId === user.uid && myUsername ? myUsername : cleanName(e.userName));

  let motivator;
  if (loading) {
    motivator = <Skeleton width="70%" height={13} />;
  } else if (loadError) {
    motivator = '';
  } else if (belowBoard) {
    const last = entries[entries.length - 1];
    motivator = `${Math.max(0, last.points - myPoints + 1).toLocaleString()} pts to reach the top ${entries.length} 🔥`;
  } else if (myIdx < 0) {
    motivator = 'Check in at a landmark to get on the board! 🚀';
  } else if (myIdx === 0) {
    motivator = "👑 You're #1 — don't let anyone catch you!";
  } else {
    const above = entries[myIdx - 1];
    const gap = above.points - myPoints;
    motivator =
      gap > 0
        ? `${gap.toLocaleString()} pts behind ${cleanName(above.userName)} 🔥`
        : `Tied with ${cleanName(above.userName)} — one more check-in breaks it 🔥`;
  }

  const top3 = entries.slice(0, 3);
  const podiumOrder = [top3[1], top3[0], top3[2]]; // 2nd · 1st · 3rd
  const rest = entries.slice(3);

  // Closest rival: the friend nearest above you on this period's board --
  // a friend-scoped nudge, distinct from the motivator above (which compares
  // against whoever's immediately above you on the board, friend or not).
  const rivalCandidates = entries.filter((e) => e.userId !== user.uid && friendUids.has(e.userId) && e.points > myPoints);
  const closestRival = rivalCandidates.length
    ? rivalCandidates.reduce((closest, e) => (e.points - myPoints < closest.points - myPoints ? e : closest))
    : null;

  // onboardingCompleted also checks the local guard (see FirstCheckInStep)
  // so "Finish Onboarding" can't reappear on this device even on a load
  // where myProfile hasn't picked up the Firestore flag.
  const onboardingDone = !!myProfile?.onboardingCompleted || hasCompletedOnboardingLocally(user.uid);

  // Solo streak urgency: an active solo streak whose day isn't secured yet
  // -- same server-authority signal (lastCompletedDay) Header's badge and
  // the warning banner use, so this line can never disagree with either.
  // displayStreakCount is 0 once the streak has already lapsed (a stored
  // count lingers until the next close), so a dead streak is neither "at
  // risk" nor "safe" here -- and a freeze spent today counts as held.
  const soloCount = displayStreakCount(soloStreak);
  const todayKey = dayKey(new Date());
  const soloStreakAtRisk =
    soloCount > 0 && !isDayHeld(soloStreak, todayKey);

  const leaderboardLabel =
    scope === 'friends'
      ? 'Friends Leaderboard'
      : globalMode === 'regional'
      ? `${getRegion(regionalRegionId)?.name || 'Regional'} Leaderboard`
      : 'Leaderboard';

  return (
    <div>
      {/* Your Stats -- moved to the top of the page, ahead of everything else. */}
      <div className="card section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>{'\u{1F4CA}'} Your Stats</h3>
          <button type="button" className="btn btn-ghost btn-tight" onClick={() => navigate('/stats')}>
            See Full Stats ›
          </button>
        </div>
        <div className="profile-stats">
          <button
            type="button"
            className="profile-stat profile-stat-btn"
            onClick={() => stats?.checkins && navigate('/checkins')}
          >
            <span className="profile-stat-num">
              {stats?.failed ? '–' : stats ? stats.checkins.toLocaleString() : <Skeleton className="skeleton-inline" width={36} height={22} />}
            </span>
            <span className="profile-stat-label">check-ins{stats?.checkins ? ' ›' : ''}</span>
          </button>
          <button
            type="button"
            className="profile-stat profile-stat-btn"
            onClick={() => stats?.cityIds?.length && navigate('/cities')}
          >
            <span className="profile-stat-num">{stats?.failed ? '–' : stats ? stats.cities : <Skeleton className="skeleton-inline" width={28} height={22} />}</span>
            <span className="profile-stat-label">cities{stats?.cityIds?.length ? ' ›' : ''}</span>
          </button>
          <button type="button" className="profile-stat profile-stat-btn" onClick={() => navigate('/streaks')}>
            <span className="profile-stat-num">
              {soloCount}{soloCount ? ' \u{1F525}' : ''}
            </span>
            <span className="profile-stat-label">streak ›</span>
          </button>
        </div>

        {stats?.failed && (
          <ErrorNotice
            compact
            message="We couldn't load your stats. Check your connection and try again."
            onRetry={() => reloadStats()}
          />
        )}

        <div className="rating-progress">
          {ratingsCount >= RATING_GOAL ? (
            <>
              <strong>{ratingsCount} rated</strong> — Mapr understands you.
            </>
          ) : (
            <>
              <strong>
                {ratingsCount}/{RATING_GOAL} rated
              </strong>{' '}
              — your picks get sharper from here.
            </>
          )}
          <div className="rating-progress-track">
            <div
              className="rating-progress-fill"
              style={{ width: `${Math.min(100, (ratingsCount / RATING_GOAL) * 100)}%` }}
            />
          </div>
        </div>
        <div className="streak-focus">
          <p style={{ margin: '0 0 4px', fontWeight: 700 }}>{'\u{1F525}'} Today's landmarks</p>
          <p className="screen-subtitle" style={{ margin: '0 0 10px' }}>
            Rate {PICKS_STREAK_THRESHOLD} places in your city to keep your streak, and as many more as you like to teach Mapr.
          </p>
          <button type="button" className="btn btn-primary btn-block" onClick={() => navigate('/streaks')}>
            Rate today's landmarks {'\u{2192}'}
          </button>
        </div>

        {soloStreakAtRisk && (
          <p className="tag tag-error" style={{ display: 'block', marginTop: 14, whiteSpace: 'normal' }}>
            {'\u{26A0}\u{FE0F}'} Rate {PICKS_STREAK_THRESHOLD} landmarks today — or your {soloCount}-day
            streak breaks!
          </p>
        )}
        {soloCount > 0 && !soloStreakAtRisk && (
          <p className="tag tag-free" style={{ display: 'block', marginTop: 14, whiteSpace: 'normal' }}>
            {'\u{2705}'} Your {soloCount}-day streak is safe today
          </p>
        )}
      </div>

      {!onboardingDone && <FinishOnboardingCard onStartOnboarding={() => navigate('/onboarding')} />}
      <DiscoveryStatsCard />

      {closestRival && (
        <div className="card section">
          <p style={{ margin: 0 }}>
            {'\u{1F3AF}'} Closest rival: <strong>{cleanName(closestRival.userName)}</strong> —{' '}
            {(closestRival.points - myPoints).toLocaleString()} pts ahead
          </p>
        </div>
      )}

      {/* Points/leaderboard are secondary now (item 7) -- a lighter heading
          than the Discovery card above it gets, not the page's headline. */}
      <h2 className="screen-title" style={{ fontSize: '1.1rem', opacity: 0.75 }}>
        <span>{'\u{1F3C6}'}</span> Ranks
      </h2>

      <div className="tabs" style={{ justifyContent: 'center', marginBottom: 14 }}>
        <button type="button" className={`tab-btn ${scope === 'friends' ? 'active' : ''}`} aria-pressed={!!(scope === 'friends')} onClick={() => setScope('friends')}>
          Friends
        </button>
        <button type="button" className={`tab-btn ${scope === 'global' ? 'active' : ''}`} aria-pressed={!!(scope === 'global')} onClick={() => setScope('global')}>
          Global
        </button>
      </div>

      {/* 1 — Your hero card */}
      <div className="card section rank-hero">
        {scope === 'global' && (
          <div className="tabs" style={{ justifyContent: 'center', marginBottom: 12 }}>
            <button
              type="button"
              className={`tab-btn ${globalMode === 'global' ? 'active' : ''}`} aria-pressed={!!(globalMode === 'global')}
              onClick={() => setGlobalMode('global')}
            >
              Worldwide
            </button>
            <button
              type="button"
              className={`tab-btn ${globalMode === 'regional' ? 'active' : ''}`} aria-pressed={!!(globalMode === 'regional')}
              onClick={() => setGlobalMode('regional')}
            >
              Regional
            </button>
          </div>
        )}
        {scope === 'global' && globalMode === 'regional' && (
          <div style={{ marginBottom: 12 }}>
            <RegionSearch
              region={getRegion(regionalRegionId) || { name: 'Choose a region' }}
              onSelect={(r) => setRegionalRegionId(r.id)}
            />
          </div>
        )}
        <div className="rank-hero-top">
          <div className="rank-hero-rank">
            {loading ? (
              <Skeleton className="skeleton-inline" width={48} height={30} radius={10} />
            ) : myRank ? (
              `#${myRank}`
            ) : belowBoard ? (
              `${entries.length}+`
            ) : (
              '—'
            )}
          </div>
          <div className="rank-hero-meta">
            <div className="rank-hero-name">{myUsername ? `@${myUsername}` : user.displayName || 'Explorer'}</div>
            <div className="rank-hero-pts">
              {loading ? <Skeleton className="skeleton-inline" width={56} height={18} /> : myPoints.toLocaleString()}{' '}
              <span>pts {PERIOD_LABEL[period].toLowerCase()}</span>
            </div>
          </div>
        </div>
        <div className="rank-hero-motivator">{motivator}</div>
        <div className="tabs" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <button key={t.id} className={`tab-btn ${tab === t.id ? 'active' : ''}`} aria-pressed={!!(tab === t.id)} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 2 — Leaderboard */}
      <div className="section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>
            {'\u{1F3C6}'} {leaderboardLabel}
          </h3>
          {!loading && !loadError && entries.length > 0 && scope === 'global' && globalMode === 'global' && (
            <button
              type="button"
              className="btn btn-ghost btn-tight"
              onClick={() => navigate(`/leaderboard/full?period=${period}`)}
            >
              See Full List
            </button>
          )}
        </div>
        {loading && <SkeletonList count={5} variant="rank" label="Loading rankings" />}
        {!loading && loadError && (
          <ErrorNotice
            message={friendlyError(loadError, "We couldn't load the rankings. Check your connection and try again.")}
            onRetry={() => setLoadAttempt((n) => n + 1)}
          />
        )}
        {!loading && !loadError && entries.length === 0 && (
          <div className="empty-state">
            <p>No points yet {PERIOD_LABEL[period].toLowerCase()} — check in to be first!</p>
          </div>
        )}

        {!loading && top3.length > 0 && (
          <div className="podium">
            {podiumOrder.map((e, i) =>
              e ? (
                <div
                  key={e.id}
                  className={`podium-slot podium-${i === 1 ? 'first' : i === 0 ? 'second' : 'third'} ${
                    e.userId === user.uid ? 'me' : ''
                  }`}
                >
                  <div className="podium-medal">{MEDAL[i === 1 ? 0 : i === 0 ? 1 : 2]}</div>
                  <div className="podium-name">
                    <FriendPopoverName userId={e.userId} fallbackName={displayFor(e)}>
                      {displayFor(e)}
                    </FriendPopoverName>
                    {e.userId === user.uid && <span className="leaderboard-you-tag">You</span>}
                  </div>
                  <div className="podium-pts">{e.points.toLocaleString()}</div>
                </div>
              ) : (
                <div key={`empty-${i}`} className="podium-slot podium-empty" />
              )
            )}
          </div>
        )}

        {!loading && rest.map((e, idx) => (
          <div key={e.id} className={`leaderboard-row ${e.userId === user.uid ? 'me' : ''}`}>
            <div className="leaderboard-rank">#{rankOf(entries, idx + 3)}</div>
            <div className="leaderboard-name" style={{ flex: 1 }}>
              <FriendPopoverName userId={e.userId} fallbackName={displayFor(e)}>
                {displayFor(e)}
              </FriendPopoverName>
              {e.userId === user.uid && <span className="leaderboard-you-tag">You</span>}
            </div>
            <div style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-brass-bright)', fontWeight: 700 }}>
              {e.points.toLocaleString()} pts
            </div>
          </div>
        ))}

      </div>

      {/* 3 — Friends & invite */}
      <div className="section">
        <InviteButton myUsername={myUsername} />
      </div>
      <FriendsPanel />

      <Link to="/settings" className="btn btn-ghost btn-block" style={{ marginTop: 20 }}>
        {'\u{2699}\u{FE0F}'} Settings
      </Link>
      <button className="btn btn-ghost btn-block" style={{ marginTop: 12 }} disabled={signingOut} onClick={handleSignOut}>
        Sign Out
      </button>
    </div>
  );
}

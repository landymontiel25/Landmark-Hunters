import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { useTrip } from '../lib/TripContext';
import { useCheckIn } from '../lib/useCheckIn';
import { useGeo } from '../lib/GeoContext';
import { useUnits, formatDistance } from '../lib/UnitsContext';
import {
  subscribeLeaderboard,
  getFriendsLeaderboard,
  getRegionalLeaderboard,
  backfillUserName,
  cleanName,
} from '../lib/leaderboard';
import { getUserProfile, setBackgroundLocationEnabled } from '../lib/friends';
import { requestAlwaysPermission } from '../lib/backgroundLocation';
import { useRatings } from '../lib/RatingsContext';
import { RATING_GOAL } from '../lib/ratingFlow';
import { getRegion, REGIONS, ALL_LANDMARKS } from '../data/regions';
import { distanceMeters } from '../lib/geo';
import { useBadges } from '../lib/BadgesContext';
import { PICKS_STREAK_THRESHOLD } from '../lib/streaks';
import { claimMyReferralBonuses } from '../lib/referrals';
import { completeOnboarding, hasCompletedOnboardingLocally, markOnboardingCompletedLocally } from '../lib/onboarding';
import FriendsPanel from '../components/FriendsPanel';
import SignInForm from '../components/SignInForm';
import TasteIntroStep from './TasteIntroStep';
import PreferenceChips from '../components/PreferenceChips';
import LandmarkThumb from '../components/LandmarkThumb';
import FriendPopoverName from '../components/FriendPopoverName';
import CheckInButton from '../components/CheckInButton';
import RegionSearch from '../components/RegionSearch';
import MaprPicksCarousel from '../components/MaprPicksCarousel';
import { usePairStreaks } from '../lib/PairStreakContext';
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

// Shown once, right after creating an account -- gets your usual interests
// saved before you ever see Setup, so "Use My Preferences" already has
// something to apply on your very first trip.
function OnboardingPreferences({ onDone }) {
  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F389}'}</span> Welcome!
      </h1>
      <p className="screen-subtitle">
        What are you usually into? Save it now and Setup can fill it in for you on every trip from here on.
      </p>
      <PreferenceChips />
      <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 20 }} onClick={onDone}>
        Continue {'\u{2192}'}
      </button>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onDone}>
        Skip for now
      </button>
    </div>
  );
}

// Last onboarding step -- surfaces the nearest landmark to your current GPS
// fix with a one-tap check-in, so a brand-new account can earn its first
// point immediately instead of hunting through the map. Reaching this step
// (whether or not you actually check in) is what completes onboarding.
function FirstCheckInStep({ onDone }) {
  const { user, firebaseEnabled, claimedMap, checkingIn, checkIn } = useCheckIn();
  const { myProfile, myUsername, reload: reloadFriends } = useFriends();
  const { coords, loading: geoLoading } = useGeo();
  const { units } = useUnits();
  // Surfaced in the UI (not just the console) since the previous silent
  // failure mode -- onboardingCompleted not sticking past a reload -- turned
  // out to need an actual error message from the field to diagnose, and
  // most people testing this aren't going to open devtools to get one.
  const [saveError, setSaveError] = useState(null);
  const [saveAttempt, setSaveAttempt] = useState(0);

  useEffect(() => {
    if (!user || myProfile?.onboardingCompleted || hasCompletedOnboardingLocally(user.uid)) return;
    setSaveError(null);
    completeOnboarding(user.uid, myUsername || user.displayName || 'Explorer')
      .then(async () => {
        // Permanent local guard, same idea as BadgesContext's celebration
        // guard: mark this done on this device the moment the write
        // succeeds, so "Finish Onboarding" can never reappear here again
        // regardless of what a later reload's Firestore read comes back
        // with. The Firestore flag is still the source of truth for other
        // devices/badges -- this is just insurance against it not sticking.
        markOnboardingCompletedLocally(user.uid);
        await reloadFriends();
        // Read back directly (bypassing FriendsContext's own cache/state)
        // so a write that silently didn't stick shows up right here instead
        // of only reappearing as "Finish Onboarding" on the next reload.
        const fresh = await getUserProfile(user.uid);
        if (!fresh?.onboardingCompleted) {
          console.error('[Onboarding] wrote onboardingCompleted but read-back shows it unset:', fresh);
          setSaveError("Saved, but it didn't stick server-side -- please screenshot this and send it over.");
        }
      })
      .catch((err) => {
        console.error('[Onboarding] completeOnboarding failed:', err);
        // Details stay in the console; the screen gets a plain sentence.
        setSaveError(friendlyError(err, "Couldn't finish setting up your account. Try again."));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, myProfile?.onboardingCompleted, saveAttempt]);

  const nearest = (() => {
    if (!coords) return null;
    let best = null;
    let bestDist = Infinity;
    for (const l of ALL_LANDMARKS) {
      const d = distanceMeters(coords.lat, coords.lng, l.lat, l.lng);
      if (d < bestDist) {
        bestDist = d;
        best = l;
      }
    }
    return best ? { landmark: best, meters: bestDist } : null;
  })();

  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F4CD}'}</span> Your First Check-In
      </h1>
      <p className="screen-subtitle">One tap to earn your first point.</p>

      {saveError && <ErrorNotice compact message={saveError} onRetry={() => setSaveAttempt((n) => n + 1)} />}

      {!coords && (
        <p className="screen-subtitle">{geoLoading ? 'Finding your location…' : "Can't find your location right now."}</p>
      )}

      {nearest && (
        <div className="card section" style={{ textAlign: 'center' }}>
          <LandmarkThumb landmark={nearest.landmark} size={96} />
          <h3 style={{ marginBottom: 4 }}>{nearest.landmark.name}</h3>
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            {formatDistance(nearest.meters, units)} away
          </p>
          <CheckInButton
            landmark={nearest.landmark}
            user={user}
            firebaseEnabled={firebaseEnabled}
            claimedMap={claimedMap}
            checkingIn={checkingIn}
            onCheckIn={checkIn}
            className="btn-block"
          />
        </div>
      )}

      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onDone}>
        {claimedMap[nearest?.landmark?.id] ? 'Continue' : 'Skip for now'}
      </button>
    </div>
  );
}

// Final onboarding step -- asks to upgrade from "When In Use" (already
// granted by now, since FirstCheckInStep just used GPS) to "Always", so Mapr
// can keep learning your taste and location even with the app closed (see
// src/lib/backgroundLocation.js). Comes last on purpose: this native
// permission dialog reads as a bigger ask than the others, so it only shows
// up once someone has already gotten value from the app. Skippable, and
// re-offered anytime from Settings.
function LocationAlwaysStep({ onDone }) {
  const { user } = useAuth();
  const [enabling, setEnabling] = useState(false);
  const [err, setErr] = useState(null);

  const enable = async () => {
    setEnabling(true);
    setErr(null);
    try {
      const authorized = await requestAlwaysPermission();
      if (!authorized) {
        setErr('Location access is off for Landmark Hunters. You can turn it on later from Settings or iOS Settings.');
        return;
      }
      await setBackgroundLocationEnabled(user.uid, true);
      onDone();
    } catch (e) {
      setErr(friendlyError(e, "Couldn't turn that on. You can enable it later from Settings."));
    } finally {
      setEnabling(false);
    }
  };

  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F30D}'}</span> Always Know Where You Are
      </h1>
      <p className="screen-subtitle">
        Turn this on and Mapr keeps learning even when the app is closed -- so the moment you land somewhere new,
        it's already building picks for that city instead of starting from scratch when you open the app.
      </p>
      {err && <ErrorNotice compact message={err} />}
      <button type="button" className="btn btn-primary btn-block" onClick={enable} disabled={enabling}>
        {enabling ? 'Enabling…' : 'Always Allow Location'}
      </button>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onDone}>
        Not now
      </button>
    </div>
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
  const { user, firebaseEnabled, signOutUser } = useAuth();
  const { myUsername, friendUids, myProfile } = useFriends();
  const { trip } = useTrip();
  const navigate = useNavigate();
  const { stats, streakDays, checkedInToday, actionsToday } = useBadges();
  const { claimedMap } = useCheckIn();

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
  const [onboardingStep, setOnboardingStep] = useState(null); // null | 'preferences' | 'tasteIntro' | 'checkin' | 'locationAlways'
  const { streaks } = usePairStreaks();
  const bestStreak = streaks.length ? Math.max(...streaks.map((s) => s.count)) : 0;
  const healedRef = useRef(false);
  const [streakInfoOpen, setStreakInfoOpen] = useState(false);

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

  if (!user) return <SignInForm onSignedUp={() => setOnboardingStep('preferences')} />;

  if (onboardingStep === 'preferences') return <OnboardingPreferences onDone={() => setOnboardingStep('tasteIntro')} />;
  if (onboardingStep === 'tasteIntro') return <TasteIntroStep onDone={() => setOnboardingStep('checkin')} />;
  if (onboardingStep === 'checkin') return <FirstCheckInStep onDone={() => setOnboardingStep('locationAlways')} />;
  if (onboardingStep === 'locationAlways') return <LocationAlwaysStep onDone={() => setOnboardingStep(null)} />;

  const myIdx = entries.findIndex((e) => e.userId === user.uid);
  const myPoints = myIdx >= 0 ? entries[myIdx].points : 0;
  const myRank = myIdx >= 0 ? myIdx + 1 : null;

  const displayFor = (e) => (e.userId === user.uid && myUsername ? myUsername : cleanName(e.userName));

  let motivator;
  if (loading) {
    motivator = <Skeleton width="70%" height={13} />;
  } else if (loadError) {
    motivator = '';
  } else if (myIdx < 0) {
    motivator = 'Check in at a landmark to get on the board! 🚀';
  } else if (myIdx === 0) {
    motivator = "👑 You're #1 — don't let anyone catch you!";
  } else {
    const above = entries[myIdx - 1];
    const gap = above.points - myPoints;
    motivator = `${gap.toLocaleString()} pts behind ${cleanName(above.userName)} 🔥`;
  }

  const top3 = entries.slice(0, 3);
  const podiumOrder = [top3[1], top3[0], top3[2]]; // 2nd · 1st · 3rd
  const rest = entries.slice(3);
  const myRowOutside = myIdx >= 3;

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

  // Solo streak urgency: you have an active solo streak from a prior day,
  // but haven't checked in yet today -- it lapses if today passes with no
  // check-in. Independent of the dual streak (bestStreak above).
  const streakAtRisk = streakDays > 0 && !checkedInToday;

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
              {stats ? stats.checkins.toLocaleString() : <Skeleton className="skeleton-inline" width={36} height={22} />}
            </span>
            <span className="profile-stat-label">check-ins{stats?.checkins ? ' ›' : ''}</span>
          </button>
          <button
            type="button"
            className="profile-stat profile-stat-btn"
            onClick={() => stats?.cityIds?.length && navigate('/cities')}
          >
            <span className="profile-stat-num">{stats ? stats.cities : <Skeleton className="skeleton-inline" width={28} height={22} />}</span>
            <span className="profile-stat-label">cities{stats?.cityIds?.length ? ' ›' : ''}</span>
          </button>
          <button type="button" className="profile-stat profile-stat-btn" onClick={() => navigate('/streaks')}>
            <span className="profile-stat-num">{bestStreak}</span>
            <span className="profile-stat-label">streak ›</span>
          </button>
          <div style={{ position: 'relative', flex: 1 }}>
            <button
              type="button"
              className="profile-stat profile-stat-btn"
              style={{ width: '100%' }}
              onClick={() => setStreakInfoOpen((v) => !v)}
              aria-expanded={streakInfoOpen}
            >
              <span className="profile-stat-num">{streakDays}{streakDays > 0 ? ' \u{1F525}' : ''}</span>
              <span className="profile-stat-label">day streak {streakInfoOpen ? '\u{25BE}' : '\u{25B8}'}</span>
            </button>
            {streakInfoOpen && (
              <div className="streak-info-popover">
                <p style={{ margin: 0, fontWeight: 700 }}>Two ways to keep your streak alive each day:</p>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  <li>Check in at any landmark, or</li>
                  <li>
                    Vote {'\u{2713}'}/{'\u{2715}'} or rate {actionsToday}/{PICKS_STREAK_THRESHOLD} landmarks
                    below — even without checking in anywhere
                  </li>
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="rating-progress">
          {ratingsCount >= RATING_GOAL ? (
            <>
              <strong>{ratingsCount} rated</strong> — Mapr knows your taste.
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
        <MaprPicksCarousel
          reviews={myReviews}
          interests={trip.savedInterests}
          checkedInIds={Object.keys(claimedMap)}
          regionIds={[...(stats?.cityIds || []), ...(trip.activeRegion ? [trip.activeRegion] : [])]}
        />

        {streakAtRisk && (
          <p className="tag tag-error" style={{ display: 'block', marginTop: 14 }}>
            {'\u{26A0}\u{FE0F}'} Check in, or vote/rate {actionsToday}/{PICKS_STREAK_THRESHOLD} landmarks
            today — or your {streakDays}-day streak breaks!
          </p>
        )}
        {streakDays > 0 && checkedInToday && (
          <p className="tag tag-free" style={{ display: 'block', marginTop: 14 }}>
            {'\u{2705}'} Your {streakDays}-day streak is safe today
          </p>
        )}
      </div>

      {!onboardingDone && <FinishOnboardingCard onStartOnboarding={() => setOnboardingStep('checkin')} />}
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
        <button type="button" className={`tab-btn ${scope === 'friends' ? 'active' : ''}`} onClick={() => setScope('friends')}>
          Friends
        </button>
        <button type="button" className={`tab-btn ${scope === 'global' ? 'active' : ''}`} onClick={() => setScope('global')}>
          Global
        </button>
      </div>

      {/* 1 — Your hero card */}
      <div className="card section rank-hero">
        {scope === 'global' && (
          <div className="tabs" style={{ justifyContent: 'center', marginBottom: 12 }}>
            <button
              type="button"
              className={`tab-btn ${globalMode === 'global' ? 'active' : ''}`}
              onClick={() => setGlobalMode('global')}
            >
              Worldwide
            </button>
            <button
              type="button"
              className={`tab-btn ${globalMode === 'regional' ? 'active' : ''}`}
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
            {loading ? <Skeleton className="skeleton-inline" width={48} height={30} radius={10} /> : myRank ? `#${myRank}` : '—'}
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
            <button key={t.id} className={`tab-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
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
            <div className="leaderboard-rank">#{idx + 4}</div>
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

        {!loading && myRowOutside && (
          <div className="leaderboard-row me" style={{ marginTop: 8 }}>
            <div className="leaderboard-rank">#{myRank}</div>
            <div className="leaderboard-name" style={{ flex: 1 }}>
              {myUsername ? `@${myUsername}` : 'You'}
              <span className="leaderboard-you-tag">You</span>
            </div>
            <div style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-brass-bright)', fontWeight: 700 }}>
              {myPoints.toLocaleString()} pts
            </div>
          </div>
        )}
      </div>

      {/* 3 — Friends & invite */}
      <div className="section">
        <InviteButton myUsername={myUsername} />
      </div>
      <FriendsPanel />

      <Link to="/settings" className="btn btn-ghost btn-block" style={{ marginTop: 20 }}>
        {'\u{2699}\u{FE0F}'} Settings
      </Link>
      <button className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={signOutUser}>
        Sign Out
      </button>
    </div>
  );
}

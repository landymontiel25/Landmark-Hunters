import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { firebaseEnabled } from './firebase';
import {
  upsertUserProfile,
  listFriends,
  listIncomingRequests,
  getUserProfile,
  subscribeUserProfile,
  subscribeMyPrivateProfile,
  migratePrivateProfile,
  publishAdminPointer,
  claimUsername,
} from './friends';
import { listBlockedUsers } from './blocks';
import { isAdmin } from './admins';
import { backfillUserName } from './leaderboard';
import { syncMyReviewVisibility } from './reviews';

// Current user's profile (incl. username), friend set (for deciding whose photos
// you can see), and pending incoming requests. Upserts your profile on sign-in.
const FriendsContext = createContext(null);

// Cache the profile so your username is available instantly on launch and can't
// vanish (falling back to your email) if a profile read hiccups on cold start.
const PROFILE_CACHE = 'landmarkhunters.profile.v1';
function loadCachedProfile(uid) {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_CACHE) || 'null');
    return p && p.uid === uid ? p : null;
  } catch {
    return null;
  }
}
function cacheProfile(uid, profile) {
  try {
    localStorage.setItem(PROFILE_CACHE, JSON.stringify({ uid, ...profile }));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}

// The very first profile read of a session can lose a race with Firebase
// Auth/Firestore still wiring up the ID token right after sign-in/app
// launch -- one transient failure there used to mean falling back to
// whatever was in localStorage (stale -- e.g. from before a taste baseline
// was ever saved) and then just staying on it until SOMETHING else
// happened to call reload() again (the taste editor's own close handler
// was the only thing that ever did), which is exactly why the Taste
// Profile card only ever "loaded in" after interacting with Edit instead
// of the moment the app opened. A couple of quick retries covers that
// startup race without needing any user interaction to recover.
const PROFILE_FETCH_RETRIES = 2;
async function fetchProfileWithRetry(uid) {
  for (let attempt = 0; attempt <= PROFILE_FETCH_RETRIES; attempt++) {
    try {
      const profile = await getUserProfile(uid);
      if (profile) return profile;
    } catch (e) {
      if (attempt === PROFILE_FETCH_RETRIES) throw e;
    }
    if (attempt < PROFILE_FETCH_RETRIES) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  return null;
}

export function FriendsProvider({ children }) {
  const { user } = useAuth();
  const [friendUids, setFriendUids] = useState(() => new Set());
  const [requests, setRequests] = useState([]);
  const [publicProfile, setMyProfile] = useState(null);
  // Email, home address/coords, last location, push tokens: owner-only doc,
  // merged into myProfile below so screens keep reading myProfile.homeCoords.
  const [myPrivate, setMyPrivate] = useState(null);
  const myProfile = useMemo(
    () => (publicProfile && myPrivate ? { ...publicProfile, ...myPrivate } : publicProfile),
    [publicProfile, myPrivate]
  );
  // True only once a REAL server read of this profile has landed this
  // session -- the instant cache pre-fill below is just for display (so a
  // username doesn't flash blank), and must never be mistaken for a
  // confirmed read of badgeEarnedAt. Trusting the cache there caused the
  // "same badge celebrates every login" bug: the cache can be stale
  // (missing a badge persisted since it was last written), which made
  // BadgesContext think an old badge was newly earned, over and over.
  const [profileFresh, setProfileFresh] = useState(false);

  // uid the provider is currently showing. A slow reload() started for the
  // previous account must not write its results into the next account's state.
  const activeUidRef = useRef(null);
  const shownUidRef = useRef(null);
  activeUidRef.current = user?.uid ?? null;

  const reload = useCallback(async () => {
    if (!firebaseEnabled || !user) {
      setFriendUids(new Set());
      setRequests([]);
      setMyProfile(null);
      setMyPrivate(null);
      setProfileFresh(false);
      return;
    }
    // Load each independently — one failing query must never hide the others
    // (a friends-rule hiccup should not wipe out your saved username), and
    // the profile lands the moment ITS read resolves rather than waiting
    // for the friends/requests queries too: on a cold start those all
    // compete with every other boot-time query, and the profile is what
    // the Taste Profile card (and the taste nudge) are sitting on.
    const uid = user.uid;
    const stale = () => activeUidRef.current !== uid;
    const profileDone = fetchProfileWithRetry(uid).then(
      (profile) => {
        if (stale()) return;
        if (profile) {
          setMyProfile(profile);
          cacheProfile(user.uid, profile);
          setProfileFresh(true);
          return;
        }
        // The doc genuinely doesn't exist yet -- only fall back to the
        // localStorage snapshot when there's nothing better in memory.
        setMyProfile((cur) => cur ?? loadCachedProfile(user.uid));
      },
      (err) => {
        if (stale()) return;
        // Read failed even after retrying. Logged (not just swallowed) so
        // a real read failure shows up somewhere instead of silently
        // serving stale cached data forever. Only ever fall back to the
        // localStorage snapshot when there's nothing better already in
        // memory (the very first load) -- a LATER hiccup must never regress
        // already-correct data back to an older cached copy that could be
        // missing something saved since (a taste baseline edit, say).
        console.error('[FriendsContext] getUserProfile failed on reload:', err);
        setMyProfile((cur) => cur ?? loadCachedProfile(user.uid));
      }
    );
    const [, f, r, b] = await Promise.allSettled([
      profileDone,
      listFriends(uid),
      listIncomingRequests(uid),
      listBlockedUsers(uid),
    ]);
    if (stale()) return;
    if (f.status === 'fulfilled') setFriendUids(new Set((f.value || []).map((x) => x.friend)));
    // A request someone sent before you blocked them is still in Firestore
    // (and the rules would still let you accept it) -- don't list it.
    const blockedUids = new Set(b.status === 'fulfilled' ? (b.value || []).map((x) => x.blockedUid) : []);
    if (r.status === 'fulfilled') setRequests((r.value || []).filter((req) => !blockedUids.has(req.from)));
  }, [user]);

  useEffect(() => {
    // Reset on every user change (including re-signing into the same
    // account) so the cache pre-fill below is never mistaken for this
    // session's confirmed read -- a real server snapshot is what flips it
    // back on.
    setProfileFresh(false);
    if (!firebaseEnabled || !user) {
      shownUidRef.current = null;
      reload();
      return undefined;
    }
    // Switching straight from one account to another: drop the previous
    // account's profile/friends/requests now instead of showing them until
    // the new account's reads land (or forever, if they fail).
    const accountChanged = shownUidRef.current !== user.uid;
    shownUidRef.current = user.uid;
    if (accountChanged) {
      setFriendUids(new Set());
      setRequests([]);
      setMyPrivate(null);
    }
    // Show the cached username immediately, then let the live listener
    // replace it the moment the server copy arrives.
    const cached = loadCachedProfile(user.uid);
    if (accountChanged) setMyProfile(cached);
    else if (cached) setMyProfile((cur) => cur ?? cached);
    upsertUserProfile(user).catch(() => {});
    // The profile rides a live listener, not the one-shot read in reload():
    // on app open, a getDoc fired the instant auth restores could lose that
    // race and then nothing asked again until something else happened to
    // call reload() (the taste editor's close handler was the only thing
    // that did -- which is exactly why picks only ever "loaded in" after
    // Edit -> X). A listener can't miss: Firestore re-syncs it itself once
    // auth/connection are ready, and every later save lands here on its
    // own, app-wide, with no reload() needed.
    const unsubscribe = subscribeUserProfile(
      user.uid,
      (profile, { fresh }) => {
        setMyProfile(profile);
        // Pre-split accounts: move email/home/location/tokens off the public doc.
        if (fresh) migratePrivateProfile(user.uid, profile, user.email).catch(() => {});
        if (fresh) {
          cacheProfile(user.uid, profile);
          setProfileFresh(true);
        }
      },
      (err) => console.error('[FriendsContext] profile listener failed:', err)
    );
    const unsubscribePrivate = subscribeMyPrivateProfile(
      user.uid,
      (data) => setMyPrivate(data),
      (err) => console.error('[FriendsContext] private profile listener failed:', err)
    );
    if (isAdmin(user.email)) publishAdminPointer(user.uid).catch(() => {});
    // Friends/requests (and a belt-and-braces profile read) still load here.
    reload();
    return () => {
      unsubscribe();
      unsubscribePrivate();
    };
  }, [user, reload]);

  // Once per session (and whenever privacy changes): make sure your reviews
  // carry your current privacy, so they show in landmark Comments to the
  // right people -- including reviews saved before that copy existed.
  const syncedRef = useRef(null);
  useEffect(() => {
    if (!user || !profileFresh || !myProfile) return;
    const key = `${user.uid}:${!!myProfile.public}`;
    if (syncedRef.current === key) return;
    syncedRef.current = key;
    syncMyReviewVisibility(user.uid, !!myProfile.public).catch(() => {});
  }, [user, profileFresh, myProfile]);

  const setUsername = useCallback(
    async (name) => {
      const uname = await claimUsername(user, name);
      // Rewrite past check-ins / leaderboard rows so they show the username
      // (not an email or old handle). Non-fatal if it can't run.
      backfillUserName(user.uid, uname).catch(() => {});
      await reload();
      return uname;
    },
    [user, reload]
  );

  return (
    <FriendsContext.Provider
      value={{
        friendUids,
        requests,
        myProfile,
        profileFresh,
        myUsername: myProfile?.username || null,
        setUsername,
        reload,
      }}
    >
      {children}
    </FriendsContext.Provider>
  );
}

export function useFriends() {
  const ctx = useContext(FriendsContext);
  if (!ctx) throw new Error('useFriends must be used inside FriendsProvider');
  return ctx;
}

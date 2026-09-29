import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { useTheme } from '../lib/useTheme';
import { useUnits, countryName } from '../lib/UnitsContext';
import {
  setProfileVisibility,
  getUserProfile,
  saveHomeLocation,
  saveTasteIntro,
  setHabitTrackingEnabled,
  setBackgroundLocationEnabled,
  setPushNotificationsEnabled,
  savePushToken,
} from '../lib/friends';
import { requestAlwaysPermission } from '../lib/backgroundLocation';
import { requestPushPermission, getPushToken } from '../lib/pushNotifications';
import { authHeaders } from '../lib/apiAuth';
import { useAdminMode } from '../lib/AdminModeContext';
import { authErrorMessage } from '../lib/authErrors';
import PreferenceChips from '../components/PreferenceChips';
import LocationAutocomplete from '../components/LocationAutocomplete';
import ErrorNotice from '../components/ErrorNotice';
import { useToast, runOptimistic } from '../lib/ToastContext';
import { friendlyError } from '../lib/friendlyError';
import { usePersistentState, readPersisted } from '../lib/usePersistentState';
import { API_BASE } from '../lib/apiBase';

const isNull = (v) => v == null;

// A Settings text field whose unsaved edits survive leaving the screen.
// The server copy (`saved`, from myProfile) is what shows until you type;
// from then on your draft wins -- including over a profile read that lands
// late -- until it's saved (or discarded). `restored` is true when a draft
// from an earlier visit was brought back and still differs from the
// server copy, so the screen can say so.
function useDraft(key, saved, same = (a, b) => a === b) {
  const [draft, setDraft] = usePersistentState(key, null, { isEmpty: isNull });
  const [hadDraft, setHadDraft] = useState(() => (key ? readPersisted(key) != null : false));
  const value = draft ?? saved;
  const restored = hadDraft && draft != null && !same(draft, saved);
  const discard = () => {
    setDraft(null);
    setHadDraft(false);
  };
  // Only drops the draft if it's still exactly what was saved -- anything
  // typed while the save was in flight stays.
  const settle = (sent) => setDraft((cur) => (cur != null && same(cur, sent) ? null : cur));
  return { value, setDraft, restored, discard, settle };
}

function DraftRestoredNote({ onDiscard }) {
  return (
    <p className="draft-restored-note">
      Unsaved changes restored {'\u{00B7}'}{' '}
      <button type="button" onClick={onDiscard}>
        Discard
      </button>
    </p>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const { user, firebaseEnabled, signOutUser, resendVerification, refreshUser, changePassword } = useAuth();
  const { myProfile, reload: reloadFriends } = useFriends();
  const { theme, toggleTheme } = useTheme();
  const { units, mode, setMode, autoCountry } = useUnits();
  const { adminMode, canUseAdminMode, setAdminMode } = useAdminMode();
  const toast = useToast();
  const uid = user?.uid;
  // Privacy flips instantly; visOverride holds the new value until the
  // server confirms (then myProfile carries it) or it's rolled back.
  const [visOverride, setVisOverride] = useState(null);
  const visInFlightRef = useRef(false);
  const isPublic = visOverride ?? !!myProfile?.public;
  const [habitOverride, setHabitOverride] = useState(null);
  const habitInFlightRef = useRef(false);
  const habitTrackingEnabled = habitOverride ?? myProfile?.habitTrackingEnabled !== false;
  const [bgLocationOverride, setBgLocationOverride] = useState(null);
  const bgLocationInFlightRef = useRef(false);
  const [bgLocationErr, setBgLocationErr] = useState(null);
  // Opt-in (unlike habit tracking above), since turning this on means asking
  // iOS for "Always" location -- absence of the field means off.
  const backgroundLocationEnabled = bgLocationOverride ?? !!myProfile?.backgroundLocationEnabled;
  const [pushOverride, setPushOverride] = useState(null);
  const pushInFlightRef = useRef(false);
  const [pushErr, setPushErr] = useState(null);
  const [pushTestMsg, setPushTestMsg] = useState(null);
  // Opt-in, off by default -- turning this on asks for the OS notification
  // permission, same reasoning as background location above.
  const pushNotificationsEnabled = pushOverride ?? !!myProfile?.pushNotificationsEnabled;
  // Drafts are per account (uid in the key). myProfile loads asynchronously
  // (FriendsContext); until you type, each field simply shows the server copy
  // whenever it lands. The taste-intro key is shared with onboarding's
  // onboarding's notes step, so text typed there but never saved shows up here.
  const home = useDraft(uid ? `homeAddress.${uid}` : null, myProfile?.homeAddress || '');
  // Shown as "Saved: …" right away after picking an address, before the
  // server write (and profile reload) confirm it.
  const [homePending, setHomePending] = useState(null);
  const taste = useDraft(uid ? `tasteIntro.${uid}` : null, myProfile?.tasteIntro || '');
  const [tasteMsg, setTasteMsg] = useState(null);
  const homeAddress = home.value;
  const tasteIntro = taste.value;
  const [verifyMsg, setVerifyMsg] = useState(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState(null);
  const [passwordBusy, setPasswordBusy] = useState(false);

  // Catches "verified in another tab, then came back to Settings" without
  // requiring a full sign-out/sign-in.
  useEffect(() => {
    if (user && !user.emailVerified) refreshUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Saves below are optimistic: "Saved." shows (and the field stays
  // editable) right away; the draft is only dropped once the write lands,
  // so a failure loses nothing -- it just says so, with Retry.
  const saveTaste = () => {
    const text = tasteIntro;
    runOptimistic({
      apply: () => setTasteMsg('Saved.'),
      commit: async () => {
        await saveTasteIntro(user.uid, text);
        await reloadFriends();
        taste.settle(text);
      },
      rollback: () => setTasteMsg(null),
      toast,
      errorMessage: friendlyError(null, "Couldn't save what you love. Your text is still here."),
      retry: saveTaste,
    });
  };

  const pickHome = (s) => {
    home.setDraft(s.primary);
    runOptimistic({
      apply: () => setHomePending(s.primary),
      commit: async () => {
        await saveHomeLocation(user.uid, { address: s.primary, lat: s.lat, lng: s.lng });
        await reloadFriends();
        home.settle(s.primary);
        setHomePending(null);
      },
      rollback: () => setHomePending(null),
      toast,
      errorMessage: friendlyError(null, "Couldn't save your home address. It's still typed in."),
      retry: () => pickHome(s),
    });
  };

  const toggleVisibility = () => {
    // One write at a time -- a second tap mid-flight would race the
    // read-back check below.
    if (visInFlightRef.current) return;
    visInFlightRef.current = true;
    const next = !isPublic;
    runOptimistic({
      apply: () => setVisOverride(next),
      commit: async () => {
        await setProfileVisibility(user.uid, next);
        // Read straight back from the server (not the cache) to confirm the
        // write actually stuck -- surfaces a rules/permission problem right
        // away instead of only discovering it on the next reload.
        const fresh = await getUserProfile(user.uid);
        if (!fresh || !!fresh.public !== next) throw new Error('Visibility did not persist');
        await reloadFriends();
      },
      rollback: () => setVisOverride(null),
      toast,
      errorMessage: friendlyError(null, `Couldn't make your profile ${next ? 'public' : 'private'}, so it's back to ${next ? 'private' : 'public'}.`),
      retry: toggleVisibility,
    }).finally(() => {
      visInFlightRef.current = false;
      // Server truth (myProfile) takes over again either way.
      setVisOverride(null);
    });
  };

  const toggleHabitTracking = () => {
    if (habitInFlightRef.current) return;
    habitInFlightRef.current = true;
    const next = !habitTrackingEnabled;
    runOptimistic({
      apply: () => setHabitOverride(next),
      commit: async () => {
        await setHabitTrackingEnabled(user.uid, next);
        await reloadFriends();
      },
      rollback: () => setHabitOverride(null),
      toast,
      errorMessage: friendlyError(null, `Couldn't turn ${next ? 'on' : 'off'} habit tracking.`),
      retry: toggleHabitTracking,
    }).finally(() => {
      habitInFlightRef.current = false;
      setHabitOverride(null);
    });
  };

  const toggleBackgroundLocation = async () => {
    if (bgLocationInFlightRef.current) return;
    bgLocationInFlightRef.current = true;
    setBgLocationErr(null);
    const next = !backgroundLocationEnabled;
    try {
      if (next) {
        // Turning it ON needs iOS's "Always" permission dialog, which can
        // genuinely be declined -- that's not a network failure to retry,
        // so this skips runOptimistic's apply-then-rollback dance and just
        // asks first.
        const authorized = await requestAlwaysPermission();
        if (!authorized) {
          setBgLocationErr('Location access is off for Landmark Hunters. Turn it on in iOS Settings, then try again here.');
          return;
        }
      }
      setBgLocationOverride(next);
      await setBackgroundLocationEnabled(user.uid, next);
      await reloadFriends();
    } catch (e) {
      setBgLocationErr(friendlyError(e, `Couldn't turn ${next ? 'on' : 'off'} background location.`));
    } finally {
      bgLocationInFlightRef.current = false;
      setBgLocationOverride(null);
    }
  };

  const togglePushNotifications = async () => {
    if (pushInFlightRef.current) return;
    pushInFlightRef.current = true;
    setPushErr(null);
    setPushTestMsg(null);
    const next = !pushNotificationsEnabled;
    try {
      if (next) {
        // Same reasoning as background location: a genuine "no" at the OS
        // prompt isn't a network failure to retry, so ask first.
        const granted = await requestPushPermission();
        if (!granted) {
          setPushErr('Notifications are off for Landmark Hunters. Turn them on in iOS Settings, then try again here.');
          return;
        }
        const token = await getPushToken();
        if (token) await savePushToken(user.uid, token, 'ios');
      }
      setPushOverride(next);
      await setPushNotificationsEnabled(user.uid, next);
      await reloadFriends();
    } catch (e) {
      setPushErr(friendlyError(e, `Couldn't turn ${next ? 'on' : 'off'} notifications.`));
    } finally {
      pushInFlightRef.current = false;
      setPushOverride(null);
    }
  };

  const sendTestPush = async () => {
    setPushTestMsg('Sending…');
    try {
      const r = await fetch(`${API_BASE}/api/push-test`, { method: 'POST', headers: await authHeaders() });
      const data = await r.json().catch(() => null);
      if (!r.ok || data?.error) throw new Error(data?.error || `HTTP ${r.status}`);
      setPushTestMsg("Sent -- it should arrive any moment.");
    } catch (e) {
      setPushTestMsg(friendlyError(e, "Couldn't send a test notification."));
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordMsg(null);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMsg('Please fill in all fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg("New passwords don't match.");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordMsg('New password must be different from current password.');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMsg('New password must be at least 6 characters.');
      return;
    }
    setPasswordBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordMsg('Password changed successfully.');
      setTimeout(() => {
        setChangePasswordOpen(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordMsg(null);
      }, 1500);
    } catch (e) {
      setPasswordMsg(authErrorMessage(e) || 'Could not change password.');
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{2699}\u{FE0F}'}</span> Settings
      </h1>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginBottom: 24 }} onClick={() => navigate(-1)}>
        {'\u{2190}'} Back
      </button>

      <div className="card section">
        <h3 style={{ marginTop: 0 }}>{theme === 'dark' ? '\u{1F319}' : '\u{2600}\u{FE0F}'} Appearance</h3>
        <p className="screen-subtitle" style={{ marginTop: 0 }}>
          {theme === 'dark' ? 'Dark mode is on.' : 'Light mode is on.'}
        </p>
        <button type="button" className="btn btn-block btn-ghost" onClick={toggleTheme}>
          {theme === 'dark' ? `${'\u{2600}\u{FE0F}'} Switch to Light Mode` : `${'\u{1F319}'} Switch to Dark Mode`}
        </button>
      </div>

      <div className="card section">
        <h3 style={{ marginTop: 0 }}>{'\u{1F4CF}'} Units</h3>
        <p className="screen-subtitle" style={{ marginTop: 0 }}>
          {units === 'imperial' ? 'Distances show in feet and miles.' : 'Distances show in meters and kilometers.'}
          {mode === 'auto' && (
            <>
              {' '}
              {autoCountry
                ? `Picked for ${countryName(autoCountry)}, where you are now.`
                : 'Picked from your device’s region until we have your location.'}
            </>
          )}
        </p>
        <div className="tabs" style={{ margin: 0 }}>
          <button type="button" className={`tab-btn ${mode === 'auto' ? 'active' : ''}`} onClick={() => setMode('auto')}>
            Automatic
          </button>
          <button
            type="button"
            className={`tab-btn ${mode === 'imperial' ? 'active' : ''}`}
            onClick={() => setMode('imperial')}
          >
            Imperial (mi)
          </button>
          <button
            type="button"
            className={`tab-btn ${mode === 'metric' ? 'active' : ''}`}
            onClick={() => setMode('metric')}
          >
            Metric (km)
          </button>
        </div>
      </div>

      <div className="card section">
        <h3 style={{ marginTop: 0 }}>{'⭐'} My Preferences</h3>
        <p className="screen-subtitle" style={{ marginTop: -6 }}>
          Save what you're usually into — Setup can fill it in for you with one tap.
        </p>
        <PreferenceChips />
      </div>

      {firebaseEnabled && user && (
        <div className="card section">
          <h3 style={{ marginTop: 0 }}>{'\u{1F9E9}'} Tell Mapr What You Love</h3>
          <p className="screen-subtitle" style={{ marginTop: -6 }}>
            In your own words -- categories, specific places, or brands, whatever comes to mind: "I love racing,
            steak, pickleball, the boat, Dunkin' Donuts, sushi, arepa places, marinas, Carrot Express... I like
            fancy, luxurious things." Mapr reads this directly, no rating required.
          </p>
          {taste.restored && <DraftRestoredNote onDiscard={taste.discard} />}
          <textarea
            className="rating-comment"
            name="taste-intro"
            aria-label="What you love"
            autoComplete="off"
            autoCapitalize="sentences"
            rows={3}
            maxLength={2000}
            placeholder="What are you already into?"
            value={tasteIntro}
            onChange={(e) => {
              setTasteMsg(null);
              taste.setDraft(e.target.value);
            }}
          />
          <button
            type="button"
            className="btn btn-ghost btn-block"
            style={{ marginTop: 10 }}
            disabled={!tasteIntro.trim()}
            onClick={saveTaste}
          >
            Save
          </button>
          {tasteMsg && (
            <p className="screen-subtitle" style={{ marginTop: 8 }}>
              {tasteMsg}
            </p>
          )}
        </div>
      )}

      {firebaseEnabled && user && (
        <div className="card section">
          <h3 style={{ marginTop: 0 }}>{'\u{1F3E0}'} Home Address</h3>
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            Helps Mapr learn your taste around where you actually live.
          </p>
          {home.restored && !homePending && <DraftRestoredNote onDiscard={home.discard} />}
          <LocationAutocomplete
            id="home-address"
            placeholder="Enter your home address"
            value={homeAddress}
            onChange={home.setDraft}
            onSelect={pickHome}
          />
          {(homePending || myProfile?.homeCoords) && (
            <p className="screen-subtitle" style={{ marginTop: 8 }}>
              Saved: {homePending || myProfile.homeAddress}
            </p>
          )}
        </div>
      )}

      {firebaseEnabled && user && (
        <div className="card section">
          <h3 style={{ marginTop: 0 }}>{isPublic ? '\u{1F30E}' : '\u{1F512}'} Privacy</h3>
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            {isPublic
              ? 'Your reviews and check-in photos are visible to everyone.'
              : 'Your reviews and check-in photos are only visible to friends.'}
          </p>
          <button
            type="button"
            className={`btn btn-block ${isPublic ? 'btn-success' : 'btn-ghost'}`}
            aria-pressed={isPublic}
            onClick={toggleVisibility}
          >
            {isPublic ? `${'\u{1F30E}'} Public — tap to make Private` : `${'\u{1F512}'} Private — tap to make Public`}
          </button>
        </div>
      )}

      {firebaseEnabled && user && (
        <div className="card section">
          <h3 style={{ marginTop: 0 }}>{'\u{1F4CD}'} Habit Tracking</h3>
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            {habitTrackingEnabled
              ? "Mapr notices places you keep visiting (like a coffee shop every morning) and asks if you'd like to add them to an itinerary. Only happens while the app is open, and nothing leaves your device until a spot is worth asking about."
              : "Mapr won't learn or suggest places from where you go."}
          </p>
          <button
            type="button"
            className={`btn btn-block ${habitTrackingEnabled ? 'btn-success' : 'btn-ghost'}`}
            aria-pressed={habitTrackingEnabled}
            onClick={toggleHabitTracking}
          >
            {habitTrackingEnabled ? `${'\u{2705}'} On — tap to turn off` : `${'\u{1F6AB}'} Off — tap to turn on`}
          </button>
        </div>
      )}

      {firebaseEnabled && user && (
        <div className="card section">
          <h3 style={{ marginTop: 0 }}>{'\u{1F30D}'} Background Location</h3>
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            {backgroundLocationEnabled
              ? "Mapr keeps learning your location even with the app closed, so it's already building picks for a new city the moment you land there, not just once you open the app. Uses iOS's \"Always\" location permission and some extra battery."
              : "Mapr only knows your location while the app is open. Turn this on and it keeps learning even when it's closed -- useful the moment you land in a new city."}
          </p>
          {bgLocationErr && <ErrorNotice compact message={bgLocationErr} />}
          <button
            type="button"
            className={`btn btn-block ${backgroundLocationEnabled ? 'btn-success' : 'btn-ghost'}`}
            aria-pressed={backgroundLocationEnabled}
            onClick={toggleBackgroundLocation}
          >
            {backgroundLocationEnabled ? `${'\u{2705}'} On — tap to turn off` : `${'\u{1F6AB}'} Off — tap to turn on`}
          </button>
        </div>
      )}

      {firebaseEnabled && user && (
        <div className="card section">
          <h3 style={{ marginTop: 0 }}>{'\u{1F514}'} Push Notifications</h3>
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            {pushNotificationsEnabled
              ? 'Landmark Hunters can notify you even when the app is closed.'
              : "Off means you'll only see updates while the app is open. Turn this on to get notified even when it's closed."}
          </p>
          {pushErr && <ErrorNotice compact message={pushErr} />}
          <button
            type="button"
            className={`btn btn-block ${pushNotificationsEnabled ? 'btn-success' : 'btn-ghost'}`}
            aria-pressed={pushNotificationsEnabled}
            onClick={togglePushNotifications}
          >
            {pushNotificationsEnabled ? `${'\u{2705}'} On — tap to turn off` : `${'\u{1F6AB}'} Off — tap to turn on`}
          </button>
          {pushNotificationsEnabled && (
            <>
              <button type="button" className="btn btn-ghost btn-block btn-sm" style={{ marginTop: 8 }} onClick={sendTestPush}>
                Send test notification
              </button>
              {pushTestMsg && (
                <p className="screen-subtitle" style={{ margin: '6px 0 0', fontSize: '0.8rem' }}>
                  {pushTestMsg}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {canUseAdminMode && (
        <div className="card section">
          <h3 style={{ marginTop: 0 }}>{'\u{1F6E0}\u{FE0F}'} Admin Mode</h3>
          <p className="screen-subtitle" style={{ marginTop: 0 }}>
            {adminMode
              ? 'On for this device. Editing/deleting a submitted landmark from its page or map pin changes it for everyone, immediately — there is no undo.'
              : 'Only visible to your account. Turn on to edit or delete any user-submitted landmark directly from its page or map pin.'}
          </p>
          <button
            type="button"
            className={`btn btn-block ${adminMode ? 'btn-danger' : 'btn-ghost'}`}
            onClick={() => setAdminMode(!adminMode)}
          >
            {adminMode ? `${'\u{2715}'} Turn Off Admin Mode` : `${'\u{1F6E0}\u{FE0F}'} Turn On Admin Mode`}
          </button>
        </div>
      )}

      {/* Account -- moved here from Profile so that screen stays about your
          taste/ranks, not account admin. Always last on the page. */}
      {firebaseEnabled && user && (
        <div className="card section">
          <Link to="/request-feature" className="btn btn-ghost btn-block">
            {'\u{1F4A1}'} Request a Feature
          </Link>
          <Link to="/report-bug" className="btn btn-ghost btn-block" style={{ marginTop: 12 }}>
            {'\u{1F41B}'} Report a Bug
          </Link>
          {!user.emailVerified && (
            <div style={{ marginTop: 12 }}>
              <p className="tag tag-error" style={{ display: 'block', margin: 0 }}>
                Your email isn't verified yet — some actions (like adding a landmark) need it.
              </p>
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 8 }}
                disabled={verifyBusy}
                onClick={async () => {
                  setVerifyBusy(true);
                  setVerifyMsg(null);
                  try {
                    await resendVerification();
                    setVerifyMsg('Verification email sent — check your inbox (and spam folder).');
                  } catch (e) {
                    setVerifyMsg(`Could not send it right now: ${authErrorMessage(e)}`);
                  } finally {
                    setVerifyBusy(false);
                  }
                }}
              >
                {verifyBusy ? 'Sending…' : 'Resend Verification Email'}
              </button>
              {verifyMsg && (
                <p className="screen-subtitle" style={{ marginTop: 6, marginBottom: 0 }}>
                  {verifyMsg}
                </p>
              )}
            </div>
          )}
          <p style={{ textAlign: 'center', marginTop: 12, marginBottom: 0, fontSize: '0.78rem' }}>
            <Link to="/legal" style={{ color: 'var(--color-parchment-dim)' }}>
              Privacy Policy & Terms of Service
            </Link>
          </p>
          <button className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={() => setChangePasswordOpen(true)}>
            Change Password
          </button>
          <button className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={signOutUser}>
            Sign Out
          </button>
          {user.metadata?.creationTime && (
            <p style={{ textAlign: 'center', marginTop: 12, marginBottom: 0, fontSize: '0.72rem', color: 'var(--color-parchment-dim)' }}>
              Joined{' '}
              {new Date(user.metadata.creationTime).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          )}
          {/* Always visible (not just when unverified) -- so there's an
              unambiguous, no-digging-required answer to "is my email really
              verified or not," matching whatever refreshUser() last synced
              from Firebase's live account state. */}
          <p
            className={`tag ${user.emailVerified ? 'tag-free' : 'tag-error'}`}
            style={{ display: 'block', textAlign: 'center', marginTop: 12 }}
          >
            {user.emailVerified ? '\u{2705} Your email has been verified.' : "\u{274C} Your email isn't verified yet."}
          </p>
        </div>
      )}

      {changePasswordOpen &&
        createPortal(
          <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setChangePasswordOpen(false)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <h3 style={{ marginTop: 0 }}>Change Password</h3>
              <form onSubmit={handleChangePassword}>
                <div className="field">
                  <label htmlFor="current-password">Current Password</label>
                  <input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    disabled={passwordBusy}
                    autoComplete="current-password"
                  />
                </div>
                <div className="field">
                  <label htmlFor="new-password">New Password</label>
                  <input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    disabled={passwordBusy}
                    autoComplete="new-password"
                  />
                </div>
                <div className="field">
                  <label htmlFor="confirm-password">Confirm New Password</label>
                  <input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    disabled={passwordBusy}
                    autoComplete="new-password"
                  />
                </div>
                {passwordMsg && (
                  <p
                    className={`tag ${passwordMsg.includes('successfully') ? 'tag-free' : 'tag-error'}`}
                    style={{ display: 'block', marginBottom: 12 }}
                  >
                    {passwordMsg}
                  </p>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-primary btn-block" disabled={passwordBusy}>
                    {passwordBusy ? 'Changing…' : 'Change Password'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-block"
                    onClick={() => setChangePasswordOpen(false)}
                    disabled={passwordBusy}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

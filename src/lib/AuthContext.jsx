import { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  reload,
  updateProfile,
  signOut,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  EmailAuthProvider,
  deleteUser,
  updatePassword,
  GoogleAuthProvider,
  signInWithPopup,
  getAdditionalUserInfo,
} from 'firebase/auth';
import { auth, firebaseEnabled } from './firebase';
import { deleteAccountData } from './accountDeletion';
import { recordReferralIfPending } from './referrals';
import { touchLastActive } from './friends';
import { recordOpenDay } from './openDays';
import { markNewSignup } from './onboardingSave';
import { cleanUpPushOnSignOut } from './pushSignOut';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!firebaseEnabled) {
      setLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      // Best-effort "seen today" stamp -- this is what makes the
      // retention-by-ratings-count analysis possible later (who came back
      // within 30 days). Never blocks or fails sign-in.
      if (u) touchLastActive(u.uid).catch(() => {});
      // One tiny "opened the app today" record per day (openDays.js).
      if (u) recordOpenDay(u.uid).catch(() => {});
    });
    return unsub;
  }, []);

  // An app left open overnight counts again the next local day.
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return undefined;
    const onVisible = () => {
      if (document.visibilityState === 'visible') recordOpenDay(uid).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user?.uid]);

  const signUpEmail = async (email, password, displayName) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // First thing after the account exists, so the profile is already marked
    // as a sign-up by the time anything reads it (see onboardingStatus).
    markNewSignup(cred.user.uid).catch(() => {});
    if (displayName) {
      await updateProfile(cred.user, { displayName });
      setUser({ ...cred.user, displayName });
    }
    // Best-effort -- a signup that succeeds shouldn't fail just because the
    // verification email didn't send. resendVerification lets them retry.
    sendEmailVerification(cred.user).catch(() => {});
    recordReferralIfPending(cred.user).catch(() => {});
    return cred.user;
  };

  const signInEmail = (email, password) => signInWithEmailAndPassword(auth, email, password);

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    try {
      const result = await signInWithPopup(auth, provider);
      const isNewUser = !!getAdditionalUserInfo(result)?.isNewUser;
      if (isNewUser) markNewSignup(result.user.uid).catch(() => {});
      recordReferralIfPending(result.user).catch(() => {});
      return { user: result.user, isNewUser };
    } catch (err) {
      console.error('Google Sign-In error:', err.code, err.message);
      throw err;
    }
  };

  const resetPassword = (email) => sendPasswordResetEmail(auth, email);

  const resendVerification = () => sendEmailVerification(auth.currentUser);

  // Firebase doesn't push a live update when emailVerified flips server-side
  // (clicking the link in another tab) -- reload() re-fetches the account
  // and this re-syncs it into state so the Profile banner can clear itself
  // without a full sign-out/sign-in.
  //
  // Only replace `user` with a new object when emailVerified actually
  // changed. Profile calls this on every mount for an unverified account,
  // so an unconditional new reference here meant every visit to Profile
  // looked like a brand-new sign-in to every context keyed off `user` --
  // FriendsContext re-ran its whole reload (flipping profileFresh false
  // then true again) and BadgesContext re-fetched stats, on every single
  // navigation to Profile. That churn was the real source of badges
  // re-celebrating: enough incidental re-fetching for a client-side
  // "did this just complete" heuristic to occasionally race itself.
  const refreshUser = async () => {
    if (!auth.currentUser) return;
    await reload(auth.currentUser);
    setUser((prev) => (prev && prev.emailVerified === auth.currentUser.emailVerified ? prev : { ...auth.currentUser }));
  };

  const signOutUser = async () => {
    // Drop this device's push token from the account first (needs the live
    // session), so the next person on a shared phone isn't sent this one's pushes.
    await cleanUpPushOnSignOut(auth.currentUser?.uid);
    return signOut(auth);
  };

  // Requires a password because Firebase rejects deleteUser on a session
  // that isn't "recent" -- reauthenticating first is the standard fix, and
  // it doubles as a real confirmation step for an irreversible action.
  // Firestore/Storage cleanup runs BEFORE deleteUser: once the Auth account
  // is gone, request.auth is null and every rule above that checks it would
  // reject the cleanup writes.
  // Accounts with no password provider (Google-only) reauthenticate with
  // the Google popup instead, so `password` is only needed when one exists.
  const deleteAccount = async (password) => {
    const current = auth.currentUser;
    const hasPassword = (current.providerData || []).some((p) => p.providerId === 'password');
    if (hasPassword) {
      const cred = EmailAuthProvider.credential(current.email, password);
      await reauthenticateWithCredential(current, cred);
    } else {
      await reauthenticateWithPopup(current, new GoogleAuthProvider());
    }
    await deleteAccountData(current.uid);
    await deleteUser(current);
  };

  const changePassword = async (currentPassword, newPassword) => {
    const current = auth.currentUser;
    const cred = EmailAuthProvider.credential(current.email, currentPassword);
    await reauthenticateWithCredential(current, cred);
    await updatePassword(current, newPassword);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        firebaseEnabled,
        signUpEmail,
        signInEmail,
        signInWithGoogle,
        resetPassword,
        resendVerification,
        refreshUser,
        signOutUser,
        deleteAccount,
        changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

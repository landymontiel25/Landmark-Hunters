import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { isAdmin, setCheckinAnywhereLive } from './admins';
import { subscribeAdminSettings, setCheckinAnywhere as saveCheckinAnywhere } from './adminSettings';

const AdminModeContext = createContext(null);
const KEY = 'landmarkhunters.adminMode';

// A local, per-device on/off switch for the admin's own edit tools (Settings
// -> "Admin Mode"). This is a convenience toggle, not the security boundary
// -- it can only ever turn ON for the one allow-listed admin account
// (ADMIN_EMAILS in lib/admins.js): every write it unlocks (updateCustomLandmark,
// deleteCustomLandmark) is still checked server-side by firestore.rules
// against that same admin email, exactly like the rest of the app's admin-only
// actions. Flipping this on from devtools with a non-admin account wouldn't
// grant anything real -- the writes would still be rejected.
export function AdminModeProvider({ children }) {
  const { user, loading } = useAuth();
  const canUseAdminMode = isAdmin(user?.email);
  const [adminMode, setAdminModeState] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });

  // Never let a non-admin account see edit tools, even if this device once
  // had it on as the admin and then signed into a different account.
  // Not while auth is still loading: user is null for the first moments of
  // every app start, which used to switch Admin Mode off on every reload.
  useEffect(() => {
    if (!loading && !canUseAdminMode && adminMode) setAdminModeState(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseAdminMode, loading]);

  // The admin panel's "Check-in radius off" switch (admin_settings/{uid}),
  // kept in step with the copy the check-in code reads (admins.js).
  const [checkinAnywhere, setCheckinAnywhereState] = useState(true);
  const adminUid = canUseAdminMode ? user?.uid : null;
  useEffect(() => {
    if (!adminUid) {
      setCheckinAnywhereLive(false);
      return undefined;
    }
    return subscribeAdminSettings(adminUid, ({ checkinAnywhere: on }) => {
      setCheckinAnywhereLive(on);
      setCheckinAnywhereState(on);
    });
  }, [adminUid]);
  const setCheckinAnywhere = async (on) => {
    if (!adminUid) return;
    setCheckinAnywhereLive(on);
    setCheckinAnywhereState(on);
    await saveCheckinAnywhere(adminUid, on);
  };

  const setAdminMode = (on) => {
    if (on && !canUseAdminMode) return;
    setAdminModeState(on);
    try {
      if (on) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch {
      /* private mode -- stays on for this tab only */
    }
  };

  return (
    <AdminModeContext.Provider value={{ adminMode: adminMode && canUseAdminMode, canUseAdminMode, setAdminMode, checkinAnywhere: canUseAdminMode && checkinAnywhere, setCheckinAnywhere }}>
      {children}
    </AdminModeContext.Provider>
  );
}

export function useAdminMode() {
  const ctx = useContext(AdminModeContext);
  if (!ctx) throw new Error('useAdminMode must be used inside AdminModeProvider');
  return ctx;
}

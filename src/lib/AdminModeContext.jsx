import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { isAdmin, setCheckinAnywhereLive } from './admins';
import { subscribeAdminSettings, saveAdminSettings, DEFAULT_ADMIN_SETTINGS } from './adminSettings';

const AdminModeContext = createContext(null);

// Admin Mode is the admin panel (owner, 2026-11-23: one admin mode). Its
// master switch and the "Check-in radius off" switch live in the admin's
// own admin_settings/{uid}, so the server reads the same switches
// (api/verify-checkin.js, api/admin-test-push.js, the banner's rules).
//   adminMode        on: the edit tools work and the panel's controls are
//                    enabled; off: the admin is a normal user
//   checkinAnywhere  the admin's own radius bypass, only with Admin Mode on
// Only the allow-listed admin account (lib/admins.js) can ever turn it on,
// and every write it unlocks is still checked by firestore.rules.
export function AdminModeProvider({ children }) {
  const { user } = useAuth();
  const canUseAdminMode = isAdmin(user?.email);
  const adminUid = canUseAdminMode ? user?.uid : null;
  const [settings, setSettings] = useState(DEFAULT_ADMIN_SETTINGS);

  useEffect(() => {
    setSettings(DEFAULT_ADMIN_SETTINGS);
    if (!adminUid) {
      setCheckinAnywhereLive(false);
      return undefined;
    }
    return subscribeAdminSettings(adminUid, (s) => {
      setSettings(s);
      setCheckinAnywhereLive(s.adminMode && s.checkinAnywhere);
    });
  }, [adminUid]);

  const save = async (patch) => {
    if (!adminUid) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setCheckinAnywhereLive(next.adminMode && next.checkinAnywhere);
    await saveAdminSettings(adminUid, next);
  };

  const adminMode = canUseAdminMode && settings.adminMode;
  return (
    <AdminModeContext.Provider
      value={{
        canUseAdminMode,
        adminMode,
        setAdminMode: (on) => save({ adminMode: !!on }),
        // The switch's own position; it only takes effect with Admin Mode on.
        checkinAnywhere: canUseAdminMode && settings.checkinAnywhere,
        setCheckinAnywhere: (on) => save({ checkinAnywhere: !!on }),
      }}
    >
      {children}
    </AdminModeContext.Provider>
  );
}

export function useAdminMode() {
  const ctx = useContext(AdminModeContext);
  if (!ctx) throw new Error('useAdminMode must be used inside AdminModeProvider');
  return ctx;
}
